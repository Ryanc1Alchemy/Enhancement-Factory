import Anthropic from '@anthropic-ai/sdk';
import { parseBody, jsonResponse, errorResponse } from './_lib/parseBody.js';
import { SYSTEM_PROMPT } from './_lib/prompts/system.js';
import { buildGateInstruction, buildRegenerationInstruction } from './_lib/prompts/gates.js';
import { getToolsForGate, GATE_NAMES } from './_lib/schemas.js';
import { compute as computeEstimate } from './estimate.js';
import { createTicket } from './jira.js';

// ============================================================
// /api/agent.js — master agent orchestrator
// ============================================================
// Frontend drives the loop. Each call advances exactly one gate (or regenerates
// the current gate). The agent has access only to the tool(s) for the active gate,
// which enforces single-artifact-per-turn discipline at the schema level.
//
// Request body shape:
//   {
//     mode: 'advance' | 'regenerate' | 'commit_jira',
//     gate: 1..6,
//     request: "<one-line client request>",
//     prior_artifacts: { 1: {...}, 2: {...}, ... },   // accepted artifacts so far
//     feedback?: "<user feedback when regenerating>",
//     previous_artifact?: {...}                         // when regenerating
//   }
//
// Response body shape:
//   { gate, gate_name, artifact, raw_response_id, ... }
// ============================================================

export const config = {
  // Vercel: these MUST be set for the agent to avoid 504s on long Claude calls.
  // (Documented in package.json comment — Vercel reads from `export const config`.)
  maxDuration: 60
};

const MODEL = 'claude-sonnet-4-5-20250929';

// Build the conversation messages array for Claude.
// We replay accepted prior artifacts as assistant tool_use blocks so the agent has
// full context, but we only expose the current gate's tool in the tools array.
function buildMessages({ request, prior_artifacts, gate, mode, feedback, previous_artifact }) {
  const messages = [];

  // Initial user message — the request itself, set up so the agent has the
  // original ask in plain English at the start of the conversation.
  messages.push({
    role: 'user',
    content: `New enhancement request from a Guidewire client:\n\n"${request}"\n\nWe will work through the six gates one at a time. I will tell you when to start each gate.`
  });

  // Replay prior gates as a compact transcript so the agent has context without
  // trying to re-emit prior tool calls (which would confuse the schema).
  const acceptedGates = Object.keys(prior_artifacts || {})
    .map(Number)
    .filter(g => g < gate)
    .sort((a, b) => a - b);

  if (acceptedGates.length > 0) {
    const summary = acceptedGates.map(g => {
      return `--- Gate ${g} (${GATE_NAMES[g]}) — APPROVED ---\n${JSON.stringify(prior_artifacts[g], null, 2)}`;
    }).join('\n\n');

    messages.push({
      role: 'assistant',
      content: `Acknowledged. Here is the running record of approved artifacts so far:\n\n${summary}\n\nReady for the next gate.`
    });
  }

  // Now the gate-specific instruction
  let instruction;
  if (mode === 'regenerate') {
    instruction = buildRegenerationInstruction(gate, feedback, previous_artifact);
  } else {
    instruction = buildGateInstruction(gate, request);
  }

  messages.push({
    role: 'user',
    content: instruction
  });

  return messages;
}

async function callClaude({ messages, tools }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set in environment.');
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools,
    tool_choice: tools.length === 1 ? { type: 'tool', name: tools[0].name } : { type: 'auto' },
    messages
  });

  return response;
}

function extractToolUse(response, expectedToolName) {
  const block = (response.content || []).find(
    b => b.type === 'tool_use' && (!expectedToolName || b.name === expectedToolName)
  );
  if (!block) {
    throw new Error(
      `Agent did not call the expected tool. Response stop_reason: ${response.stop_reason}. ` +
      `Got content blocks: ${(response.content || []).map(b => b.type).join(', ')}`
    );
  }
  return block;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return errorResponse(res, 405, 'Method not allowed');
  }

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return errorResponse(res, 400, 'Bad request', err.message);
  }

  const { mode = 'advance', gate, request, prior_artifacts = {}, feedback, previous_artifact } = body;

  if (!gate || !request) {
    return errorResponse(res, 400, 'gate and request are required');
  }

  // ---------- Special: gate 6 commit (raise_jira_ticket) ----------
  if (mode === 'commit_jira') {
    const draft = prior_artifacts[6];
    if (!draft) {
      return errorResponse(res, 400, 'No gate 6 draft payload to commit');
    }
    try {
      const result = await createTicket(draft);
      return jsonResponse(res, 200, {
        gate: 6,
        gate_name: 'Jira Ticket',
        commit_result: result
      });
    } catch (err) {
      return errorResponse(res, 500, 'Jira commit failed', err.message);
    }
  }

  // ---------- Standard: advance or regenerate a gate ----------
  const tools = getToolsForGate(gate);
  if (!tools || tools.length === 0) {
    return errorResponse(res, 400, `No tool available for gate ${gate}`);
  }

  const messages = buildMessages({ request, prior_artifacts, gate, mode, feedback, previous_artifact });

  let response;
  try {
    response = await callClaude({ messages, tools });
  } catch (err) {
    return errorResponse(res, 502, 'Claude API error', err.message);
  }

  let toolBlock;
  try {
    toolBlock = extractToolUse(response, tools[0].name);
  } catch (err) {
    return errorResponse(res, 502, 'Agent response invalid', err.message);
  }

  let artifact = toolBlock.input;

  // ---------- Gate 4: enrich agent's complexity inputs with computed estimate ----------
  if (gate === 4 && artifact && artifact.complexity_inputs) {
    try {
      const computed = computeEstimate(artifact.complexity_inputs);
      artifact = {
        ...artifact,
        computed_estimate: computed
      };
    } catch (err) {
      // Don't fail the gate if the estimator errors — surface it inline so the
      // operator can see what went wrong without breaking the demo.
      artifact = {
        ...artifact,
        computed_estimate: null,
        estimator_error: err.message
      };
    }
  }

  return jsonResponse(res, 200, {
    gate,
    gate_name: GATE_NAMES[gate],
    artifact,
    response_id: response.id,
    stop_reason: response.stop_reason,
    usage: response.usage
  });
}
