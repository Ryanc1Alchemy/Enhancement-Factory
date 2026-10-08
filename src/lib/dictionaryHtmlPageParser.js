// Parser for Guidewire's per-page Data Dictionary HTML export structure:
//   data/full/<Entity>.html        — one file per entity, e.g. PETPets.html
//   data/typelist/<Typelist>_tl.html — one file per typelist, e.g. PETDogBreed_tl.html
//
// This is DELIBERATELY narrow in scope, per the corrected plan: the flat
// "*TableDescriptions.txt" files (see dictionaryFlatFileParser.js) already
// give fast, cheap DISPLAY-NAME-level lookups for both entities and
// typelists. This parser exists ONLY to extract what the flat files cannot:
//
//   1. The typecode CODE identifier itself (e.g. "AberdeenTerrier") — the
//      flat files only carry the display Name ("ABERDEEN TERRIER"), never
//      the Code.
//   2. Retired / Priority / Internal per typecode — absent from flat files.
//   3. Entity field -> typelist CODE NAME edges (e.g. PETPets.DogBreed ->
//      PETDogBreed) — the flat files describe the field ("Dog Breed") but
//      never link it to the typelist's code identifier.
//
// Verified page structure (from real PETDogBreed_tl.html / PETPets.html):
//
//   Typelist page:
//     <span class="pagetitle">PETDogBreed</span> ... (pctl_petdogbreed)
//     <div class="desc">Dog Breed</div>
//     <table class="typelistbody">
//       <tr class="typelistheader"><td>Code</td><td>Name</td><td>Description</td><td>Priority</td><td>Internal</td><td>Retired</td></tr>
//       <tr><td><a href=#X>Code</a></td><td>Name</td><td>Description</td><td align=center>Priority</td><td>Internal</td><td>Retired</td></tr>
//
//   Entity page:
//     <span class="pagetitle">PETPets ... </span>
//     <span class="exttitle">DogBreed</span> ... type key to <A HREF="../typelist/PETDogBreed_tl.html">PETDogBreed</A>

const MAX_SUMMARY_CHARS = 12000;
const MAX_TYPECODES_PER_TYPELIST = 500;
const MAX_FIELD_EDGES_PER_ENTITY = 100;

// ---------- Per-typelist page parser ----------
// Returns { codeName, displayName, typecodes: [{ code, name, description, priority, internal, retired }] }
export function parseTypelistPage(html, fileName) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const titleSpan = doc.querySelector('.pagetitle');
  const codeName = titleSpan ? titleSpan.textContent.trim() : deriveTypelistCodeNameFromFileName(fileName);

  const descDiv = doc.querySelector('.desc');
  const displayName = descDiv ? descDiv.textContent.trim() : null;

  // IMPORTANT: real typelist pages contain MULTIPLE elements with class
  // "typelistbody" — one true typecode table (header: Code|Name|Description|
  // Priority|Internal|Retired) plus one "Localizations" table PER TYPECODE
  // (header: Locale|Name|Description), all sharing the same CSS class.
  // querySelector() only returns the FIRST match in document order, which
  // happens to be correct on every real page inspected so far (the typecode
  // table is always emitted before any per-typecode localization tables) —
  // but that is a document-order assumption, not a verified guarantee.
  // We therefore explicitly INSPECT the header row of every table.typelistbody
  // candidate and only accept one whose header matches the expected typecode
  // column set, rather than trusting position alone.
  const candidateTables = Array.from(doc.querySelectorAll('table.typelistbody'));
  const table = candidateTables.find(isTypecodeTable) || null;
  const typecodes = [];

  if (table) {
    const rows = Array.from(table.querySelectorAll('tr')).slice(1); // skip header row (now verified to be the typecode header)
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length === 0) continue;

      const code = cells[0] ? cells[0].textContent.trim() : '';
      const name = cells[1] ? cells[1].textContent.trim() : '';
      const description = cells[2] ? cells[2].textContent.trim() : '';
      const priorityRaw = cells[3] ? cells[3].textContent.trim() : '';
      const internalRaw = cells[4] ? cells[4].textContent.trim() : '';
      const retiredRaw = cells[5] ? cells[5].textContent.trim() : '';

      if (!code) continue;

      typecodes.push({
        code,
        name,
        description,
        priority: priorityRaw && priorityRaw !== '' ? Number(priorityRaw) || priorityRaw : null,
        internal: normalizeFlagCell(internalRaw),
        retired: normalizeFlagCell(retiredRaw)
      });

      if (typecodes.length >= MAX_TYPECODES_PER_TYPELIST) break;
    }
  }

  if (typecodes.length === 0) {
    return { codeName, displayName, typecodes: [], parseStatus: 'unstructured-fallback', rawExcerpt: html.slice(0, MAX_SUMMARY_CHARS) };
  }

  return { codeName, displayName, typecodes, parseStatus: 'structured' };
}

// CRITICAL FINDING (verified against real PETDogBreed_tl.html typecodes):
// the typecode CODE is NOT derivable from its display Name by any
// mechanical transform (case-folding, space-stripping, etc). Examples:
//   Code="Bulldog"      Name="BLUE BLOOD BULLDOG"
//   Code="Husky"        Name="ALASKAN HUSKY"
//   Code="CrossBreed"   Name="Crossbreed"
//   Code="Mongrel"      Name="Mongrel"          (coincidentally equal)
// Code is assigned independently by the config author at typelist-authoring
// time and bears no reliable structural relationship to Name. ANY downstream
// prompt/agent logic that needs to produce or guess a Code value (e.g. "add
// typecode X to this typelist") MUST treat Code as an opaque author-assigned
// string, and MUST NOT attempt to generate it from the requested display
// name/breed/label. If a request only supplies a display name and the
// desired Code is not explicit, that is a genuine ambiguity to surface to
// the human — not something to infer.
function normalizeFlagCell(raw) {
  const cleaned = (raw || '').replace(/\u00a0/g, '').trim();
  if (cleaned === '') return false;
  return /^(true|yes|x|1)$/i.test(cleaned) ? true : cleaned; // preserve raw value if not a recognised boolean marker
}

function deriveTypelistCodeNameFromFileName(fileName) {
  return (fileName || '').replace(/_tl\.html?$/i, '');
}

// Explicitly inspects a candidate table.typelistbody element's header row
// and returns true only if it matches the typecode table's expected column
// set (Code, Name, Description, Priority, Internal, Retired), rejecting
// Localizations tables (Locale, Name, Description) even though they share
// the same CSS class. This replaces reliance on document-order/querySelector
// position, which was previously an unverified assumption.
function isTypecodeTable(table) {
  const headerRow = table.querySelector('tr.typelistheader') || table.querySelector('tr');
  if (!headerRow) return false;
  const headerCells = Array.from(headerRow.querySelectorAll('td, th')).map(c => c.textContent.trim().toLowerCase());
  // Require at least "code" AND "name" AND ("priority" OR "retired" OR "internal")
  // — this distinguishes the typecode table from the Locale/Name/Description
  // localization table, which has "name" but no "code", "priority", "retired",
  // or "internal" column.
  const hasCode = headerCells.includes('code');
  const hasName = headerCells.includes('name');
  const hasDistinguishingColumn = headerCells.includes('priority') || headerCells.includes('retired') || headerCells.includes('internal');
  return hasCode && hasName && hasDistinguishingColumn;
}

// ---------- Per-entity page parser ----------
// Returns { entityCodeName, dbTableName, fieldTypelistEdges: [{ fieldName, typelistCodeName }] }
// Deliberately does NOT re-extract field descriptions/types — the flat file
// (entityTableDescriptions.txt) already covers that more cheaply. This
// parser exists solely for the typelist edge, which flat files cannot give.
export function parseEntityPage(html, fileName) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const titleSpan = doc.querySelector('.pagetitle');
  // Page title format: "PETPets (pcx_petpets) (delegates to ...)" — the
  // entity code name is the first text node before any nested <span>.
  let entityCodeName = null;
  let dbTableName = null;
  if (titleSpan) {
    const fullText = titleSpan.textContent || '';
    const codeMatch = fullText.match(/^\s*([A-Za-z0-9_]+)/);
    entityCodeName = codeMatch ? codeMatch[1] : deriveEntityCodeNameFromFileName(fileName);
    const dbMatch = fullText.match(/\(([a-z0-9_]+)\)/i);
    dbTableName = dbMatch ? dbMatch[1] : null;
  } else {
    entityCodeName = deriveEntityCodeNameFromFileName(fileName);
  }

  // Field -> typelist edges: look for "type key to <A HREF=".../typelist/X_tl.html">X</A>"
  // pattern. Each field's block starts at a field-name span — verified across
  // the real export that this uses TWO DIFFERENT CSS classes depending on
  // field origin:
  //   .exttitle  — custom/extension fields (e.g. PETPets.DogBreed)
  //   .coltitle  — standard/base fields (e.g. Policy.AppEventSyncStatus,
  //                and also internal derived properties like DOGBREED_PROP —
  //                which is why we still gate on the presence of an actual
  //                typelist link, not just the class name, to avoid false
  //                positives from derived/internal property rows).
  // An earlier version of this parser checked ONLY .exttitle, which missed
  // the majority of typekey fields across the export (verified: 0 edges
  // found on Policy.html despite 8 "type key to" occurrences in the source,
  // because none of Policy's typekey fields use the exttitle class).
  const fieldEdges = [];
  const fieldTitleSpans = Array.from(doc.querySelectorAll('.exttitle, .coltitle'));
  for (const span of fieldTitleSpans) {
    const fieldName = span.textContent.trim();
    if (!fieldName) continue;

    // The typelist link is a sibling/nearby element within the same field block.
    // Search forward through following siblings up to a reasonable bound.
    let node = span.parentElement;
    let typelistCodeName = null;
    if (node) {
      const link = node.querySelector('a[href*="/typelist/"]');
      if (link) {
        const hrefMatch = link.getAttribute('href').match(/\/typelist\/([^/]+?)_tl\.html?/i);
        typelistCodeName = hrefMatch ? hrefMatch[1] : link.textContent.trim();
      }
    }

    if (typelistCodeName) {
      fieldEdges.push({ fieldName, typelistCodeName });
      if (fieldEdges.length >= MAX_FIELD_EDGES_PER_ENTITY) break;
    }
  }

  if (fieldEdges.length === 0 && !entityCodeName) {
    return { entityCodeName: null, dbTableName: null, fieldTypelistEdges: [], parseStatus: 'unstructured-fallback', rawExcerpt: html.slice(0, MAX_SUMMARY_CHARS) };
  }

  return { entityCodeName, dbTableName, fieldTypelistEdges: fieldEdges, parseStatus: 'structured' };
}

function deriveEntityCodeNameFromFileName(fileName) {
  return (fileName || '').replace(/\.html?$/i, '');
}

// ---------- Batch parsers ----------
export async function parseTypelistPageFiles(files) {
  const results = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const html = await file.text();
    results.push({ fileName: file.name, ...parseTypelistPage(html, file.name) });
  }
  return results;
}

export async function parseEntityPageFiles(files) {
  const results = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const html = await file.text();
    results.push({ fileName: file.name, ...parseEntityPage(html, file.name) });
  }
  return results;
}
