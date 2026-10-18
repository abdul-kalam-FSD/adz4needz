// SQL fragments for payments. Pure functions: user input only ever goes into `params` (placeholders), never into the
// SQL text. The paid total is computed in a grouped sub-query, so a payment is never multiplied by its instalments
// (that join mistake is what would double-count commitments).
import { escapeLike } from './lead-search-sql.js';

// Alias `p` = payments, `ip` = per-payment totals of instalments.
export const PAID_JOIN = `LEFT JOIN (SELECT payment_id, SUM(amount) AS paid_amount, COUNT(*) AS instalment_count
                                       FROM payment_instalments GROUP BY payment_id) ip ON ip.payment_id = p.id`;
export const STATUS_SQL = `(CASE WHEN COALESCE(ip.paid_amount, 0) = 0 THEN 'pending'
                               WHEN ip.paid_amount < p.amount_committed THEN 'partially_paid' ELSE 'paid' END)`;
const MISSING_PROOF_SQL = `EXISTS (SELECT 1 FROM payment_instalments mi WHERE mi.payment_id = p.id
                                     AND NOT EXISTS (SELECT 1 FROM payment_receipts mr WHERE mr.instalment_id = mi.id))`;

// scopeUserId: a number restricts to that BDE (always set for BDE callers); null = team-wide (admin).
export function buildPaymentSearch({ scopeUserId, filters }) {
  const where = []; const params = [];
  if (scopeUserId !== null && scopeUserId !== undefined) { where.push('p.user_id = ?'); params.push(scopeUserId); }
  else if (filters.bdeId) { where.push('p.user_id = ?'); params.push(filters.bdeId); }
  if (filters.leadId) { where.push('p.lead_id = ?'); params.push(filters.leadId); }
  if (filters.q) {
    const like = `%${escapeLike(filters.q)}%`;
    where.push("(l.candidate_name LIKE ? ESCAPE '!' OR l.phone LIKE ? ESCAPE '!' OR l.email LIKE ? ESCAPE '!' OR p.course_or_internship LIKE ? ESCAPE '!')");
    params.push(like, like, like, like);
  }
  if (filters.status) { where.push(`${STATUS_SQL} = ?`); params.push(filters.status); }
  if (filters.commitmentFrom) { where.push('p.commitment_date >= ?'); params.push(filters.commitmentFrom); }
  if (filters.commitmentTo) { where.push('p.commitment_date <= ?'); params.push(filters.commitmentTo); }
  if (filters.missingProof) where.push(MISSING_PROOF_SQL);
  return { whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

// Optional date range for the overview: commitments by commitment_date, money received by paid_on (both inclusive).
export function buildRangeFilters({ dateFrom, dateTo }) {
  const commit = { sql: '', params: [] }; const paid = { sql: '', params: [] };
  if (dateFrom) { commit.sql += ' AND p.commitment_date >= ?'; commit.params.push(dateFrom); paid.sql += ' AND i.paid_on >= ?'; paid.params.push(dateFrom); }
  if (dateTo) { commit.sql += ' AND p.commitment_date <= ?'; commit.params.push(dateTo); paid.sql += ' AND i.paid_on <= ?'; paid.params.push(dateTo); }
  return { commit, paid };
}
