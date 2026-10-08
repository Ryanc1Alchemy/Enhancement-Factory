import { useState } from 'react';
import { GATES } from '../lib/gates.js';

// V1: edit as JSON. Power users will appreciate this. V2 can have field-by-field editors.
export default function EditModal({ gate, artifact, onConfirm, onCancel }) {
  const [text, setText] = useState(JSON.stringify(artifact, null, 2));
  const [parseError, setParseError] = useState(null);
  const gateMeta = GATES.find(g => g.id === gate);

  const handleSave = () => {
    try {
      const parsed = JSON.parse(text);
      setParseError(null);
      onConfirm(parsed);
    } catch (err) {
      setParseError(err.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" style={{ width: 'min(720px, 100%)' }}>
        <div className="modal-head">
          <h3>Edit artifact: {gateMeta?.name || gate}</h3>
          <p>Edit the JSON directly. Saving accepts this gate with your edited content.</p>
        </div>
        <div className="modal-body">
          <textarea
            className="modal-textarea mono"
            style={{ minHeight: 320, fontSize: 12 }}
            value={text}
            onChange={e => { setText(e.target.value); setParseError(null); }}
            spellCheck={false}
          />
          {parseError && (
            <div className="callout danger" style={{ marginTop: 10 }}>
              <strong>JSON error:</strong> {parseError}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save and accept</button>
        </div>
      </div>
    </div>
  );
}
