import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { dashboardCards, todoItems } from '../lib/admin-dashboard.js';
import { currentMonth, formatAmount } from '../lib/report-format.js';
import { shiftDay } from '../lib/report-period.js';

// KPI cards and the to-do list for the admin dashboard. Every figure is fetched from the same endpoints the detail screens use; each source
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
  const allLoaded = !src.loading && src.failed.length === 0;
  return (
    <section aria-label="Key figures">
      <dl className="totals">
        {cards.map((c) => (
          <div className="total-item" key={c.key}><dt>{c.label}</dt><dd>{src.loading ? '…' : show(c)}</dd>{!src.loading && c.note && <dd className="muted">{c.note}</dd>}</div>
        ))}
      </dl>
      {src.failed.length > 0 && !src.loading && (
        <div className="alert alert-error" role="alert"><strong>Some figures could not be loaded.</strong> They are shown as — and are not counted as zero. <button type="button" className="btn btn-secondary" onClick={load}>Try again</button></div>
      )}
      <h2 className="section-title">To do</h2>
      {src.loading && <p className="state-message">Loading…</p>}
      {allLoaded && todos.length === 0 && <p className="state-message">Nothing needs attention for {date}.</p>}
      {!src.loading && todos.length > 0 && (
        <ul className="todo-list">
          {todos.map((t) => <li key={t.key}><Link to={t.to}><strong>{t.count}</strong> {t.text}</Link></li>)}
        </ul>
      )}
      <p className="hint">Calls and interested leads follow the Call desk rules shown in the table below. Interviews are those scheduled on the chosen date. Collected is money recorded as received this month ({shiftDay(date, 0).slice(0, 7)}).</p>
    </section>
  );
}
