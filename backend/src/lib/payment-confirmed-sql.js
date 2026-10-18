// Single definition of the interview "payment confirmed" flag (Phase 6): it is DERIVED from payment records, not typed in.
// ASSUMPTION (TL to confirm): "candidate confirmed payment" (PDF, Interview Tracking) means a payment commitment exists
// for the lead. To switch to "some money has been received", change only this expression, e.g. add
// `AND EXISTS (SELECT 1 FROM payment_instalments pi WHERE pi.payment_id = pc.id)`.
// `i` is the alias of the interviews table in the query that embeds this fragment.
export const PAYMENT_CONFIRMED_SQL = 'EXISTS (SELECT 1 FROM payments pc WHERE pc.lead_id = i.lead_id)';
