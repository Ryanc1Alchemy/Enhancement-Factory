// ============================================================
// Display-only hour rounding helpers
// ============================================================
// Gate 5 (Effort Estimate) computes hours internally as decimals so that
// role-hour sums, P80 risk factors, class envelope floors/ceilings and story
// point thresholds all stay precise (see api/estimate.js + the benchmark
// calibration in api/estimate.benchmark.test.js).
//
// BAs reviewing the artifact don't want decimal hours (e.g. "5.3h") — they
// want whole numbers, rounded UP so estimates never look optimistic
// (5.3h -> 6h, 8.8h -> 9h). This module only affects what is DISPLAYED; it
// never changes the underlying computed_estimate object, story points, or
// anything sent to Jira.
// ============================================================

/**
 * Round a single hour value up to the nearest whole hour for display.
 * 0 stays 0. Negative/undefined/NaN values are treated as 0.
 */
export function ceilHours(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
}

/**
 * Round a role -> hours map up to whole hours for display, then reconcile
 * any rounding drift against a separately-rounded total so the displayed
 * role hours always sum exactly to the displayed total (same approach the
 * backend already uses for its own 0.1h rounding).
 *
 * @param {Record<string, number>} hoursByRole  e.g. { BA: 1.4, Dev: 2.6, QA: 3.1, Architect: 0.3 }
 * @param {number} total                        the precise decimal total (e.g. 7.4)
 * @returns {{ hoursByRole: Record<string, number>, total: number }}
 */
export function roundHoursForDisplay(hoursByRole, total) {
  const roles = Object.keys(hoursByRole || {});
  const roundedTotal = ceilHours(total);

  const rounded = {};
  for (const role of roles) rounded[role] = ceilHours(hoursByRole[role]);

  const sum = roles.reduce((s, r) => s + rounded[r], 0);
  const drift = roundedTotal - sum;

  if (drift !== 0 && roles.length > 0) {
    let largest = roles[0];
    for (const role of roles) {
      if (rounded[role] > rounded[largest]) largest = role;
    }
    rounded[largest] = Math.max(0, rounded[largest] + drift);
  }

  return { hoursByRole: rounded, total: roundedTotal };
}
