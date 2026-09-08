// Parser for Guidewire's flat "*TableDescriptions.txt" exports:
//   entityTableDescriptions.txt   — "tableName.FieldName = description" and
//                                    "tableName = entity description" lines
//   typelistTableDescriptions.txt — "TypelistCodeName.DisplayName = description"
//                                    and "TypelistCodeName = typelist description"
//
// IMPORTANT SCOPE NOTE (corrected after verification against real files):
// These flat files are keyed by DISPLAY NAME (the "Name" column in the
// per-typelist HTML tables), NOT by the typecode identifier itself.
//
// Verified example (PETDogBreed_tl.html row): Code="AberdeenTerrier",
// Name="ABERDEEN TERRIER". The flat file entry is:
//   PETDogBreed.ABERDEEN TERRIER = ABERDEEN TERRIER
// The string "AberdeenTerrier" (the actual Code) does not appear anywhere in
// typelistTableDescriptions.txt. Verified consistent across three typelists
// (PETDogBreed, PETCatBreed, PETPetType) — PETPetType coincidentally has
// Code === Name for single-word terms (e.g. "Dog"), which can look like the
// flat file carries codes, but it does not — it's a coincidental collision,
// not code-level data.
//
// CONSEQUENCE: this parser answers "does a typecode with display name X
// exist under typelist Y" and "what does field X on entity Y mean" — fast,
// cheap, good existence-check path. It CANNOT answer "what is the code for
// display name X" or "is code X retired" — those require the per-page HTML
// parser (dictionaryHtmlPageParser.js), which is the sole source for Code,
// Retired, Priority, Internal, and entity->typelist edges.

const MAX_SUMMARY_CHARS = 12000;

// ---------- entityTableDescriptions.txt ----------
// Line shapes observed:
//   pcx_petpets = Pet
//   pcx_petpets.DogBreed = Dog Breed
// The left side before the first "." (if present) is the DB table name
// (lowercase, e.g. "pcx_petpets"), NOT the entity code name ("PETPets").
// This file alone cannot resolve DB table name -> entity code name; that
// mapping is only visible in the per-page HTML (<span class="entityname">
// (pcx_petpets)</span> alongside the entity's code-name page title).
export function parseEntityTableDescriptions(text) {
  const lines = text.split(/\r?\n/);
  const entityDescriptions = new Map(); // dbTableName -> description
  const fieldDescriptions = new Map(); // "dbTableName.FieldName" -> description

  for (const line of lines) {
    const eq = line.indexOf(' = ');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 3).trim();
    if (!key) continue;

    const dotIdx = key.indexOf('.');
    if (dotIdx === -1) {
      entityDescriptions.set(key, value);
    } else {
      fieldDescriptions.set(key, value);
    }
  }

  return { entityDescriptions, fieldDescriptions };
}

// ---------- typelistTableDescriptions.txt ----------
// Line shapes observed:
//   PETDogBreed = Dog Breed
//   PETDogBreed.ABERDEEN TERRIER = ABERDEEN TERRIER
// Left side before "." is the typelist CODE NAME (e.g. "PETDogBreed") — this
// IS the code identifier for the typelist itself (not to be confused with
// individual typecode entries within it, which are keyed by Name only).
export function parseTypelistTableDescriptions(text) {
  const lines = text.split(/\r?\n/);
  const typelistDisplayNames = new Map(); // typelistCodeName -> displayName (e.g. "Dog Breed")
  const typecodeNamesByTypelist = new Map(); // typelistCodeName -> Set of typecode DISPLAY NAMES (not codes)

  for (const line of lines) {
    const eq = line.indexOf(' = ');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 3).trim();
    if (!key) continue;

    const dotIdx = key.indexOf('.');
    if (dotIdx === -1) {
      typelistDisplayNames.set(key, value);
    } else {
      const typelistCodeName = key.slice(0, dotIdx);
      const typecodeDisplayName = key.slice(dotIdx + 1);
      if (!typecodeNamesByTypelist.has(typelistCodeName)) {
        typecodeNamesByTypelist.set(typelistCodeName, new Set());
      }
      typecodeNamesByTypelist.get(typelistCodeName).add(typecodeDisplayName);
    }
  }

  return { typelistDisplayNames, typecodeNamesByTypelist };
}

// Detects which flat file a text blob is, based on line shape sampling
// (cheap — checks first ~50 non-empty lines for the characteristic pattern).
export function detectFlatFileKind(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 50);
  if (lines.length === 0) return null;
  // Both files share the same "Key = Value" / "Key.Sub = Value" shape, so we
  // can't distinguish purely structurally — rely on filename at the call
  // site instead. This function exists for future content-sniffing use if
  // filenames become unreliable, but for now always returns null (unused).
  return null;
}

// Builds a display-name-keyed lookup index from a parsed typelist flat file,
// suitable for fast existence checks: "does typelist X have a value called Y".
// This does NOT resolve to a Code — callers needing the Code must consult the
// per-page HTML parser's output instead.
export function buildTypelistNameIndex({ typelistDisplayNames, typecodeNamesByTypelist }) {
  const index = new Map(); // lowercased typelist codeName OR lowercased displayName -> { codeName, displayName, typecodeDisplayNames: string[] }

  for (const [codeName, displayName] of typelistDisplayNames.entries()) {
    const typecodeNames = Array.from(typecodeNamesByTypelist.get(codeName) || []);
    const record = { codeName, displayName, typecodeDisplayNames: typecodeNames };
    index.set(codeName.toLowerCase(), record);
    if (displayName) index.set(displayName.toLowerCase(), record);
  }

  return index;
}

export function buildFlatFileSummary({ entityDescriptions, fieldDescriptions, typelistDisplayNames, typecodeNamesByTypelist }) {
  const parts = [];
  parts.push(
    `Flat description files parsed: ${entityDescriptions ? entityDescriptions.size : 0} entity descriptions, ` +
    `${fieldDescriptions ? fieldDescriptions.size : 0} field descriptions, ` +
    `${typelistDisplayNames ? typelistDisplayNames.size : 0} typelists.`
  );
  parts.push(
    `NOTE: typelist entries below are DISPLAY NAMES only (the "Name" column in Guidewire Studio), ` +
    `NOT the underlying typecode identifier. Do not assume the display name is the code to use in ` +
    `configuration — the actual Code value is only available from the per-page HTML source, if provided.`
  );
  return parts.join('\n').slice(0, MAX_SUMMARY_CHARS);
}
