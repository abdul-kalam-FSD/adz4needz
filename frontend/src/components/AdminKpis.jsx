import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { Attention, Kpi, KpiRow } from './DashboardParts.jsx';
import { dashboardCards, todoItems } from '../lib/admin-dashboard.js';
import { currentMonth, formatAmount } from '../lib/report-format.js';
import { shiftDay } from '../lib/report-period.js';

// "Needs attention" list and KPI cards for the admin dashboard. Every figure is fetched from the same endpoints the detail screens use; each source
// loads independently, so one failing request shows an em dash on its own card and a retry button instead of breaking the page.
export default function AdminKpis({ date }) {
  const [src, setSrc] = useState({ loading: true, calls: null, interviews: null, month: null, leads: null, interviewSummary: null, failed: [] });
  const load = useCallback(async () => {
    if (!date) return;
    setSrc((s) => ({ ...s, loading: true }));
    const names = ['calls', 'interviews', 'month', 'leads', 'interviewSummary'];
    const results = await Promise.allSettled([
      api.adminCallStats(date),
      api.adminInterviewOverview(`scheduledFrom=${date}&scheduledTo=${date}`),
      api.adminMonthlyReport(currentMonth(new Date(date + 'T12:00:00'))),
      api.adminLeadSummary(date),
      api.adminInterviewSummary(date)
    ]);
    const v = (i) => (results[i].status === 'fulfilled' ? results[i].value : null);
    setSrc({
      loading: false, calls: v(0), interviews: v(1),
      month: v(2) ? { revenue: v(2).report.total.figures.revenueReceived } : null,
      leads: v(3) ? v(3).counts : null, interviewSummary: v(4) ? v(4).counts : null,
      failed: names.filter((n, i) => results[i].status === 'rejected')
    });
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const cards = dashboardCards({ calls: src.calls, interviews: src.interviews, month: src.month });
  const todos = todoItems({ leads: src.leads, interviews: src.interviewSummary, calls: src.calls });
  const show = (c) => (c.value === null ? '—' : c.money ? '\u20B9' + formatAmount(c.value) : String(c.value));
  const incomplete = !src.loading && src.failed.length > 0;
  return (
    <>
      <Attention items={todos.map((t) => ({ key: t.key, to: t.to, count: t.count, text: t.text, cta: 'View' }))} loading={src.loading} incomplete={incomplete} />
      <section aria-label="Key figures">
        <KpiRow label="Key figures">
          {cards.map((c) => <Kpi key={c.key} label={c.label} value={show(c)} note={c.note} loading={src.loading} />)}
        </KpiRow>
        {incomplete && (
          <div className="alert alert-error" role="alert"><strong>Some figures could not be loaded.</strong> They are shown as — and are not counted as zero. <button type="button" className="btn btn-secondary" onClick={load}>Try again</button></div>
        )}
        <details className="dash-note">
          <summary>About these figures</summary>
          <p>Calls and interested leads follow the Call desk rules. Interviews are those scheduled on the chosen date. Collected is money recorded as received in {shiftDay(date, 0).slice(0, 7)}.</p>
        </details>
      </section>
    </>
  );
}
