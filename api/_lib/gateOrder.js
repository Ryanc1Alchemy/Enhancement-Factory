// Single source of truth for gate ORDER and IDENTITY, decoupled from each other.
//
// Gates are identified by a stable string id (e.g. 'acceptance_criteria'), not
// by a number. The displayed/stored gate NUMBER is always derived from a
// gate's position in GATE_ORDER — never hardcoded elsewhere. This means
// re-ordering the workflow (as done here: swapping Acceptance Criteria and
// Effort Estimate) is a one-line change to this array, rather than a hunt
// through every file that assumed "gate number == step position".
//
// Historical note: prior to this change, every part of the app (schemas,
// prompts, agent.js, the frontend state machine, the UI) keyed gates by raw
// number 1-6, and gate 4 was always "Effort Estimate". This file replaces
// that numeric keying with ids; api/_lib/schemas.js, api/_lib/prompts/gates.js,
// api/agent.js, src/lib/gates.js, and src/hooks/useAgentRun.js all derive
// their gate numbers from this array instead of hardcoding them.

export const GATE_ORDER = [
  'request_analysis',
  'scope_definition',
  'design_note',
  'acceptance_criteria',
  'effort_estimate',
  'jira_ticket'
];

// Human-readable names, keyed by id (not number).
export const GATE_ID_NAMES = {
  request_analysis: 'Request Analysis',
  scope_definition: 'Scope Definition',
  design_note: 'Design Note',
  acceptance_criteria: 'Acceptance Criteria',
  effort_estimate: 'Effort Estimate',
  jira_ticket: 'Jira Ticket'
};

// Gate id -> 1-based position (i.e. the displayed/stored gate number).
export function gateNumber(gateId) {
  const idx = GATE_ORDER.indexOf(gateId);
  return idx === -1 ? null : idx + 1;
}

// 1-based position -> gate id. Returns null for out-of-range numbers.
export function gateIdForNumber(num) {
  const idx = num - 1;
  return GATE_ORDER[idx] || null;
}

export function isLastGate(gateId) {
  return GATE_ORDER[GATE_ORDER.length - 1] === gateId;
}

export function nextGateId(gateId) {
  const idx = GATE_ORDER.indexOf(gateId);
  if (idx === -1 || idx === GATE_ORDER.length - 1) return null;
  return GATE_ORDER[idx + 1];
}

// Returns true if `candidateId` comes strictly before `referenceId` in the
// gate order — used wherever code previously compared raw numbers
// (e.g. `g < gate`) to determine what counts as "prior" context.
export function isBefore(candidateId, referenceId) {
  const ci = GATE_ORDER.indexOf(candidateId);
  const ri = GATE_ORDER.indexOf(referenceId);
  if (ci === -1 || ri === -1) return false;
  return ci < ri;
}

// Current schema version for stored run records. Bump this whenever the
// meaning of artifact keys changes (e.g. this reorder, which changes what
// "gate 4" and "gate 5" mean). Runs saved under an older/missing version are
// assumed to use the PRE-REORDER numeric meaning (4=Effort Estimate,
// 5=Acceptance Criteria) and must never be silently reinterpreted under the
// new ordering — see api/runs.js and src/hooks/useAgentRun.js.
export const CURRENT_SCHEMA_VERSION = 2;
