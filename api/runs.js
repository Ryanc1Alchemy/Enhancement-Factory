import { parseBody, jsonResponse, errorResponse } from './_lib/parseBody.js';
import { getDb, dbAvailable } from './_lib/db.js';

// ============================================================
// /api/runs — save / load / list agent runs
// ============================================================
// Endpoints:
//   POST   /api/runs?action=save     { run_id, request, current_gate, status, artifacts, history, jira_ticket }
//   GET    /api/runs?action=get&id=  → returns run row
//   GET    /api/runs?action=list     → returns recent 25 runs
//
// If DATABASE_URL is not set, the API returns { db_unavailable: true } and the
// frontend keeps state in memory only. The agent still works — just no save/resume.
// ============================================================

async function ensureSchema(sql) {
  // Idempotent — safe to run on every cold start.
  await sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      run_id          UUID PRIMARY KEY,
      request         TEXT NOT NULL,
      current_gate    INT NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'in_progress',
      artifacts       JSONB NOT NULL DEFAULT '{}'::jsonb,
      history         JSONB NOT NULL DEFAULT '[]'::jsonb,
      jira_ticket     TEXT,
      schema_version  INT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Additive migration for tables created before schema_version existed —
  // ALTER TABLE ... ADD COLUMN IF NOT EXISTS is idempotent and safe to run
  // on every cold start. This does NOT backfill a value for existing rows —
  // existing rows keep schema_version = NULL, which the app treats as "v1 /
  // pre-reorder" (see isPreReorderRun below). We never silently mutate or
  // delete existing rows; NULL is a legitimate, meaningful value here, not
  // an oversight to be papered over.
  await sql`ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS schema_version INT`;
}

// A run is considered "pre-reorder" (v1 numeric gate semantics: gate 4 =
// Effort Estimate, gate 5 = Acceptance Criteria) if it has no schema_version
// stamped, or a version below the current one. The frontend/backend must
// never reinterpret such a run's `current_gate`/`artifacts` under the NEW
// gate id meanings without the caller being explicitly aware of this.
const CURRENT_SCHEMA_VERSION = 2;
function isPreReorderRun(row) {
  return !row.schema_version || row.schema_version < CURRENT_SCHEMA_VERSION;
}

// Optional shared-secret auth. If RUNS_API_SECRET is set, all requests to this
// endpoint must include a matching `x-runs-secret` header — this closes off
// unauthenticated public access to saved run data (which may contain client
// enhancement requests and any attached BA notes/data dictionary content).
// If RUNS_API_SECRET is not set, the endpoint remains open (so local dev and
// demo setups without this configured keep working exactly as before) — a
// warning is logged so this doesn't go unnoticed in a real deployment.
function isAuthorized(req) {
  const secret = process.env.RUNS_API_SECRET;
  if (!secret) {
    // eslint-disable-next-line no-console
    console.warn('[runs] RUNS_API_SECRET is not set — /api/runs is unauthenticated. Set RUNS_API_SECRET to restrict access.');
    return true;
  }
  return req.headers['x-runs-secret'] === secret;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return errorResponse(res, 401, 'Unauthorized');
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const action = url.searchParams.get('action');

  if (!dbAvailable()) {
    return jsonResponse(res, 200, { db_unavailable: true });
  }

  const sql = getDb();

  try {
    await ensureSchema(sql);

    if (req.method === 'GET' && action === 'list') {
      const rows = await sql`
        SELECT run_id, request, current_gate, status, jira_ticket, schema_version, created_at, updated_at
        FROM agent_runs
        ORDER BY updated_at DESC
        LIMIT 25
      `;
      // Annotate each row with whether it predates the gate reorder, so the
      // frontend can warn/disable "resume" for old runs instead of silently
      // misinterpreting their gate numbering.
      const annotated = rows.map(r => ({ ...r, is_pre_reorder: isPreReorderRun(r) }));
      return jsonResponse(res, 200, { runs: annotated });
    }

    if (req.method === 'GET' && action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return errorResponse(res, 400, 'Missing id');
      const rows = await sql`SELECT * FROM agent_runs WHERE run_id = ${id} LIMIT 1`;
      if (rows.length === 0) return errorResponse(res, 404, 'Run not found');
      const run = rows[0];
      // Never silently reinterpret a pre-reorder run's artifacts/current_gate
      // under the new gate id meanings — surface the flag and let the caller
      // decide (e.g. the frontend can refuse to "resume" it, or show a
      // migration notice) rather than the backend guessing on its behalf.
      return jsonResponse(res, 200, { run, is_pre_reorder: isPreReorderRun(run) });
    }

    if (req.method === 'POST' && action === 'save') {
      const body = await parseBody(req);
      const { run_id, request, current_gate, status, artifacts, history, jira_ticket, schema_version } = body;
      if (!run_id || !request) return errorResponse(res, 400, 'run_id and request required');

      await sql`
        INSERT INTO agent_runs (run_id, request, current_gate, status, artifacts, history, jira_ticket, schema_version)
        VALUES (${run_id}, ${request}, ${current_gate || 0}, ${status || 'in_progress'},
                ${JSON.stringify(artifacts || {})}::jsonb,
                ${JSON.stringify(history || [])}::jsonb,
                ${jira_ticket || null},
                ${schema_version || CURRENT_SCHEMA_VERSION})
        ON CONFLICT (run_id) DO UPDATE SET
          request        = EXCLUDED.request,
          current_gate   = EXCLUDED.current_gate,
          status         = EXCLUDED.status,
          artifacts      = EXCLUDED.artifacts,
          history        = EXCLUDED.history,
          jira_ticket    = EXCLUDED.jira_ticket,
          schema_version = EXCLUDED.schema_version,
          updated_at     = now()
      `;
      return jsonResponse(res, 200, { ok: true });
    }

    return errorResponse(res, 400, 'Unknown action');
  } catch (err) {
    return errorResponse(res, 500, 'DB error', err.message);
  }
}
