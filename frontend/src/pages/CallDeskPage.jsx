import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';
import FollowUp from '../components/FollowUp.jsx';
import { SectionHead } from '../components/DashboardParts.jsx';
import { todayValue, formatDate } from '../lib/format.js';
import { OUTCOMES, outcomeLabel, formatPercent, formatCallTime, beginAttempt, succeedAttempt, failAttempt, describeSaved, beginListLoad, finishListLoad, failListLoad, listShowsRows } from '../lib/call-desk.js';

const PAGE_SIZE = 20;

// Outcome -> the status badge it shares with the rest of the app (same accessible colours as the follow-up badges).
const TONE_BADGE = { yes: 'badge-success', no: 'badge-overdue', follow: 'badge-today', none: 'badge-muted' };
const toneBadge = (key) => TONE_BADGE[(OUTCOMES.find((o) => o.key === key) || {}).tone] || 'badge-muted';
const OUTCOME_COUNT = { interested: 'interested', not_interested: 'notInterested', follow_up: 'followUp', no_response: 'noResponse' };

// One click = one recorded call. Nothing is counted or shown as saved until the server confirms it; the totals are always the
// server's numbers (re-read after every save), never computed in the browser.
export default function CallDeskPage() {
  const today = todayValue();
  const [q, setQ] = useState('');
  const [statusId, setStatusId] = useState('');
  const [applied, setApplied] = useState({ q: '', statusId: '' });
  const [page, setPage] = useState(1);
  const [statuses, setStatuses] = useState([]);
  const [list, setList] = useState({ state: 'loading', data: null, message: '' });
  const [day, setDay] = useState({ state: 'loading', data: null, message: '' });
  const [rows, setRowsState] = useState({});
  const rowsRef = useRef({}); // updated synchronously, so a fast second click can never slip through before React re-renders
  const [dates, setDates] = useState({});   // optional follow-up date typed per lead
  const [undoing, setUndoing] = useState({}); // call id -> { pending, error }
  const [notice, setNotice] = useState('');

  const setRows = (next) => { rowsRef.current = next; setRowsState(next); };

  useEffect(() => { api.leadStatuses().then((d) => setStatuses(d.statuses)).catch(() => {}); }, []);

  const listRequest = useRef(0); // only the newest request may update the list (an older, slower answer is ignored)
  const loadLeads = useCallback(async (options) => {
    const background = Boolean(options && options.background === true);
    const request = ++listRequest.current;
    setList((l) => beginListLoad(l, { background }));
    try {
      const p = new URLSearchParams();
      if (applied.q) p.set('q', applied.q);
      if (applied.statusId) p.set('statusId', applied.statusId);
      p.set('today', today); p.set('page', String(page)); p.set('pageSize', String(PAGE_SIZE));
      const data = await api.listLeads(p.toString());
      if (request === listRequest.current) setList(finishListLoad(data));
    } catch (err) {
      if (request === listRequest.current) setList((l) => failListLoad(l, err.message, { background }));
    }
  }, [applied, page, today]);
  useEffect(() => { loadLeads(); }, [loadLeads]);

  const loadDay = useCallback(async () => {
    try { setDay({ state: 'ready', data: await api.callSummary(), message: '' }); return true; }
    catch (err) { setDay((d) => ({ state: d.data ? 'stale' : 'error', data: d.data, message: err.message })); return false; }
  }, []);
  useEffect(() => { loadDay(); }, [loadDay]);

  async function record(lead, outcome) {
    setNotice('');
    const followUpDate = outcome === 'follow_up' ? (dates[lead.id] || '') : '';
    const begun = beginAttempt(rowsRef.current, lead.id, outcome, followUpDate);
    if (!begun.attempt) return; // a save for this lead is already running
    setRows(begun.rows);
    try {
      const result = await api.recordCall({ leadId: lead.id, outcome, clientRequestId: begun.attempt.requestId, ...(begun.attempt.followUpDate ? { followUpDate: begun.attempt.followUpDate } : {}) });
      setRows(succeedAttempt(rowsRef.current, lead.id, result));
      // Show the lead's new status from the server's answer only where we know it; the list is re-read below.
      const refreshed = await loadDay();
      if (!refreshed) setNotice('The call was saved, but the totals could not be refreshed. Reload the page to see them.');
      loadLeads({ background: true });
    } catch (err) {
      setRows(failAttempt(rowsRef.current, lead.id, err)); // shown as an error on the row; nothing is counted
    }
  }

  async function undo(entry) {
    if (undoing[entry.id] && undoing[entry.id].pending) return;
    setUndoing((u) => ({ ...u, [entry.id]: { pending: true, error: '' } }));
    try {
      await api.undoCall(entry.id);
      setUndoing((u) => { const n = { ...u }; delete n[entry.id]; return n; });
      setNotice(`The call to ${entry.candidateName} was removed from today's count. The lead's status was not changed: record the correct outcome if needed.`);
      await loadDay(); loadLeads({ background: true });
    } catch (err) { setUndoing((u) => ({ ...u, [entry.id]: { pending: false, error: err.message } })); }
  }

  const stats = day.data && day.data.stats;
  const data = list.data;
  const showRows = listShowsRows(list);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Call desk" description={`Each click records one call for today${day.data ? ` (${formatDate(day.data.today)})` : ''}.`} />

      {notice && <div className="alert alert-warning" role="status">{notice} <button type="button" className="btn-link" onClick={() => setNotice('')}>Dismiss</button></div>}

      <section className="dash-card cd-today" aria-label="Today's numbers">
        {day.state === 'loading' && <p className="dash-muted" role="status">Loading today's numbers…</p>}
        {day.state === 'error' && <div className="alert alert-error" role="alert"><strong>Could not load today's numbers.</strong> {day.message} <button type="button" className="btn btn-secondary" onClick={loadDay}>Retry</button></div>}
        {day.state === 'stale' && <div className="alert alert-error" role="alert">These numbers may be out of date: {day.message} <button type="button" className="btn btn-secondary" onClick={loadDay}>Retry</button></div>}
        {stats && (
          <>
            <dl className="dash-metrics">
              <div><dt>Calls today</dt><dd>{stats.totalCalls}</dd></div>
              <div><dt>Different leads called</dt><dd>{stats.uniqueLeadsCalled}</dd></div>
              <div><dt>Repeat calls</dt><dd>{stats.repeatCalls}</dd></div>
              <div><dt>Interested leads</dt><dd>{stats.interestedLeads}</dd></div>
              <div><dt>Interested leads ÷ calls</dt><dd>{formatPercent(stats.conversionRate)}</dd></div>
            </dl>
            <ul className="cd-outcomes" aria-label="Calls today by result">
              {OUTCOMES.map((o) => <li key={o.key}><span className={'badge ' + toneBadge(o.key)}>{o.label} <strong>{stats.outcomes[OUTCOME_COUNT[o.key]]}</strong></span></li>)}
            </ul>
          </>
        )}
        <details className="dash-note">
          <summary>How calls are counted</summary>
          <p>Every click is one call, and calling the same person again counts as another call. The admin's daily view, the monthly report and your targets all use these calls. On a day you use the Call desk you do not need the <Link to="/daily-report">Daily Report</Link>; if you submit both, only the Call desk calls are counted for that day.</p>
        </details>
      </section>

      <form className="filters filters-bar" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied({ q: q.trim(), statusId }); }}>
        <div className="field field-search">
          <label htmlFor="cd-q">Search</label>
          <input id="cd-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, email or course" maxLength={100} />
        </div>
        <div className="field">
          <label htmlFor="cd-status">Status</label>
          <select id="cd-status" value={statusId} onChange={(e) => setStatusId(e.target.value)}>
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="filter-actions">
          <button type="submit" className="btn btn-primary">Apply</button>
          <button type="button" className="btn btn-secondary" onClick={() => { setQ(''); setStatusId(''); setPage(1); setApplied({ q: '', statusId: '' }); }}>Clear</button>
        </div>
      </form>

      {list.refreshError && <div className="alert alert-warning" role="alert"><strong>The lead list could not be refreshed.</strong> The rows below are from before your last call. {list.refreshError} <button type="button" className="btn btn-secondary" onClick={() => loadLeads({ background: true })}>Refresh again</button></div>}
      <div className="table-wrap" aria-busy={list.state === 'refreshing' ? 'true' : undefined}>
        {list.state === 'loading' && <p className="state-message">Loading leads…</p>}
        {list.state === 'error' && <p className="state-message">{list.message} <button type="button" className="btn btn-secondary" onClick={() => loadLeads()}>Retry</button></p>}
        {showRows && data.leads.length === 0 && <p className="state-message">{applied.q || applied.statusId ? 'No leads match these filters.' : 'You have no leads yet. Ask the admin to import leads, or add one on the Leads page.'}</p>}
        {showRows && data.leads.length > 0 && (
          <table className="call-desk-table table-stack" role="table">
            <thead role="rowgroup"><tr role="row"><th role="columnheader">Candidate</th><th role="columnheader">Phone</th><th role="columnheader">Status</th><th role="columnheader">Follow-up</th><th role="columnheader">Result of this call</th></tr></thead>
            <tbody role="rowgroup">
              {data.leads.map((l) => {
                const r = rows[l.id] || {};
                return (
                  <tr key={l.id} role="row">
                    <td role="cell" data-label="Candidate">{l.candidateName}<div className="muted">{l.courseOrInternship}</div></td>
                    <td role="cell" data-label="Phone">{l.phone || <span className="muted">—</span>}</td>
                    <td role="cell" data-label="Status"><span className="status-chip">{l.status.name}</span></td>
                    <td role="cell" data-label="Follow-up">
                      <FollowUp lead={l} />
                      {l.nextAction && <div className="muted clip2" title={l.nextAction}>Next: {l.nextAction}</div>}
                    </td>
                    <td role="cell" data-label="Result of this call">
                      <div className="outcome-buttons" role="group" aria-label={`Record a call to ${l.candidateName}`}>
                        {OUTCOMES.map((o) => (
                          <button key={o.key} type="button" className={`btn btn-outcome btn-outcome-${o.tone}`} aria-disabled={r.pending ? 'true' : undefined} aria-busy={r.pending ? 'true' : undefined} onClick={() => { if (!r.pending) record(l, o.key); }}>{o.label}</button>
                        ))}
                        <label className="followup-date"><span className="followup-date-label">Follow-up date</span><span className="sr-only"> for {l.candidateName}</span>
                          <input type="date" min={today} value={dates[l.id] || ''} onChange={(e) => setDates((d) => ({ ...d, [l.id]: e.target.value }))} title="Optional follow-up date, used with the Follow-up button" />
                        </label>
                      </div>
                      {r.pending && <p className="hint-inline" role="status">Saving…</p>}
                      {!r.pending && r.error && <p className="field-error" role="alert">Not saved: {r.error} {r.retry ? 'Click the same button to try again.' : ''}</p>}
                      {!r.pending && !r.error && r.last && <p className="hint-inline" role="status">{describeSaved(r.last)}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showRows && data.total > 0 && (
        <div className="pager">
          <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>Page {page} of {totalPages} · {data.total} lead{data.total === 1 ? '' : 's'}</span>
          <button type="button" className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}

      <SectionHead title="Today's calls" meta="Undo removes a call from today's count; the lead's status stays as it is." />
      {day.data && day.data.entries.length === 0 && <p className="dash-muted">No calls recorded today yet.</p>}
      {day.data && day.data.entries.length > 0 && (
        <div className="table-wrap calls-table">
          <table>
            <thead><tr><th>Time</th><th>Candidate</th><th>Result</th><th><span className="sr-only">Undo</span></th></tr></thead>
            <tbody>
              {day.data.entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatCallTime(e.calledAt)}</td><td>{e.candidateName}</td><td><span className={'badge ' + toneBadge(e.outcome)}>{outcomeLabel(e.outcome)}</span></td>
                  <td className="cell-undo">
                    {e.canUndo && (
                      <button type="button" className="btn btn-undo" disabled={Boolean(undoing[e.id] && undoing[e.id].pending)} onClick={() => undo(e)}>
                        <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 4L3 8l4 4"/><path d="M3 8h8a5 5 0 010 10H8"/></svg>
                        {undoing[e.id] && undoing[e.id].pending ? 'Removing…' : 'Undo'}
                      </button>
                    )}
                    {undoing[e.id] && undoing[e.id].error && <p className="field-error" role="alert">Not removed: {undoing[e.id].error}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
