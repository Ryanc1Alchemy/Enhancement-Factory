// Mirrors api/_lib/gateOrder.js on the frontend. Gates are identified by
// stable string id, in the ORDER they appear in this array — moving a gate
// is a matter of changing its position here (and in the backend's
// GATE_ORDER), not hunting down hardcoded numbers throughout the app.

export const GATE_ORDER = [
  'request_analysis',
  'scope_definition',
  'design_note',
  'acceptance_criteria',
  'effort_estimate',
  'jira_ticket'
];

export const GATES = [
  { id: 'request_analysis', name: 'Request Analysis', subtitle: 'Decompose the one-line ask. Surface ambiguities — do not silently fill them.' },
  { id: 'scope_definition', name: 'Scope Definition', subtitle: 'In, out, dependencies, integration touchpoints, risks.' },
  { id: 'design_note', name: 'Design Note', subtitle: 'Specific Guidewire entities, typelists, PCFs, Gosu rules, integrations, rating impact.' },
  { id: 'acceptance_criteria', name: 'Acceptance Criteria', subtitle: 'Gherkin: happy path, edge cases, NFRs — produced before sizing so the estimate reflects them.' },
  { id: 'effort_estimate', name: 'Effort Estimate', subtitle: 'Hours by role × location, story points, confidence band — sized against the acceptance criteria.' },
  { id: 'jira_ticket', name: 'Jira Ticket', subtitle: 'Draft payload → real ticket on final approval.' }
];

export function gateNumber(gateId) {
  const idx = GATE_ORDER.indexOf(gateId);
  return idx === -1 ? null : idx + 1;
}

export function nextGateId(gateId) {
  const idx = GATE_ORDER.indexOf(gateId);
  if (idx === -1 || idx === GATE_ORDER.length - 1) return null;
  return GATE_ORDER[idx + 1];
}

export function isLastGate(gateId) {
  return GATE_ORDER[GATE_ORDER.length - 1] === gateId;
}

export const STATES = {
  PENDING: 'pending',
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  REGENERATING: 'regenerating',
  COMMITTED: 'committed'
};
