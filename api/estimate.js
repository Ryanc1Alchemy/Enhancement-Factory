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

  // Floor: every enhancement has minimum overhead (kickoff, code review, deployment)
  const FLOOR = { BA: 2, Dev: 4, QA: 2, Architect: 1 };
  for (const role of roles) {
    if (hours_by_role[role] < FLOOR[role]) hours_by_role[role] = FLOOR[role];
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

  return {
    hours_by_role,
    hours_by_location,
    total_hours,
    story_points: hoursToStoryPoints(total_hours),
    confidence_band: computeConfidenceBand(inputs),
    location_split_assumption: '15% Onsite / 70% Offshore India / 15% Nearshore (NTT DATA AMS default)',
    methodology: 'AMS Engagement Estimator — per-enhancement subset (v1)'
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
