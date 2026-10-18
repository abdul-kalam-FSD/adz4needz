// Parses and validates the query string of the payment list and overview endpoints.
import { isRealDate } from './validate-daily-report.js';

export const STATUS_FILTERS = ['pending', 'partially_paid', 'paid'];
const str = (v) => (typeof v === 'string' ? v.trim() : v === undefined ? '' : null); // null = wrong type (e.g. repeated param)
const posId = (t) => (/^[1-9]\d{0,17}$/.test(t) ? t : null);
const posSmall = (t) => (/^[1-9]\d{0,8}$/.test(t) ? Number(t) : null);

function dateRange(query, fromKey, toKey, errors, f) {
  for (const key of [fromKey, toKey]) {
    const v = str(query[key]);
    if (v === null || (v !== '' && !isRealDate(v))) errors[key] = 'Choose a valid date.';
    else if (v !== '') f[key] = v;
  }
  if (!errors[fromKey] && !errors[toKey] && f[fromKey] && f[toKey] && f[fromKey] > f[toKey]) errors[toKey] = 'The "to" date must not be before the "from" date.';
}

export function parsePaymentQuery(query = {}, { admin = false } = {}) {
  const errors = {};
  const f = { q: '', status: null, leadId: null, bdeId: null, commitmentFrom: null, commitmentTo: null, missingProof: false, page: 1, pageSize: 25 };

  const q = str(query.q);
  if (q === null || q.length > 100) errors.q = 'Search text must be at most 100 characters.'; else f.q = q;

  const status = str(query.status);
  if (status === null || (status !== '' && status !== 'all' && !STATUS_FILTERS.includes(status))) errors.status = 'Invalid status filter.';
  else if (status !== '' && status !== 'all') f.status = status;

  const lead = str(query.leadId);
  if (lead === null || (lead !== '' && posId(lead) === null)) errors.leadId = 'Invalid lead filter.'; else if (lead !== '') f.leadId = lead;

  if (admin) {
    const bde = str(query.bdeId);
    if (bde === null || (bde !== '' && posId(bde) === null)) errors.bdeId = 'Invalid BDE filter.'; else if (bde !== '') f.bdeId = bde;
  }

  dateRange(query, 'commitmentFrom', 'commitmentTo', errors, f);

  const mp = str(query.missingProof);
  if (mp === null || (mp !== '' && mp !== 'yes')) errors.missingProof = 'Invalid proof filter.'; else f.missingProof = mp === 'yes';

  const page = str(query.page);
  if (page === null || (page !== '' && posSmall(page) === null)) errors.page = 'Invalid page.'; else if (page !== '') f.page = Number(page);
  const size = str(query.pageSize);
  if (size === null || (size !== '' && (posSmall(size) === null || Number(size) > 100))) errors.pageSize = 'Page size must be 1 to 100.';
  else if (size !== '') f.pageSize = Number(size);

  return { ok: Object.keys(errors).length === 0, errors, value: f };
}

// Overview / summary: one optional date range. Commitments are placed by commitment date, money received by payment date.
export function parsePaymentRangeQuery(query = {}) {
  const errors = {}; const value = { dateFrom: null, dateTo: null };
  dateRange(query, 'dateFrom', 'dateTo', errors, value);
  return { ok: Object.keys(errors).length === 0, errors, value };
}
