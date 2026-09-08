import { useState, useRef, useCallback, useEffect } from 'react';
import { api, newRunId } from '../lib/api.js';
import { STATES } from '../lib/gates.js';
import { buildBundleSummaryForRequest, describeBundle } from '../lib/guidewireArtifactBundle.js';

// useRef for always-fresh values (per established learning — avoids stale closure bugs in persistence)
// Async background save to /api/runs that does not block the UI

const initialState = {
  runId: null,
  request: '',
  // gate state map: { 1: 'pending'|'proposed'|'accepted'|'rejected'|'regenerating', ... }
  gateStates: { 1: STATES.PENDING, 2: STATES.PENDING, 3: STATES.PENDING, 4: STATES.PENDING, 5: STATES.PENDING, 6: STATES.PENDING },
  // artifacts produced — keyed by gate number
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
        current_gate: highestActiveGate(s),
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
    const bundleLines = guidewireBundle ? describeBundle(guidewireBundle) : [];
    setState({
      ...initialState,
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
      gateStates: { ...initialState.gateStates, 1: STATES.REGENERATING },
      busy: true
    });

    try {
      const res = await api.agent.advance({
        gate: 1,
        request: trimmed,
        prior_artifacts: {},
        data_dictionary: guidewireBundle ? buildBundleSummaryForRequest(guidewireBundle, trimmed) : null
      });
      setState(s => ({
        ...s,
        artifacts: { ...s.artifacts, 1: res.artifact },
        gateStates: { ...s.gateStates, 1: STATES.PROPOSED },
        conversation: [...s.conversation, { who: 'agent', body: 'Gate 1 — Request Analysis ready for review.', ts: Date.now() }],
        busy: false
      }));
    } catch (err) {
      setError(err);
    }
  }, [setError]);

  // ------------ accept a gate ------------
  const acceptGate = useCallback(async (gate) => {
    const s = stateRef.current;
    const artifact = s.artifacts[gate];
    if (!artifact) return;

    const newAccepted = { ...s.acceptedArtifacts, [gate]: artifact };
    const newGateStates = { ...s.gateStates, [gate]: STATES.ACCEPTED };

    if (gate < 6) {
      // Advance to next gate
      newGateStates[gate + 1] = STATES.REGENERATING;
      setState(prev => ({
        ...prev,
        acceptedArtifacts: newAccepted,
        gateStates: newGateStates,
        conversation: [
          ...prev.conversation,
          { who: 'user', body: `Approved gate ${gate}.`, ts: Date.now() },
          { who: 'system', body: `Agent advancing to gate ${gate + 1}…`, ts: Date.now() }
        ],
        busy: true,
        error: null
      }));

      try {
        const res = await api.agent.advance({
          gate: gate + 1,
          request: s.request,
          prior_artifacts: newAccepted,
          data_dictionary: s.guidewireBundle ? buildBundleSummaryForRequest(s.guidewireBundle, s.request) : null
        });
        setState(prev => ({
          ...prev,
          artifacts: { ...prev.artifacts, [gate + 1]: res.artifact },
          gateStates: { ...prev.gateStates, [gate + 1]: STATES.PROPOSED },
          conversation: [...prev.conversation, { who: 'agent', body: `Gate ${gate + 1} — ${res.gate_name} ready for review.`, ts: Date.now() }],
          busy: false
        }));
      } catch (err) {
        setError(err);
        setState(prev => ({ ...prev, gateStates: { ...prev.gateStates, [gate + 1]: STATES.PENDING } }));
      }
    } else {
      // Gate 6 accepted — this means the user approved the DRAFT.
      // Now commit to Jira.
      setState(prev => ({
        ...prev,
        acceptedArtifacts: newAccepted,
        gateStates: newGateStates,
        conversation: [
          ...prev.conversation,
          { who: 'user', body: 'Approved gate 6 draft. Raising Jira ticket…', ts: Date.now() }
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
          gateStates: { ...prev.gateStates, 6: STATES.COMMITTED },
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
  const rejectGate = useCallback(async (gate, feedback) => {
    const s = stateRef.current;
    const previous = s.artifacts[gate];

    setState(prev => ({
      ...prev,
      previousArtifacts: { ...prev.previousArtifacts, [gate]: previous },
      gateStates: { ...prev.gateStates, [gate]: STATES.REGENERATING },
      conversation: [
        ...prev.conversation,
        { who: 'user', body: `Rejected gate ${gate}. Feedback: ${feedback}`, ts: Date.now() },
        { who: 'system', body: `Agent regenerating gate ${gate}…`, ts: Date.now() }
      ],
      busy: true,
      error: null
    }));

    try {
      const res = await api.agent.regenerate({
        gate,
        request: s.request,
        prior_artifacts: s.acceptedArtifacts,
        feedback,
        previous_artifact: previous,
        data_dictionary: s.guidewireBundle ? buildBundleSummaryForRequest(s.guidewireBundle, `${s.request} ${feedback}`) : null
      });
      setState(prev => ({
        ...prev,
        artifacts: { ...prev.artifacts, [gate]: res.artifact },
        gateStates: { ...prev.gateStates, [gate]: STATES.PROPOSED },
        conversation: [...prev.conversation, { who: 'agent', body: `Gate ${gate} regenerated.`, ts: Date.now() }],
        busy: false
      }));
    } catch (err) {
      setError(err);
      setState(prev => ({ ...prev, gateStates: { ...prev.gateStates, [gate]: STATES.PROPOSED } }));
    }
  }, [setError]);

  // ------------ edit a gate inline ------------
  // Treats user-edited content as authoritative. Marks accepted with the edited version.
  const editAndAcceptGate = useCallback(async (gate, editedArtifact) => {
    const s = stateRef.current;
    setState(prev => ({
      ...prev,
      previousArtifacts: { ...prev.previousArtifacts, [gate]: prev.artifacts[gate] },
      artifacts: { ...prev.artifacts, [gate]: editedArtifact },
      conversation: [
        ...prev.conversation,
        { who: 'user', body: `Edited gate ${gate} inline. Accepting edited version.`, ts: Date.now() }
      ]
    }));
    // Then accept normally
    await acceptGate(gate);
    // The acceptGate above will pick up the edited artifact because we updated
    // state.artifacts[gate] before calling.
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
      reset
    }
  };
}

function highestActiveGate(s) {
  let highest = 0;
  for (const g of [1, 2, 3, 4, 5, 6]) {
    if (s.gateStates[g] !== STATES.PENDING) highest = g;
  }
  return highest;
}
