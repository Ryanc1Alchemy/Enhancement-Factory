// Guidewire practice skills matrix -- controlled vocabulary for Gate 3 tagging.
// Extracted from the org's Capability Self Assessment workbook. Skill ID / Name /
// "What this means" are identical across every grade tab (Bronze1-Gold2) -- only
// Target Score changes per grade -- so this is the single deduplicated source of
// truth the Gate 3 tool schema (api/_lib/schemas.js) and Gate 3 prompt
// (api/_lib/prompts/gates.js) both draw from. Using this as a schema enum means
// the agent is structurally unable to tag a skill outside the org's real list.

export const SKILLS_MATRIX = [
  { id: 'decision_framing', name: 'Decision Framing', whatThisMeans: 'Structuring problems and options so stakeholders can make informed decisions.', category: 'Analysis & Solution Shaping' },
  { id: 'estimation_scoping', name: 'Estimation & Scoping', whatThisMeans: 'Sizing work, scoping delivery increments, and estimating effort with appropriate uncertainty.', category: 'Analysis & Solution Shaping' },
  { id: 'recommendation_development', name: 'Recommendation Development', whatThisMeans: 'Developing actionable recommendations backed by analysis, evidence, and clear rationale.', category: 'Analysis & Solution Shaping' },
  { id: 'requirements_traceability', name: 'Requirements Traceability', whatThisMeans: 'Requirements Traceability competency from the revised IT mapping.', category: 'Analysis & Solution Shaping' },
  { id: 'assumption_testing', name: 'Assumption Testing', whatThisMeans: 'Assumption Testing consultancy capability for controlled role assessment.', category: 'Client & Stakeholder Engagement' },
  { id: 'attention_to_detail', name: 'Attention to Detail', whatThisMeans: 'Attention to Detail consultancy capability for controlled role assessment.', category: 'Client & Stakeholder Engagement' },
  { id: 'critical_thinking', name: 'Critical Thinking', whatThisMeans: 'Critical Thinking consultancy capability for controlled role assessment.', category: 'Client & Stakeholder Engagement' },
  { id: 'ownership_accountability', name: 'Ownership & Accountability', whatThisMeans: 'Ownership & Accountability consultancy capability for controlled role assessment.', category: 'Client & Stakeholder Engagement' },
  { id: 'stakeholder_expectation_setting', name: 'Stakeholder Expectation Setting', whatThisMeans: 'Stakeholder Expectation Setting consultancy capability for controlled role assessment.', category: 'Client & Stakeholder Engagement' },
  { id: 'stakeholder_influence', name: 'Stakeholder Influence', whatThisMeans: 'Influencing stakeholders to agree priorities, accept recommendations, and support delivery decisions.', category: 'Client & Stakeholder Engagement' },
  { id: 'written_communication', name: 'Written Communication', whatThisMeans: 'Written Communication consultancy capability for controlled role assessment.', category: 'Client & Stakeholder Engagement' },
  { id: 'analysis_documentation', name: 'Analysis Documentation', whatThisMeans: 'Analysis Documentation competency from the revised IT mapping.', category: 'Communication & Documentation' },
  { id: 'collaboration', name: 'Collaboration', whatThisMeans: 'Collaboration behaviour from the revised IT mapping.', category: 'Communication & Documentation' },
  { id: 'communication', name: 'Communication', whatThisMeans: 'Clear written and spoken communication with stakeholders, delivery teams, and peers.', category: 'Communication & Documentation' },
  { id: 'maintainability_focus', name: 'Maintainability Focus', whatThisMeans: 'Maintainability Focus behaviour from the revised IT mapping.', category: 'Communication & Documentation' },
  { id: 'quality_focus', name: 'Quality Focus', whatThisMeans: 'Quality Focus behaviour from the revised IT mapping.', category: 'Communication & Documentation' },
  { id: 'training_delivery', name: 'Training Delivery', whatThisMeans: 'Training Delivery competency from the revised IT mapping.', category: 'Communication & Documentation' },
  { id: 'agile_delivery_literacy', name: 'Agile Delivery Literacy', whatThisMeans: 'Agile Delivery Literacy competency from the revised IT mapping.', category: 'Delivery Execution' },
  { id: 'high_complexity_delivery', name: 'Delivered high-complexity change', whatThisMeans: 'Experience signal: Delivered high-complexity change.', category: 'Delivery Execution' },
  { id: 'low_complexity_delivery', name: 'Delivered low-complexity change', whatThisMeans: 'Experience signal: Delivered low-complexity change.', category: 'Delivery Execution' },
  { id: 'medium_complexity_delivery', name: 'Delivered medium-complexity change', whatThisMeans: 'Experience signal: Delivered medium-complexity change.', category: 'Delivery Execution' },
  { id: 'coaching_mentoring', name: 'Coaching & Mentoring', whatThisMeans: 'Coaching colleagues through technical and delivery challenges beyond informal mentoring.', category: 'Leadership, Mentoring & Influence' },
  { id: 'constructive_challenge', name: 'Constructive Challenge', whatThisMeans: 'Respectfully questioning assumptions, scope, and solutions to improve outcomes.', category: 'Leadership, Mentoring & Influence' },
  { id: 'delegation', name: 'Delegation', whatThisMeans: 'Delegation consultancy capability for controlled role assessment.', category: 'Leadership, Mentoring & Influence' },
  { id: 'leadership_without_authority', name: 'Leadership Without Authority', whatThisMeans: 'Leading outcomes across teams when you are not the line manager or formal lead.', category: 'Leadership, Mentoring & Influence' },
  { id: 'mentoring', name: 'Mentoring', whatThisMeans: 'Supporting colleagues through mentoring conversations, feedback, and career development guidance.', category: 'Leadership, Mentoring & Influence' },
  { id: 'professional_presence', name: 'Professional Presence', whatThisMeans: 'Demonstrating credibility, composure, and professionalism with clients and senior stakeholders.', category: 'Leadership, Mentoring & Influence' },
  { id: 'technical_delivery_leadership', name: 'Technical Leadership', whatThisMeans: 'Providing technical direction, unblocking delivery, and raising engineering/analysis standards.', category: 'Leadership, Mentoring & Influence' },
  { id: 'capability_development', name: 'Capability Development', whatThisMeans: 'Growing organisational capability through hiring support, learning paths, and community contributions.', category: 'Practice, Community & Business Growth' },
  { id: 'practice_governance', name: 'Practice Standards & Governance', whatThisMeans: 'Defining and enforcing practice standards, quality gates, and capability operating models.', category: 'Practice, Community & Business Growth' },
  { id: 'defect_analysis', name: 'Defect Analysis', whatThisMeans: 'Defect Analysis competency from the revised IT mapping.', category: 'Quality, Risk & Assurance' },
  { id: 'quality_governance', name: 'Delivery Assurance', whatThisMeans: 'Assuring delivery quality through gates, reviews, metrics, and risk escalation.', category: 'Quality, Risk & Assurance' },
  { id: 'defect_root_cause_investigation', name: 'Led complex defect root-cause investigation', whatThisMeans: 'Experience signal: Led complex defect root-cause investigation.', category: 'Quality, Risk & Assurance' },
  { id: 'nfr_definition', name: 'Non-Functional Requirements', whatThisMeans: 'Capturing and validating performance, security, availability, and operational requirements.', category: 'Quality, Risk & Assurance' },
  { id: 'test_data_preparation', name: 'Test Data Preparation', whatThisMeans: 'Test Data Preparation competency from the revised IT mapping.', category: 'Quality, Risk & Assurance' },
  { id: 'configuration_analysis', name: 'Configuration Analysis', whatThisMeans: 'Configuration Analysis competency from the revised IT mapping.', category: 'Technical / Domain Capability' },
  { id: 'data_mapping', name: 'Data Mapping', whatThisMeans: 'Mapping source to target data elements with transformation rules and lineage context.', category: 'Technical / Domain Capability' },
  { id: 'design_governance', name: 'Design Governance', whatThisMeans: 'Applying design review, standards, and approval processes to control technical risk.', category: 'Technical / Domain Capability' },
  { id: 'detailed_design_specification', name: 'Detailed Design Specification', whatThisMeans: 'Detailed Design Specification competency from the revised IT mapping.', category: 'Technical / Domain Capability' },
  { id: 'domain_technical_authority', name: 'Domain Technical Authority', whatThisMeans: 'Acts as the senior technical authority for a Guidewire product area or technical domain.', category: 'Technical / Domain Capability' },
  { id: 'functional_design_specification', name: 'Functional Design Specification', whatThisMeans: 'Functional Design Specification competency from the revised IT mapping.', category: 'Technical / Domain Capability' },
  { id: 'integration_analysis', name: 'Integration Analysis', whatThisMeans: 'Integration Analysis competency from the revised IT mapping.', category: 'Technical / Domain Capability' },
  { id: 'integration_specification', name: 'Integration Specification', whatThisMeans: 'Integration Specification competency from the revised IT mapping.', category: 'Technical / Domain Capability' },
  { id: 'project_technical_solution_ownership', name: 'Project Technical Solution Ownership', whatThisMeans: 'Owns the end-to-end technical solution within a project, workstream, module, or application area.', category: 'Technical / Domain Capability' },
  { id: 'reference_architecture_ownership', name: 'Reference Architecture Ownership', whatThisMeans: 'Creating, governing, and evolving reference architectures and reusable design assets.', category: 'Technical / Domain Capability' },
  { id: 'requirements_to_functional_design_translation', name: 'Requirements to Functional Design Translation', whatThisMeans: 'Requirements to Functional Design Translation competency from the revised IT mapping.', category: 'Technical / Domain Capability' },
  { id: 'reusable_asset_development', name: 'Reusable Asset Development', whatThisMeans: 'Develops and curates reusable templates, configuration patterns, reference designs, and practice assets.', category: 'Technical / Domain Capability' },
  { id: 'solution_option_analysis', name: 'Solution Option Analysis', whatThisMeans: 'Solution Option Analysis competency from the revised IT mapping.', category: 'Technical / Domain Capability' },
  { id: 'systems_analysis', name: 'Systems Analysis', whatThisMeans: 'Systems Analysis competency from the revised IT mapping.', category: 'Technical / Domain Capability' },
  { id: 'technical_design', name: 'Technical Design', whatThisMeans: 'Technical Design competency from the revised IT mapping.', category: 'Technical / Domain Capability' },
  { id: 'technical_standards_patterns', name: 'Technical Standards & Patterns', whatThisMeans: 'Defines, maintains, and applies technical standards, patterns, best practices, and reference designs.', category: 'Technical / Domain Capability' },
  { id: 'toolchain_proficiency', name: 'Toolchain Proficiency', whatThisMeans: 'Toolchain Proficiency competency from the revised IT mapping.', category: 'Technical / Domain Capability' },
  { id: 'cross_system_change', name: 'Worked across multiple systems or domains', whatThisMeans: 'Experience signal: Worked across multiple systems or domains.', category: 'Technical / Domain Capability' }
];

// Skills whose Target Score is N/A through Silver2 in the workbook and only
// actually targeted starting at Gold -- i.e. a genuine "needs a senior" signal
// if a Gate 3 design tags any of these. See api/agent.js for the Gold
// escalation flag this feeds.
export const GOLD_ONLY_SKILLS = [
  'detailed_design_specification',
  'solution_option_analysis',
  'cross_system_change',
  'nfr_definition',
  'defect_root_cause_investigation',
  'medium_complexity_delivery',
  'maintainability_focus',
  'mentoring'
];

export const SKILL_IDS = SKILLS_MATRIX.map(s => s.id);

// Rubric text for the Gate 3 prompt: a compact "id -- name: what this means" list.
export function buildSkillsRubricText() {
  return SKILLS_MATRIX.map(s => `- ${s.id} (${s.name}): ${s.whatThisMeans}`).join('\n');
}

export function isGoldOnlySkill(skillId) {
  return GOLD_ONLY_SKILLS.includes(skillId);
}
