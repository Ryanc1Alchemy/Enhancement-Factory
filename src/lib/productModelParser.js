// Product Model parser — client-side, no dependencies.
// Covers Guidewire product model patterns: Coverages, Exclusions, Conditions,
// Modifiers. These are typically exported as XML pattern definitions
// (CoveragePattern, ExclusionPattern, ConditionPattern, ModifierPattern)
// and define the insurable terms available on a policy line.

const MAX_SUMMARY_CHARS = 12000;
const MAX_TERMS_PER_PATTERN = 40;

const PATTERN_TYPE_TAGS = [
  { tag: /coverage/i, kind: 'Coverage' },
  { tag: /exclusion/i, kind: 'Exclusion' },
  { tag: /condition/i, kind: 'Condition' },
  { tag: /modifier/i, kind: 'Modifier' }
];

export async function parseProductModelFile(file) {
  const text = await file.text();
  let result;
  try {
    result = parseProductModelXml(text);
  } catch (err) {
    result = {
      patterns: [],
      parseWarning: `Could not parse "${file.name}" as product model XML (${err.message}).`,
      rawExcerpt: text.slice(0, MAX_SUMMARY_CHARS)
    };
  }
  return {
    fileName: file.name,
    fileSizeBytes: file.size,
    patterns: result.patterns || [],
    parseStatus: result.parseWarning ? 'failed' : ((result.patterns || []).length === 0 ? 'unstructured-fallback' : 'structured'),
    parseWarning: result.parseWarning || null,
    rawExcerpt: result.rawExcerpt || null
  };
}

export async function parseProductModelFiles(files) {
  const parsedFiles = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    parsedFiles.push(await parseProductModelFile(file));
  }
  return mergeProductModelFiles(parsedFiles);
}

function mergeProductModelFiles(parsedFiles) {
  const allPatterns = [];
  const warnings = [];
  const excerpts = [];
  for (const pf of parsedFiles) {
    allPatterns.push(...pf.patterns);
    if (pf.parseWarning) warnings.push(`${pf.fileName}: ${pf.parseWarning}`);
    if (pf.rawExcerpt) excerpts.push(`--- ${pf.fileName} ---\n${pf.rawExcerpt}`);
  }
  return {
    fileNames: parsedFiles.map(pf => pf.fileName),
    patterns: allPatterns,
    parseWarning: warnings.length > 0 ? warnings.join(' | ') : null,
    rawExcerpt: excerpts.length > 0 ? excerpts.join('\n\n').slice(0, MAX_SUMMARY_CHARS) : null
  };
}

function parseProductModelXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML parse error');

  const patterns = [];

  for (const { tag, kind } of PATTERN_TYPE_TAGS) {
    // Match any element whose tag name contains the pattern keyword, e.g.
    // <CoveragePattern>, <ExclusionPattern>, case-insensitively.
    const nodes = Array.from(doc.querySelectorAll('*')).filter(n => tag.test(n.tagName));
    for (const node of nodes) {
      // Real Guidewire product model pattern XML (CoveragePattern,
      // ConditionPattern, ExclusionPattern — confirmed across Pet_Line,
      // WorkersCompLine, and GOCommercialPropertyLine exports) identifies
      // the pattern via "codeIdentifier" and/or "public-id" attributes, NOT
      // "name"/"id"/"code". Those generic attribute names simply don't
      // exist on real pattern elements, so the old lookup silently fell
      // back to the tag name (e.g. "ConditionPattern") for every pattern —
      // losing the actual identifier entirely. codeIdentifier is preferred
      // since it's the stable business-facing code; public-id is the
      // Guidewire internal identifier and used as a secondary fallback.
      const name = node.getAttribute('codeIdentifier') || node.getAttribute('public-id')
        || node.getAttribute('name') || node.getAttribute('id') || node.getAttribute('code') || node.tagName;
      // Real term child elements (verified across the export) are never
      // literally <CovTerm>/<Term>/<ModifierPatternRef> — Guidewire uses
      // typed variants: <CovTermPattern>, <DirectCovTermPattern>,
      // <GenericCovTermPattern>, <OptionCovTermPattern>,
      // <PackageCovTermPattern>, <TypekeyCovTermPattern>. All confirmed
      // variants end in "CovTermPattern", so match on that suffix rather
      // than enumerating every one (protects against variants not yet
      // seen). Like the parent patterns, term identity is codeIdentifier/
      // public-id, NOT name/id — "name" doesn't exist on these elements.
      const termNodes = Array.from(node.querySelectorAll('*')).filter(t => /CovTermPattern$/.test(t.tagName));
      const terms = termNodes
        .slice(0, MAX_TERMS_PER_PATTERN)
        .map(t => t.getAttribute('codeIdentifier') || t.getAttribute('public-id') || t.getAttribute('name') || t.getAttribute('id') || t.textContent.trim())
        .filter(Boolean);
      const category = node.getAttribute('category') || null;
      patterns.push({ kind, name, category, terms });
    }
  }

  if (patterns.length === 0) {
    return { patterns: [], rawExcerpt: xml.slice(0, MAX_SUMMARY_CHARS) };
  }

  return { patterns };
}

export function buildProductModelSummaryForRequest(parsed, requestText) {
  if (!parsed || !parsed.patterns || parsed.patterns.length === 0) return null;

  const keywords = extractSimpleKeywords(requestText);
  const scored = parsed.patterns.map(p => ({
    pattern: p,
    score: scorePatternAgainstKeywords(p, keywords)
  })).sort((a, b) => b.score - a.score);

  const parts = [];
  parts.push(`Product Model patterns found: ${parsed.patterns.length}`);

  for (const { pattern } of scored) {
    parts.push(`\n- [${pattern.kind}] ${pattern.name}${pattern.category ? ` (category: ${pattern.category})` : ''}`);
    if (pattern.terms.length > 0) parts.push(`  Terms: ${pattern.terms.join(', ')}`);
  }

  if (parsed.parseWarning) parts.push(`\n[Parser warning: ${parsed.parseWarning}]`);

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

function scorePatternAgainstKeywords(pattern, keywords) {
  let score = matchScore(pattern.name, keywords) * 3;
  score += matchScore(pattern.kind, keywords);
  for (const t of pattern.terms) score += matchScore(t, keywords);
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
