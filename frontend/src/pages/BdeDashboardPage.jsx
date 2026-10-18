import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { FigureCards, TargetTable } from '../components/MonthlyFigures.jsx';
import { attentionItems, reportForDay, todayLocal } from '../lib/dashboard.js';
import { currentMonth, formatAmount } from '../lib/report-format.js';
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

function Block({ title, state, retry, children }) {
  return (
    <section className="panel" aria-label={title}>
      <h2>{title}</h2>
      {state.loading && <p role="status">Loading…</p>}
      {state.error && <div className="alert alert-error" role="alert"><p>{state.error}</p><button type="button" className="btn btn-secondary" onClick={retry}>Try again</button></div>}
      {!state.loading && !state.error && children}
    </section>
  );
}

export default function BdeDashboardPage() {
  const { user } = useAuth();
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

  return (
    <>
      <h1>Dashboard</h1>
      <p className="hint">Welcome, {user.name}. Everything below is read live from your own records.</p>

      <section className="panel panel-attention" aria-label="Needs attention">
        <h2>Needs attention</h2>
        {items.length === 0 ? <p>{reports.loading || leads.loading || interviews.loading || payments.loading ? 'Checking…' : 'Nothing needs attention right now.'}</p> : (
          <ul>{items.map((i) => <li key={i.key}>{i.text} <Link to={i.to}>{i.cta}</Link></li>)}</ul>
        )}
      </section>

      <Block title="Today's calls (Call desk)" state={calls} retry={rCalls}>
        {callStats && (callsToday > 0
          ? <p><strong>{callsToday}</strong> call{callsToday === 1 ? '' : 's'} recorded today: {callStats.interestedLeads} interested lead{callStats.interestedLeads === 1 ? '' : 's'} ({formatPercent(callStats.conversionRate)} of calls). <Link to="/call-desk">Open Call desk</Link></p>
          : <p>No calls recorded on the Call desk today yet. <Link to="/call-desk">Open Call desk</Link></p>)}
      </Block>

      <Block title="Today's calling report" state={reports} retry={rReports}>
        {todays ? (
          <p>Submitted: {todays.totalCalls} calls — {todays.interested} interested, {todays.notInterested} not interested, {todays.followUpRequired} follow-up, {todays.noResponse} no response. <Link to="/daily-report">View reports</Link></p>
        ) : callsToday > 0 ? <p>No manual report is needed today: your Call desk calls are counted. <Link to="/daily-report">Manual report</Link></p>
          : <p>No report submitted for today yet. <Link to="/daily-report">Submit today's report</Link></p>}
      </Block>

      <Block title="Follow-ups" state={leads} retry={rLeads}>
        {leads.data && <p><strong>{leads.data.counts.overdue}</strong> overdue, <strong>{leads.data.counts.today}</strong> due today, <strong>{leads.data.counts.upcoming}</strong> in the next {leads.data.upcomingDays} days. <Link to="/leads">Open leads</Link></p>}
      </Block>

      <Block title="Interviews" state={interviews} retry={rInterviews}>
        {interviews.data && <p><strong>{interviews.data.counts.today}</strong> today, <strong>{interviews.data.counts.upcoming}</strong> upcoming, <strong>{interviews.data.counts.needsUpdate}</strong> past and not yet updated. <Link to="/interviews">Open interviews</Link></p>}
      </Block>

      <Block title="Payments (all time)" state={payments} retry={rPayments}>
        {t && (
          <>
            <p>{t.payments} commitment(s) worth {formatAmount(t.committed)}; {formatAmount(t.received)} received; {formatAmount(t.outstanding)} outstanding. {t.pending} pending, {t.partiallyPaid} partially paid, {t.paid} paid. <Link to="/payments">Open payments</Link></p>
            <p>Payment proofs: {payments.data.proofs.awaitingReview} awaiting review, {payments.data.proofs.approved} approved, {payments.data.proofs.rejected} rejected.</p>
          </>
        )}
      </Block>

      <Block title="This month" state={monthly} retry={rMonthly}>
        {!me ? <p>No activity recorded for {monthly.data ? monthly.data.label : 'this month'} yet.</p> : (
          <>
            <FigureCards block={me} />
            {Object.values(me.targets).some((v) => v !== null) ? <TargetTable rows={[me]} /> : <p className="hint">No target has been set for you this month.</p>}
            <p><Link to="/monthly">Open My Month</Link></p>
          </>
        )}
      </Block>
    </>
  );
}
