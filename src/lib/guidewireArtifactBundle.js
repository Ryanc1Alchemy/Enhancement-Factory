// Orchestrates the full multi-file, multi-area upload experience: classifies
// each uploaded file into a Guidewire Studio area (data dictionary, PCF,
// Gosu rule, product model, rating), routes it to the correct parser, and
// exposes a single combined summary-builder so callers don't need to know
// about each area's parser individually.

import { classifyFiles, groupByKind, ARTIFACT_KINDS, ARTIFACT_KIND_LABELS } from './guidewireFileClassifier.js';
import { parseDataDictionaryFiles, buildDictionarySummaryForRequest } from './dataDictionaryParser.js';
import { parsePCFFiles, buildPCFSummaryForRequest } from './pcfParser.js';
import { parseGosuRuleFiles, buildGosuRuleSummaryForRequest } from './gosuRuleParser.js';
import { parseProductModelFiles, buildProductModelSummaryForRequest } from './productModelParser.js';
import { parseRatingFiles, buildRatingSummaryForRequest } from './ratingParser.js';
import { parseNotesFiles, buildNotesSummaryForRequest } from './notesParser.js';

// Parses a raw list of File objects (of any mix of Guidewire Studio areas)
// into a single bundle keyed by artifact kind. This is the main entry point
// the upload UI should call.
export async function parseGuidewireBundle(files) {
  const classified = await classifyFiles(files);
  const groups = groupByKind(classified);

  const bundle = {
    counts: {},
    dataDictionary: null,
    pcfs: null,
    gosuRules: null,
    productModel: null,
    rating: null,
    notes: null,
    unknownFiles: groups[ARTIFACT_KINDS.UNKNOWN].map(f => f.name)
  };

  for (const kind of Object.keys(groups)) {
    bundle.counts[kind] = groups[kind].length;
  }

  if (groups[ARTIFACT_KINDS.DATA_DICTIONARY].length > 0) {
    bundle.dataDictionary = await parseDataDictionaryFiles(groups[ARTIFACT_KINDS.DATA_DICTIONARY]);
  }
  if (groups[ARTIFACT_KINDS.PCF].length > 0) {
    bundle.pcfs = await parsePCFFiles(groups[ARTIFACT_KINDS.PCF]);
  }
  if (groups[ARTIFACT_KINDS.GOSU_RULE].length > 0) {
    bundle.gosuRules = await parseGosuRuleFiles(groups[ARTIFACT_KINDS.GOSU_RULE]);
  }
  if (groups[ARTIFACT_KINDS.PRODUCT_MODEL].length > 0) {
    bundle.productModel = await parseProductModelFiles(groups[ARTIFACT_KINDS.PRODUCT_MODEL]);
  }
  if (groups[ARTIFACT_KINDS.RATING].length > 0) {
    bundle.rating = await parseRatingFiles(groups[ARTIFACT_KINDS.RATING]);
  }
  if (groups[ARTIFACT_KINDS.NOTES].length > 0) {
    bundle.notes = await parseNotesFiles(groups[ARTIFACT_KINDS.NOTES]);
  }

  return bundle;
}

// Builds ONE combined summary string spanning every Guidewire Studio area
// present in the bundle, scored for relevance against the request text. This
// is what gets injected into the Claude conversation — the agent gets a
// single coherent digest rather than five separate context blocks to piece
// together itself.
export function buildBundleSummaryForRequest(bundle, requestText) {
  if (!bundle) return null;
  const sections = [];

  if (bundle.dataDictionary) {
    const s = buildDictionarySummaryForRequest(bundle.dataDictionary, requestText);
    if (s) sections.push(`## DATA DICTIONARY (entities / typelists)\n${s}`);
  }
  if (bundle.pcfs) {
    const s = buildPCFSummaryForRequest(bundle.pcfs, requestText);
    if (s) sections.push(`## PCF SCREENS (UI)\n${s}`);
  }
  if (bundle.gosuRules) {
    const s = buildGosuRuleSummaryForRequest(bundle.gosuRules, requestText);
    if (s) sections.push(`## GOSU RULES (business logic)\n${s}`);
  }
  if (bundle.productModel) {
    const s = buildProductModelSummaryForRequest(bundle.productModel, requestText);
    if (s) sections.push(`## PRODUCT MODEL (coverages/exclusions/conditions/modifiers)\n${s}`);
  }
  if (bundle.rating) {
    const s = buildRatingSummaryForRequest(bundle.rating, requestText);
    if (s) sections.push(`## RATING (rate tables/routines/factors)\n${s}`);
  }
  if (bundle.notes) {
    const s = buildNotesSummaryForRequest(bundle.notes, requestText);
    if (s) sections.push(`## BA / MEETING NOTES (context from stakeholder discussions — unstructured, not a verified technical source)\n${s}`);
  }

  if (bundle.unknownFiles.length > 0) {
    sections.push(`## UNRECOGNIZED FILES\nThe following attached files could not be classified into a known Guidewire Studio area: ${bundle.unknownFiles.join(', ')}. Their content was not used for grounding.`);
  }

  if (sections.length === 0) return null;
  return sections.join('\n\n');
}

// Human-readable summary of what was attached, for display in the UI (not
// sent to the agent — just for the "N files attached" chip/list).
export function describeBundle(bundle) {
  if (!bundle) return [];
  const lines = [];
  if (bundle.dataDictionary) lines.push(`${ARTIFACT_KIND_LABELS[ARTIFACT_KINDS.DATA_DICTIONARY]}: ${bundle.dataDictionary.entities.length} entities, ${bundle.dataDictionary.typelists.length} typelists`);
  if (bundle.pcfs) lines.push(`${ARTIFACT_KIND_LABELS[ARTIFACT_KINDS.PCF]}: ${bundle.pcfs.length} screen(s)`);
  if (bundle.gosuRules) lines.push(`${ARTIFACT_KIND_LABELS[ARTIFACT_KINDS.GOSU_RULE]}: ${bundle.gosuRules.length} rule(s)`);
  if (bundle.productModel) lines.push(`${ARTIFACT_KIND_LABELS[ARTIFACT_KINDS.PRODUCT_MODEL]}: ${bundle.productModel.patterns.length} pattern(s)`);
  if (bundle.rating) lines.push(`${ARTIFACT_KIND_LABELS[ARTIFACT_KINDS.RATING]}: ${bundle.rating.length} item(s)`);
  if (bundle.notes) lines.push(`${ARTIFACT_KIND_LABELS[ARTIFACT_KINDS.NOTES]}: ${bundle.notes.fileNames.length} file(s), ${bundle.notes.blocks.length} note(s)`);
  if (bundle.unknownFiles.length > 0) lines.push(`Unrecognized: ${bundle.unknownFiles.length} file(s)`);
  return lines;
}

export { ARTIFACT_KINDS, ARTIFACT_KIND_LABELS };
