// Tool schemas for the six-gate agent. Each gate has exactly one tool.
// The Jira Ticket gate has TWO tools: produce_jira_payload (draft) and
// raise_jira_ticket (commit). The commit tool is only exposed after explicit
// user approval.
//
// Tools are grouped under comments by GATE ID, not gate number -- gate
// numbers are derived from api/_lib/gateOrder.js's GATE_ORDER position, so
// they are not hardcoded here. See GATE_TOOLS below for the id -> tool(s)
// mapping that the orchestrator actually uses.

import { SKILL_IDS } from './skillsMatrix.js';
import { GATE_ORDER, GATE_ID_NAMES, gateNumber } from './gateOrder.js';

export const TOOLS = {
  // ---------- request_analysis ----------
  produce_request_analysis: {
    name: 'produce_request_analysis',
    description:
      'Produce the request analysis artifact: a structured analysis of a vague enhancement request. ' +
      'Classify the line of business, identify affected Guidewire entities, state your interpretation, ' +
      'list assumptions explicitly, surface ambiguities the human should resolve, and rate your confidence.',
    input_schema: {
      type: 'object',
      properties: {
        classified_lob: {
          type: 'string',
          enum: ['PolicyCenter', 'ClaimCenter', 'BillingCenter', 'Cross-LoB'],
          description: 'The Guidewire core product most affected.'
        },
        sub_lob: {
          type: 'string',
          description:
            'Sub-line of business if applicable (e.g., "Personal Auto", "Workers Compensation", "Direct-bill Commercial"). Empty string if not applicable.'
        },
        affected_entities: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Specific Guidewire domain entities affected (e.g., ["Policy", "PolicyPeriod", "Vehicle", "Coverage"]).'
        },
        interpretation: {
          type: 'string',
          description: 'Your plain-English read of what the client is asking for. 2-4 sentences.'
        },
        assumptions: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Things you assumed to make sense of the request. Be specific (e.g., "US territory", "Personal Auto LoB", "Applies at quote and renewal").'
        },
        ambiguities: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Unresolved questions the human should answer. Each must be a concrete question, not a vague concern.'
        },
        confidence: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Your confidence that the interpretation is correct.'
        }
      },
      required: ['classified_lob', 'affected_entities', 'interpretation', 'assumptions', 'ambiguities', 'confidence']
    }
  },

  // ---------- scope_definition ----------
  produce_scope_definition: {
    name: 'produce_scope_definition',
    description:
      'Produce the scope definition artifact: a hard scope boundary. What is in, what is explicitly out, what depends on what, and which integration touchpoints are involved.',
    input_schema: {
      type: 'object',
      properties: {
        in_scope: {
          type: 'array',
          items: { type: 'string' },
          description: 'Work items that ARE part of this enhancement.'
        },
        out_of_scope: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Explicit exclusions. This is what protects the estimate from scope creep. Be deliberate about what you exclude.'
        },
        dependencies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Pre-requisites that must be true before delivery (e.g., "Vehicle data model includes fuel_type field").'
        },
        integration_touchpoints: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Upstream/downstream systems involved (e.g., "ISO ClueRating", "Internal product catalogue", "Document service"). Empty array if none.'
        },
        risk_flags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific risks worth surfacing now (regulatory, performance, data migration). Empty array if none.'
        }
      },
      required: ['in_scope', 'out_of_scope', 'dependencies', 'integration_touchpoints', 'risk_flags']
    }
  },

  // ---------- design_note ----------
  produce_design_note: {
    name: 'produce_design_note',
    description:
      'Produce the design note artifact: the architectural approach. Specific Guidewire entities, typelists, PCFs, Gosu rules, and integration changes. Written in NTT DATA house style -- specific, not generic.',
    input_schema: {
      type: 'object',
      properties: {
        approach_summary: {
          type: 'string',
          description: '2-4 sentence narrative of the technical approach.'
        },
        entity_changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              entity: { type: 'string', description: 'e.g., "Vehicle"' },
              change_type: { type: 'string', enum: ['new', 'extended', 'modified'] },
              certainty: {
                type: 'string',
                enum: ['required', 'conditional'],
                description:
                  'required = the request cannot be delivered without this change. conditional = only needed if something ' +
                  'unconfirmed turns out to be true (e.g. "if the client rates on breed", "if a custom rule hard-codes values"). ' +
                  'Things to check or regression-test are conditional, not required.'
              },
              description: { type: 'string' }
            },
            required: ['entity', 'change_type', 'certainty', 'description']
          }
        },
        typelist_changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              typelist: { type: 'string', description: 'e.g., "VehicleFuelType"' },
              change_type: { type: 'string', enum: ['new', 'extended'] },
              new_codes: { type: 'array', items: { type: 'string' } },
              certainty: {
                type: 'string',
                enum: ['required', 'conditional'],
                description:
                  'required = the request cannot be delivered without this change. conditional = only needed if something ' +
                  'unconfirmed turns out to be true (e.g. "if the client rates on breed", "if a custom rule hard-codes values"). ' +
                  'Things to check or regression-test are conditional, not required.'
              },
              description: { type: 'string' }
            },
            required: ['typelist', 'change_type', 'certainty', 'description']
          }
        },
        pcf_changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pcf: { type: 'string', description: 'e.g., "PolicyInfoDV.pcf"' },
              certainty: {
                type: 'string',
                enum: ['required', 'conditional'],
                description:
                  'required = the request cannot be delivered without this change. conditional = only needed if something ' +
                  'unconfirmed turns out to be true (e.g. "if the client rates on breed", "if a custom rule hard-codes values"). ' +
                  'Things to check or regression-test are conditional, not required.'
              },
              description: { type: 'string' }
            },
            required: ['pcf', 'certainty', 'description']
          }
        },
        gosu_rule_changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              rule_category: {
                type: 'string',
                description: 'e.g., "Validation Rule", "UW Rule", "Pre-Update Rule", "Activity Pattern", "Assignment Rule"'
              },
              rule_name: { type: 'string' },
              change_type: { type: 'string', enum: ['new', 'modified'] },
              certainty: {
                type: 'string',
                enum: ['required', 'conditional'],
                description:
                  'required = the request cannot be delivered without this change. conditional = only needed if something ' +
                  'unconfirmed turns out to be true (e.g. "if the client rates on breed", "if a custom rule hard-codes values"). ' +
                  'Things to check or regression-test are conditional, not required.'
              },
              description: { type: 'string' }
            },
            required: ['rule_category', 'rule_name', 'change_type', 'certainty', 'description']
          }
        },
        integration_changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              integration: { type: 'string' },
              change_type: { type: 'string', enum: ['new', 'modified'] },
              certainty: {
                type: 'string',
                enum: ['required', 'conditional'],
                description:
                  'required = the request cannot be delivered without this change. conditional = only needed if something ' +
                  'unconfirmed turns out to be true (e.g. "if the client rates on breed", "if a custom rule hard-codes values"). ' +
                  'Things to check or regression-test are conditional, not required.'
              },
              description: { type: 'string' }
            },
            required: ['integration', 'change_type', 'certainty', 'description']
          }
        },
        rating_impact: {
          type: 'object',
          properties: {
            has_rating_impact: { type: 'boolean' },
            certainty: {
              type: 'string',
              enum: ['required', 'conditional', 'none'],
              description:
                'required = the request itself changes premium, rates, factors or discounts. conditional = rating MIGHT be ' +
                'affected depending on unconfirmed client configuration (needs live Rate Management check). none = no rating impact.'
            },
            description: { type: 'string', description: 'If has_rating_impact is true, describe. Else empty string.' }
          },
          required: ['has_rating_impact', 'certainty', 'description']
        },
        required_skills: {
          type: 'array',
          items: { type: 'string', enum: SKILL_IDS },
          description:
            'Every skill from the org\'s controlled skills matrix that is genuinely required to deliver this design. ' +
            'You will be given the full skill list with a "what this means" rubric in the design note instruction -- tag only ' +
            'skills the design note actually calls for, not every skill that could conceivably be relevant. This becomes ' +
            'structured, comparable data across enhancements (and flows into Jira labels), so precision matters ' +
            'more than breadth. Empty array if none of the matrix skills genuinely apply.'
        }
      },
      required: [
        'approach_summary',
        'entity_changes',
        'typelist_changes',
        'pcf_changes',
        'gosu_rule_changes',
        'integration_changes',
        'rating_impact',
        'required_skills'
      ]
    }
  },

  // ---------- acceptance_criteria ----------
  // This gate now runs BEFORE effort_estimate (see api/_lib/gateOrder.js) --
  // acceptance criteria define scope, edge cases, and negative paths that
  // should drive effort sizing, and AC do not themselves need the estimate
  // as an input, so producing them first is the more logical dependency
  // direction.
  produce_acceptance_criteria: {
    name: 'produce_acceptance_criteria',
    description:
      'Produce the acceptance criteria artifact: Gherkin acceptance criteria. Include the happy path and at least two edge cases. ' +
      'Also list non-functional considerations (performance, audit, security) where relevant.',
    input_schema: {
      type: 'object',
      properties: {
        scenarios: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              type: { type: 'string', enum: ['happy_path', 'edge_case', 'negative'] },
              given: { type: 'array', items: { type: 'string' } },
              when: { type: 'array', items: { type: 'string' } },
              then: { type: 'array', items: { type: 'string' } }
            },
            required: ['title', 'type', 'given', 'when', 'then']
          },
          minItems: 3
        },
        non_functional: {
          type: 'array',
          items: { type: 'string' },
          description: 'NFR considerations (performance, audit, security, data retention). Empty array if none.'
        }
      },
      required: ['scenarios', 'non_functional']
    }
  },

  // ---------- effort_estimate ----------
  // The agent calls this tool. The backend then invokes /api/estimate.js with
  // these inputs and decorates the response with the computed hours before
  // persisting. This gate now runs AFTER acceptance_criteria -- the agent is
  // instructed (see api/_lib/prompts/gates.js) to size the work accounting
  // for every acceptance scenario, not just the design note.
  produce_effort_estimate: {
    name: 'produce_effort_estimate',
    description:
      'Produce the effort estimate artifact. You provide the complexity inputs derived from BOTH the design note AND the ' +
      'acceptance criteria already approved for this enhancement -- acceptance criteria define scope, edge cases, and negative ' +
      'paths that should increase effort where they imply additional implementation or test work beyond what the design note ' +
      'alone suggested. The backend will compute the hours by role and location using the AMS Engagement Estimator model, ' +
      'then return the full estimate. You also provide a narrative justification that explicitly references how the ' +
      'acceptance criteria influenced your inputs.',
    input_schema: {
      type: 'object',
      properties: {
        complexity_inputs: {
          type: 'object',
          properties: {
            entity_changes_count: { type: 'integer', minimum: 0 },
            typelist_changes_count: { type: 'integer', minimum: 0 },
            pcf_changes_count: { type: 'integer', minimum: 0 },
            gosu_rule_changes_count: { type: 'integer', minimum: 0 },
            integration_changes_count: { type: 'integer', minimum: 0 },
            has_rating_impact: { type: 'boolean' },
            overall_complexity: {
              type: 'string',
              enum: ['simple', 'medium', 'complex'],
              description:
                'Complexity of the Gosu rule and integration LOGIC. It only scales verified rule/integration work -- ' +
                'never typelist/entity/PCF configuration or QA. Rate it on branching, error handling and data ' +
                'transformation in that logic, not on how many acceptance criteria scenarios exist.'
            },
            complexity_evidence: {
              type: 'object',
              description:
                'Evidence-first breakdown that links complexity inputs to concrete approved acceptance criteria scenarios. ' +
                'Use this to prevent speculative inflation: only count confirmed implementation/test complexity as "confirmed"; ' +
                'put unverified risk into "assumptions" rather than silently inflating counts.',
              properties: {
                confirmed_by_scenario: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      scenario_title: {
                        type: 'string',
                        description: 'Copy the approved acceptance criteria scenario title EXACTLY. The backend verifies it; titles that do not match an approved scenario are discarded.'
                      },
                      scenario_type: { type: 'string', enum: ['happy_path', 'edge_case', 'negative'] },
                      impacts: {
                        type: 'array',
                        items: {
                          type: 'string',
                          enum: [
                            'entity_change',
                            'typelist_change',
                            'pcf_change',
                            'gosu_rule_change',
                            'integration_change',
                            'rating_change',
                            'test_complexity'
                          ]
                        }
                      },
                      rationale: { type: 'string' }
                    },
                    required: ['scenario_title', 'scenario_type', 'impacts', 'rationale']
                  }
                },
                assumptions: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'Potential complexity risks that are plausible but not confirmed by approved artifacts/scenarios. ' +
                    'List them as assumptions instead of treating them as confirmed implementation scope.'
                }
              },
              required: ['confirmed_by_scenario', 'assumptions']
            }
          },
          required: [
            'entity_changes_count',
            'typelist_changes_count',
            'pcf_changes_count',
            'gosu_rule_changes_count',
            'integration_changes_count',
            'has_rating_impact',
            'overall_complexity',
            'complexity_evidence'
          ]
        },
        narrative: {
          type: 'string',
          description:
            'Justification for the complexity inputs. 2-4 sentences referencing BOTH the design note and the specific ' +
            'acceptance criteria scenarios that influenced your counts/complexity rating.'
        }
      },
      required: ['complexity_inputs', 'narrative']
    }
  },

  // ---------- jira_ticket (draft) ----------
  produce_jira_payload: {
    name: 'produce_jira_payload',
    description:
      'Produce the Jira ticket draft artifact: the Jira ticket payload assembled from all prior gates. This does NOT create the ticket -- it only drafts the payload. The user will review and approve before the ticket is actually created.',
    input_schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Concise title-case ticket summary. Max ~120 chars.'
        },
        description: {
          type: 'string',
          description:
            'Full description in Jira-friendly markdown/wiki format. Should include: brief context, scope (in/out), design summary, dependencies. Pull from the scope definition and design note gates.'
        },
        acceptance_criteria_text: {
          type: 'string',
          description: 'Gherkin acceptance criteria already approved for this enhancement, formatted as a single Jira-friendly text block.'
        },
        story_points: {
          type: 'integer',
          enum: [1, 2, 3, 5, 8, 13, 21],
          description:
            'Fibonacci story points, derived from the effort estimate hours. Use mapping: 1-6h=1, 7-12h=2, 13-24h=3, 25-48h=5, 49-96h=8, 97-192h=13, 193+=21.'
        },
        components: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Jira components (e.g., ["PolicyCenter", "Personal Auto", "Rating"]). Derived from the request analysis LoB and design note entity changes.'
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Jira labels. Always include "enhancement-factory" and "ai-generated". Also include every skill ID from ' +
            'the design note\'s required_skills (if any were tagged) so the ticket is filterable/searchable by the skills it needs.'
        },
        issue_type: {
          type: 'string',
          enum: ['Story', 'Task', 'Bug'],
          description: 'Default is Story.'
        }
      },
      required: [
        'summary',
        'description',
        'acceptance_criteria_text',
        'story_points',
        'components',
        'labels',
        'issue_type'
      ]
    }
  },

  // ---------- jira_ticket (commit) ----------
  // Only exposed AFTER the user approves the draft payload.
  // Backend intercepts this call and routes it to /api/jira.js for the real REST call.
  raise_jira_ticket: {
    name: 'raise_jira_ticket',
    description:
      'CREATE THE REAL JIRA TICKET. Only call this when the user has explicitly approved the draft payload from produce_jira_payload. ' +
      'This is the only tool in the agent that has external side effects.',
    input_schema: {
      type: 'object',
      properties: {
        confirmed_by_user: {
          type: 'boolean',
          description: 'Must be true. Set this only when the user has explicitly approved.'
        }
      },
      required: ['confirmed_by_user']
    }
  }
};

// Map gate id -> tool(s) available in that gate. The orchestrator restricts
// Claude to only the tools listed for the active gate. Keyed by stable id
// (see api/_lib/gateOrder.js) rather than number -- gate numbers are derived
// from GATE_ORDER position, not hardcoded here.
export const GATE_TOOLS = {
  request_analysis: ['produce_request_analysis'],
  scope_definition: ['produce_scope_definition'],
  design_note: ['produce_design_note'],
  acceptance_criteria: ['produce_acceptance_criteria'],
  effort_estimate: ['produce_effort_estimate'],
  jira_ticket: ['produce_jira_payload'],
  jira_ticket_commit: ['raise_jira_ticket'] // commit phase -- only after user approves the draft
};

// Human-readable gate names, keyed by id. Re-exported here (sourced from
// gateOrder.js) so existing importers of GATE_NAMES from schemas.js keep working.
export const GATE_NAMES = GATE_ID_NAMES;

export function getToolsForGate(gateId) {
  const toolNames = GATE_TOOLS[gateId] || [];
  return toolNames.map(name => TOOLS[name]);
}

export { GATE_ORDER, gateNumber };
