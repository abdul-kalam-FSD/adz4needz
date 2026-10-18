// Display helpers for the monthly report screens (pure, unit-tested).
import { fromDecimalString, formatMoney } from './money.js';

export const MONTH_RE = /^20\d{2}-(0[1-9]|1[0-2])$/;

// Current month as YYYY-MM from the browser's local clock (the server defaults to UTC; the screen always sends this explicitly).
export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
export function shiftMonth(month, delta) {
  if (!MONTH_RE.test(month)) return month;
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const out = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return MONTH_RE.test(out) ? out : month; // never leave the supported range (2000s)
}
// Calculated percentages arrive as numbers or null.
export const formatPercent = (p) => (p === null || p === undefined ? '—' : `${p}%`);
export const formatCount = (n) => (n === null || n === undefined ? '—' : String(n));
export const formatAmount = (text) => (text === null || text === undefined ? '—' : formatMoney(fromDecimalString(text)));
// Progress bar width: clamped to 0..100 (the real percentage is still shown as text and may exceed 100).
export const barWidth = (p) => (p === null || p === undefined ? 0 : Math.max(0, Math.min(100, p)));

// Form text -> API value. Blank = no target. Returns { value } or { error }.
export function targetInput(text, kind) {
  const t = String(text ?? '').trim();
  if (t === '') return { value: null };
  if (kind === 'count') return /^\d{1,7}$/.test(t) ? { value: Number(t) } : { error: 'Enter a whole number.' };
  return /^\d{1,10}(\.\d{1,2})?$/.test(t) && Number(t) > 0 ? { value: t } : { error: 'Enter an amount greater than 0 (up to 2 decimals).' };
}

// ---- calling figures: where the numbers came from (Checkpoint 6) ----
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// "3 days with activity: 2 from the Call desk, 1 from a manual report. 1 day had both (the manual report was ignored)."
export function callSourceNote(calls) {
  const d = calls.daysReported || 0;
  if (d === 0) return 'No days with activity';
  const s = calls.sources || { callLogDays: 0, manualOnlyDays: d, mixedDays: 0 };
  let t = `${plural(d, 'day', 'days')} with activity: ${s.callLogDays} from the Call desk, ${s.manualOnlyDays} from a manual report`;
  if (s.mixedDays > 0) t += `. ${plural(s.mixedDays, 'day', 'days')} had both (the manual report was ignored, not added)`;
  return t;
}
// Distinct leads exist only for Call-desk days; the note says so instead of showing a misleading 0.
export function distinctLeadsNote(calls) {
  const s = calls.sources || { callLogDays: 0 };
  if (!s.callLogDays) return 'Call desk days only; none this month';
  return `${plural(calls.repeatCalls || 0, 'repeat call', 'repeat calls')}; Call desk days only`;
}
