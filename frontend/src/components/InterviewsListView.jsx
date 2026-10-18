import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { todayValue, formatDateTime } from '../lib/format.js';
import { ATTENDANCE_LABEL, OUTCOME_LABEL, ATTENDANCE_BADGE, OUTCOME_BADGE, STATE_BADGE, interestedText } from '../lib/interview-labels.js';

const EMPTY = { q: '', when: '', attendance: '', outcome: '', interested: '', paymentConfirmed: '', scheduledFrom: '', scheduledTo: '', bdeId: '' };
const PAGE_SIZE = 25;

function buildQuery(applied, page, today) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(applied)) if (v) p.set(k, v);
  p.set('today', today);
  p.set('page', String(page));
  p.set('pageSize', String(PAGE_SIZE));
  return p.toString();
}

// mode "bde": the BDE's own interviews (can edit). mode "admin": whole team, read-only, shows the responsible BDE.
export default function InterviewsListView({ mode }) {
  const admin = mode === 'admin';
  const location = useLocation();
  const today = useMemo(todayValue, []);
  const [flash, setFlash] = useState((location.state && location.state.saved) || '');
  const [form, setForm] = useState(EMPTY);        // what is typed in the filter boxes
  const [applied, setApplied] = useState(EMPTY);  // what the list is actually using
  const [filterError, setFilterError] = useState('');
  const [page, setPage] = useState(1);
  const [bdes, setBdes] = useState([]);
  const [summary, setSummary] = useState(null);
  const [list, setList] = useState({ state: 'loading', data: null, message: '' });

  useEffect(() => { if (admin) api.adminListBdes().then((d) => setBdes(d.bdes)).catch(() => {}); }, [admin]);
  useEffect(() => {
    (admin ? api.adminInterviewSummary(today) : api.interviewSummary(today)).then((d) => setSummary(d)).catch(() => setSummary(null));
  }, [admin, today]);

  const load = useCallback(async () => {
    setList((l) => ({ ...l, state: 'loading' }));
    try {
      const qs = buildQuery(applied, page, today);
      const data = await (admin ? api.adminListInterviews(qs) : api.listInterviews(qs));
      setList({ state: 'ready', data, message: '' });
    } catch (err) {
      setList({ state: 'error', data: null, message: err.message });
    }
  }, [admin, applied, page, today]);
  useEffect(() => { load(); }, [load]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function applyFilters(e) {
    e.preventDefault();
    if (form.scheduledFrom && form.scheduledTo && form.scheduledFrom > form.scheduledTo) {
      setFilterError('The "to" date must not be before the "from" date.');
      return;
    }
    setFilterError('');
    setPage(1);
    setApplied({ ...form, q: form.q.trim() });
  }
  function clearFilters() { setFilterError(''); setForm(EMPTY); setApplied(EMPTY); setPage(1); }
  function quick(when) { const next = { ...EMPTY, when }; setFilterError(''); setForm(next); setApplied(next); setPage(1); }

  const data = list.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Object.values(applied).some(Boolean);
  const counts = summary && summary.counts;
  const select = (id, label, key, options) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={form[key]} onChange={set(key)}>
        <option value="">Any</option>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </div>
  );

  return (
    <>
      {flash && <div className="alert alert-success" role="status"><strong>{flash}</strong> <button type="button" className="btn-link" onClick={() => setFlash('')}>Dismiss</button></div>}

      {counts && (
        <div className="followup-summary" role="group" aria-label="Interview summary">
          <button type="button" className="summary-button" aria-pressed={applied.when === 'needs_update'} onClick={() => quick('needs_update')}><span className="n">{counts.needsUpdate}</span> Need attendance update</button>
          <button type="button" className="summary-button" aria-pressed={applied.when === 'today'} onClick={() => quick('today')}><span className="n">{counts.today}</span> Today</button>
          <button type="button" className="summary-button" aria-pressed={applied.when === 'upcoming'} onClick={() => quick('upcoming')}><span className="n">{counts.upcoming}</span> Upcoming</button>
        </div>
      )}

      <form className="filters" onSubmit={applyFilters}>
        <div className="field">
          <label htmlFor="i-q">Search candidate</label>
          <input id="i-q" type="search" value={form.q} onChange={set('q')} placeholder="Name, phone, email or course" maxLength={100} />
        </div>
        {select('i-when', 'When', 'when', [['needs_update', 'Date passed, attendance Pending'], ['today', 'Today'], ['upcoming', 'Upcoming (after today)']])}
        {select('i-att', 'Attendance', 'attendance', Object.entries(ATTENDANCE_LABEL))}
        {select('i-out', 'Outcome', 'outcome', Object.entries(OUTCOME_LABEL))}
        {select('i-int', 'Interested in joining', 'interested', [['yes', 'Yes'], ['no', 'No'], ['unknown', 'Not recorded']])}
        {select('i-pay', 'Payment confirmed', 'paymentConfirmed', [['yes', 'Yes'], ['no', 'No']])}
        <div className="field">
          <label htmlFor="i-from">Interview date from</label>
          <input id="i-from" type="date" value={form.scheduledFrom} onChange={set('scheduledFrom')} />
        </div>
        <div className="field">
          <label htmlFor="i-to">Interview date to</label>
          <input id="i-to" type="date" value={form.scheduledTo} onChange={set('scheduledTo')} aria-invalid={filterError ? 'true' : undefined} aria-describedby="i-error" />
        </div>
        {admin && (
          <div className="field">
            <label htmlFor="i-bde">BDE</label>
            <select id="i-bde" value={form.bdeId} onChange={set('bdeId')}>
              <option value="">All BDEs</option>
              {bdes.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.employeeId})</option>)}
            </select>
          </div>
        )}
        <div className="filter-actions">
          <button type="submit" className="btn btn-primary">Apply</button>
          <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear filters</button>
        </div>
        {filterError && <p className="field-error" id="i-error">{filterError}</p>}
      </form>

      <div className="table-wrap">
        {list.state === 'loading' && <p className="state-message">Loading interviews…</p>}
        {list.state === 'error' && <p className="state-message">{list.message} <button type="button" className="btn btn-secondary" onClick={load}>Retry</button></p>}
        {list.state === 'ready' && data.interviews.length === 0 && (
          <p className="state-message">{filtered ? 'No interviews match these filters.' : admin ? 'No interviews have been scheduled yet.' : 'No interviews yet. Use "Schedule interview" to add the first one.'}</p>
        )}
        {list.state === 'ready' && data.interviews.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Candidate</th><th>Course / internship</th><th>Interview</th><th>Attendance</th><th>Outcome</th><th>Interested</th><th>Payment</th>
                {admin && <th>BDE</th>}
                {!admin && <th><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {data.interviews.map((i) => (
                <tr key={i.id}>
                  <td>{i.lead.candidateName}{(i.lead.phone || i.lead.email) && <div className="muted">{i.lead.phone || i.lead.email}</div>}</td>
                  <td>{i.lead.courseOrInternship}</td>
                  <td>
                    {formatDateTime(i.scheduledAt)}
                    {i.state && STATE_BADGE[i.state] && <span className={'badge ' + STATE_BADGE[i.state][0]}>{STATE_BADGE[i.state][1]}</span>}
                  </td>
                  <td><span className={'badge ' + ATTENDANCE_BADGE[i.attendance]}>{ATTENDANCE_LABEL[i.attendance]}</span></td>
                  <td><span className={'badge ' + OUTCOME_BADGE[i.outcome]}>{OUTCOME_LABEL[i.outcome]}</span></td>
                  <td>{i.interestedInJoining === null ? <span className="muted">—</span> : interestedText(i.interestedInJoining)}</td>
                  <td>{i.paymentConfirmed ? <span className="badge badge-success">Confirmed</span> : <span className="muted">Not confirmed</span>}</td>
                  {admin && <td>{i.bde.name} <span className="muted">({i.bde.employeeId})</span></td>}
                  {!admin && <td><Link to={`/interviews/${i.id}/edit`}>Edit</Link></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {list.state === 'ready' && data.total > 0 && (
        <div className="pager">
          <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {page} of {totalPages} · {data.total} interview{data.total === 1 ? '' : 's'}</span>
          <button type="button" className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </>
  );
}
