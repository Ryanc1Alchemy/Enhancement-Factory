// Frontend API client. Thin wrapper over the four backend endpoints.

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  agent: {
    advance({ gate, request, prior_artifacts }) {
      return postJSON('/api/agent', {
        mode: 'advance',
        gate,
        request,
        prior_artifacts
      });
    },
    regenerate({ gate, request, prior_artifacts, feedback, previous_artifact }) {
      return postJSON('/api/agent', {
        mode: 'regenerate',
        gate,
        request,
        prior_artifacts,
        feedback,
        previous_artifact
      });
    },
    commitJira({ request, prior_artifacts }) {
      return postJSON('/api/agent', {
        mode: 'commit_jira',
        gate: 6,
        request,
        prior_artifacts
      });
    }
  },
  runs: {
    save(run) { return postJSON('/api/runs?action=save', run); },
    get(id) { return getJSON(`/api/runs?action=get&id=${encodeURIComponent(id)}`); },
    list() { return getJSON('/api/runs?action=list'); }
  }
};

export function newRunId() {
  // crypto.randomUUID is available in modern browsers
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback (should not be needed but here for safety)
  return 'r-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
