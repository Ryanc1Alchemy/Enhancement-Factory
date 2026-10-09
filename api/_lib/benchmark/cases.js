// ============================================================
// Gate 4 estimator benchmark suite
// ============================================================
// Each case freezes the complexity_inputs the agent would produce at Gate 4
// plus the APPROVED acceptance criteria scenarios, so the deterministic
// estimator can be scored without calling the LLM.
//
// ref_s2 = reference P50 total hours at Silver2.
// ref_source = 'provisional' means EXPERT JUDGEMENT FROM THE CALIBRATION REPORT,
// NOT ACTUALS. Replace with the median of 2-3 independent Gold-level estimates
// (ref_source: 'panel'), then with logged Jira hours (ref_source: 'actual').
// The v3 coefficients were tuned with these provisional references in view, so
// scores against them are optimistic until a panel re-baselines them.
//
// baseline_master_s2 / baseline_v2_s2: FROZEN Silver2 totals from the
// estimator on master (deployed) and the uncommitted v2 calibration attempt,
// recorded 2026-10-09 so the benchmark can show before/after without keeping
// the old estimator code.
//
// padding_of: marks a case as a verbose/padded variant of another case with
// the SAME real scope. Used to measure sensitivity to scenario padding and to
// self-certified evidence.
// ============================================================

const sc = (type, title) => ({ title, type, given: [], when: [], then: [] });
const ev = (title, type, impacts) => ({ scenario_title: title, scenario_type: type, impacts, rationale: 'benchmark' });
const base = {
  entity_changes_count: 0,
  typelist_changes_count: 0,
  pcf_changes_count: 0,
  gosu_rule_changes_count: 0,
  integration_changes_count: 0,
  has_rating_impact: false,
  overall_complexity: 'simple'
};

export const BENCHMARK_CASES = [
  {
    id: 'typelist-add',
    label: 'Add one typecode (e.g. "add dachshund to petline")',
    ref_s2: 4,
    ref_source: 'provisional',
    baseline_master_s2: 6.6,
    baseline_v2_s2: 4.7,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'New breed is selectable on the pet details screen'),
        sc('edge_case', 'Existing policies with other breeds are unaffected'),
        sc('edge_case', 'Retired typecodes remain hidden from the dropdown')
      ]
    },
    inputs: {
      ...base,
      typelist_changes_count: 1,
      complexity_evidence: {
        confirmed_by_scenario: [ev('New breed is selectable on the pet details screen', 'happy_path', ['typelist_change'])],
        assumptions: []
      }
    }
  },
  {
    id: 'typelist-add-verbose',
    label: 'Same typecode add, 3x the acceptance criteria and complexity drifted to medium',
    padding_of: 'typelist-add',
    ref_s2: 4,
    ref_source: 'provisional',
    baseline_master_s2: 7,
    baseline_v2_s2: 5.3,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'New breed is selectable on the pet details screen'),
        sc('edge_case', 'Existing policies with other breeds are unaffected'),
        sc('edge_case', 'Retired typecodes remain hidden from the dropdown'),
        sc('edge_case', 'New breed appears in the correct sort order'),
        sc('negative', 'Quote cannot bind with a blank breed'),
        sc('edge_case', 'Policy change on an in-force policy offers the new breed'),
        sc('negative', 'Renewal of a policy with the new breed does not error')
      ]
    },
    inputs: {
      ...base,
      typelist_changes_count: 1,
      overall_complexity: 'medium',
      complexity_evidence: {
        confirmed_by_scenario: [
          ev('New breed is selectable on the pet details screen', 'happy_path', ['typelist_change']),
          ev('Quote cannot bind with a blank breed', 'negative', ['test_complexity']),
          ev('Renewal of a policy with the new breed does not error', 'negative', ['test_complexity'])
        ],
        assumptions: ['Possible downstream rating impact by breed']
      }
    }
  },
  {
    id: 'typelist-add-self-certified-rule',
    label: 'Same typecode add, agent claims a validation rule citing a scenario that is NOT in the approved AC',
    padding_of: 'typelist-add',
    ref_s2: 4,
    ref_source: 'provisional',
    baseline_master_s2: 15.1,
    baseline_v2_s2: 13.1,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'New breed is selectable on the pet details screen'),
        sc('edge_case', 'Existing policies with other breeds are unaffected'),
        sc('edge_case', 'Retired typecodes remain hidden from the dropdown')
      ]
    },
    inputs: {
      ...base,
      typelist_changes_count: 1,
      pcf_changes_count: 0,
      gosu_rule_changes_count: 1,
      complexity_evidence: {
        confirmed_by_scenario: [
          ev('New breed is selectable on the pet details screen', 'happy_path', ['typelist_change']),
          ev('Breed eligibility validation rejects unsupported breeds', 'negative', ['gosu_rule_change'])
        ],
        assumptions: []
      }
    }
  },
  {
    id: 'three-typecodes',
    label: 'Add three typecodes to one typelist',
    ref_s2: 6,
    ref_source: 'provisional',
    baseline_master_s2: 11.7,
    baseline_v2_s2: 10.8,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'All three new values are selectable'),
        sc('edge_case', 'Existing values keep their codes and order')
      ]
    },
    inputs: { ...base, typelist_changes_count: 3 }
  },
  {
    id: 'five-typecodes-two-lists',
    label: 'Add five typecodes across two typelists',
    ref_s2: 8,
    ref_source: 'provisional',
    baseline_master_s2: 16.8,
    baseline_v2_s2: 14.1,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'New values are selectable on both screens'),
        sc('edge_case', 'Filtered typelist shows only the valid child values')
      ]
    },
    inputs: { ...base, typelist_changes_count: 5 }
  },
  {
    id: 'field-and-screen',
    label: 'New entity field shown on one screen, no rule',
    ref_s2: 8,
    ref_source: 'provisional',
    baseline_master_s2: 16,
    baseline_v2_s2: 11.1,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'User can capture the new field on the vehicle screen'),
        sc('edge_case', 'Field is read-only on bound policies'),
        sc('edge_case', 'Existing policies show the field as empty')
      ]
    },
    inputs: { ...base, entity_changes_count: 1, pcf_changes_count: 1 }
  },
  {
    id: 'field-screen-validation',
    label: 'New entity field + screen + one validation rule',
    ref_s2: 14,
    ref_source: 'provisional',
    baseline_master_s2: 28,
    baseline_v2_s2: 25.4,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'Valid annual mileage is accepted'),
        sc('negative', 'Mileage above the limit raises a validation error'),
        sc('edge_case', 'Mileage exactly at the limit is accepted'),
        sc('edge_case', 'Field is optional for commercial vehicles')
      ]
    },
    inputs: {
      ...base,
      entity_changes_count: 1,
      pcf_changes_count: 1,
      gosu_rule_changes_count: 1,
      overall_complexity: 'medium',
      complexity_evidence: {
        confirmed_by_scenario: [
          ev('Mileage above the limit raises a validation error', 'negative', ['gosu_rule_change']),
          ev('Valid annual mileage is accepted', 'happy_path', ['entity_change', 'pcf_change'])
        ],
        assumptions: []
      }
    }
  },
  {
    id: 'field-screen-validation-verbose',
    label: 'Same field + validation, 2x the scenarios',
    padding_of: 'field-screen-validation',
    ref_s2: 14,
    ref_source: 'provisional',
    baseline_master_s2: 28,
    baseline_v2_s2: 25.4,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'Valid annual mileage is accepted'),
        sc('negative', 'Mileage above the limit raises a validation error'),
        sc('edge_case', 'Mileage exactly at the limit is accepted'),
        sc('edge_case', 'Field is optional for commercial vehicles'),
        sc('negative', 'Negative mileage is rejected'),
        sc('negative', 'Non-numeric mileage is rejected'),
        sc('edge_case', 'Mileage persists across policy change'),
        sc('edge_case', 'Mileage is copied on renewal')
      ]
    },
    inputs: {
      ...base,
      entity_changes_count: 1,
      pcf_changes_count: 1,
      gosu_rule_changes_count: 1,
      overall_complexity: 'medium',
      complexity_evidence: {
        confirmed_by_scenario: [
          ev('Mileage above the limit raises a validation error', 'negative', ['gosu_rule_change']),
          ev('Negative mileage is rejected', 'negative', ['gosu_rule_change']),
          ev('Valid annual mileage is accepted', 'happy_path', ['entity_change', 'pcf_change'])
        ],
        assumptions: []
      }
    }
  },
  {
    id: 'uw-threshold',
    label: 'Change one underwriting rule threshold',
    ref_s2: 7,
    ref_source: 'provisional',
    baseline_master_s2: 12.6,
    baseline_v2_s2: 11.5,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'Risks below the new threshold quote without referral'),
        sc('edge_case', 'Risk exactly at the threshold is referred')
      ]
    },
    inputs: {
      ...base,
      gosu_rule_changes_count: 1,
      complexity_evidence: {
        confirmed_by_scenario: [ev('Risk exactly at the threshold is referred', 'edge_case', ['gosu_rule_change'])],
        assumptions: []
      }
    }
  },
  {
    id: 'two-rules',
    label: 'Two new Gosu rules (validation + UW referral)',
    ref_s2: 14,
    ref_source: 'provisional',
    baseline_master_s2: 24,
    baseline_v2_s2: 21.3,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'Eligible risk binds without issues'),
        sc('negative', 'Missing prior insurance raises a validation error'),
        sc('edge_case', 'High-value vehicle is referred to underwriting'),
        sc('edge_case', 'Referral is cleared after approval')
      ]
    },
    inputs: {
      ...base,
      gosu_rule_changes_count: 2,
      overall_complexity: 'medium',
      complexity_evidence: {
        confirmed_by_scenario: [
          ev('Missing prior insurance raises a validation error', 'negative', ['gosu_rule_change']),
          ev('High-value vehicle is referred to underwriting', 'edge_case', ['gosu_rule_change'])
        ],
        assumptions: []
      }
    }
  },
  {
    id: 'fnol-glass-assignment',
    label: 'Auto-assign low-severity glass claims to express queue',
    ref_s2: 16,
    ref_source: 'provisional',
    baseline_master_s2: 27,
    baseline_v2_s2: 25.1,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'Low-severity glass claim is assigned to the express queue'),
        sc('edge_case', 'Glass claim with injury is assigned normally'),
        sc('negative', 'Unknown severity falls back to default assignment'),
        sc('edge_case', 'Reopened glass claim keeps its assignment')
      ]
    },
    inputs: {
      ...base,
      typelist_changes_count: 1,
      gosu_rule_changes_count: 2,
      overall_complexity: 'medium',
      complexity_evidence: {
        confirmed_by_scenario: [
          ev('Low-severity glass claim is assigned to the express queue', 'happy_path', ['gosu_rule_change', 'typelist_change']),
          ev('Unknown severity falls back to default assignment', 'negative', ['gosu_rule_change'])
        ],
        assumptions: []
      }
    }
  },
  {
    id: 'dunning-third-notice',
    label: 'Add a third dunning notice at 60 days',
    ref_s2: 10,
    ref_source: 'provisional',
    baseline_master_s2: 15.1,
    baseline_v2_s2: 13.1,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'Third notice is sent at 60 days past due'),
        sc('edge_case', 'Payment received before 60 days stops the notice'),
        sc('edge_case', 'Agency-bill accounts are unaffected')
      ]
    },
    inputs: {
      ...base,
      typelist_changes_count: 1,
      gosu_rule_changes_count: 1,
      complexity_evidence: {
        confirmed_by_scenario: [ev('Third notice is sent at 60 days past due', 'happy_path', ['gosu_rule_change', 'typelist_change'])],
        assumptions: []
      }
    }
  },
  {
    id: 'rating-unconfirmed',
    label: 'Discount request where rating impact is flagged but not confirmed',
    ref_s2: 14,
    ref_source: 'provisional',
    baseline_master_s2: 49,
    baseline_v2_s2: 11.7,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'Fuel type can be captured for a vehicle'),
        sc('edge_case', 'Existing vehicles default to unknown fuel type')
      ]
    },
    inputs: {
      ...base,
      typelist_changes_count: 1,
      entity_changes_count: 1,
      pcf_changes_count: 1,
      has_rating_impact: true,
      overall_complexity: 'medium',
      complexity_evidence: {
        confirmed_by_scenario: [ev('Fuel type can be captured for a vehicle', 'happy_path', ['typelist_change', 'entity_change', 'pcf_change'])],
        assumptions: ['Discount factor values require Rate Management verification']
      }
    }
  },
  {
    id: 'hybrid-discount-confirmed',
    label: 'Hybrid/EV discount with confirmed rate factor change',
    ref_s2: 34,
    ref_source: 'provisional',
    baseline_master_s2: 59,
    baseline_v2_s2: 40,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'Hybrid vehicle receives the discount on quote'),
        sc('edge_case', 'Petrol vehicle receives no discount'),
        sc('negative', 'Discount is removed when fuel type changes to petrol'),
        sc('edge_case', 'Discount appears on the premium breakdown'),
        sc('edge_case', 'Renewal reapplies the discount')
      ]
    },
    inputs: {
      ...base,
      typelist_changes_count: 1,
      entity_changes_count: 1,
      pcf_changes_count: 1,
      gosu_rule_changes_count: 1,
      has_rating_impact: true,
      overall_complexity: 'medium',
      complexity_evidence: {
        confirmed_by_scenario: [
          ev('Hybrid vehicle receives the discount on quote', 'happy_path', ['rating_change', 'typelist_change']),
          ev('Discount is removed when fuel type changes to petrol', 'negative', ['gosu_rule_change', 'rating_change'])
        ],
        assumptions: []
      }
    }
  },
  {
    id: 'outbound-document-integration',
    label: 'New outbound message to a document system for one event',
    ref_s2: 60,
    ref_source: 'provisional',
    baseline_master_s2: 60,
    baseline_v2_s2: 53.1,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'Bound policy sends a document request'),
        sc('negative', 'Document system outage queues and retries the message'),
        sc('edge_case', 'Duplicate bind does not send a second request'),
        sc('negative', 'Rejected payload raises an activity for support')
      ]
    },
    inputs: {
      ...base,
      entity_changes_count: 1,
      pcf_changes_count: 1,
      gosu_rule_changes_count: 1,
      integration_changes_count: 1,
      overall_complexity: 'complex',
      complexity_evidence: {
        confirmed_by_scenario: [
          ev('Bound policy sends a document request', 'happy_path', ['integration_change']),
          ev('Rejected payload raises an activity for support', 'negative', ['gosu_rule_change'])
        ],
        assumptions: []
      }
    }
  },
  {
    id: 'integration-heavy',
    label: 'Two integrations with rules and screens',
    ref_s2: 90,
    ref_source: 'provisional',
    baseline_master_s2: 116,
    baseline_v2_s2: 102.4,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'Referral is synced to the CRM'),
        sc('negative', 'CRM outage retries and alerts'),
        sc('happy_path', 'Credit score is fetched at quote'),
        sc('negative', 'Credit service timeout falls back to manual review'),
        sc('edge_case', 'Referral rule fires only for new business'),
        sc('edge_case', 'Credit consent rule blocks fetch without consent'),
        sc('edge_case', 'Synced referral shows on account screen'),
        sc('negative', 'Malformed CRM response is logged and ignored')
      ]
    },
    inputs: {
      ...base,
      entity_changes_count: 2,
      pcf_changes_count: 2,
      gosu_rule_changes_count: 2,
      integration_changes_count: 2,
      overall_complexity: 'complex',
      complexity_evidence: {
        confirmed_by_scenario: [
          ev('Referral is synced to the CRM', 'happy_path', ['integration_change']),
          ev('Credit score is fetched at quote', 'happy_path', ['integration_change']),
          ev('Referral rule fires only for new business', 'edge_case', ['gosu_rule_change']),
          ev('Credit consent rule blocks fetch without consent', 'edge_case', ['gosu_rule_change'])
        ],
        assumptions: []
      }
    }
  },
  {
    id: 'new-coverage-structural',
    label: 'New optional coverage with screens, rules, rating and a form',
    ref_s2: 150,
    ref_source: 'provisional',
    baseline_master_s2: 160.8,
    baseline_v2_s2: 119,
    acceptance_criteria: {
      scenarios: [
        sc('happy_path', 'Coverage can be added and is rated'),
        sc('edge_case', 'Coverage is only available in eligible states'),
        sc('negative', 'Coverage limit above maximum is rejected'),
        sc('edge_case', 'Coverage form is attached on issuance'),
        sc('edge_case', 'Removing coverage mid-term returns premium'),
        sc('negative', 'Coverage cannot be added without a prerequisite coverage'),
        sc('happy_path', 'Coverage is sent to the forms system')
      ]
    },
    inputs: {
      ...base,
      entity_changes_count: 3,
      typelist_changes_count: 2,
      pcf_changes_count: 3,
      gosu_rule_changes_count: 2,
      integration_changes_count: 1,
      has_rating_impact: true,
      overall_complexity: 'complex',
      complexity_evidence: {
        confirmed_by_scenario: [
          ev('Coverage can be added and is rated', 'happy_path', ['rating_change', 'entity_change']),
          ev('Coverage is only available in eligible states', 'edge_case', ['gosu_rule_change']),
          ev('Coverage cannot be added without a prerequisite coverage', 'negative', ['gosu_rule_change']),
          ev('Coverage is sent to the forms system', 'happy_path', ['integration_change'])
        ],
        assumptions: []
      }
    }
  }
];

export const DELIVERY_GRADES = ['Bronze1', 'Bronze2', 'Silver1', 'Silver2', 'Gold1', 'Gold2'];
