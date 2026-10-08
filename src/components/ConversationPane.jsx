import { useEffect, useRef } from 'react';

export default function ConversationPane({ conversation, busy, error }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation, busy]);

  return (
    <div className="pane">
      <div className="pane-header">
        <h2>Conversation</h2>
        <p>Agent reasoning trace and approval log.</p>
      </div>

      <div className="conv-list">
        {conversation.length === 0 ? (
          <div className="conv-empty">
            Enter a request on the right to begin.
          </div>
        ) : (
          conversation.map((m, i) => (
            <div key={i} className={`conv-item ${m.who}`}>
              <div className="who">{whoLabel(m.who)}</div>
              <div className="body">{m.body}</div>
            </div>
          ))
        )}

        {busy && (
          <div className="conv-item system">
            <div className="who">Agent</div>
            <div className="body"><span className="spinner" />Working…</div>
          </div>
        )}

        {error && (
          <div className="conv-item system">
            <div className="who" style={{ color: 'var(--ntt-red)' }}>Error</div>
            <div className="body" style={{ color: 'var(--ntt-red)' }}>{error}</div>
          </div>
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
}

function whoLabel(who) {
  if (who === 'user') return 'You';
  if (who === 'agent') return 'Agent';
  return 'System';
}
