// Per-gate user-message preambles. The orchestrator constructs the user message
// for each gate by combining (a) the gate-specific instruction, (b) prior artifacts
// for context, and (c) any user feedback if regenerating.

export const GATE_INSTRUCTIONS = {
  1: `GATE 1 — Request Analysis.

The client has provided this enhancement request:

  "{REQUEST}"

Analyse it. Surface the ambiguities — do NOT silently fill them in. The most valuable thing you can do here is identify what the human needs to clarify before this enhancement can be safely scoped. State your assumptions and confidence honestly.

If Guidewire configuration artifacts were provided earlier in this conversation (data dictionary, PCF screens, Gosu rules, product model patterns, or rating data), cross-reference the request against them: name the SPECIFIC entities/fields/typelists, screens, rules, coverage/exclusion/modifier patterns, or rate factors that are affected. If the request implies something not present in the provided artifacts, raise that as an assumption or ambiguity rather than guessing. If no artifacts were provided, proceed on generic Guidewire domain knowledge as usual.

IMPORTANT — rating impact can never be confirmed from file-based artifacts. Verified against real Guidewire RateBook export XML: <RateTable> elements contain only a Checksum (opaque hash), a Definition reference (table schema/columns only), and a QueryStrategy — never actual factor/rate VALUE rows. Rate values only exist in the runtime Guidewire database, never in any file-based config export available to this agent. Therefore, if the request touches rating in ANY way (pricing, discounts, premium calculation, rate factors, rate tables), you MUST raise rating impact as an evidence gap requiring live-environment verification (Rate Management UI / actuarial sign-off) — regardless of whether rating files were attached. You MUST NEVER assert that "no rating change is required" or otherwise imply rating impact has been assessed or ruled out — that conclusion is not derivable from anything this agent can access.

Use the produce_request_analysis tool.`,

  2: `GATE 2 — Scope Definition.

You have approved the request analysis at gate 1. Now define the scope boundary.

Be deliberate about what you put in "out_of_scope" — this protects the estimate later. List dependencies and integration touchpoints concretely. Surface specific risk flags. Use the produce_scope_definition tool.`,

  3: `GATE 3 — Design Note.

You have approved scope at gate 2. Now produce the design note in NTT DATA house style.

Name SPECIFIC Guidewire entities, typelist patterns, PCFs (by file pattern e.g., PolicyInfoDV.pcf), Gosu rule categories, and integrations. Avoid generic statements. If the change has rating impact, flag it explicitly — rating changes are higher-risk.

If PCF screens were provided earlier in this conversation, reference the ACTUAL screen name(s) and control bindings affected rather than a generic PCF file pattern. If Gosu rules were provided, reference the ACTUAL rule name(s) and category rather than a generic rule category. If product model patterns (coverage/exclusion/condition/modifier) were provided, reference the ACTUAL pattern name(s) and terms affected. If rating data (rate tables/routines/factors) was provided, reference the ACTUAL factor/table names affected rather than describing rating impact abstractly. Where the request touches something not present in any provided artifact, say so explicitly rather than inventing a plausible-sounding name.

IMPORTANT — typecode values are NOT derivable from display names. If the request asks to add a new typelist value (e.g. a new dog breed, severity level, discount tier), you must NOT invent a Code identifier by transforming the requested display name (no case-folding, no space-stripping, no assumption that "Dachshund" implies Code="Dachshund"). Verified against real Guidewire typelists: codes bear no reliable structural relationship to their display Name (e.g. Code="Bulldog" has Name="BLUE BLOOD BULLDOG"; Code="Husky" has Name="ALASKAN HUSKY"). If the exact Code value the client wants is not explicitly stated, this is a genuine ambiguity — surface it rather than guessing.

Use the produce_design_note tool.`,

  4: `GATE 4 — Effort Estimate.

You have approved the design at gate 3. Now provide complexity inputs for the estimator.

Count the changes from the design note honestly. Rate the overall complexity (simple/medium/complex) — this is a multiplier so don't inflate it. Justify your inputs in 2-4 sentences. The backend will compute the hours by role and location using the AMS Engagement Estimator model. Use the produce_effort_estimate tool.`,

  5: `GATE 5 — Acceptance Criteria.

You have approved the estimate at gate 4. Now produce Gherkin acceptance criteria.

Include at least one happy path scenario, two edge cases, and any negative scenarios that matter. Keep each scenario focused on one behaviour. Add NFR considerations where relevant (audit trail, performance, data retention, security). Use the produce_acceptance_criteria tool.`,

  6: `GATE 6 — Jira Ticket Payload (DRAFT).

You have approved acceptance criteria at gate 5. Assemble the Jira ticket payload from the previous five gates.

The description should pull together scope (gate 2) and design summary (gate 3) into a coherent narrative — not a regurgitation. Map the gate 4 hours to Fibonacci story points using the standard table. Choose components from the LoB and entity changes. This is a DRAFT — the user will review before any real ticket is created. Use the produce_jira_payload tool.`,

  6.5: `GATE 6 — Jira Ticket COMMIT.

The user has explicitly approved the draft payload. Now call raise_jira_ticket with confirmed_by_user=true to create the real Jira ticket.`
};

export function buildGateInstruction(gate, request) {
  const tpl = GATE_INSTRUCTIONS[gate];
  return tpl ? tpl.replace('{REQUEST}', request || '') : '';
}

export function buildRegenerationInstruction(gate, feedback, previousArtifact) {
  return `GATE ${gate} regeneration.

The user has provided feedback on the previous artifact you produced for this gate. Their feedback is authoritative.

USER FEEDBACK:
${feedback}

PREVIOUS ARTIFACT (for context — supersede it):
${JSON.stringify(previousArtifact, null, 2)}

Produce a new artifact for this gate that incorporates the user's feedback. Use the same tool you used before. Do not argue. Do not add commentary.`;
}
