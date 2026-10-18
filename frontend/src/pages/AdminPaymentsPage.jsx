import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import PaymentsListView from '../components/PaymentsListView.jsx';
import { displayMoney } from '../lib/format.js';

const COLUMNS = [
  ['payments', 'Payments'], ['committed', 'Committed', true], ['received', 'Received', true], ['outstanding', 'Outstanding', true],
  ['pending', 'Pending'], ['partiallyPaid', 'Partially paid'], ['paid', 'Paid'], ['completedAmount', 'Fully paid amount', true], ['instalments', 'Instalments']
];
const EMPTY = { dateFrom: '', dateTo: '' };

// Per-BDE comparison for an optional date range, then the full list below (amounts read-only; proofs are reviewed on each payment's page).
function Overview() {
  const [range, setRange] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [error, setError] = useState('');
  const [state, setState] = useState({ status: 'loading', data: null, message: '' });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(applied)) if (v) p.set(k, v);
    try { setState({ status: 'ready', data: await api.adminPaymentOverview(p.toString()), message: '' }); }
    catch (err) { setState({ status: 'error', data: null, message: err.message }); }
  }, [applied]);
  useEffect(() => { load(); }, [load]);

  function apply(e) {
    e.preventDefault();
    if (range.dateFrom && range.dateTo && range.dateFrom > range.dateTo) { setError('The "to" date must not be before the "from" date.'); return; }
    setError(''); setApplied(range);
  }
  const d = state.data;
  const cell = (row, [k, , money]) => <td key={k} className="num">{money ? displayMoney(row[k]) : row[k]}</td>;
  return (
    <>
      <form className="filters" onSubmit={apply}>
        <div className="field"><label htmlFor="po-from">From date</label><input id="po-from" type="date" value={range.dateFrom} onChange={(e) => setRange((r) => ({ ...r, dateFrom: e.target.value }))} /></div>
        <div className="field"><label htmlFor="po-to">To date</label><input id="po-to" type="date" value={range.dateTo} onChange={(e) => setRange((r) => ({ ...r, dateTo: e.target.value }))} aria-invalid={error ? 'true' : undefined} aria-describedby="po-error" /></div>
        <div className="filter-actions">
          <button type="submit" className="btn btn-primary">Apply</button>
          <button type="button" className="btn btn-secondary" onClick={() => { setError(''); setRange(EMPTY); setApplied(EMPTY); }}>All dates</button>
        </div>
        {error && <p className="field-error" id="po-error">{error}</p>}
      </form>
      <p className="hint">
        <strong>Committed</strong> counts commitments dated in the range. <strong>Received</strong> counts instalments paid in the range (so it can include instalments against earlier commitments).
        <strong> Outstanding</strong> is committed minus what has been received so far against those commitments. Amounts are as entered by BDEs; proof review does not change them. Each uploaded proof is approved or rejected by an admin on that payment's page.
      </p>
      <div className="table-wrap">
        {state.status === 'loading' && <p className="state-message">Loading overview…</p>}
        {state.status === 'error' && <p className="state-message">{state.message} <button type="button" className="btn btn-secondary" onClick={load}>Retry</button></p>}
        {state.status === 'ready' && d.bdes.length === 0 && <p className="state-message">No BDE accounts yet.</p>}
        {state.status === 'ready' && d.bdes.length > 0 && (
          <table>
            <thead><tr><th>BDE</th>{COLUMNS.map(([k, label]) => <th key={k} className="num">{label}</th>)}</tr></thead>
            <tbody>
              {d.bdes.map((b) => <tr key={b.id}><td>{b.name} <span className="muted">({b.employeeId})</span></td>{COLUMNS.map((c) => cell(b, c))}</tr>)}
            </tbody>
            <tfoot><tr><td>Team total</td>{COLUMNS.map((c) => cell(d.totals, c))}</tr></tfoot>
          </table>
        )}
      </div>
    </>
  );
}

export default function AdminPaymentsPage() {
  return (
    <>
      <h1>All Payments</h1>
      <p className="hint">Payments of the whole team. Amounts are read-only here. The responsible BDE is shown for every payment; open a payment to view its proof and approve or reject it.</p>
      <h2 className="overview-title">Overview by BDE</h2>
      <Overview />
      <h2 className="overview-title">Payment list</h2>
      <PaymentsListView mode="admin" />
    </>
  );
}
