import { useState } from 'react';
import { STATES } from '../lib/gates.js';
import { GATE_RENDERERS } from './artifactRenderers.jsx';
import RejectModal from './RejectModal.jsx';
import EditModal from './EditModal.jsx';

export default function ArtifactCard({
  gate,
  gateNumber,
  name,
  subtitle,
  state,
  artifact,
  jiraResult,
  usage,
  busy,
  onAccept,
  onReject,
  onEdit,
  onReopen,
  onRecomputeEstimate
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const isPending = state === STATES.PENDING;
  const isProposed = state === STATES.PROPOSED;
  const isAccepted = state === STATES.ACCEPTED || state === STATES.COMMITTED;
  const isRegenerating = state === STATES.REGENERATING;

  const renderer = GATE_RENDERERS[gate];

  return (
    <>
      <div className={`card ${state} ${collapsed ? 'collapsed' : ''}`}>
        <div className="card-head" onClick={() => !isPending && setCollapsed(c => !c)}>
          <div className="card-head-left">
            <div className="card-num">{gateNumber}</div>
            <div>
              <div className="card-title">Gate {gateNumber} — {name}</div>
              <div className="muted small">{subtitle}</div>
              <div className="muted small" style={{ marginTop: 2 }}>
                Tokens: {formatUsage(usage)}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="card-state">
              {isRegenerating ? <><span className="spinner" />Working</> : labelFor(state)}
            </span>
            {!isPending && <span className="card-collapse">▾</span>}
          </div>
        </div>

        {!collapsed && !isPending && (
          <>
            <div className="card-body">
              {isRegenerating && !artifact && (
                <div className="muted">
                  <span className="spinner" />Agent is generating this artifact…
                </div>
              )}
              {artifact && renderer && renderer(
                artifact,
                jiraResult,
                gate === 'effort_estimate' ? { onRecomputeEstimate: grade => onRecomputeEstimate(gate, grade) } : undefined
              )}
            </div>

            {(isProposed || isAccepted) && (
              <div className="card-actions">
                {isProposed && (
                  <>
                    <button className="btn btn-ghost" onClick={() => setShowEdit(true)} disabled={busy}>
                      Edit
                    </button>
                    <button className="btn btn-ghost" onClick={() => setShowReject(true)} disabled={busy}>
                      Reject
                    </button>
                  </>
                )}

                {isAccepted && gate !== 'jira_ticket' && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      if (confirm(`Reopen ${name}? This will clear all downstream gates and require regeneration.`)) {
                        onReopen(gate);
                      }
                    }}
                    disabled={busy}
                  >
                    Reopen
                  </button>
                )}

                <div className="spacer" />
                {isProposed && (
                  <button
                    className={gate === 'jira_ticket' ? 'btn btn-danger' : 'btn btn-primary'}
                    onClick={() => onAccept(gate)}
                    disabled={busy}
                  >
                    {gate === 'jira_ticket' ? 'Approve & Raise Jira ticket' : 'Accept'}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {showReject && (
        <RejectModal
          gate={gate}
          onConfirm={feedback => { setShowReject(false); onReject(gate, feedback); }}
          onCancel={() => setShowReject(false)}
        />
      )}

      {showEdit && (
        <EditModal
          gate={gate}
          artifact={artifact}
          onConfirm={edited => { setShowEdit(false); onEdit(gate, edited); }}
          onCancel={() => setShowEdit(false)}
        />
      )}
    </>
  );
}

function formatUsage(usage) {
  if (!usage || typeof usage !== 'object') return '—';
  const input = Number.isFinite(usage.input_tokens) ? usage.input_tokens : null;
  const output = Number.isFinite(usage.output_tokens) ? usage.output_tokens : null;
  const total = Number.isFinite(usage.total_tokens)
    ? usage.total_tokens
    : (Number.isFinite(input) && Number.isFinite(output) ? input + output : null);

  if (!Number.isFinite(total) && !Number.isFinite(input) && !Number.isFinite(output)) return '—';

  const totalPart = Number.isFinite(total) ? total.toLocaleString() : '—';
  const inputPart = Number.isFinite(input) ? input.toLocaleString() : '—';
  const outputPart = Number.isFinite(output) ? output.toLocaleString() : '—';
  return `${totalPart} (in: ${inputPart}, out: ${outputPart})`;
}

function labelFor(state) {
  switch (state) {
    case STATES.PENDING: return 'Pending';
    case STATES.PROPOSED: return 'Proposed';
    case STATES.ACCEPTED: return 'Accepted';
    case STATES.REJECTED: return 'Rejected';
    case STATES.REGENERATING: return 'Regenerating';
    case STATES.COMMITTED: return 'Committed';
    default: return state;
  }
}
