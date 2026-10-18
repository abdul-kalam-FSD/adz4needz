import { useEffect, useRef, useState } from 'react';
import { api, ApiError, leadSheetDownloadUrl, uploadLeadSheet } from '../api/client.js';

const FIELD = { status: 'Status', followUpDate: 'Follow-up date', nextAction: 'Next action' };
const STATE_TEXT = { change: 'Will change', error: 'Problem', conflict: 'Changed since download', unknown_lead: 'Unknown lead' };
const msg = (err) => (err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');

// Download the lead sheet, edit Status / Follow-up date / Next action in Excel, upload it, review EVERY change, then confirm.
// Preview writes nothing. Confirm re-reads the same file and the server skips any lead that changed since the sheet was downloaded.
export default function LeadSheetPanel({ onApplied }) {
  const [open, setOpen] = useState(false);
  const [bdes, setBdes] = useState([]);
  const [bdeId, setBdeId] = useState('');
  const [file, setFile] = useState(null);
  const [step, setStep] = useState({ kind: 'idle' }); // idle | previewing | preview | applying | done
  const [error, setError] = useState('');
  const input = useRef(null);

  useEffect(() => { if (open && bdes.length === 0) api.adminListBdes().then((d) => setBdes(d.bdes)).catch(() => {}); }, [open, bdes.length]);

  async function preview(f) {
    setFile(f); setError(''); setStep({ kind: 'previewing' });
    try { setStep({ kind: 'preview', data: await uploadLeadSheet(f, 'preview') }); }
    catch (err) { setError(msg(err)); setStep({ kind: 'idle' }); }
  }
  async function apply() {
    if (!file || step.kind !== 'preview') return;
    setError(''); setStep({ kind: 'applying', data: step.data });
    try { const r = await uploadLeadSheet(file, 'apply'); setStep({ kind: 'done', data: r }); if (onApplied) onApplied(); }
    catch (err) { setError(msg(err)); setStep({ kind: 'preview', data: step.data }); }
  }
  function reset() { setFile(null); setStep({ kind: 'idle' }); setError(''); if (input.current) input.current.value = ''; }

  if (!open) return <p><button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>Download / update with Excel</button></p>;
  const p = step.kind === 'preview' || step.kind === 'applying' ? step.data : null;
  return (
    <section aria-label="Lead sheet" className="panel">
      <h2 className="section-title">Update leads with Excel</h2>
      <ol>
        <li>
          Download the sheet{' '}
          <select aria-label="BDE for the sheet" value={bdeId} onChange={(e) => setBdeId(e.target.value)}><option value="">All BDEs</option>{bdes.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.employeeId})</option>)}</select>{' '}
          <a className="btn btn-secondary" href={leadSheetDownloadUrl(bdeId)}>Download Excel</a>
        </li>
        <li>Edit only the green columns: <strong>Status</strong>, <strong>Follow-up date</strong>, <strong>Next action</strong>. A blank cell keeps the current value.</li>
        <li>Upload it. You review every change before anything is saved.
          <div><input ref={input} type="file" accept=".xlsx,.csv" aria-label="Edited lead sheet" disabled={step.kind === 'previewing' || step.kind === 'applying'} onChange={(e) => e.target.files[0] && preview(e.target.files[0])} /></div>
        </li>
      </ol>
      {error && <div className="alert alert-error" role="alert"><p>{error}</p></div>}
      {step.kind === 'previewing' && <p role="status">Checking the file…</p>}
      {p && (
        <>
          <p><strong>{p.summary.willChange}</strong> will change, {p.summary.unchanged} unchanged, {p.summary.errors} with problems, {p.summary.conflicts} changed since download, {p.summary.unknownLeads} unknown.</p>
          {p.rows.length > 0 && (
            <div className="table-wrap"><table>
              <thead><tr><th>Row</th><th>Candidate</th><th>Result</th><th>Details</th></tr></thead>
              <tbody>{p.rows.map((r) => (
                <tr key={r.rowNumber}><td>{r.rowNumber}</td><td>{r.candidate || '—'}</td><td>{STATE_TEXT[r.state] || r.state}</td>
                  <td>{r.state === 'change'
                    ? Object.entries(r.changes).map(([k, v]) => <div key={k}>{FIELD[k]}: {v.from === null || v.from === '' ? '(empty)' : String(v.from)} → <strong>{String(v.to)}</strong></div>)
                    : Object.values(r.errors).join(' ')}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {p.rowsTruncated && <p className="hint">Only the first rows are listed; every row is still processed.</p>}
          <button type="button" className="btn btn-primary" disabled={step.kind === 'applying' || p.summary.willChange === 0} onClick={apply}>{step.kind === 'applying' ? 'Saving…' : `Save ${p.summary.willChange} change${p.summary.willChange === 1 ? '' : 's'}`}</button>{' '}
          <button type="button" className="btn btn-secondary" disabled={step.kind === 'applying'} onClick={reset}>Cancel</button>
        </>
      )}
      {step.kind === 'done' && (
        <div className="alert alert-success" role="status">
          <p className="alert-title">{step.data.applied} lead{step.data.applied === 1 ? '' : 's'} updated</p>
          {step.data.skipped + step.data.conflictsAtWrite > 0 && <p>{step.data.skipped + step.data.conflictsAtWrite} row(s) were skipped (problems or changed since download). Download a fresh sheet to try those again.</p>}
          <button type="button" className="btn btn-secondary" onClick={reset}>Done</button>
        </div>
      )}
      <p><button type="button" className="btn btn-secondary" onClick={() => { reset(); setOpen(false); }}>Close</button></p>
    </section>
  );
}
