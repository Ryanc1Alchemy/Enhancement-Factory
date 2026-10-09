import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';

// End-to-end check of the Gate 4 path through /api/agent and /api/estimate,
// with the Anthropic SDK mocked so no network call or API key is needed.

let lastCreateArgs;
let nextToolInput;

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    constructor() {
      this.messages = {
        create: async args => {
          lastCreateArgs = args;
          return {
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 't1', name: 'produce_effort_estimate', input: nextToolInput }]
          };
        }
      };
    }
  }
}));

const { default: agentHandler } = await import('./agent.js');
const { default: estimateHandler } = await import('./estimate.js');

function fakeReq(body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  return req;
}
function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b; this.headersSent = true; }
  };
}
async function call(handler, body) {
  const res = fakeRes();
  await handler(fakeReq(body), res);
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

const approvedAC = {
  scenarios: [
    { title: 'New breed is selectable on the pet details screen', type: 'happy_path', given: [], when: [], then: [] },
    { title: 'Existing policies with other breeds are unaffected', type: 'edge_case', given: [], when: [], then: [] }
  ],
  non_functional: []
};

// The agent pads a typelist add with a "validation rule" citing a scenario
// that is NOT in the approved acceptance criteria.
const paddedToolInput = {
  complexity_inputs: {
    entity_changes_count: 0,
    typelist_changes_count: 1,
    pcf_changes_count: 0,
    gosu_rule_changes_count: 1,
    integration_changes_count: 0,
    has_rating_impact: false,
    overall_complexity: 'medium',
    complexity_evidence: {
      confirmed_by_scenario: [
        { scenario_title: 'New breed is selectable on the pet details screen', scenario_type: 'happy_path', impacts: ['typelist_change'], rationale: 'r' },
        { scenario_title: 'Unsupported breed is rejected by validation', scenario_type: 'negative', impacts: ['gosu_rule_change'], rationale: 'r' }
      ],
      assumptions: []
    }
  },
  narrative: 'test'
};

describe('Gate 4 end-to-end (mocked Claude)', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    nextToolInput = paddedToolInput;
  });

  it('verifies evidence against the approved AC passed as prior_artifacts and discards the invented rule', async () => {
    const { status, json } = await call(agentHandler, {
      mode: 'advance',
      gate: 'effort_estimate',
      request: 'add dachshund to petline',
      prior_artifacts: { acceptance_criteria: approvedAC }
    });
    expect(status).toBe(200);
    const ce = json.artifact.computed_estimate;
    expect(ce.estimator_version).toBe('v3');
    expect(ce.calculation_trace.evidence_verification.mode).toBe('verified_against_acceptance_criteria');
    expect(ce.calculation_trace.evidence_verification.dropped_entries).toHaveLength(1);
    expect(ce.calculation_trace.verified_counts.gosu).toBe(0);
    expect(ce.feature_class).toBe('A_CONFIG_MICRO');
    expect(ce.total_hours).toBeLessThanOrEqual(8);
    expect(ce.p80_hours).toBeGreaterThan(ce.total_hours);
    expect(ce.story_points).toBe(1);
  });

  it('sends the de-inflated prompt and the rating_change impact type to Claude', async () => {
    await call(agentHandler, {
      mode: 'advance',
      gate: 'effort_estimate',
      request: 'add dachshund to petline',
      prior_artifacts: { acceptance_criteria: approvedAC }
    });
    expect(lastCreateArgs.system).toMatch(/Overestimating is scored as an error/);
    const userText = JSON.stringify(lastCreateArgs.messages);
    expect(userText).toMatch(/a scenario never adds a change count by itself/);
    const impactsEnum =
      lastCreateArgs.tools[0].input_schema.properties.complexity_inputs.properties.complexity_evidence
        .properties.confirmed_by_scenario.items.properties.impacts.items.enum;
    expect(impactsEnum).toContain('rating_change');
  });

  it('/api/estimate grade recompute verifies evidence when acceptance_criteria is sent', async () => {
    const { status, json } = await call(estimateHandler, {
      complexity_inputs: { ...paddedToolInput.complexity_inputs, assumed_delivery_grade: 'Bronze1' },
      acceptance_criteria: approvedAC
    });
    expect(status).toBe(200);
    expect(json.assumed_delivery_grade).toBe('Bronze1');
    expect(json.calculation_trace.verified_counts.gosu).toBe(0);
  });

  it('/api/estimate still works without acceptance_criteria (old clients) and says evidence was unverified', async () => {
    const { status, json } = await call(estimateHandler, { complexity_inputs: paddedToolInput.complexity_inputs });
    expect(status).toBe(200);
    expect(json.calculation_trace.evidence_verification.mode).toBe('unverified_no_acceptance_criteria_supplied');
  });
});
