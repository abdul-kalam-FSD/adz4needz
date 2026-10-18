// End-to-end check against a RUNNING server + real MySQL. Needs Node 22 (built-in fetch). Usage:
//   SMOKE_EMPLOYEE_ID=<bde id> SMOKE_PASSWORD=<bde password> npm run smoke
// Optional admin checks: also set SMOKE_ADMIN_ID and SMOKE_ADMIN_PASSWORD.
// Optional ownership check: also set SMOKE_BDE2_ID and SMOKE_BDE2_PASSWORD (a SECOND BDE account).
// Payment checks save 1 real payment, 2 instalments and 1 proof file (needs the Phase 6 migrations 007_payments to 010_deprecate_interview_payment_flag and a writable RECEIPT_STORAGE_DIR on the server).
// Leads checks need migration 004 (proposed statuses) applied; they save 2 real leads for the first BDE.
// NOTE: it saves ONE real daily report row (a random past date) for that BDE. Delete it afterwards if you like.
const BASE = process.env.BASE_URL || 'http://localhost:4000';
const ID = process.env.SMOKE_EMPLOYEE_ID;
const PW = process.env.SMOKE_PASSWORD;
if (!ID || !PW) { console.error('Set SMOKE_EMPLOYEE_ID and SMOKE_PASSWORD (an existing BDE account).'); process.exit(2); }

let failed = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) failed++; };
const JSON_H = { 'Content-Type': 'application/json' };

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { ...JSON_H, ...(cookie ? { Cookie: cookie } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { res, data };
}

// Receipt upload: the body is the file itself (not JSON).
async function uploadRaw(cookie, instalmentId, bytes, type = 'image/png', query = '') {
  const res = await fetch(`${BASE}/api/payment-instalments/${instalmentId}/receipts?name=smoke.png${query}`, {
    method: 'POST', headers: { ...(type ? { 'Content-Type': type } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: bytes
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { res, data };
}
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(Array.from({ length: 200 }, () => Math.floor(Math.random() * 256)))]);

const day = 1 + Math.floor(Math.random() * 28);
const month = 1 + Math.floor(Math.random() * 12);
const year = 1990 + Math.floor(Math.random() * 9);
const reportDate = process.env.SMOKE_REPORT_DATE || `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const payload = { reportDate, totalCalls: 40, interested: 9, notInterested: 20, followUpRequired: 6, noResponse: 3 };

let r = await call('GET', '/health');
check('server is up', r.res.status === 200);
r = await call('GET', '/health/db');
check('database connected', r.res.status === 200, `status ${r.res.status}`);

r = await call('GET', '/auth/me');
check('/auth/me without login -> 401', r.res.status === 401);
r = await call('POST', '/daily-reports', { body: payload });
check('create report without login -> 401', r.res.status === 401);

r = await call('POST', '/auth/login', { body: { employeeId: ID, password: PW + '-wrong' } });
check('wrong password -> 401', r.res.status === 401);

r = await call('POST', '/auth/login', { body: { employeeId: ID, password: PW } });
check('login ok -> 200', r.res.status === 200, `status ${r.res.status}`);
const setCookie = r.res.headers.getSetCookie?.()[0] || '';
check('session cookie is HttpOnly + SameSite', /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie));
check('login response has no password data', !JSON.stringify(r.data).match(/password|hash/i));
const cookie = setCookie.split(';')[0];

r = await call('GET', '/auth/me', { cookie });
check('/auth/me with session -> 200', r.res.status === 200 && r.data?.user?.employeeId === ID);

r = await call('POST', '/daily-reports', { cookie, body: { ...payload, totalCalls: -1 } });
check('negative number -> 400', r.res.status === 400 && !!r.data?.error?.fields?.totalCalls);
r = await call('POST', '/daily-reports', { cookie, body: { ...payload, interested: 2.5 } });
check('decimal -> 400', r.res.status === 400);
r = await call('POST', '/daily-reports', { cookie, body: { ...payload, reportDate: '2026-02-30' } });
check('impossible date -> 400', r.res.status === 400);

r = await call('POST', '/daily-reports', { cookie, body: { ...payload, userId: 999999 } });
check('valid report -> 201 (extra userId ignored)', r.res.status === 201, `status ${r.res.status} ${r.data?.error?.message || ''}`);
check('saved values match', r.data?.report?.totalCalls === 40 && r.data?.report?.reportDate === reportDate);

r = await call('POST', '/daily-reports', { cookie, body: payload });
check('same date again -> 409', r.res.status === 409);

r = await call('GET', '/daily-reports', { cookie });
check('list contains saved report (persisted in MySQL)', r.res.status === 200 && r.data.reports.some((x) => x.reportDate === reportDate));

// ---------------- Leads (BDE) ----------------
const unique = String(Date.now()).slice(-7);
const leadPhone = `9${unique}001`.slice(0, 10);
const leadName = `Smoke Lead ${unique}`;
const todayStr = new Date().toISOString().slice(0, 10);
const pastDate = '2000-01-01';
let leadId = null;

r = await call('GET', '/lead-statuses', { cookie });
check('lead statuses available (migration 004 applied)', r.res.status === 200 && r.data?.statuses?.length > 0, `count ${r.data?.statuses?.length}`);
const statusList = r.data?.statuses || [];
const openStatus = statusList.find((x) => !x.closesFollowUp) || statusList[0];
const closedStatus = statusList.find((x) => x.closesFollowUp);
const leadBody = { candidateName: leadName, phone: leadPhone, email: `smoke${unique}@example.com`, courseOrInternship: 'Smoke Test Course', leadStatusId: openStatus?.id, followUpDate: pastDate, nextAction: 'Call back' };

r = await call('POST', '/leads', { cookie, body: { ...leadBody, candidateName: '' } });
check('lead without name -> 400', r.res.status === 400 && !!r.data?.error?.fields?.candidateName);
r = await call('POST', '/leads', { cookie, body: { ...leadBody, phone: '', email: '' } });
check('lead without any contact -> 400', r.res.status === 400);
r = await call('POST', '/leads', { cookie, body: { ...leadBody, leadStatusId: 999999 } });
check('unknown status -> 400', r.res.status === 400);

r = await call('POST', '/leads', { cookie, body: { ...leadBody, userId: 999999 } });
check('create lead -> 201 (owner taken from session)', r.res.status === 201, `status ${r.res.status} ${r.data?.error?.message || ''}`);
leadId = r.data?.lead?.id;
check('created lead has status name and no internal keys', !!r.data?.lead?.status?.name && !JSON.stringify(r.data).match(/phone_key|email_key|user_id/));

r = await call('POST', '/leads', { cookie, body: { ...leadBody, candidateName: leadName + ' again', email: '' } });
check('same phone again -> 409 POSSIBLE_DUPLICATE with own details', r.res.status === 409 && r.data?.error?.code === 'POSSIBLE_DUPLICATE' && r.data.error.details.own.length >= 1);
r = await call('POST', '/leads', { cookie, body: { ...leadBody, candidateName: leadName + ' (second record)', confirmDuplicate: true } });
check('explicit confirmation -> 201 separate record (no merge)', r.res.status === 201 && r.data?.lead?.id !== leadId);

r = await call('GET', `/leads?today=${todayStr}&q=${encodeURIComponent(leadName)}`, { cookie });
check('search by name finds both records', r.res.status === 200 && r.data.total >= 2, `total ${r.data?.total}`);
r = await call('GET', `/leads?today=${todayStr}&q=${leadPhone}`, { cookie });
check('search by phone works', r.res.status === 200 && r.data.leads.some((x) => x.id === leadId));
r = await call('GET', `/leads?today=${todayStr}&statusId=${openStatus?.id}&q=${encodeURIComponent(leadName)}`, { cookie });
check('status filter works', r.res.status === 200 && r.data.leads.length >= 1 && r.data.leads.every((x) => x.status.id === openStatus.id));
r = await call('GET', `/leads?today=${todayStr}&followUp=overdue&q=${encodeURIComponent(leadName)}`, { cookie });
check('overdue filter finds the lead with a 2000-01-01 follow-up', r.res.status === 200 && r.data.leads.some((x) => x.id === leadId && x.followUpState === 'overdue'));
r = await call('GET', `/leads?followUp=overdue`, { cookie });
check('overdue filter without "today" -> 400', r.res.status === 400);
r = await call('GET', `/leads?today=${todayStr}&followUpFrom=1999-12-31&followUpTo=2000-01-02&q=${encodeURIComponent(leadName)}`, { cookie });
check('follow-up date range filter works', r.res.status === 200 && r.data.leads.some((x) => x.id === leadId));
r = await call('GET', `/leads?today=${todayStr}&q=${encodeURIComponent('%')}&pageSize=5`, { cookie });
check('search for "%" is literal text (wildcards escaped), not "match everything"', r.res.status === 200 && r.data.leads.every((x) => JSON.stringify(x).includes('%')));
r = await call('GET', `/leads/summary?today=${todayStr}`, { cookie });
check('follow-up summary counts overdue >= 1', r.res.status === 200 && r.data.counts.overdue >= 1, JSON.stringify(r.data?.counts));
r = await call('GET', `/leads?today=${todayStr}&page=1&pageSize=1`, { cookie });
check('pagination: pageSize respected', r.res.status === 200 && r.data.leads.length <= 1 && r.data.pageSize === 1);

r = await call('PUT', `/leads/${leadId}`, { cookie, body: { ...leadBody, nextAction: 'Updated note', followUpDate: '', leadStatusId: closedStatus?.id || openStatus.id } });
check('edit own lead -> 200', r.res.status === 200 && r.data?.lead?.nextAction === 'Updated note' && r.data.lead.followUpDate === null, `status ${r.res.status}`);
r = await call('GET', `/leads/${leadId}`, { cookie });
check('edit persisted (read back from MySQL)', r.res.status === 200 && r.data.lead.nextAction === 'Updated note');
r = await call('GET', `/leads/abc`, { cookie });
check('non-numeric lead id -> 400', r.res.status === 400);

// ---- Interviews (Phase 5): BDE creates and manages interviews for their own leads ----
const ivBody = { leadId, scheduledAt: '2026-06-15T14:30', attendance: 'pending', outcome: 'pending', interestedInJoining: null, paymentConfirmed: false };
r = await call('POST', '/interviews', { cookie, body: { ...ivBody, scheduledAt: 'tomorrow' } });
check('interview with bad date -> 400', r.res.status === 400 && !!r.data?.error?.fields?.scheduledAt);
r = await call('POST', '/interviews', { cookie, body: { ...ivBody, leadId: 999999999 } });
check('interview for a missing lead -> 404', r.res.status === 404);
r = await call('POST', '/interviews', { cookie, body: { ...ivBody, leadId: 'abc' } });
check('interview with malformed lead id -> 400', r.res.status === 400);
r = await call('POST', '/interviews', { cookie, body: { ...ivBody, outcome: 'selected' } });
check('outcome without attendance -> 400', r.res.status === 400 && !!r.data?.error?.fields?.outcome);
r = await call('POST', '/interviews', { cookie, body: { ...ivBody, userId: 1, user_id: 1 } });
check('create interview -> 201 (owner from session)', r.res.status === 201, `status ${r.res.status} ${r.data?.error?.message || ''}`);
const interviewId = r.data?.interview?.id;
check('created interview is linked to the lead, time kept as entered', r.data?.interview?.lead?.id === leadId && r.data.interview.scheduledAt === '2026-06-15T14:30');
r = await call('PUT', `/interviews/${interviewId}`, { cookie, body: { ...ivBody, attendance: 'attended', outcome: 'selected', interestedInJoining: true, paymentConfirmed: true } });
check('update interview -> 200', r.res.status === 200, `status ${r.res.status}`);
r = await call('GET', `/interviews/${interviewId}`, { cookie });
check('interview update persisted (read back from MySQL)', r.res.status === 200 && r.data.interview.outcome === 'selected' && r.data.interview.interestedInJoining === true && r.data.interview.paymentConfirmed === false);
check('typed paymentConfirmed is ignored: derived from payment records, none yet (Phase 6)', r.data.interview.paymentConfirmed === false);
r = await call('GET', `/interviews?today=${todayStr}&attendance=attended&outcome=selected`, { cookie });
check('interview filters work', r.res.status === 200 && r.data.interviews.some((x) => x.id === interviewId));
r = await call('GET', `/interviews/summary?today=${todayStr}`, { cookie });
check('interview summary -> 200', r.res.status === 200 && typeof r.data.counts.needsUpdate === 'number');
r = await call('GET', '/interviews/abc', { cookie });
check('non-numeric interview id -> 400', r.res.status === 400);

// ---- Payments (Phase 6): commitment, instalments, proof upload, derived status ----
const payBody = { leadId, courseOrInternship: 'Smoke Course', amountCommitted: '12000.50', commitmentDate: '2026-06-15' };
r = await call('POST', '/payments', { cookie, body: { ...payBody, amountCommitted: '-5' } });
check('payment with a bad amount -> 400', r.res.status === 400 && !!r.data?.error?.fields?.amountCommitted);
r = await call('POST', '/payments', { cookie, body: { ...payBody, leadId: 999999999 } });
check('payment for a missing lead -> 404', r.res.status === 404);
r = await call('POST', '/payments', { cookie, body: { ...payBody, userId: 1, status: 'paid' } });
check('create payment -> 201, status derived (pending), owner from session', r.res.status === 201 && r.data.payment.status === 'pending' && r.data.payment.amountCommitted === '12000.50', `status ${r.res.status}`);
const paymentId = r.data?.payment?.id;
r = await call('POST', `/payments/${paymentId}/instalments`, { cookie, body: { amount: '5000', paidOn: '2026-06-20' } });
check('first instalment -> partially paid, exact amounts', r.res.status === 201 && r.data.payment.status === 'partially_paid' && r.data.payment.amountOutstanding === '7000.50');
const instalmentId = r.data?.instalment?.id;
r = await call('POST', `/payments/${paymentId}/instalments`, { cookie, body: { amount: '5000', paidOn: '2026-06-20' } });
check('identical instalment is warned, not merged -> 409', r.res.status === 409 && r.data.error.code === 'POSSIBLE_DUPLICATE_INSTALMENT');
r = await call('POST', `/payments/${paymentId}/instalments`, { cookie, body: { amount: '7000.51', paidOn: '2026-06-25' } });
check('over-payment rejected -> 400', r.res.status === 400 && !!r.data?.error?.fields?.amount);
r = await call('POST', `/payments/${paymentId}/instalments`, { cookie, body: { amount: '7000.50', paidOn: '2026-06-25' } });
check('second instalment completes the payment -> paid', r.res.status === 201 && r.data.payment.status === 'paid' && r.data.payment.amountOutstanding === '0.00');
r = await uploadRaw(cookie, instalmentId, PNG_BYTES, 'image/png');
check('upload a real PNG -> 201, metadata only', r.res.status === 201 && !!r.data?.receipt?.id && !('storedName' in r.data.receipt), `status ${r.res.status}`);
const receiptId = r.data?.receipt?.id;
r = await uploadRaw(cookie, instalmentId, Buffer.from('<html><script>alert(1)</script></html>' + 'x'.repeat(40)), 'image/png');
check('HTML disguised as PNG -> 415', r.res.status === 415);
r = await uploadRaw(cookie, instalmentId, PNG_BYTES, 'application/json');
// Binary data labelled JSON fails JSON parsing (400); valid JSON is refused as not-a-file (415). Either way nothing is stored.
check('JSON content type on the upload route is refused (400/415)', r.res.status === 400 || r.res.status === 415);
r = await uploadRaw(cookie, instalmentId, PNG_BYTES, 'image/png');
check('same file again is warned -> 409', r.res.status === 409 && r.data.error.code === 'POSSIBLE_DUPLICATE_RECEIPT');
{
  const f = await fetch(`${BASE}/api/payment-receipts/${receiptId}/file`, { headers: { Cookie: cookie } });
  const bytes = Buffer.from(await f.arrayBuffer());
  check('owner downloads the proof: same bytes, nosniff, no-store', f.status === 200 && bytes.equals(PNG_BYTES) && f.headers.get('x-content-type-options') === 'nosniff' && /no-store/.test(f.headers.get('cache-control')));
  const anon = await fetch(`${BASE}/api/payment-receipts/${receiptId}/file`);
  check('proof without a session -> 401', anon.status === 401);
}
r = await call('GET', `/payments?q=Smoke%20Course`, { cookie });
check('payment list + search -> 200', r.res.status === 200 && r.data.payments.some((x) => x.id === paymentId));
r = await call('GET', '/payments/summary', { cookie });
check('BDE payment summary -> 200', r.res.status === 200 && typeof r.data.totals.committed === 'string' && r.data.totals.payments >= 1);
r = await call('GET', `/interviews/${interviewId}`, { cookie });
check('interview payment-confirmed now follows the payment record (derived) -> true', r.res.status === 200 && r.data.interview.paymentConfirmed === true);
r = await call('GET', '/payments/abc', { cookie });
check('non-numeric payment id -> 400', r.res.status === 400);

// optional: a SECOND BDE must not see or change this lead
const B2 = process.env.SMOKE_BDE2_ID, B2PW = process.env.SMOKE_BDE2_PASSWORD;
if (B2 && B2PW) {
  r = await call('POST', '/auth/login', { body: { employeeId: B2, password: B2PW } });
  const c2 = (r.res.headers.getSetCookie?.()[0] || '').split(';')[0];
  check('second BDE login -> 200', r.res.status === 200);
  r = await call('GET', `/leads/${leadId}`, { cookie: c2 });
  check('OWNERSHIP: other BDE reading my lead -> 404', r.res.status === 404);
  r = await call('PUT', `/leads/${leadId}`, { cookie: c2, body: { ...leadBody, candidateName: 'Hijacked' } });
  check('OWNERSHIP: other BDE editing my lead -> 404', r.res.status === 404);
  r = await call('GET', `/leads?today=${todayStr}&q=${encodeURIComponent(leadName)}`, { cookie: c2 });
  check('OWNERSHIP: other BDE list does not include my leads', r.res.status === 200 && r.data.total === 0);
  r = await call('GET', `/leads?today=${todayStr}&bdeId=1`, { cookie: c2 });
  check('OWNERSHIP: bdeId parameter cannot widen a BDE\'s scope', r.res.status === 200 && r.data.leads.every((x) => !x.bde));
  r = await call('POST', '/leads', { cookie: c2, body: { ...leadBody, candidateName: 'Other BDE same phone' } });
  check('other BDE using the same phone -> 409 with a COUNT only (no details of my lead)', r.res.status === 409 && r.data.error.details.own.length === 0 && r.data.error.details.otherBdeMatches >= 1 && !JSON.stringify(r.data).includes(leadName));
  r = await call('GET', `/interviews/${interviewId}`, { cookie: c2 });
  check('OWNERSHIP: other BDE reading my interview -> 404', r.res.status === 404);
  r = await call('PUT', `/interviews/${interviewId}`, { cookie: c2, body: { ...ivBody, attendance: 'did_not_attend' } });
  check('OWNERSHIP: other BDE editing my interview -> 404', r.res.status === 404);
  r = await call('POST', '/interviews', { cookie: c2, body: ivBody });
  check('OWNERSHIP: other BDE scheduling on my lead -> 404', r.res.status === 404);
  r = await call('GET', `/interviews?today=${todayStr}&bdeId=1&leadId=${leadId}`, { cookie: c2 });
  check('OWNERSHIP: other BDE interview list does not include mine', r.res.status === 200 && r.data.total === 0);
  r = await call('GET', `/interviews/${interviewId}`, { cookie });
  check('my interview unchanged after the other BDE\'s attempts', r.res.status === 200 && r.data.interview.attendance === 'attended');
  r = await call('GET', `/payments/${paymentId}`, { cookie: c2 });
  check('OWNERSHIP: other BDE reading my payment -> 404', r.res.status === 404);
  r = await call('PUT', `/payments/${paymentId}`, { cookie: c2, body: { ...payBody, amountCommitted: '1' } });
  check('OWNERSHIP: other BDE editing my payment -> 404', r.res.status === 404);
  r = await call('POST', `/payments/${paymentId}/instalments`, { cookie: c2, body: { amount: '1', paidOn: '2026-06-26' } });
  check('OWNERSHIP: other BDE adding an instalment to my payment -> 404', r.res.status === 404);
  r = await uploadRaw(c2, instalmentId, Buffer.concat([PNG_BYTES, Buffer.from('b')]), 'image/png');
  check('OWNERSHIP: other BDE uploading proof to my instalment -> 404', r.res.status === 404);
  {
    const f = await fetch(`${BASE}/api/payment-receipts/${receiptId}/file`, { headers: { Cookie: c2 } });
    check('OWNERSHIP: other BDE downloading my proof -> 404', f.status === 404);
  }
  r = await call('POST', '/payments', { cookie: c2, body: payBody });
  check('OWNERSHIP: other BDE creating a payment on my lead -> 404', r.res.status === 404);
  r = await call('GET', `/payments/${paymentId}`, { cookie });
  check('my payment unchanged after the other BDE\'s attempts', r.res.status === 200 && r.data.payment.amountCommitted === '12000.50' && r.data.payment.instalmentCount === 2);
  await call('POST', '/auth/logout', { cookie: c2 });
} else {
  console.log('SKIP ownership checks between two BDEs (set SMOKE_BDE2_ID and SMOKE_BDE2_PASSWORD)');
}

// BDE must not reach admin screens
r = await call('GET', '/admin/bdes', { cookie });
check('BDE calling admin endpoint -> 403', r.res.status === 403, `status ${r.res.status}`);
r = await call('GET', '/admin/daily-overview?date=' + reportDate, { cookie });
check('BDE calling admin overview -> 403', r.res.status === 403);
r = await call('GET', '/admin/interviews', { cookie });
check('BDE calling admin interviews -> 403', r.res.status === 403);
r = await call('GET', '/admin/payments', { cookie });
check('BDE calling admin payments -> 403', r.res.status === 403);
r = await call('GET', '/admin/payments/overview', { cookie });
check('BDE calling admin payment overview -> 403', r.res.status === 403);

r = await call('POST', '/auth/logout', { cookie });
check('logout -> 204', r.res.status === 204);
r = await call('GET', '/auth/me', { cookie });
check('old session rejected after logout -> 401', r.res.status === 401);

// ---- Optional admin checks (read-only screens) ----
const AID = process.env.SMOKE_ADMIN_ID;
const APW = process.env.SMOKE_ADMIN_PASSWORD;
if (AID && APW) {
  r = await call('POST', '/auth/login', { body: { employeeId: AID, password: APW } });
  check('admin login -> 200 with role admin', r.res.status === 200 && r.data?.user?.role === 'admin');
  const acookie = (r.res.headers.getSetCookie?.()[0] || '').split(';')[0];

  r = await call('GET', '/admin/daily-overview', { cookie: acookie });
  check('overview without date -> 400', r.res.status === 400);
  r = await call('GET', '/admin/daily-overview?date=' + reportDate, { cookie: acookie });
  check('overview for the smoke date -> 200', r.res.status === 200, `status ${r.res.status}`);
  const row = r.data?.bdes?.find((b) => b.employeeId === ID);
  check('admin sees the BDE report saved above (MySQL join works)', !!row && row.submitted === true && row.totalCalls === 40);
  check('totals include that report', (r.data?.totals?.totalCalls ?? 0) >= 40 && r.data.totals.reportsSubmitted >= 1);
  check('overview has no password data', !JSON.stringify(r.data).match(/password|hash|token/i));

  r = await call('GET', '/admin/bdes', { cookie: acookie });
  check('BDE list -> 200 and contains the BDE', r.res.status === 200 && r.data.bdes.some((b) => b.employeeId === ID));
  const bdeId = r.data?.bdes?.find((b) => b.employeeId === ID)?.id;
  r = await call('GET', '/admin/bdes/' + bdeId, { cookie: acookie });
  check('BDE detail -> 200 with that BDE reports', r.res.status === 200 && r.data.reports.some((x) => x.reportDate === reportDate));
  r = await call('GET', '/admin/bdes/999999999', { cookie: acookie });
  check('unknown BDE -> 404', r.res.status === 404);
  r = await call('GET', '/admin/bdes/abc', { cookie: acookie });
  check('non-numeric BDE id -> 400', r.res.status === 400);
  r = await call('POST', '/daily-reports', { cookie: acookie, body: payload });
  check('admin cannot submit a BDE daily report -> 403', r.res.status === 403);
  r = await call('GET', `/admin/leads?today=${todayStr}&q=${encodeURIComponent(leadName)}`, { cookie: acookie });
  check('admin sees leads team-wide with the responsible BDE', r.res.status === 200 && r.data.leads.some((x) => x.id === leadId && x.bde?.employeeId === ID));
  r = await call('GET', `/admin/leads?today=${todayStr}&bdeId=999999999`, { cookie: acookie });
  check('admin BDE filter works (unknown BDE -> empty list)', r.res.status === 200 && r.data.total === 0);
  r = await call('GET', `/admin/leads/${leadId}`, { cookie: acookie });
  check('admin lead detail -> 200 with bde block', r.res.status === 200 && r.data.lead.bde?.employeeId === ID);
  r = await call('GET', `/admin/leads/summary?today=${todayStr}`, { cookie: acookie });
  check('admin follow-up summary -> 200', r.res.status === 200 && typeof r.data.counts.overdue === 'number');
  r = await call('POST', '/leads', { cookie: acookie, body: leadBody });
  check('admin cannot create a lead -> 403', r.res.status === 403);
  r = await call('GET', `/admin/interviews?today=${todayStr}&bdeId=${bdeId}`, { cookie: acookie });
  check('admin sees interviews team-wide with the responsible BDE', r.res.status === 200 && r.data.interviews.some((x) => x.id === interviewId && x.bde?.employeeId === ID));
  r = await call('GET', `/admin/interviews/${interviewId}`, { cookie: acookie });
  check('admin interview detail -> 200 with bde block', r.res.status === 200 && r.data.interview.bde?.employeeId === ID);
  r = await call('GET', '/admin/interviews/overview', { cookie: acookie });
  const ov = r.data?.bdes?.find((b) => b.employeeId === ID);
  check('admin overview has this BDE with the attended interview', r.res.status === 200 && !!ov && ov.attended >= 1 && ov.selected >= 1 && r.data.totals.scheduled >= 1);
  r = await call('GET', `/admin/interviews/summary?today=${todayStr}`, { cookie: acookie });
  check('admin interview summary -> 200', r.res.status === 200 && typeof r.data.counts.upcoming === 'number');
  r = await call('POST', '/interviews', { cookie: acookie, body: ivBody });
  check('admin cannot create an interview -> 403', r.res.status === 403);
  r = await call('PUT', `/interviews/${interviewId}`, { cookie: acookie, body: ivBody });
  check('admin cannot edit an interview -> 403', r.res.status === 403);
  r = await call('PUT', `/admin/interviews/${interviewId}`, { cookie: acookie, body: ivBody });
  check('no admin write route for interviews -> 404', r.res.status === 404);
  r = await call('GET', `/admin/payments?bdeId=${bdeId}&q=Smoke%20Course`, { cookie: acookie });
  check('admin sees payments team-wide with the responsible BDE', r.res.status === 200 && r.data.payments.some((x) => x.id === paymentId && x.bde?.employeeId === ID));
  r = await call('GET', `/admin/payments/${paymentId}`, { cookie: acookie });
  check('admin payment detail has instalments and proof metadata', r.res.status === 200 && r.data.payment.instalments.length === 2 && r.data.payment.instalments.some((i) => i.receipts.length === 1));
  {
    const f = await fetch(`${BASE}/api/admin/payment-receipts/${receiptId}/file`, { headers: { Cookie: acookie } });
    check('admin can view the uploaded proof', f.status === 200 && Buffer.from(await f.arrayBuffer()).equals(PNG_BYTES));
  }
  r = await call('GET', '/admin/payments/overview', { cookie: acookie });
  const pov = r.data?.bdes?.find((b) => b.employeeId === ID);
  check('admin payment overview has this BDE with committed and received amounts', r.res.status === 200 && !!pov && Number(pov.committed) >= 12000.5 && Number(pov.received) >= 12000.5 && r.data.totals.payments >= 1);
  r = await call('POST', '/payments', { cookie: acookie, body: payBody });
  check('admin cannot create a payment -> 403', r.res.status === 403);
  r = await call('POST', `/payments/${paymentId}/instalments`, { cookie: acookie, body: { amount: '1', paidOn: '2026-06-26' } });
  check('admin cannot add an instalment -> 403', r.res.status === 403);
  r = await uploadRaw(acookie, instalmentId, Buffer.concat([PNG_BYTES, Buffer.from('a')]), 'image/png');
  check('admin cannot upload proof -> 403', r.res.status === 403);
  r = await call('PUT', `/admin/payments/${paymentId}`, { cookie: acookie, body: payBody });
  check('no admin write route for payments -> 404', r.res.status === 404);
  r = await call('PUT', `/leads/${leadId}`, { cookie: acookie, body: leadBody });
  check('admin cannot edit a lead -> 403', r.res.status === 403);
  r = await call('POST', '/admin/leads', { cookie: acookie, body: leadBody });
  check('no admin write route for leads -> 404', r.res.status === 404);
  await call('POST', '/auth/logout', { cookie: acookie });
} else {
  console.log('SKIP admin checks (set SMOKE_ADMIN_ID and SMOKE_ADMIN_PASSWORD to run them)');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll smoke checks passed');
process.exit(failed ? 1 : 0);
