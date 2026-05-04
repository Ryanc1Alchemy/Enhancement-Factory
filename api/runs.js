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
      run_id        UUID PRIMARY KEY,
      request       TEXT NOT NULL,
      current_gate  INT NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'in_progress',
      artifacts     JSONB NOT NULL DEFAULT '{}'::jsonb,
      history       JSONB NOT NULL DEFAULT '[]'::jsonb,
      jira_ticket   TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

export default async function handler(req, res) {
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
        SELECT run_id, request, current_gate, status, jira_ticket, created_at, updated_at
        FROM agent_runs
        ORDER BY updated_at DESC
        LIMIT 25
      `;
      return jsonResponse(res, 200, { runs: rows });
    }

    if (req.method === 'GET' && action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return errorResponse(res, 400, 'Missing id');
      const rows = await sql`SELECT * FROM agent_runs WHERE run_id = ${id} LIMIT 1`;
      if (rows.length === 0) return errorResponse(res, 404, 'Run not found');
      return jsonResponse(res, 200, { run: rows[0] });
    }

    if (req.method === 'POST' && action === 'save') {
      const body = await parseBody(req);
      const { run_id, request, current_gate, status, artifacts, history, jira_ticket } = body;
      if (!run_id || !request) return errorResponse(res, 400, 'run_id and request required');

      await sql`
        INSERT INTO agent_runs (run_id, request, current_gate, status, artifacts, history, jira_ticket)
        VALUES (${run_id}, ${request}, ${current_gate || 0}, ${status || 'in_progress'},
                ${JSON.stringify(artifacts || {})}::jsonb,
                ${JSON.stringify(history || [])}::jsonb,
                ${jira_ticket || null})
        ON CONFLICT (run_id) DO UPDATE SET
          request      = EXCLUDED.request,
          current_gate = EXCLUDED.current_gate,
          status       = EXCLUDED.status,
          artifacts    = EXCLUDED.artifacts,
          history      = EXCLUDED.history,
          jira_ticket  = EXCLUDED.jira_ticket,
          updated_at   = now()
      `;
      return jsonResponse(res, 200, { ok: true });
    }

    return errorResponse(res, 400, 'Unknown action');
  } catch (err) {
    return errorResponse(res, 500, 'DB error', err.message);
  }
}
