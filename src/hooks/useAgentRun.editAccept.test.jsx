// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// "Save and accept" (Edit modal) must approve the BA's EDITED artifact and pass
// it to the next gate. Previously the edit was set in state and acceptGate ran
// immediately after, reading the not-yet-updated state — so the original
// artifact was approved and the edit was silently dropped.

const calls = [];
let commitBody = null;

vi.mock('../lib/api.js', () => ({
  newRunId: () => 'run-1',
  api: {
    agent: {
      advance: vi.fn(async b => {
        calls.push(JSON.parse(JSON.stringify(b)));
        return { gate: b.gate, gate_name: b.gate, artifact: { gate: b.gate, text: `original ${b.gate}` } };
      }),
      commitJira: vi.fn(async b => {
        commitBody = JSON.parse(JSON.stringify(b));
        return { commit_result: { mode: 'simulated', simulated_ticket: { key: 'GWDEMO-XXXX' } } };
      })
    },
    runs: { save: vi.fn(async () => ({ db_unavailable: true })) },
    estimate: { compute: vi.fn() }
  }
}));

const { useAgentRun } = await import('./useAgentRun.js');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GATES = ['request_analysis', 'scope_definition', 'design_note', 'acceptance_criteria', 'effort_estimate', 'jira_ticket'];

function mount() {
  const ref = {};
  function Probe() { ref.current = useAgentRun(); return null; }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<Probe />));
  return { ref, unmount: () => act(() => root.unmount()) };
}

describe('Save and accept keeps the BA\'s edit', () => {
  beforeEach(() => { calls.length = 0; commitBody = null; });

  it('approves the edited artifact and sends it to the next gate', async () => {
    const { ref, unmount } = mount();
    await act(async () => { await ref.current.actions.startRun('add dachshund to petline', null); });
    const edited = { gate: 'request_analysis', text: 'EDITED BY BA' };
    await act(async () => { await ref.current.actions.editAndAcceptGate('request_analysis', edited); });

    const next = calls.find(c => c.gate === 'scope_definition');
    expect(next.prior_artifacts.request_analysis).toEqual(edited);
    expect(ref.current.state.acceptedArtifacts.request_analysis).toEqual(edited);
    expect(ref.current.state.artifacts.request_analysis).toEqual(edited);
    expect(ref.current.state.gateStates.request_analysis).toBe('accepted');
    // the original is kept for the before/after view
    expect(ref.current.state.previousArtifacts.request_analysis).toEqual({ gate: 'request_analysis', text: 'original request_analysis' });
    unmount();
  });

  it('keeps an edit made mid-way (design note) for every later gate', async () => {
    const { ref, unmount } = mount();
    await act(async () => { await ref.current.actions.startRun('x', null); });
    await act(async () => { await ref.current.actions.acceptGate('request_analysis'); });
    await act(async () => { await ref.current.actions.acceptGate('scope_definition'); });
    const edited = { gate: 'design_note', text: 'EDITED DESIGN' };
    await act(async () => { await ref.current.actions.editAndAcceptGate('design_note', edited); });
    await act(async () => { await ref.current.actions.acceptGate('acceptance_criteria'); });

    for (const gate of ['acceptance_criteria', 'effort_estimate']) {
      const call = calls.find(c => c.gate === gate);
      expect(call.prior_artifacts.design_note).toEqual(edited);
    }
    unmount();
  });

  it('an edited Jira draft is what gets raised', async () => {
    const { ref, unmount } = mount();
    await act(async () => { await ref.current.actions.startRun('x', null); });
    for (const g of GATES.slice(0, 5)) {
      await act(async () => { await ref.current.actions.acceptGate(g); });
    }
    const editedDraft = { gate: 'jira_ticket', text: 'EDITED SUMMARY' };
    await act(async () => { await ref.current.actions.editAndAcceptGate('jira_ticket', editedDraft); });
    expect(commitBody.prior_artifacts.jira_ticket).toEqual(editedDraft);
    unmount();
  });

  it('plain Accept still approves the proposed artifact unchanged', async () => {
    const { ref, unmount } = mount();
    await act(async () => { await ref.current.actions.startRun('x', null); });
    await act(async () => { await ref.current.actions.acceptGate('request_analysis'); });
    const next = calls.find(c => c.gate === 'scope_definition');
    expect(next.prior_artifacts.request_analysis).toEqual({ gate: 'request_analysis', text: 'original request_analysis' });
    unmount();
  });
});
