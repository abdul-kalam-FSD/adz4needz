import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { todayValue, formatDate } from '../lib/format.js';
import AdminCallStats from '../components/AdminCallStats.jsx';
import AdminKpis from '../components/AdminKpis.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { SectionHead } from '../components/DashboardParts.jsx';

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
      <PageHeader
        title="Admin Dashboard"
        actions={(
          <div className="field dash-date">
            <label htmlFor="overview-date">Report date</label>
            <input type="date" id="overview-date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        )}
      />

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
        <section aria-label="Manual daily reports">
          <SectionHead title="Manual daily reports" meta={formatDate(data.date)} />
          <div className="table-wrap dash-table">
            {data.bdes.length === 0 ? (
              <p className="state-message">No BDE accounts yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>BDE</th><th>Report</th>
                    <th className="num">Total calls made</th><th className="num">Interested</th><th className="num">Not interested</th>
                    <th className="num">Follow-up required</th><th className="num">No response / not reachable</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bdes.map((b) => (
                    <tr key={b.id}>
                      <td><Link to={`/admin/bdes/${b.id}`}>{b.name}</Link><div className="muted">{b.employeeId}</div></td>
                      <td>{b.submitted ? <span className="badge badge-success">Submitted</span> : <span className="badge badge-muted">Not submitted</span>}</td>
                      <td className="num">{cell(b.totalCalls)}</td><td className="num">{cell(b.interested)}</td><td className="num">{cell(b.notInterested)}</td>
                      <td className="num">{cell(b.followUpRequired)}</td><td className="num">{cell(b.noResponse)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Team total</td><td>{t.reportsSubmitted} of {t.bdeCount} submitted</td>
                    <td className="num">{t.totalCalls}</td><td className="num">{t.interested}</td><td className="num">{t.notInterested}</td>
                    <td className="num">{t.followUpRequired}</td><td className="num">{t.noResponse}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
          <details className="dash-note">
            <summary>About manual reports</summary>
            <p>These are typed Daily Calling Reports. BDEs who record calls on the Call desk are counted in the table above instead.</p>
          </details>
        </section>
      )}
    </>
  );
}
