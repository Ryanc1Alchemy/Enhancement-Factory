export const GATES = [
  { num: 1, name: 'Request Analysis', subtitle: 'Decompose the one-line ask. Surface ambiguities — do not silently fill them.' },
  { num: 2, name: 'Scope Definition', subtitle: 'In, out, dependencies, integration touchpoints, risks.' },
  { num: 3, name: 'Design Note', subtitle: 'Specific Guidewire entities, typelists, PCFs, Gosu rules, integrations, rating impact.' },
  { num: 4, name: 'Effort Estimate', subtitle: 'Hours by role × location, story points, confidence band.' },
  { num: 5, name: 'Acceptance Criteria', subtitle: 'Gherkin: happy path, edge cases, NFRs.' },
  { num: 6, name: 'Jira Ticket', subtitle: 'Draft payload → real ticket on final approval.' }
];

export const STATES = {
  PENDING: 'pending',
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  REGENERATING: 'regenerating',
  COMMITTED: 'committed'
};
