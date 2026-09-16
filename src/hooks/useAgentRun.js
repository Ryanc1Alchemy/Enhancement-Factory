import { useState, useRef, useCallback, useEffect } from 'react';
import { api, newRunId } from '../lib/api.js';
import { STATES, GATE_ORDER, nextGateId, isLastGate, gateNumber } from '../lib/gates.js';
import { buildBundleSummaryForRequest, describeBundle } from '../lib/guidewireArtifactBundle.js';

// useRef for always-fresh values (per established learning — avoids stale closure bugs in persistence)
// Async background save to /api/runs that does not block the UI

// Current schema version for stored run records. Bumped from the implicit v1
// (numeric gate 1-6 keys, where 4=Effort Estimate and 5=Acceptance Criteria)
// to v2 when gates were re-identified by stable string id and reordered
// (Acceptance Criteria now precedes Effort Estimate). Runs saved without this
// field, or with an older value, are pre-reorder runs and must NOT be
// silently reinterpreted under the new gate meanings — see api/runs.js.
const SCHEMA_VERSION = 2;

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
  conversation: [], // array of { who: 'system'|'user'|'agent', body: string, ts }
  jiraResult: null, // result of /api/runs commit_jira
  guidewireBundle: null, // parsed multi-area Guidewire Studio bundle (optional, attached at start)
  busy: false,
  error: null
};

export function useAgentRun() {
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // ------------ persistence ------------
  const persist = useCallback(async () => {
    const s = stateRef.current;
    if (!s.runId) return;
    try {
      await api.runs.save({
        run_id: s.runId,
        request: s.request,
        schema_version: SCHEMA_VERSION,
        // current_gate is stored as the NUMERIC position for backward
        // compatibility with the existing INT column — but its MEANING is
        // only valid when read alongside schema_version=2 (see api/runs.js).
        // A v1 row with current_gate=4 means "Effort Estimate" (old order);
        // a v2 row with current_gate=4 means "Acceptance Criteria" (new
        // order). Never conflate the two without checking schema_version.
        current_gate: gateNumber(highestActiveGateId(s)) || 0,
        status: s.jiraResult?.commit_result?.mode === 'live' ? 'completed' : 'in_progress',
        artifacts: s.acceptedArtifacts,
        history: s.conversation,
        jira_ticket: s.jiraResult?.commit_result?.ticket?.key || null
      });
    } catch (err) {
      // Non-fatal — agent still works without DB
      // eslint-disable-next-line no-console
      console.warn('Persistence failed (non-fatal):', err.message);
    }
  }, []);

  useEffect(() => {
    if (state.runId) persist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.acceptedArtifacts, state.jiraResult]);

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
    setState({
      ...initialState,
      gateStates: initialGateStates(),
      runId,
      request: trimmed,
      guidewireBundle: guidewireBundle || null,
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
        data_dictionary: guidewireBundle ? buildBundleSummaryForRequest(guidewireBundle, trimmed) : null
      });
      setState(s => ({
        ...s,
        artifacts: { ...s.artifacts, [firstGateId]: res.artifact },
        gateStates: { ...s.gateStates, [firstGateId]: STATES.PROPOSED },
        conversation: [...s.conversation, { who: 'agent', body: 'Gate 1 — Request Analysis ready for review.', ts: Date.now() }],
        busy: false
      }));
    } catch (err) {
      setError(err);
    }
  }, [setError]);

  // ------------ accept a gate ------------
  const acceptGate = useCallback(async (gateId) => {
    const s = stateRef.current;
    const artifact = s.artifacts[gateId];
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
          data_dictionary: s.guidewireBundle ? buildBundleSummaryForRequest(s.guidewireBundle, s.request) : null
        });
        setState(prev => ({
          ...prev,
          artifacts: { ...prev.artifacts, [nextId]: res.artifact },
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
          prior_artifacts: newAccepted
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
        data_dictionary: s.guidewireBundle ? buildBundleSummaryForRequest(s.guidewireBundle, `${s.request} ${feedback}`) : null
      });
      setState(prev => ({
        ...prev,
        artifacts: { ...prev.artifacts, [gateId]: res.artifact },
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
        assumed_delivery_grade: assumedGrade
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
    // Then accept normally
    await acceptGate(gateId);
    // The acceptGate above will pick up the edited artifact because we updated
    // state.artifacts[gateId] before calling.
  }, [acceptGate]);

  // ------------ reset ------------
  const reset = useCallback(() => {
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
