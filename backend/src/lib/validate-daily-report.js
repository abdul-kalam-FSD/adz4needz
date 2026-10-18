// Server-side validation (the real one). Same rules are mirrored in the frontend for quick feedback.
// Only checks each field on its own. It does NOT require the categories to add up to total calls.
const MAX_COUNT = 4294967295; // database column limit (INT UNSIGNED)

export const COUNT_FIELDS = [
  { key: 'totalCalls', label: 'Total calls made' },
  { key: 'interested', label: 'Interested candidates' },
  { key: 'notInterested', label: 'Not interested candidates' },
  { key: 'followUpRequired', label: 'Follow-up required' },
  { key: 'noResponse', label: 'No response / not reachable' }
];

export function isRealDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parseCount(raw, label) {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return { error: `${label} is required. Enter 0 if there are none.` };
  }
  let num;
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0) return { error: `${label} must be a whole number, such as 0, 1 or 25.` };
    num = raw;
  } else if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    num = Number(raw.trim());
  } else {
    return { error: `${label} must be a whole number, such as 0, 1 or 25.` };
  }
  if (num > MAX_COUNT) return { error: `${label} is too large.` };
  return { value: num };
}

export function validateDailyReport(body) {
  const errors = {};
  const value = {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _form: 'Request body must be a JSON object.' }, value };
  }
  const date = typeof body.reportDate === 'string' ? body.reportDate.trim() : '';
  if (date === '') errors.reportDate = 'Date is required. Choose the date of the report.';
  else if (!isRealDate(date)) errors.reportDate = 'Date is not valid. Choose a date from the calendar.';
  else value.reportDate = date;

  for (const { key, label } of COUNT_FIELDS) {
    const result = parseCount(body[key], label);
    if (result.error) errors[key] = result.error;
    else value[key] = result.value;
  }
  return { ok: Object.keys(errors).length === 0, errors, value };
}
