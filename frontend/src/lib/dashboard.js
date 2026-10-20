// Small pure helpers for the BDE dashboard.
export function todayLocal(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
// reports: array from GET /daily-reports (newest first). Returns the report for `today` or null.
export function reportForDay(reports, today) {
  if (!Array.isArray(reports)) return null;
  return reports.find((r) => String(r.reportDate).slice(0, 10) === today) || null;
}
// Which "needs attention" items exist, in the order they should be shown. Only real counts; nothing is invented.
export function attentionItems({ followUps, interviews, proofs, reportSubmitted }) {
  const items = [];
  if (reportSubmitted === false) items.push({ key: 'report', text: "Today's calling report is not submitted.", to: '/daily-report', cta: 'Submit report' });
  if (followUps && followUps.overdue > 0) items.push({ key: 'overdue', text: `${followUps.overdue} lead follow-up${followUps.overdue === 1 ? ' is' : 's are'} overdue.`, to: '/leads', cta: 'Open leads' });
  if (followUps && followUps.today > 0) items.push({ key: 'fu-today', text: `${followUps.today} follow-up${followUps.today === 1 ? ' is' : 's are'} due today.`, to: '/leads', cta: 'Open leads' });
  if (interviews && interviews.needsUpdate > 0) items.push({ key: 'iv-update', text: `${interviews.needsUpdate} past interview${interviews.needsUpdate === 1 ? ' needs' : 's need'} an attendance update.`, to: '/interviews', cta: 'Open interviews' });
  if (interviews && interviews.today > 0) items.push({ key: 'iv-today', text: `${interviews.today} interview${interviews.today === 1 ? ' is' : 's are'} scheduled today.`, to: '/interviews', cta: 'Open interviews' });
  if (proofs && proofs.rejected > 0) items.push({ key: 'proofs', text: `${proofs.rejected} payment proof${proofs.rejected === 1 ? ' was' : 's were'} rejected.`, to: '/payments', cta: 'Open payments' });
  return items;
}
