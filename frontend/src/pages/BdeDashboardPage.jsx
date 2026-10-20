import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';
import { Attention, Card, Kpi, KpiRow, Metrics, SectionHead, rupees } from '../components/DashboardParts.jsx';
import { attentionItems, reportForDay, todayLocal } from '../lib/dashboard.js';
import { barWidth, currentMonth, formatCount, formatPercent as formatAchieved } from '../lib/report-format.js';
import { formatPercent } from '../lib/call-desk.js';

// Every number here is read from the existing APIs (daily reports, lead/interview/payment summaries, monthly report). Each block loads
// independently, so one failing request shows its own error and does not blank the rest of the page.
function useBlock(load) {
  const [s, setS] = useState({ loading: true, error: '', data: null });
  const run = useCallback(async () => {
    setS((x) => ({ ...x, loading: true, error: '' }));
    try { setS({ loading: false, error: '', data: await load() }); } catch (err) { setS({ loading: false, error: err.message || 'Something went wrong.', data: null }); }
  }, [load]);
  useEffect(() => { run(); }, [run]);
  return [s, run];
}

// Achieved % of a monthly target, with the same progress bar the monthly screens use. No target = em dash and no bar.
function Achieved({ pct, label }) {
  return (
    <div>
      <div className="progress-value">{formatAchieved(pct)}</div>
      {pct !== null && pct !== undefined && (
        <div className="progress" role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(pct, 100)}>
          <div className={'progress-bar' + (pct >= 100 ? ' is-complete' : '')} style={{ width: barWidth(pct) + '%' }} />
        </div>
      )}
    </div>
  );
}

export default function BdeDashboardPage() {
  const today = todayLocal();
  const month = currentMonth();
  const [reports, rReports] = useBlock(useCallback(() => api.listDailyReports().then((d) => d.reports), []));
  const [calls, rCalls] = useBlock(useCallback(() => api.callSummary(), []));
  const [leads, rLeads] = useBlock(useCallback(() => api.leadSummary(today), [today]));
  const [interviews, rInterviews] = useBlock(useCallback(() => api.interviewSummary(today), [today]));
  const [payments, rPayments] = useBlock(useCallback(() => api.paymentSummary(''), []));
  const [monthly, rMonthly] = useBlock(useCallback(() => api.monthlyReport(month).then((d) => d.report), [month]));

  const todays = reports.data ? reportForDay(reports.data, today) : null;
  // A day with Call-desk calls needs no manual report: the admin views and the monthly report use the Call desk calls for that day.
  const callStats = calls.data ? calls.data.stats : null;
  const callsToday = callStats ? callStats.totalCalls : 0;
  const items = attentionItems({
    followUps: leads.data && leads.data.counts, interviews: interviews.data && interviews.data.counts, proofs: payments.data && payments.data.proofs,
    reportSubmitted: reports.data ? Boolean(todays) || callsToday > 0 : undefined
  });
  const me = monthly.data && monthly.data.bdes[0];
  const t = payments.data && payments.data.totals;

  const anyLoading = reports.loading || leads.loading || interviews.loading || payments.loading;
  const anyFailed = Boolean(reports.error || leads.error || interviews.error || payments.error);
  const noTargets = me && Object.values(me.targets).every((v) => v === null);
  const monthRows = me ? [
    ['Calls', me.figures.calls.total, formatCount(me.targets.calls), me.achievement.calls],
    ['Interested leads', me.figures.calls.interested, formatCount(me.targets.interested), me.achievement.interested],
    ['Interviews scheduled', me.figures.interviews.scheduled, formatCount(me.targets.interviews), me.achievement.interviews],
    ['Revenue received', rupees(me.figures.revenueReceived), rupees(me.targets.revenue), me.achievement.revenue]
  ] : [];

  return (
    <>
      <PageHeader
        title="Dashboard"
        actions={<><Link className="btn btn-secondary" to="/daily-report">Daily report</Link><Link className="btn btn-primary" to="/call-desk">Call desk</Link></>}
      />

      <Attention items={items} loading={anyLoading} incomplete={anyFailed} />

      <KpiRow label="Key figures">
        <Kpi label="Calls today" loading={calls.loading} error={calls.error} onRetry={rCalls}
          value={callsToday}
          note={callsToday > 0 ? `${callStats.interestedLeads} interested \u00B7 ${formatPercent(callStats.conversionRate)} of calls` : 'None recorded yet'}
          to="/call-desk" cta="Call desk" />
        <Kpi label="Overdue follow-ups" loading={leads.loading} error={leads.error} onRetry={rLeads}
          value={leads.data ? leads.data.counts.overdue : 0} alert={Boolean(leads.data && leads.data.counts.overdue > 0)}
          note={leads.data ? `${leads.data.counts.today} due today \u00B7 ${leads.data.counts.upcoming} in next ${leads.data.upcomingDays} days` : ''}
          to="/leads" cta="Leads" />
        <Kpi label="Interviews today" loading={interviews.loading} error={interviews.error} onRetry={rInterviews}
          value={interviews.data ? interviews.data.counts.today : 0}
          note={interviews.data ? `${interviews.data.counts.upcoming} upcoming \u00B7 ${interviews.data.counts.needsUpdate} to update` : ''}
          to="/interviews" cta="Interviews" />
        <Kpi label="Payments outstanding" loading={payments.loading} error={payments.error} onRetry={rPayments}
          value={t ? rupees(t.outstanding) : '\u2014'}
          note={t ? `${rupees(t.received)} received of ${rupees(t.committed)}` : ''}
          to="/payments" cta="Payments" />
      </KpiRow>

      <div className="dash-stack">
        <Card title="Daily report" state={reports} retry={rReports}
          status={todays ? <span className="badge badge-success">Submitted</span> : callsToday > 0 ? <span className="badge badge-upcoming">Counted from Call desk</span> : <span className="badge badge-today">Not submitted</span>}
          meta={todays ? <Link className="kpi-link" to="/daily-report">View reports</Link> : callsToday > 0 ? <Link className="kpi-link" to="/daily-report">Manual report</Link> : <Link className="kpi-link" to="/daily-report">Submit today's report</Link>}>
          {todays ? <Metrics items={[['Calls', todays.totalCalls], ['Interested', todays.interested], ['Not interested', todays.notInterested], ['Follow-up', todays.followUpRequired], ['No response', todays.noResponse]]} />
            : callsToday > 0 ? <p className="dash-muted">No manual report is needed today.</p> : null}
        </Card>

        <Card title="Payments" meta={<><span>All time</span><Link className="kpi-link" to="/payments">Open payments</Link></>} state={payments} retry={rPayments}>
          {t && (
            <div className="dash-groups">
              <Metrics caption="Totals" items={[['Commitments', t.payments], ['Committed', rupees(t.committed)], ['Received', rupees(t.received)]]} />
              <Metrics caption="Payment status" items={[['Pending', t.pending], ['Partially paid', t.partiallyPaid], ['Paid', t.paid]]} />
              <Metrics caption="Payment proofs" items={[['Awaiting review', payments.data.proofs.awaitingReview], ['Approved', payments.data.proofs.approved], ['Rejected', payments.data.proofs.rejected]]} />
            </div>
          )}
        </Card>
      </div>

      <section aria-label="This month">
        <SectionHead title="This month" meta={<>{monthly.data ? <span>{monthly.data.label}</span> : null}{' '}<Link className="kpi-link" to="/monthly">Open My Month</Link></>} />
        {monthly.loading && <p className="dash-muted" role="status">Loading…</p>}
        {monthly.error && <div className="alert alert-error" role="alert"><p>{monthly.error}</p><button type="button" className="btn btn-secondary" onClick={rMonthly}>Try again</button></div>}
        {!monthly.loading && !monthly.error && (!me ? <p className="dash-muted">No activity recorded for {monthly.data ? monthly.data.label : 'this month'} yet.</p> : (
          <div className="table-wrap dash-table dash-table-month">
            <table>
              <caption className="sr-only">Monthly actual figures against targets. Achieved percentages are calculated.</caption>
              <thead><tr><th>Metric</th><th className="num">Actual</th><th className="num">Target</th><th>Achieved</th></tr></thead>
              <tbody>
                {monthRows.map(([label, actual, target, pct]) => (
                  <tr key={label}>
                    <td>{label}</td><td className="num">{actual}</td><td className="num">{target}</td>
                    <td><Achieved pct={pct} label={`${label} achieved`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {!monthly.loading && !monthly.error && noTargets && <p className="dash-muted dash-after">No targets set this month.</p>}
      </section>
    </>
  );
}
