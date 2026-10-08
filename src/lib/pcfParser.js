// PCF (Page Configuration File) parser — client-side, no dependencies.
// PCFs are Guidewire's XML-based UI screen definitions: widgets, layout,
// field bindings, toolbar actions. Architecturally distinct from the data
// dictionary (which describes the data model, not the screens).
//
// Design note: exact PCF schema varies by Guidewire version, so this parser
// is heuristic — it captures anything that looks like a bound control (has
// a "property"/"value" binding attribute), a toolbar/button action, or an
// explicit required entity, rather than hard-coding a fixed widget taxonomy.

const MAX_SUMMARY_CHARS = 12000;
const MAX_CONTROLS_PER_SCREEN = 150;
const MAX_ACTIONS_PER_SCREEN = 40;

// Scalar/primitive Gosu type keywords that appear in <Require type="..."/>
// or <Variable type="..."/> declarations. These are NOT entity references —
// e.g. <Require name="openForEdit" type="boolean"/> declares a boolean
// screen parameter, not a required domain entity — so they must be excluded
// from requiredEntities, which should only ever hold actual Guidewire
// domain/entity type names (e.g. "Policy", "entity.Account").
const SCALAR_TYPE_KEYWORDS = new Set([
  'boolean', 'string', 'int', 'integer', 'long', 'short', 'byte', 'char',
  'decimal', 'double', 'float', 'date', 'datetime', 'void', 'object',
  'bigdecimal', 'number'
]);

function isScalarTypeKeyword(value) {
  if (!value) return true;
  // Strip generic parameters, e.g. java.util.List<String> -> java.util.List
  const base = value.split('<')[0].trim();
  const lastSegment = base.includes('.') ? base.split('.').pop() : base;
  return SCALAR_TYPE_KEYWORDS.has(lastSegment.toLowerCase());
}

export async function parsePCFFile(file) {
  const text = await file.text();
  let result;
  try {
    result = parsePCFXml(text);
  } catch (err) {
    result = {
      screenName: null,
      requiredEntities: [],
      controls: [],
      actions: [],
      parseWarning: `Could not parse "${file.name}" as PCF XML (${err.message}).`,
      rawExcerpt: text.slice(0, MAX_SUMMARY_CHARS)
    };
  }

  const parseStatus = result.parseWarning
    ? 'failed'
    : ((result.controls || []).length === 0 && (result.actions || []).length === 0 && (result.requiredEntities || []).length === 0)
      ? 'unstructured-fallback'
      : 'structured';

  return {
    fileName: file.name,
    fileSizeBytes: file.size,
    screenName: result.screenName || deriveScreenNameFromFileName(file.name),
    requiredEntities: result.requiredEntities || [],
    controls: result.controls || [],
    actions: result.actions || [],
    parseStatus,
    parseWarning: result.parseWarning || null,
    rawExcerpt: result.rawExcerpt || null
  };
}

export async function parsePCFFiles(files) {
  const parsed = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    parsed.push(await parsePCFFile(file));
  }
  return parsed; // kept as a list — each screen's identity matters, unlike data dictionary merging
}

function deriveScreenNameFromFileName(fileName) {
  return fileName.replace(/\.pcf$/i, '');
}

function parsePCFXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML parse error');

  const root = doc.documentElement;
  const screenName = root.getAttribute('name') || root.getAttribute('id') || null;

  // Required entities: <require entity="Policy"/> or similar declarations,
  // plus any top-level "extends"/"forEntity" style attributes.
  //
  // IMPORTANT: <Require>/<Variable>-style declarations also cover scalar
  // screen parameters, e.g. <Require name="openForEdit" type="boolean"/>.
  // Only the "entity" attribute unambiguously names a domain entity — the
  // "type" attribute (or bare text content) is frequently a scalar/primitive
  // Gosu type (boolean, String, int, ...) and must NOT be treated as a
  // required entity. We only fall back to "type"/text content when the
  // value does not look like a scalar keyword.
  const requiredEntities = new Set();
  const requireNodes = Array.from(doc.querySelectorAll('require, Require, ForEntity'));
  for (const node of requireNodes) {
    const entAttr = node.getAttribute('entity');
    if (entAttr) {
      requiredEntities.add(entAttr);
      continue;
    }
    const typeAttr = node.getAttribute('type');
    if (typeAttr && !isScalarTypeKeyword(typeAttr)) {
      requiredEntities.add(typeAttr);
      continue;
    }
    const textVal = node.textContent.trim();
    if (textVal && !isScalarTypeKeyword(textVal)) requiredEntities.add(textVal);
  }
  const rootEntityAttr = root.getAttribute('forEntity') || root.getAttribute('entity');
  if (rootEntityAttr && !isScalarTypeKeyword(rootEntityAttr)) requiredEntities.add(rootEntityAttr);

  // Variable resolution (in-file only): PCFs commonly declare
  //   <Variable name="isVisible" initialValue="<gosu expression>" .../>
  // and then controls reference the bare variable name in visible/available/
  // required, e.g. visible="isVisible".
  //
  // CRITICAL SCOPING NOTE (verified against real PETPetsPanelSet.pcf): real
  // PCFs REUSE the same Variable name (isVisible, isEditable) repeatedly —
  // redeclared inside each <InputSet>, immediately before the control that
  // uses it. A single flat name->value map built from ALL <Variable> nodes
  // in the document (regardless of position) would make every "isVisible"
  // reference resolve to whichever declaration happens to be LAST in the
  // file, silently corrupting every control except the final one. This is
  // wrong for the vast majority of controls in a real PCF.
  //
  // Fix: walk the document in a single document-order pass, maintaining a
  // "currently in scope" name->value map that updates whenever a <Variable>
  // is encountered and is read whenever a bound control is encountered.
  // This gives each control the NEAREST PRECEDING declaration of that
  // variable name — which matches how these variables are authored and
  // read in practice (locally re-declared right before use). Scoped
  // strictly to THIS file — we do NOT evaluate the expression or follow
  // any Gosu helper call into other files, that is out of scope.
  const inScopeVariables = new Map();

  // A resolvable attribute value is a bare identifier (letters/digits/
  // underscore only) that exactly matches a declared Variable name — NOT an
  // inline expression (which may contain operators, dots, parens, spaces).
  // If the attribute value is already an expression, it is grounded text on
  // its own and needs no resolution.
  const BARE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  // A resolved expression is "partial" (not the complete condition) whenever
  // it calls out to a Gosu helper/static method — recognizable as
  // Dotted.Path.method( — since we surface the text verbatim without
  // following the call or evaluating it.
  const GOSU_CALL_RE = /[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+\s*\(/;

  // Gosu boolean literals are NOT variable-name references even though they
  // are bare identifiers lexically (letters only, no dots/parens). Found
  // via real-file verification: visible="false"/"true" in AccountClaimsLV.pcf
  // was being treated as an unresolved variable lookup instead of the
  // already-complete literal expression it actually is.
  const BOOLEAN_LITERAL_RE = /^(true|false)$/i;

  function resolveAttr(rawValue) {
    if (!rawValue) return null;
    if (BOOLEAN_LITERAL_RE.test(rawValue)) {
      // Already a complete, grounded literal — nothing to resolve.
      return { raw: rawValue, resolved: rawValue, fromVariable: false, partial: false, resolutionStatus: 'inline-expression' };
    }
    if (!BARE_IDENTIFIER_RE.test(rawValue)) {
      // Already an inline expression / grounded text — nothing to resolve,
      // but still flag partial if it calls out to Gosu helpers.
      return {
        raw: rawValue,
        resolved: rawValue,
        fromVariable: false,
        partial: GOSU_CALL_RE.test(rawValue),
        resolutionStatus: 'inline-expression'
      };
    }
    const variable = inScopeVariables.get(rawValue);
    if (!variable || !variable.initialValue) {
      // Bare identifier but no matching Variable declaration in scope at
      // this point in the document (or no initialValue) — cannot resolve
      // further within single-file scope. This is NOT the same as "no
      // condition" — the condition is real, it is simply defined outside
      // this file (a parent PCF, a Gosu enhancement, an ancestor screen).
      // CRITICAL: do not infer meaning from the identifier name (e.g. a
      // name like "isEditable" tells us NOTHING about when the control is
      // actually editable — that would be guessing). Mark explicitly as
      // unresolved-out-of-file so downstream consumers (Gate 1) surface
      // this as an evidence gap rather than treating the bare name as if
      // it were the answer.
      return {
        raw: rawValue,
        resolved: null,
        fromVariable: false,
        partial: true,
        resolutionStatus: 'unresolved-out-of-file'
      };
    }
    return {
      raw: rawValue,
      resolved: variable.initialValue,
      fromVariable: true,
      partial: GOSU_CALL_RE.test(variable.initialValue),
      resolutionStatus: 'resolved-from-variable'
    };
  }

  // Single document-order walk: as we encounter each <Variable>, update
  // inScopeVariables (redeclaration overwrites the prior value — "nearest
  // preceding declaration wins", matching real authoring/reading order).
  // As we encounter each bound control, resolve its visible/available/
  // required attributes against whatever is in scope AT THAT POINT in the
  // walk — not against a global end-of-document snapshot.
  const controls = [];
  const walker = doc.createTreeWalker(doc.documentElement, 1 /* NodeFilter.SHOW_ELEMENT */);
  let node = walker.currentNode;
  while (node) {
    if (node.tagName === 'Variable') {
      const vName = node.getAttribute('name');
      if (vName) {
        inScopeVariables.set(vName, {
          initialValue: node.getAttribute('initialValue') || null,
          type: node.getAttribute('type') || null
        });
      }
    } else {
      const binding = node.getAttribute('property') || node.getAttribute('value') || node.getAttribute('binding');
      if (binding) {
        const visibleRaw = node.getAttribute('visible');
        const availableRaw = node.getAttribute('available');
        const requiredRaw = node.getAttribute('required');
        controls.push({
          widget: node.tagName,
          id: node.getAttribute('id') || node.getAttribute('name') || null,
          binding,
          label: node.getAttribute('label') || node.getAttribute('title') || null,
          visible: visibleRaw,
          required: requiredRaw,
          visibleResolved: resolveAttr(visibleRaw),
          availableResolved: resolveAttr(availableRaw),
          requiredResolved: resolveAttr(requiredRaw)
        });
        if (controls.length >= MAX_CONTROLS_PER_SCREEN) break;
      }
    }
    node = walker.nextNode();
  }

  // Actions: toolbar buttons / action-like elements
  const actionNodes = Array.from(doc.querySelectorAll(
    'ToolbarButton, Button, MenuItem, action, Action'
  )).slice(0, MAX_ACTIONS_PER_SCREEN);
  const actions = actionNodes.map(n => ({
    id: n.getAttribute('id') || n.getAttribute('name') || null,
    label: n.getAttribute('label') || n.getAttribute('title') || null,
    action: n.getAttribute('action') || n.getAttribute('onClick') || null
  })).filter(a => a.id || a.label);

  if (controls.length === 0 && actions.length === 0 && requiredEntities.size === 0) {
    return { screenName, requiredEntities: [], controls: [], actions: [], rawExcerpt: xml.slice(0, MAX_SUMMARY_CHARS) };
  }

  return {
    screenName,
    requiredEntities: Array.from(requiredEntities),
    controls,
    actions
  };
}

// Build a compact, request-relevant summary of one or more parsed PCFs to
// hand to the agent. Unlike the data dictionary's flat relevance scoring,
// PCFs are shown per-screen (not merged) since screen identity matters for
// design decisions (Gate 3 needs to know WHICH .pcf a field lives on).
export function buildPCFSummaryForRequest(parsedPCFs, requestText) {
  if (!parsedPCFs || parsedPCFs.length === 0) return null;

  const keywords = extractSimpleKeywords(requestText);
  const scored = parsedPCFs.map(pcf => ({
    pcf,
    score: scorePCFAgainstKeywords(pcf, keywords)
  })).sort((a, b) => b.score - a.score);

  const parts = [];
  parts.push(`PCF (UI Screen) files attached: ${parsedPCFs.length}`);

  for (const { pcf } of scored) {
    parts.push(`\n--- Screen: ${pcf.screenName || pcf.fileName} (${pcf.fileName}) ---`);
    if (pcf.requiredEntities.length > 0) {
      parts.push(`Required entities: ${pcf.requiredEntities.join(', ')}`);
    }
    if (pcf.controls.length > 0) {
      parts.push(`Controls (${pcf.controls.length}):`);
      for (const c of pcf.controls) {
        const bits = [c.widget, c.binding, c.label ? `label="${c.label}"` : null]
          .filter(Boolean).join(' | ');
        parts.push(`  - ${bits}`);
        for (const [attrName, resolved] of [['visible', c.visibleResolved], ['available', c.availableResolved], ['required', c.requiredResolved]]) {
          if (!resolved) continue;
          if (resolved.resolutionStatus === 'unresolved-out-of-file') {
            // Do NOT print the bare identifier as if it conveys meaning —
            // that invites the reader (or an LLM prompt consumer) to guess
            // at what it does from its name. State plainly that the
            // condition is undefined within this file and must be treated
            // as an evidence gap, not inferred.
            parts.push(`      ${attrName}: EVIDENCE GAP — condition "${resolved.raw}" is not defined in this file (no matching <Variable>). It is defined elsewhere (parent PCF, Gosu enhancement, or ancestor screen) and its actual behaviour is UNKNOWN from this artifact alone. Do not infer meaning from the name.`);
          } else if (resolved.resolutionStatus === 'resolved-from-variable') {
            parts.push(`      ${attrName}: ${resolved.raw} -> ${resolved.resolved}${resolved.partial ? '  [PARTIAL — calls out to Gosu helper, not evaluated]' : ''}`);
          } else {
            parts.push(`      ${attrName}: ${resolved.resolved}${resolved.partial ? '  [PARTIAL — calls out to Gosu helper, not evaluated]' : ''}`);
          }
        }
      }
    }
    if (pcf.actions.length > 0) {
      parts.push(`Actions: ${pcf.actions.map(a => a.label || a.id).filter(Boolean).join(', ')}`);
    }
    if (pcf.controls.length === 0 && pcf.actions.length === 0 && pcf.rawExcerpt) {
      parts.push('Could not detect structured control/action layout. Raw excerpt:');
      parts.push(pcf.rawExcerpt);
    }
    if (pcf.parseWarning) {
      parts.push(`[Parser warning: ${pcf.parseWarning}]`);
    }
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

function scorePCFAgainstKeywords(pcf, keywords) {
  let score = 0;
  const nameTargets = [pcf.screenName, pcf.fileName].filter(Boolean);
  for (const t of nameTargets) {
    score += matchScore(t, keywords) * 3;
  }
  for (const ent of pcf.requiredEntities) score += matchScore(ent, keywords) * 2;
  for (const c of pcf.controls) {
    score += matchScore(c.binding, keywords);
    score += matchScore(c.label, keywords);
  }
  for (const a of pcf.actions) score += matchScore(a.label, keywords);
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
