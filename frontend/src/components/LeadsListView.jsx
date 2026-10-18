import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { todayValue, formatDate } from '../lib/format.js';
import { changeStatus, statusOptions, withNewStatus } from '../lib/lead-status.js';

const EMPTY = { q: '', statusId: '', followUp: '', followUpFrom: '', followUpTo: '', bdeId: '' };
const PAGE_SIZE = 25;
const BADGE = { overdue: ['badge-overdue', 'Overdue'], today: ['badge-today', 'Due today'], upcoming: ['badge-upcoming', 'Upcoming'] };

function buildQuery(applied, page, today) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(applied)) if (v) p.set(k, v);
  p.set('today', today);
  p.set('page', String(page));
  p.set('pageSize', String(PAGE_SIZE));
  return p.toString();
}

// mode "bde": the BDE's own leads (can add/edit). mode "admin": whole team, read-only, shows the responsible BDE.
export default function LeadsListView({ mode }) {
  const admin = mode === 'admin';
  const location = useLocation();
  const today = useMemo(todayValue, []);
  const [flash, setFlash] = useState((location.state && location.state.saved) || '');
  const [form, setForm] = useState(EMPTY);        // what is typed in the filter boxes
  const [applied, setApplied] = useState(EMPTY);  // what the list is actually using
  const [filterError, setFilterError] = useState('');
  const [page, setPage] = useState(1);
  const [statuses, setStatuses] = useState([]);
  const [bdes, setBdes] = useState([]);
  const [summary, setSummary] = useState(null);
  const [list, setList] = useState({ state: 'loading', data: null, message: '' });

  useEffect(() => { api.leadStatuses().then((d) => setStatuses(d.statuses)).catch(() => {}); }, []);
  useEffect(() => { if (admin) api.adminListBdes().then((d) => setBdes(d.bdes)).catch(() => {}); }, [admin]);
  const loadSummary = useCallback(() => {
    (admin ? api.adminLeadSummary(today) : api.leadSummary(today)).then((d) => setSummary(d)).catch(() => setSummary(null));
  }, [admin, today]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  // One-click status change (BDE list only). The row shows the new status only after the server confirmed it; on any failure the old
  // status stays and the message appears under that row. inFlight (a ref) blocks a second request for the same lead immediately.
  const inFlight = useRef(new Set());
  const [busyIds, setBusyIds] = useState([]);
  const [rowErrors, setRowErrors] = useState({});   // leadId -> message
  const [statusNote, setStatusNote] = useState(''); // polite announcement for screen readers and sighted users
  async function onStatusChange(lead, statusId) {
    if (inFlight.current.has(lead.id)) return;
    setRowErrors((e) => { const { [lead.id]: _drop, ...rest } = e; return rest; });
    setStatusNote('');
    setBusyIds((ids) => (ids.includes(lead.id) ? ids : [...ids, lead.id]));
    const res = await changeStatus({ lead, statusId, inFlight: inFlight.current, send: (id) => api.setLeadStatus(id, statusId) });
    setBusyIds((ids) => ids.filter((x) => x !== lead.id));
    if (res.skipped) return;
    if (!res.ok) { setRowErrors((e) => ({ ...e, [lead.id]: res.message })); return; }
    setList((l) => (l.data ? { ...l, data: { ...l.data, leads: withNewStatus(l.data.leads, lead.id, res.lead, statuses, today, (summary && summary.upcomingDays) || 7) } } : l));
    setStatusNote(`Status of ${lead.candidateName} changed to ${res.lead.status.name}.`);
    loadSummary();
  }

  const load = useCallback(async () => {
    setList((l) => ({ ...l, state: 'loading' }));
    try {
      const qs = buildQuery(applied, page, today);
      const data = await (admin ? api.adminListLeads(qs) : api.listLeads(qs));
      setList({ state: 'ready', data, message: '' });
    } catch (err) {
      setList({ state: 'error', data: null, message: err.message });
    }
  }, [admin, applied, page, today]);
  useEffect(() => { load(); }, [load]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function applyFilters(e) {
    e.preventDefault();
    if (form.followUpFrom && form.followUpTo && form.followUpFrom > form.followUpTo) {
      setFilterError('The "to" date must not be before the "from" date.');
      return;
    }
    setFilterError('');
    setPage(1);
    setApplied({ ...form, q: form.q.trim() });
  }
  function clearFilters() { setFilterError(''); setForm(EMPTY); setApplied(EMPTY); setPage(1); }
  function quick(followUp) { const next = { ...EMPTY, followUp }; setFilterError(''); setForm(next); setApplied(next); setPage(1); }

  const data = list.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Object.values(applied).some(Boolean);
  const counts = summary && summary.counts;

  return (
    <>
      {flash && <div className="alert alert-success" role="status"><strong>{flash}</strong> <button type="button" className="btn-link" onClick={() => setFlash('')}>Dismiss</button></div>}

      <p className="sr-only" role="status" aria-live="polite">{statusNote}</p>
      {statusNote && <div className="alert alert-success" aria-hidden="true">{statusNote}</div>}

      {counts && (
        <div className="followup-summary" role="group" aria-label="Follow-up summary">
          <button type="button" className="summary-button" aria-pressed={applied.followUp === 'overdue'} onClick={() => quick('overdue')}><span className="n">{counts.overdue}</span> Overdue</button>
          <button type="button" className="summary-button" aria-pressed={applied.followUp === 'today'} onClick={() => quick('today')}><span className="n">{counts.today}</span> Due today</button>
          <button type="button" className="summary-button" aria-pressed={applied.followUp === 'upcoming'} onClick={() => quick('upcoming')}><span className="n">{counts.upcoming}</span> Upcoming (next {summary.upcomingDays} days)</button>
        </div>
      )}

      <form className="filters" onSubmit={applyFilters}>
        <div className="field">
          <label htmlFor="f-q">Search</label>
          <input id="f-q" type="search" value={form.q} onChange={set('q')} placeholder="Name, phone, email or course" maxLength={100} />
        </div>
        <div className="field">
          <label htmlFor="f-status">Status</label>
          <select id="f-status" value={form.statusId} onChange={set('statusId')}>
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-followup">Follow-up</label>
          <select id="f-followup" value={form.followUp} onChange={set('followUp')}>
            <option value="">Any</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming (next 7 days)</option>
            <option value="none">No follow-up date</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-from">Follow-up from</label>
          <input id="f-from" type="date" value={form.followUpFrom} onChange={set('followUpFrom')} />
        </div>
        <div className="field">
          <label htmlFor="f-to">Follow-up to</label>
          <input id="f-to" type="date" value={form.followUpTo} onChange={set('followUpTo')} aria-invalid={filterError ? 'true' : undefined} aria-describedby="f-error" />
        </div>
        {admin && (
          <div className="field">
            <label htmlFor="f-bde">BDE</label>
            <select id="f-bde" value={form.bdeId} onChange={set('bdeId')}>
              <option value="">All BDEs</option>
              {bdes.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.employeeId})</option>)}
            </select>
          </div>
        )}
        <div className="filter-actions">
          <button type="submit" className="btn btn-primary">Apply</button>
          <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear filters</button>
        </div>
        {filterError && <p className="field-error" id="f-error">{filterError}</p>}
      </form>

      <div className="table-wrap">
        {list.state === 'loading' && <p className="state-message">Loading leads…</p>}
        {list.state === 'error' && <p className="state-message">{list.message} <button type="button" className="btn btn-secondary" onClick={load}>Retry</button></p>}
        {list.state === 'ready' && data.leads.length === 0 && (
          <p className="state-message">{filtered ? 'No leads match these filters.' : admin ? 'No leads have been added yet.' : 'No leads yet. Use "Add lead" to create the first one.'}</p>
        )}
        {list.state === 'ready' && data.leads.length > 0 && (
          <table className="table-stack" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader">Candidate</th><th role="columnheader">Contact</th><th role="columnheader">Course / internship</th><th role="columnheader">Status</th><th role="columnheader">Follow-up</th><th role="columnheader">Next action</th>
                {admin && <th role="columnheader">BDE</th>}
                {!admin && <th role="columnheader"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {data.leads.map((l) => (
                <tr key={l.id} role="row">
                  <td role="cell" data-label="Candidate">{l.candidateName}</td>
                  <td role="cell" data-label="Contact">{l.phone && <div>{l.phone}</div>}{l.email && <div className="muted">{l.email}</div>}</td>
                  <td role="cell" data-label="Course / internship">{l.courseOrInternship}</td>
                  <td role="cell" data-label="Status">
                    {admin ? l.status.name : (
                      statuses.length === 0 ? l.status.name : (
                        <div className="status-cell">
                          <select className="status-select" aria-label={`Status for ${l.candidateName}`} value={l.status.id}
                            onChange={(e) => onStatusChange(l, e.target.value)} disabled={busyIds.includes(l.id)} aria-busy={busyIds.includes(l.id) ? 'true' : undefined}
                            aria-invalid={rowErrors[l.id] ? 'true' : undefined} aria-describedby={rowErrors[l.id] ? `status-error-${l.id}` : undefined}>
                            {statusOptions(statuses, l.status).map((s) => <option key={s.id} value={s.id}>{s.name}{s.retired ? ' (retired)' : ''}</option>)}
                          </select>
                          {busyIds.includes(l.id) && <span className="status-pending" role="status">Saving…</span>}
                          {rowErrors[l.id] && <p className="field-error" id={`status-error-${l.id}`} role="alert">{rowErrors[l.id]}</p>}
                        </div>
                      )
                    )}
                  </td>
                  <td role="cell" data-label="Follow-up">
                    {l.followUpDate ? formatDate(l.followUpDate) : <span className="muted">—</span>}
                    {l.followUpState && BADGE[l.followUpState] && <span className={'badge ' + BADGE[l.followUpState][0]}>{BADGE[l.followUpState][1]}</span>}
                  </td>
                  <td role="cell" data-label="Next action" className="clip" title={l.nextAction || ''}>{l.nextAction || <span className="muted">—</span>}</td>
                  {admin && <td role="cell" data-label="BDE">{l.bde.name} <span className="muted">({l.bde.employeeId})</span></td>}
                  {!admin && <td role="cell" data-label="Actions"><Link to={`/leads/${l.id}/edit`}>Edit</Link> · <Link to={`/interviews/new?leadId=${l.id}`}>Schedule interview</Link> · <Link to={`/payments/new?leadId=${l.id}`}>Add payment</Link></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {list.state === 'ready' && data.total > 0 && (
        <div className="pager">
          <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {page} of {totalPages} · {data.total} lead{data.total === 1 ? '' : 's'}</span>
          <button type="button" className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </>
  );
}
