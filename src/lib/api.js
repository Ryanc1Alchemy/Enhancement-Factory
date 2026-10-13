// Frontend API client. Thin wrapper over the four backend endpoints.

// Optional shared-secret sent to /api/runs when the backend has RUNS_API_SECRET
// configured (see api/runs.js). Set VITE_RUNS_API_SECRET in the frontend build
// env to match. If unset, this header is simply omitted and the backend falls
// back to its own unauthenticated default (see api/runs.js comments).
const RUNS_API_SECRET = import.meta.env.VITE_RUNS_API_SECRET || '';

async function postJSON(url, body, extraHeaders) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.detail = data?.detail;
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getJSON(url, extraHeaders) {
  const res = await fetch(url, { headers: extraHeaders || {} });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function runsAuthHeaders() {
  return RUNS_API_SECRET ? { 'x-runs-secret': RUNS_API_SECRET } : {};
}

export const api = {
  agent: {
    advance({ gate, request, prior_artifacts, data_dictionary }) {
      return postJSON('/api/agent', {
        mode: 'advance',
        gate,
        request,
        prior_artifacts,
        data_dictionary
      });
    },
    regenerate({ gate, request, prior_artifacts, feedback, previous_artifact, data_dictionary }) {
      return postJSON('/api/agent', {
        mode: 'regenerate',
        gate,
        request,
        prior_artifacts,
        feedback,
        previous_artifact,
        data_dictionary
      });
    },
    commitJira({ request, prior_artifacts }) {
      return postJSON('/api/agent', {
        mode: 'commit_jira',
        gate: 'jira_ticket',
        request,
        prior_artifacts
      });
    }
  },
  runs: {
    save(run) { return postJSON('/api/runs?action=save', run, runsAuthHeaders()); },
    get(id) { return getJSON(`/api/runs?action=get&id=${encodeURIComponent(id)}`, runsAuthHeaders()); },
    list() { return getJSON('/api/runs?action=list', runsAuthHeaders()); },
    remove(id) { return postJSON('/api/runs?action=delete', { run_id: id }, runsAuthHeaders()); }
  },
  estimate: {
    // Direct call to the deterministic estimator endpoint — bypasses /api/agent
    // entirely. Used when the user changes the assumed delivery grade on the
    // Gate 4 card: recalculating hours for a different grade is pure
    // arithmetic on already-known complexity_inputs, so there is no reason to
    // re-invoke Claude (slower, costs tokens, and introduces non-determinism
    // for a calculation that has none). See src/hooks/useAgentRun.js
    // recomputeEstimate().
    compute({ complexity_inputs, assumed_delivery_grade, acceptance_criteria, design_note }) {
      return postJSON('/api/estimate', {
        complexity_inputs: { ...complexity_inputs, assumed_delivery_grade },
        // Approved AC lets the estimator verify the evidence map the same way
        // it does inside /api/agent — otherwise a grade change would silently
        // re-admit unverified evidence.
        acceptance_criteria,
        design_note
      });
    }
  }
};

export function newRunId() {
  // crypto.randomUUID is available in modern browsers
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback (should not be needed but here for safety)
  return 'r-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
