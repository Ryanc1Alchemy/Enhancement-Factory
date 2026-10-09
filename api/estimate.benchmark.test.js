import { describe, it, expect, beforeAll } from 'vitest';
import { compute } from './estimate.js';
import { BENCHMARK_CASES, DELIVERY_GRADES } from './_lib/benchmark/cases.js';

// Benchmark gate for the Gate 4 estimator. Thresholds come from the
// calibration report's acceptance criteria. References are PROVISIONAL
// (see api/_lib/benchmark/cases.js) — when a reviewer panel or actuals replace
// them, rerun this and treat a failure as a real calibration signal.

const ROLES = ['BA', 'Dev', 'QA', 'Architect'];
const err = (est, ref) => (est - ref) / ref;
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

let rows;

beforeAll(() => {
  rows = BENCHMARK_CASES.map(c => {
    const ctx = { acceptanceCriteria: c.acceptance_criteria };
    const v3ByGrade = DELIVERY_GRADES.map(g => compute({ ...c.inputs, assumed_delivery_grade: g }, ctx));
    const v3 = v3ByGrade[DELIVERY_GRADES.indexOf('Silver2')];
    return {
      c, v3, v3ByGrade,
      eMaster: err(c.baseline_master_s2, c.ref_s2),
      e2: err(c.baseline_v2_s2, c.ref_s2),
      e3: err(v3.total_hours, c.ref_s2)
    };
  });

  // Printed so a run shows the before/after table, not just pass/fail.
  const table = rows.map(r => ({
    case: r.c.id,
    ref_S2: r.c.ref_s2,
    master: r.c.baseline_master_s2,
    v2_wip: r.c.baseline_v2_s2,
    v3_P50: r.v3.total_hours,
    v3_P80: r.v3.p80_hours,
    v3_err: `${Math.round(r.e3 * 100)}%`,
    class: r.v3.feature_class
  }));
  console.table(table);
  console.log(
    `MAPE master ${(mean(rows.map(r => Math.abs(r.eMaster))) * 100).toFixed(1)}% / v2-wip ${(mean(rows.map(r => Math.abs(r.e2))) * 100).toFixed(1)}% -> now ${(mean(rows.map(r => Math.abs(r.e3))) * 100).toFixed(1)}% | ` +
    `bias master ${(mean(rows.map(r => r.eMaster)) * 100).toFixed(1)}% / v2-wip ${(mean(rows.map(r => r.e2)) * 100).toFixed(1)}% -> now ${(mean(rows.map(r => r.e3)) * 100).toFixed(1)}%`
  );
});

describe('Gate 4 estimator benchmark (Silver2 P50 vs frozen baselines)', () => {
  it('MAPE is <= 30% and at least 10 points better than both frozen baselines (master and the v2 attempt)', () => {
    const mapeMaster = mean(rows.map(r => Math.abs(r.eMaster)));
    const mape2 = mean(rows.map(r => Math.abs(r.e2)));
    const mape3 = mean(rows.map(r => Math.abs(r.e3)));
    expect(mape3).toBeLessThanOrEqual(0.30);
    expect(mapeMaster - mape3).toBeGreaterThanOrEqual(0.10);
    expect(mape2 - mape3).toBeGreaterThanOrEqual(0.10);
  });

  it('bias is within +/-15%', () => {
    expect(Math.abs(mean(rows.map(r => r.e3)))).toBeLessThanOrEqual(0.15);
  });

  it('over-shoot rate (> 1.5x reference) is <= 10%', () => {
    const over = rows.filter(r => r.v3.total_hours > 1.5 * r.c.ref_s2).length;
    expect(over / rows.length).toBeLessThanOrEqual(0.10);
  });

  it('under-shoot rate (< 0.7x reference) is <= 10% — the underestimation guard', () => {
    const under = rows.filter(r => r.v3.total_hours < 0.7 * r.c.ref_s2).map(r => r.c.id);
    expect(under.length / rows.length).toBeLessThanOrEqual(0.10);
  });

  it('no integration-heavy or structural item is more than 25% under reference at P50 AND under reference at P80', () => {
    const bad = rows.filter(
      r => ['D_INTEGRATION_HEAVY', 'E_STRUCTURAL_COMPLEX'].includes(r.v3.feature_class) &&
        r.e3 < -0.25 && r.v3.p80_hours < r.c.ref_s2
    );
    expect(bad.map(r => r.c.id)).toEqual([]);
  });

  it('P80 covers at least 70% of references, and P80 >= P50 everywhere', () => {
    const covered = rows.filter(r => r.c.ref_s2 <= r.v3.p80_hours).length;
    expect(covered / rows.length).toBeGreaterThanOrEqual(0.70);
    for (const r of rows) expect(r.v3.p80_hours).toBeGreaterThanOrEqual(r.v3.total_hours);
  });

  it('padding sensitivity: verbose / self-certified variants move P50 by <= 25% versus the clean case', () => {
    const byId = Object.fromEntries(rows.map(r => [r.c.id, r]));
    const padded = rows.filter(r => r.c.padding_of);
    expect(padded.length).toBeGreaterThan(0);
    for (const r of padded) {
      const clean = byId[r.c.padding_of];
      const delta = (r.v3.total_hours - clean.v3.total_hours) / clean.v3.total_hours;
      expect(delta, `${r.c.id} vs ${r.c.padding_of}`).toBeLessThanOrEqual(0.25);
    }
  });

  it('monotonic levels for every case: totals strictly Bronze1 > ... > Gold2, no role ever inverts', () => {
    for (const r of rows) {
      for (let i = 1; i < r.v3ByGrade.length; i++) {
        const prev = r.v3ByGrade[i - 1];
        const cur = r.v3ByGrade[i];
        expect(cur.total_hours, `${r.c.id} ${DELIVERY_GRADES[i]}`).toBeLessThan(prev.total_hours);
        for (const role of ROLES) {
          expect(cur.hours_by_role[role], `${r.c.id} ${DELIVERY_GRADES[i]} ${role}`).toBeLessThanOrEqual(prev.hours_by_role[role]);
        }
      }
    }
  });

  it('every case has a provisional or better reference recorded', () => {
    for (const c of BENCHMARK_CASES) {
      expect(['provisional', 'panel', 'actual']).toContain(c.ref_source);
      expect(c.ref_s2).toBeGreaterThan(0);
      expect(c.baseline_master_s2).toBeGreaterThan(0);
      expect(c.baseline_v2_s2).toBeGreaterThan(0);
    }
  });
});
