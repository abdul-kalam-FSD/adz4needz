import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { todayValue } from '../lib/format.js';
import { shiftDay } from '../lib/report-period.js';

const KINDS = [['', 'All activity'], ['call', 'Calls'], ['lead_added', 'Leads added'], ['interview_scheduled', 'Interviews scheduled'], ['payment_committed', 'Payment commitments'],
  ['instalment_recorded', 'Instalments'], ['receipt_uploaded', 'Receipts uploaded'], ['receipt_reviewed', 'Receipt reviews'], ['import_committed', 'Imports'], ['account_created', 'New accounts'], ['daily_report', 'Daily reports']];
const errorText = (err) => {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  const f = Object.values(err.fields || {}).filter(Boolean);
  return f.length ? `${err.message} ${f.join(' ')}` : err.message;
};
// Stored times are UTC ("2026-10-16 10:05:00"); show them in the viewer's own time zone.
const when = (at) => { const d = new Date(String(at).replace(' ', 'T') + 'Z'); return Number.isNaN(d.getTime()) ? String(at) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };

export default function AdminActivityPage() {
  const today = todayValue();
  const [f, setF] = useState({ from: shiftDay(today, -6), to: today, kind: '', actorId: '' });
  const [people, setPeople] = useState([]);
  const [state, setState] = useState({ loading: true, error: '', data: null });

  useEffect(() => { api.adminListBdes().then((d) => setPeople(d.bdes)).catch(() => setPeople([])); }, []);
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    const qs = new URLSearchParams({ from: f.from, to: f.to });
    if (f.kind) qs.set('kind', f.kind);
    if (f.actorId) qs.set('actorId', f.actorId);
    try { setState({ loading: false, error: '', data: await api.adminActivity(qs.toString()) }); }
    catch (err) { setState({ loading: false, error: errorText(err), data: null }); }
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const d = state.data;
  return (
    <>
      <h1>Activity</h1>
      <p className="hint">What the team did, newest first. Choose up to 31 days.</p>
      <div className="toolbar">
        <div className="field"><label htmlFor="ac-from">From</label><input id="ac-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
        <div className="field"><label htmlFor="ac-to">To</label><input id="ac-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        <div className="field"><label htmlFor="ac-who">Person</label>
          <select id="ac-who" value={f.actorId} onChange={(e) => setF({ ...f, actorId: e.target.value })}><option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.employeeId})</option>)}</select></div>
        <div className="field"><label htmlFor="ac-kind">Type</label>
          <select id="ac-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </div>
      {state.loading && <p role="status">Loading…</p>}
      {state.error && <div className="alert alert-error" role="alert"><p>{state.error}</p><button type="button" className="btn btn-secondary" onClick={load}>Try again</button></div>}
      {d && !state.loading && (d.events.length === 0 ? <p className="state-message">No activity in this period.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
          <tbody>{d.events.map((e, i) => <tr key={i}><td>{when(e.at)}</td><td>{e.actor.name}</td><td>{e.title}</td><td>{e.detail}</td></tr>)}</tbody>
        </table></div>
      ))}
      {d && d.truncated && <p className="hint">Only the newest {d.limit} events are shown. Narrow the dates or choose a person or type.</p>}
      {d && <p className="hint">{d.basis}</p>}
    </>
  );
}
