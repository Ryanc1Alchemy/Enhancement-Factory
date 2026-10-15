// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// Proves save & resume does not change the gates: a run saved after Gate 3,
// "reloaded" and resumed sends the agent exactly the same requests for the
// remaining gates as the same run done without a break.
//
// The real useAgentRun hook is rendered; only the network layer (api.js) is
// faked. No API key, no database.

const advanceCalls = [];
const saves = [];
let savedRow = null;

vi.mock('../lib/api.js', () => ({
  newRunId: () => '11111111-1111-1111-1111-111111111111',
  api: {
    agent: {
      advance: vi.fn(async body => {
        advanceCalls.push(JSON.parse(JSON.stringify(body)));
        return { gate: body.gate, gate_name: body.gate, artifact: { gate: body.gate, content: `artifact for ${body.gate}` } };
      }),
      regenerate: vi.fn(async body => {
        advanceCalls.push(JSON.parse(JSON.stringify({ ...body, mode: 'regenerate' })));
        return { gate: body.gate, gate_name: body.gate, artifact: { gate: body.gate, content: `regenerated ${body.gate}` } };
      }),
      commitJira: vi.fn(async () => ({ commit_result: { mode: 'simulated' } }))
    },
    runs: {
      save: vi.fn(async body => {
        const copy = JSON.parse(JSON.stringify(body));
        saves.push(copy);
        const revision = (savedRow?.revision ?? 0) + 1;
        savedRow = { ...copy, revision, schema_version: copy.schema_version, updated_at: new Date().toISOString() };
        return { ok: true, revision };
      }),
      get: vi.fn(async () => ({ run: { ...savedRow }, is_pre_reorder: false, resumable: Boolean(savedRow?.state) })),
      list: vi.fn(async () => ({ runs: [] }))
    },
    estimate: { compute: vi.fn() }
  }
}));

// Stand-in for parsed project files: the summary builder is the real one.
vi.mock('../lib/guidewireArtifactBundle.js', () => ({
  buildBundleSummaryForRequest: (bundle, text) => `SUMMARY(${bundle.id}) for: ${text}`,
  describeBundle: bundle => [`${bundle.id}: 3 files`]
}));

const { useAgentRun } = await import('./useAgentRun.js');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mountHook() {
  const ref = { current: null };
  function Probe() {
    ref.current = useAgentRun({ saveDelayMs: 0 });
    return null;
  }
  const el = document.createElement('div');
  const root = createRoot(el);
  act(() => root.render(<Probe />));
  return { ref, unmount: () => act(() => root.unmount()) };
}

const tick = () => new Promise(r => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await tick(); });
}

const GATES = ['request_analysis', 'scope_definition', 'design_note', 'acceptance_criteria', 'effort_estimate', 'jira_ticket'];
const BUNDLE = { id: 'petline-project' };
const REQUEST = 'add dachshund to petline';

async function acceptUpTo(ref, n) {
  for (let i = 0; i < n; i++) {
    await act(async () => { await ref.current.actions.acceptGate(GATES[i]); });
    await settle();
  }
}

describe('save & resume leaves the gates unchanged', () => {
  beforeEach(() => {
    advanceCalls.length = 0;
    saves.length = 0;
    savedRow = null;
  });

  it('a run resumed after Gate 3 sends identical agent requests for Gates 4-6', async () => {
    // A: straight through
    const a = mountHook();
    await act(async () => { await a.ref.current.actions.startRun(REQUEST, BUNDLE); });
    await settle();
    await acceptUpTo(a.ref, 5); // accept gates 1-5 -> jira_ticket proposed
    const straight = advanceCalls.slice();
    expect(straight.map(c => c.gate)).toEqual(GATES); // gates 1-6 all called
    a.unmount();

    // B: same run, but leave with Gate 3 (design note) awaiting review, reload, resume
    advanceCalls.length = 0;
    savedRow = null;
    const b1 = mountHook();
    await act(async () => { await b1.ref.current.actions.startRun(REQUEST, BUNDLE); });
    await settle();
    await acceptUpTo(b1.ref, 2); // gates 1-2 approved, design note proposed (awaiting sign-off)
    expect(b1.ref.current.state.gateStates.design_note).toBe('proposed');
    const beforeBreak = advanceCalls.slice();
    b1.unmount(); // browser closed — the parsed project files are gone

    expect(savedRow.state.gateStates.design_note).toBe('proposed'); // gate under review was saved
    expect(savedRow.state).not.toHaveProperty('guidewireBundle');

    advanceCalls.length = 0;
    const b2 = mountHook();
    await act(async () => { await b2.ref.current.actions.resumeRun(savedRow.run_id); });
    await settle();
    expect(b2.ref.current.state.gateStates.design_note).toBe('proposed');
    expect(b2.ref.current.state.artifacts.design_note).toEqual(straight[2] && { gate: 'design_note', content: 'artifact for design_note' });
    expect(b2.ref.current.state.guidewireBundle).toBeNull();

    // carry on: accept gate 3 and onward exactly as in run A
    for (let i = 2; i < 5; i++) {
      await act(async () => { await b2.ref.current.actions.acceptGate(GATES[i]); });
      await settle();
    }
    const resumed = [...beforeBreak, ...advanceCalls];
    b2.unmount();

    expect(resumed).toEqual(straight);
    // and grounding really was present after resume
    expect(resumed.at(-1).data_dictionary).toBe(`SUMMARY(petline-project) for: ${REQUEST}`);
  });

  it('resumed at gate 6, approving jira draft commits successfully', async () => {
    const h1 = mountHook();
    await act(async () => { await h1.ref.current.actions.startRun(REQUEST, BUNDLE); });
    await settle();

    await acceptUpTo(h1.ref, 5); // gates 1-5 accepted; jira_ticket is proposed
    expect(h1.ref.current.state.gateStates.jira_ticket).toBe('proposed');
    expect(h1.ref.current.state.artifacts.jira_ticket).toEqual({ gate: 'jira_ticket', content: 'artifact for jira_ticket' });
    const runId = h1.ref.current.state.runId;
    h1.unmount();

    const h2 = mountHook();
    await act(async () => { await h2.ref.current.actions.resumeRun(runId); });
    await settle();

    expect(h2.ref.current.state.gateStates.jira_ticket).toBe('proposed');
    expect(h2.ref.current.state.readOnly).toBe(false);

    await act(async () => { await h2.ref.current.actions.acceptGate('jira_ticket'); });
    await settle();

    expect(h2.ref.current.state.gateStates.jira_ticket).toBe('committed');
    expect(h2.ref.current.state.jiraResult?.commit_result?.mode).toBe('simulated');
    expect(h2.ref.current.state.readOnly).toBe(false);
    h2.unmount();
  });

  it('saves after a gate settles, never while the agent is working', async () => {
    const h = mountHook();
    await act(async () => { await h.ref.current.actions.startRun(REQUEST, BUNDLE); });
    await settle();
    expect(saves.length).toBeGreaterThan(0);
    for (const s of saves) {
      expect(Object.values(s.state.gateStates)).not.toContain('regenerating');
    }
    expect(saves.at(-1).expected_revision === null || Number.isInteger(saves.at(-1).expected_revision)).toBe(true);
    h.unmount();
  });

  it('parking records who it waits on; unparking clears it', async () => {
    const h = mountHook();
    await act(async () => { await h.ref.current.actions.startRun(REQUEST, null); });
    await settle();
    await act(async () => { h.ref.current.actions.parkRun({ waitingOn: 'Lead architect', reason: 'Design sign-off' }); });
    await settle();
    expect(saves.at(-1).status).toBe('waiting_review');
    expect(saves.at(-1).waiting_on).toBe('Lead architect');
    await act(async () => { h.ref.current.actions.unparkRun(); });
    await settle();
    expect(saves.at(-1).status).toBe('in_progress');
    expect(saves.at(-1).waiting_on).toBeNull();
    h.unmount();
  });

  it('preserves per-gate token usage after park and resume', async () => {
    const h1 = mountHook();
    await act(async () => { await h1.ref.current.actions.startRun(REQUEST, null); });
    await settle();

    // test API mocks do not emit usage; inject representative usage to verify
    // snapshot persistence + resume hydration behavior explicitly.
    h1.ref.current.state.gateUsage.request_analysis = { input_tokens: 2553, output_tokens: 835, total_tokens: 3388 };

    await act(async () => { h1.ref.current.actions.parkRun({ waitingOn: 'test1', reason: 'test 1' }); });
    await settle();

    const runId = h1.ref.current.state.runId;
    h1.unmount();

    const h2 = mountHook();
    await act(async () => { await h2.ref.current.actions.resumeRun(runId); });
    await settle();

    expect(h2.ref.current.state.gateUsage.request_analysis).toEqual({ input_tokens: 2553, output_tokens: 835, total_tokens: 3388 });
    h2.unmount();
  });

  it('a save refused by another tab (409) stops auto-saving and says so', async () => {
    const { api } = await import('../lib/api.js');
    const h = mountHook();
    await act(async () => { await h.ref.current.actions.startRun(REQUEST, null); });
    await settle();
    api.runs.save.mockImplementationOnce(async () => { const e = new Error('Run was changed elsewhere'); e.status = 409; throw e; });
    await act(async () => { await h.ref.current.actions.acceptGate('request_analysis'); });
    await settle();
    expect(h.ref.current.state.saveStatus).toBe('conflict');
    const count = saves.length;
    await act(async () => { await h.ref.current.actions.acceptGate('scope_definition'); });
    await settle();
    expect(saves.length).toBe(count); // no further saves from the stale tab
    h.unmount();
  });

  it('opening a saved run does not save it (so other tabs are not made out of date)', async () => {
    const h = mountHook();
    await act(async () => { await h.ref.current.actions.startRun(REQUEST, null); });
    await settle();
    h.unmount();
    const before = saves.length;
    const h2 = mountHook();
    await act(async () => { await h2.ref.current.actions.resumeRun(savedRow.run_id); });
    await settle();
    expect(saves.length).toBe(before);
    // ...but the first real change is saved, against the loaded revision
    await act(async () => { h2.ref.current.actions.parkRun({ waitingOn: 'QA lead' }); });
    await settle();
    expect(saves.length).toBe(before + 1);
    expect(saves.at(-1).expected_revision).toBe(savedRow.revision - 1);
    h2.unmount();
  });

  it('on focus, a tab whose run was saved elsewhere is marked out of date before any gate runs', async () => {
    const h = mountHook();
    await act(async () => { await h.ref.current.actions.startRun(REQUEST, null); });
    await settle();
    savedRow = { ...savedRow, revision: savedRow.revision + 5 }; // another tab saved since
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await settle();
    expect(h.ref.current.state.saveStatus).toBe('conflict');
    h.unmount();
  });

  it('without a database it stops trying to save after the first reply', async () => {
    const { api } = await import('../lib/api.js');
    const original = api.runs.save.getMockImplementation();
    api.runs.save.mockClear();
    api.runs.save.mockImplementation(async () => ({ db_unavailable: true }));
    const h = mountHook();
    await act(async () => { await h.ref.current.actions.startRun(REQUEST, null); });
    await settle();
    await act(async () => { await h.ref.current.actions.acceptGate('request_analysis'); });
    await settle();
    expect(api.runs.save).toHaveBeenCalledTimes(1);
    expect(h.ref.current.state.saveStatus).toBe('unavailable');
    api.runs.save.mockImplementation(original);
    h.unmount();
  });

  it('a run saved before this feature opens read-only with its approved gates', async () => {
    savedRow = { run_id: 'old', request: 'old run', status: 'in_progress', revision: 0, artifacts: { request_analysis: { x: 1 } }, history: [], state: null };
    const h = mountHook();
    await act(async () => { await h.ref.current.actions.resumeRun('old'); });
    await settle();
    expect(h.ref.current.state.readOnly).toBe(true);
    expect(h.ref.current.state.gateStates.request_analysis).toBe('accepted');
    expect(saves).toHaveLength(0); // read-only runs are never re-saved
    h.unmount();
  });
});
