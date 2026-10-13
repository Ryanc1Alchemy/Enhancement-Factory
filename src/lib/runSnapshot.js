// Run snapshots for save & resume.
//
// A snapshot is a plain-JSON copy of the parts of a run that matter for
// carrying on later: which gate each one is at, every artifact (proposed and
// accepted), the diff history, the conversation, the Jira result and the
// project grounding SUMMARY. Resuming loads it back into the exact state the
// gates already work from — the gate logic itself never changes.
//
// Deliberately NOT saved:
//   - busy / error          (transient UI state)
//   - guidewireBundle       (the parsed project files: large, not cleanly
//                            serialisable, and never sent to the agent —
//                            the agent only ever receives the text summary
//                            built from it, which IS saved as bundleSummary)
//
// No React, no network — unit-tested in runSnapshot.test.js.

import { GATE_ORDER, STATES } from './gates.js';

export const SNAPSHOT_VERSION = 1;

// Saves larger than this are refused (well under Vercel's 4.5 MB request
// limit). Realistic runs are tens of KB; this only trips on huge pasted notes.
export const MAX_SNAPSHOT_BYTES = 1024 * 1024;

/**
 * Build a snapshot from the hook's state.
 * @param {object} state  useAgentRun state
 * @returns {object} plain JSON snapshot
 */
export function toSnapshot(state) {
  return {
    snapshot_version: SNAPSHOT_VERSION,
    request: state.request,
    gateStates: { ...state.gateStates },
    artifacts: { ...state.artifacts },
    acceptedArtifacts: { ...state.acceptedArtifacts },
    previousArtifacts: { ...state.previousArtifacts },
    conversation: [...(state.conversation || [])],
    jiraResult: state.jiraResult || null,
    bundleSummary: state.bundleSummary || null,
    bundleDescription: Array.isArray(state.bundleDescription) ? [...state.bundleDescription] : []
  };
}

/** Size of a snapshot in bytes, as it would be sent to the server. */
export function snapshotSize(snapshot) {
  return new TextEncoder().encode(JSON.stringify(snapshot)).length;
}

/**
 * Turn a saved snapshot back into hook state fields.
 * Normalises anything that was mid-flight (a gate cannot be "regenerating"
 * after a reload, because the agent call it was waiting for is gone).
 *
 * @param {object} snapshot
 * @returns {{ ok: true, state: object, notes: string[] } | { ok: false, reason: string }}
 */
export function fromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { ok: false, reason: 'No saved state for this run.' };
  }
  if (snapshot.snapshot_version !== SNAPSHOT_VERSION) {
    return { ok: false, reason: `Saved with an unsupported format (version ${snapshot.snapshot_version ?? 'unknown'}).` };
  }
  if (!snapshot.request || typeof snapshot.request !== 'string') {
    return { ok: false, reason: 'Saved run has no request text.' };
  }

  const notes = [];
  const artifacts = { ...(snapshot.artifacts || {}) };
  const acceptedArtifacts = { ...(snapshot.acceptedArtifacts || {}) };
  const gateStates = {};

  for (const id of GATE_ORDER) {
    let st = snapshot.gateStates?.[id] || STATES.PENDING;
    if (st === STATES.REGENERATING) {
      st = artifacts[id] ? STATES.PROPOSED : STATES.PENDING;
      notes.push(`Gate "${id}" was still running when saved; it has been reset to ${st}.`);
    }
    if (st === STATES.ACCEPTED && !acceptedArtifacts[id]) {
      // Defensive: an "accepted" gate must have its accepted artifact.
      st = artifacts[id] ? STATES.PROPOSED : STATES.PENDING;
      notes.push(`Gate "${id}" was marked approved without its artifact; it has been reset to ${st}.`);
    }
    gateStates[id] = st;
  }

  return {
    ok: true,
    notes,
    state: {
      request: snapshot.request,
      gateStates,
      artifacts,
      acceptedArtifacts,
      previousArtifacts: { ...(snapshot.previousArtifacts || {}) },
      conversation: Array.isArray(snapshot.conversation) ? [...snapshot.conversation] : [],
      jiraResult: snapshot.jiraResult || null,
      bundleSummary: snapshot.bundleSummary || null,
      bundleDescription: Array.isArray(snapshot.bundleDescription) ? [...snapshot.bundleDescription] : []
    }
  };
}

/** The gate the run is currently at (first gate that is not accepted/committed), or null when finished. */
export function currentGateId(gateStates) {
  for (const id of GATE_ORDER) {
    const st = gateStates?.[id];
    if (st !== STATES.ACCEPTED && st !== STATES.COMMITTED) return id;
  }
  return null;
}

/** A gate that has a pending gate with no artifact and nothing running needs a "Run this gate" action. */
export function gateNeedingRun(gateStates, artifacts) {
  const id = currentGateId(gateStates);
  if (!id) return null;
  return gateStates[id] === STATES.PENDING && !artifacts?.[id] ? id : null;
}

/** True once the Jira ticket was raised — such runs open read-only. */
export function isFinished(gateStates) {
  return gateStates?.[GATE_ORDER[GATE_ORDER.length - 1]] === STATES.COMMITTED;
}
