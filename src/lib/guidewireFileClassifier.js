// Classifies an uploaded file into one of Guidewire Studio's configuration
// areas, so the multi-file uploader can auto-route each file to the right
// parser and the right gate, without the user having to categorize files
// themselves.
//
// Guidewire Studio areas covered:
//   - dataDictionary : entity model / typelists (already supported)
//   - pcf            : Page Configuration Files (UI screens)
//   - gosuRule       : business rules (validation/UW/activity/assignment)
//   - productModel   : coverages/exclusions/conditions/modifiers
//   - rating         : rate tables/routines/factors
//
// Classification is heuristic and layered: filename/extension hints first
// (cheap, usually correct), then content sniffing as a fallback/override
// (catches misnamed files, e.g. the .md.txt case we hit with the data
// dictionary). This mirrors the same defensive design used in
// dataDictionaryParser.js — never trust the extension alone.

import { looksLikeMarkdown } from './dataDictionaryParser.js';

export const ARTIFACT_KINDS = {
  DATA_DICTIONARY: 'dataDictionary',
  PCF: 'pcf',
  GOSU_RULE: 'gosuRule',
  PRODUCT_MODEL: 'productModel',
  RATING: 'rating',
  UNKNOWN: 'unknown'
};

export async function classifyFile(file) {
  const name = file.name.toLowerCase();
  const ext = (name.split('.').pop() || '');

  // ---------- Filename hints (cheap, usually correct) ----------
  if (/\.pcf$/.test(name)) return ARTIFACT_KINDS.PCF;
  if (/entitymodel|typelist|datadictionary|columns\.html|entitytabledescriptions|typelisttabledescriptions/.test(name)) {
    return ARTIFACT_KINDS.DATA_DICTIONARY;
  }
  // .gr/.grs are real Guidewire rule-set export extensions and are
  // UNAMBIGUOUS on their own — verified against a real export tree where
  // rule files are named after the specific rule (e.g.
  // "assignroundrobin.gr", "RelatedAccounts.gr") and do NOT contain the
  // substring "rule" in the filename. Requiring /rule/ in the name (as
  // originally written) silently misclassified every one of these as
  // unknown. .gs/.gsx/.xml remain ambiguous extensions used for other
  // Guidewire artifact types too, so those still require the "rule"
  // filename hint to avoid false positives.
  // NOTE: `ext` is extracted via name.split('.').pop(), which does NOT
  // include the leading dot — so these must match against the bare
  // extension string, not a pattern expecting a leading ".". (The original
  // code had this same bug on the .gs/.gsx/.xml check below, which never
  // manifested because it was gated behind /rule/.test(name) failing first
  // for real, non-"rule"-named files.)
  if (/^(gr|grs)$/.test(ext)) return ARTIFACT_KINDS.GOSU_RULE;
  if (/rule/.test(name) && /^(gs|gsx|xml)$/.test(ext)) return ARTIFACT_KINDS.GOSU_RULE;
  if (/rating|ratetable|raterout|ratefactor/.test(name)) return ARTIFACT_KINDS.RATING;
  if (/coverage|exclusion|condition|modifier|productmodel/.test(name)) return ARTIFACT_KINDS.PRODUCT_MODEL;

  // ---------- Content sniffing fallback (for misnamed / .txt / .md files) ----------
  let text = '';
  try {
    text = await file.text();
  } catch {
    return ARTIFACT_KINDS.UNKNOWN;
  }

  const sample = text.slice(0, 20000); // enough to catch structural markers without reading huge files fully

  // PCF: Guidewire screen XML root elements / widget tags
  if (/<Screen\b|<PCF\b|<InputSetRef\b|<ToolbarButton\b|<Widget\b/i.test(sample)) {
    return ARTIFACT_KINDS.PCF;
  }

  // Gosu rule files: rule metadata blocks or Gosu class markers with rule-like naming
  if (/uses gw\.rules|extends Rule|RuleSet|implements IRule|@Rule\b/.test(sample)) {
    return ARTIFACT_KINDS.GOSU_RULE;
  }

  // Product model: coverage/exclusion/condition/modifier pattern definitions
  if (/<Coverage\b|<Exclusion\b|<Condition\b|<Modifier\b|CoveragePattern|ModifierPattern/i.test(sample)) {
    return ARTIFACT_KINDS.PRODUCT_MODEL;
  }

  // Rating: rate table / rate routine markers
  if (/<RateTable\b|<RateRoutine\b|RateBook|RatingStep|CalcRoutine/i.test(sample)) {
    return ARTIFACT_KINDS.RATING;
  }

  // Data dictionary: entityModel.xml root, or typelist/entity markup, or the
  // Guidewire Data Dictionary HTML index page.
  if (/<entityModel\b|<typelist\b|Data Dictionary/i.test(sample)) {
    return ARTIFACT_KINDS.DATA_DICTIONARY;
  }

  // GFM markdown tables (e.g. from an "HTML to Markdown" converted data
  // dictionary export) — reuse the SAME detection used by the data dictionary
  // parser itself, so classification and parsing never disagree about what
  // counts as markdown. This is the most common real-world case so far
  // (html-to-markdown.md.txt), so ambiguous markdown/table content defaults here.
  if (looksLikeMarkdown(sample)) {
    return ARTIFACT_KINDS.DATA_DICTIONARY;
  }

  return ARTIFACT_KINDS.UNKNOWN;
}

export async function classifyFiles(files) {
  const classified = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const kind = await classifyFile(file);
    classified.push({ file, kind });
  }
  return classified;
}

export function groupByKind(classifiedFiles) {
  const groups = {
    [ARTIFACT_KINDS.DATA_DICTIONARY]: [],
    [ARTIFACT_KINDS.PCF]: [],
    [ARTIFACT_KINDS.GOSU_RULE]: [],
    [ARTIFACT_KINDS.PRODUCT_MODEL]: [],
    [ARTIFACT_KINDS.RATING]: [],
    [ARTIFACT_KINDS.UNKNOWN]: []
  };
  for (const { file, kind } of classifiedFiles) {
    (groups[kind] || groups[ARTIFACT_KINDS.UNKNOWN]).push(file);
  }
  return groups;
}

export const ARTIFACT_KIND_LABELS = {
  [ARTIFACT_KINDS.DATA_DICTIONARY]: 'Data Dictionary',
  [ARTIFACT_KINDS.PCF]: 'PCF (UI Screen)',
  [ARTIFACT_KINDS.GOSU_RULE]: 'Gosu Rule',
  [ARTIFACT_KINDS.PRODUCT_MODEL]: 'Product Model',
  [ARTIFACT_KINDS.RATING]: 'Rating',
  [ARTIFACT_KINDS.UNKNOWN]: 'Unrecognized'
};
