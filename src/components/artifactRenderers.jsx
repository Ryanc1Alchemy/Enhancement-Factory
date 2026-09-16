// One renderer per gate. These are pure presentational functions.
// They receive the artifact object (the agent's tool_use input) and return JSX.

export function renderGate1(a) {
  if (!a) return null;
  const confidenceClass =
    a.confidence === 'high' ? 'success' : a.confidence === 'low' ? 'danger' : 'warn';

  return (
    <div className="artifact-grid">
      <div className="artifact-section">
        <span className="artifact-label">Classified Line of Business</span>
        <div>
          <span className="artifact-pill">{a.classified_lob}</span>
          {a.sub_lob && <span className="artifact-pill">{a.sub_lob}</span>}
          <span className={`artifact-pill ${confidenceClass}`}>Confidence: {a.confidence}</span>
        </div>
      </div>

      <div className="artifact-section">
        <span className="artifact-label">Affected Guidewire entities</span>
        <div>
          {(a.affected_entities || []).map((e, i) => <span key={i} className="artifact-pill">{e}</span>)}
        </div>
      </div>

      <div className="artifact-section">
        <span className="artifact-label">Interpretation</span>
        <div className="artifact-value">{a.interpretation}</div>
      </div>

      <div className="artifact-section">
        <span className="artifact-label">Assumptions ({(a.assumptions || []).length})</span>
        <ul className="artifact-list">
          {(a.assumptions || []).map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      </div>

      <div className="artifact-section">
        <span className="artifact-label">Ambiguities — for human resolution ({(a.ambiguities || []).length})</span>
        {(a.ambiguities || []).length === 0 ? (
          <div className="callout success">No ambiguities flagged. The agent believes the request is fully specified.</div>
        ) : (
          <div className="callout warn">
            <ul className="artifact-list" style={{ marginTop: 4 }}>
              {a.ambiguities.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function renderGate2(a) {
  if (!a) return null;
  return (
    <div className="artifact-grid">
      <div className="artifact-section">
        <span className="artifact-label">In scope</span>
        <ul className="artifact-list">
          {(a.in_scope || []).map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      </div>

      <div className="artifact-section">
        <span className="artifact-label">Out of scope (deliberate exclusions)</span>
        <ul className="artifact-list">
          {(a.out_of_scope || []).map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      </div>

      <div className="artifact-section">
        <span className="artifact-label">Dependencies</span>
        {(a.dependencies || []).length > 0 ? (
          <ul className="artifact-list">
            {a.dependencies.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        ) : <div className="muted small">None.</div>}
      </div>

      <div className="artifact-section">
        <span className="artifact-label">Integration touchpoints</span>
        {(a.integration_touchpoints || []).length > 0 ? (
          <div>{a.integration_touchpoints.map((x, i) => <span key={i} className="artifact-pill">{x}</span>)}</div>
        ) : <div className="muted small">None.</div>}
      </div>

      {(a.risk_flags || []).length > 0 && (
        <div className="artifact-section">
          <span className="artifact-label">Risk flags</span>
          <div className="callout warn">
            <ul className="artifact-list" style={{ marginTop: 4 }}>
              {a.risk_flags.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export function renderGate3(a) {
  if (!a) return null;
  return (
    <div className="artifact-grid">
      <div className="artifact-section">
        <span className="artifact-label">Approach</span>
        <div className="artifact-value">{a.approach_summary}</div>
      </div>

      {a.rating_impact?.has_rating_impact && (
        <div className="callout danger">
          <strong>Rating impact:</strong> {a.rating_impact.description}
        </div>
      )}

      {(a.entity_drift_warnings || []).length > 0 && (
        <div className="callout warn">
          <strong>Entity drift vs. Request Analysis:</strong>
          <ul className="artifact-list" style={{ marginTop: 4 }}>
            {a.entity_drift_warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {(a.required_skills || []).length > 0 && (
        <div className="artifact-section">
          <span className="artifact-label">Required skills (org skills matrix)</span>
          <div>
            {a.required_skills.map((s, i) => <span key={i} className="artifact-pill">{s}</span>)}
          </div>
        </div>
      )}

      {(a.entity_changes || []).length > 0 && (
        <ChangeTable label="Entity changes" rows={a.entity_changes} cols={['entity', 'change_type', 'description']} />
      )}
      {(a.typelist_changes || []).length > 0 && (
        <ChangeTable
          label="Typelist changes"
          rows={a.typelist_changes.map(t => ({
            ...t,
            new_codes_str: (t.new_codes || []).join(', ') || '—'
          }))}
          cols={['typelist', 'change_type', 'new_codes_str', 'description']}
          headers={['Typelist', 'Type', 'New codes', 'Description']}
        />
      )}
      {(a.pcf_changes || []).length > 0 && (
        <ChangeTable label="PCF changes" rows={a.pcf_changes} cols={['pcf', 'description']} headers={['PCF', 'Description']} />
      )}
      {(a.gosu_rule_changes || []).length > 0 && (
        <ChangeTable
          label="Gosu rule changes"
          rows={a.gosu_rule_changes}
          cols={['rule_category', 'rule_name', 'change_type', 'description']}
          headers={['Category', 'Rule name', 'Type', 'Description']}
        />
      )}
      {(a.integration_changes || []).length > 0 && (
        <ChangeTable
          label="Integration changes"
          rows={a.integration_changes}
          cols={['integration', 'change_type', 'description']}
          headers={['Integration', 'Type', 'Description']}
        />
      )}
    </div>
  );
}

function ChangeTable({ label, rows, cols, headers }) {
  const headerLabels = headers || cols.map(c => c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
  return (
    <div className="artifact-section">
      <span className="artifact-label">{label} ({rows.length})</span>
      <table className="artifact-table">
        <thead>
          <tr>{headerLabels.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c, j) => <td key={j}>{r[c] || '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DELIVERY_GRADES = ['Bronze1', 'Bronze2', 'Silver1', 'Silver2', 'Gold1', 'Gold2'];

export function renderGate4(a, _jiraResult, gate4Extras) {
  if (!a) return null;
  const ce = a.computed_estimate;
  const onRecomputeEstimate = gate4Extras?.onRecomputeEstimate;
  const currentGrade = ce?.assumed_delivery_grade || 'Silver2';

  return (
    <div className="artifact-grid">
      <div className="artifact-section">
        <span className="artifact-label">Justification</span>
        <div className="artifact-value">{a.narrative}</div>
      </div>

      {onRecomputeEstimate && (
        <div className="artifact-section">
          <span className="artifact-label">Assumed delivery grade</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              className="request-input"
              style={{ maxWidth: 160, padding: '6px 10px' }}
              value={currentGrade}
              onChange={e => onRecomputeEstimate(e.target.value)}
            >
              {DELIVERY_GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <span className="muted small">
              Changes Dev/QA/Architect hours only — recalculated instantly, no agent call.
            </span>
          </div>
          {currentGrade !== 'Silver2' && (
            <div className="callout warn" style={{ marginTop: 6 }}>
              This adjustment is seeded from the COCOMO II personnel-capability model, not calibrated
              against internal delivery data — treat it as a starting shape, not a fact.
            </div>
          )}
        </div>
      )}

      {a.estimator_error ? (
        <div className="callout danger">Estimator error: {a.estimator_error}</div>
      ) : ce ? (
        <>
          <div className="artifact-section">
            <span className="artifact-label">Effort summary</span>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <div><strong style={{ fontSize: 24 }}>{ce.total_hours}h</strong> <span className="muted small">total</span></div>
              <div><strong style={{ fontSize: 18 }}>{ce.story_points}</strong> <span className="muted small">story points</span></div>
              <div><span className="artifact-pill warn">{ce.confidence_band}</span></div>
            </div>
          </div>

          <div className="artifact-section">
            <span className="artifact-label">Hours by role</span>
            <table className="artifact-table">
              <thead><tr><th>Role</th><th>Hours</th></tr></thead>
              <tbody>
                {Object.entries(ce.hours_by_role).map(([role, h]) => (
                  <tr key={role}><td>{role}</td><td>{h}h</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="artifact-section">
            <span className="artifact-label">Hours by location</span>
            <table className="artifact-table">
              <thead><tr><th>Location</th><th>Hours</th></tr></thead>
              <tbody>
                {Object.entries(ce.hours_by_location).map(([loc, h]) => (
                  <tr key={loc}><td>{loc.replace('_', ' ')}</td><td>{h}h</td></tr>
                ))}
              </tbody>
            </table>
            <div className="muted small" style={{ marginTop: 6 }}>{ce.location_split_assumption}</div>
          </div>

          <div className="muted small">Methodology: {ce.methodology}</div>
        </>
      ) : (
        <div className="muted">Estimate computing…</div>
      )}
    </div>
  );
}

export function renderGate5(a) {
  if (!a) return null;
  return (
    <div className="artifact-grid">
      {(a.scenarios || []).map((sc, i) => (
        <div key={i} className="artifact-section">
          <span className="artifact-label">
            <span className={`artifact-pill ${sc.type === 'happy_path' ? 'success' : sc.type === 'negative' ? 'danger' : 'warn'}`}>
              {(sc.type || '').replace('_', ' ')}
            </span>
            {sc.title}
          </span>
          <div className="gherkin">
            {(sc.given || []).map((g, j) => `${j === 0 ? 'Given' : '  And'} ${g}`).join('\n')}
            {'\n'}
            {(sc.when || []).map((w, j) => `${j === 0 ? 'When' : '  And'} ${w}`).join('\n')}
            {'\n'}
            {(sc.then || []).map((t, j) => `${j === 0 ? 'Then' : '  And'} ${t}`).join('\n')}
          </div>
        </div>
      ))}

      {(a.non_functional || []).length > 0 && (
        <div className="artifact-section">
          <span className="artifact-label">Non-functional considerations</span>
          <ul className="artifact-list">
            {a.non_functional.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function renderGate6(a, jiraResult) {
  if (!a) return null;
  return (
    <div className="artifact-grid">
      <div className="artifact-section">
        <span className="artifact-label">Summary</span>
        <div className="artifact-value" style={{ fontWeight: 600, fontSize: 14 }}>{a.summary}</div>
      </div>

      <div className="artifact-section">
        <span className="artifact-label">Issue type & points</span>
        <div>
          <span className="artifact-pill">{a.issue_type || 'Story'}</span>
          <span className="artifact-pill warn">{a.story_points} story points</span>
        </div>
      </div>

      <div className="artifact-section">
        <span className="artifact-label">Components</span>
        <div>
          {(a.components || []).map((c, i) => <span key={i} className="artifact-pill">{c}</span>)}
        </div>
      </div>

      <div className="artifact-section">
        <span className="artifact-label">Labels</span>
        <div>
          {(a.labels || []).map((l, i) => <span key={i} className="artifact-pill">{l}</span>)}
        </div>
      </div>

      <div className="artifact-section">
        <span className="artifact-label">Description</span>
        <div className="gherkin" style={{ borderLeftColor: 'var(--ntt-blue)' }}>{a.description}</div>
      </div>

      <div className="artifact-section">
        <span className="artifact-label">Acceptance criteria (Jira block)</span>
        <div className="gherkin">{a.acceptance_criteria_text}</div>
      </div>

      {jiraResult && jiraResult.commit_result && (
        <JiraResultBlock result={jiraResult.commit_result} />
      )}
    </div>
  );
}

function JiraResultBlock({ result }) {
  if (result.mode === 'live') {
    return (
      <div className="ticket-result">
        <div className="muted small">Real Jira ticket created</div>
        <div className="key">{result.ticket.key}</div>
        <div style={{ marginTop: 8 }}>
          <a href={result.ticket.url} target="_blank" rel="noopener noreferrer">Open in Jira →</a>
        </div>
      </div>
    );
  }
  if (result.mode === 'simulated') {
    return (
      <div className="ticket-result simulated">
        <div className="muted small">Simulated (Jira env vars not set)</div>
        <div className="key">{result.simulated_ticket.key}</div>
        <div className="small" style={{ marginTop: 6 }}>{result.reason}</div>
      </div>
    );
  }
  return (
    <div className="ticket-result error">
      <div className="muted small">Jira call failed</div>
      <div className="key">Error</div>
      <div className="small" style={{ marginTop: 6 }}>{result.error}{result.detail ? ` — ${String(result.detail).slice(0, 200)}` : ''}</div>
    </div>
  );
}

export const GATE_RENDERERS = {
  request_analysis: renderGate1,
  scope_definition: renderGate2,
  design_note: renderGate3,
  acceptance_criteria: renderGate5,
  effort_estimate: renderGate4,
  jira_ticket: renderGate6
};
