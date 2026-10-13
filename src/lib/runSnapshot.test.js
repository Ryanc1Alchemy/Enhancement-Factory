import { describe, it, expect } from 'vitest';
import {
  toSnapshot, fromSnapshot, snapshotSize, currentGateId, gateNeedingRun, isFinished,
  SNAPSHOT_VERSION, MAX_SNAPSHOT_BYTES
} from './runSnapshot.js';
import { GATE_ORDER, STATES } from './gates.js';

function stateAtGate(n, gateStatus = STATES.PROPOSED) {
  // Gates before n accepted, gate n in gateStatus, rest pending.
  const gateStates = {};
  const artifacts = {};
  const acceptedArtifacts = {};
  GATE_ORDER.forEach((id, i) => {
    if (i < n) {
      gateStates[id] = STATES.ACCEPTED;
      artifacts[id] = { gate: id, v: 1 };
      acceptedArtifacts[id] = artifacts[id];
    } else if (i === n) {
      gateStates[id] = gateStatus;
      if (gateStatus === STATES.PROPOSED) artifacts[id] = { gate: id, v: 2 };
    } else {
      gateStates[id] = STATES.PENDING;
    }
  });
  return {
    runId: 'r1',
    request: 'add dachshund to petline',
    gateStates,
    artifacts,
    acceptedArtifacts,
    previousArtifacts: { request_analysis: { gate: 'request_analysis', v: 0 } },
    conversation: [{ who: 'user', body: 'add dachshund to petline', ts: 1 }],
    jiraResult: null,
    guidewireBundle: { huge: 'x'.repeat(1000) },
    bundleSummary: '## DATA DICTIONARY\nPetBreed ...',
    bundleDescription: ['Data dictionary: 3 entities, 2 typelists'],
    busy: false,
    error: 'old error'
  };
}

describe('toSnapshot / fromSnapshot', () => {
  it('round-trips the run at every gate position', () => {
    for (let n = 0; n < GATE_ORDER.length; n++) {
      const s = stateAtGate(n);
      const restored = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(s))));
      expect(restored.ok).toBe(true);
      expect(restored.state.gateStates).toEqual(s.gateStates);
      expect(restored.state.artifacts).toEqual(s.artifacts);
      expect(restored.state.acceptedArtifacts).toEqual(s.acceptedArtifacts);
      expect(restored.state.previousArtifacts).toEqual(s.previousArtifacts);
      expect(restored.state.conversation).toEqual(s.conversation);
      expect(restored.state.bundleSummary).toBe(s.bundleSummary);
      expect(restored.state.request).toBe(s.request);
      expect(restored.notes).toEqual([]);
    }
  });

  it('keeps the gate under review (proposed, not yet approved)', () => {
    const s = stateAtGate(2); // design note awaiting sign-off
    const r = fromSnapshot(toSnapshot(s));
    expect(r.state.gateStates.design_note).toBe(STATES.PROPOSED);
    expect(r.state.artifacts.design_note).toEqual({ gate: 'design_note', v: 2 });
    expect(r.state.acceptedArtifacts.design_note).toBeUndefined();
  });

  it('does not save the raw project files, busy or error', () => {
    const snap = toSnapshot(stateAtGate(1));
    expect(snap).not.toHaveProperty('guidewireBundle');
    expect(snap).not.toHaveProperty('busy');
    expect(snap).not.toHaveProperty('error');
    expect(snap.snapshot_version).toBe(SNAPSHOT_VERSION);
  });

  it('resets a gate that was still running when saved', () => {
    const withArtifact = stateAtGate(3, STATES.REGENERATING);
    withArtifact.artifacts.acceptance_criteria = { gate: 'acceptance_criteria', v: 1 };
    const a = fromSnapshot(toSnapshot(withArtifact));
    expect(a.state.gateStates.acceptance_criteria).toBe(STATES.PROPOSED);
    expect(a.notes).toHaveLength(1);

    const without = fromSnapshot(toSnapshot(stateAtGate(3, STATES.REGENERATING)));
    expect(without.state.gateStates.acceptance_criteria).toBe(STATES.PENDING);
    expect(gateNeedingRun(without.state.gateStates, without.state.artifacts)).toBe('acceptance_criteria');
  });

  it('refuses unknown formats and missing data', () => {
    expect(fromSnapshot(null).ok).toBe(false);
    expect(fromSnapshot({ snapshot_version: 99, request: 'x' }).ok).toBe(false);
    expect(fromSnapshot({ snapshot_version: SNAPSHOT_VERSION }).ok).toBe(false);
  });

  it('repairs an "approved" gate that has no approved artifact', () => {
    const s = stateAtGate(2);
    delete s.acceptedArtifacts.scope_definition;
    const r = fromSnapshot(toSnapshot(s));
    expect(r.state.gateStates.scope_definition).toBe(STATES.PROPOSED);
    expect(r.notes.length).toBe(1);
  });
});

describe('helpers', () => {
  it('finds the current gate and whether the run is finished', () => {
    expect(currentGateId(stateAtGate(2).gateStates)).toBe('design_note');
    const done = stateAtGate(5);
    done.gateStates.jira_ticket = STATES.COMMITTED;
    expect(currentGateId(done.gateStates)).toBeNull();
    expect(isFinished(done.gateStates)).toBe(true);
    expect(isFinished(stateAtGate(2).gateStates)).toBe(false);
  });

  it('measures snapshot size and the 1 MB limit is far above a normal run', () => {
    const size = snapshotSize(toSnapshot(stateAtGate(4)));
    expect(size).toBeGreaterThan(100);
    expect(size).toBeLessThan(MAX_SNAPSHOT_BYTES / 100);
  });
});
