import { neon } from '@neondatabase/serverless';

let _client = null;

export function getDb() {
  if (_client) return _client;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  _client = neon(url);
  return _client;
}

export function dbAvailable() {
  return Boolean(process.env.DATABASE_URL);
}

// Schema (also documented in README):
//
// CREATE TABLE IF NOT EXISTS agent_runs (
//   run_id        UUID PRIMARY KEY,
//   request       TEXT NOT NULL,
//   current_gate  INT NOT NULL DEFAULT 0,
//   status        TEXT NOT NULL DEFAULT 'in_progress',
//   artifacts     JSONB NOT NULL DEFAULT '{}'::jsonb,
//   history       JSONB NOT NULL DEFAULT '[]'::jsonb,
//   jira_ticket   TEXT,
//   created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
//   updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
// );
