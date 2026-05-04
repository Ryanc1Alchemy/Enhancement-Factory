// Tool schemas for the six-gate agent. Each gate has exactly one tool.
// Gate 6 has TWO tools: produce_jira_payload (draft) and raise_jira_ticket (commit).
// The commit tool is only exposed after explicit user approval.

export const TOOLS = {
  // ---------- Gate 1 ----------
  produce_request_analysis: {
    name: 'produce_request_analysis',
    description:
      'Produce the gate 1 artifact: a structured analysis of a vague enhancement request. ' +
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

  // ---------- Gate 2 ----------
  produce_scope_definition: {
    name: 'produce_scope_definition',
    description:
      'Produce the gate 2 artifact: a hard scope boundary. What is in, what is explicitly out, what depends on what, and which integration touchpoints are involved.',
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

  // ---------- Gate 3 ----------
  produce_design_note: {
    name: 'produce_design_note',
    description:
      'Produce the gate 3 artifact: the architectural approach. Specific Guidewire entities, typelists, PCFs, Gosu rules, and integration changes. Written in NTT DATA house style — specific, not generic.',
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
              description: { type: 'string' }
            },
            required: ['entity', 'change_type', 'description']
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
              description: { type: 'string' }
            },
            required: ['typelist', 'change_type', 'description']
          }
        },
        pcf_changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pcf: { type: 'string', description: 'e.g., "PolicyInfoDV.pcf"' },
              description: { type: 'string' }
            },
            required: ['pcf', 'description']
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
              description: { type: 'string' }
            },
            required: ['rule_category', 'rule_name', 'change_type', 'description']
          }
        },
        integration_changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              integration: { type: 'string' },
              change_type: { type: 'string', enum: ['new', 'modified'] },
              description: { type: 'string' }
            },
            required: ['integration', 'change_type', 'description']
          }
        },
        rating_impact: {
          type: 'object',
          properties: {
            has_rating_impact: { type: 'boolean' },
            description: { type: 'string', description: 'If has_rating_impact is true, describe. Else empty string.' }
          },
          required: ['has_rating_impact', 'description']
        }
      },
      required: [
        'approach_summary',
        'entity_changes',
        'typelist_changes',
        'pcf_changes',
        'gosu_rule_changes',
        'integration_changes',
        'rating_impact'
      ]
    }
  },

  // ---------- Gate 4 ----------
  // The agent calls this tool. The backend then invokes /api/estimate.js with these
  // inputs and decorates the response with the computed hours before persisting.
  produce_effort_estimate: {
    name: 'produce_effort_estimate',
    description:
      'Produce the gate 4 artifact: the effort estimate. You provide the complexity inputs derived from the design note. ' +
      'The backend will compute the hours by role and location using the AMS Engagement Estimator model, then return the full estimate. ' +
      'You also provide a narrative justification.',
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
              description: 'Your subjective complexity rating, used as a multiplier.'
            }
          },
          required: [
            'entity_changes_count',
            'typelist_changes_count',
            'pcf_changes_count',
            'gosu_rule_changes_count',
            'integration_changes_count',
            'has_rating_impact',
            'overall_complexity'
          ]
        },
        narrative: {
          type: 'string',
          description: 'Justification for the complexity inputs. 2-4 sentences referencing the design note.'
        }
      },
      required: ['complexity_inputs', 'narrative']
    }
  },

  // ---------- Gate 5 ----------
  produce_acceptance_criteria: {
    name: 'produce_acceptance_criteria',
    description:
      'Produce the gate 5 artifact: Gherkin acceptance criteria. Include the happy path and at least two edge cases. ' +
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

  // ---------- Gate 6 (draft) ----------
  produce_jira_payload: {
    name: 'produce_jira_payload',
    description:
      'Produce the gate 6 draft artifact: the Jira ticket payload assembled from gates 1-5. This does NOT create the ticket — it only drafts the payload. The user will review and approve before the ticket is actually created.',
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
            'Full description in Jira-friendly markdown/wiki format. Should include: brief context, scope (in/out), design summary, dependencies. Pull from gates 2 and 3.'
        },
        acceptance_criteria_text: {
          type: 'string',
          description: 'Gherkin acceptance criteria from gate 5, formatted as a single Jira-friendly text block.'
        },
        story_points: {
          type: 'integer',
          enum: [1, 2, 3, 5, 8, 13, 21],
          description:
            'Fibonacci story points, derived from gate 4 hours. Use mapping: 1-6h=1, 7-12h=2, 13-24h=3, 25-48h=5, 49-96h=8, 97-192h=13, 193+=21.'
        },
        components: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Jira components (e.g., ["PolicyCenter", "Personal Auto", "Rating"]). Derived from gate 1 LoB and gate 3 entity changes.'
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Jira labels. Always include "enhancement-factory" and "ai-generated".'
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

  // ---------- Gate 6 (commit) ----------
  // Only exposed AFTER the user approves the gate 6 draft payload.
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

// Map gate number → tool(s) available in that gate.
// The orchestrator restricts Claude to only the tools listed for the active gate.
export const GATE_TOOLS = {
  1: ['produce_request_analysis'],
  2: ['produce_scope_definition'],
  3: ['produce_design_note'],
  4: ['produce_effort_estimate'],
  5: ['produce_acceptance_criteria'],
  6: ['produce_jira_payload'],
  6.5: ['raise_jira_ticket'] // commit phase — only after user approves the draft
};

export const GATE_NAMES = {
  1: 'Request Analysis',
  2: 'Scope Definition',
  3: 'Design Note',
  4: 'Effort Estimate',
  5: 'Acceptance Criteria',
  6: 'Jira Ticket'
};

export function getToolsForGate(gate) {
  const toolNames = GATE_TOOLS[gate] || [];
  return toolNames.map(name => TOOLS[name]);
}
