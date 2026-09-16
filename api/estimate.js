import { parseBody, jsonResponse, errorResponse } from './_lib/parseBody.js';

// ============================================================
// Effort Estimator — per-enhancement subset of AMS Engagement Estimator
// ============================================================
// Inputs: complexity inputs from gate 3 (counts of changes + complexity flag)
// Outputs: hours by role × location, total, story points, confidence band
//
// This is the per-enhancement carve-out of the full AMS estimator.
// The full estimator (L2/L3 incident management, 3-year capability plans,
// multi-location FTE modelling) is engagement-level, not per-enhancement,
// and is deliberately deferred to v2.
// ============================================================

// Base hours per change type (BA / Dev / QA / Architect)
const BASE_HOURS = {
  entity_change:      { BA: 1.0, Dev: 4.0, QA: 1.5, Architect: 0.5 },
  typelist_change:    { BA: 0.5, Dev: 1.5, QA: 1.0, Architect: 0.0 },
  pcf_change:         { BA: 1.0, Dev: 3.5, QA: 2.0, Architect: 0.5 },
  gosu_rule_change:   { BA: 1.5, Dev: 5.0, QA: 2.5, Architect: 1.0 },
  integration_change: { BA: 2.0, Dev: 8.0, QA: 4.0, Architect: 2.0 }
};

// Rating impact adds dedicated rating effort (calibration, regression, sign-off)
const RATING_IMPACT_HOURS = { BA: 4, Dev: 12, QA: 8, Architect: 4 };

// Complexity multipliers
const COMPLEXITY_MULTIPLIERS = {
  simple:  0.85,
  medium:  1.00,
  complex: 1.40
};

// Personnel/developer-grade multipliers — seeded from the COCOMO II
// Post-Architecture model's analyst-capability cost driver, mapped onto the
// org's 6-tier Bronze1-Gold2 ladder against COCOMO's 5-tier scale (very low /
// low / nominal / high / very high). Applied ONLY to Dev/QA/Architect hours —
// BA effort does not meaningfully change based on the assigned developer's
// skill level. Silver2 (COCOMO "nominal", multiplier 1.0) is the default, so
// omitting assumed_delivery_grade entirely preserves today's numbers exactly.
//
// IMPORTANT CAVEAT — this is a starting SHAPE, not a calibrated FACT. COCOMO
// II is not calibrated below ~2,000 lines of code (most enhancements here are
// well under that), and even in rigorous application the model's own
// published accuracy is only within ~40% (magnitude of relative error). This
// table should be replaced with real closed-ticket delivery data as soon as
// any exists — see methodology string below, which discloses this whenever a
// non-default grade is selected.
const PERSONNEL_MULTIPLIERS = {
  Bronze1: 1.42, // COCOMO "very low"
  Bronze2: 1.19, // COCOMO "low"
  Silver1: 1.19, // COCOMO "low"
  Silver2: 1.00, // COCOMO "nominal" — default
  Gold1:   0.85, // COCOMO "high"
  Gold2:   0.71  // COCOMO "very high"
};
const DEFAULT_DELIVERY_GRADE = 'Silver2';
const PERSONNEL_MULTIPLIER_ROLES = ['Dev', 'QA', 'Architect']; // BA excluded

// Confidence bands (wider when complexity is higher or rating is involved)
function computeConfidenceBand(inputs) {
  if (inputs.has_rating_impact || inputs.overall_complexity === 'complex') return '±50%';
  if (inputs.overall_complexity === 'medium') return '±35%';
  return '±20%';
}

// Default location split for AMS work (configurable per engagement)
// These are NTT DATA's typical AMS distribution. Editable here for a given demo.
const LOCATION_SPLIT = {
  Onsite:          0.15,
  Offshore_India:  0.70,
  Nearshore:       0.15
};

// Story-point mapping from total hours
function hoursToStoryPoints(totalHours) {
  if (totalHours <= 6)   return 1;
  if (totalHours <= 12)  return 2;
  if (totalHours <= 24)  return 3;
  if (totalHours <= 48)  return 5;
  if (totalHours <= 96)  return 8;
  if (totalHours <= 192) return 13;
  return 21; // flag for split
}

export function compute(inputs) {
  // Aggregate base role hours from change counts
  const roles = ['BA', 'Dev', 'QA', 'Architect'];
  const hours_by_role = { BA: 0, Dev: 0, QA: 0, Architect: 0 };

  const changeMap = {
    entity_change:      inputs.entity_changes_count || 0,
    typelist_change:    inputs.typelist_changes_count || 0,
    pcf_change:         inputs.pcf_changes_count || 0,
    gosu_rule_change:   inputs.gosu_rule_changes_count || 0,
    integration_change: inputs.integration_changes_count || 0
  };

  for (const [changeType, count] of Object.entries(changeMap)) {
    const base = BASE_HOURS[changeType];
    for (const role of roles) {
      hours_by_role[role] += (base[role] || 0) * count;
    }
  }

  // Rating impact adder
  if (inputs.has_rating_impact) {
    for (const role of roles) {
      hours_by_role[role] += RATING_IMPACT_HOURS[role];
    }
  }

  // Apply complexity multiplier
  const mult = COMPLEXITY_MULTIPLIERS[inputs.overall_complexity] || 1.0;
  for (const role of roles) {
    hours_by_role[role] = Math.round(hours_by_role[role] * mult * 10) / 10;
  }

  // Apply personnel/developer-grade multiplier — only to Dev/QA/Architect,
  // never BA (see PERSONNEL_MULTIPLIERS comment above). Grade is a human
  // input selected on the Gate 4 card (not something the agent decides);
  // omitting it entirely defaults to Silver2 (multiplier 1.0), so existing
  // callers that don't pass this see no change in behaviour.
  const assumedGrade = inputs.assumed_delivery_grade && PERSONNEL_MULTIPLIERS[inputs.assumed_delivery_grade]
    ? inputs.assumed_delivery_grade
    : DEFAULT_DELIVERY_GRADE;
  const personnelMult = PERSONNEL_MULTIPLIERS[assumedGrade];
  for (const role of PERSONNEL_MULTIPLIER_ROLES) {
    hours_by_role[role] = Math.round(hours_by_role[role] * personnelMult * 10) / 10;
  }

  // Fixed process overhead — kickoff, PR review wait, deploy coordination.
  // This is ADDED on top of the calculated task hours rather than acting as a
  // floor that overrides them. Previously this was a hard minimum
  // (`if (hours < FLOOR) hours = FLOOR`), which meant a trivial single-typelist
  // change (e.g. ~1.5h Dev pre-adjustment) and a task that genuinely needed
  // 4 hours both collapsed to the exact same displayed number — the floor was
  // silently erasing the real signal BASE_HOURS already captured for small
  // tickets. Making this additive instead keeps task-size signal intact across
  // the full range of ticket sizes while still accounting for the real,
  // non-zero overhead every enhancement carries regardless of size.
  // Added AFTER the complexity multiplier — process overhead doesn't scale
  // with technical complexity the way coding effort does.
  const PROCESS_OVERHEAD_HOURS = { BA: 1, Dev: 1.5, QA: 1, Architect: 0.5 };
  for (const role of roles) {
    hours_by_role[role] = Math.round((hours_by_role[role] + PROCESS_OVERHEAD_HOURS[role]) * 10) / 10;
  }

  // Total
  const total_hours = Math.round(
    roles.reduce((sum, r) => sum + hours_by_role[r], 0) * 10
  ) / 10;

  // Location split — applied to total hours
  const hours_by_location = {
    Onsite:         Math.round(total_hours * LOCATION_SPLIT.Onsite * 10) / 10,
    Offshore_India: Math.round(total_hours * LOCATION_SPLIT.Offshore_India * 10) / 10,
    Nearshore:      Math.round(total_hours * LOCATION_SPLIT.Nearshore * 10) / 10
  };

  const methodologyBase =
    'AMS Engagement Estimator — per-enhancement subset (v1). Base task hours + fixed process overhead ' +
    '(kickoff/PR review/deploy) added per role; overhead no longer acts as a minimum floor, so small ' +
    'changes are sized independently from larger ones.';
  const methodologyGradeNote = assumedGrade === DEFAULT_DELIVERY_GRADE
    ? ` Assumed delivery grade: ${assumedGrade} (default, multiplier ×1.00).`
    : ` Assumed delivery grade: ${assumedGrade} (Dev/QA/Architect hours adjusted ×${personnelMult}). ` +
      'This multiplier is seeded from the COCOMO II personnel-capability cost driver, NOT calibrated ' +
      'against internal delivery data — treat it as a starting shape, not a fact, until real closed-ticket ' +
      'data is available to replace it.';

  return {
    hours_by_role,
    hours_by_location,
    total_hours,
    story_points: hoursToStoryPoints(total_hours),
    confidence_band: computeConfidenceBand(inputs),
    location_split_assumption: '15% Onsite / 70% Offshore India / 15% Nearshore (NTT DATA AMS default)',
    assumed_delivery_grade: assumedGrade,
    methodology: methodologyBase + methodologyGradeNote
  };
}

// HTTP handler — used both as standalone endpoint and called internally by /api/agent.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return errorResponse(res, 405, 'Method not allowed');
  }

  try {
    const body = await parseBody(req);
    const inputs = body.complexity_inputs;
    if (!inputs) {
      return errorResponse(res, 400, 'Missing complexity_inputs in request body');
    }
    const result = compute(inputs);
    return jsonResponse(res, 200, result);
  } catch (err) {
    return errorResponse(res, 500, 'Estimator error', err.message);
  }
}
