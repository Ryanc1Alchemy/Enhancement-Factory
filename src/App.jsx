import { useAgentRun } from './hooks/useAgentRun.js';
import ConversationPane from './components/ConversationPane.jsx';
import ArtifactStack from './components/ArtifactStack.jsx';

export default function App() {
  const { state, actions } = useAgentRun();

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="topbar-mark">N</div>
          <div className="topbar-title">
            <strong>Enhancement Factory v2</strong>
            <span>· NTT DATA Guidewire Practice</span>
          </div>
        </div>
        <div className="topbar-meta">
          <span className="topbar-pill">Agentic · Presales</span>
          {state.runId && <span>Run <b>{state.runId.slice(0, 8)}</b></span>}
        </div>
      </header>

      <main className="panes">
        <ConversationPane
          conversation={state.conversation}
          busy={state.busy}
          error={state.error}
        />
        <ArtifactStack state={state} actions={actions} />
      </main>
    </div>
  );
}
