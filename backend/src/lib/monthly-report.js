// Pure logic for the monthly report: month ranges, exact money arithmetic, target validation, and shaping of database rows into the
// API response. No I/O. Every figure is tagged by where it comes from:
//   figures      = sums/counts read straight from the database for the month ("database")
//   targets      = what an admin typed in ("target")
//   achievement  = figures divided by targets ("calculated")
//   calculated   = other derived ratios ("calculated")
import { parseMoney } from './money.js';
import { conversionPercent } from './call-log.js';

export const MONTH_RE = /^(20\d{2})-(0[1-9]|1[0-2])$/;
export const MAX_TARGET_COUNT = 1_000_000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// 'YYYY-MM' -> { month, start:'YYYY-MM-01', endExclusive:'first day of next month', startTs, endTs ('... 00:00:00'), label, days } | null
export function parseMonth(text) {
  const m = typeof text === 'string' ? MONTH_RE.exec(text) : null;
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]);
  const next = new Date(Date.UTC(y, mo, 1)); // month index mo = next month
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const start = `${m[1]}-${m[2]}-01`;
  return { month: text, start, endExclusive: end, startTs: `${start} 00:00:00`, endTs: `${end} 00:00:00`, label: `${MONTH_NAMES[mo - 1]} ${y}`, days: new Date(Date.UTC(y, mo, 0)).getUTCDate() };
}

// ---- exact money (BigInt paise) ----
export function toPaise(v) { // DECIMAL string "12500.50" / number / null -> BigInt (0n when empty)
  if (v === null || v === undefined || v === '') return 0n;
  const t = String(v).trim();
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) throw new Error('Not a money value: ' + t);
  return BigInt(m[1]) * 100n + BigInt((m[2] || '').padEnd(2, '0'));
}
export function paiseText(p) {
  const s = p.toString().padStart(3, '0');
  return s.slice(0, -2) + '.' + s.slice(-2);
}
// actual/target as a percentage with one decimal (floor), not capped (110.0 means 10% over target). null when there is no target.
export function percentOf(actual, target) {
  const a = typeof actual === 'bigint' ? actual : BigInt(Math.trunc(Number(actual) || 0));
  const t = typeof target === 'bigint' ? target : BigInt(Math.trunc(Number(target) || 0));
  if (t <= 0n) return null;
  return Number((a * 1000n) / t) / 10;
}

const toInt = (v) => Number(v ?? 0) || 0;

// ---- target input (admin) ----
const COUNT_FIELDS = [['targetCalls', 'Calls target'], ['targetInterested', 'Interested target'], ['targetInterviews', 'Interviews target']];
// Each value: undefined/null/'' => no target; otherwise non-negative integer (counts) or a positive amount with up to 2 decimals (revenue).
export function validateTargets(body) {
  const errors = {}; const value = {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: { _form: 'Request body must be a JSON object.' }, value };
  for (const [key, label] of COUNT_FIELDS) {
    const v = body[key];
    if (v === undefined || v === null || v === '') { value[key] = null; continue; }
    const n = typeof v === 'string' && /^\d{1,7}$/.test(v.trim()) ? Number(v.trim()) : v;
    if (!Number.isInteger(n) || n < 0 || n > MAX_TARGET_COUNT) errors[key] = `${label} must be a whole number between 0 and ${MAX_TARGET_COUNT}.`;
    else value[key] = n;
  }
  const r = body.targetRevenue;
  if (r === undefined || r === null || r === '') value.targetRevenue = null;
  else {
    const p = parseMoney(r);
    if (p === null) errors.targetRevenue = 'Revenue target must be an amount greater than 0 with at most 2 decimals (for example 50000 or 50000.50).';
    else value.targetRevenue = paiseText(p);
  }
  return { ok: Object.keys(errors).length === 0, errors, value };
}

// ---- shaping ----
// row = one SELECT row from the repository (see monthly-report.repository.js for the column list).
export function shapeBdeRow(row) {
  const calls = toInt(row.total_calls); const interested = toInt(row.interested);
  const received = toPaise(row.received); const committed = toPaise(row.committed);
  const targets = {
    calls: row.target_calls === null || row.target_calls === undefined ? null : toInt(row.target_calls),
    interested: row.target_interested === null || row.target_interested === undefined ? null : toInt(row.target_interested),
    interviews: row.target_interviews === null || row.target_interviews === undefined ? null : toInt(row.target_interviews),
    revenue: row.target_revenue === null || row.target_revenue === undefined ? null : paiseText(toPaise(row.target_revenue))
  };
  const figures = {
    // interested = INTERESTED LEADS (the figure the interested target is measured against); interestedCalls = calls that ended interested.
    // A row without the call-log columns (older callers/tests) is treated as manual-only: every reported day counts as a manual day.
    calls: {
      total: calls, interested, notInterested: toInt(row.not_interested), followUpRequired: toInt(row.follow_up_required), noResponse: toInt(row.no_response), daysReported: toInt(row.days_reported),
      interestedCalls: row.interested_calls === undefined || row.interested_calls === null ? interested : toInt(row.interested_calls),
      distinctLeads: toInt(row.distinct_leads), repeatCalls: toInt(row.repeat_calls),
      sources: {
        callLogDays: toInt(row.call_log_days), manualOnlyDays: row.manual_only_days === undefined || row.manual_only_days === null ? toInt(row.days_reported) : toInt(row.manual_only_days),
        mixedDays: toInt(row.mixed_days), callLogCalls: toInt(row.call_log_calls), manualCalls: row.manual_calls === undefined || row.manual_calls === null ? calls : toInt(row.manual_calls),
        manualIgnoredCalls: toInt(row.manual_ignored_calls)
      }
    },
    leadsCreated: toInt(row.leads_created),
    interviews: { scheduled: toInt(row.interviews_scheduled), attended: toInt(row.interviews_attended), didNotAttend: toInt(row.interviews_no_show), selected: toInt(row.interviews_selected) },
    payments: { commitments: toInt(row.commitments), committedAmount: paiseText(committed) },
    revenueReceived: paiseText(received)
  };
  return { id: Number(row.id), employeeId: row.employee_id, name: row.name, isActive: Boolean(row.is_active), figures, targets, achievement: achievement(figures, targets, received), calculated: ratios(figures) };
}

function achievement(f, t, received) {
  return {
    calls: percentOf(f.calls.total, t.calls),
    interested: percentOf(f.calls.interested, t.interested),
    interviews: percentOf(f.interviews.scheduled, t.interviews),
    revenue: t.revenue === null ? null : percentOf(received, toPaise(t.revenue))
  };
}
function ratios(f) {
  return {
    // conversion = interested leads / total calls, ONE shared definition (conversionPercent in call-log.js); same digits as the daily screens.
    interestedPercentOfCalls: conversionPercent(f.calls.interested, f.calls.total),
    averageCallsPerReportedDay: f.calls.daysReported > 0 ? Math.floor((f.calls.total * 10) / f.calls.daysReported) / 10 : null
  };
}

// Team totals: figures are the sum of the BDE rows; the team target is the sum of the targets that were actually set.
export function buildMonthlyReport(monthInfo, rows) {
  const bdes = rows.map(shapeBdeRow);
  const sum = (pick) => bdes.reduce((a, b) => a + pick(b), 0);
  const paise = (pick) => bdes.reduce((a, b) => a + toPaise(pick(b)), 0n);
  const figures = {
    calls: {
      total: sum((b) => b.figures.calls.total), interested: sum((b) => b.figures.calls.interested), notInterested: sum((b) => b.figures.calls.notInterested),
      followUpRequired: sum((b) => b.figures.calls.followUpRequired), noResponse: sum((b) => b.figures.calls.noResponse), daysReported: sum((b) => b.figures.calls.daysReported),
      interestedCalls: sum((b) => b.figures.calls.interestedCalls), distinctLeads: sum((b) => b.figures.calls.distinctLeads), repeatCalls: sum((b) => b.figures.calls.repeatCalls),
      sources: {
        callLogDays: sum((b) => b.figures.calls.sources.callLogDays), manualOnlyDays: sum((b) => b.figures.calls.sources.manualOnlyDays), mixedDays: sum((b) => b.figures.calls.sources.mixedDays),
        callLogCalls: sum((b) => b.figures.calls.sources.callLogCalls), manualCalls: sum((b) => b.figures.calls.sources.manualCalls), manualIgnoredCalls: sum((b) => b.figures.calls.sources.manualIgnoredCalls)
      }
    },
    leadsCreated: sum((b) => b.figures.leadsCreated),
    interviews: { scheduled: sum((b) => b.figures.interviews.scheduled), attended: sum((b) => b.figures.interviews.attended), didNotAttend: sum((b) => b.figures.interviews.didNotAttend), selected: sum((b) => b.figures.interviews.selected) },
    payments: { commitments: sum((b) => b.figures.payments.commitments), committedAmount: paiseText(paise((b) => b.figures.payments.committedAmount)) },
    revenueReceived: paiseText(paise((b) => b.figures.revenueReceived))
  };
  const tsum = (k) => { const set = bdes.filter((b) => b.targets[k] !== null); return set.length ? set.reduce((a, b) => a + b.targets[k], 0) : null; };
  const trev = bdes.filter((b) => b.targets.revenue !== null);
  const targets = { calls: tsum('calls'), interested: tsum('interested'), interviews: tsum('interviews'), revenue: trev.length ? paiseText(trev.reduce((a, b) => a + toPaise(b.targets.revenue), 0n)) : null };
  const total = { figures, targets, achievement: achievement(figures, targets, toPaise(figures.revenueReceived)), calculated: ratios(figures), bdesWithTargets: bdes.filter((b) => Object.values(b.targets).some((v) => v !== null)).length };
  return {
    month: monthInfo.month, label: monthInfo.label, from: monthInfo.start, toExclusive: monthInfo.endExclusive, kind: monthInfo.kind || 'month', title: monthInfo.title || 'Monthly report', bdes, total,
    basis: {
      figures: 'Counts and sums read from the database for this month.',
      calls: 'Calls come from the Call desk (one record per call) and from manual daily calling reports, decided PER BDE PER DAY: a day with Call-desk calls uses them and its manual report is ignored (never added); a day with only a manual report uses the typed figures. Dates are working dates (see REPORT_UTC_OFFSET_MINUTES).',
      interested: 'Interested = interested LEADS: leads whose latest call in the month was Interested (each lead counted once per month), plus the typed interested number of manual-only days (those carry no lead identity, so they cannot be de-duplicated).',
      conversion: 'Conversion = interested leads / total calls, as a percentage rounded to one decimal. Every call counts, including repeat calls to the same lead. Empty when there were no calls.',
      distinctLeads: 'Distinct leads = different leads called on Call-desk days of the month (manual days carry no lead data). Repeat calls = Call-desk calls minus distinct leads.',
      leadsCreated: 'Leads added in the month (created time, UTC).',
      interviews: 'Interviews scheduled in the month (by scheduled date).',
      payments: 'Commitments are placed by commitment date.',
      revenueReceived: 'Money actually recorded as received (instalments), placed by the date paid. This is the revenue figure.',
      targets: 'Entered by an admin. Empty means no target was set.',
      achievement: 'CALCULATED = figure / target x 100. Can exceed 100. Empty when no target is set.'
    }
  };
}
