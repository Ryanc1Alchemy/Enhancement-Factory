import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderGate3, renderGate4 } from './artifactRenderers.jsx';
import { compute } from '../../api/estimate.js';

const inputs = {
  entity_changes_count: 0, typelist_changes_count: 1, pcf_changes_count: 0,
  gosu_rule_changes_count: 1, integration_changes_count: 0,
  has_rating_impact: false, overall_complexity: 'medium',
  complexity_evidence: {
    confirmed_by_scenario: [{ scenario_title: 'Invented rule scenario', scenario_type: 'negative', impacts: ['gosu_rule_change'], rationale: 'r' }],
    assumptions: []
  }
};
const ac = { scenarios: [{ title: 'New value is selectable', type: 'happy_path' }] };

describe('Gate 4 card', () => {
  it('shows P50/P80, tracks and the discarded evidence', () => {
    const ce = compute(inputs, { acceptanceCriteria: ac });
    const html = renderToStaticMarkup(renderGate4({ narrative: 'n', computed_estimate: ce }, null, { onRecomputeEstimate: () => {} }));
    expect(html).toContain('P50 (likely)');
    expect(html).toContain('P80 (with unconfirmed risk)');
    expect(html).toContain('Hours by track');
    expect(html).toContain('Evidence discarded');
    expect(html).toContain('A CONFIG MICRO');
    expect(html).toContain('Estimate by level');
    for (const g of ['Bronze1', 'Bronze2', 'Silver1', 'Silver2', 'Gold1', 'Gold2']) expect(html).toContain(g);
    expect(html).toContain('Silver2 (selected)');
  });

  it('still renders an older saved estimate that has no P80 or tracks', () => {
    const legacy = {
      hours_by_role: { BA: 1, Dev: 2, QA: 1, Architect: 0.5 },
      hours_by_location: { Onsite: 0.7, Offshore_India: 3.1, Nearshore: 0.7 },
      total_hours: 4.5, story_points: 1, confidence_band: '±20%',
      location_split_assumption: 'x', methodology: 'older estimator', assumed_delivery_grade: 'Silver2'
    };
    const html = renderToStaticMarkup(renderGate4({ narrative: 'n', computed_estimate: legacy }, null, undefined));
    expect(html).toContain('total');
    expect(html).not.toContain('Hours by track');
    expect(html).not.toContain('P80');
  });

  it('Gate 3 card shows required/conditional certainty and labels conditional rating impact', () => {
    const html = renderToStaticMarkup(renderGate3({
      approach_summary: 'a',
      entity_changes: [], pcf_changes: [], integration_changes: [],
      typelist_changes: [{ typelist: 'PetBreed', change_type: 'extended', new_codes: ['X'], certainty: 'required', description: 'd' }],
      gosu_rule_changes: [{ rule_category: 'UW Rule', rule_name: 'BreedEligibility', change_type: 'modified', certainty: 'conditional', description: 'd' }],
      rating_impact: { has_rating_impact: true, certainty: 'conditional', description: 'if rated on breed' }
    }));
    expect(html).toContain('Certainty');
    expect(html).toContain('conditional');
    expect(html).toContain('Possible rating impact');
  });

  it('Gate 3 card still renders an older design note without certainty', () => {
    const html = renderToStaticMarkup(renderGate3({
      approach_summary: 'a',
      gosu_rule_changes: [{ rule_category: 'UW Rule', rule_name: 'R', change_type: 'new', description: 'd' }],
      rating_impact: { has_rating_impact: true, description: 'new factor' }
    }));
    expect(html).toContain('Rating impact:');
    expect(html).not.toContain('Possible rating impact');
  });
});
