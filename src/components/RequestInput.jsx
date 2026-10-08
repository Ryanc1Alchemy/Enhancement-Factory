import { useState, useRef } from 'react';
import { SCENARIOS } from '../lib/scenarios.js';
import { parseGuidewireBundle, describeBundle } from '../lib/guidewireArtifactBundle.js';

const ACCEPTED_EXTENSIONS = '.html,.htm,.json,.xml,.csv,.md,.markdown,.txt,.pcf,.gs,.gsx,.docx,.pdf,.xlsx,.xls,.vtt,.srt';

export default function RequestInput({ onSubmit, disabled, started }) {
  const [text, setText] = useState('');
  const [bundle, setBundle] = useState(null); // parsed multi-area Guidewire bundle
  const [bundleError, setBundleError] = useState(null);
  const [parsing, setParsing] = useState(false);
  const fileInputRef = useRef(null);
  // Tracks raw File objects across multiple picks so we can re-parse the combined
  // set whenever files are added/removed (parsing is cheap and keeps merge logic simple).
  const pendingRawFilesRef = useRef([]);

  const submit = () => {
    if (!text.trim() || disabled) return;
    onSubmit(text.trim(), bundle);
  };

  const handleFilePick = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setParsing(true);
    setBundleError(null);
    try {
      const allFiles = [...pendingRawFilesRef.current, ...files];
      pendingRawFilesRef.current = allFiles;
      const parsed = await parseGuidewireBundle(allFiles);
      setBundle(parsed);
    } catch (err) {
      setBundleError(err.message || 'Failed to parse file(s).');
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const clearBundle = () => {
    setBundle(null);
    setBundleError(null);
    pendingRawFilesRef.current = [];
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeOneFile = (fileName) => {
    pendingRawFilesRef.current = pendingRawFilesRef.current.filter(f => f.name !== fileName);
    if (pendingRawFilesRef.current.length === 0) {
      clearBundle();
      return;
    }
    setParsing(true);
    parseGuidewireBundle(pendingRawFilesRef.current)
      .then(parsed => setBundle(parsed))
      .catch(err => setBundleError(err.message))
      .finally(() => setParsing(false));
  };

  const attachedFileNames = pendingRawFilesRef.current.map(f => f.name);
  const bundleDescriptionLines = bundle ? describeBundle(bundle) : [];

  if (started) {
    return (
      <div className="request-entry">
        <h3>Active request</h3>
        <p style={{ marginBottom: 0, color: 'var(--text)', fontStyle: 'italic' }}>
          "{text || 'See top of stack for the request being processed.'}"
        </p>
        {bundle && bundleDescriptionLines.length > 0 && (
          <p className="muted small" style={{ marginTop: 6 }}>
            Guidewire artifacts attached: {bundleDescriptionLines.join(' · ')}
          </p>
        )}
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

      <div className="data-dict-upload" style={{ marginTop: 10 }}>
        <label className="btn btn-ghost btn-sm" style={{ cursor: disabled || parsing ? 'not-allowed' : 'pointer' }}>
          {parsing ? 'Parsing…' : attachedFileNames.length > 0 ? '+ Attach another file' : '+ Attach files (data dictionary, PCF, rules, product model, rating, or BA notes/Word/PDF/Excel/Teams transcript)'}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            multiple
            onChange={handleFilePick}
            disabled={disabled || parsing}
            style={{ display: 'none' }}
          />
        </label>

        {attachedFileNames.length > 0 && (
          <div className="callout success" style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <strong>
                {attachedFileNames.length} file{attachedFileNames.length > 1 ? 's' : ''} attached
                {bundleDescriptionLines.length > 0 && ` — ${bundleDescriptionLines.join(' · ')}`}
              </strong>
              <button className="btn btn-ghost btn-sm" onClick={clearBundle} disabled={disabled}>Remove all</button>
            </div>
            <ul className="artifact-list" style={{ marginTop: 6 }}>
              {attachedFileNames.map(fn => (
                <li key={fn} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{fn}</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => removeOneFile(fn)}
                    disabled={disabled}
                    style={{ padding: '2px 8px' }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            {bundle && bundle.unknownFiles && bundle.unknownFiles.length > 0 && (
              <div className="muted small" style={{ marginTop: 4 }}>
                Unrecognized (not used for grounding): {bundle.unknownFiles.join(', ')}
              </div>
            )}
          </div>
        )}

        {bundleError && <div className="callout danger" style={{ marginTop: 6 }}>{bundleError}</div>}
        <p className="muted small" style={{ marginTop: 4 }}>
          Optional. Attach files from any Guidewire Studio area — data dictionary (entityModel.xml, typelists.html), PCFs (.pcf), Gosu rules (.gs), product model (coverage/exclusion/condition/modifier XML), or rating (rate tables/routines) — or BA notes captured from meetings and stakeholder discussions, in any of: plain text/markdown (.txt/.md), Word (.docx), PDF (.pdf), Excel (.xlsx/.xls), or a Teams/Zoom meeting transcript (.vtt/.srt). Files are auto-detected and routed to the right gate for grounding; you can attach structured artifacts, notes, both, or neither.
        </p>
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
