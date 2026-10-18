import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

export default function BdeListPage() {
  const [state, setState] = useState({ status: 'loading', items: [], message: '' });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      setState({ status: 'ready', items: (await api.adminListBdes()).bdes, message: '' });
    } catch (err) {
      setState({ status: 'error', items: [], message: err.message });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <h1>BDEs</h1>
      <div className="table-wrap">
        {state.status === 'loading' && <p className="state-message">Loading BDEs…</p>}
        {state.status === 'error' && <p className="state-message">{state.message} <button type="button" className="btn btn-secondary" onClick={load}>Retry</button></p>}
        {state.status === 'ready' && state.items.length === 0 && <p className="state-message">No BDE accounts yet.</p>}
        {state.status === 'ready' && state.items.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Employee ID</th><th>Account</th></tr></thead>
            <tbody>
              {state.items.map((b) => (
                <tr key={b.id}>
                  <td><Link to={`/admin/bdes/${b.id}`}>{b.name}</Link></td>
                  <td>{b.employeeId}</td>
                  <td>{b.isActive ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
