import { describe, it, expect } from 'vitest';
import { compute, verifyEvidence, classifyFeature, normaliseTitle, hoursToStoryPoints, readDesignNoteScope, SENIOR_REVIEW_SHARE } from './estimate.js';

// Tests for the pure compute() function in estimate.js — the logic that turns
// the effort_estimate gate's complexity inputs (plus the approved acceptance
// criteria) into hours by role, P50/P80, story points and a confidence band.
// Calibration against representative requests lives in estimate.benchmark.test.js.

const base = {
  entity_changes_count: 0,
  typelist_changes_count: 0,
  pcf_changes_count: 0,
  gosu_rule_changes_count: 0,
  integration_changes_count: 0,
  has_rating_impact: false,
  overall_complexity: 'simple'
};
const sc = (type, title) => ({ title, type, given: [], when: [], then: [] });
const ev = (title, impacts, type = 'edge_case') => ({ scenario_title: title, scenario_type: type, impacts, rationale: 't' });
const GRADES = ['Bronze1', 'Bronze2', 'Silver1', 'Silver2', 'Gold1', 'Gold2'];
const ROLES = ['BA', 'Dev', 'QA', 'Architect'];

const ac = {
  scenarios: [
    sc('happy_path', 'Valid mileage is accepted'),
    sc('negative', 'Mileage above the limit is rejected'),
    sc('edge_case', 'Mileage at the limit is accepted')
  ]
};

describe('verifyEvidence()', () => {
  it('drops evidence whose scenario title is not an approved acceptance criteria scenario', () => {
    const inputs = {
      ...base,
      complexity_evidence: {
        confirmed_by_scenario: [ev('Mileage above the limit is rejected', ['gosu_rule_change']), ev('Invented scenario', ['gosu_rule_change'])],
        assumptions: []
      }
    };
    const r = verifyEvidence(inputs, ac);
    expect(r.mode).toBe('verified_against_acceptance_criteria');
    expect(r.verified).toHaveLength(1);
    expect(r.dropped).toHaveLength(1);
    expect(r.verifiedCount('gosu_rule_change')).toBe(1);
  });

  it('matches titles case- and punctuation-insensitively', () => {
    const inputs = { ...base, complexity_evidence: { confirmed_by_scenario: [ev('mileage ABOVE the limit is rejected!', ['gosu_rule_change'])], assumptions: [] } };
    expect(verifyEvidence(inputs, ac).verifiedCount('gosu_rule_change')).toBe(1);
  });

  it('counts the same scenario once even if cited twice for one impact', () => {
    const inputs = {
      ...base,
      complexity_evidence: {
        confirmed_by_scenario: [ev('Mileage above the limit is rejected', ['gosu_rule_change']), ev('Mileage above the limit is rejected', ['gosu_rule_change'])],
        assumptions: []
      }
    };
    expect(verifyEvidence(inputs, ac).verifiedCount('gosu_rule_change')).toBe(1);
  });

  it('accepts evidence as-is (and says so) when no acceptance criteria are supplied', () => {
    const inputs = { ...base, complexity_evidence: { confirmed_by_scenario: [ev('Anything', ['gosu_rule_change'])], assumptions: [] } };
    const r = verifyEvidence(inputs, undefined);
    expect(r.mode).toBe('unverified_no_acceptance_criteria_supplied');
    expect(r.verifiedCount('gosu_rule_change')).toBe(1);
  });

  it('does not match very short titles by substring', () => {
    expect(normaliseTitle('A-b')).toBe('a b');
    const inputs = { ...base, complexity_evidence: { confirmed_by_scenario: [ev('limit', ['gosu_rule_change'])], assumptions: [] } };
    expect(verifyEvidence(inputs, ac).verifiedCount('gosu_rule_change')).toBe(0);
  });
});

describe('classifyFeature()', () => {
  const c = o => ({ typelist: 0, entity: 0, pcf: 0, gosu: 0, integration: 0, ...o });
  it('keeps three typecodes as config-micro (regression: previously fell through to structural-complex)', () => {
    expect(classifyFeature(c({ typelist: 3 }), false)).toBe('A_CONFIG_MICRO');
  });
  it('applies precedence E > D > C > B > A', () => {
    expect(classifyFeature(c({ entity: 3, pcf: 3, gosu: 2 }), true)).toBe('E_STRUCTURAL_COMPLEX');
    expect(classifyFeature(c({ integration: 1, gosu: 1 }), true)).toBe('D_INTEGRATION_HEAVY');
    expect(classifyFeature(c({ gosu: 1 }), true)).toBe('C_RATING_CONFIGURABLE');
    expect(classifyFeature(c({ gosu: 1 }), false)).toBe('B_CONFIG_PLUS_RULES');
    expect(classifyFeature(c({ typelist: 5 }), false)).toBe('B_CONFIG_PLUS_RULES');
    expect(classifyFeature(c({ typelist: 1, entity: 1, pcf: 1 }), false)).toBe('A_CONFIG_MICRO');
  });
});

describe('compute()', () => {
  it('estimates a one-line typelist add at a few hours', () => {
    const r = compute({ ...base, typelist_changes_count: 1 }, { acceptanceCriteria: ac });
    expect(r.total_hours).toBeGreaterThan(2);
    expect(r.total_hours).toBeLessThanOrEqual(8);
    expect(r.feature_class).toBe('A_CONFIG_MICRO');
  });

  it('caps rule count by the number of distinct verified scenarios and reports the rest as contingency', () => {
    const r = compute(
      {
        ...base,
        gosu_rule_changes_count: 4,
        complexity_evidence: { confirmed_by_scenario: [ev('Mileage above the limit is rejected', ['gosu_rule_change'])], assumptions: [] }
      },
      { acceptanceCriteria: ac }
    );
    expect(r.calculation_trace.verified_counts.gosu).toBe(1);
    expect(r.contingency_drivers.some(d => d.startsWith('3 gosu change'))).toBe(true);
    expect(r.p80_hours).toBeGreaterThan(r.total_hours * 1.25);
  });

  it('gives the same P50 when the agent cites a non-existent scenario as when it claims nothing', () => {
    const clean = compute({ ...base, typelist_changes_count: 1 }, { acceptanceCriteria: ac });
    const padded = compute(
      {
        ...base,
        typelist_changes_count: 1,
        gosu_rule_changes_count: 1,
        complexity_evidence: { confirmed_by_scenario: [ev('Breed eligibility rule rejects bad breeds', ['gosu_rule_change'], 'negative')], assumptions: [] }
      },
      { acceptanceCriteria: ac }
    );
    expect(padded.total_hours).toBe(clean.total_hours);
    expect(padded.p80_hours).toBeGreaterThan(clean.p80_hours);
    expect(padded.calculation_trace.evidence_verification.dropped_entries).toHaveLength(1);
  });

  it('confirms rating only via rating_change evidence (gosu evidence no longer confirms rating)', () => {
    const viaGosu = compute(
      {
        ...base,
        gosu_rule_changes_count: 1,
        has_rating_impact: true,
        complexity_evidence: { confirmed_by_scenario: [ev('Mileage above the limit is rejected', ['gosu_rule_change'])], assumptions: [] }
      },
      { acceptanceCriteria: ac }
    );
    expect(viaGosu.calculation_trace.rating.confirmed).toBe(false);
    expect(viaGosu.feature_class).toBe('B_CONFIG_PLUS_RULES');

    const viaRating = compute(
      {
        ...base,
        gosu_rule_changes_count: 1,
        has_rating_impact: true,
        complexity_evidence: { confirmed_by_scenario: [ev('Mileage above the limit is rejected', ['gosu_rule_change', 'rating_change'])], assumptions: [] }
      },
      { acceptanceCriteria: ac }
    );
    expect(viaRating.calculation_trace.rating.confirmed).toBe(true);
    expect(viaRating.feature_class).toBe('C_RATING_CONFIGURABLE');
    expect(viaRating.total_hours).toBeGreaterThan(viaGosu.total_hours);
  });

  it('has no rating floor: a small confirmed rating change is not forced up to a minimum', () => {
    const r = compute(
      { ...base, has_rating_impact: true, complexity_evidence: { confirmed_by_scenario: [ev('Valid mileage is accepted', ['rating_change'], 'happy_path')], assumptions: [] } },
      { acceptanceCriteria: ac, }
    );
    expect(r.feature_class).toBe('C_RATING_CONFIGURABLE');
    expect(r.calculation_trace.class_envelope.applied).not.toBe('floor');
    expect(r.total_hours).toBeLessThan(34);
  });

  it('applies the complexity multiplier only to rule/integration work, not to config', () => {
    const simple = compute({ ...base, typelist_changes_count: 2, entity_changes_count: 1, overall_complexity: 'simple' }, { acceptanceCriteria: ac });
    const complex = compute({ ...base, typelist_changes_count: 2, entity_changes_count: 1, overall_complexity: 'complex' }, { acceptanceCriteria: ac });
    expect(complex.total_hours).toBe(simple.total_hours);

    const withRule = o => compute(
      { ...base, gosu_rule_changes_count: 1, overall_complexity: o, complexity_evidence: { confirmed_by_scenario: [ev('Mileage above the limit is rejected', ['gosu_rule_change'])], assumptions: [] } },
      { acceptanceCriteria: ac }
    );
    expect(withRule('simple').total_hours).toBeLessThan(withRule('medium').total_hours);
    expect(withRule('medium').total_hours).toBeLessThan(withRule('complex').total_hours);
  });

  it('adds diminishing QA hours as scenario count grows', () => {
    const acN = n => ({ scenarios: [sc('happy_path', 'Happy path works fine'), ...Array.from({ length: n }, (_, i) => sc('edge_case', `Edge case number ${i + 1} behaves`))] });
    // Use the unrounded scenario-QA term from the trace (role hours are rounded to 0.1h).
    const qa = n => compute({ ...base, typelist_changes_count: 1 }, { acceptanceCriteria: acN(n) }).calculation_trace.scenario_qa.hours;
    const step1 = qa(4) - qa(2);
    const step2 = qa(8) - qa(4);
    expect(qa(4)).toBeGreaterThan(qa(2));
    expect(step2).toBeLessThan(step1 * 1.25); // doubling scenarios adds roughly the same, not double
    expect(qa(8) / qa(2)).toBeLessThan(1.6);
  });

  it('applies the verified-only floor for integration-heavy work', () => {
    const r = compute(
      { ...base, integration_changes_count: 1, complexity_evidence: { confirmed_by_scenario: [ev('Valid mileage is accepted', ['integration_change'], 'happy_path')], assumptions: [] } },
      { acceptanceCriteria: ac }
    );
    expect(r.feature_class).toBe('D_INTEGRATION_HEAVY');
    expect(r.total_hours).toBeGreaterThanOrEqual(60);
  });

  it('never applies the integration floor to an unverified integration claim', () => {
    const r = compute(
      { ...base, integration_changes_count: 2, complexity_evidence: { confirmed_by_scenario: [ev('Made-up integration scenario', ['integration_change'])], assumptions: [] } },
      { acceptanceCriteria: ac }
    );
    expect(r.feature_class).toBe('A_CONFIG_MICRO');
    expect(r.total_hours).toBeLessThan(10);
    expect(r.contingency_drivers.some(d => d.includes('integration'))).toBe(true);
  });

  it('keeps Bronze > Silver > Gold for totals and never inverts a role', () => {
    const inputs = {
      ...base,
      entity_changes_count: 2,
      typelist_changes_count: 1,
      pcf_changes_count: 1,
      gosu_rule_changes_count: 1,
      overall_complexity: 'medium',
      complexity_evidence: { confirmed_by_scenario: [ev('Mileage above the limit is rejected', ['gosu_rule_change'])], assumptions: [] }
    };
    const rs = GRADES.map(g => compute({ ...inputs, assumed_delivery_grade: g }, { acceptanceCriteria: ac }));
    for (let i = 1; i < rs.length; i++) {
      expect(rs[i].total_hours).toBeLessThan(rs[i - 1].total_hours);
      for (const role of ROLES) expect(rs[i].hours_by_role[role]).toBeLessThanOrEqual(rs[i - 1].hours_by_role[role]);
    }
    expect(rs[0].hours_by_role.Dev).toBeGreaterThan(rs[5].hours_by_role.Dev);
  });

  it('track totals add up to the P50 total (within rounding)', () => {
    const r = compute(
      { ...base, entity_changes_count: 1, pcf_changes_count: 1, gosu_rule_changes_count: 1, complexity_evidence: { confirmed_by_scenario: [ev('Mileage above the limit is rejected', ['gosu_rule_change'])], assumptions: [] } },
      { acceptanceCriteria: ac }
    );
    const sum = r.tracks.implementation + r.tracks.validation + r.tracks.governance;
    expect(Math.abs(sum - r.total_hours)).toBeLessThanOrEqual(0.3);
    const roleSum = ROLES.reduce((s, k) => s + r.hours_by_role[k], 0);
    expect(r.total_hours).toBeCloseTo(roleSum, 1);
  });

  it('defaults missing inputs without throwing', () => {
    expect(() => compute({})).not.toThrow();
    expect(compute({ assumed_delivery_grade: 'Nope' }).assumed_delivery_grade).toBe('Silver2');
  });
});

describe('design note scope (required vs conditional)', () => {
  const dn = (over = {}) => ({
    entity_changes: [],
    typelist_changes: [{ typelist: 'DogBreed', change_type: 'extended', new_codes: ['Dachshund'], certainty: 'required', description: '' }],
    pcf_changes: [{ pcf: 'PetDV.pcf', certainty: 'conditional', description: '' }],
    gosu_rule_changes: [{ rule_category: 'UW Rule', rule_name: 'BreedEligibility', change_type: 'modified', certainty: 'conditional', description: '' }],
    integration_changes: [{ integration: 'VIN decode', change_type: 'modified', certainty: 'conditional', description: '' }],
    rating_impact: { has_rating_impact: true, certainty: 'conditional', description: 'if rated on breed' },
    ...over
  });
  const acDog = {
    scenarios: [
      sc('happy_path', 'Dachshund can be selected and the quote rates'),
      sc('edge_case', 'Existing UW breed rules evaluate Dachshund correctly'),
      sc('negative', 'Rating fails clearly if no breed factor exists')
    ]
  };
  // What the agent actually produced in a live run: speculative scope cited
  // against speculative (but approved) scenarios.
  const paddedDog = {
    ...base,
    typelist_changes_count: 1,
    pcf_changes_count: 1,
    gosu_rule_changes_count: 1,
    integration_changes_count: 1,
    has_rating_impact: true,
    complexity_evidence: {
      confirmed_by_scenario: [
        ev('Dachshund can be selected and the quote rates', ['typelist_change', 'rating_change'], 'happy_path'),
        ev('Existing UW breed rules evaluate Dachshund correctly', ['gosu_rule_change']),
        ev('Rating fails clearly if no breed factor exists', ['integration_change', 'rating_change'], 'negative')
      ],
      assumptions: []
    }
  };

  it('reads required and conditional items, counting typelist codes', () => {
    const scope = readDesignNoteScope(dn({ typelist_changes: [{ typelist: 'X', new_codes: ['a', 'b', 'c'], certainty: 'required' }] }));
    expect(scope.required.typelist).toBe(3);
    expect(scope.conditional.gosu).toEqual(['BreedEligibility']);
    expect(scope.rating).toBe('conditional');
    expect(readDesignNoteScope(undefined)).toBeNull();
  });

  it('treats items without a certainty field (older design notes) as required', () => {
    const scope = readDesignNoteScope({ gosu_rule_changes: [{ rule_name: 'A' }, { rule_name: 'B' }], rating_impact: { has_rating_impact: true } });
    expect(scope.required.gosu).toBe(2);
    expect(scope.rating).toBe('required');
  });

  it('a one-line typelist add stays small even when the agent pads it with conditional rule, integration and rating scope', () => {
    const withoutDn = compute(paddedDog, { acceptanceCriteria: acDog });
    const withDn = compute(paddedDog, { acceptanceCriteria: acDog, designNote: dn() });
    expect(withoutDn.total_hours).toBeGreaterThan(20); // what the live run produced
    expect(withDn.feature_class).toBe('A_CONFIG_MICRO');
    expect(withDn.total_hours).toBeLessThanOrEqual(8);
    expect(withDn.calculation_trace.rating.confirmed).toBe(false);
    expect(withDn.contingency_drivers.some(d => d.includes('BreedEligibility'))).toBe(true);
    expect(withDn.contingency_drivers.some(d => d.includes('Rating impact possible'))).toBe(true);
    expect(withDn.p80_hours).toBeGreaterThan(withDn.total_hours * 1.5);
  });

  it('charges conditional items as a small check allowance, not as build work', () => {
    const r = compute(paddedDog, { acceptanceCriteria: acDog, designNote: dn() });
    expect(r.calculation_trace.conditional_checks.items).toBe(3); // pcf, rule, integration (rating is tracked separately)
    expect(r.calculation_trace.conditional_checks.hours).toBeLessThan(2.5);
  });

  it('confirms rating when the design note says rating is required and a rating_change scenario backs it', () => {
    const r = compute(paddedDog, {
      acceptanceCriteria: acDog,
      designNote: dn({ rating_impact: { has_rating_impact: true, certainty: 'required', description: 'new factor' } })
    });
    expect(r.calculation_trace.rating.confirmed).toBe(true);
    expect(r.feature_class).toBe('C_RATING_CONFIGURABLE');
  });

  it('only applies the integration floor when the design note requires a NEW integration', () => {
    const intInputs = {
      ...base,
      integration_changes_count: 1,
      complexity_evidence: { confirmed_by_scenario: [ev('Valid mileage is accepted', ['integration_change'], 'happy_path')], assumptions: [] }
    };
    const modified = compute(intInputs, {
      acceptanceCriteria: ac,
      designNote: { integration_changes: [{ integration: 'DocSys', change_type: 'modified', certainty: 'required' }] }
    });
    const brandNew = compute(intInputs, {
      acceptanceCriteria: ac,
      designNote: { integration_changes: [{ integration: 'DocSys', change_type: 'new', certainty: 'required' }] }
    });
    expect(modified.feature_class).toBe('D_INTEGRATION_HEAVY');
    expect(modified.calculation_trace.class_envelope.applied).not.toBe('floor');
    expect(modified.total_hours).toBeLessThan(60);
    expect(brandNew.total_hours).toBeGreaterThanOrEqual(60);
  });

  it('keeps Bronze > Silver > Gold with a design note supplied', () => {
    const rs = GRADES.map(g => compute({ ...paddedDog, assumed_delivery_grade: g }, { acceptanceCriteria: acDog, designNote: dn() }));
    for (let i = 1; i < rs.length; i++) {
      expect(rs[i].total_hours).toBeLessThan(rs[i - 1].total_hours);
      for (const role of ROLES) expect(rs[i].hours_by_role[role]).toBeLessThanOrEqual(rs[i - 1].hours_by_role[role]);
    }
  });
});

describe('level effects by type of work', () => {
  const ratio = (inputs, ctx) => {
    const b1 = compute({ ...inputs, assumed_delivery_grade: 'Bronze1' }, ctx).total_hours;
    const g2 = compute({ ...inputs, assumed_delivery_grade: 'Gold2' }, ctx).total_hours;
    return b1 / g2;
  };
  const intCtx = { acceptanceCriteria: ac };
  const intInputs = {
    ...base,
    integration_changes_count: 2,
    complexity_evidence: {
      confirmed_by_scenario: [ev('Valid mileage is accepted', ['integration_change'], 'happy_path'), ev('Mileage above the limit is rejected', ['integration_change'], 'negative')],
      assumptions: []
    }
  };

  it('widens the Bronze-to-Gold gap for integration work compared with a typecode add', () => {
    const typelist = ratio({ ...base, typelist_changes_count: 1 }, intCtx);
    const integration = ratio(intInputs, intCtx);
    expect(integration).toBeGreaterThan(typelist + 0.25);
    expect(typelist).toBeGreaterThan(1.2);
  });

  it('adds senior review time only for Bronze1, Bronze2 and Silver1', () => {
    for (const g of GRADES) {
      const r = compute({ ...intInputs, assumed_delivery_grade: g }, intCtx);
      if (SENIOR_REVIEW_SHARE[g] > 0) expect(r.calculation_trace.senior_review.hours).toBeGreaterThan(0);
      else expect(r.calculation_trace.senior_review).toBeUndefined();
    }
    const b1 = compute({ ...intInputs, assumed_delivery_grade: 'Bronze1' }, intCtx).calculation_trace.senior_review.share;
    const s1 = compute({ ...intInputs, assumed_delivery_grade: 'Silver1' }, intCtx).calculation_trace.senior_review.share;
    expect(b1).toBeGreaterThan(s1);
  });

  it('gives config-only changes a lighter scenario-testing allowance than rule changes', () => {
    const configOnly = compute({ ...base, typelist_changes_count: 1 }, { acceptanceCriteria: ac });
    const withRule = compute(
      { ...base, typelist_changes_count: 1, gosu_rule_changes_count: 1, complexity_evidence: { confirmed_by_scenario: [ev('Mileage above the limit is rejected', ['gosu_rule_change'])], assumptions: [] } },
      { acceptanceCriteria: ac }
    );
    expect(configOnly.calculation_trace.scenario_qa.hours).toBeLessThan(withRule.calculation_trace.scenario_qa.hours);
  });

  it('charges a modified rule less than a new rule, and a new entity more than an extended one', () => {
    const ruleInputs = {
      ...base,
      gosu_rule_changes_count: 1,
      complexity_evidence: { confirmed_by_scenario: [ev('Mileage above the limit is rejected', ['gosu_rule_change'])], assumptions: [] }
    };
    const rule = changeType => compute(ruleInputs, {
      acceptanceCriteria: ac,
      designNote: { gosu_rule_changes: [{ rule_name: 'R', change_type: changeType, certainty: 'required' }] }
    }).total_hours;
    expect(rule('modified')).toBeLessThan(rule('new'));

    const ent = changeType => compute({ ...base, entity_changes_count: 1 }, {
      acceptanceCriteria: ac,
      designNote: { entity_changes: [{ entity: 'E', change_type: changeType, certainty: 'required' }] }
    }).total_hours;
    expect(ent('new')).toBeGreaterThan(ent('extended'));
  });

  it('applies class floors and ceilings with the same scale at every grade (no role inverts)', () => {
    const big = {
      ...base,
      entity_changes_count: 6, pcf_changes_count: 6, typelist_changes_count: 6,
      gosu_rule_changes_count: 1,
      complexity_evidence: { confirmed_by_scenario: [ev('Mileage above the limit is rejected', ['gosu_rule_change'])], assumptions: [] }
    };
    const rs = GRADES.map(g => compute({ ...big, assumed_delivery_grade: g }, { acceptanceCriteria: ac }));
    expect(rs[3].calculation_trace.class_envelope.applied).toBe('ceiling');
    const scales = new Set(rs.map(r => r.calculation_trace.class_envelope.scale));
    expect(scales.size).toBe(1);
    for (let i = 1; i < rs.length; i++) {
      expect(rs[i].total_hours).toBeLessThan(rs[i - 1].total_hours);
      for (const role of ROLES) expect(rs[i].hours_by_role[role]).toBeLessThanOrEqual(rs[i - 1].hours_by_role[role]);
    }
  });
});

describe('estimates for every level', () => {
  it('returns all six levels, in order, matching a compute() at each level', () => {
    const inputs = {
      ...base,
      entity_changes_count: 1,
      gosu_rule_changes_count: 1,
      complexity_evidence: { confirmed_by_scenario: [ev('Mileage above the limit is rejected', ['gosu_rule_change'])], assumptions: [] }
    };
    const r = compute({ ...inputs, assumed_delivery_grade: 'Gold1' }, { acceptanceCriteria: ac });
    expect(r.estimates_by_grade.map(e => e.grade)).toEqual(GRADES);
    for (const e of r.estimates_by_grade) {
      const single = compute({ ...inputs, assumed_delivery_grade: e.grade }, { acceptanceCriteria: ac });
      expect(e.total_hours).toBe(single.total_hours);
      expect(e.p80_hours).toBe(single.p80_hours);
      expect(e.story_points).toBe(single.story_points);
      expect(e.hours_by_role).toEqual(single.hours_by_role);
    }
    for (let i = 1; i < 6; i++) expect(r.estimates_by_grade[i].total_hours).toBeLessThan(r.estimates_by_grade[i - 1].total_hours);
    // headline stays at the selected grade
    expect(r.total_hours).toBe(r.estimates_by_grade[4].total_hours);
  });
});

describe('delivery outputs', () => {
  it('splits P50 across locations using the documented default ratio', () => {
    const r = compute({ ...base, entity_changes_count: 2, pcf_changes_count: 2 }, { acceptanceCriteria: ac });
    const sum = r.hours_by_location.Onsite + r.hours_by_location.Offshore_India + r.hours_by_location.Nearshore;
    expect(sum).toBeCloseTo(r.total_hours, 0);
    expect(r.hours_by_location.Offshore_India).toBeCloseTo(r.total_hours * 0.7, 0);
    expect(r.location_split_assumption).toBeTruthy();
  });

  it('maps P50 hours to Fibonacci story points using the documented buckets', () => {
    expect([6, 12, 24, 48, 96, 192, 193].map(hoursToStoryPoints)).toEqual([1, 2, 3, 5, 8, 13, 21]);
    const r = compute({ ...base, typelist_changes_count: 1 }, { acceptanceCriteria: ac });
    expect(r.story_points).toBe(hoursToStoryPoints(r.total_hours));
  });

  it('discloses methodology, grade and estimator version', () => {
    const r = compute({ ...base, assumed_delivery_grade: 'Gold1' }, { acceptanceCriteria: ac });
    expect(r.estimator_version).toBe('v3');
    expect(r.methodology).toMatch(/P50/);
    expect(r.methodology).toMatch(/Bronze slower, Gold faster/);
    expect(compute(base).methodology).toMatch(/Silver2 \(default\)/);
  });
});
