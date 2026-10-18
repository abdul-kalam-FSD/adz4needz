// Day / Week / Month / Custom choices for the admin report. Pure: the caller passes "today" (the admin's own calendar date).
// Week = Monday to Sunday of the week that contains today (a week that is still running is shown in full; days after today simply have no activity).
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const parts = (t) => t.split('-').map(Number);
const addDays = (t, n) => { const [y, m, d] = parts(t); const dt = new Date(Date.UTC(y, m - 1, d + n)); return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); };
const weekday = (t) => { const [y, m, d] = parts(t); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }; // 0 = Sunday

export const PERIODS = ['day', 'week', 'month', 'custom'];

export function periodRange(kind, today) {
  if (kind === 'day') return { from: today, to: today };
  if (kind === 'week') { const back = (weekday(today) + 6) % 7; const from = addDays(today, -back); return { from, to: addDays(from, 6) }; }
  if (kind === 'month') { const [y, m] = parts(today); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: iso(y, m, 1), to: iso(y, m, last) }; }
  return null; // custom: the user picks both dates
}
export const shiftDay = addDays;

// Message for the custom picker, or '' when the range is fine. Mirrors the server rules (the server stays the authority).
export function rangeProblem(from, to, maxDays = 366) {
  const ok = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || '');
  if (!ok(from) || !ok(to)) return 'Choose both dates.';
  if (to < from) return 'The end date must not be before the start date.';
  const days = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
  return days > maxDays ? `Choose at most ${maxDays} days.` : '';
}
