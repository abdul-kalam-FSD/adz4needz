import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { formatDate, displayMoney } from '../lib/format.js';
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_BADGE } from '../lib/payment-labels.js';

const EMPTY = { q: '', status: '', commitmentFrom: '', commitmentTo: '', missingProof: '', bdeId: '' };
const PAGE_SIZE = 25;

function buildQuery(applied, page) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(applied)) if (v) p.set(k, v);
  p.set('page', String(page));
  p.set('pageSize', String(PAGE_SIZE));
  return p.toString();
}

// mode "bde": the BDE's own payments (with their own totals). mode "admin": whole team, read-only, shows the responsible BDE.
export default function PaymentsListView({ mode }) {
  const admin = mode === 'admin';
  const location = useLocation();
  const [flash, setFlash] = useState((location.state && location.state.saved) || '');
  const [form, setForm] = useState(EMPTY);        // what is typed in the filter boxes
  const [applied, setApplied] = useState(EMPTY);  // what the list is actually using
  const [filterError, setFilterError] = useState('');
  const [page, setPage] = useState(1);
  const [bdes, setBdes] = useState([]);
  const [totals, setTotals] = useState(null);
  const [list, setList] = useState({ state: 'loading', data: null, message: '' });

  useEffect(() => { if (admin) api.adminListBdes().then((d) => setBdes(d.bdes)).catch(() => {}); }, [admin]);
  useEffect(() => { if (!admin) api.paymentSummary('').then((d) => setTotals(d.totals)).catch(() => setTotals(null)); }, [admin]);

  const load = useCallback(async () => {
    setList((l) => ({ ...l, state: 'loading' }));
    try {
      const qs = buildQuery(applied, page);
      setList({ state: 'ready', data: await (admin ? api.adminListPayments(qs) : api.listPayments(qs)), message: '' });
    } catch (err) {
      setList({ state: 'error', data: null, message: err.message });
    }
  }, [admin, applied, page]);
  useEffect(() => { load(); }, [load]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? (e.target.checked ? 'yes' : '') : e.target.value }));
  function applyFilters(e) {
    e.preventDefault();
    if (form.commitmentFrom && form.commitmentTo && form.commitmentFrom > form.commitmentTo) { setFilterError('The "to" date must not be before the "from" date.'); return; }
    setFilterError(''); setPage(1); setApplied({ ...form, q: form.q.trim() });
  }
  function clearFilters() { setFilterError(''); setForm(EMPTY); setApplied(EMPTY); setPage(1); }
  function quick(status) { const next = { ...EMPTY, status }; setFilterError(''); setForm(next); setApplied(next); setPage(1); }

  const data = list.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Object.values(applied).some(Boolean);
  const base = admin ? '/admin/payments/' : '/payments/';

  return (
    <>
      {flash && <div className="alert alert-success" role="status"><strong>{flash}</strong> <button type="button" className="btn-link" onClick={() => setFlash('')}>Dismiss</button></div>}

      {totals && (
        <div className="totals-grid" role="group" aria-label="My payment totals">
          <div className="total-card"><span className="n">{displayMoney(totals.committed)}</span><span className="l">Committed ({totals.payments} payment{totals.payments === 1 ? '' : 's'})</span></div>
          <div className="total-card"><span className="n">{displayMoney(totals.received)}</span><span className="l">Received ({totals.instalments} instalment{totals.instalments === 1 ? '' : 's'})</span></div>
          <div className="total-card"><span className="n">{displayMoney(totals.outstanding)}</span><span className="l">Outstanding on commitments</span></div>
          <button type="button" className="total-card summary-button" aria-pressed={applied.status === 'pending'} onClick={() => quick('pending')}><span className="n">{totals.pending}</span><span className="l">Pending</span></button>
          <button type="button" className="total-card summary-button" aria-pressed={applied.status === 'partially_paid'} onClick={() => quick('partially_paid')}><span className="n">{totals.partiallyPaid}</span><span className="l">Partially paid</span></button>
          <button type="button" className="total-card summary-button" aria-pressed={applied.status === 'paid'} onClick={() => quick('paid')}><span className="n">{totals.paid}</span><span className="l">Paid</span></button>
        </div>
      )}

      <form className="filters" onSubmit={applyFilters}>
        <div className="field">
          <label htmlFor="p-q">Search</label>
          <input id="p-q" type="search" value={form.q} onChange={set('q')} placeholder="Candidate, phone, email or course" maxLength={100} />
        </div>
        <div className="field">
          <label htmlFor="p-status">Status</label>
          <select id="p-status" value={form.status} onChange={set('status')}>
            <option value="">Any</option>
            {Object.entries(PAYMENT_STATUS_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="p-from">Committed from</label><input id="p-from" type="date" value={form.commitmentFrom} onChange={set('commitmentFrom')} /></div>
        <div className="field"><label htmlFor="p-to">Committed to</label><input id="p-to" type="date" value={form.commitmentTo} onChange={set('commitmentTo')} aria-invalid={filterError ? 'true' : undefined} aria-describedby="p-error" /></div>
        {admin && (
          <div className="field">
            <label htmlFor="p-bde">BDE</label>
            <select id="p-bde" value={form.bdeId} onChange={set('bdeId')}>
              <option value="">All BDEs</option>
              {bdes.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.employeeId})</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label className="check-row" htmlFor="p-proof"><input id="p-proof" type="checkbox" checked={form.missingProof === 'yes'} onChange={set('missingProof')} /> Instalment without proof</label>
        </div>
        <div className="filter-actions">
          <button type="submit" className="btn btn-primary">Apply</button>
          <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear filters</button>
        </div>
        {filterError && <p className="field-error" id="p-error">{filterError}</p>}
      </form>

      <div className="table-wrap">
        {list.state === 'loading' && <p className="state-message">Loading payments…</p>}
        {list.state === 'error' && <p className="state-message">{list.message} <button type="button" className="btn btn-secondary" onClick={load}>Retry</button></p>}
        {list.state === 'ready' && data.payments.length === 0 && (
          <p className="state-message">{filtered ? 'No payments match these filters.' : admin ? 'No payments have been recorded yet.' : 'No payments yet. Use "Add payment" to record the first commitment.'}</p>
        )}
        {list.state === 'ready' && data.payments.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Candidate</th><th>Course / internship</th><th>Committed on</th>
                <th className="num">Committed</th><th className="num">Received</th><th className="num">Outstanding</th>
                <th>Status</th><th>Proof</th>
                {admin && <th>BDE</th>}
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.lead.candidateName}{(p.lead.phone || p.lead.email) && <div className="muted">{p.lead.phone || p.lead.email}</div>}</td>
                  <td>{p.courseOrInternship}</td>
                  <td>{formatDate(p.commitmentDate)}</td>
                  <td className="num">{displayMoney(p.amountCommitted)}</td>
                  <td className="num">{displayMoney(p.amountPaid)}</td>
                  <td className="num">{displayMoney(p.amountOutstanding)}</td>
                  <td><span className={'badge ' + PAYMENT_STATUS_BADGE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</span></td>
                  <td>{p.instalmentCount === 0 ? <span className="muted">—</span> : `${p.receiptCount} file${p.receiptCount === 1 ? '' : 's'} / ${p.instalmentCount} instalment${p.instalmentCount === 1 ? '' : 's'}`}</td>
                  {admin && <td>{p.bde.name} <span className="muted">({p.bde.employeeId})</span></td>}
                  <td><Link to={base + p.id}>{admin ? 'View' : 'Open'}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {list.state === 'ready' && data.total > 0 && (
        <div className="pager">
          <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {page} of {totalPages} · {data.total} payment{data.total === 1 ? '' : 's'}</span>
          <button type="button" className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </>
  );
}
