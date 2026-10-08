import { useState } from 'react';
import { GATES } from '../lib/gates.js';

export default function RejectModal({ gate, onConfirm, onCancel }) {
  const [feedback, setFeedback] = useState('');
  const gateMeta = GATES.find(g => g.id === gate);

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal">
        <div className="modal-head">
          <h3>Reject and regenerate: {gateMeta?.name || gate}</h3>
          <p>Tell the agent what's wrong. Your feedback is treated as authoritative — it won't argue, it'll regenerate.</p>
        </div>
        <div className="modal-body">
          <textarea
            className="modal-textarea"
            placeholder="e.g. The LoB classification is wrong — this is Commercial Auto, not Personal. Also the rating impact assumption is too aggressive — assume a non-rated discount applied at quote only."
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            autoFocus
          />
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-danger"
            onClick={() => onConfirm(feedback.trim())}
            disabled={!feedback.trim()}
          >
            Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
