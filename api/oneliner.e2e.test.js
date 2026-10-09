import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';

// One-line request -> Gates 1-5 through the REAL /api/agent handler, approving
// each gate in turn as a user would -> the Effort Estimate gate returns the
// estimate for every level. Claude is mocked (no API key, no network): the mock
// answers each gate's tool with the artifact a well-behaved agent would produce.

const calls = [];

const CANNED = {
  produce_request_analysis: {
    classified_lob: 'Pet', affected_entities: ['PetBreed typelist'], interpretation: 'Add a Dachshund breed option.',
    assumptions: ['Breed typelist is used by the pet line'], ambiguities: ['Exact typecode value'], confidence: 'medium'
  },
  produce_scope_definition: { in_scope: ['Add Dachshund typecode'], out_of_scope: ['Rating changes'], dependencies: [], risk_flags: [] },
  produce_design_note: {
    approach_summary: 'Extend the breed typelist with a Dachshund typecode.',
    entity_changes: [],
    typelist_changes: [{ typelist: 'PetBreed', change_type: 'extended', new_codes: ['TBC'], certainty: 'required', description: 'Add Dachshund' }],
    pcf_changes: [{ pcf: 'PetDetailsDV', certainty: 'conditional', description: 'Only if a custom value range is used' }],
    gosu_rule_changes: [{ rule_category: 'UW Rule', rule_name: 'BreedEligibility', change_type: 'modified', certainty: 'conditional', description: 'Only if rules list breeds' }],
    integration_changes: [],
    rating_impact: { has_rating_impact: true, certainty: 'conditional', description: 'Only if rated on breed' },
    required_skills: []
  },
  produce_acceptance_criteria: {
    scenarios: [
      { title: 'Dachshund can be selected as the breed on a new pet quote', type: 'happy_path', given: [], when: [], then: [] },
      { title: 'Existing policies with other breeds are unaffected', type: 'edge_case', given: [], when: [], then: [] },
      { title: 'Dachshund is not offered when the pet type is cat', type: 'negative', given: [], when: [], then: [] }
    ],
    non_functional: []
  },
  produce_effort_estimate: {
    complexity_inputs: {
      entity_changes_count: 0, typelist_changes_count: 1, pcf_changes_count: 0, gosu_rule_changes_count: 0,
      integration_changes_count: 0, has_rating_impact: false, overall_complexity: 'simple',
      complexity_evidence: {
        confirmed_by_scenario: [{ scenario_title: 'Dachshund can be selected as the breed on a new pet quote', scenario_type: 'happy_path', impacts: ['typelist_change'], rationale: 'r' }],
        assumptions: ['Breed rating (conditional)']
      }
    },
    narrative: 'One typelist extension.'
  }
};

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    constructor() {
      this.messages = {
        create: async args => {
          const tool = args.tools[0].name;
          calls.push({ tool, messages: JSON.stringify(args.messages) });
          return { id: 'm', stop_reason: 'tool_use', usage: {}, content: [{ type: 'tool_use', id: 't', name: tool, input: CANNED[tool] }] };
        }
      };
    }
  }
}));

const { default: agentHandler } = await import('./agent.js');
const GATES_TO_ESTIMATE = ['request_analysis', 'scope_definition', 'design_note', 'acceptance_criteria', 'effort_estimate'];

async function advance(body) {
  const req = Readable.from([JSON.stringify({ mode: 'advance', ...body })]);
  req.method = 'POST';
  const res = { statusCode: 0, headers: {}, body: '', headersSent: false, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; this.headersSent = true; } };
  await agentHandler(req, res);
  const json = JSON.parse(res.body);
  if (res.statusCode !== 200) throw new Error(`${body.gate}: ${json.error}`);
  return json;
}

// Approve each gate in turn (as the user does in the UI) up to the estimate.
async function approveGatesToEstimate(request) {
  const accepted = {};
  for (const gate of GATES_TO_ESTIMATE) {
    const res = await advance({ gate, request, prior_artifacts: { ...accepted } });
    accepted[gate] = res.artifact;
  }
  return accepted;
}

describe('one-line request -> Effort Estimate gate gives every level (mocked Claude)', () => {
  beforeEach(() => {
    calls.length = 0;
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  });

  it('returns all six levels at the Effort Estimate gate, and only there', async () => {
    const artifacts = await approveGatesToEstimate('add dachshund to petline');
    for (const gate of GATES_TO_ESTIMATE.slice(0, 4)) expect(artifacts[gate].computed_estimate).toBeUndefined();
    expect(calls.map(c => c.tool)).toEqual([
      'produce_request_analysis', 'produce_scope_definition', 'produce_design_note', 'produce_acceptance_criteria', 'produce_effort_estimate'
    ]);
    const ce = artifacts.effort_estimate.computed_estimate;
    expect(ce.estimates_by_grade.map(e => e.grade)).toEqual(['Bronze1', 'Bronze2', 'Silver1', 'Silver2', 'Gold1', 'Gold2']);
    for (let i = 1; i < 6; i++) expect(ce.estimates_by_grade[i].total_hours).toBeLessThan(ce.estimates_by_grade[i - 1].total_hours);

    // The design note's conditional rule/rating were NOT charged as build work
    expect(ce.feature_class).toBe('A_CONFIG_MICRO');
    expect(ce.calculation_trace.design_note_scope).not.toBe('not_supplied');
    const s2 = ce.estimates_by_grade.find(e => e.grade === 'Silver2');
    expect(s2.total_hours).toBeGreaterThan(2);
    expect(s2.total_hours).toBeLessThan(8);
    expect(ce.contingency_drivers.some(d => d.includes('BreedEligibility'))).toBe(true);
  });

  it('gives the estimate gate the approved design note and acceptance criteria', async () => {
    await approveGatesToEstimate('add dachshund to petline');
    const estimateCall = calls.find(c => c.tool === 'produce_effort_estimate');
    expect(estimateCall.messages).toContain('BreedEligibility');
    expect(estimateCall.messages).toContain('Dachshund can be selected as the breed on a new pet quote');
  });
});
