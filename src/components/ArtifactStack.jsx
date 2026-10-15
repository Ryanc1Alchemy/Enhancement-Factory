import RequestInput from './RequestInput.jsx';
import ArtifactCard from './ArtifactCard.jsx';
import SavedRuns from './SavedRuns.jsx';
import RunStatusBar from './RunStatusBar.jsx';
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
        {!started && (
          <RequestInput
            onSubmit={actions.startRun}
            disabled={state.busy || started}
            started={started}
          />
        )}

        {!started && <SavedRuns onOpen={actions.resumeRun} disabled={state.busy} />}

        {started && (
          <div className="request-entry">
            <h3 style={{ marginBottom: 6 }}>{state.request}</h3>
            <RunStatusBar state={state} actions={actions} />
          </div>
        )}

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
                busy={state.busy || state.readOnly || state.saveStatus === 'conflict'}
                onAccept={actions.acceptGate}
                onReject={actions.rejectGate}
                onEdit={actions.editAndAcceptGate}
                onReopen={actions.reopenGate}
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
