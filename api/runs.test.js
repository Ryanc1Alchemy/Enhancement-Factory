import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';

// /api/runs tested against a FAKE database: every query is recorded and the
// responder decides what rows come back. No DATABASE_URL, no network.

let queries = [];
let responder = () => [];
let dbOn = true;

function fakeSql(strings, ...values) {
  const text = strings.join('$').replace(/\s+/g, ' ').trim();
  const q = { text, values };
  queries.push(q);
  return Promise.resolve(responder(q));
}

vi.mock('./_lib/db.js', () => ({
  getDb: () => fakeSql,
  dbAvailable: () => dbOn
}));

const { default: handler } = await import('./runs.js');

async function call({ method = 'GET', url, body, headers = {} }) {
  const req = body !== undefined ? Readable.from([JSON.stringify(body)]) : Readable.from([]);
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost', ...headers };
  const res = { statusCode: 0, headers: {}, body: '', headersSent: false, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; this.headersSent = true; } };
  await handler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

const baseSave = {
  run_id: '11111111-1111-1111-1111-111111111111',
  request: 'add dachshund to petline',
  current_gate: 3,
  status: 'in_progress',
  artifacts: {},
  history: [],
  jira_ticket: null,
  schema_version: 3
};

describe('/api/runs (fake database)', () => {
  const originalSecret = process.env.RUNS_API_SECRET;
  beforeEach(() => {
    queries = [];
    responder = () => [];
    dbOn = true;
    delete process.env.RUNS_API_SECRET;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.RUNS_API_SECRET;
    else process.env.RUNS_API_SECRET = originalSecret;
    vi.restoreAllMocks();
  });

  it('adds the save/resume columns additively (ADD COLUMN IF NOT EXISTS only)', async () => {
    await call({ url: '/api/runs?action=list' });
    const ddl = queries.filter(q => /ALTER TABLE/.test(q.text)).map(q => q.text);
    for (const col of ['state JSONB', 'title TEXT', 'revision INT NOT NULL DEFAULT 0', 'waiting_on TEXT', 'waiting_reason TEXT', 'waiting_since TIMESTAMPTZ']) {
      expect(ddl.some(t => t.includes(`ADD COLUMN IF NOT EXISTS ${col}`))).toBe(true);
    }
    expect(queries.some(q => /DROP|ALTER COLUMN|RENAME/.test(q.text))).toBe(false);
  });

  it('save stores the snapshot and returns the new revision', async () => {
    responder = q => (q.text.startsWith('INSERT INTO agent_runs') ? [{ revision: 1 }] : []);
    const state = { snapshot_version: 1, request: 'x', gateStates: {} };
    const { status, json } = await call({ method: 'POST', url: '/api/runs?action=save', body: { ...baseSave, state, title: 'Dachshund' } });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, revision: 1 });
    const insert = queries.find(q => q.text.startsWith('INSERT INTO agent_runs'));
    expect(insert.values).toContain(JSON.stringify(state));
    expect(insert.values).toContain('Dachshund');
  });

  it('refuses a save from an out-of-date tab with 409', async () => {
    responder = q => {
      if (q.text.startsWith('INSERT INTO agent_runs')) return []; // WHERE revision = expected did not match
      if (q.text.startsWith('SELECT revision')) return [{ revision: 7 }];
      return [];
    };
    const { status, json } = await call({ method: 'POST', url: '/api/runs?action=save', body: { ...baseSave, expected_revision: 5 } });
    expect(status).toBe(409);
    expect(json.current_revision).toBe(7);
    const insert = queries.find(q => q.text.startsWith('INSERT INTO agent_runs'));
    expect(insert.values).toContain(5);
  });

  it('records who a parked run is waiting on, and clears it otherwise', async () => {
    responder = q => (q.text.startsWith('INSERT') ? [{ revision: 2 }] : []);
    await call({ method: 'POST', url: '/api/runs?action=save', body: { ...baseSave, status: 'waiting_review', waiting_on: 'Lead architect', waiting_reason: 'Design note sign-off' } });
    let insert = queries.find(q => q.text.startsWith('INSERT'));
    expect(insert.values).toContain('Lead architect');
    expect(insert.values).toContain('Design note sign-off');

    queries = [];
    await call({ method: 'POST', url: '/api/runs?action=save', body: { ...baseSave, status: 'in_progress', waiting_on: 'ignored' } });
    insert = queries.find(q => q.text.startsWith('INSERT'));
    expect(insert.values).not.toContain('ignored');
  });

  it('rejects unknown statuses and oversized saves', async () => {
    expect((await call({ method: 'POST', url: '/api/runs?action=save', body: { ...baseSave, status: 'paused??' } })).status).toBe(400);
    const big = { ...baseSave, state: { blob: 'x'.repeat(1024 * 1024 + 10) } };
    expect((await call({ method: 'POST', url: '/api/runs?action=save', body: big })).status).toBe(413);
  });

  it('list marks runs resumable only when they have a snapshot and the current gate order', async () => {
    responder = q => q.text.startsWith('SELECT run_id') ? [
      { run_id: 'a', schema_version: 3, has_state: true },
      { run_id: 'b', schema_version: 2, has_state: false },
      { run_id: 'c', schema_version: null, has_state: true }
    ] : [];
    const { json } = await call({ url: '/api/runs?action=list' });
    const byId = Object.fromEntries(json.runs.map(r => [r.run_id, r]));
    expect(byId.a.resumable).toBe(true);
    expect(byId.b.resumable).toBe(false);
    expect(byId.b.is_pre_reorder).toBe(false); // v2 is NOT pre-reorder (boundary stays at 2)
    expect(byId.c.is_pre_reorder).toBe(true);
    expect(byId.c.resumable).toBe(false);
  });

  it('list can filter to runs waiting on review', async () => {
    await call({ url: '/api/runs?action=list&status=waiting_review' });
    const sel = queries.find(q => q.text.startsWith('SELECT run_id'));
    expect(sel.text).toContain('WHERE status =');
    expect(sel.values).toContain('waiting_review');
    expect((await call({ url: '/api/runs?action=list&status=bogus' })).status).toBe(400);
  });

  it('get returns the snapshot with a resumable flag', async () => {
    responder = q => q.text.startsWith('SELECT * FROM agent_runs') ? [{ run_id: 'a', schema_version: 3, state: { snapshot_version: 1 } }] : [];
    const { status, json } = await call({ url: '/api/runs?action=get&id=a' });
    expect(status).toBe(200);
    expect(json.resumable).toBe(true);
    expect(json.run.state.snapshot_version).toBe(1);
  });

  it('honours RUNS_API_SECRET on list (the header the frontend now sends)', async () => {
    process.env.RUNS_API_SECRET = 's3cret';
    expect((await call({ url: '/api/runs?action=list' })).status).toBe(401);
    expect((await call({ url: '/api/runs?action=list', headers: { 'x-runs-secret': 's3cret' } })).status).toBe(200);
  });

  it('deletes a saved run by id', async () => {
    responder = q => q.text.startsWith('DELETE FROM agent_runs') ? [{ run_id: baseSave.run_id }] : [];
    const { status, json } = await call({
      method: 'POST',
      url: '/api/runs?action=delete',
      body: { run_id: baseSave.run_id }
    });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
    const del = queries.find(q => q.text.startsWith('DELETE FROM agent_runs'));
    expect(del.values).toContain(baseSave.run_id);
  });

  it('delete validates required id and missing rows', async () => {
    expect((await call({ method: 'POST', url: '/api/runs?action=delete', body: {} })).status).toBe(400);
    responder = q => q.text.startsWith('DELETE FROM agent_runs') ? [] : [];
    expect((await call({ method: 'POST', url: '/api/runs?action=delete', body: { run_id: baseSave.run_id } })).status).toBe(404);
  });

  it('without a database it reports db_unavailable and runs no queries', async () => {
    dbOn = false;
    const { json } = await call({ url: '/api/runs?action=list' });
    expect(json).toEqual({ db_unavailable: true });
    expect(queries).toHaveLength(0);
  });
});
