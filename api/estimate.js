import { parseBody, jsonResponse, errorResponse } from './_lib/parseBody.js';

// ============================================================
// Effort Estimator — per-enhancement subset of AMS Engagement Estimator
// ============================================================
// Inputs:  complexity_inputs from the effort_estimate gate (change counts,
//          rating flag, overall complexity, evidence map, assumed grade) plus
//          the APPROVED acceptance criteria (to verify the evidence map).
// Outputs: hours by role × location, P50 total + P80, story points (from P50),
//          tracks, feature class, contingency drivers, confidence band, trace.
//
// Design (see the "Gate 4 Estimation Calibration" report):
//   - Evidence verification: rule/integration/rating work only counts when it
//     is backed by a scenario that exists in the approved acceptance criteria.
//     The agent can no longer confirm its own invented scope.
//   - Rule/integration counts are capped by the number of distinct verified
//     scenarios; anything above that is reported as contingency (P80), not P50.
//   - Rating is confirmed only by explicit `rating_change` evidence.
//   - Feature classes with fixed precedence E -> D -> C -> B -> A, a ceiling
//     for every class, and floors only for verified integration/structural work.
//   - Three tracks: implementation (BA + Dev), validation (QA), governance.
//   - Diminishing returns within a bucket and for scenario count.
//   - Grade curve Bronze1 1.45 ... Gold2 0.74, weighted per role, so
//     Bronze > Silver > Gold holds by construction.
//
// All coefficients are PROVISIONAL (expert judgement) until refitted against
// logged actuals — see api/_lib/benchmark/cases.js and estimate.benchmark.test.js.
// ============================================================

export const ROLES = ['BA', 'Dev', 'QA', 'Architect'];

// Monotonic grade curve: Bronze slower, Gold faster.
export const GRADE_MULTIPLIERS = {
  Bronze1: 1.45,
  Bronze2: 1.25,
  Silver1: 1.10,
  Silver2: 1.00,
  Gold1: 0.86,
  Gold2: 0.74
};
export const DEFAULT_GRADE = 'Silver2';

// How strongly grade affects each role (BA/Architect less grade-sensitive).
const ROLE_GRADE_SENSITIVITY = { BA: 0.25, Dev: 1.0, QA: 0.9, Architect: 0.45 };

// How strongly grade affects each TYPE of work. Experience matters far more
// for Gosu rules, integrations and rating than for adding a typecode, so the
// Bronze-to-Gold gap widens with the work type instead of being one flat ratio.
// PROVISIONAL: replace with values derived from the Capability Self
// Assessment target scores per grade, then from actuals by assignee grade.
export const WORK_TYPE_GRADE_SENSITIVITY = {
  typelist: 0.5,
  pcf: 0.7,
  entity: 0.8,
  gosu: 1.15,
  integration: 1.35,
  rating: 1.15,
  scenario: 0.8,
  conditional: 0.6,
  governance: 0.6,
  general: 1.0
};

function gradeMultiplier(grade, role, workType = 'general') {
  const workSensitivity = WORK_TYPE_GRADE_SENSITIVITY[workType] ?? 1;
  return 1 + (GRADE_MULTIPLIERS[grade] - 1) * ROLE_GRADE_SENSITIVITY[role] * workSensitivity;
}

// Junior levels need a senior to review their build. Charged as senior Dev
// time on the governance track, as a share of implementation Dev hours.
export const SENIOR_REVIEW_SHARE = { Bronze1: 0.15, Bronze2: 0.10, Silver1: 0.05, Silver2: 0, Gold1: 0, Gold2: 0 };

// Config-only changes need far less scenario testing than rule/rating/integration work.
const SCENARIO_QA_CLASS_SCALE = {
  A_CONFIG_MICRO: 0.55,
  B_CONFIG_PLUS_RULES: 0.85,
  C_RATING_CONFIGURABLE: 1.0,
  D_INTEGRATION_HEAVY: 1.0,
  E_STRUCTURAL_COMPLEX: 1.0
};

// Relative size of a change by its design-note change_type (1.0 = typical).
// A brand-new entity is much bigger than extending one with a field; modifying
// an existing rule or integration is smaller than writing a new one.
const CHANGE_TYPE_WEIGHT = {
  entity: { new: 2.0, extended: 1.0, modified: 0.8 },
  typelist: { new: 1.2, extended: 1.0 },
  gosu: { new: 1.0, modified: 0.6 },
  integration: { new: 1.0, modified: 0.55 }
};

// Per first item, by role. Implementation = BA + Dev, validation = QA,
// Architect here = design review of the item itself (governance is separate).
const ITEM_HOURS = {
  typelist:    { BA: 0.3, Dev: 0.9, QA: 0.5, Architect: 0.0 },
  entity:      { BA: 0.6, Dev: 2.0, QA: 0.8, Architect: 0.3 },
  pcf:         { BA: 0.6, Dev: 2.2, QA: 1.0, Architect: 0.0 },
  gosu:        { BA: 0.8, Dev: 3.5, QA: 1.5, Architect: 0.4 },
  integration: { BA: 2.0, Dev: 9.0, QA: 4.5, Architect: 1.2 }
};

// Diminishing returns within a bucket: effective = 1 + d * (n - 1).
// A second typecode in the same typelist is cheap; a second endpoint is not.
const BUCKET_DAMPING = { typelist: 0.5, entity: 0.6, pcf: 0.6, gosu: 0.85, integration: 1.0 };

function effectiveCount(n, bucket) {
  if (!n || n <= 0) return 0;
  return 1 + BUCKET_DAMPING[bucket] * (n - 1);
}

// Complexity applies ONLY to verified rule/integration implementation work —
// never to typelist/entity/PCF config, and never to QA/governance.
const COMPLEXITY_MULTIPLIERS = { simple: 0.9, medium: 1.0, complex: 1.25 };
const COMPLEXITY_BUCKETS = new Set(['gosu', 'integration']);

// Confirmed rating work (rate table/routine change + actuarial test cycle).
const RATING_HOURS = { BA: 1.5, Dev: 5.0, QA: 3.5, Architect: 1.0 };

// Governance: fixed per change by class, not per item.
const GOVERNANCE_HOURS = {
  A_CONFIG_MICRO:           { BA: 0.3, Dev: 0.4,  QA: 0.3, Architect: 0.25 },
  B_CONFIG_PLUS_RULES:      { BA: 0.5, Dev: 0.75, QA: 0.5, Architect: 0.75 },
  C_RATING_CONFIGURABLE:    { BA: 2.0, Dev: 1.0,  QA: 1.0, Architect: 2.0 },
  D_INTEGRATION_HEAVY:      { BA: 1.5, Dev: 2.0,  QA: 1.5, Architect: 4.0 },
  E_STRUCTURAL_COMPLEX:     { BA: 2.0, Dev: 3.0,  QA: 2.0, Architect: 6.0 }
};

// Total-hours envelope at Silver2. Ceilings for every class; floors only for
// D/E, and those classes are only reachable with VERIFIED integration/rules.
const CLASS_ENVELOPE_S2 = {
  A_CONFIG_MICRO:        { floor: 0,   ceiling: 10 },
  B_CONFIG_PLUS_RULES:   { floor: 0,   ceiling: 30 },
  C_RATING_CONFIGURABLE: { floor: 0,   ceiling: 56 },
  D_INTEGRATION_HEAVY:   { floor: 60,  ceiling: 160 },
  E_STRUCTURAL_COMPLEX:  { floor: 120, ceiling: 240 }
};

// The envelope is evaluated at Silver2 (grade-neutral) and the resulting scale
// is applied at every grade — see step 5 in computeCore.
const ENVELOPE_GRADE_BLEND = 0.8;
function envelopeFor(featureClass, grade) {
  const base = CLASS_ENVELOPE_S2[featureClass];
  const k = 1 + (GRADE_MULTIPLIERS[grade] - 1) * ENVELOPE_GRADE_BLEND;
  return { floor: base.floor * k, ceiling: base.ceiling * k };
}

// QA scenario term with diminishing returns: 4 -> 8 scenarios adds ~0.6h.
function scenarioQaHours(edgeNegativeCount) {
  return 0.75 + 0.6 * Math.log2(1 + Math.max(0, edgeNegativeCount));
}

// ---------- evidence verification ----------

export function normaliseTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titlesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // Tolerate the LLM truncating or lightly extending a title, but only for
  // titles long enough that containment is meaningful.
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 12 && longer.includes(shorter);
}

/**
 * Check each complexity_evidence entry against the approved acceptance
 * criteria. Entries whose scenario_title is not an approved scenario are
 * dropped. When no acceptance criteria are supplied (e.g. a direct API call),
 * evidence is accepted as-is and the trace says so.
 */
export function verifyEvidence(inputs, acceptanceCriteria) {
  const entries = Array.isArray(inputs?.complexity_evidence?.confirmed_by_scenario)
    ? inputs.complexity_evidence.confirmed_by_scenario
    : [];
  const approved = Array.isArray(acceptanceCriteria?.scenarios) ? acceptanceCriteria.scenarios : null;

  const verifiedTitlesByImpact = {};
  const dropped = [];
  const verified = [];

  for (const entry of entries) {
    const title = normaliseTitle(entry?.scenario_title);
    const impacts = Array.isArray(entry?.impacts) ? entry.impacts : [];
    let ok = true;
    if (approved) {
      ok = approved.some(sc => titlesMatch(normaliseTitle(sc?.title), title));
    }
    if (!ok) {
      dropped.push({ scenario_title: entry?.scenario_title || '', impacts, reason: 'not an approved acceptance criteria scenario' });
      continue;
    }
    verified.push({ scenario_title: entry?.scenario_title || '', impacts });
    for (const impact of impacts) {
      if (!verifiedTitlesByImpact[impact]) verifiedTitlesByImpact[impact] = new Set();
      verifiedTitlesByImpact[impact].add(title);
    }
  }

  const verifiedCount = impact => (verifiedTitlesByImpact[impact] ? verifiedTitlesByImpact[impact].size : 0);

  // Distinct edge/negative scenarios drive the QA scenario term. Prefer the
  // approved AC itself; fall back to the evidence entries.
  let edgeNegativeCount;
  if (approved) {
    const seen = new Set();
    for (const sc of approved) {
      if (sc?.type === 'edge_case' || sc?.type === 'negative') seen.add(normaliseTitle(sc.title));
    }
    edgeNegativeCount = seen.size;
  } else {
    const seen = new Set();
    for (const entry of entries) {
      if (entry?.scenario_type === 'edge_case' || entry?.scenario_type === 'negative') seen.add(normaliseTitle(entry.scenario_title));
    }
    edgeNegativeCount = seen.size;
  }

  return {
    mode: approved ? 'verified_against_acceptance_criteria' : 'unverified_no_acceptance_criteria_supplied',
    verified,
    dropped,
    verifiedCount,
    edgeNegativeCount
  };
}

// ---------- classification ----------

export function classifyFeature(c, ratingConfirmed) {
  // Fixed precedence, most expensive first, so nothing falls through by accident.
  if (c.entity >= 3 && c.pcf >= 3 && (c.gosu >= 2 || c.integration >= 1)) return 'E_STRUCTURAL_COMPLEX';
  if (c.integration >= 1) return 'D_INTEGRATION_HEAVY';
  if (ratingConfirmed) return 'C_RATING_CONFIGURABLE';
  if (c.gosu >= 1 || c.entity > 1 || c.pcf > 2 || c.typelist > 4) return 'B_CONFIG_PLUS_RULES';
  return 'A_CONFIG_MICRO';
}

// ---------- output helpers ----------

function round1(v) {
  return Math.round(v * 10) / 10;
}

function confidenceBand(featureClass, unverifiedDrivers) {
  if (unverifiedDrivers >= 3 || featureClass === 'D_INTEGRATION_HEAVY' || featureClass === 'E_STRUCTURAL_COMPLEX') return '±50%';
  if (unverifiedDrivers >= 1 || featureClass === 'C_RATING_CONFIGURABLE') return '±35%';
  return '±20%';
}

// ---------- main ----------

// ---------- design note scope ----------

const DESIGN_NOTE_BUCKETS = {
  typelist: 'typelist_changes',
  entity: 'entity_changes',
  pcf: 'pcf_changes',
  gosu: 'gosu_rule_changes',
  integration: 'integration_changes'
};

function itemLabel(bucket, item) {
  return item?.typelist || item?.entity || item?.pcf || item?.rule_name || item?.integration || bucket;
}

/**
 * Read the approved design note (Gate 3) and split each bucket into items that
 * are REQUIRED to deliver the request and items that are only CONDITIONAL
 * (things to check, or needed only if something unconfirmed is true).
 * Items without a certainty field (older design notes) count as required.
 * Returns null when no design note is supplied (counts are then not capped).
 */
export function readDesignNoteScope(designNote) {
  if (!designNote || typeof designNote !== 'object') return null;
  const required = {};
  const conditional = {};
  const weight = {};
  const newRequiredIntegrations = [];
  for (const [bucket, key] of Object.entries(DESIGN_NOTE_BUCKETS)) {
    const items = Array.isArray(designNote[key]) ? designNote[key] : [];
    const req = items.filter(it => it?.certainty !== 'conditional');
    const cond = items.filter(it => it?.certainty === 'conditional');
    // A typelist item can add several codes; each code is a change.
    required[bucket] = bucket === 'typelist'
      ? req.reduce((n, it) => n + Math.max(1, Array.isArray(it?.new_codes) ? it.new_codes.length : 1), 0)
      : req.length;
    conditional[bucket] = cond.map(it => itemLabel(bucket, it));
    const table = CHANGE_TYPE_WEIGHT[bucket];
    weight[bucket] = table && req.length > 0
      ? req.reduce((sum, it) => sum + (table[it?.change_type] ?? 1), 0) / req.length
      : 1;
    if (bucket === 'integration') {
      for (const it of req) if (it?.change_type === 'new') newRequiredIntegrations.push(itemLabel(bucket, it));
    }
  }
  const ri = designNote.rating_impact || {};
  let rating = 'none';
  if (ri.has_rating_impact) {
    rating = ri.certainty === 'conditional' ? 'conditional' : ri.certainty === 'none' ? 'none' : 'required';
  }
  return { required, conditional, weight, newRequiredIntegrations, rating };
}

// Checking a conditional item (does this rule / screen / integration need to
// change?) costs analysis + a quick test, not a build. Diminishing returns.
const CONDITIONAL_CHECK_HOURS = { BA: 0.25, QA: 0.35 };

/**
 * @param {object} inputs  complexity_inputs from the effort_estimate gate
 * @param {object} [context]
 * @param {object} [context.acceptanceCriteria]  approved acceptance_criteria artifact ({ scenarios: [...] })
 * @param {object} [context.designNote]  approved design_note artifact (caps counts at REQUIRED items)
 */
function computeCore(inputs, context = {}) {
  const grade = inputs?.assumed_delivery_grade && GRADE_MULTIPLIERS[inputs.assumed_delivery_grade]
    ? inputs.assumed_delivery_grade
    : DEFAULT_GRADE;

  const evidence = verifyEvidence(inputs, context.acceptanceCriteria);

  const claimed = {
    typelist: inputs?.typelist_changes_count || 0,
    entity: inputs?.entity_changes_count || 0,
    pcf: inputs?.pcf_changes_count || 0,
    gosu: inputs?.gosu_rule_changes_count || 0,
    integration: inputs?.integration_changes_count || 0
  };

  const scope = readDesignNoteScope(context.designNote);
  const capByDesign = bucket => (scope ? Math.min(claimed[bucket], scope.required[bucket]) : claimed[bucket]);

  // Every bucket is capped at the number of REQUIRED design note items (when a
  // design note is supplied). Rules and integrations are additionally capped by
  // the number of distinct verified acceptance-criteria scenarios.
  const counts = {
    typelist: capByDesign('typelist'),
    entity: capByDesign('entity'),
    pcf: capByDesign('pcf'),
    gosu: Math.min(capByDesign('gosu'), evidence.verifiedCount('gosu_rule_change')),
    integration: Math.min(capByDesign('integration'), evidence.verifiedCount('integration_change'))
  };

  const ratingClaimed = !!inputs?.has_rating_impact;
  const ratingRequiredByDesign = !scope || scope.rating === 'required';
  const ratingConfirmed = ratingClaimed && ratingRequiredByDesign && evidence.verifiedCount('rating_change') > 0;
  const ratingConditional = (scope && scope.rating === 'conditional') || (ratingClaimed && !ratingConfirmed);

  const contingencyDrivers = [];
  let unverifiedDrivers = 0;
  for (const bucket of Object.keys(DESIGN_NOTE_BUCKETS)) {
    const overClaim = claimed[bucket] - counts[bucket];
    if (overClaim > 0) {
      const why = scope && claimed[bucket] > scope.required[bucket]
        ? 'beyond the required items in the design note'
        : 'not backed by an approved scenario';
      contingencyDrivers.push(`${overClaim} ${bucket} change(s) claimed ${why}`);
      unverifiedDrivers += overClaim;
    }
  }
  const conditionalItems = [];
  if (scope) {
    for (const [bucket, labels] of Object.entries(scope.conditional)) {
      for (const label of labels) conditionalItems.push({ bucket, label });
    }
    for (const it of conditionalItems) contingencyDrivers.push(`Conditional ${it.bucket}: ${it.label} (only if unconfirmed assumption holds)`);
    unverifiedDrivers += conditionalItems.length;
  }
  if (ratingConditional) {
    contingencyDrivers.push('Rating impact possible but not confirmed as required (needs live Rate Management / actuarial check)');
    unverifiedDrivers += 1;
  }

  const featureClass = classifyFeature(counts, ratingConfirmed);
  const complexityMult = COMPLEXITY_MULTIPLIERS[inputs?.overall_complexity] || 1.0;

  // Steps 1-4b build hours for one grade. Run once at Silver2 (grade-neutral)
  // to decide any class floor/ceiling adjustment, then at the requested grade.
  const buildHours = g => {
    const tracks = {
      implementation: { BA: 0, Dev: 0 },
      validation: { QA: 0 },
      governance: { BA: 0, Dev: 0, QA: 0, Architect: 0 }
    };
    const hours = { BA: 0, Dev: 0, QA: 0, Architect: 0 };
    const tr = { buckets: {} };
    const add = (role, value, track) => {
      hours[role] += value;
      if (track === 'implementation') tracks.implementation[role] += value;
      else if (track === 'validation') tracks.validation.QA += value;
      else tracks.governance[role] += value;
    };

    // 1. Per-bucket item work.
    for (const bucket of Object.keys(ITEM_HOURS)) {
      const n = counts[bucket];
      if (!n) continue;
      const eff = effectiveCount(n, bucket);
      const cm = COMPLEXITY_BUCKETS.has(bucket) ? complexityMult : 1;
      const base = ITEM_HOURS[bucket];
      // new vs extended/modified (from the design note); QA is only half as sensitive.
      const w = scope ? scope.weight[bucket] ?? 1 : 1;
      const byRole = {};
      for (const role of ROLES) {
        const roleCm = role === 'QA' ? 1 : cm;
        const roleW = role === 'QA' ? 0.5 + 0.5 * w : w;
        const h = base[role] * eff * roleCm * roleW * gradeMultiplier(g, role, bucket);
        byRole[role] = Math.round(h * 100) / 100;
        if (role === 'QA') add('QA', h, 'validation');
        else if (role === 'Architect') add('Architect', h, 'governance');
        else add(role, h, 'implementation');
      }
      tr.buckets[bucket] = { count: n, effective_count: Math.round(eff * 100) / 100, change_type_weight: Math.round(w * 100) / 100, by_role: byRole };
    }

    // 2. Scenario-driven QA with diminishing returns.
    const scenarioQa = scenarioQaHours(evidence.edgeNegativeCount) * SCENARIO_QA_CLASS_SCALE[featureClass] * gradeMultiplier(g, 'QA', 'scenario');
    add('QA', scenarioQa, 'validation');
    tr.scenario_qa = { edge_negative_scenarios: evidence.edgeNegativeCount, hours: Math.round(scenarioQa * 100) / 100 };

    // 2b. Checking conditional items (analysis + a quick test each, damped).
    if (conditionalItems.length > 0) {
      const n = conditionalItems.length;
      const eff = 1 + 0.5 * (n - 1);
      const ba = CONDITIONAL_CHECK_HOURS.BA * eff * gradeMultiplier(g, 'BA', 'conditional');
      const qa = CONDITIONAL_CHECK_HOURS.QA * eff * gradeMultiplier(g, 'QA', 'conditional');
      add('BA', ba, 'implementation');
      add('QA', qa, 'validation');
      tr.conditional_checks = { items: n, hours: Math.round((ba + qa) * 100) / 100 };
    }

    // 3. Confirmed rating work only.
    if (ratingConfirmed) {
      for (const role of ROLES) {
        const h = RATING_HOURS[role] * gradeMultiplier(g, role, 'rating');
        if (role === 'QA') add('QA', h, 'validation');
        else if (role === 'Architect') add('Architect', h, 'governance');
        else add(role, h, 'implementation');
      }
      tr.rating_hours = { ...RATING_HOURS };
    }

    // 4. Governance, fixed per class.
    const gov = GOVERNANCE_HOURS[featureClass];
    for (const role of ROLES) {
      add(role, gov[role] * gradeMultiplier(g, role, 'governance'), 'governance');
    }
    tr.governance_hours_base = { ...gov };

    // 4b. Senior review of junior build work.
    const reviewShare = SENIOR_REVIEW_SHARE[g] || 0;
    if (reviewShare > 0) {
      const review = tracks.implementation.Dev * reviewShare;
      add('Dev', review, 'governance');
      tr.senior_review = { share: reviewShare, hours: Math.round(review * 100) / 100 };
    }
    return { hours, tracks, tr };
  };

  const trace = {
    mode: 'evidence_verified',
    assumed_delivery_grade: grade,
    feature_class: featureClass,
    claimed_counts: claimed,
    verified_counts: counts,
    rating: { claimed: ratingClaimed, confirmed: ratingConfirmed, design_note: scope ? scope.rating : 'not_supplied' },
    design_note_scope: scope
      ? { required: scope.required, conditional_items: conditionalItems.length, new_required_integrations: scope.newRequiredIntegrations }
      : 'not_supplied',
    evidence_verification: {
      mode: evidence.mode,
      verified_entries: evidence.verified.length,
      dropped_entries: evidence.dropped
    },
    complexity_multiplier: complexityMult,
    buckets: {}
  };

  const built = buildHours(grade);
  const { hours, tracks } = built;
  Object.assign(trace, built.tr);

  // 5. Class envelope: ceilings always, floors only for verified D/E.
  // Decided ONCE on the grade-neutral (Silver2) total, and the same scale is
  // applied at every grade, so Bronze > Silver > Gold holds for every role.
  const neutral = buildHours(DEFAULT_GRADE);
  const rawTotalS2 = ROLES.reduce((s, r) => s + neutral.hours[r], 0);
  const rawTotal = ROLES.reduce((s, r) => s + hours[r], 0);
  const env = envelopeFor(featureClass, DEFAULT_GRADE);
  let scale = 1;
  if (rawTotalS2 > env.ceiling) scale = env.ceiling / rawTotalS2;
  // Floors guard against underestimating genuinely large work, so they only
  // apply when the design note REQUIRES it: a new integration for class D, or
  // required counts that reach class E. Without a design note (direct API
  // calls) the verified counts are trusted.
  const floorAllowed = !scope ||
    (featureClass === 'D_INTEGRATION_HEAVY' && scope.newRequiredIntegrations.length > 0) ||
    featureClass === 'E_STRUCTURAL_COMPLEX';
  if (rawTotalS2 <= env.ceiling && env.floor > 0 && floorAllowed && rawTotalS2 < env.floor) scale = env.floor / rawTotalS2;
  if (scale !== 1) {
    for (const role of ROLES) hours[role] *= scale;
    for (const role of Object.keys(tracks.implementation)) tracks.implementation[role] *= scale;
    tracks.validation.QA *= scale;
    for (const role of ROLES) tracks.governance[role] *= scale;
  }
  trace.class_envelope = {
    basis: 'Silver2 (grade-neutral); same scale applied at every grade',
    floor_s2: round1(env.floor),
    ceiling_s2: round1(env.ceiling),
    raw_total_s2: round1(rawTotalS2),
    raw_total: round1(rawTotal),
    applied: scale === 1 ? 'none' : scale < 1 ? 'ceiling' : 'floor',
    floor_allowed: floorAllowed,
    scale: Math.round(scale * 1000) / 1000
  };

  // Round roles to 0.1h, then push any rounding drift onto the largest role so
  // the roles always sum exactly to the rounded total (keeps floors/ceilings exact).
  const hours_by_role = {};
  for (const role of ROLES) hours_by_role[role] = round1(hours[role]);
  const total_hours = round1(ROLES.reduce((s, r) => s + hours[r], 0));
  const drift = round1(total_hours - ROLES.reduce((s, r) => s + hours_by_role[r], 0));
  if (drift !== 0) {
    const largest = ROLES.reduce((a, b) => (hours_by_role[b] > hours_by_role[a] ? b : a), ROLES[0]);
    hours_by_role[largest] = round1(hours_by_role[largest] + drift);
  }

  const p80Factor = 1.25 + 0.1 * Math.min(unverifiedDrivers, 4);
  const p80_hours = round1(total_hours * p80Factor);

  const trackTotals = {
    implementation: round1(tracks.implementation.BA + tracks.implementation.Dev),
    validation: round1(tracks.validation.QA),
    governance: round1(ROLES.reduce((s, r) => s + tracks.governance[r], 0))
  };
  trace.tracks = trackTotals;
  trace.p80_factor = p80Factor;

  return {
    estimator_version: 'v3',
    hours_by_role,
    total_hours,
    p80_hours,
    tracks: trackTotals,
    feature_class: featureClass,
    contingency_drivers: contingencyDrivers,
    assumptions: Array.isArray(inputs?.complexity_evidence?.assumptions) ? inputs.complexity_evidence.assumptions : [],
    confidence_band: confidenceBand(featureClass, unverifiedDrivers),
    assumed_delivery_grade: grade,
    calculation_trace: trace
  };
}

// ---------- delivery outputs ----------

// Default location split for AMS work (configurable per engagement)
// These are NTT DATA's typical AMS distribution. Editable here for a given demo.
const LOCATION_SPLIT = {
  Onsite:          0.15,
  Offshore_India:  0.70,
  Nearshore:       0.15
};

// Story-point mapping from total hours
export function hoursToStoryPoints(totalHours) {
  if (totalHours <= 6)   return 1;
  if (totalHours <= 12)  return 2;
  if (totalHours <= 24)  return 3;
  if (totalHours <= 48)  return 5;
  if (totalHours <= 96)  return 8;
  if (totalHours <= 192) return 13;
  return 21; // flag for split
}

/**
 * Public entry point used by /api/agent.js and the /api/estimate endpoint.
 * @param {object} inputs   complexity_inputs (may include assumed_delivery_grade)
 * @param {object} [context]
 * @param {object} [context.acceptanceCriteria] approved acceptance_criteria artifact ({ scenarios: [...] })
 * @param {object} [context.designNote] approved design_note artifact
 */
export function compute(inputs, context = {}) {
  const core = computeCore(inputs || {}, context);
  // Every level at once, so a one-line request returns Bronze1 ... Gold2 in a
  // single estimate. The headline (total_hours, story_points) stays at the
  // assumed grade, which is what flows into Jira.
  const estimates_by_grade = Object.keys(GRADE_MULTIPLIERS).map(g => {
    const r = g === core.assumed_delivery_grade ? core : computeCore({ ...(inputs || {}), assumed_delivery_grade: g }, context);
    return {
      grade: g,
      total_hours: r.total_hours,
      p80_hours: r.p80_hours,
      story_points: hoursToStoryPoints(r.total_hours),
      hours_by_role: r.hours_by_role
    };
  });
  const total = core.total_hours;
  const methodology =
    'AMS Engagement Estimator — per-enhancement subset. Evidence-verified counts (rules, integrations and rating only ' +
    'count when backed by an approved acceptance-criteria scenario), class ceilings, diminishing returns, and ' +
    'implementation / validation / governance tracks. Headline hours are P50; P80 adds unverified risk.' +
    (core.assumed_delivery_grade === DEFAULT_GRADE
      ? ` Assumed delivery grade: ${core.assumed_delivery_grade} (default).`
      : ` Assumed delivery grade: ${core.assumed_delivery_grade} (Bronze slower, Gold faster).`);
  return {
    ...core,
    hours_by_location: {
      Onsite:         Math.round(total * LOCATION_SPLIT.Onsite * 10) / 10,
      Offshore_India: Math.round(total * LOCATION_SPLIT.Offshore_India * 10) / 10,
      Nearshore:      Math.round(total * LOCATION_SPLIT.Nearshore * 10) / 10
    },
    story_points: hoursToStoryPoints(total),
    estimates_by_grade,
    location_split_assumption: '15% Onsite / 70% Offshore India / 15% Nearshore (NTT DATA AMS default)',
    methodology
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
    // acceptance_criteria is optional for older clients; without it the
    // evidence map cannot be verified and the trace says so.
    const result = compute(inputs, { acceptanceCriteria: body.acceptance_criteria, designNote: body.design_note });
    return jsonResponse(res, 200, result);
  } catch (err) {
    return errorResponse(res, 500, 'Estimator error', err.message);
  }
}
