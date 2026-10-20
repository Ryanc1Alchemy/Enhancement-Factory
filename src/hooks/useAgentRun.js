import { useState, useRef, useCallback, useEffect } from 'react';
import { api, newRunId } from '../lib/api.js';
import { STATES, GATE_ORDER, nextGateId, isLastGate, gateNumber } from '../lib/gates.js';
import { buildBundleSummaryForRequest, describeBundle } from '../lib/guidewireArtifactBundle.js';
import { toSnapshot, fromSnapshot, snapshotSize, isFinished, MAX_SNAPSHOT_BYTES } from '../lib/runSnapshot.js';

// useRef for always-fresh values (per established learning — avoids stale closure bugs in persistence)
// Async background save to /api/runs that does not block the UI

// Current schema version for stored run records. Bumped from the implicit v1
// (numeric gate 1-6 keys, where 4=Effort Estimate and 5=Acceptance Criteria)
// to v2 when gates were re-identified by stable string id and reordered
// (Acceptance Criteria now precedes Effort Estimate). Runs saved without this
// field, or with an older value, are pre-reorder runs and must NOT be
// silently reinterpreted under the new gate meanings — see api/runs.js.
//
// v3 = save & resume: rows also carry a full run snapshot (`state`). The
// gate order and meaning are unchanged from v2.
const SCHEMA_VERSION = 3;

// Wait this long after the last change before saving, so a burst of updates
// produces one save. Overridable for tests.
const DEFAULT_SAVE_DELAY_MS = 1000;

function initialGateStates() {
  const states = {};
  for (const id of GATE_ORDER) states[id] = STATES.PENDING;
  return states;
}

const initialState = {
  runId: null,
  request: '',
  schemaVersion: SCHEMA_VERSION,
  // gate state map: { '<gate id>': 'pending'|'proposed'|'accepted'|'rejected'|'regenerating', ... }
  gateStates: initialGateStates(),
  // artifacts produced — keyed by gate id
  artifacts: {}, // proposed/current artifact per gate
  acceptedArtifacts: {}, // accepted artifacts only — passed to backend as prior_artifacts
  previousArtifacts: {}, // pre-regeneration artifact (for diff view)
  gateUsage: {}, // token usage per gate: { '<gate id>': { input_tokens?, output_tokens?, total_tokens? } }
  jiraIssueType: 'Story', // BA-selected Gate 6 issue type
  conversation: [], // array of { who: 'system'|'user'|'agent', body: string, ts }
  jiraResult: null, // result of /api/runs commit_jira
  guidewireBundle: null, // parsed multi-area Guidewire Studio bundle (optional, attached at start)
  // Project grounding as the agent receives it. Saved with the run so a
  // resumed run grounds later gates exactly as before, even without the files.
  bundleSummary: null,
  bundleDescription: [],
  // ---- save & resume ----
  revision: null, // server revision last saved/loaded (optimistic locking)
  saveStatus: 'idle', // idle | saving | saved | unavailable | conflict | too_large | error
  lastSavedAt: null,
  runStatus: 'in_progress', // in_progress | waiting_review | completed
  waitingOn: '',
  waitingReason: '',
  waitingSince: null,
  readOnly: false, // finished or older runs open read-only
  resumeNotes: [], // shown once after resuming (e.g. files not re-attached)
  busy: false,
  error: null
};

// Grounding text for an agent call: the live parsed files when attached,
// otherwise the summary saved with the run. For advance calls this is the
// same text in both cases (it is built from the request alone).
function groundingFor(s, text) {
  if (s.guidewireBundle) return buildBundleSummaryForRequest(s.guidewireBundle, text);
  return s.bundleSummary || null;
}

function runStatusFor(s) {
  if (s.jiraResult?.commit_result?.mode === 'live') return 'completed';
  return s.runStatus === 'waiting_review' ? 'waiting_review' : 'in_progress';
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const inputTokens = Number.isFinite(usage.input_tokens)
    ? usage.input_tokens
    : Number.isFinite(usage.inputTokens)
    ? usage.inputTokens
    : null;
  const outputTokens = Number.isFinite(usage.output_tokens)
    ? usage.output_tokens
    : Number.isFinite(usage.outputTokens)
    ? usage.outputTokens
    : null;
  const totalTokens = Number.isFinite(usage.total_tokens)
    ? usage.total_tokens
    : Number.isFinite(usage.totalTokens)
    ? usage.totalTokens
    : (Number.isFinite(inputTokens) && Number.isFinite(outputTokens) ? inputTokens + outputTokens : null);

  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens) && !Number.isFinite(totalTokens)) return null;

  return {
    ...(Number.isFinite(inputTokens) ? { input_tokens: inputTokens } : {}),
    ...(Number.isFinite(outputTokens) ? { output_tokens: outputTokens } : {}),
    ...(Number.isFinite(totalTokens) ? { total_tokens: totalTokens } : {})
  };
}

export function useAgentRun({ saveDelayMs = DEFAULT_SAVE_DELAY_MS } = {}) {
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const saveTimerRef = useRef(null);
  const savingRef = useRef(false);
  const resaveRef = useRef(false);
  // Opening a saved run must not count as a change: skip the save that the
  // resume itself would trigger, so merely viewing a run never makes another
  // tab out of date.
  const skipNextSaveRef = useRef(false);

  // ------------ persistence ------------
  // Saves a snapshot of the run (see src/lib/runSnapshot.js). A side effect
  // only: it never blocks or changes a gate. Failures just update saveStatus.
  const persist = useCallback(async () => {
    const s = stateRef.current;
    // No database (server said so once): stop trying. Conflict: this tab is out of date.
    if (!s.runId || s.readOnly || s.saveStatus === 'conflict' || s.saveStatus === 'unavailable') return;
    if (savingRef.current) { resaveRef.current = true; return; }

    const snapshot = toSnapshot(s);
    if (snapshotSize(snapshot) > MAX_SNAPSHOT_BYTES) {
      setState(prev => ({ ...prev, saveStatus: 'too_large' }));
      return;
    }

    savingRef.current = true;
    setState(prev => ({ ...prev, saveStatus: 'saving' }));
    try {
      const res = await api.runs.save({
        run_id: s.runId,
        request: s.request,
        schema_version: SCHEMA_VERSION,
        // current_gate is stored as the NUMERIC position for backward
        // compatibility with the existing INT column — but its MEANING is
        // only valid when read alongside schema_version>=2 (see api/runs.js).
        // A v1 row with current_gate=4 means "Effort Estimate" (old order);
        // a v2+ row with current_gate=4 means "Acceptance Criteria" (new
        // order). Never conflate the two without checking schema_version.
        current_gate: gateNumber(highestActiveGateId(s)) || 0,
        status: runStatusFor(s),
        artifacts: s.acceptedArtifacts,
        history: s.conversation,
        jira_ticket: s.jiraResult?.commit_result?.ticket?.key || null,
        state: snapshot,
        title: s.request.slice(0, 120),
        waiting_on: s.waitingOn || null,
        waiting_reason: s.waitingReason || null,
        expected_revision: Number.isInteger(s.revision) ? s.revision : null
      });
      if (res?.db_unavailable) {
        setState(prev => ({ ...prev, saveStatus: 'unavailable' }));
      } else {
        setState(prev => ({ ...prev, saveStatus: 'saved', revision: res?.revision ?? prev.revision, lastSavedAt: Date.now() }));
      }
    } catch (err) {
      const saveStatus = err?.status === 409 ? 'conflict' : err?.status === 413 ? 'too_large' : 'error';
      setState(prev => ({ ...prev, saveStatus }));
      // Non-fatal — agent still works without DB
      // eslint-disable-next-line no-console
      console.warn('Persistence failed (non-fatal):', err?.message);
    } finally {
      savingRef.current = false;
      if (resaveRef.current) {
        resaveRef.current = false;
        persist();
      }
    }
  }, []);

  // Save once the run SETTLES — never while an agent call is in flight, so a
  // half-finished gate can never be saved. Debounced.
  useEffect(() => {
    if (!state.runId || state.busy || state.readOnly) return undefined;
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return undefined; }
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persist(), saveDelayMs);
    return () => clearTimeout(saveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.runId, state.busy, state.gateStates, state.artifacts, state.acceptedArtifacts, state.jiraResult, state.runStatus, state.waitingOn, state.waitingReason]);

  // When the tab regains focus, check whether the run was saved elsewhere in
  // the meantime. If so, mark this tab out of date BEFORE the user runs a
  // gate (gate buttons are disabled while out of date).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const check = async () => {
      const s = stateRef.current;
      if (!s.runId || s.readOnly || s.busy || !Number.isInteger(s.revision) || s.saveStatus === 'conflict') return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        const res = await api.runs.get(s.runId);
        const serverRevision = res?.run?.revision;
        const now = stateRef.current;
        if (Number.isInteger(serverRevision) && Number.isInteger(now.revision) && serverRevision > now.revision && !savingRef.current) {
          setState(prev => ({ ...prev, saveStatus: 'conflict' }));
        }
      } catch {
        // offline or no database: nothing to compare against
      }
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  // ------------ helpers ------------
  const log = useCallback((who, body) => {
    setState(s => ({
      ...s,
      conversation: [...s.conversation, { who, body, ts: Date.now() }]
    }));
  }, []);

  const setError = useCallback((err) => {
    setState(s => ({ ...s, busy: false, error: err?.message || String(err) }));
    log('system', `Error: ${err?.message || err}`);
  }, [log]);

  // ------------ start a new run ------------
  const startRun = useCallback(async (request, guidewireBundle) => {
    if (!request || !request.trim()) return;
    const trimmed = request.trim();
    const runId = newRunId();
    const firstGateId = GATE_ORDER[0];
    const bundleLines = guidewireBundle ? describeBundle(guidewireBundle) : [];
    const bundleSummary = guidewireBundle ? buildBundleSummaryForRequest(guidewireBundle, trimmed) : null;
    setState({
      ...initialState,
      gateStates: initialGateStates(),
      runId,
      request: trimmed,
      guidewireBundle: guidewireBundle || null,
      bundleSummary,
      bundleDescription: bundleLines,
      conversation: [
        { who: 'user', body: trimmed, ts: Date.now() },
        ...(bundleLines.length > 0
          ? [{ who: 'system', body: `Guidewire artifacts attached: ${bundleLines.join(' · ')}.`, ts: Date.now() }]
          : []),
        { who: 'system', body: 'Agent starting at gate 1 — Request Analysis…', ts: Date.now() }
      ],
      gateStates: { ...initialGateStates(), [firstGateId]: STATES.REGENERATING },
      busy: true
    });

    try {
      const res = await api.agent.advance({
        gate: firstGateId,
        request: trimmed,
        prior_artifacts: {},
        data_dictionary: bundleSummary
      });
      const usage = normalizeUsage(res.usage);
      setState(s => ({
        ...s,
        artifacts: { ...s.artifacts, [firstGateId]: res.artifact },
        gateUsage: usage ? { ...s.gateUsage, [firstGateId]: usage } : s.gateUsage,
        gateStates: { ...s.gateStates, [firstGateId]: STATES.PROPOSED },
        conversation: [...s.conversation, { who: 'agent', body: 'Gate 1 — Request Analysis ready for review.', ts: Date.now() }],
        busy: false
      }));
    } catch (err) {
      setError(err);
    }
  }, [setError]);

  // ------------ accept a gate ------------
  // `artifactToAccept` lets "Save and accept" approve the BA's edited version
  // directly. Without it, the edit was put into state and acceptGate ran
  // straight away, reading the not-yet-updated state — so the ORIGINAL
  // artifact was approved and the edit was silently dropped.
  const acceptGateWith = useCallback(async (gateId, artifactToAccept) => {
    const s = stateRef.current;
    const artifact = artifactToAccept || s.artifacts[gateId];
    if (!artifact) return;

    const newAccepted = { ...s.acceptedArtifacts, [gateId]: artifact };
    const newGateStates = { ...s.gateStates, [gateId]: STATES.ACCEPTED };

    if (!isLastGate(gateId)) {
      // Advance to next gate
      const nextId = nextGateId(gateId);
      newGateStates[nextId] = STATES.REGENERATING;
      setState(prev => ({
        ...prev,
        acceptedArtifacts: newAccepted,
        gateStates: newGateStates,
        conversation: [
          ...prev.conversation,
          { who: 'user', body: `Approved gate: ${gateId}.`, ts: Date.now() },
          { who: 'system', body: `Agent advancing to the next gate…`, ts: Date.now() }
        ],
        busy: true,
        error: null
      }));

      try {
        const res = await api.agent.advance({
          gate: nextId,
          request: s.request,
          prior_artifacts: newAccepted,
          data_dictionary: groundingFor(s, s.request)
        });
        const usage = normalizeUsage(res.usage);
        setState(prev => ({
          ...prev,
          artifacts: { ...prev.artifacts, [nextId]: res.artifact },
          gateUsage: usage ? { ...prev.gateUsage, [nextId]: usage } : prev.gateUsage,
          gateStates: { ...prev.gateStates, [nextId]: STATES.PROPOSED },
          conversation: [...prev.conversation, { who: 'agent', body: `${res.gate_name} ready for review.`, ts: Date.now() }],
          busy: false
        }));
      } catch (err) {
        setError(err);
        setState(prev => ({ ...prev, gateStates: { ...prev.gateStates, [nextId]: STATES.PENDING } }));
      }
    } else {
      // Last gate (jira_ticket) accepted — this means the user approved the DRAFT.
      // Now commit to Jira.
      setState(prev => ({
        ...prev,
        acceptedArtifacts: newAccepted,
        gateStates: newGateStates,
        conversation: [
          ...prev.conversation,
          { who: 'user', body: 'Approved Jira ticket draft. Raising Jira ticket…', ts: Date.now() }
        ],
        busy: true,
        error: null
      }));

      try {
        const res = await api.agent.commitJira({
          request: s.request,
          prior_artifacts: newAccepted,
          jira_issue_type: s.jiraIssueType || 'Story'
        });
        setState(prev => ({
          ...prev,
          jiraResult: res,
          gateStates: { ...prev.gateStates, [gateId]: STATES.COMMITTED },
          conversation: [
            ...prev.conversation,
            {
              who: 'agent',
              body:
                res.commit_result?.mode === 'live'
                  ? `Jira ticket created: ${res.commit_result.ticket.key}`
                  : res.commit_result?.mode === 'simulated'
                  ? 'Jira simulated (env vars not configured). Demo complete.'
                  : `Jira error: ${res.commit_result?.error}`,
              ts: Date.now()
            }
          ],
          busy: false
        }));
      } catch (err) {
        setError(err);
      }
    }
  }, [setError]);

  // Plain Accept: approve the artifact currently proposed for this gate.
  const acceptGate = useCallback(gateId => acceptGateWith(gateId), [acceptGateWith]);

  // ------------ reject a gate (with feedback) ------------
  const rejectGate = useCallback(async (gateId, feedback) => {
    const s = stateRef.current;
    const previous = s.artifacts[gateId];

    setState(prev => ({
      ...prev,
      previousArtifacts: { ...prev.previousArtifacts, [gateId]: previous },
      gateStates: { ...prev.gateStates, [gateId]: STATES.REGENERATING },
      conversation: [
        ...prev.conversation,
        { who: 'user', body: `Rejected gate: ${gateId}. Feedback: ${feedback}`, ts: Date.now() },
        { who: 'system', body: `Agent regenerating…`, ts: Date.now() }
      ],
      busy: true,
      error: null
    }));

    try {
      const res = await api.agent.regenerate({
        gate: gateId,
        request: s.request,
        prior_artifacts: s.acceptedArtifacts,
        feedback,
        previous_artifact: previous,
        data_dictionary: groundingFor(s, `${s.request} ${feedback}`)
      });
      const usage = normalizeUsage(res.usage);
      setState(prev => ({
        ...prev,
        artifacts: { ...prev.artifacts, [gateId]: res.artifact },
        gateUsage: usage ? { ...prev.gateUsage, [gateId]: usage } : prev.gateUsage,
        gateStates: { ...prev.gateStates, [gateId]: STATES.PROPOSED },
        conversation: [...prev.conversation, { who: 'agent', body: `Gate regenerated.`, ts: Date.now() }],
        busy: false
      }));
    } catch (err) {
      setError(err);
      setState(prev => ({ ...prev, gateStates: { ...prev.gateStates, [gateId]: STATES.PROPOSED } }));
    }
  }, [setError]);

  // ------------ recompute effort_estimate for a different assumed delivery grade ------------
  // Pure client/estimator-side recalculation — deliberately does NOT call the
  // agent. The complexity_inputs Claude already proposed don't change when a
  // different developer grade is selected; only the multiplier applied to
  // those same numbers changes, which is arithmetic /api/estimate already
  // does deterministically. Re-invoking Claude for this would be slower,
  // cost tokens, and risk subtle non-determinism in an otherwise-deterministic
  // calculation — see src/lib/api.js estimate.compute() comment.
  const recomputeEstimate = useCallback(async (gateId, assumedGrade) => {
    const s = stateRef.current;
    const artifact = s.artifacts[gateId];
    if (!artifact || !artifact.complexity_inputs) return;

    try {
      const computed = await api.estimate.compute({
        complexity_inputs: artifact.complexity_inputs,
        assumed_delivery_grade: assumedGrade,
        acceptance_criteria: s.acceptedArtifacts['acceptance_criteria'] || s.artifacts['acceptance_criteria'],
        design_note: s.acceptedArtifacts['design_note'] || s.artifacts['design_note']
      });
      setState(prev => ({
        ...prev,
        artifacts: {
          ...prev.artifacts,
          [gateId]: { ...prev.artifacts[gateId], computed_estimate: computed }
        }
      }));
    } catch (err) {
      setError(err);
    }
  }, [setError]);

  // ------------ edit a gate inline ------------
  // Treats user-edited content as authoritative. Marks accepted with the edited version.
  const editAndAcceptGate = useCallback(async (gateId, editedArtifact) => {
    const s = stateRef.current;
    setState(prev => ({
      ...prev,
      previousArtifacts: { ...prev.previousArtifacts, [gateId]: prev.artifacts[gateId] },
      artifacts: { ...prev.artifacts, [gateId]: editedArtifact },
      conversation: [
        ...prev.conversation,
        { who: 'user', body: `Edited gate inline. Accepting edited version.`, ts: Date.now() }
      ]
    }));
    // Accept the EDITED artifact explicitly (state above has not re-rendered
    // yet, so reading it back here would still return the original).
    await acceptGateWith(gateId, editedArtifact);
  }, [acceptGateWith]);

  // ------------ reopen a previously accepted gate and reset everything after it ------------
  // Any upstream change can invalidate downstream artifacts and estimates.
  // Reopening gate N keeps N's current artifact editable, but clears N+1..end.
  const reopenGate = useCallback((gateId) => {
    const s = stateRef.current;
    const gateIdx = GATE_ORDER.indexOf(gateId);
    if (gateIdx === -1) return;
    if (s.readOnly || s.busy || s.saveStatus === 'conflict') return;
    const currentState = s.gateStates?.[gateId];
    if (currentState !== STATES.ACCEPTED && currentState !== STATES.COMMITTED) return;

    const resetIds = GATE_ORDER.slice(gateIdx + 1);
    const resetSet = new Set(resetIds);

    setState(prev => {
      const gateStates = { ...prev.gateStates, [gateId]: STATES.PROPOSED };
      for (const id of resetIds) gateStates[id] = STATES.PENDING;

      const acceptedArtifacts = { ...prev.acceptedArtifacts };
      for (const id of [gateId, ...resetIds]) delete acceptedArtifacts[id];

      const artifacts = { ...prev.artifacts };
      for (const id of resetIds) delete artifacts[id];

      const previousArtifacts = { ...prev.previousArtifacts };
      for (const id of resetIds) delete previousArtifacts[id];

      const gateUsage = { ...prev.gateUsage };
      for (const id of [gateId, ...resetIds]) delete gateUsage[id];

      return {
        ...prev,
        gateStates,
        acceptedArtifacts,
        artifacts,
        previousArtifacts,
        gateUsage,
        jiraResult: resetSet.has('jira_ticket') || gateId !== 'jira_ticket' ? null : prev.jiraResult,
        runStatus: 'in_progress',
        waitingOn: '',
        waitingReason: '',
        waitingSince: null,
        conversation: [
          ...prev.conversation,
          {
            who: 'system',
            body: `Reopened gate ${gateId}. Cleared downstream gates: ${resetIds.length ? resetIds.join(', ') : '(none)'}.`,
            ts: Date.now()
          }
        ]
      };
    });
  }, []);

  // ------------ resume a saved run ------------
  // Loads the saved snapshot into the same state the gates already use. The
  // gate actions then carry on unchanged.
  const resumeRun = useCallback(async (runId) => {
    clearTimeout(saveTimerRef.current);
    setState(prev => ({ ...prev, busy: true, error: null }));
    let res;
    try {
      res = await api.runs.get(runId);
    } catch (err) {
      setError(err);
      return { ok: false, reason: err?.message };
    }
    const run = res?.run;
    if (!run) {
      setError(new Error('Saved run not found.'));
      return { ok: false, reason: 'not found' };
    }
    if (res.is_pre_reorder) {
      setError(new Error('This run was saved before the gate order changed and cannot be reopened.'));
      return { ok: false, reason: 'pre-reorder' };
    }

    const base = {
      ...initialState,
      runId: run.run_id,
      revision: Number.isInteger(run.revision) ? run.revision : null,
      saveStatus: 'saved',
      lastSavedAt: run.updated_at ? Date.parse(run.updated_at) : null,
      runStatus: run.status === 'waiting_review' ? 'waiting_review' : run.status === 'completed' ? 'completed' : 'in_progress',
      waitingOn: run.waiting_on || '',
      waitingReason: run.waiting_reason || '',
      waitingSince: run.waiting_since || null
    };

    if (!res.resumable || !run.state) {
      // Saved before save & resume existed: only approved gates were stored.
      // Show them read-only rather than guessing the rest.
      skipNextSaveRef.current = true;
      const accepted = run.artifacts || {};
      const gateStates = initialGateStates();
      for (const id of Object.keys(accepted)) if (id in gateStates) gateStates[id] = STATES.ACCEPTED;
      setState({
        ...base,
        request: run.request,
        gateStates,
        artifacts: { ...accepted },
        acceptedArtifacts: { ...accepted },
        conversation: Array.isArray(run.history) ? run.history : [],
        readOnly: true,
        resumeNotes: ['This run was saved before save & resume existed, so only its approved gates are available. It opens read-only.']
      });
      return { ok: true, readOnly: true };
    }

    const restored = fromSnapshot(run.state);
    if (!restored.ok) {
      setError(new Error(restored.reason));
      return { ok: false, reason: restored.reason };
    }
    const notes = [...restored.notes];
    if (restored.state.bundleSummary) {
      notes.push('Project files are not re-attached: later gates use the project summary saved with this run. Re-attach the files if you will reject a gate with feedback.');
    }
    const finished = isFinished(restored.state.gateStates);
    skipNextSaveRef.current = true;
    setState({
      ...base,
      ...restored.state,
      readOnly: finished,
      resumeNotes: finished ? [...notes, 'The Jira ticket has been raised — this run opens read-only.'] : notes,
      conversation: [
        ...restored.state.conversation,
        { who: 'system', body: 'Run resumed from saved state.', ts: Date.now() }
      ]
    });
    return { ok: true, readOnly: finished };
  }, [setError]);

  // ------------ park a run while waiting on someone else ------------
  const parkRun = useCallback(({ waitingOn = '', reason = '' } = {}) => {
    setState(prev => ({
      ...prev,
      runStatus: 'waiting_review',
      waitingOn: waitingOn.trim(),
      waitingReason: reason.trim(),
      waitingSince: prev.waitingSince || new Date().toISOString(),
      conversation: [
        ...prev.conversation,
        { who: 'user', body: `Parked for review${waitingOn ? ` — waiting on ${waitingOn.trim()}` : ''}${reason ? `: ${reason.trim()}` : ''}.`, ts: Date.now() }
      ]
    }));
  }, []);

  const unparkRun = useCallback(() => {
    setState(prev => ({
      ...prev,
      runStatus: 'in_progress',
      waitingOn: '',
      waitingReason: '',
      waitingSince: null,
      conversation: [...prev.conversation, { who: 'user', body: 'Review received — continuing.', ts: Date.now() }]
    }));
  }, []);

  // ------------ re-attach project files to a resumed run ------------
  const reattachFiles = useCallback((guidewireBundle) => {
    if (!guidewireBundle) return;
    setState(prev => ({
      ...prev,
      guidewireBundle,
      bundleSummary: buildBundleSummaryForRequest(guidewireBundle, prev.request),
      bundleDescription: describeBundle(guidewireBundle),
      resumeNotes: prev.resumeNotes.filter(n => !n.startsWith('Project files are not re-attached')),
      conversation: [...prev.conversation, { who: 'system', body: 'Project files re-attached.', ts: Date.now() }]
    }));
  }, []);

  // ------------ run a gate that has no artifact yet ------------
  // Only needed after resuming a run whose gate was still running when it
  // was saved (normally impossible — saves skip in-flight calls). Uses the
  // same advance call the gates use.
  const runPendingGate = useCallback(async (gateId) => {
    const s = stateRef.current;
    if (s.readOnly || s.busy || s.artifacts[gateId]) return;
    setState(prev => ({ ...prev, busy: true, error: null, gateStates: { ...prev.gateStates, [gateId]: STATES.REGENERATING } }));
    try {
      const res = await api.agent.advance({
        gate: gateId,
        request: s.request,
        prior_artifacts: s.acceptedArtifacts,
        data_dictionary: groundingFor(s, s.request)
      });
      const usage = normalizeUsage(res.usage);
      setState(prev => ({
        ...prev,
        artifacts: { ...prev.artifacts, [gateId]: res.artifact },
        gateUsage: usage ? { ...prev.gateUsage, [gateId]: usage } : prev.gateUsage,
        gateStates: { ...prev.gateStates, [gateId]: STATES.PROPOSED },
        conversation: [...prev.conversation, { who: 'agent', body: `${res.gate_name || gateId} ready for review.`, ts: Date.now() }],
        busy: false
      }));
    } catch (err) {
      setError(err);
      setState(prev => ({ ...prev, gateStates: { ...prev.gateStates, [gateId]: STATES.PENDING } }));
    }
  }, [setError]);

  const setJiraIssueType = useCallback((issueType) => {
    const next = String(issueType || '').trim();
    if (!next) return;
    setState(prev => ({ ...prev, jiraIssueType: next }));
  }, []);

  const dismissResumeNotes = useCallback(() => {
    setState(prev => ({ ...prev, resumeNotes: [] }));
  }, []);

  // ------------ reset ------------
  const reset = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    setState(initialState);
  }, []);

  return {
    state,
    actions: {
      startRun,
      acceptGate,
      rejectGate,
      editAndAcceptGate,
      recomputeEstimate,
      resumeRun,
      parkRun,
      unparkRun,
      reattachFiles,
      runPendingGate,
      dismissResumeNotes,
      setJiraIssueType,
      reopenGate,
      reset
    }
  };
}

function highestActiveGateId(s) {
  let highest = null;
  for (const id of GATE_ORDER) {
    if (s.gateStates[id] !== STATES.PENDING) highest = id;
  }
  return highest;
}
