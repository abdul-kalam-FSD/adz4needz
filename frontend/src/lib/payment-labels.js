// Display text and badge styles for payment values. Values themselves come from the API (status is derived on the server).
export const PAYMENT_STATUS_LABEL = { pending: 'Pending', partially_paid: 'Partially Paid', paid: 'Paid' };
export const PAYMENT_STATUS_BADGE = { pending: 'badge-pay-pending', partially_paid: 'badge-pay-partial', paid: 'badge-pay-paid' };
export const MAX_RECEIPT_TYPES_TEXT = 'JPEG, PNG or PDF';

// Admin review of a payment proof (receipt / screenshot).
export const REVIEW_LABEL = { pending: 'Awaiting review', approved: 'Approved', rejected: 'Rejected' };
export const REVIEW_BADGE = { pending: 'badge-review-pending', approved: 'badge-review-approved', rejected: 'badge-review-rejected' };
export const reviewLabel = (s) => REVIEW_LABEL[s] || REVIEW_LABEL.pending;
export const reviewBadge = (s) => REVIEW_BADGE[s] || REVIEW_BADGE.pending;
export const MAX_REVIEW_NOTE = 300;
// Returns an error text or null. A rejection must say why.
export function checkReviewNote(decision, note) {
  const t = String(note ?? '').trim();
  if (t.length > MAX_REVIEW_NOTE) return `The note can have at most ${MAX_REVIEW_NOTE} characters.`;
  if (decision === 'rejected' && t === '') return 'Give a reason for rejecting this proof, so the BDE knows what to fix.';
  return null;
}
