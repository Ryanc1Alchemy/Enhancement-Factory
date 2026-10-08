import RequestInput from './RequestInput.jsx';
import ArtifactCard from './ArtifactCard.jsx';
import { GATES } from '../lib/gates.js';

export default function ArtifactStack({ state, actions }) {
  const started = !!state.runId;

  return (
    <div className="pane">
      <div className="pane-header">
        <h2>Artifact stack</h2>
        <p>Six gates. One artifact per gate. Diff-view approval at every step.</p>
      </div>

      <div className="stack">
        <RequestInput
          onSubmit={actions.startRun}
          disabled={state.busy || started}
          started={started}
        />

        {started && (
          <div className="cards">
            {GATES.map((g, idx) => (
              <ArtifactCard
                key={g.id}
                gate={g.id}
                gateNumber={idx + 1}
                name={g.name}
                subtitle={g.subtitle}
                state={state.gateStates[g.id]}
                artifact={state.artifacts[g.id]}
                jiraResult={g.id === 'jira_ticket' ? state.jiraResult : null}
                busy={state.busy}
                onAccept={actions.acceptGate}
                onReject={actions.rejectGate}
                onEdit={actions.editAndAcceptGate}
                onRecomputeEstimate={g.id === 'effort_estimate' ? actions.recomputeEstimate : undefined}
              />
            ))}

            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <button className="btn btn-ghost btn-sm" onClick={actions.reset}>
                Start over
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
