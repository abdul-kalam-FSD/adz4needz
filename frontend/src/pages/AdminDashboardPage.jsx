import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { todayValue, formatDate } from '../lib/format.js';
import AdminCallStats from '../components/AdminCallStats.jsx';
import AdminKpis from '../components/AdminKpis.jsx';

const cell = (v) => (v === null ? '—' : v);

export default function AdminDashboardPage() {
  const [date, setDate] = useState(todayValue());
  const [state, setState] = useState({ status: 'loading', data: null, message: '' });

  const load = useCallback(async (d) => {
    if (!d) { setState({ status: 'invalid', data: null, message: 'Choose a date to see the reports.' }); return; }
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      setState({ status: 'ready', data: await api.adminDailyOverview(d), message: '' });
    } catch (err) {
      setState({ status: 'error', data: null, message: err.message });
    }
  }, []);
  useEffect(() => { load(date); }, [date, load]);

  const data = state.data;
  const t = data && data.totals;

  return (
    <>
      <h1>Admin Dashboard</h1>
      <div className="toolbar">
        <div className="field">
          <label htmlFor="overview-date">Report date</label>
          <input type="date" id="overview-date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <AdminKpis date={date} />

      <AdminCallStats date={date} />

      {state.status === 'loading' && <p className="state-message">Loading reports…</p>}
      {(state.status === 'error' || state.status === 'invalid') && (
        <div className="alert alert-error" role="alert">
          <strong>{state.status === 'error' ? 'Could not load reports.' : 'No date selected.'}</strong> {state.message}{' '}
          {state.status === 'error' && <button type="button" className="btn btn-secondary" onClick={() => load(date)}>Retry</button>}
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <h2 className="section-title">Manual Daily Calling Reports</h2>
          <p className="hint">Typed Daily Calling Reports for {formatDate(data.date)}. BDEs who record calls on the Call desk appear in the table above.</p>
          <dl className="totals">
            <div className="total-item"><dt>Reports submitted</dt><dd>{t.reportsSubmitted} of {t.bdeCount}</dd></div>
            <div className="total-item"><dt>Total calls made</dt><dd>{t.totalCalls}</dd></div>
            <div className="total-item"><dt>Interested candidates</dt><dd>{t.interested}</dd></div>
            <div className="total-item"><dt>Not interested candidates</dt><dd>{t.notInterested}</dd></div>
            <div className="total-item"><dt>Follow-up required</dt><dd>{t.followUpRequired}</dd></div>
            <div className="total-item"><dt>No response / not reachable</dt><dd>{t.noResponse}</dd></div>
          </dl>

          <h2 className="section-title">Reports by BDE</h2>
          <div className="table-wrap">
            {data.bdes.length === 0 ? (
              <p className="state-message">No BDE accounts yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>BDE</th><th>Employee ID</th><th>Report</th>
                    <th className="num">Total calls made</th><th className="num">Interested</th><th className="num">Not interested</th>
                    <th className="num">Follow-up required</th><th className="num">No response / not reachable</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bdes.map((b) => (
                    <tr key={b.id}>
                      <td><Link to={`/admin/bdes/${b.id}`}>{b.name}</Link></td>
                      <td>{b.employeeId}</td>
                      <td>{b.submitted ? 'Submitted' : <span className="muted">Not submitted</span>}</td>
                      <td className="num">{cell(b.totalCalls)}</td><td className="num">{cell(b.interested)}</td><td className="num">{cell(b.notInterested)}</td>
                      <td className="num">{cell(b.followUpRequired)}</td><td className="num">{cell(b.noResponse)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
