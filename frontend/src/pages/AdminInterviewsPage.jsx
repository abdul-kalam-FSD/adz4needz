import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import InterviewsListView from '../components/InterviewsListView.jsx';

const COLUMNS = [
  ['scheduled', 'Scheduled'], ['attended', 'Attended'], ['didNotAttend', 'Did not attend'], ['attendancePending', 'Attendance pending'],
  ['selected', 'Selected'], ['notSelected', 'Not selected'], ['interestedInJoining', 'Interested in joining'], ['paymentConfirmed', 'Payment confirmed']
];

// Per-BDE comparison for an optional range of interview dates, then the full read-only list below.
function Overview() {
  const [range, setRange] = useState({ scheduledFrom: '', scheduledTo: '' });
  const [applied, setApplied] = useState({ scheduledFrom: '', scheduledTo: '' });
  const [error, setError] = useState('');
  const [state, setState] = useState({ status: 'loading', data: null, message: '' });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(applied)) if (v) p.set(k, v);
    try { setState({ status: 'ready', data: await api.adminInterviewOverview(p.toString()), message: '' }); }
    catch (err) { setState({ status: 'error', data: null, message: err.message }); }
  }, [applied]);
  useEffect(() => { load(); }, [load]);

  function apply(e) {
    e.preventDefault();
    if (range.scheduledFrom && range.scheduledTo && range.scheduledFrom > range.scheduledTo) { setError('The "to" date must not be before the "from" date.'); return; }
    setError(''); setApplied(range);
  }
  const d = state.data;
  return (
    <>
      <form className="filters" onSubmit={apply}>
        <div className="field"><label htmlFor="o-from">Interview date from</label><input id="o-from" type="date" value={range.scheduledFrom} onChange={(e) => setRange((r) => ({ ...r, scheduledFrom: e.target.value }))} /></div>
        <div className="field"><label htmlFor="o-to">Interview date to</label><input id="o-to" type="date" value={range.scheduledTo} onChange={(e) => setRange((r) => ({ ...r, scheduledTo: e.target.value }))} aria-invalid={error ? 'true' : undefined} aria-describedby="o-error" /></div>
        <div className="filter-actions">
          <button type="submit" className="btn btn-primary">Apply</button>
          <button type="button" className="btn btn-secondary" onClick={() => { setError(''); setRange({ scheduledFrom: '', scheduledTo: '' }); setApplied({ scheduledFrom: '', scheduledTo: '' }); }}>All dates</button>
        </div>
        {error && <p className="field-error" id="o-error">{error}</p>}
      </form>
      <div className="table-wrap">
        {state.status === 'loading' && <p className="state-message">Loading overview…</p>}
        {state.status === 'error' && <p className="state-message">{state.message} <button type="button" className="btn btn-secondary" onClick={load}>Retry</button></p>}
        {state.status === 'ready' && d.bdes.length === 0 && <p className="state-message">No BDE accounts yet.</p>}
        {state.status === 'ready' && d.bdes.length > 0 && (
          <table>
            <thead><tr><th>BDE</th>{COLUMNS.map(([k, label]) => <th key={k} className="num">{label}</th>)}</tr></thead>
            <tbody>
              {d.bdes.map((b) => (
                <tr key={b.id}><td>{b.name} <span className="muted">({b.employeeId})</span></td>{COLUMNS.map(([k]) => <td key={k} className="num">{b[k]}</td>)}</tr>
              ))}
            </tbody>
            <tfoot><tr><td>Team total</td>{COLUMNS.map(([k]) => <td key={k} className="num">{d.totals[k]}</td>)}</tr></tfoot>
          </table>
        )}
      </div>
    </>
  );
}

export default function AdminInterviewsPage() {
  return (
    <>
      <h1>All Interviews</h1>
      <p className="hint">Interviews of the whole team, read-only. The responsible BDE is shown for every interview.</p>
      <h2 className="overview-title">Overview by BDE</h2>
      <Overview />
      <h2 className="overview-title">Interview list</h2>
      <InterviewsListView mode="admin" />
    </>
  );
}
