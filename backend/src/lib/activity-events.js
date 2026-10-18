// Pure description of activity events. The feed is DERIVED from records the application already keeps (no new table): each kind below
// maps to one SELECT in activity.repository.js. Events that leave no record today (sign-in/out, password resets, switching an account
// on/off, lead reassignment) are NOT here on purpose: showing them would need a new table, which needs the database owner's approval.
export const ACTIVITY_KINDS = ['call', 'lead_added', 'interview_scheduled', 'payment_committed', 'instalment_recorded', 'receipt_uploaded', 'receipt_reviewed', 'import_committed', 'account_created', 'daily_report'];
export const MAX_FEED_DAYS = 31;
export const DEFAULT_FEED_LIMIT = 200;
export const MAX_FEED_LIMIT = 500;

const OUTCOME = { interested: 'Interested', not_interested: 'Not interested', follow_up: 'Follow-up needed', no_response: 'No response' };
const REVIEW = { approved: 'approved', rejected: 'rejected', pending: 'reset to pending' };
const rupees = (v) => { const n = Number(v); return Number.isFinite(n) ? '\u20B9' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : ''; };

// row: { at, kind, subject, extra } -> { title, detail }
export function describeEvent({ kind, subject, extra }) {
  const who = subject || 'a lead';
  switch (kind) {
    case 'call': return { title: 'Recorded a call', detail: `${who}: ${OUTCOME[extra] || extra}` };
    case 'lead_added': return { title: 'Added a lead', detail: who };
    case 'interview_scheduled': return { title: 'Scheduled an interview', detail: who };
    case 'payment_committed': return { title: 'Recorded a payment commitment', detail: `${who}: ${rupees(extra)}` };
    case 'instalment_recorded': return { title: 'Recorded an instalment', detail: `${who}: ${rupees(extra)}` };
    case 'receipt_uploaded': return { title: 'Uploaded a receipt', detail: who };
    case 'receipt_reviewed': return { title: `Receipt ${REVIEW[extra] || extra}`, detail: who };
    case 'import_committed': return { title: 'Imported leads from a file', detail: `${subject}: ${Number(extra) || 0} added` };
    case 'account_created': return { title: 'Account created', detail: subject };
    case 'daily_report': return { title: 'Submitted a daily calling report', detail: `${subject}: ${Number(extra) || 0} calls` };
    default: return { title: kind, detail: subject || '' };
  }
}
