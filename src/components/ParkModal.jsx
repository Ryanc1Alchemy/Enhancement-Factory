import { useState } from 'react';

// "Park for review": record who the run is waiting on and why. The run is
// saved with status waiting_review and shows in Saved runs with a badge.
export default function ParkModal({ onConfirm, onCancel }) {
  const [waitingOn, setWaitingOn] = useState('');
  const [reason, setReason] = useState('');

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal">
        <div className="modal-head">
          <h3>Park for review</h3>
          <p>The run is saved as it is now. Reopen it from Saved runs when the review is back — you'll continue exactly where you left off.</p>
        </div>
        <div className="modal-body">
          <label className="small muted" htmlFor="park-waiting-on" style={{ display: 'block', marginBottom: 4 }}>Waiting on</label>
          <input
            id="park-waiting-on"
            className="request-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            placeholder="e.g. Lead architect, Rate Management team"
            value={waitingOn}
            onChange={e => setWaitingOn(e.target.value)}
            autoFocus
          />
          <label className="small muted" htmlFor="park-reason" style={{ display: 'block', marginTop: 12, marginBottom: 4 }}>Why</label>
          <textarea
            id="park-reason"
            className="modal-textarea"
            placeholder="e.g. Sign-off on the design note before sizing"
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onConfirm({ waitingOn, reason })} disabled={!waitingOn.trim()}>
            Park run
          </button>
        </div>
      </div>
    </div>
  );
}
