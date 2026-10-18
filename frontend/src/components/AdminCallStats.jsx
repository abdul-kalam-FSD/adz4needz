import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { formatPercent, formatCallTime } from '../lib/call-desk.js';

const cell = (v) => (v === null || v === undefined ? '—' : v);
const STATUS = {
  calls_recorded: { label: 'Calls recorded', cls: 'badge-upcoming' },
  manual_report: { label: 'Manual report', cls: 'badge-today' },
  no_activity: { label: 'No activity', cls: 'badge-overdue' }
};

// Per-BDE calls for one day. Read-only. "Calls recorded" = taken from the Call desk; "Manual report" = typed Daily Calling Report
// (used only when the BDE has no Call-desk calls that day); the two are never added together.
export default function AdminCallStats({ date }) {
  const [state, setState] = useState({ status: 'loading', data: null, message: '' });
  const load = useCallback(async () => {
    if (!date) { setState({ status: 'invalid', data: null, message: 'Choose a date.' }); return; }
    setState((s) => ({ ...s, status: 'loading' }));
    try { setState({ status: 'ready', data: await api.adminCallStats(date), message: '' }); }
    catch (err) { setState({ status: 'error', data: null, message: err.message }); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const data = state.data; const t = data && data.totals;
  return (
    <section aria-label="Calls and conversion by BDE">
      <h2 className="section-title">Calls and conversion by BDE</h2>
      {state.status === 'loading' && <p className="state-message">Loading call figures…</p>}
      {(state.status === 'error' || state.status === 'invalid') && <div className="alert alert-error" role="alert"><strong>Could not load call figures.</strong> {state.message} {state.status === 'error' && <button type="button" className="btn btn-secondary" onClick={load}>Retry</button>}</div>}
      {state.status === 'ready' && (
        <>
          <dl className="totals">
            <div className="total-item"><dt>BDEs with calls recorded</dt><dd>{t.callsRecorded} of {t.bdeCount}</dd></div>
            <div className="total-item"><dt>Manual report only</dt><dd>{t.manualOnly}</dd></div>
            <div className="total-item"><dt>No activity</dt><dd>{t.noActivity}</dd></div>
            <div className="total-item"><dt>Total calls</dt><dd>{t.totalCalls}</dd></div>
            <div className="total-item"><dt>Interested leads</dt><dd>{t.interestedLeads}</dd></div>
            <div className="total-item"><dt>Interested leads ÷ calls</dt><dd>{formatPercent(t.conversionRate)}</dd></div>
          </dl>
          <div className="table-wrap">
            {data.bdes.length === 0 ? <p className="state-message">No BDE accounts yet.</p> : (
              <table>
                <thead><tr>
                  <th>BDE</th><th>Employee ID</th><th>Status</th>
                  <th className="num">Total calls</th><th className="num">Different leads</th><th className="num">Interested leads</th><th className="num">Conversion</th>
                  <th className="num">Not interested</th><th className="num">Follow-up</th><th className="num">No response</th><th>Last call</th>
                </tr></thead>
                <tbody>
                  {data.bdes.map((b) => {
                    const st = STATUS[b.status] || { label: b.status, cls: '' };
                    return (
                      <tr key={b.id}>
                        <td><Link to={`/admin/bdes/${b.id}`}>{b.name}</Link></td><td>{b.employeeId}</td>
                        <td><span className={'badge ' + st.cls}>{st.label}</span>{b.source === 'call_log' && b.manualReport && <div className="muted">Manual report also entered: {b.manualReport.totalCalls} calls</div>}</td>
                        <td className="num">{cell(b.totalCalls)}</td><td className="num">{cell(b.uniqueLeadsCalled)}</td><td className="num">{cell(b.interestedLeads)}</td><td className="num">{formatPercent(b.conversionRate)}</td>
                        <td className="num">{cell(b.notInterested)}</td><td className="num">{cell(b.followUpRequired)}</td><td className="num">{cell(b.noResponse)}</td>
                        <td>{b.lastActivityAt ? formatCallTime(b.lastActivityAt) : <span className="muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <p className="hint">Conversion = interested leads ÷ total calls. Every call counts, including repeat calls to the same lead; a lead counts as interested only if its latest call of the day was Interested. For a BDE with only a manual report there is no per-lead data, so the typed "interested" figure is used and "Different leads" is blank. Nothing here is locked: a BDE can still add calls to today's figures.</p>
        </>
      )}
    </section>
  );
}
