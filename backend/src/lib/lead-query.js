// Parses and validates the query string of the lead list / summary endpoints.
import { isRealDate } from './validate-daily-report.js';

export const UPCOMING_DAYS = 7; // technical default for "upcoming"; the real window needs TL confirmation
export const FOLLOW_UP_FILTERS = ['overdue', 'today', 'upcoming', 'none'];
const NEEDS_TODAY = ['overdue', 'today', 'upcoming'];

const str = (v) => (typeof v === 'string' ? v.trim() : v === undefined ? '' : null); // null = wrong type (e.g. repeated param)
const posInt = (t) => (/^[1-9]\d{0,8}$/.test(t) ? Number(t) : null);

export function parseLeadQuery(query = {}, { admin = false } = {}) {
  const errors = {};
  const f = { q: '', statusId: null, followUp: null, followUpFrom: null, followUpTo: null, bdeId: null, today: null, page: 1, pageSize: 25 };

  const q = str(query.q);
  if (q === null || q.length > 100) errors.q = 'Search text must be at most 100 characters.'; else f.q = q;

  const status = str(query.statusId);
  if (status === null || (status !== '' && posInt(status) === null)) errors.statusId = 'Invalid status filter.';
  else if (status !== '') f.statusId = Number(status);

  const fu = str(query.followUp);
  if (fu === null || (fu !== '' && fu !== 'all' && !FOLLOW_UP_FILTERS.includes(fu))) errors.followUp = 'Invalid follow-up filter.';
  else if (fu !== '' && fu !== 'all') f.followUp = fu;

  for (const key of ['followUpFrom', 'followUpTo']) {
    const v = str(query[key]);
    if (v === null || (v !== '' && !isRealDate(v))) errors[key] = 'Choose a valid date.';
    else if (v !== '') f[key] = v;
  }
  if (!errors.followUpFrom && !errors.followUpTo && f.followUpFrom && f.followUpTo && f.followUpFrom > f.followUpTo) {
    errors.followUpTo = 'The "to" date must not be before the "from" date.';
  }

  const today = str(query.today);
  if (today === null || (today !== '' && !isRealDate(today))) errors.today = 'Invalid date for "today".';
  else if (today !== '') f.today = today;
  if (!errors.today && f.followUp && NEEDS_TODAY.includes(f.followUp) && !f.today) errors.today = 'Today\'s date is required for this follow-up filter.';

  if (admin) {
    const bde = str(query.bdeId);
    if (bde === null || (bde !== '' && posInt(bde) === null)) errors.bdeId = 'Invalid BDE filter.';
    else if (bde !== '') f.bdeId = Number(bde);
  }

  const page = str(query.page);
  if (page === null || (page !== '' && posInt(page) === null)) errors.page = 'Invalid page.'; else if (page !== '') f.page = Number(page);
  const size = str(query.pageSize);
  if (size === null || (size !== '' && (posInt(size) === null || Number(size) > 100))) errors.pageSize = 'Page size must be 1 to 100.';
  else if (size !== '') f.pageSize = Number(size);

  return { ok: Object.keys(errors).length === 0, errors, value: f };
}

export function parseSummaryQuery(query = {}) {
  const today = str(query.today);
  if (today === null || today === '' || !isRealDate(today)) return { ok: false, errors: { today: 'Today\'s date is required.' }, value: {} };
  return { ok: true, errors: {}, value: { today } };
}
