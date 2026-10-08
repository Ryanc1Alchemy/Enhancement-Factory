// Per-gate user-message preambles. The orchestrator constructs the user message
// for each gate by combining (a) the gate-specific instruction, (b) prior artifacts
// for context, and (c) any user feedback if regenerating.
//
// Keyed by stable gate ID (see api/_lib/gateOrder.js), not number. The
// acceptance_criteria gate now runs BEFORE effort_estimate.

import { buildSkillsRubricText } from '../skillsMatrix.js';

export const GATE_INSTRUCTIONS = {
  request_analysis: `GATE — Request Analysis.

The client has provided this enhancement request:

  "{REQUEST}"

Analyse it. Surface the ambiguities — do NOT silently fill them in. The most valuable thing you can do here is identify what the human needs to clarify before this enhancement can be safely scoped. State your assumptions and confidence honestly.

If Guidewire configuration artifacts were provided earlier in this conversation (data dictionary, PCF screens, Gosu rules, product model patterns, or rating data), cross-reference the request against them: name the SPECIFIC entities/fields/typelists, screens, rules, coverage/exclusion/modifier patterns, or rate factors that are affected. If the request implies something not present in the provided artifacts, raise that as an assumption or ambiguity rather than guessing.

If BA/meeting notes were provided instead of, or alongside, structured artifacts, use them as genuine business context — they may capture stakeholder intent, rationale, constraints, or decisions from discussions that no structured export would ever contain. Incorporate that context into your analysis (e.g. why the change is wanted, who asked for it, what was already discussed or ruled out). However, notes are unstructured narrative, NOT a verified technical source: do NOT treat a name or term mentioned in notes as a confirmed entity/field/typelist/screen/rule identifier unless the notes state an exact technical identifier explicitly. If the notes describe something that would need a specific Guidewire identifier to implement, and that identifier isn't confirmed by a structured artifact or stated explicitly in the notes, raise it as an ambiguity.

If no artifacts or notes were provided at all, proceed on generic Guidewire domain knowledge as usual.

IMPORTANT — rating impact can never be confirmed from file-based artifacts. Verified against real Guidewire RateBook export XML: <RateTable> elements contain only a Checksum (opaque hash), a Definition reference (table schema/columns only), and a QueryStrategy — never actual factor/rate VALUE rows. Rate values only exist in the runtime Guidewire database, never in any file-based config export available to this agent. Therefore, if the request touches rating in ANY way (pricing, discounts, premium calculation, rate factors, rate tables), you MUST raise rating impact as an evidence gap requiring live-environment verification (Rate Management UI / actuarial sign-off) — regardless of whether rating files were attached. You MUST NEVER assert that "no rating change is required" or otherwise imply rating impact has been assessed or ruled out — that conclusion is not derivable from anything this agent can access.

Use the produce_request_analysis tool.`,

  scope_definition: `GATE — Scope Definition.

You have approved the request analysis. Now define the scope boundary.

Be deliberate about what you put in "out_of_scope" — this protects the estimate later. List dependencies and integration touchpoints concretely. Surface specific risk flags. Use the produce_scope_definition tool.`,

  design_note: `GATE — Design Note.

You have approved the scope definition. Now produce the design note in NTT DATA house style.

Name SPECIFIC Guidewire entities, typelist patterns, PCFs (by file pattern e.g., PolicyInfoDV.pcf), Gosu rule categories, and integrations. Avoid generic statements. If the change has rating impact, flag it explicitly — rating changes are higher-risk.

If PCF screens were provided earlier in this conversation, reference the ACTUAL screen name(s) and control bindings affected rather than a generic PCF file pattern. If Gosu rules were provided, reference the ACTUAL rule name(s) and category rather than a generic rule category. If product model patterns (coverage/exclusion/condition/modifier) were provided, reference the ACTUAL pattern name(s) and terms affected. If rating data (rate tables/routines/factors) was provided, reference the ACTUAL factor/table names affected rather than describing rating impact abstractly. Where the request touches something not present in any provided artifact, say so explicitly rather than inventing a plausible-sounding name.

IMPORTANT — typecode values are NOT derivable from display names. If the request asks to add a new typelist value (e.g. a new dog breed, severity level, discount tier), you must NOT invent a Code identifier by transforming the requested display name (no case-folding, no space-stripping, no assumption that "Dachshund" implies Code="Dachshund"). Verified against real Guidewire typelists: codes bear no reliable structural relationship to their display Name (e.g. Code="Bulldog" has Name="BLUE BLOOD BULLDOG"; Code="Husky" has Name="ALASKAN HUSKY"). If the exact Code value the client wants is not explicitly stated, this is a genuine ambiguity — surface it rather than guessing.

SKILL TAGGING — the org maintains a controlled skills matrix used to staff and grade delivery work. Tag "required_skills" with every skill ID from the list below that this design genuinely requires — use the "what this means" text as your rubric for whether a skill applies. Do NOT tag a skill just because it's tangentially related; only tag skills the design note actually calls for. This becomes structured data used for staffing decisions and Jira labels downstream, so precision matters more than breadth. Use the EXACT skill ID (the value before the parenthesis), not the display name.

{SKILLS_RUBRIC}

Use the produce_design_note tool.`,

  acceptance_criteria: `GATE — Acceptance Criteria.

You have approved the design note. Now produce Gherkin acceptance criteria — BEFORE the effort estimate is produced, since acceptance criteria define scope, edge cases, and negative paths that should drive how the work is sized, not the other way around.

Include at least one happy path scenario, two edge cases, and any negative scenarios that matter. Keep each scenario focused on one behaviour. Add NFR considerations where relevant (audit trail, performance, data retention, security). Be concrete and specific to this enhancement — do not restate the design note in Gherkin form; think through what could realistically go wrong or vary (missing data, invalid input, concurrent edits, boundary values, permission/role differences, downstream integration failures) and write scenarios that actually exercise those paths. The effort estimate that follows will be sized based on what you produce here, so genuinely surface the edge cases rather than a minimal token set. Use the produce_acceptance_criteria tool.`,

  effort_estimate: `GATE — Effort Estimate.

You have approved the design note AND the acceptance criteria. Now provide complexity inputs for the estimator, and you MUST take the acceptance criteria into account, not just the design note.

Acceptance criteria define scope, edge cases, and negative paths that were not necessarily visible from the design note alone. Before setting your complexity inputs, review every acceptance criteria scenario and ask: does this scenario imply additional implementation work (extra validation branches, error handling, conditional logic) or additional test work (more test cases, more setup/teardown, edge-case data) beyond what the design note alone suggested? If yes, your counts and/or overall_complexity rating MUST reflect that — do not silently ignore acceptance criteria that clearly implies more work than a bare reading of the design note would suggest. Conversely, if the acceptance criteria is minimal and closely mirrors the happy path already described in the design note, do not artificially inflate the estimate — only increase where the acceptance criteria genuinely adds scope.

Count the changes from the design note honestly, then adjust in light of the acceptance criteria. Rate the overall complexity (simple/medium/complex) — this is a multiplier so don't inflate it, but do not underrate it either if the acceptance criteria revealed non-trivial edge/negative paths. Justify your inputs in 2-4 sentences that explicitly reference which acceptance criteria scenarios (if any) influenced your counts or complexity rating. The backend will compute the hours by role and location using the AMS Engagement Estimator model. Use the produce_effort_estimate tool.`,

  jira_ticket: `GATE — Jira Ticket Payload (DRAFT).

You have approved the effort estimate. Assemble the Jira ticket payload from all prior gates.

The description should pull together the scope definition and design note into a coherent narrative — not a regurgitation. Map the effort estimate hours to Fibonacci story points using the standard table. Choose components from the LoB and entity changes. This is a DRAFT — the user will review before any real ticket is created. Use the produce_jira_payload tool.`,

  jira_ticket_commit: `GATE — Jira Ticket COMMIT.

The user has explicitly approved the draft payload. Now call raise_jira_ticket with confirmed_by_user=true to create the real Jira ticket.`
};

export function buildGateInstruction(gateId, request) {
  const tpl = GATE_INSTRUCTIONS[gateId];
  if (!tpl) return '';
  let instruction = tpl.replace('{REQUEST}', request || '');
  if (instruction.includes('{SKILLS_RUBRIC}')) {
    instruction = instruction.replace('{SKILLS_RUBRIC}', buildSkillsRubricText());
  }
  return instruction;
}

export function buildRegenerationInstruction(gateId, feedback, previousArtifact) {
  return `GATE regeneration (${gateId}).

The user has provided feedback on the previous artifact you produced for this gate. Their feedback is authoritative.

USER FEEDBACK:
${feedback}

PREVIOUS ARTIFACT (for context — supersede it):
${JSON.stringify(previousArtifact, null, 2)}

Produce a new artifact for this gate that incorporates the user's feedback. Use the same tool you used before. Do not argue. Do not add commentary.`;
}
