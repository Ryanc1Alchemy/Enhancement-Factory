// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const calls = [];

vi.mock('../lib/api.js', () => ({
  newRunId: () => 'run-1',
  api: {
    agent: {
      advance: vi.fn(async b => {
        calls.push(JSON.parse(JSON.stringify(b)));
        return { gate: b.gate, gate_name: b.gate, artifact: { gate: b.gate, text: `artifact ${b.gate}` } };
      }),
      regenerate: vi.fn(async b => ({ gate: b.gate, gate_name: b.gate, artifact: { gate: b.gate, text: `regen ${b.gate}` } })),
      commitJira: vi.fn(async b => ({ commit_result: { mode: 'simulated', simulated_ticket: { key: 'GWDEMO-1234' }, input: b } }))
    },
    runs: { save: vi.fn(async () => ({ db_unavailable: true })) },
    estimate: { compute: vi.fn() }
  }
}));

const { useAgentRun } = await import('./useAgentRun.js');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  const ref = {};
  function Probe() { ref.current = useAgentRun(); return null; }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<Probe />));
  return { ref, unmount: () => act(() => root.unmount()) };
}

describe('reopen gate flow', () => {
  beforeEach(() => { calls.length = 0; });

  it('reopens an accepted gate and clears downstream state/artifacts', async () => {
    const { ref, unmount } = mount();

    await act(async () => { await ref.current.actions.startRun('x', null); });
    await act(async () => { await ref.current.actions.acceptGate('request_analysis'); });
    await act(async () => { await ref.current.actions.acceptGate('scope_definition'); });
    await act(async () => { await ref.current.actions.acceptGate('design_note'); });

    expect(ref.current.state.gateStates.request_analysis).toBe('accepted');
    expect(ref.current.state.gateStates.scope_definition).toBe('accepted');
    expect(ref.current.state.gateStates.design_note).toBe('accepted');
    expect(ref.current.state.gateStates.acceptance_criteria).toBe('proposed');

    await act(async () => { ref.current.actions.reopenGate('scope_definition'); });

    expect(ref.current.state.gateStates.scope_definition).toBe('proposed');
    expect(ref.current.state.gateStates.design_note).toBe('pending');
    expect(ref.current.state.gateStates.acceptance_criteria).toBe('pending');
    expect(ref.current.state.gateStates.effort_estimate).toBe('pending');
    expect(ref.current.state.gateStates.jira_ticket).toBe('pending');

    expect(ref.current.state.acceptedArtifacts.scope_definition).toBeUndefined();
    expect(ref.current.state.acceptedArtifacts.design_note).toBeUndefined();
    expect(ref.current.state.artifacts.design_note).toBeUndefined();
    expect(ref.current.state.artifacts.acceptance_criteria).toBeUndefined();

    unmount();
  });
});
