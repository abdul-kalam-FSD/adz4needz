import { formatPercent } from './call-desk.js';
// Pure helpers for the admin dashboard cards and to-do list. They only RE-USE figures the other admin screens already show (call statistics,
// interview overview and summary, lead follow-up summary, monthly report), so a number on the dashboard cannot disagree with its own screen.
// A figure that could not be loaded is null and shown as an em dash; nothing is guessed or defaulted to zero.
// conversionRate from /admin/call-stats is a FRACTION (5 interested of 30 calls = 0.167), the same field the per-BDE table formats with
// formatPercent, so the card and the table always show the same digits. Anything that is not a finite number shows no note.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function dashboardCards({ calls, interviews, month }) {
  const t = calls && calls.totals;
  const iv = interviews && interviews.totals;
  return [
    { key: 'calls', label: 'Calls', value: t ? num(t.totalCalls) : null, note: t ? `${num(t.callsRecorded) ?? 0} of ${num(t.bdeCount) ?? 0} BDEs recorded calls` : '' },
    { key: 'interested', label: 'Interested leads', value: t ? num(t.interestedLeads) : null, note: t && num(t.conversionRate) !== null ? `${formatPercent(t.conversionRate)} of calls` : '' },
    { key: 'interviews', label: 'Interviews attended', value: iv ? `${num(iv.attended) ?? 0} of ${num(iv.scheduled) ?? 0}` : null, note: iv ? `${num(iv.attendancePending) ?? 0} not marked yet` : '' },
    { key: 'collected', label: 'Collected this month', value: month ? month.revenue : null, note: month ? 'Money recorded as received (by date paid)' : '', money: true }
  ];
}

// Items are only added when their figure was loaded AND is above zero. `to` is an existing admin route.
export function todoItems({ leads, interviews, calls }) {
  const items = [];
  const overdue = leads && num(leads.overdue);
  if (overdue > 0) items.push({ key: 'overdue', count: overdue, text: overdue === 1 ? 'follow-up is overdue' : 'follow-ups are overdue', to: '/admin/leads' });
  const unmarked = interviews && num(interviews.needsUpdate);
  if (unmarked > 0) items.push({ key: 'unmarked', count: unmarked, text: unmarked === 1 ? 'past interview is not marked' : 'past interviews are not marked', to: '/admin/interviews' });
  const idle = calls && calls.totals && num(calls.totals.noActivity);
  if (idle > 0) items.push({ key: 'idle', count: idle, text: idle === 1 ? 'BDE has no calls or report for this date' : 'BDEs have no calls or report for this date', to: '/admin/bdes' });
  return items;
}
