import { describe, it, expect } from 'vitest';
import { compute } from './estimate.js';

// Tests for the pure compute() function in estimate.js. This is the single
// piece of logic that turns Gate 3's complexity inputs into hours by role,
// hours by location, story points, and a confidence band — numbers that flow
// directly into every client-facing artifact from Gate 4 onward. Covered here
// so future changes (e.g. Gold escalation, COCOMO personnel multipliers)
// can't silently break the existing behaviour.

const baseInputs = {
  entity_changes_count: 0,
  typelist_changes_count: 0,
  pcf_changes_count: 0,
  gosu_rule_changes_count: 0,
  integration_changes_count: 0,
  has_rating_impact: false,
  overall_complexity: 'medium'
};

describe('compute()', () => {
  it('applies only fixed process overhead when all change counts are zero', () => {
    const result = compute(baseInputs);
    // PROCESS_OVERHEAD_HOURS = { BA: 1, Dev: 1.5, QA: 1, Architect: 0.5 }, medium multiplier = 1.0
    // With zero task hours, the result is exactly the overhead — no floor override involved.
    expect(result.hours_by_role).toEqual({ BA: 1, Dev: 1.5, QA: 1, Architect: 0.5 });
    expect(result.total_hours).toBe(4);
  });

  it('adds process overhead on top of accumulated base hours rather than acting as a floor', () => {
    const result = compute({
      ...baseInputs,
      entity_changes_count: 1,
      overall_complexity: 'medium'
    });
    // entity_change base: { BA: 1.0, Dev: 4.0, QA: 1.5, Architect: 0.5 }
    // medium multiplier = 1.0, then + PROCESS_OVERHEAD_HOURS { BA: 1, Dev: 1.5, QA: 1, Architect: 0.5 }
    expect(result.hours_by_role.BA).toBeCloseTo(2.0, 1);        // 1.0 + 1
    expect(result.hours_by_role.Dev).toBeCloseTo(5.5, 1);        // 4.0 + 1.5
    expect(result.hours_by_role.QA).toBeCloseTo(2.5, 1);         // 1.5 + 1
    expect(result.hours_by_role.Architect).toBeCloseTo(1.0, 1);  // 0.5 + 0.5
  });

  it('scales differently for a small vs larger task — overhead no longer collapses distinct ticket sizes to the same number', () => {
    // Regression guard for the original bug report: a single typelist change
    // (small, real task hours below the old floor) must NOT produce the same
    // Dev hours as a task that genuinely needs more effort (e.g. an entity
    // change). Previously both were forced to the same floor value.
    const singleTypelistChange = compute({ ...baseInputs, typelist_changes_count: 1 });
    const singleEntityChange = compute({ ...baseInputs, entity_changes_count: 1 });
    expect(singleTypelistChange.hours_by_role.Dev).toBeLessThan(singleEntityChange.hours_by_role.Dev);
  });

  it('applies the complexity multiplier to accumulated hours before process overhead is added', () => {
    const simple = compute({ ...baseInputs, entity_changes_count: 5, overall_complexity: 'simple' });
    const medium = compute({ ...baseInputs, entity_changes_count: 5, overall_complexity: 'medium' });
    const complex = compute({ ...baseInputs, entity_changes_count: 5, overall_complexity: 'complex' });

    // 5 entity changes: Dev base = 5 * 4.0 = 20 hours before multiplier, then
    // + PROCESS_OVERHEAD_HOURS.Dev (1.5) added after the multiplier is applied.
    const DEV_OVERHEAD = 1.5;
    expect(simple.hours_by_role.Dev).toBeCloseTo(20 * 0.85 + DEV_OVERHEAD, 1);
    expect(medium.hours_by_role.Dev).toBeCloseTo(20 * 1.0 + DEV_OVERHEAD, 1);
    expect(complex.hours_by_role.Dev).toBeCloseTo(20 * 1.4 + DEV_OVERHEAD, 1);
  });

  it('adds dedicated rating-impact hours when has_rating_impact is true', () => {
    const withoutRating = compute({ ...baseInputs, entity_changes_count: 2 });
    const withRating = compute({ ...baseInputs, entity_changes_count: 2, has_rating_impact: true });

    // RATING_IMPACT_HOURS = { BA: 4, Dev: 12, QA: 8, Architect: 4 }
    expect(withRating.hours_by_role.Dev).toBeGreaterThan(withoutRating.hours_by_role.Dev);
    expect(withRating.hours_by_role.Dev - withoutRating.hours_by_role.Dev).toBeCloseTo(12, 1);
  });

  it('sums hours_by_role into total_hours correctly', () => {
    const result = compute({ ...baseInputs, entity_changes_count: 3, pcf_changes_count: 2, overall_complexity: 'complex' });
    const expectedTotal = Math.round(
      (result.hours_by_role.BA + result.hours_by_role.Dev + result.hours_by_role.QA + result.hours_by_role.Architect) * 10
    ) / 10;
    expect(result.total_hours).toBeCloseTo(expectedTotal, 1);
  });

  it('splits total_hours across locations using the documented default ratio', () => {
    const result = compute({ ...baseInputs, entity_changes_count: 5 });
    const sumOfSplits = result.hours_by_location.Onsite + result.hours_by_location.Offshore_India + result.hours_by_location.Nearshore;
    // Rounding per-location can introduce small drift versus total_hours; allow a small tolerance.
    // Precision 0 (within 0.5h) tolerates the per-location rounding drift
    // inherent to rounding each location independently to 1 decimal place.
    expect(sumOfSplits).toBeCloseTo(result.total_hours, 0);
    expect(result.hours_by_location.Onsite).toBeCloseTo(result.total_hours * 0.15, 0);
    expect(result.hours_by_location.Offshore_India).toBeCloseTo(result.total_hours * 0.70, 0);
    expect(result.hours_by_location.Nearshore).toBeCloseTo(result.total_hours * 0.15, 0);
  });

  it('maps total hours to Fibonacci story points using the documented buckets', () => {
    expect(compute({ ...baseInputs, entity_changes_count: 0 }).story_points).toBeLessThanOrEqual(3);
    // Force specific hour bands by choosing complexity/change counts that land in known buckets.
    // 6h or less -> 1
    const small = compute({ ...baseInputs });
    expect(small.total_hours).toBeLessThanOrEqual(12);
    expect([1, 2]).toContain(small.story_points);

    // Large integration-heavy complex request should land in a high bucket.
    const large = compute({
      ...baseInputs,
      integration_changes_count: 6,
      gosu_rule_changes_count: 4,
      overall_complexity: 'complex'
    });
    expect(large.total_hours).toBeGreaterThan(96);
    expect([13, 21]).toContain(large.story_points);
  });

  it('widens the confidence band for complex or rating-impacted work, narrows for simple', () => {
    expect(compute({ ...baseInputs, overall_complexity: 'complex' }).confidence_band).toBe('±50%');
    expect(compute({ ...baseInputs, has_rating_impact: true, overall_complexity: 'simple' }).confidence_band).toBe('±50%');
    expect(compute({ ...baseInputs, overall_complexity: 'medium' }).confidence_band).toBe('±35%');
    expect(compute({ ...baseInputs, overall_complexity: 'simple' }).confidence_band).toBe('±20%');
  });

  it('defaults missing change counts to zero without throwing', () => {
    expect(() => compute({ overall_complexity: 'simple', has_rating_impact: false })).not.toThrow();
  });

  it('always includes the methodology and location split assumption strings', () => {
    const result = compute(baseInputs);
    expect(result.methodology).toBeTruthy();
    expect(result.location_split_assumption).toBeTruthy();
  });

  it('defaults to Silver2 (multiplier ×1.00) when assumed_delivery_grade is omitted, preserving prior behaviour', () => {
    const withoutGrade = compute({ ...baseInputs, entity_changes_count: 2 });
    const withSilver2 = compute({ ...baseInputs, entity_changes_count: 2, assumed_delivery_grade: 'Silver2' });
    expect(withoutGrade.assumed_delivery_grade).toBe('Silver2');
    expect(withoutGrade.hours_by_role).toEqual(withSilver2.hours_by_role);
  });

  it('increases Dev/QA/Architect hours for lower grades and decreases them for higher grades, relative to Silver2', () => {
    const silver2 = compute({ ...baseInputs, entity_changes_count: 3, assumed_delivery_grade: 'Silver2' });
    const bronze1 = compute({ ...baseInputs, entity_changes_count: 3, assumed_delivery_grade: 'Bronze1' });
    const gold2 = compute({ ...baseInputs, entity_changes_count: 3, assumed_delivery_grade: 'Gold2' });

    expect(bronze1.hours_by_role.Dev).toBeGreaterThan(silver2.hours_by_role.Dev);
    expect(gold2.hours_by_role.Dev).toBeLessThan(silver2.hours_by_role.Dev);
    expect(bronze1.hours_by_role.QA).toBeGreaterThan(silver2.hours_by_role.QA);
    expect(gold2.hours_by_role.QA).toBeLessThan(silver2.hours_by_role.QA);
    expect(bronze1.hours_by_role.Architect).toBeGreaterThan(silver2.hours_by_role.Architect);
    expect(gold2.hours_by_role.Architect).toBeLessThan(silver2.hours_by_role.Architect);
  });

  it('never adjusts BA hours based on assumed_delivery_grade', () => {
    const silver2 = compute({ ...baseInputs, entity_changes_count: 3, assumed_delivery_grade: 'Silver2' });
    const bronze1 = compute({ ...baseInputs, entity_changes_count: 3, assumed_delivery_grade: 'Bronze1' });
    const gold2 = compute({ ...baseInputs, entity_changes_count: 3, assumed_delivery_grade: 'Gold2' });
    expect(bronze1.hours_by_role.BA).toBe(silver2.hours_by_role.BA);
    expect(gold2.hours_by_role.BA).toBe(silver2.hours_by_role.BA);
  });

  it('falls back to the default grade for an unrecognized assumed_delivery_grade value', () => {
    const result = compute({ ...baseInputs, entity_changes_count: 2, assumed_delivery_grade: 'NotARealGrade' });
    expect(result.assumed_delivery_grade).toBe('Silver2');
  });

  it('discloses the COCOMO-seeded, uncalibrated caveat in methodology only when a non-default grade is selected', () => {
    const defaultResult = compute(baseInputs);
    const goldResult = compute({ ...baseInputs, assumed_delivery_grade: 'Gold1' });
    expect(defaultResult.methodology).not.toMatch(/COCOMO/);
    expect(goldResult.methodology).toMatch(/COCOMO/);
    expect(goldResult.methodology).toMatch(/not calibrated/i);
  });
});
