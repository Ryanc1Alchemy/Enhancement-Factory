// Data Dictionary file parser — client-side, no dependencies.
// Accepts a Guidewire data dictionary export in HTML, JSON, XML, or CSV form
// (or falls back to plain text) and extracts a best-effort structured summary
// of entities, fields, and typelists. This gives gate 1 (and later gates)
// grounding in the client's ACTUAL data model instead of generic assumptions.
//
// Design note: Guidewire's "Export Data Dictionary" feature does not have one
// fixed shape across versions/configs, so every parser below is heuristic.
// The goal is graceful degradation — if we can't detect structure, we still
// hand the agent a readable (truncated) text excerpt rather than nothing.

const MAX_SUMMARY_CHARS = 16000;
const MAX_FIELDS_PER_ENTITY = 60;
const MAX_CODES_PER_TYPELIST = 60;
// No hard cap on total entities/typelists captured during parsing — real Guidewire
// data dictionaries can have thousands of entities. We keep everything parsed and
// instead do RELEVANCE-based selection at summary-build time (see
// buildDictionarySummaryForRequest), so entities/typelists that actually matter to
// the enhancement request are never silently truncated out just because they sort
// late alphabetically or come after the Nth item in document order.
const MAX_RELEVANT_ENTITIES_DETAILED = 25;
const MAX_RELEVANT_TYPELISTS_DETAILED = 15;
const MAX_OTHER_NAMES_LISTED = 300;

export async function parseDataDictionaryFile(file) {
  const text = await file.text();
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  let result;

  try {
    if (ext === 'json') {
      result = parseJSON(text);
    } else if (ext === 'html' || ext === 'htm') {
      result = parseHTML(text);
    } else if (ext === 'xml') {
      result = parseXML(text);
    } else if (ext === 'csv') {
      result = parseCSV(text);
    } else if (ext === 'md' || ext === 'markdown') {
      result = parseMarkdown(text);
    } else {
      // Unknown extension (includes .txt — this covers files like
      // "html-to-markdown.md.txt" whose real extension got double-suffixed,
      // and any other export tool that doesn't set a "proper" extension) —
      // sniff the actual content instead of trusting the file extension.
      const trimmed = text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        result = parseJSON(text);
      } else if (trimmed.startsWith('<')) {
        // Could be HTML or XML — HTML parser is more forgiving, try it first
        result = looksLikeHTML(trimmed) ? parseHTML(text) : parseXML(text);
      } else if (looksLikeMarkdown(text)) {
        result = parseMarkdown(text);
      } else if (trimmed.includes(',') && trimmed.includes('\n')) {
        result = parseCSV(text);
      } else {
        result = parseFallbackText(text);
      }
    }
  } catch (err) {
    result = {
      entities: [],
      typelists: [],
      parseWarning: `Could not fully parse "${file.name}" as structured data (${err.message}). Falling back to raw text excerpt.`,
      rawExcerpt: text.slice(0, MAX_SUMMARY_CHARS)
    };
  }

  // ---------- parseStatus tri-state ----------
  // This is the single most important field in the return shape. Downstream
  // consumers (buildDictionarySummaryForRequest, the agent prompt, the UI)
  // MUST be able to distinguish "we structurally parsed this file and found
  // nothing relevant" from "we could not parse this file's structure at all
  // and are just showing a raw text excerpt." Without this distinction, an
  // 854KB single-line file with no delimiters silently returns
  // {entities:[], typelists:[]} — indistinguishable from a genuinely empty
  // dictionary — and the agent will confidently assert "not found" using an
  // excerpt that never had any chance of containing the answer.
  //
  //   'structured'            — at least one entity or typelist was extracted
  //                              via real structural parsing (tables, XML
  //                              nodes, JSON shape, etc). Safe to treat
  //                              absence of a term as evidence of absence.
  //   'unstructured-fallback' — the parser ran without throwing, but could
  //                              not recognise ANY structure (no tables, no
  //                              recognisable XML/JSON shape) and fell back
  //                              to a raw text excerpt. Absence of a term in
  //                              the excerpt is NOT evidence it doesn't exist
  //                              elsewhere in the file — the excerpt is a
  //                              truncated, arbitrary slice.
  //   'failed'                — an exception was thrown during parsing
  //                              (e.g. malformed XML). Same caution as above.
  let parseStatus;
  if (result.parseWarning && result.rawExcerpt && (!result.entities || result.entities.length === 0) && (!result.typelists || result.typelists.length === 0)) {
    // parseWarning is only set by the catch block (thrown exception) or by
    // structural parsers that explicitly detected failure — either way this
    // is the "failed" path, distinct from a parser that simply found no tables.
    parseStatus = 'failed';
  } else if ((result.entities || []).length === 0 && (result.typelists || []).length === 0) {
    parseStatus = 'unstructured-fallback';
  } else {
    parseStatus = 'structured';
  }

  return {
    fileName: file.name,
    fileType: ext || 'unknown',
    fileSizeBytes: file.size,
    // No slicing here — real Guidewire exports can have thousands of entities.
    // Relevance-based selection happens later, per-request, via
    // buildDictionarySummaryForRequest(). Capping here would silently drop
    // exactly the entities the user cares about (e.g. custom "PETPets").
    entities: result.entities || [],
    typelists: result.typelists || [],
    parseStatus,
    parseWarning: result.parseWarning || null,
    rawExcerpt: result.rawExcerpt || null
  };
}

// Parse multiple files and merge into a single combined dictionary context.
// Entities/typelists are concatenated (de-duplicated by name, first-wins) so the
// agent sees one coherent model even if the client uploads e.g. a PolicyCenter
// export and a ClaimCenter export together.
export async function parseDataDictionaryFiles(files) {
  const parsedFiles = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const parsed = await parseDataDictionaryFile(file);
    parsedFiles.push(parsed);
  }
  return mergeParsedDictionaries(parsedFiles);
}

export function mergeParsedDictionaries(parsedFiles) {
  if (!parsedFiles || parsedFiles.length === 0) return null;
  if (parsedFiles.length === 1) {
    return { ...parsedFiles[0], fileNames: [parsedFiles[0].fileName], sourceFiles: parsedFiles };
  }

  const entityMap = new Map();
  const typelistMap = new Map();
  const warnings = [];
  const rawExcerpts = [];

  for (const pf of parsedFiles) {
    for (const e of pf.entities || []) {
      if (!entityMap.has(e.name)) entityMap.set(e.name, e);
    }
    for (const t of pf.typelists || []) {
      if (!typelistMap.has(t.name)) typelistMap.set(t.name, t);
    }
    if (pf.parseWarning) warnings.push(`${pf.fileName}: ${pf.parseWarning}`);
    if (pf.rawExcerpt) rawExcerpts.push(`--- ${pf.fileName} ---\n${pf.rawExcerpt}`);
  }

  const mergedEntities = Array.from(entityMap.values());
  const mergedTypelists = Array.from(typelistMap.values());
  const fileNames = parsedFiles.map(pf => pf.fileName);

  // Merged parseStatus: if ANY source file fell back to unstructured/failed,
  // the merged bundle as a whole cannot be trusted as fully authoritative —
  // report the worst status present, and keep a per-file breakdown so callers
  // can identify exactly which file(s) need attention.
  const statusRank = { structured: 0, 'unstructured-fallback': 1, failed: 2 };
  const worstStatus = parsedFiles.reduce((worst, pf) => {
    const s = pf.parseStatus || 'structured';
    return statusRank[s] > statusRank[worst] ? s : worst;
  }, 'structured');

  return {
    fileName: fileNames.join(', '),
    fileNames,
    fileType: 'multiple',
    fileSizeBytes: parsedFiles.reduce((sum, pf) => sum + (pf.fileSizeBytes || 0), 0),
    entities: mergedEntities,
    typelists: mergedTypelists,
    parseStatus: worstStatus,
    fileParseStatuses: parsedFiles.map(pf => ({ fileName: pf.fileName, parseStatus: pf.parseStatus || 'structured' })),
    parseWarning: warnings.length > 0 ? warnings.join(' | ') : null,
    rawExcerpt: rawExcerpts.length > 0 ? rawExcerpts.join('\n\n').slice(0, MAX_SUMMARY_CHARS) : null,
    sourceFiles: parsedFiles
  };
}

function looksLikeHTML(trimmed) {
  return /<html|<table|<!doctype html/i.test(trimmed);
}

// ---------- JSON ----------
function parseJSON(text) {
  const data = JSON.parse(text);
  const entities = [];
  const typelists = [];

  // Heuristic shapes we try to handle:
  // 1. { entities: [ { name, fields: [ { name, type } ] } ], typelists: [...] }
  // 2. { "EntityName": { "fieldName": "type", ... }, ... }
  // 3. [ { entity: "...", field: "...", type: "..." }, ... ]  (flat rows)

  if (Array.isArray(data)) {
    // Shape 3: flat array of rows
    const byEntity = new Map();
    for (const row of data) {
      const entityName = row.entity || row.Entity || row.entityName || row.table || row.Table;
      const fieldName = row.field || row.Field || row.fieldName || row.column || row.Column;
      const type = row.type || row.Type || row.dataType || row.DataType || '';
      if (!entityName) continue;
      if (!byEntity.has(entityName)) byEntity.set(entityName, []);
      if (fieldName) byEntity.get(entityName).push({ name: fieldName, type });
    }
    for (const [name, fields] of byEntity) {
      entities.push({ name, fields: fields.slice(0, MAX_FIELDS_PER_ENTITY) });
    }
  } else if (data.entities || data.typelists) {
    // Shape 1
    for (const e of data.entities || []) {
      entities.push({
        name: e.name || e.entity || 'Unknown',
        fields: (e.fields || []).slice(0, MAX_FIELDS_PER_ENTITY).map(f => ({
          name: f.name || f.field || 'unknown',
          type: f.type || f.dataType || ''
        }))
      });
    }
    for (const t of data.typelists || []) {
      typelists.push({
        name: t.name || 'Unknown',
        codes: (t.codes || t.values || []).slice(0, MAX_CODES_PER_TYPELIST)
      });
    }
  } else if (typeof data === 'object') {
    // Shape 2: object map of entity -> fields
    for (const [name, val] of Object.entries(data)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const fields = Object.entries(val).slice(0, MAX_FIELDS_PER_ENTITY).map(([fn, ft]) => ({
          name: fn,
          type: typeof ft === 'string' ? ft : JSON.stringify(ft)
        }));
        entities.push({ name, fields });
      }
    }
  }

  return { entities, typelists };
}

// ---------- HTML ----------
function parseHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const entities = [];
  const typelists = [];

  // Strategy: Guidewire data dictionary HTML exports are typically a series of
  // headings (entity/typelist names) followed by a <table> of fields/codes.
  // We walk all headings and tables in document order and pair them up.
  const headingSelectors = 'h1, h2, h3, h4, .entity-name, .title, caption';
  const headings = Array.from(doc.querySelectorAll(headingSelectors));
  const tables = Array.from(doc.querySelectorAll('table'));

  if (tables.length === 0) {
    // No tables at all — fall back to stripped text excerpt
    const text = doc.body ? doc.body.textContent : html;
    return { entities: [], typelists: [], rawExcerpt: (text || '').trim().slice(0, MAX_SUMMARY_CHARS) };
  }

  for (const table of tables) {
    // Find the nearest preceding heading-like element for a name
    let name = findPrecedingLabel(table, headings) || guessNameFromTable(table);
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) continue;

    const headerCells = Array.from(rows[0].querySelectorAll('th, td')).map(c => c.textContent.trim().toLowerCase());
    const dataRows = rows.slice(1).map(r => Array.from(r.querySelectorAll('td, th')).map(c => c.textContent.trim()));

    if (looksLikeTypelistHeader(headerCells)) {
      const codes = dataRows.map(r => r[0]).filter(Boolean).slice(0, MAX_CODES_PER_TYPELIST);
      typelists.push({ name, codes });
    } else {
      const nameIdx = findColIndex(headerCells, ['field', 'name', 'column', 'attribute']);
      const typeIdx = findColIndex(headerCells, ['type', 'datatype', 'data type']);
      const fields = dataRows
        .map(r => ({
          name: r[nameIdx >= 0 ? nameIdx : 0] || '',
          type: typeIdx >= 0 ? (r[typeIdx] || '') : ''
        }))
        .filter(f => f.name)
        .slice(0, MAX_FIELDS_PER_ENTITY);
      if (fields.length > 0) {
        entities.push({ name, fields });
      }
    }
  }

  return { entities, typelists };
}

function looksLikeTypelistHeader(headerCells) {
  const joined = headerCells.join(' ');
  return /code/.test(joined) && !/field|column|attribute/.test(joined);
}

function findColIndex(headerCells, keywords) {
  for (let i = 0; i < headerCells.length; i++) {
    if (keywords.some(k => headerCells[i].includes(k))) return i;
  }
  return -1;
}

function findPrecedingLabel(table, headings) {
  // Walk backwards through the DOM to find the closest heading before this table
  let node = table.previousElementSibling;
  let hops = 0;
  while (node && hops < 10) {
    const txt = node.textContent && node.textContent.trim();
    if (txt && txt.length < 120 && headings.includes(node)) return txt;
    if (txt && /^[A-Za-z][A-Za-z0-9 _-]{1,60}$/.test(txt) && node.tagName && /^H[1-6]$/.test(node.tagName)) return txt;
    node = node.previousElementSibling;
    hops++;
  }
  // Try parent's preceding sibling (nested table case)
  if (table.parentElement) {
    node = table.parentElement.previousElementSibling;
    if (node) {
      const txt = node.textContent && node.textContent.trim();
      if (txt && txt.length < 120) return txt;
    }
  }
  return null;
}

function guessNameFromTable(table) {
  const id = table.getAttribute('id') || table.getAttribute('name');
  if (id) return id;
  const caption = table.querySelector('caption');
  if (caption) return caption.textContent.trim();
  return 'Unnamed Entity';
}

// ---------- XML ----------
function parseXML(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parserErr = doc.querySelector('parsererror');
  if (parserErr) {
    throw new Error('XML parse error');
  }

  const entities = [];
  const typelists = [];

  // Heuristic: look for repeated elements that look like entities/typelists,
  // e.g. <entity name="Policy"><field name="..." type="..."/></entity>
  // Guidewire entityModel.xml identifies entities/delegates via the "id" attribute
  // (e.g. <entity id="Policy" tableName="pc_policy">), NOT "name". Other XML dialects
  // may use "name" instead, so we check both, preferring "id" since that's the
  // authoritative Guidewire convention.
  // Only real <entity> nodes represent actual business/domain entities (Policy,
  // Vehicle, Claim, etc). <delegate> nodes are shared trait mixins (Auditable,
  // Editable, Versionable, etc) — useful for the platform but noise for the agent's
  // business-domain grounding, so they are deliberately excluded here.
  const entityNodes = Array.from(doc.querySelectorAll('entity, Entity'));
  for (const node of entityNodes) {
    const name = node.getAttribute('id') || node.getAttribute('name') || node.getAttribute('Name') || node.tagName;
    // Only DIRECT children columns/foreignKeys/typekeys — querySelectorAll would
    // also pull in fields belonging to nested array/child entity definitions.
    // Guidewire fields are <column name="..." type="...">. <typekey>/<foreignKey>
    // represent typed/relational fields. We deliberately skip <derivedColumn> —
    // these are computed/internal properties, not real persisted business fields,
    // and there can be hundreds per entity (pure noise for LLM grounding).
    const fieldNodes = Array.from(node.querySelectorAll(':scope > column, :scope > typekey, :scope > foreignKey'));
    const fields = fieldNodes.slice(0, MAX_FIELDS_PER_ENTITY).map(f => ({
      name: f.getAttribute('name') || f.getAttribute('Name') || '',
      type: f.getAttribute('type') || f.getAttribute('Type') || f.tagName || ''
    })).filter(f => f.name);
    if (fields.length > 0) entities.push({ name, fields });
  }

  const typelistNodes = Array.from(doc.querySelectorAll('typelist, Typelist, TypeList'));
  for (const node of typelistNodes) {
    const name = node.getAttribute('id') || node.getAttribute('name') || node.getAttribute('Name') || node.tagName;
    // Guidewire typelist codes are <typecode name="..." code="..."> elements.
    const codeNodes = Array.from(node.querySelectorAll('typecode, TypeCode, code, Code, value, Value'));
    const codes = codeNodes.slice(0, MAX_CODES_PER_TYPELIST).map(c =>
      c.getAttribute('name') || c.getAttribute('code') || c.getAttribute('value') || c.textContent.trim()
    ).filter(Boolean);
    if (codes.length > 0) typelists.push({ name, codes });
  }

  if (entities.length === 0 && typelists.length === 0) {
    // Nothing recognisable — fall back to raw text excerpt
    return { entities: [], typelists: [], rawExcerpt: xml.slice(0, MAX_SUMMARY_CHARS) };
  }

  return { entities, typelists };
}

// ---------- CSV ----------
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    return { entities: [], typelists: [], rawExcerpt: text.slice(0, MAX_SUMMARY_CHARS) };
  }

  const header = splitCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const entityIdx = findColIndex(header, ['entity', 'table', 'object']);
  const fieldIdx = findColIndex(header, ['field', 'column', 'attribute', 'name']);
  const typeIdx = findColIndex(header, ['type', 'datatype', 'data type']);

  if (entityIdx === -1 || fieldIdx === -1) {
    // Doesn't look like an entity/field CSV — return raw excerpt
    return { entities: [], typelists: [], rawExcerpt: text.slice(0, MAX_SUMMARY_CHARS) };
  }

  const byEntity = new Map();
  for (const line of lines.slice(1)) {
    const cols = splitCSVLine(line);
    const entityName = cols[entityIdx];
    const fieldName = cols[fieldIdx];
    const type = typeIdx >= 0 ? cols[typeIdx] : '';
    if (!entityName || !fieldName) continue;
    if (!byEntity.has(entityName)) byEntity.set(entityName, []);
    if (byEntity.get(entityName).length < MAX_FIELDS_PER_ENTITY) {
      byEntity.get(entityName).push({ name: fieldName, type: type || '' });
    }
  }

  const entities = Array.from(byEntity.entries()).map(([name, fields]) => ({ name, fields }));
  return { entities, typelists: [] };
}

function splitCSVLine(line) {
  // Minimal CSV split — handles simple quoted fields, not full RFC 4180 edge cases.
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// ---------- Plain text fallback ----------
function parseFallbackText(text) {
  return { entities: [], typelists: [], rawExcerpt: text.slice(0, MAX_SUMMARY_CHARS) };
}

// ---------- Markdown ----------
// Handles GFM-style pipe tables, which is what most "HTML to Markdown" converters
// produce from a Guidewire data dictionary HTML export. Expected shape per entity:
//
//   ## EntityName
//   | Field | Type |
//   | --- | --- |
//   | fieldA | string |
//
// Headings are optional — if a table has no preceding heading we fall back to
// guessing a name from the table's first column header or an index.
export function looksLikeMarkdown(text) {
  // A markdown table has a header row immediately followed by a separator row
  // made of dashes/colons/pipes, e.g. "| --- | --- |" or "|---|---|".
  return /\|.*\|[ \t]*\r?\n[ \t]*\|?[ \t:-]+\|[ \t:-]+/.test(text) || /^#{1,6}\s+\S/m.test(text);
}

function parseMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const entities = [];
  const typelists = [];

  let currentHeading = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (headingMatch) {
      currentHeading = headingMatch[1].trim();
      i++;
      continue;
    }

    // Detect a table: a line containing pipes, followed by a separator line.
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headerCells = splitMarkdownRow(line).map(c => c.toLowerCase());
      let j = i + 2;
      const dataRows = [];
      while (j < lines.length && isTableRow(lines[j])) {
        dataRows.push(splitMarkdownRow(lines[j]));
        j++;
      }

      const name = currentHeading || `Table ${entities.length + typelists.length + 1}`;

      if (looksLikeTypelistHeader(headerCells)) {
        const codes = dataRows.map(r => r[0]).filter(Boolean).slice(0, MAX_CODES_PER_TYPELIST);
        if (codes.length > 0) typelists.push({ name, codes });
      } else {
        const nameIdx = findColIndex(headerCells, ['field', 'name', 'column', 'attribute']);
        const typeIdx = findColIndex(headerCells, ['type', 'datatype', 'data type']);
        const fields = dataRows
          .map(r => ({
            name: (r[nameIdx >= 0 ? nameIdx : 0] || '').trim(),
            type: typeIdx >= 0 ? (r[typeIdx] || '').trim() : ''
          }))
          .filter(f => f.name)
          .slice(0, MAX_FIELDS_PER_ENTITY);
        if (fields.length > 0) entities.push({ name, fields });
      }

      // currentHeading consumed by this table — reset so the NEXT table without
      // a heading doesn't inherit the same name.
      currentHeading = null;
      i = j;
      continue;
    }

    i++;
  }

  if (entities.length === 0 && typelists.length === 0) {
    return { entities: [], typelists: [], rawExcerpt: text.slice(0, MAX_SUMMARY_CHARS) };
  }

  return { entities, typelists };
}

function isTableRow(line) {
  return typeof line === 'string' && line.trim().includes('|') && line.trim().length > 1;
}

function isTableSeparator(line) {
  if (!isTableRow(line)) return false;
  // Separator rows are made up only of |, -, :, and whitespace, with at least one dash.
  const stripped = line.trim();
  return /^[|\-: \t]+$/.test(stripped) && stripped.includes('-');
}

function splitMarkdownRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  // Split on unescaped pipes
  return trimmed.split('|').map(cell => cell.trim().replace(/\\\|/g, '|'));
}

// ---------- Build a REQUEST-AWARE summary to hand to the agent ----------
// This is the key fix: instead of blindly taking the first N entities/typelists
// (which silently drops exactly the custom entities — e.g. "PETPets" — that the
// user's request is actually about, since real Guidewire dictionaries list
// entities roughly alphabetically and have thousands of them), we score every
// parsed entity/typelist against the free-text request and show full detail for
// the top matches, while still listing every other name so nothing is invisible.
export function buildDictionarySummaryForRequest(parsed, requestText) {
  if (!parsed) return null;
  const { entities = [], typelists = [] } = parsed;
  const fileLabel = parsed.fileNames ? parsed.fileNames.join(', ') : parsed.fileName;

  const keywords = extractKeywords(requestText);

  const scoredEntities = entities
    .map(e => ({ item: e, score: scoreEntityAgainstKeywords(e, keywords) }))
    .sort((a, b) => b.score - a.score);
  const scoredTypelists = typelists
    .map(t => ({ item: t, score: scoreTypelistAgainstKeywords(t, keywords) }))
    .sort((a, b) => b.score - a.score);

  const relevantEntities = scoredEntities.filter(s => s.score > 0).slice(0, MAX_RELEVANT_ENTITIES_DETAILED);
  const relevantTypelists = scoredTypelists.filter(s => s.score > 0).slice(0, MAX_RELEVANT_TYPELISTS_DETAILED);

  // If nothing scored (keywords too generic, or request doesn't mention anything
  // matching entity/typelist names), fall back to showing the first N so the agent
  // still has SOMETHING concrete rather than an empty detailed section.
  const fallbackEntities = relevantEntities.length === 0 ? scoredEntities.slice(0, MAX_RELEVANT_ENTITIES_DETAILED) : relevantEntities;
  const fallbackTypelists = relevantTypelists.length === 0 ? scoredTypelists.slice(0, MAX_RELEVANT_TYPELISTS_DETAILED) : relevantTypelists;

  const parts = [];
  parts.push(`Data Dictionary source: ${fileLabel}`);
  parts.push(`Total entities in dictionary: ${entities.length}. Total typelists in dictionary: ${typelists.length}.`);

  // CRITICAL: if parsing fell back to an unstructured excerpt or failed
  // outright, the agent must NOT treat absence of a term as evidence the
  // term doesn't exist. Without this explicit warning, an empty
  // entities/typelists array looks identical to "genuinely not in the
  // dictionary" and the agent will confidently assert false negatives
  // (e.g. "PETDogBreed not found") using an excerpt that never had any
  // chance of containing the answer.
  if (parsed.parseStatus === 'unstructured-fallback' || parsed.parseStatus === 'failed') {
    parts.push(
      `\n[INGESTION WARNING: This file could not be parsed into structured entities/typelists ` +
      `(status: ${parsed.parseStatus}). The content below, if any, is a raw truncated excerpt, ` +
      `NOT a complete or representative sample of the file. DO NOT treat the absence of a term ` +
      `in this excerpt as evidence that term does not exist in the client's actual data model. ` +
      `Flag this explicitly as an unresolved ambiguity rather than asserting "not found".]`
    );
  }
  if (parsed.fileParseStatuses && parsed.fileParseStatuses.some(f => f.parseStatus !== 'structured')) {
    const problemFiles = parsed.fileParseStatuses.filter(f => f.parseStatus !== 'structured');
    parts.push(`[INGESTION WARNING: The following attached file(s) could not be structurally parsed: ${problemFiles.map(f => `${f.fileName} (${f.parseStatus})`).join(', ')}. Do not treat their absence of matches as evidence of absence.]`);
  }

  if (fallbackEntities.length > 0) {
    parts.push(`\nMost relevant entities to this request (detailed):`);
    for (const { item: e } of fallbackEntities) {
      const fieldStr = (e.fields || [])
        .map(f => f.type ? `${f.name} (${f.type})` : f.name)
        .join(', ');
      parts.push(`- ${e.name}: ${fieldStr || '(no fields extracted)'}`);
    }
  }

  if (fallbackTypelists.length > 0) {
    parts.push(`\nMost relevant typelists to this request (detailed):`);
    for (const { item: t } of fallbackTypelists) {
      const codeStr = (t.codes || []).join(', ');
      parts.push(`- ${t.name}: ${codeStr || '(no codes extracted)'}`);
    }
  }

  // List every other entity/typelist NAME (no field detail) so the agent knows
  // the full universe and can say "not found" accurately rather than guessing,
  // while not spending tokens on full field lists for irrelevant entities.
  const shownEntityNames = new Set(fallbackEntities.map(s => s.item.name));
  const otherEntityNames = entities.map(e => e.name).filter(n => !shownEntityNames.has(n));
  if (otherEntityNames.length > 0) {
    parts.push(`\nOther entity names present in the dictionary (${otherEntityNames.length} total, names only — ask if field-level detail is needed):`);
    parts.push(otherEntityNames.slice(0, MAX_OTHER_NAMES_LISTED).join(', ') + (otherEntityNames.length > MAX_OTHER_NAMES_LISTED ? ', ...' : ''));
  }

  const shownTypelistNames = new Set(fallbackTypelists.map(s => s.item.name));
  const otherTypelistNames = typelists.map(t => t.name).filter(n => !shownTypelistNames.has(n));
  if (otherTypelistNames.length > 0) {
    parts.push(`\nOther typelist names present in the dictionary (${otherTypelistNames.length} total, names only):`);
    parts.push(otherTypelistNames.slice(0, MAX_OTHER_NAMES_LISTED).join(', ') + (otherTypelistNames.length > MAX_OTHER_NAMES_LISTED ? ', ...' : ''));
  }

  if (entities.length === 0 && typelists.length === 0) {
    if (parsed.rawExcerpt) {
      parts.push('\nCould not detect a structured entity/typelist layout. Raw excerpt of the file:');
      parts.push(parsed.rawExcerpt);
    } else {
      parts.push('\nNo structured data could be extracted from this file.');
    }
  }

  if (parsed.parseWarning) {
    parts.push(`\n[Parser warning: ${parsed.parseWarning}]`);
  }

  const joined = parts.join('\n');
  return joined.length > MAX_SUMMARY_CHARS ? joined.slice(0, MAX_SUMMARY_CHARS) + '\n...[truncated]' : joined;
}

// Extract meaningful keywords from the request text: alphanumeric tokens of
// length >= 3, lowercased, deduplicated. Also splits camelCase/PascalCase and
// dotted paths (e.g. "PETPets.DogBreed" -> "petpets", "dogbreed", "pet", "pets",
// "dog", "breed") since Guidewire naming conventions are PascalCase compounds.
function extractKeywords(text) {
  if (!text) return [];
  const raw = text.match(/[A-Za-z][A-Za-z0-9]*/g) || [];
  const expanded = new Set();
  for (const token of raw) {
    const lower = token.toLowerCase();
    if (lower.length >= 3) expanded.add(lower);
    // Split PascalCase/camelCase compounds into sub-words (e.g. DogBreed -> Dog, Breed)
    const subWords = token.match(/[A-Z][a-z0-9]*|[a-z0-9]+/g) || [];
    for (const sw of subWords) {
      const swLower = sw.toLowerCase();
      if (swLower.length >= 3) expanded.add(swLower);
    }
  }
  return Array.from(expanded);
}

// Score a dictionary item name against extracted keywords. Higher score = more
// relevant. Exact (case-insensitive) match scores highest; substring match next;
// sub-word overlap (for PascalCase compounds) scores lower but still counts.
function scoreNameAgainstKeywords(name, keywords) {
  if (!name || keywords.length === 0) return 0;
  const lowerName = name.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lowerName === kw) score += 10;
    else if (lowerName.includes(kw)) score += 5;
    else if (kw.includes(lowerName) && lowerName.length >= 3) score += 3;
  }
  return score;
}

// Score an ENTITY against keywords, checking not just the entity name but also
// its field names. This is the generalization fix: a request may not mention the
// Guidewire entity name at all (e.g. "add a discount for hybrid vehicles" never
// says "Vehicle"), but if the entity has a field like "FuelType" or "VehicleType"
// that matches, or if a request literally uses a business term that happens to be
// a field name (e.g. "severity" matching a field "SeverityCode" on "Exposure"),
// this ensures the entity still surfaces as relevant. Field matches are weighted
// lower than name matches since a name match is a much stronger relevance signal.
function scoreEntityAgainstKeywords(entity, keywords) {
  let score = scoreNameAgainstKeywords(entity.name, keywords) * 3; // name match weighted highest
  for (const f of entity.fields || []) {
    score += scoreNameAgainstKeywords(f.name, keywords);
  }
  return score;
}

// Score a TYPELIST against keywords, checking not just the typelist name but also
// its individual codes/values. This is critical for requests that mention a VALUE
// rather than a typelist name — e.g. "add breed 'Dachshund'" or "add severity
// 'Catastrophic'" or "hybrid and electric vehicles" (where "Hybrid"/"Electric" are
// likely existing codes on a FuelType typelist, not words in the typelist's own
// name). Without this, any request phrased around a data VALUE rather than a
// schema NAME would silently score zero and be dropped.
function scoreTypelistAgainstKeywords(typelist, keywords) {
  let score = scoreNameAgainstKeywords(typelist.name, keywords) * 3; // name match weighted highest
  for (const code of typelist.codes || []) {
    score += scoreNameAgainstKeywords(code, keywords);
  }
  return score;
}
