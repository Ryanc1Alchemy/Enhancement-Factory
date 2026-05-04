import { useState } from 'react';
import { SCENARIOS } from '../lib/scenarios.js';

export default function RequestInput({ onSubmit, disabled, started }) {
  const [text, setText] = useState('');

  const submit = () => {
    if (!text.trim() || disabled) return;
    onSubmit(text.trim());
  };

  if (started) {
    return (
      <div className="request-entry">
        <h3>Active request</h3>
        <p style={{ marginBottom: 0, color: 'var(--text)', fontStyle: 'italic' }}>
          "{text || 'See top of stack for the request being processed.'}"
        </p>
      </div>
    );
  }

  return (
    <div className="request-entry">
      <h3>Enter an enhancement request</h3>
      <p>One line. The agent will decompose it across six gates. You approve every step.</p>
      <div className="request-input-row">
        <input
          className="request-input"
          type="text"
          placeholder="e.g. Add a discount for hybrid vehicles in Personal Auto"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          disabled={disabled}
        />
        <button className="btn btn-primary" onClick={submit} disabled={disabled || !text.trim()}>
          Run agent
        </button>
      </div>

      <div className="scenarios">
        {SCENARIOS.map(s => (
          <button
            key={s.id}
            className="scenario-chip"
            onClick={() => setText(s.text)}
            disabled={disabled}
            title={s.notes}
          >
            <span className="lob">{s.lob}</span>
            <span className="text">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
