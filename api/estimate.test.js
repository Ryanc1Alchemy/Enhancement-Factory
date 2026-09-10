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
  it('applies the floor when all change counts are zero', () => {
    const result = compute(baseInputs);
    // FLOOR = { BA: 2, Dev: 4, QA: 2, Architect: 1 }, medium multiplier = 1.0
    expect(result.hours_by_role).toEqual({ BA: 2, Dev: 4, QA: 2, Architect: 1 });
    expect(result.total_hours).toBe(9);
  });

  it('accumulates base hours per change type before applying multiplier', () => {
    const result = compute({
      ...baseInputs,
      entity_changes_count: 1,
      overall_complexity: 'medium'
    });
    // entity_change base: { BA: 1.0, Dev: 4.0, QA: 1.5, Architect: 0.5 }
    // medium multiplier = 1.0, all above floor except Architect (floor 1) which ties at 0.5 -> floors to 1
    expect(result.hours_by_role.BA).toBe(1 < 2 ? 2 : 1); // BA floors to 2
    expect(result.hours_by_role.Dev).toBe(4); // Dev exactly at floor
    expect(result.hours_by_role.QA).toBe(1.5 < 2 ? 2 : 1.5); // QA floors to 2
    expect(result.hours_by_role.Architect).toBe(1); // 0.5 floors to 1
  });

  it('applies the complexity multiplier to accumulated hours before the floor', () => {
    const simple = compute({ ...baseInputs, entity_changes_count: 5, overall_complexity: 'simple' });
    const medium = compute({ ...baseInputs, entity_changes_count: 5, overall_complexity: 'medium' });
    const complex = compute({ ...baseInputs, entity_changes_count: 5, overall_complexity: 'complex' });

    // 5 entity changes: Dev base = 5 * 4.0 = 20 hours before multiplier
    expect(simple.hours_by_role.Dev).toBeCloseTo(20 * 0.85, 1);
    expect(medium.hours_by_role.Dev).toBeCloseTo(20 * 1.0, 1);
    expect(complex.hours_by_role.Dev).toBeCloseTo(20 * 1.4, 1);
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
    expect(sumOfSplits).toBeCloseTo(result.total_hours, 0);
    expect(result.hours_by_location.Onsite).toBeCloseTo(result.total_hours * 0.15, 1);
    expect(result.hours_by_location.Offshore_India).toBeCloseTo(result.total_hours * 0.70, 1);
    expect(result.hours_by_location.Nearshore).toBeCloseTo(result.total_hours * 0.15, 1);
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
});
