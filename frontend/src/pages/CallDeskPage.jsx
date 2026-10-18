import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { todayValue, formatDate } from '../lib/format.js';
import { OUTCOMES, outcomeLabel, formatPercent, formatCallTime, beginAttempt, succeedAttempt, failAttempt, describeSaved, beginListLoad, finishListLoad, failListLoad, listShowsRows } from '../lib/call-desk.js';

const PAGE_SIZE = 20;

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
      <div className="page-head"><h1>Call desk</h1></div>
      <p className="hint">Click the result of each call. Every click is one call and is counted for today{day.data ? ` (${formatDate(day.data.today)})` : ''}. Calling the same person again counts as another call. The admin's daily view, the monthly report and your targets all use these calls. On a day you use the Call desk you do not need the Daily Report; if you submit both, only the Call desk calls are counted for that day.</p>

      {notice && <div className="alert alert-warning" role="status">{notice} <button type="button" className="btn-link" onClick={() => setNotice('')}>Dismiss</button></div>}

      <section aria-label="Today's numbers">
        {day.state === 'loading' && <p className="state-message">Loading today's numbers…</p>}
        {day.state === 'error' && <div className="alert alert-error" role="alert"><strong>Could not load today's numbers.</strong> {day.message} <button type="button" className="btn btn-secondary" onClick={loadDay}>Retry</button></div>}
        {day.state === 'stale' && <div className="alert alert-error" role="alert">These numbers may be out of date: {day.message} <button type="button" className="btn btn-secondary" onClick={loadDay}>Retry</button></div>}
        {stats && (
          <dl className="totals">
            <div className="total-item"><dt>Calls today</dt><dd>{stats.totalCalls}</dd></div>
            <div className="total-item"><dt>Different leads called</dt><dd>{stats.uniqueLeadsCalled}</dd></div>
            <div className="total-item"><dt>Repeat calls</dt><dd>{stats.repeatCalls}</dd></div>
            <div className="total-item"><dt>Interested leads</dt><dd>{stats.interestedLeads}</dd></div>
            <div className="total-item"><dt>Interested leads ÷ calls</dt><dd>{formatPercent(stats.conversionRate)}</dd></div>
            <div className="total-item"><dt>Interested / Not interested</dt><dd>{stats.outcomes.interested} / {stats.outcomes.notInterested}</dd></div>
            <div className="total-item"><dt>Follow-up / No response</dt><dd>{stats.outcomes.followUp} / {stats.outcomes.noResponse}</dd></div>
          </dl>
        )}
      </section>

      <form className="filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied({ q: q.trim(), statusId }); }}>
        <div className="field">
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
            <thead role="rowgroup"><tr role="row"><th role="columnheader">Candidate</th><th role="columnheader">Phone</th><th role="columnheader">Status</th><th role="columnheader">Result of this call</th></tr></thead>
            <tbody role="rowgroup">
              {data.leads.map((l) => {
                const r = rows[l.id] || {};
                return (
                  <tr key={l.id} role="row">
                    <td role="cell" data-label="Candidate">{l.candidateName}<div className="muted">{l.courseOrInternship}</div></td>
                    <td role="cell" data-label="Phone">{l.phone || <span className="muted">—</span>}</td>
                    <td role="cell" data-label="Status">{l.status.name}</td>
                    <td role="cell" data-label="Result of this call">
                      <div className="outcome-buttons" role="group" aria-label={`Record a call to ${l.candidateName}`}>
                        {OUTCOMES.map((o) => (
                          <button key={o.key} type="button" className={`btn btn-outcome btn-outcome-${o.tone}`} aria-disabled={r.pending ? 'true' : undefined} aria-busy={r.pending ? 'true' : undefined} onClick={() => { if (!r.pending) record(l, o.key); }}>{o.label}</button>
                        ))}
                        <label className="followup-date"><span className="sr-only">Follow-up date for {l.candidateName}</span>
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

      <h2 className="section-title">Today's calls</h2>
      {day.data && day.data.entries.length === 0 && <p className="state-message">No calls recorded today yet.</p>}
      {day.data && day.data.entries.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Candidate</th><th>Result</th><th><span className="sr-only">Undo</span></th></tr></thead>
            <tbody>
              {day.data.entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatCallTime(e.calledAt)}</td><td>{e.candidateName}</td><td>{outcomeLabel(e.outcome)}</td>
                  <td>
                    {e.canUndo && <button type="button" className="btn btn-secondary" disabled={Boolean(undoing[e.id] && undoing[e.id].pending)} onClick={() => undo(e)}>{undoing[e.id] && undoing[e.id].pending ? 'Removing…' : 'Undo'}</button>}
                    {undoing[e.id] && undoing[e.id].error && <p className="field-error" role="alert">Not removed: {undoing[e.id].error}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">Made a mistake? Use Undo on the call above (today only). Undo removes the call from your count but keeps a record of it; it does not change the lead's status. The <Link to="/daily-report">Daily Report</Link> is only needed for days you did not use the Call desk.</p>
    </>
  );
}
