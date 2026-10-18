// Date-range reports (Day / Week / Month / Custom). Pure: no I/O, no clock, no timezone guess.
// The browser sends explicit YYYY-MM-DD dates (the admin's own "today" decides what Day/Week mean), exactly like the daily overview does.
// The returned object has the same shape as parseMonth() so the existing report query and builder can be reused unchanged;
// targetMonthStart is null because targets belong to whole months, so a range report shows no target columns.
import { addDays } from './dates.js';
import { isRealDate } from './validate-daily-report.js';

export const MAX_RANGE_DAYS = 366;
const dayCount = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;

// -> { ok:true, value } | { ok:false, errors }
export function parseRange(from, to) {
  const errors = {};
  if (!isRealDate(from)) errors.from = 'Choose a valid start date.';
  if (!isRealDate(to)) errors.to = 'Choose a valid end date.';
  if (Object.keys(errors).length) return { ok: false, errors };
  if (from < '2020-01-01') errors.from = 'The start date must be 2020 or later.';
  if (to < from) errors.to = 'The end date must not be before the start date.';
  else if (dayCount(from, to) > MAX_RANGE_DAYS) errors.to = `A report can cover at most ${MAX_RANGE_DAYS} days.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  const endExclusive = addDays(to, 1);
  const days = dayCount(from, to);
  return {
    ok: true,
    value: {
      month: `${from}_to_${to}`, start: from, endExclusive, startTs: `${from} 00:00:00`, endTs: `${endExclusive} 00:00:00`,
      label: from === to ? from : `${from} to ${to}`, days, targetMonthStart: null, kind: 'range', title: from === to ? 'Daily report' : 'Report'
    }
  };
}
