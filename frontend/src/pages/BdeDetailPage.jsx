import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { formatDate } from '../lib/format.js';

export default function BdeDetailPage() {
  const { id } = useParams();
  const [state, setState] = useState({ status: 'loading', data: null, message: '', code: '' });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      setState({ status: 'ready', data: await api.adminBdeDetail(id), message: '', code: '' });
    } catch (err) {
      setState({ status: 'error', data: null, message: err.message, code: err.code });
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const back = <p><Link to="/admin/bdes">Back to BDEs</Link></p>;
  if (state.status === 'loading') return <>{back}<p className="state-message">Loading…</p></>;
  if (state.status === 'error') {
    return (
      <>
        {back}
        <div className="alert alert-error" role="alert">
          <strong>{state.code === 'NOT_FOUND' ? 'BDE not found.' : 'Could not load this BDE.'}</strong> {state.message}{' '}
          {state.code !== 'NOT_FOUND' && <button type="button" className="btn btn-secondary" onClick={load}>Retry</button>}
        </div>
      </>
    );
  }
  const { bde, reports } = state.data;
  return (
    <>
      {back}
      <h1>{bde.name}</h1>
      <p className="hint">Employee ID {bde.employeeId} · {bde.isActive ? 'Active' : 'Inactive'} · Showing the latest daily calling reports. This BDE's leads, interviews and payments are on the Leads, Interviews and Payments pages (filter by BDE).</p>
      <h2 className="section-title">Daily calling reports</h2>
      <div className="table-wrap">
        {reports.length === 0 ? (
          <p className="state-message">No reports submitted yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th><th className="num">Total calls made</th><th className="num">Interested</th><th className="num">Not interested</th>
                <th className="num">Follow-up required</th><th className="num">No response / not reachable</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.reportDate)}</td>
                  <td className="num">{r.totalCalls}</td><td className="num">{r.interested}</td><td className="num">{r.notInterested}</td>
                  <td className="num">{r.followUpRequired}</td><td className="num">{r.noResponse}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
