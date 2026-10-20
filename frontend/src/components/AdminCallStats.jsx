import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { SectionHead } from './DashboardParts.jsx';
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
      <SectionHead title="Calls and conversion by BDE" />
      {state.status === 'loading' && <p className="state-message">Loading call figures…</p>}
      {(state.status === 'error' || state.status === 'invalid') && <div className="alert alert-error" role="alert"><strong>Could not load call figures.</strong> {state.message} {state.status === 'error' && <button type="button" className="btn btn-secondary" onClick={load}>Retry</button>}</div>}
      {state.status === 'ready' && (
        <>
          <div className="table-wrap dash-table">
            {data.bdes.length === 0 ? <p className="state-message">No BDE accounts yet.</p> : (
              <table>
                <thead><tr>
                  <th>BDE</th><th>Status</th>
                  <th className="num">Total calls</th><th className="num">Different leads</th><th className="num">Interested leads</th><th className="num">Conversion</th>
                  <th className="num">Not interested</th><th className="num">Follow-up</th><th className="num">No response</th>
                </tr></thead>
                <tbody>
                  {data.bdes.map((b) => {
                    const st = STATUS[b.status] || { label: b.status, cls: '' };
                    return (
                      <tr key={b.id}>
                        <td><Link to={`/admin/bdes/${b.id}`}>{b.name}</Link><div className="muted">{b.employeeId} · Last call {b.lastActivityAt ? formatCallTime(b.lastActivityAt) : '—'}</div></td>
                        <td><span className={'badge ' + st.cls}>{st.label}</span>{b.source === 'call_log' && b.manualReport && <div className="muted">Manual report also entered: {b.manualReport.totalCalls} calls</div>}</td>
                        <td className="num">{cell(b.totalCalls)}</td><td className="num">{cell(b.uniqueLeadsCalled)}</td><td className="num">{cell(b.interestedLeads)}</td><td className="num">{formatPercent(b.conversionRate)}</td>
                        <td className="num">{cell(b.notInterested)}</td><td className="num">{cell(b.followUpRequired)}</td><td className="num">{cell(b.noResponse)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Team total</td>
                    <td>{t.callsRecorded} of {t.bdeCount} recorded<div className="muted">{t.manualOnly} manual · {t.noActivity} none</div></td>
                    <td className="num">{t.totalCalls}</td><td className="num dash-blank" />
                    <td className="num">{t.interestedLeads}</td><td className="num">{formatPercent(t.conversionRate)}</td>
                    <td className="dash-blank" colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
          <details className="dash-note">
            <summary>How these are calculated</summary>
            <p>Conversion = interested leads ÷ total calls. Every call counts, including repeat calls to the same lead; a lead is interested only if its latest call of the day was Interested. A BDE with only a manual report has no per-lead data, so the typed interested figure is used and Different leads is blank. Nothing here is locked: a BDE can still add calls to today.</p>
          </details>
        </>
      )}
    </section>
  );
}
