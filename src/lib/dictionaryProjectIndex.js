// Builds the merged, three-key project dictionary index from both the flat
// description files and the per-page HTML files, per the corrected plan:
//
//   Key 1: typelist CODE NAME       (e.g. "PETDogBreed")
//   Key 2: typelist DISPLAY NAME    (e.g. "Dog Breed")       — from flat file
//   Key 3: per-typecode lookup      Code AND Name            — from HTML only
//
// This is the index that finally allows a request mentioning "Dog Breed"
// (display) to resolve to typelist "PETDogBreed" (code) AND expose that
// typelist's individual typecodes with Code/Name/Priority/Retired/Internal
// — none of which the flat files alone can provide once "Dachshund" or
// other CODE-level questions are asked.
//
// Entities are similarly merged: flat file gives field descriptions, HTML
// page parser gives field -> typelist CODE NAME edges.

import { parseEntityTableDescriptions, parseTypelistTableDescriptions } from './dictionaryFlatFileParser.js';
import { parseTypelistPageFiles, parseEntityPageFiles } from './dictionaryHtmlPageParser.js';

// Builds the full project index from raw File objects. Callers pass in
// whichever files they have — flat files, HTML per-page files, or both.
// Missing pieces degrade gracefully (e.g. no HTML files -> typecodes list
// is empty but display-name-level typelist existence checks still work).
export async function buildProjectDictionaryIndex({
  entityTableDescriptionsFile,   // single File, optional
  typelistTableDescriptionsFile, // single File, optional
  entityHtmlFiles = [],          // array of File (data/full/*.html), optional
  typelistHtmlFiles = []         // array of File (data/typelist/*_tl.html), optional
}) {
  let entityDescriptions = new Map();
  let fieldDescriptions = new Map();
  let typelistDisplayNames = new Map();
  let typecodeNamesByTypelist = new Map();

  if (entityTableDescriptionsFile) {
    const text = await entityTableDescriptionsFile.text();
    const parsed = parseEntityTableDescriptions(text);
    entityDescriptions = parsed.entityDescriptions;
    fieldDescriptions = parsed.fieldDescriptions;
  }

  if (typelistTableDescriptionsFile) {
    const text = await typelistTableDescriptionsFile.text();
    const parsed = parseTypelistTableDescriptions(text);
    typelistDisplayNames = parsed.typelistDisplayNames;
    typecodeNamesByTypelist = parsed.typecodeNamesByTypelist;
  }

  const typelistPages = typelistHtmlFiles.length > 0 ? await parseTypelistPageFiles(typelistHtmlFiles) : [];
  const entityPages = entityHtmlFiles.length > 0 ? await parseEntityPageFiles(entityHtmlFiles) : [];

  return buildIndexFromParsedSources({
    entityDescriptions,
    fieldDescriptions,
    typelistDisplayNames,
    typecodeNamesByTypelist,
    typelistPages,
    entityPages
  });
}

// Pure function (no file I/O) — kept separate so it's independently testable
// with pre-parsed data, which is what the checkpoint verification script uses.
export function buildIndexFromParsedSources({
  entityDescriptions,
  fieldDescriptions,
  typelistDisplayNames,
  typecodeNamesByTypelist,
  typelistPages,
  entityPages
}) {
  // typelistIndex: lowercased codeName OR lowercased displayName -> typelist record
  const typelistIndex = new Map();

  // Start from flat-file display names (may be the only source for typelists
  // with no HTML page attached — still gives display-name-level existence).
  for (const [codeName, displayName] of (typelistDisplayNames || new Map()).entries()) {
    const record = getOrCreateTypelistRecord(typelistIndex, codeName, displayName);
    const flatNames = Array.from((typecodeNamesByTypelist && typecodeNamesByTypelist.get(codeName)) || []);
    for (const n of flatNames) {
      if (!record.typecodesByName.has(n.toLowerCase())) {
        // Flat-file-only typecode entry — no Code, Priority, Retired, Internal
        // available (that's the whole point of this scope split). Mark it so
        // callers know this entry lacks HTML-sourced detail.
        record.typecodesByName.set(n.toLowerCase(), { code: null, name: n, priority: null, retired: null, internal: null, source: 'flat-file-only' });
      }
    }
  }

  // Overlay/enrich with HTML per-typelist pages — this is the ONLY source for
  // Code, Priority, Retired, Internal.
  for (const page of (typelistPages || [])) {
    if (!page.codeName) continue;
    const record = getOrCreateTypelistRecord(typelistIndex, page.codeName, page.displayName);
    for (const tc of page.typecodes || []) {
      const byCode = tc.code ? tc.code.toLowerCase() : null;
      const byName = tc.name ? tc.name.toLowerCase() : null;
      const enriched = { code: tc.code, name: tc.name, description: tc.description, priority: tc.priority, retired: tc.retired, internal: tc.internal, source: 'html' };
      if (byCode) record.typecodesByCode.set(byCode, enriched);
      if (byName) record.typecodesByName.set(byName, enriched);
    }
  }

  // entityIndex: lowercased entity code name -> entity record
  const entityIndex = new Map();
  for (const page of (entityPages || [])) {
    if (!page.entityCodeName) continue;
    const key = page.entityCodeName.toLowerCase();
    if (!entityIndex.has(key)) {
      entityIndex.set(key, { entityCodeName: page.entityCodeName, dbTableName: page.dbTableName, fieldTypelistEdges: [] });
    }
    const record = entityIndex.get(key);
    for (const edge of page.fieldTypelistEdges || []) {
      record.fieldTypelistEdges.push(edge);
    }
  }

  return {
    typelistIndex,   // Map<lowercased codeName|displayName, record>
    entityIndex,     // Map<lowercased entityCodeName, record>
    entityDescriptions: entityDescriptions || new Map(),
    fieldDescriptions: fieldDescriptions || new Map()
  };
}

function getOrCreateTypelistRecord(typelistIndex, codeName, displayName) {
  const codeKey = codeName.toLowerCase();
  let record = typelistIndex.get(codeKey);
  if (!record) {
    record = {
      codeName,
      displayName: displayName || null,
      typecodesByCode: new Map(),
      typecodesByName: new Map()
    };
    typelistIndex.set(codeKey, record);
  } else if (displayName && !record.displayName) {
    record.displayName = displayName;
  }
  if (displayName) {
    const dispKey = displayName.toLowerCase();
    if (!typelistIndex.has(dispKey)) typelistIndex.set(dispKey, record);
  }
  return record;
}

// ---------- Query helpers (used by the checkpoint verification and, later, Gate 1 grounding) ----------

// Resolve a typelist by either its code name or display name (case-insensitive).
export function resolveTypelist(index, nameOrDisplayName) {
  if (!nameOrDisplayName) return null;
  return index.typelistIndex.get(nameOrDisplayName.toLowerCase()) || null;
}

// Returns all typecodes for a resolved typelist record as a flat array,
// de-duplicated by lowercased name (HTML-sourced entries take precedence
// over flat-file-only entries when both exist for the same display name).
export function listTypecodes(typelistRecord) {
  if (!typelistRecord) return [];
  const byName = new Map();
  for (const [, tc] of typelistRecord.typecodesByName.entries()) {
    byName.set((tc.name || '').toLowerCase(), tc);
  }
  return Array.from(byName.values());
}

// Checks whether a typelist contains a typecode matching the given search
// term against EITHER Code or Name (case-insensitive, substring match).
export function findMatchingTypecodes(typelistRecord, searchTerm) {
  if (!typelistRecord || !searchTerm) return [];
  const lower = searchTerm.toLowerCase();
  return listTypecodes(typelistRecord).filter(tc =>
    (tc.code && tc.code.toLowerCase().includes(lower)) ||
    (tc.name && tc.name.toLowerCase().includes(lower))
  );
}
