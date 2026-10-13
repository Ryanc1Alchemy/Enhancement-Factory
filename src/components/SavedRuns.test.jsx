// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

let listResult;
const removeRun = vi.fn(async () => ({ ok: true }));
vi.mock('../lib/api.js', () => ({
  api: {
    runs: {
      list: vi.fn(async () => listResult),
      remove: (...args) => removeRun(...args)
    }
  }
}));

const { default: SavedRuns, daysSince, sortRuns } = await import('./SavedRuns.jsx');
const { saveText } = await import('./RunStatusBar.jsx');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function render(el) {
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => { root.render(el); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { div, unmount: () => act(() => root.unmount()) };
}

const now = Date.now();
const iso = daysAgo => new Date(now - daysAgo * 86400000).toISOString();

describe('SavedRuns', () => {
  beforeEach(() => {
    listResult = { runs: [] };
    removeRun.mockReset();
    removeRun.mockResolvedValue({ ok: true });
    window.confirm = vi.fn(() => true);
  });

  it('renders nothing when the database is not configured', async () => {
    listResult = { db_unavailable: true };
    const { div, unmount } = await render(<SavedRuns onOpen={() => {}} />);
    expect(div.innerHTML).toBe('');
    unmount();
  });

  it('lists runs with gate, status, who it waits on and for how long', async () => {
    listResult = { runs: [
      { run_id: 'a', request: 'add dachshund to petline', title: 'add dachshund to petline', current_gate: 3, status: 'waiting_review', waiting_on: 'Lead architect', waiting_since: iso(3), updated_at: iso(3), resumable: true, is_pre_reorder: false },
      { run_id: 'b', request: 'old run', current_gate: 2, status: 'in_progress', updated_at: iso(0), resumable: false, is_pre_reorder: false },
      { run_id: 'c', request: 'ancient', current_gate: 4, status: 'in_progress', updated_at: iso(9), resumable: false, is_pre_reorder: true }
    ] };
    const onOpen = vi.fn();
    const { div, unmount } = await render(<SavedRuns onOpen={onOpen} />);
    const text = div.textContent;
    expect(text).toContain('Design Note');
    expect(text).toContain('Waiting on review');
    expect(text).toContain('on Lead architect · 3 days');
    const buttons = [...div.querySelectorAll('button')];
    const openViewButtons = buttons.filter(b => b.textContent === 'Open' || b.textContent === 'View');
    expect(openViewButtons.map(b => b.textContent)).toEqual(['Open', 'View', 'View']);
    expect(openViewButtons[2].disabled).toBe(true); // pre-reorder cannot be opened
    await act(async () => { openViewButtons[0].click(); });
    expect(onOpen).toHaveBeenCalledWith('a');
    unmount();
  });

  it('shows an empty-state message when nothing is saved', async () => {
    const { div, unmount } = await render(<SavedRuns onOpen={() => {}} />);
    expect(div.textContent).toContain('No saved runs yet');
    unmount();
  });

  it('deletes a run from the list after confirmation', async () => {
    listResult = {
      runs: [
        { run_id: 'a', request: 'run a', title: 'run a', current_gate: 2, status: 'in_progress', updated_at: iso(0), resumable: true, is_pre_reorder: false }
      ]
    };
    const { div, unmount } = await render(<SavedRuns onOpen={() => {}} />);
    const buttons = [...div.querySelectorAll('button')];
    const deleteBtn = buttons.find(b => b.textContent === 'Delete');
    expect(deleteBtn).toBeTruthy();

    await act(async () => { deleteBtn.click(); });
    expect(window.confirm).toHaveBeenCalled();
    expect(removeRun).toHaveBeenCalledWith('a');
    expect(div.textContent).toContain('No saved runs yet');
    unmount();
  });
});

describe('helpers', () => {
  it('sorts waiting runs first, longest wait first, then most recent', () => {
    const runs = [
      { run_id: 'recent', status: 'in_progress', updated_at: iso(0) },
      { run_id: 'wait1', status: 'waiting_review', waiting_since: iso(1) },
      { run_id: 'older', status: 'in_progress', updated_at: iso(5) },
      { run_id: 'wait5', status: 'waiting_review', waiting_since: iso(5) }
    ];
    expect(sortRuns(runs).map(r => r.run_id)).toEqual(['wait5', 'wait1', 'recent', 'older']);
  });

  it('counts whole days waited', () => {
    expect(daysSince(iso(2), now)).toBe(2);
    expect(daysSince(null)).toBeNull();
  });

  it('describes the save state in plain words', () => {
    expect(saveText({ saveStatus: 'unavailable' })).toBe(''); // nothing shown without a database
    expect(saveText({ saveStatus: 'conflict' })).toContain('another tab');
    expect(saveText({ saveStatus: 'saved', lastSavedAt: now })).toMatch(/^Saved \d/);
  });
});
