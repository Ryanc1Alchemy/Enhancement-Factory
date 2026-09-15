import { describe, it, expect } from 'vitest';
import { GATE_ORDER, GATE_ID_NAMES, gateNumber, gateIdForNumber, isLastGate, nextGateId, isBefore, CURRENT_SCHEMA_VERSION } from './_lib/gateOrder.js';
import { GATE_TOOLS, GATE_NAMES, getToolsForGate } from './_lib/schemas.js';

describe('gateOrder', () => {
  it('has acceptance_criteria positioned before effort_estimate', () => {
    const acIndex = GATE_ORDER.indexOf('acceptance_criteria');
    const eeIndex = GATE_ORDER.indexOf('effort_estimate');
    expect(acIndex).toBeGreaterThanOrEqual(0);
    expect(eeIndex).toBeGreaterThanOrEqual(0);
    expect(acIndex).toBeLessThan(eeIndex);
  });

  it('has exactly six gates in the expected order', () => {
    expect(GATE_ORDER).toEqual([
      'request_analysis',
      'scope_definition',
      'design_note',
      'acceptance_criteria',
      'effort_estimate',
      'jira_ticket'
    ]);
  });

  it('derives gate numbers from position, 1-based', () => {
    expect(gateNumber('request_analysis')).toBe(1);
    expect(gateNumber('scope_definition')).toBe(2);
    expect(gateNumber('design_note')).toBe(3);
    expect(gateNumber('acceptance_criteria')).toBe(4);
    expect(gateNumber('effort_estimate')).toBe(5);
    expect(gateNumber('jira_ticket')).toBe(6);
  });

  it('gateIdForNumber is the inverse of gateNumber', () => {
    for (const id of GATE_ORDER) {
      expect(gateIdForNumber(gateNumber(id))).toBe(id);
    }
  });

  it('returns null for an unknown gate id or out-of-range number', () => {
    expect(gateNumber('not_a_real_gate')).toBeNull();
    expect(gateIdForNumber(99)).toBeNull();
  });

  it('identifies the last gate correctly', () => {
    expect(isLastGate('jira_ticket')).toBe(true);
    expect(isLastGate('effort_estimate')).toBe(false);
  });

  it('computes the next gate id correctly, including null past the end', () => {
    expect(nextGateId('acceptance_criteria')).toBe('effort_estimate');
    expect(nextGateId('effort_estimate')).toBe('jira_ticket');
    expect(nextGateId('jira_ticket')).toBeNull();
  });

  it('isBefore reflects array position, not alphabetical or numeric assumptions', () => {
    expect(isBefore('acceptance_criteria', 'effort_estimate')).toBe(true);
    expect(isBefore('effort_estimate', 'acceptance_criteria')).toBe(false);
    expect(isBefore('design_note', 'acceptance_criteria')).toBe(true);
  });

  it('has a schema version bumped to reflect the reorder', () => {
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('GATE_NAMES (from gateOrder, re-exported by schemas.js) covers every gate id', () => {
    for (const id of GATE_ORDER) {
      expect(GATE_ID_NAMES[id]).toBeTruthy();
      expect(GATE_NAMES[id]).toBe(GATE_ID_NAMES[id]);
    }
  });

  it('GATE_TOOLS exposes exactly one tool per standard gate id', () => {
    for (const id of GATE_ORDER) {
      expect(Array.isArray(GATE_TOOLS[id])).toBe(true);
      expect(GATE_TOOLS[id].length).toBe(1);
    }
  });

  it('the acceptance_criteria gate tool is produce_acceptance_criteria and effort_estimate is produce_effort_estimate', () => {
    expect(GATE_TOOLS['acceptance_criteria']).toEqual(['produce_acceptance_criteria']);
    expect(GATE_TOOLS['effort_estimate']).toEqual(['produce_effort_estimate']);
  });

  it('getToolsForGate resolves tool definitions (not just names) for every gate id', () => {
    for (const id of GATE_ORDER) {
      const tools = getToolsForGate(id);
      expect(tools.length).toBe(1);
      expect(tools[0]).toHaveProperty('name');
      expect(tools[0]).toHaveProperty('input_schema');
    }
  });

  it('getToolsForGate returns an empty array for an unknown gate id (no throw)', () => {
    expect(getToolsForGate('not_a_real_gate')).toEqual([]);
  });
});
