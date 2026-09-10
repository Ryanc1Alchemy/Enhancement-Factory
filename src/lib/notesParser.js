// BA Notes / Meeting Notes parser — client-side.
//
// Unlike the other parsers in this project (data dictionary, PCF, Gosu
// rules, product model, rating), this file does NOT parse a structured
// Guidewire Studio export. It handles free-form narrative content a
// Business Analyst attaches — meeting notes, stakeholder discussion
// summaries, requirement scratch-notes, Word docs, PDFs, Excel trackers,
// or Teams meeting transcripts.
//
// Supported source formats:
//   - .txt / .md / .markdown  - read directly as plain text
//   - .docx                   - parsed via mammoth (raw text extraction)
//   - .pdf                    - parsed via pdfjs-dist (per-page text extraction)
//   - .xlsx / .xls            - parsed via xlsx/SheetJS (all sheets, cell text joined per row)
//   - .vtt / .srt             - Teams/Zoom meeting transcript/caption files;
//                                cue numbers and timestamps are stripped, leaving
//                                just the spoken text (grouped by speaker turn where present)
//
// Design intent: this content is valuable business context (intent,
// rationale, stakeholders, constraints raised in conversation) but it is
// NOT a verified technical source. It must never be treated as confirming
// exact entity/field/typelist/screen/rule names the way a real data
// dictionary or PCF export would. The summary built here is injected
// alongside (not instead of) any structured artifacts, and Gate 1's
// instruction (api/_lib/prompts/gates.js) is responsible for telling the
// agent how to weigh it accordingly.
//
// Approach: extract raw text (format-specific), split into paragraph/turn
// blocks, score each block against keywords extracted from the enhancement
// request, and surface the most relevant blocks first (same
// relevance-scoring pattern used by dataDictionaryParser.js, pcfParser.js,
// gosuRuleParser.js, etc.) so long notes/transcripts don't blow the context
// budget with irrelevant material.

const MAX_SUMMARY_CHARS = 12000;
const MAX_BLOCKS_IN_SUMMARY = 12;
const MIN_BLOCK_LENGTH = 20; // skip near-empty lines/headers-only blocks

export async function parseNotesFile(file) {
  const name = file.name.toLowerCase();
  const ext = (name.split('.').pop() || '');

  let text = '';
  let parseWarning = null;

  try {
    if (ext === 'docx') {
      text = await extractDocxText(file);
    } else if (ext === 'pdf') {
      text = await extractPdfText(file);
    } else if (ext === 'xlsx' || ext === 'xls') {
      text = await extractSpreadsheetText(file);
    } else if (ext === 'vtt' || ext === 'srt') {
      text = extractTranscriptText(await file.text());
    } else {
      // .txt / .md / .markdown and anything else classified as NOTES
      text = await file.text();
    }
  } catch (err) {
    parseWarning = `Could not extract text from "${file.name}" (${err.message}).`;
  }

  const blocks = splitIntoBlocks(text || '');
  return {
    fileName: file.name,
    fileSizeBytes: file.size,
    blocks,
    parseWarning,
    rawExcerpt: text ? text.slice(0, MAX_SUMMARY_CHARS) : null
  };
}

export async function parseNotesFiles(files) {
  const parsedFiles = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    parsedFiles.push(await parseNotesFile(file));
  }
  return mergeNotesFiles(parsedFiles);
}

function mergeNotesFiles(parsedFiles) {
  const allBlocks = [];
  const warnings = [];
  for (const pf of parsedFiles) {
    for (const block of pf.blocks) {
      allBlocks.push({ ...block, fileName: pf.fileName });
    }
    if (pf.parseWarning) warnings.push(pf.parseWarning);
  }
  return {
    fileNames: parsedFiles.map(pf => pf.fileName),
    blocks: allBlocks,
    parseWarning: warnings.length > 0 ? warnings.join(' | ') : null
  };
}

// ---------- Format-specific extraction ----------

async function extractDocxText(file) {
  const mammoth = await import('mammoth/mammoth.browser.js');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value || '';
}

async function extractPdfText(file) {
  const pdfjsLib = await import('pdfjs-dist');
  // Vite-friendly worker wiring: resolve the worker script as a URL asset
  // rather than relying on a CDN or a global, so PDF parsing works fully
  // offline/client-side without extra server config.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const arrayBuffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    // eslint-disable-next-line no-await-in-loop
    const page = await doc.getPage(i);
    // eslint-disable-next-line no-await-in-loop
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    pageTexts.push(pageText);
  }
  return pageTexts.join('\n\n');
}

async function extractSpreadsheetText(file) {
  const XLSX = await import('xlsx');
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetTexts = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
    const rowLines = rows
      .map(row => row.map(cell => String(cell != null ? cell : '').trim()).filter(Boolean).join(' | '))
      .filter(line => line.length > 0);
    if (rowLines.length > 0) {
      sheetTexts.push('--- Sheet: ' + sheetName + ' ---\n' + rowLines.join('\n'));
    }
  }
  return sheetTexts.join('\n\n');
}

// Strips WebVTT/SRT cue numbering and timestamp lines, leaving spoken text.
// Handles the common Teams/Zoom export shape:
//   1
//   00:00:03.120 --> 00:00:07.480
//   Jane Smith: We need to confirm the discount applies to...
function extractTranscriptText(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const spokenLines = [];
  const cueNumberPattern = /^\d+$/;
  const timestampPattern = /-->/;
  const vttHeaderPattern = /^WEBVTT/i;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (vttHeaderPattern.test(trimmed)) continue;
    if (cueNumberPattern.test(trimmed)) continue;
    if (timestampPattern.test(trimmed)) continue;
    spokenLines.push(trimmed);
  }
  // Collapse consecutive lines from the same speaker (Teams often repeats
  // the "Speaker Name:" prefix across wrapped caption lines) into one block
  // per speaker turn, joined with blank lines so splitIntoBlocks treats
  // each turn as its own paragraph.
  const turns = [];
  let currentSpeaker = null;
  let currentText = [];
  const speakerPrefixPattern = /^([A-Za-z][A-Za-z .'-]{1,60}):\s*(.*)$/;
  for (const line of spokenLines) {
    const match = line.match(speakerPrefixPattern);
    if (match) {
      if (currentText.length > 0) {
        turns.push((currentSpeaker ? currentSpeaker + ': ' : '') + currentText.join(' '));
      }
      currentSpeaker = match[1];
      currentText = [match[2]];
    } else {
      currentText.push(line);
    }
  }
  if (currentText.length > 0) {
    turns.push((currentSpeaker ? currentSpeaker + ': ' : '') + currentText.join(' '));
  }
  return turns.join('\n\n');
}

// Splits raw note text into paragraph-like blocks. Notes are unstructured
// prose (unlike the tabular/XML formats the other parsers handle), so this
// is intentionally simple: split on blank lines, then also break up very
// long single blocks (e.g. one giant paste with no blank lines, or a PDF
// page with no paragraph breaks) into sentence-grouped chunks so
// scoring/truncation still works reasonably.
function splitIntoBlocks(text) {
  const rawParagraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length >= MIN_BLOCK_LENGTH);

  const blocks = [];
  for (const para of rawParagraphs) {
    if (para.length <= 800) {
      blocks.push({ text: para });
    } else {
      // Break an overly long paragraph into ~500-char sentence-aligned chunks.
      const sentences = para.match(/[^.!?]+[.!?]+|\S+$/g) || [para];
      let current = '';
      for (const s of sentences) {
        if ((current + s).length > 500 && current.length > 0) {
          blocks.push({ text: current.trim() });
          current = '';
        }
        current += s;
      }
      if (current.trim().length >= MIN_BLOCK_LENGTH) blocks.push({ text: current.trim() });
    }
  }
  return blocks;
}

export function buildNotesSummaryForRequest(parsed, requestText) {
  if (!parsed || !parsed.blocks || parsed.blocks.length === 0) return null;

  const keywords = extractKeywords(requestText);
  const scored = parsed.blocks.map(b => ({
    block: b,
    score: matchScore(b.text, keywords)
  }));

  // Prefer relevant blocks, but if nothing scores (e.g. request text is
  // sparse, or notes genuinely don't mention any request keywords), still
  // surface the first few blocks so the agent has SOME visibility into
  // what was discussed rather than nothing at all.
  scored.sort((a, b) => b.score - a.score);
  const anyRelevant = scored.some(s => s.score > 0);
  const chosen = (anyRelevant ? scored.filter(s => s.score > 0) : scored).slice(0, MAX_BLOCKS_IN_SUMMARY);

  const parts = [];
  parts.push(`BA/meeting notes found: ${parsed.blocks.length} block(s) across ${parsed.fileNames.length} file(s).`);
  parts.push('These are unstructured narrative notes - treat as context on intent/stakeholders/rationale, NOT as confirmation of exact technical identifiers (entity/field/typecode names) unless an identifier is stated explicitly.');

  if (parsed.parseWarning) parts.push(`[Parser warning: ${parsed.parseWarning}]`);

  for (const { block } of chosen) {
    parts.push(`\n- ${block.text}`);
  }

  const joined = parts.join('\n');
  return joined.length > MAX_SUMMARY_CHARS ? joined.slice(0, MAX_SUMMARY_CHARS) + '\n...[truncated]' : joined;
}

function extractKeywords(text) {
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

function matchScore(text, keywords) {
  if (!text || keywords.length === 0) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) score += 1;
  }
  return score;
}
