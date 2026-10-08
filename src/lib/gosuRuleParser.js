// Gosu Rule parser — client-side, no dependencies.
// Covers Guidewire business rules: Validation Rules, UW (Underwriting) Rules,
// Activity Patterns, Assignment Rules, Approval Rules, Pre-Update Rules.
// These are typically exported as .gs (Gosu source) files or as rule-set XML.
//
// Design note: rule authoring varies widely (plain Gosu classes, rule DSL
// XML, or enhancement blocks), so this parser extracts whatever structural
// signal is available — class/rule name, category (inferred from file path
// or class annotations), and referenced entities (types used in the file) —
// rather than attempting a full Gosu language parse.

const MAX_SUMMARY_CHARS = 12000;
const MAX_REFERENCED_TYPES = 30;

const RULE_CATEGORY_PATTERNS = [
  { pattern: /validation/i, category: 'Validation Rule' },
  { pattern: /uwissue|underwrit/i, category: 'UW Rule' },
  { pattern: /activitypattern|activity/i, category: 'Activity Pattern' },
  { pattern: /assignment/i, category: 'Assignment Rule' },
  { pattern: /approval/i, category: 'Approval Rule' },
  { pattern: /preupdate|pre-update/i, category: 'Pre-Update Rule' }
];

// Scalar/primitive Gosu type keywords that can appear after a colon in
// declarations (e.g. "var count : int") but are not domain entity/type
// references, so must be excluded from referencedTypes.
const SCALAR_GOSU_TYPES = new Set([
  'boolean', 'string', 'int', 'integer', 'long', 'short', 'byte', 'char',
  'decimal', 'double', 'float', 'date', 'datetime', 'void', 'object',
  'bigdecimal', 'number'
]);

function isScalarGosuType(value) {
  if (!value) return true;
  const lastSegment = value.includes('.') ? value.split('.').pop() : value;
  return SCALAR_GOSU_TYPES.has(lastSegment.toLowerCase());
}

export async function parseGosuRuleFile(file) {
  const text = await file.text();

  let ruleName = null;
  let category = null;

  // Prefer the human-readable name from the @gw.rules.RuleName("...")
  // annotation, if present — this is what Guidewire Studio and business
  // users actually call the rule (e.g. "assign round-robin"). Falling back
  // to the internal Gosu class identifier (e.g. "assignroundrobin") loses
  // the intended human-readable name and makes rule identification in the
  // agent's output far less useful.
  const ruleNameAnnotationMatch = text.match(/@gw\.rules\.RuleName\(\s*"([^"]+)"\s*\)/);
  const classMatch = text.match(/class\s+([A-Za-z_][A-Za-z0-9_]*)/);
  if (ruleNameAnnotationMatch) {
    ruleName = ruleNameAnnotationMatch[1];
  } else if (classMatch) {
    ruleName = classMatch[1];
  }

  // Try filename-based category first, then content-based
  for (const { pattern, category: cat } of RULE_CATEGORY_PATTERNS) {
    if (pattern.test(file.name)) { category = cat; break; }
  }
  if (!category) {
    for (const { pattern, category: cat } of RULE_CATEGORY_PATTERNS) {
      if (pattern.test(text)) { category = cat; break; }
    }
  }

  // Referenced entity types: look for Guidewire-style type references
  // (declared types after a colon, e.g. "var p : Policy" or
  // "var a : entity.Account"). This is a coarse heuristic (regex, not a
  // real Gosu parser) but is enough to give the agent a sense of what
  // entities the rule touches.
  //
  // NOTE: the original regex required an uppercase character immediately
  // after the colon (`:\s*[A-Z]...`), which matches bare capitalized types
  // like "Policy" but NEVER matches dotted package-qualified references
  // like "entity.Account" or "typekey.PETPetType" (which start with a
  // lowercase package segment). Real Guidewire rule source uses dotted
  // references constantly, so the old regex silently produced []. The
  // fixed regex allows a lowercase-leading dotted path and only requires
  // that the type look like a real declared type (letters/digits/
  // underscore/dot), then filters out scalar/primitive keywords.
  const typeRefs = new Set();
  const typeMatches = text.matchAll(/:\s*([A-Za-z_][A-Za-z0-9_.]*)/g);
  for (const m of typeMatches) {
    if (typeRefs.size >= MAX_REFERENCED_TYPES) break;
    const candidate = m[1];
    if (isScalarGosuType(candidate)) continue;
    typeRefs.add(candidate);
  }

  // Description: first block comment or "description" annotation if present
  let description = null;
  const commentMatch = text.match(/\/\*\*([\s\S]*?)\*\//) || text.match(/\/\/\s*(.+)/);
  if (commentMatch) description = commentMatch[1].replace(/\*/g, '').trim().slice(0, 300);

  return {
    fileName: file.name,
    ruleName: ruleName || file.name.replace(/\.(gs|gsx|xml)$/i, ''),
    category: category || 'Unknown Rule Category',
    referencedTypes: Array.from(typeRefs),
    description,
    // parseStatus: rule parsing is regex-based rather than a real Gosu parse,
    // so we can never fully "fail" (no thrown exception path) — but if we
    // extracted a class name, that's a reasonable structured signal; if not,
    // we're relying entirely on the filename, which is unstructured-fallback.
    parseStatus: ruleName ? 'structured' : 'unstructured-fallback',
    excerpt: text.slice(0, 2000) // small excerpt for agent context — full source would be excessive
  };
}

export async function parseGosuRuleFiles(files) {
  const parsed = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    parsed.push(await parseGosuRuleFile(file));
  }
  return parsed;
}

export function buildGosuRuleSummaryForRequest(parsedRules, requestText) {
  if (!parsedRules || parsedRules.length === 0) return null;

  const keywords = extractSimpleKeywords(requestText);
  const scored = parsedRules.map(r => ({
    rule: r,
    score: scoreRuleAgainstKeywords(r, keywords)
  })).sort((a, b) => b.score - a.score);

  const parts = [];
  parts.push(`Gosu Rule files attached: ${parsedRules.length}`);

  for (const { rule } of scored) {
    parts.push(`\n--- Rule: ${rule.ruleName} (${rule.category}) — ${rule.fileName} ---`);
    if (rule.description) parts.push(`Description: ${rule.description}`);
    if (rule.referencedTypes.length > 0) parts.push(`Referenced types: ${rule.referencedTypes.join(', ')}`);
  }

  const joined = parts.join('\n');
  return joined.length > MAX_SUMMARY_CHARS ? joined.slice(0, MAX_SUMMARY_CHARS) + '\n...[truncated]' : joined;
}

function extractSimpleKeywords(text) {
  if (!text) return [];
  const raw = text.match(/[A-Za-z][A-Za-z0-9]*/g) || [];
  const expanded = new Set();
  for (const token of raw) {
    const lower = token.toLowerCase();
    if (lower.length >= 3) expanded.add(lower);
    const subWords = token.match(/[A-Z][a-z0-9]*|[a-z0-9]+/g) || [];
    for (const sw of subWords) {
      if (sw.length >= 3) expanded.add(sw.toLowerCase());
    }
  }
  return Array.from(expanded);
}

function scoreRuleAgainstKeywords(rule, keywords) {
  let score = 0;
  score += matchScore(rule.ruleName, keywords) * 3;
  score += matchScore(rule.category, keywords) * 2;
  score += matchScore(rule.description, keywords);
  for (const t of rule.referencedTypes) score += matchScore(t, keywords);
  return score;
}

function matchScore(text, keywords) {
  if (!text || keywords.length === 0) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower === kw) score += 10;
    else if (lower.includes(kw)) score += 5;
  }
  return score;
}
