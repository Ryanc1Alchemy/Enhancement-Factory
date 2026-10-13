import { useRef, useState } from 'react';
import ParkModal from './ParkModal.jsx';
import { parseGuidewireBundle } from '../lib/guidewireArtifactBundle.js';
import { gateNeedingRun } from '../lib/runSnapshot.js';
import { GATES } from '../lib/gates.js';

// Save & resume controls shown above the gate cards: save indicator, park /
// review-received, resume notices, conflict and read-only messages.

const SAVE_TEXT = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  unavailable: '', // no database: show nothing — the app looks exactly as it did before save & resume
  conflict: 'Not saved — changed in another tab',
  too_large: 'Not saved — run too large to save',
  error: 'Not saved — will retry on the next change'
};

export function saveText(state) {
  const base = SAVE_TEXT[state.saveStatus] ?? '';
  if (state.saveStatus === 'saved' && state.lastSavedAt) {
    return `${base} ${new Date(state.lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return base;
}

export default function RunStatusBar({ state, actions }) {
  const [showPark, setShowPark] = useState(false);
  const [reattachError, setReattachError] = useState(null);
  const fileRef = useRef(null);
  const pendingGate = !state.readOnly ? gateNeedingRun(state.gateStates, state.artifacts) : null;
  const pendingName = GATES.find(g => g.id === pendingGate)?.name;
  // Parking needs a working save, so only offer it once a save has succeeded.
  const canPark = Number.isInteger(state.revision) && !state.readOnly && state.saveStatus !== 'conflict' && state.runStatus !== 'waiting_review' && state.runStatus !== 'completed';

  const onFiles = async e => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      setReattachError(null);
      actions.reattachFiles(await parseGuidewireBundle(files));
    } catch (err) {
      setReattachError(err.message);
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="run-status">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span className="muted small" data-testid="save-status">{saveText(state)}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {canPark && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowPark(true)} disabled={state.busy}>
              Park for review
            </button>
          )}
        </div>
      </div>

      {state.runStatus === 'waiting_review' && !state.readOnly && (
        <div className="callout warn" style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span>
            Waiting on review{state.waitingOn ? ` from ${state.waitingOn}` : ''}{state.waitingReason ? ` — ${state.waitingReason}` : ''}.
          </span>
          <button className="btn btn-ghost btn-sm" onClick={actions.unparkRun}>Review received</button>
        </div>
      )}

      {state.saveStatus === 'conflict' && (
        <div className="callout danger" style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span>This run was saved from another tab or browser since you opened it. Changes here are no longer being saved.</span>
          <button className="btn btn-ghost btn-sm" onClick={() => actions.resumeRun(state.runId)}>Reload this run</button>
        </div>
      )}

      {state.saveStatus === 'too_large' && (
        <div className="callout warn" style={{ marginTop: 8 }}>
          This run is too large to save (usually very long attached notes). You can keep working; it just won't be saved.
        </div>
      )}

      {state.readOnly && (
        <div className="callout" style={{ marginTop: 8 }}>This run is read-only.</div>
      )}

      {state.resumeNotes.length > 0 && (
        <div className="callout" style={{ marginTop: 8 }}>
          <ul className="artifact-list" style={{ margin: 0 }}>
            {state.resumeNotes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {!state.readOnly && state.resumeNotes.some(n => n.startsWith('Project files are not re-attached')) && (
              <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                Re-attach project files
                <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={onFiles} />
              </label>
            )}
            <button className="btn btn-ghost btn-sm" onClick={actions.dismissResumeNotes}>Dismiss</button>
          </div>
          {reattachError && <div className="small" style={{ marginTop: 4 }}>Could not read files: {reattachError}</div>}
        </div>
      )}

      {pendingGate && (
        <div className="callout warn" style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span>{pendingName} had not finished when this run was saved.</span>
          <button className="btn btn-primary btn-sm" onClick={() => actions.runPendingGate(pendingGate)} disabled={state.busy}>
            Run this gate
          </button>
        </div>
      )}

      {showPark && (
        <ParkModal
          onCancel={() => setShowPark(false)}
          onConfirm={details => { actions.parkRun(details); setShowPark(false); }}
        />
      )}
    </div>
  );
}
