import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { GATES } from '../lib/gates.js';

// Saved runs list for the start screen. Renders nothing when the database is
// not configured (the app then behaves exactly as before save & resume).

const STATUS_LABEL = {
  in_progress: { text: 'In progress', cls: '' },
  waiting_review: { text: 'Waiting on review', cls: 'warn' },
  completed: { text: 'Ticket raised', cls: 'success' }
};

export function daysSince(iso, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86400000));
}

function gateName(n) {
  return GATES[(n || 1) - 1]?.name || '—';
}

// Waiting runs first (longest wait first), then most recently updated.
export function sortRuns(runs) {
  return [...runs].sort((a, b) => {
    const aw = a.status === 'waiting_review', bw = b.status === 'waiting_review';
    if (aw !== bw) return aw ? -1 : 1;
    if (aw && bw) return Date.parse(a.waiting_since || 0) - Date.parse(b.waiting_since || 0);
    return Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0);
  });
}

export default function SavedRuns({ onOpen, disabled }) {
  const [state, setState] = useState({ loading: true, runs: [], unavailable: false, error: null });

  useEffect(() => {
    let cancelled = false;
    api.runs.list()
      .then(res => {
        if (cancelled) return;
        if (res?.db_unavailable) setState({ loading: false, runs: [], unavailable: true, error: null });
        else setState({ loading: false, runs: sortRuns(res?.runs || []), unavailable: false, error: null });
      })
      .catch(err => { if (!cancelled) setState({ loading: false, runs: [], unavailable: false, error: err.message }); });
    return () => { cancelled = true; };
  }, []);

  if (state.unavailable) return null;

  return (
    <div className="request-entry saved-runs">
      <h3>Saved runs</h3>
      {state.loading && <p className="muted small">Loading saved runs…</p>}
      {state.error && <p className="muted small">Saved runs could not be loaded ({state.error}).</p>}
      {!state.loading && !state.error && state.runs.length === 0 && (
        <p className="muted small">No saved runs yet. Runs save automatically as you work through the gates.</p>
      )}
      {state.runs.length > 0 && (
        <table className="artifact-table">
          <thead>
            <tr><th>Request</th><th>Gate</th><th>Status</th><th>Last updated</th><th /></tr>
          </thead>
          <tbody>
            {state.runs.map(r => {
              const label = STATUS_LABEL[r.status] || STATUS_LABEL.in_progress;
              const waited = r.status === 'waiting_review' ? daysSince(r.waiting_since) : null;
              return (
                <tr key={r.run_id}>
                  <td title={r.request}>{r.title || r.request}</td>
                  <td>{r.is_pre_reorder ? '—' : gateName(r.current_gate)}</td>
                  <td>
                    <span className={`artifact-pill ${label.cls}`}>{label.text}</span>
                    {r.status === 'waiting_review' && (
                      <div className="muted small">
                        {r.waiting_on ? `on ${r.waiting_on}` : ''}{waited != null ? ` · ${waited} day${waited === 1 ? '' : 's'}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="muted small">{r.updated_at ? new Date(r.updated_at).toLocaleString() : '—'}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => onOpen(r.run_id)}
                      disabled={disabled || r.is_pre_reorder}
                      title={
                        r.is_pre_reorder
                          ? 'Saved before the gate order changed — cannot be reopened'
                          : r.resumable ? 'Reopen where you left off' : 'Saved before save & resume — opens read-only'
                      }
                    >
                      {r.resumable ? 'Open' : 'View'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
