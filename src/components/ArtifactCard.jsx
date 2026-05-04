import { useState } from 'react';
import { STATES } from '../lib/gates.js';
import { GATE_RENDERERS } from './artifactRenderers.jsx';
import RejectModal from './RejectModal.jsx';
import EditModal from './EditModal.jsx';

export default function ArtifactCard({
  gate,
  name,
  subtitle,
  state,
  artifact,
  jiraResult,
  busy,
  onAccept,
  onReject,
  onEdit
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
            <div className="card-num">{gate}</div>
            <div>
              <div className="card-title">Gate {gate} — {name}</div>
              <div className="muted small">{subtitle}</div>
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
              {artifact && renderer && renderer(artifact, jiraResult)}
            </div>

            {isProposed && (
              <div className="card-actions">
                <button className="btn btn-ghost" onClick={() => setShowEdit(true)} disabled={busy}>
                  Edit
                </button>
                <button className="btn btn-ghost" onClick={() => setShowReject(true)} disabled={busy}>
                  Reject
                </button>
                <div className="spacer" />
                <button
                  className={gate === 6 ? 'btn btn-danger' : 'btn btn-primary'}
                  onClick={() => onAccept(gate)}
                  disabled={busy}
                >
                  {gate === 6 ? 'Approve & Raise Jira ticket' : 'Accept'}
                </button>
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
