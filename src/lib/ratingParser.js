// Rating parser — client-side, no dependencies.
// Covers Guidewire rating configuration: Rate Tables, Rate Routines, Rate
// Factors/Books. Typically exported as XML (rate table definitions) or CSV
// (rate table data rows). Rating logic itself (Gosu rate routines) is text
// source and is captured as an excerpt rather than fully parsed, since rating
// algorithms are highly bespoke per product.
//
// CRITICAL FINDING (verified against real RateBook export XML, e.g.
// "Pet+Product+Rate+book+-+R1.xml" from a live PolicyCenter config export):
// <RateTable> elements in this export format contain ONLY <Checksum>,
// <Definition>, and <QueryStrategy> — never actual factor/rate VALUE rows.
//   - <Definition public-id="..."/> is a reference to a separate
//     <RateTableDefinition> element elsewhere in the same file. That element
//     describes table SCHEMA only: column definitions (e.g. a "Factor"
//     column of type Decimal) and match-operator/parameter definitions
//     (e.g. a "Dog Size" match-op bound to a TypeListValueProvider). It is
//     structural metadata, not rate data.
//   - <Checksum> is an opaque integrity hash string of the row data. It is
//     NOT decodable and does not represent or encode any rate value.
//   - No numeric premium/discount/factor VALUES exist anywhere in this file
//     format. The actual per-cell rate values live only in the runtime
//     Guidewire database (populated/edited via Studio's Rate Table
//     Management UI or a live PolicyCenter environment) — never in this
//     file-based config export.
//
// CONSEQUENCE: no attachable file-based artifact in this project's exports
// can ever ground a claim about actual rating impact (which factors change,
// by how much). This is not a parser defect — parseRatingXml() correctly
// returns factors: [] for this file shape, which is the honest result.
// Any downstream prompt/agent logic must treat rating impact as a
// permanent evidence gap whenever an enhancement request touches rating,
// and must NEVER assert "no rating change is required" or otherwise imply
// rating impact has been assessed — that assertion is not derivable from
// anything available in Guidewire's file-based config exports and must
// always be surfaced to the human as something requiring live-environment
// verification (Rate Management UI / actuarial sign-off), not inferred.

const MAX_SUMMARY_CHARS = 12000;
const MAX_ROWS_PER_TABLE = 50;
const MAX_COLUMNS_LISTED = 20;

export async function parseRatingFile(file) {
  const text = await file.text();
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  let result;
  try {
    if (ext === 'csv') {
      result = parseRateTableCSV(text);
    } else if (ext === 'xml') {
      result = parseRatingXml(text);
    } else if (ext === 'gs' || ext === 'gsx') {
      result = parseRateRoutineSource(text);
    } else {
      const trimmed = text.trim();
      if (trimmed.startsWith('<')) result = parseRatingXml(text);
      else if (trimmed.includes(',') && trimmed.includes('\n')) result = parseRateTableCSV(text);
      else result = parseRateRoutineSource(text);
    }
  } catch (err) {
    result = {
      kind: 'unknown',
      name: file.name,
      parseWarning: `Could not parse "${file.name}" as rating data (${err.message}).`,
      rawExcerpt: text.slice(0, MAX_SUMMARY_CHARS)
    };
  }

  const parseStatus = result.parseWarning
    ? 'failed'
    : (result.kind === 'rateRoutine'
      ? 'structured' // source excerpt is always "found" content for a routine — no tables to fail to detect
      : ((result.columns && result.columns.length > 0) || (result.factors && result.factors.length > 0) ? 'structured' : 'unstructured-fallback'));

  return {
    fileName: file.name,
    fileSizeBytes: file.size,
    parseStatus,
    ...result
  };
}

export async function parseRatingFiles(files) {
  const parsed = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    parsed.push(await parseRatingFile(file));
  }
  return parsed;
}

function parseRateTableCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { kind: 'rateTable', name: 'Unnamed Rate Table', columns: [], sampleRows: [], rawExcerpt: text.slice(0, MAX_SUMMARY_CHARS) };

  const columns = splitCSVLine(lines[0]).slice(0, MAX_COLUMNS_LISTED);
  const sampleRows = lines.slice(1, 1 + MAX_ROWS_PER_TABLE).map(splitCSVLine);

  return { kind: 'rateTable', name: 'Rate Table', columns, sampleRows, rowCount: lines.length - 1 };
}

function splitCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseRatingXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML parse error');

  const root = doc.documentElement;
  const name = root.getAttribute('name') || root.getAttribute('id') || root.tagName;

  const factorNodes = Array.from(doc.querySelectorAll('RateFactor, Factor, rateFactor, factor'));
  const factors = factorNodes.slice(0, MAX_ROWS_PER_TABLE).map(n => ({
    name: n.getAttribute('name') || n.getAttribute('id') || n.textContent.trim(),
    value: n.getAttribute('value') || n.getAttribute('rate') || null
  })).filter(f => f.name);

  if (factors.length === 0) {
    return { kind: 'rating', name, factors: [], rawExcerpt: xml.slice(0, MAX_SUMMARY_CHARS) };
  }

  return { kind: 'rating', name, factors };
}

function parseRateRoutineSource(text) {
  const classMatch = text.match(/class\s+([A-Za-z_][A-Za-z0-9_]*)/);
  const name = classMatch ? classMatch[1] : 'Rate Routine';
  return { kind: 'rateRoutine', name, excerpt: text.slice(0, 2000) };
}

export function buildRatingSummaryForRequest(parsedRatingFiles, requestText) {
  if (!parsedRatingFiles || parsedRatingFiles.length === 0) return null;

  const keywords = extractSimpleKeywords(requestText);
  const scored = parsedRatingFiles.map(r => ({
    item: r,
    score: scoreRatingAgainstKeywords(r, keywords)
  })).sort((a, b) => b.score - a.score);

  const parts = [];
  parts.push(`Rating files attached: ${parsedRatingFiles.length}`);

  for (const { item } of scored) {
    parts.push(`\n--- ${item.kind}: ${item.name} (${item.fileName}) ---`);
    if (item.columns) parts.push(`Columns: ${item.columns.join(', ')}${item.rowCount ? ` (${item.rowCount} rows)` : ''}`);
    if (item.sampleRows && item.sampleRows.length > 0) {
      parts.push(`Sample rows: ${item.sampleRows.slice(0, 5).map(r => r.join('|')).join(' ; ')}`);
    }
    if (item.factors && item.factors.length > 0) {
      parts.push(`Factors: ${item.factors.map(f => `${f.name}${f.value ? `=${f.value}` : ''}`).join(', ')}`);
    }
    if (item.parseWarning) parts.push(`[Parser warning: ${item.parseWarning}]`);
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

function scoreRatingAgainstKeywords(item, keywords) {
  let score = matchScore(item.name, keywords) * 3;
  if (item.columns) for (const c of item.columns) score += matchScore(c, keywords);
  if (item.factors) for (const f of item.factors) score += matchScore(f.name, keywords);
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
