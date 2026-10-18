// Integration tests for Payments: the REAL Express app, a REAL MySQL database and a REAL temporary folder for receipts.
// NOT part of `npm test` (which needs no database). Run with: npm run test:db
// Needs backend/.env pointing at a database where the Phase 6 migrations are applied (001-006, 007_payments, 008_payment_instalments,
// 009_payment_receipts, 010_deprecate_interview_payment_flag). On the merged tree `npm run migrate` applies all 12 files: see docs/migration-map.md.
// The test creates its own temporary users/leads/payments (employee IDs starting "itest-") and a temporary receipt
// folder, and removes them afterwards. Use a development database, not production.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm, readdir, stat, readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config/env.js';
import { createDb } from '../src/db/pool.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import { createReceiptStorage } from '../src/lib/receipt-storage.js';
import { createAuthRepository } from '../src/modules/auth/auth.repository.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createDailyReportRepository } from '../src/modules/daily-reports/daily-reports.repository.js';
import { createDailyReportService } from '../src/modules/daily-reports/daily-reports.service.js';
import { createAdminRepository } from '../src/modules/admin/admin.repository.js';
import { createAdminService } from '../src/modules/admin/admin.service.js';
import { createLeadRepository } from '../src/modules/leads/leads.repository.js';
import { createLeadService } from '../src/modules/leads/leads.service.js';
import { createInterviewRepository } from '../src/modules/interviews/interviews.repository.js';
import { createInterviewService } from '../src/modules/interviews/interviews.service.js';
import { createPaymentRepository } from '../src/modules/payments/payments.repository.js';
import { createPaymentService } from '../src/modules/payments/payments.service.js';

const PASSWORD = 'itest-' + randomBytes(9).toString('hex'); // random per run, never stored anywhere
const tag = randomBytes(3).toString('hex');
const MAX_BYTES = 4096; // small limit so the "too large" case is cheap

let db, server, base, statusId, storageBase, storageDir;
const ids = {};
const emp = Object.fromEntries(['bde1', 'bde2', 'bde3', 'admin'].map((k) => [k, 'itest-' + randomBytes(4).toString('hex')]));
const jars = {};

async function call(who, method, p, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (who && jars[who]) headers.Cookie = jars[who];
  const res = await fetch(base + '/api' + p, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data, res };
}
// Raw-body receipt upload (the body IS the file).
async function upload(who, instalmentId, bytes, { type = 'image/png', name = 'proof.png', query = '' } = {}) {
  const headers = {};
  if (type) headers['Content-Type'] = type;
  if (who && jars[who]) headers.Cookie = jars[who];
  const res = await fetch(`${base}/api/payment-instalments/${instalmentId}/receipts?name=${encodeURIComponent(name)}${query}`, { method: 'POST', headers, body: bytes });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}
async function download(who, p) {
  const headers = {};
  if (who && jars[who]) headers.Cookie = jars[who];
  const res = await fetch(base + p, { headers });
  return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
}
const png = (n = 200) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(n)]);
const jpg = (n = 200) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)]);
const pdf = (n = 200) => Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(n)]);

const usedPhones = new Set();
function uniquePhone() {
  let p;
  do { p = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'); } while (usedPhones.has(p));
  usedPhones.add(p);
  return p;
}
async function makeLead(who, name, course = 'Itest Course') {
  const r = await call(who, 'POST', '/leads', { candidateName: name, phone: uniquePhone(), courseOrInternship: course, leadStatusId: statusId });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.lead.id;
}
const pay = (leadId, over = {}) => ({ leadId, courseOrInternship: 'Itest Course', amountCommitted: '10000', commitmentDate: '2026-06-15', ...over });
async function makePayment(who, leadId, over) {
  const r = await call(who, 'POST', '/payments', pay(leadId, over));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.payment;
}
async function addInst(who, paymentId, amount, paidOn, extra = {}) {
  return call(who, 'POST', `/payments/${paymentId}/instalments`, { amount, paidOn, ...extra });
}
const dbOne = async (sql, params) => (await db.query(sql, params))[0];
const isFkError = (e) => e.errno === 1216 || e.errno === 1452;
const isCheckError = (e) => e.errno === 3819;
const filesOnDisk = async () => (await readdir(storageDir)).sort();

before(async () => {
  const config = loadConfig();
  db = createDb(config.db);
  storageBase = await mkdtemp(path.join(os.tmpdir(), 'bde-itest-receipts-'));
  storageDir = path.join(storageBase, 'receipts');
  const storage = createReceiptStorage({ dir: storageDir });
  await storage.init();
  const authService = createAuthService({ repo: createAuthRepository(db), ttlHours: 1 });
  const reportRepo = createDailyReportRepository(db);
  const app = createApp({
    config: { ...config, loginRateLimitMax: 1000, receiptMaxBytes: MAX_BYTES }, authService,
    reportService: createDailyReportService({ repo: reportRepo }),
    adminService: createAdminService({ adminRepo: createAdminRepository(db), reportRepo }),
    leadService: createLeadService({ repo: createLeadRepository(db) }),
    interviewService: createInterviewService({ repo: createInterviewRepository(db) }),
    paymentService: createPaymentService({ repo: createPaymentRepository(db), storage, maxBytes: MAX_BYTES }),
    checkDb: () => db.query('SELECT 1')
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  const hash = await hashPassword(PASSWORD);
  for (const [who, role] of [['bde1', 'bde'], ['bde2', 'bde'], ['bde3', 'bde'], ['admin', 'admin']]) {
    const r = await db.query('INSERT INTO users (employee_id, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP())', [emp[who], `Itest ${who}`, hash, role]);
    ids[who] = r.insertId;
    const login = await call(null, 'POST', '/auth/login', { employeeId: emp[who], password: PASSWORD });
    assert.equal(login.status, 200, 'login failed for ' + who);
    jars[who] = login.res.headers.get('set-cookie').split(';')[0];
  }
  statusId = (await db.query('SELECT id FROM lead_statuses WHERE is_active = 1 ORDER BY sort_order LIMIT 1'))[0].id;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) {
    const userIds = Object.values(ids);
    if (userIds.length) {
      const marks = userIds.map(() => '?').join(',');
      for (const table of ['payment_receipts', 'payment_instalments', 'payments', 'interviews', 'leads', 'sessions']) {
        await db.query(`DELETE FROM ${table} WHERE user_id IN (${marks})`, userIds); // children first (foreign keys)
      }
      await db.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
    }
    await db.close();
  }
  if (storageBase) await rm(storageBase, { recursive: true, force: true });
});

test('unauthenticated access is rejected; BDEs cannot use admin routes; Admin cannot write anything', async () => {
  for (const [m, p] of [['GET', '/payments'], ['GET', '/payments/summary'], ['GET', '/payments/1'], ['POST', '/payments'], ['PUT', '/payments/1'], ['POST', '/payments/1/instalments'],
    ['PUT', '/payment-instalments/1'], ['GET', '/payment-receipts/1/file'], ['GET', '/admin/payments'], ['GET', '/admin/payments/overview'], ['GET', '/admin/payments/1'], ['GET', '/admin/payment-receipts/1/file']]) {
    assert.equal((await call(null, m, p, {})).status, 401, `${m} ${p}`);
  }
  assert.equal((await upload(null, 1, png())).status, 401, 'upload without a session');
  const leadId = await makeLead('bde1', 'Itest Authz ' + tag);
  const mine = await makePayment('bde1', leadId);
  const inst = (await addInst('bde1', mine.id, '1000', '2026-06-20')).data.instalment;
  const rc = (await upload('bde1', inst.id, png())).data.receipt;
  assert.equal((await call('admin', 'POST', '/payments', pay(leadId))).status, 403);
  assert.equal((await call('admin', 'PUT', `/payments/${mine.id}`, pay(leadId))).status, 403);
  assert.equal((await call('admin', 'POST', `/payments/${mine.id}/instalments`, { amount: '1', paidOn: '2026-06-20' })).status, 403);
  assert.equal((await call('admin', 'PUT', `/payment-instalments/${inst.id}`, { amount: '1', paidOn: '2026-06-20' })).status, 403);
  assert.equal((await upload('admin', inst.id, png())).status, 403, 'admin cannot upload proof');
  assert.equal((await call('admin', 'GET', '/payments')).status, 403, 'admin uses /admin/payments');
  assert.equal((await call('admin', 'POST', '/admin/payments', pay(leadId))).status, 404, 'no admin write route');
  assert.equal((await call('admin', 'PUT', `/admin/payments/${mine.id}`, pay(leadId))).status, 404, 'no admin write route');
  assert.equal((await call('bde1', 'GET', '/admin/payments')).status, 403);
  assert.equal((await call('bde1', 'GET', '/admin/payments/overview')).status, 403);
  assert.equal((await call('bde1', 'GET', `/admin/payments/${mine.id}`)).status, 403);
  assert.equal((await download('bde1', `/api/admin/payment-receipts/${rc.id}/file`)).status, 403);
  assert.equal((await call('admin', 'GET', '/payments/summary')).status, 403);
});

test('create persists exactly; owner comes from the session; validation and lead-id handling are safe', async () => {
  const leadId = await makeLead('bde1', 'Itest Persist ' + tag);
  const r = await call('bde1', 'POST', '/payments', pay(leadId, { amountCommitted: '15000.50', courseOrInternship: '  Full Stack Internship ', userId: ids.bde2, user_id: ids.bde2, status: 'paid', amountPaid: '99999' }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const p = r.data.payment;
  assert.equal(p.amountCommitted, '15000.50'); assert.equal(p.amountPaid, '0.00'); assert.equal(p.amountOutstanding, '15000.50'); assert.equal(p.status, 'pending');
  assert.equal(p.courseOrInternship, 'Full Stack Internship'); assert.equal(p.lead.id, leadId); assert.equal(p.bde, undefined);
  assert.ok(!/user_id|password|hash/i.test(JSON.stringify(r.data)));
  const row = await dbOne('SELECT * FROM payments WHERE id = ?', [p.id]);
  assert.equal(row.amount_committed, '15000.50'); assert.equal(row.commitment_date, '2026-06-15'); assert.equal(Number(row.user_id), ids.bde1, 'owner from the session; forged body ignored');
  assert.equal(String(row.lead_id), String(leadId));

  // exact decimals at the extremes
  const lead2 = await makeLead('bde1', 'Itest Extremes ' + tag);
  assert.equal((await makePayment('bde1', lead2, { amountCommitted: '0.30' })).amountCommitted, '0.30');
  assert.equal((await makePayment('bde1', lead2, { amountCommitted: '9999999999.99' })).amountCommitted, '9999999999.99');
  assert.equal((await makePayment('bde1', lead2, { amountCommitted: 1250 })).amountCommitted, '1250.00');

  // validation: server rejects, nothing stored
  const before = Number((await dbOne('SELECT COUNT(*) n FROM payments WHERE user_id = ?', [ids.bde1])).n);
  for (const over of [{ amountCommitted: 0 }, { amountCommitted: '-5' }, { amountCommitted: '12.345' }, { amountCommitted: '1e5' }, { amountCommitted: 1e21 }, { amountCommitted: 'abc' }, { amountCommitted: '10000000000' }, { amountCommitted: '' },
    { commitmentDate: '2026-02-30' }, { commitmentDate: '15/06/2026' }, { commitmentDate: '' }, { courseOrInternship: '' }, { courseOrInternship: 'x'.repeat(151) }, { courseOrInternship: 'a\u0000b' }]) {
    const bad = await call('bde1', 'POST', '/payments', pay(leadId, over));
    assert.equal(bad.status, 400, JSON.stringify(over)); assert.equal(bad.data.error.code, 'VALIDATION_ERROR');
  }
  assert.equal(Number((await dbOne('SELECT COUNT(*) n FROM payments WHERE user_id = ?', [ids.bde1])).n), before, 'nothing inserted');

  // lead ids: missing and someone else's give the same answer; malformed is 400
  const others = await makeLead('bde2', 'Itest Other ' + tag);
  const missing = await call('bde1', 'POST', '/payments', pay(987654321));
  const foreign = await call('bde1', 'POST', '/payments', pay(others));
  assert.equal(missing.status, 404); assert.equal(foreign.status, 404); assert.deepEqual(missing.data, foreign.data, 'lead ids cannot be probed');
  for (const bad of ['abc', '0', -5, '1; DROP TABLE leads', null, undefined, '']) assert.equal((await call('bde1', 'POST', '/payments', pay(bad))).status, 400, JSON.stringify(bad));
  assert.equal((await call('bde1', 'GET', '/payments/abc')).status, 400);
  assert.equal((await call('bde1', 'GET', '/payments/987654321')).status, 404);
});

test('the DATABASE itself enforces ownership and positive amounts on all three payment tables', async () => {
  const leadId = await makeLead('bde1', 'Itest FK ' + tag);
  const p = await makePayment('bde1', leadId);
  const inst = (await addInst('bde1', p.id, '500', '2026-06-20')).data.instalment;
  const insP = (lead, user, amount = 100) => db.query("INSERT INTO payments (lead_id, user_id, course_or_internship, amount_committed, commitment_date, created_at, updated_at) VALUES (?, ?, 'x', ?, '2026-06-01', UTC_TIMESTAMP(), UTC_TIMESTAMP())", [lead, user, amount]);
  const insI = (payment, user, amount = 10) => db.query("INSERT INTO payment_instalments (payment_id, user_id, amount, paid_on, created_at, updated_at) VALUES (?, ?, ?, '2026-06-01', UTC_TIMESTAMP(), UTC_TIMESTAMP())", [payment, user, amount]);
  const insR = (instalment, user) => db.query("INSERT INTO payment_receipts (instalment_id, user_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_at) VALUES (?, ?, 'a.png', ?, 'image/png', 1, ?, UTC_TIMESTAMP())", [instalment, user, randomBytes(8).toString('hex'), 'a'.repeat(64)]);
  await assert.rejects(insP(leadId, ids.bde2), isFkError, 'payment for another BDE\'s lead');
  await assert.rejects(insP(987654321, ids.bde1), isFkError, 'payment for a missing lead');
  await assert.rejects(insP(leadId, ids.bde1, 0), isCheckError, 'zero commitment');
  await assert.rejects(insP(leadId, ids.bde1, -5), isCheckError, 'negative commitment');
  await assert.rejects(insI(p.id, ids.bde2), isFkError, 'instalment under another BDE');
  await assert.rejects(insI(987654321, ids.bde1), isFkError, 'instalment for a missing payment');
  await assert.rejects(insI(p.id, ids.bde1, 0), isCheckError, 'zero instalment');
  await assert.rejects(insI(p.id, ids.bde1, -1), isCheckError, 'negative instalment');
  await assert.rejects(insR(inst.id, ids.bde2), isFkError, 'receipt under another BDE');
  await assert.rejects(insR(987654321, ids.bde1), isFkError, 'receipt for a missing instalment');
  // the valid pairings work (fixture rows are removed again so later tests, e.g. the "no orphan files" check, see only real data)
  const okP = await insP(leadId, ids.bde1); const okI = await insI(p.id, ids.bde1); const okR = await insR(inst.id, ids.bde1);
  await db.query('DELETE FROM payment_receipts WHERE id = ?', [okR.insertId]);
  await db.query('DELETE FROM payment_instalments WHERE id = ?', [okI.insertId]);
  await db.query('DELETE FROM payments WHERE id = ?', [okP.insertId]);
});

test('partial payments: status is derived, over-payment and edits are checked, nothing is double counted', async () => {
  const leadId = await makeLead('bde1', 'Itest Partial ' + tag);
  const p = await makePayment('bde1', leadId, { amountCommitted: '10000' });
  let r = await addInst('bde1', p.id, '4000', '2026-06-20');
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.payment.status, 'partially_paid'); assert.equal(r.data.payment.amountPaid, '4000.00'); assert.equal(r.data.payment.amountOutstanding, '6000.00');
  const first = r.data.instalment;
  assert.equal((await dbOne('SELECT amount, paid_on, user_id FROM payment_instalments WHERE id = ?', [first.id])).amount, '4000.00');

  r = await addInst('bde1', p.id, '6000.01', '2026-06-25');
  assert.equal(r.status, 400); assert.match(r.data.error.fields.amount, /6000\.00/);
  assert.equal(Number((await dbOne('SELECT COUNT(*) n FROM payment_instalments WHERE payment_id = ?', [p.id])).n), 1, 'rejected over-payment stored nothing');

  r = await addInst('bde1', p.id, '6000', '2026-06-25');
  assert.equal(r.status, 201); assert.equal(r.data.payment.status, 'paid'); assert.equal(r.data.payment.amountOutstanding, '0.00');
  assert.equal((await addInst('bde1', p.id, '0.01', '2026-06-26')).status, 400, 'a fully paid payment accepts nothing more');
  const detail = (await call('bde1', 'GET', `/payments/${p.id}`)).data.payment;
  assert.deepEqual(detail.instalments.map((i) => [i.amount, i.paidOn]), [['4000.00', '2026-06-20'], ['6000.00', '2026-06-25']]);
  assert.equal(detail.instalmentCount, 2); assert.equal(detail.status, 'paid');

  // editing an instalment re-checks the cap
  assert.equal((await call('bde1', 'PUT', `/payment-instalments/${first.id}`, { amount: '4000.01', paidOn: '2026-06-20' })).status, 400);
  r = await call('bde1', 'PUT', `/payment-instalments/${first.id}`, { amount: '3000', paidOn: '2026-06-21' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.payment.status, 'partially_paid'); assert.equal(r.data.payment.amountOutstanding, '1000.00');
  assert.equal((await dbOne('SELECT amount, paid_on FROM payment_instalments WHERE id = ?', [first.id])).paid_on, '2026-06-21');

  // the commitment cannot drop below what was received; raising it changes the derived status
  r = await call('bde1', 'PUT', `/payments/${p.id}`, pay(leadId, { amountCommitted: '8999.99' }));
  assert.equal(r.status, 400); assert.match(r.data.error.fields.amountCommitted, /9000\.00/);
  r = await call('bde1', 'PUT', `/payments/${p.id}`, pay(leadId, { leadId: 99999999, amountCommitted: '9000', courseOrInternship: 'Data Science' }));
  assert.equal(r.status, 200); assert.equal(r.data.payment.status, 'paid'); assert.equal(r.data.payment.courseOrInternship, 'Data Science'); assert.equal(r.data.payment.lead.id, leadId, 'leadId in an update is ignored');
  r = await call('bde1', 'PUT', `/payments/${p.id}`, pay(leadId, { amountCommitted: '12000' }));
  assert.equal(r.data.payment.status, 'partially_paid'); assert.equal(r.data.payment.amountOutstanding, '3000.00');

  // a payment with no instalments is Pending
  assert.equal((await makePayment('bde1', leadId, { amountCommitted: '500' })).status, 'pending');
});

test('possible duplicate instalments: warned, never merged, confirmable; the check is atomic under parallel requests', async () => {
  const leadId = await makeLead('bde1', 'Itest Dup ' + tag);
  const p = await makePayment('bde1', leadId, { amountCommitted: '10000' });
  const first = await addInst('bde1', p.id, '1000', '2026-06-20');
  const dup = await addInst('bde1', p.id, '1000.00', '2026-06-20');
  assert.equal(dup.status, 409); assert.equal(dup.data.error.code, 'POSSIBLE_DUPLICATE_INSTALMENT'); assert.equal(dup.data.error.details.existingInstalmentId, first.data.instalment.id);
  assert.equal(Number((await dbOne('SELECT COUNT(*) n FROM payment_instalments WHERE payment_id = ?', [p.id])).n), 1);
  assert.equal((await addInst('bde1', p.id, '1000', '2026-06-20', { confirmDuplicate: true })).status, 201);
  assert.equal((await addInst('bde1', p.id, '1000', '2026-06-21')).status, 201, 'same amount on another day is not a duplicate');
  assert.equal((await addInst('bde1', p.id, '1000', '2026-06-22', { confirmDuplicate: 'true' })).status, 201, 'different date, no warning needed');
  const e = await call('bde1', 'PUT', `/payment-instalments/${first.data.instalment.id}`, { amount: '1000', paidOn: '2026-06-21' });
  assert.equal(e.status, 409, 'editing into a duplicate is warned too');

  // 6 identical requests at the same moment: exactly one is saved, the rest are warned
  const p2 = await makePayment('bde1', leadId, { amountCommitted: '10000' });
  const results = await Promise.all(Array.from({ length: 6 }, () => addInst('bde1', p2.id, '700', '2026-07-01')));
  assert.deepEqual(results.map((x) => x.status).sort(), [201, 409, 409, 409, 409, 409]);
  assert.equal(Number((await dbOne('SELECT COUNT(*) n FROM payment_instalments WHERE payment_id = ?', [p2.id])).n), 1);
});

test('PARALLEL instalments can never push the total above the commitment (row lock + transaction)', async () => {
  const leadId = await makeLead('bde1', 'Itest Race ' + tag);
  const p = await makePayment('bde1', leadId, { amountCommitted: '1000' });
  const days = Array.from({ length: 8 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`); // distinct dates: not duplicates
  const results = await Promise.all(days.map((d) => addInst('bde1', p.id, '300', d)));
  const ok = results.filter((r) => r.status === 201).length; const rejected = results.filter((r) => r.status === 400).length;
  assert.equal(ok, 3, JSON.stringify(results.map((r) => r.status))); assert.equal(rejected, 5);
  const sum = await dbOne('SELECT SUM(amount) s, COUNT(*) n FROM payment_instalments WHERE payment_id = ?', [p.id]);
  assert.equal(sum.s, '900.00'); assert.equal(Number(sum.n), 3);
  assert.ok(Number(sum.s) <= 1000);
  // raising one instalment while others are added at the same moment also respects the cap
  const detail = (await call('bde1', 'GET', `/payments/${p.id}`)).data.payment;
  const target = detail.instalments[0].id;
  const mixed = await Promise.all([call('bde1', 'PUT', `/payment-instalments/${target}`, { amount: '600', paidOn: '2026-07-01' }), addInst('bde1', p.id, '100', '2026-08-01'), addInst('bde1', p.id, '100', '2026-08-02')]);
  const total = Number((await dbOne('SELECT SUM(amount) s FROM payment_instalments WHERE payment_id = ?', [p.id])).s);
  assert.ok(total <= 1000, `total ${total} must not exceed the commitment`);
  assert.ok(mixed.every((r) => [200, 201, 400].includes(r.status)));
});

test('ownership: changing ids in the URL never reaches another BDE\'s payment, instalment or proof', async () => {
  const leadId = await makeLead('bde1', 'Itest Private ' + tag);
  const p = await makePayment('bde1', leadId);
  const inst = (await addInst('bde1', p.id, '1000', '2026-06-20')).data.instalment;
  const rc = (await upload('bde1', inst.id, png())).data.receipt;
  const filesBefore = await filesOnDisk();

  assert.equal((await call('bde2', 'GET', `/payments/${p.id}`)).status, 404);
  assert.equal((await call('bde2', 'PUT', `/payments/${p.id}`, pay(leadId, { amountCommitted: '1' }))).status, 404);
  assert.equal((await addInst('bde2', p.id, '500', '2026-06-21')).status, 404);
  assert.equal((await call('bde2', 'PUT', `/payment-instalments/${inst.id}`, { amount: '1', paidOn: '2026-06-21' })).status, 404);
  assert.equal((await upload('bde2', inst.id, png())).status, 404);
  assert.equal((await download('bde2', `/api/payment-receipts/${rc.id}/file`)).status, 404);
  assert.deepEqual((await call('bde2', 'GET', `/payments/${p.id}`)).data, (await call('bde2', 'GET', '/payments/987654321')).data, 'same answer as a non-existent id');
  assert.deepEqual(await filesOnDisk(), filesBefore, 'the other BDE\'s upload attempt wrote no file');

  const row = await dbOne('SELECT amount_committed, user_id FROM payments WHERE id = ?', [p.id]);
  assert.equal(row.amount_committed, '10000.00'); assert.equal(Number(row.user_id), ids.bde1);
  assert.equal((await dbOne('SELECT amount FROM payment_instalments WHERE id = ?', [inst.id])).amount, '1000.00');
  let r = await call('bde2', 'GET', `/payments?bdeId=${ids.bde1}&leadId=${leadId}`);
  assert.equal(r.status, 200); assert.equal(r.data.total, 0, 'bdeId / leadId cannot widen a BDE scope');
  assert.equal((await call('bde2', 'POST', '/payments', pay(leadId, { userId: ids.bde1 }))).status, 404, 'forged owner on someone else\'s lead');
});

test('totals: commitments and money received are each counted exactly once (hand-computed, cross-checked with raw SQL)', async () => {
  const L = async (n) => makeLead('bde3', `Itest Totals ${n} ${tag}`, `Course ${n}`);
  const [l1, l2, l3, l4] = [await L(1), await L(2), await L(3), await L(4)];
  const P1 = await makePayment('bde3', l1, { amountCommitted: '10000', commitmentDate: '2026-06-05', courseOrInternship: 'Totals One' });   // paid in 3 instalments
  const P2 = await makePayment('bde3', l2, { amountCommitted: '5000', commitmentDate: '2026-06-10', courseOrInternship: 'Totals Two' });    // partially paid
  const P3 = await makePayment('bde3', l3, { amountCommitted: '2000', commitmentDate: '2026-06-25', courseOrInternship: 'Totals Three' });  // pending
  const P4 = await makePayment('bde3', l4, { amountCommitted: '3000', commitmentDate: '2026-05-30', courseOrInternship: 'Totals Four' });   // committed in May, paid in June
  for (const [pid, amt, day] of [[P1.id, '2500', '2026-06-06'], [P1.id, '2500', '2026-06-20'], [P1.id, '5000', '2026-07-02'], [P2.id, '1000', '2026-06-12'], [P4.id, '3000', '2026-06-02']]) {
    assert.equal((await addInst('bde3', pid, amt, day)).status, 201);
  }

  const ov = (await call('admin', 'GET', '/admin/payments/overview')).data;
  const row = ov.bdes.find((b) => b.employeeId === emp.bde3);
  assert.deepEqual({ ...row, id: undefined, name: undefined, employeeId: undefined, isActive: undefined },
    { id: undefined, name: undefined, employeeId: undefined, isActive: undefined, payments: 4, committed: '20000.00', outstanding: '6000.00', pending: 1, partiallyPaid: 1, paid: 2, completedAmount: '13000.00', instalments: 5, received: '14000.00' },
    'commitments 10000+5000+2000+3000 = 20000 (NOT multiplied by instalments); received 2500+2500+5000+1000+3000 = 14000');
  // independent cross-check with plain SQL (no joins between the two tables)
  assert.equal((await dbOne('SELECT SUM(amount_committed) s FROM payments WHERE user_id = ?', [ids.bde3])).s, '20000.00');
  assert.equal((await dbOne('SELECT SUM(amount) s FROM payment_instalments WHERE user_id = ?', [ids.bde3])).s, '14000.00');

  // June only: commitments dated in June (P1, P2, P3); money paid in June (P1 x2, P2, P4's June instalment). P4's commitment (May) and P1's July instalment are out.
  const june = (await call('admin', 'GET', '/admin/payments/overview?dateFrom=2026-06-01&dateTo=2026-06-30')).data.bdes.find((b) => b.employeeId === emp.bde3);
  assert.deepEqual({ ...june, id: undefined, name: undefined, employeeId: undefined, isActive: undefined },
    { id: undefined, name: undefined, employeeId: undefined, isActive: undefined, payments: 3, committed: '17000.00', outstanding: '6000.00', pending: 1, partiallyPaid: 1, paid: 1, completedAmount: '10000.00', instalments: 4, received: '9000.00' },
    'June: committed 17000, paid toward them 11000 -> outstanding 6000; cash received in June 9000');
  const single = (await call('admin', 'GET', '/admin/payments/overview?dateFrom=2026-06-20&dateTo=2026-06-20')).data.bdes.find((b) => b.employeeId === emp.bde3);
  assert.equal(single.received, '2500.00'); assert.equal(single.payments, 0, 'range ends are inclusive and independent per kind');

  // the BDE's own summary equals the admin row; a BDE with nothing shows zeros; team totals are the sum of the rows
  const mine = (await call('bde3', 'GET', '/payments/summary')).data;
  assert.deepEqual(mine.totals, { payments: 4, committed: '20000.00', outstanding: '6000.00', pending: 1, partiallyPaid: 1, paid: 2, completedAmount: '13000.00', instalments: 5, received: '14000.00' });
  assert.equal((await call('bde3', 'GET', '/payments/summary?dateFrom=2026-06-01&dateTo=2026-06-30')).data.totals.received, '9000.00');
  const zero = ov.bdes.find((b) => b.employeeId === emp.bde2);
  assert.ok(zero, 'a BDE with no payments still appears'); assert.equal(zero.committed, '0.00'); assert.equal(zero.received, '0.00'); assert.equal(zero.payments, 0);
  const cents = (s) => BigInt(s.replace('.', ''));
  for (const k of ['committed', 'outstanding', 'completedAmount', 'received']) assert.equal(ov.bdes.reduce((a, b) => a + cents(b[k]), 0n), cents(ov.totals[k]), `total ${k}`);
  for (const k of ['payments', 'pending', 'partiallyPaid', 'paid', 'instalments']) assert.equal(ov.bdes.reduce((a, b) => a + b[k], 0), ov.totals[k], `total ${k}`);

  // list filters (scoped to bde3, whose data is known); the SQL status filter agrees with the status shown
  const names = (r) => r.data.payments.map((x) => x.courseOrInternship).sort();
  const list = (qs) => call('bde3', 'GET', '/payments?' + qs);
  assert.deepEqual(names(await list('')), ['Totals Four', 'Totals One', 'Totals Three', 'Totals Two']);
  assert.deepEqual(names(await list('status=paid')), ['Totals Four', 'Totals One']);
  assert.deepEqual(names(await list('status=partially_paid')), ['Totals Two']);
  assert.deepEqual(names(await list('status=pending')), ['Totals Three']);
  const all = (await list('')).data.payments;
  for (const x of all) assert.ok((await list('status=' + x.status)).data.payments.some((y) => y.id === x.id), `${x.courseOrInternship}: displayed status matches the SQL filter`);
  assert.deepEqual(names(await list('commitmentFrom=2026-06-05&commitmentTo=2026-06-10')), ['Totals One', 'Totals Two'], 'inclusive dates');
  assert.deepEqual(names(await list('q=Totals%20Three')), ['Totals Three']);
  assert.deepEqual(names(await list(`q=${encodeURIComponent('Itest Totals 2 ' + tag)}`)), ['Totals Two'], 'search matches the candidate name');
  assert.deepEqual(names(await list(`leadId=${l1}`)), ['Totals One']);
  assert.equal((await list(`q=${encodeURIComponent("' OR 1=1 --")}`)).data.total, 0); assert.equal((await list('q=%25')).data.total, 0, '% is literal');
  assert.equal((await list('pageSize=3&page=2')).data.payments.length, 1);
  assert.equal((await list('')).data.payments[0].commitmentDate, '2026-06-25', 'newest commitment first');
  const p1 = all.find((x) => x.courseOrInternship === 'Totals One');
  assert.equal(p1.amountPaid, '10000.00'); assert.equal(p1.instalmentCount, 3);
  for (const q of ['status=done', 'status=paid&status=pending', 'commitmentFrom=2026-07-01&commitmentTo=2026-06-01', 'pageSize=1000', 'leadId=abc', 'missingProof=no', 'commitmentFrom=nope']) assert.equal((await list(q)).status, 400, q);
  for (const q of ['dateFrom=2026-07-01&dateTo=2026-06-01', 'dateFrom=nope']) assert.equal((await call('admin', 'GET', '/admin/payments/overview?' + q)).status, 400, q);
});

test('receipt upload: only real JPEG/PNG/PDF within the size limit, stored privately, no orphans, abuse refused', async () => {
  const leadId = await makeLead('bde1', 'Itest Upload ' + tag);
  const p = await makePayment('bde1', leadId);
  const inst = (await addInst('bde1', p.id, '1000', '2026-06-20')).data.instalment;
  const dirMode = (await stat(storageDir)).mode & 0o777;
  assert.equal(dirMode, 0o700, 'receipt folder is owner-only');

  // valid files of every allowed type
  const sent = {};
  for (const [kind, bytes, type] of [['png', png(), 'image/png'], ['jpg', jpg(), 'image/jpeg'], ['pdf', pdf(), 'application/pdf']]) {
    const r = await upload('bde1', inst.id, bytes, { type, name: `proof.${kind}` });
    assert.equal(r.status, 201, `${kind}: ${JSON.stringify(r.data)}`);
    sent[kind] = { bytes, id: r.data.receipt.id };
    assert.deepEqual(Object.keys(r.data.receipt).sort(), ['id', 'mimeType', 'originalName', 'sizeBytes']);
    const row = await dbOne('SELECT * FROM payment_receipts WHERE id = ?', [r.data.receipt.id]);
    assert.equal(row.mime_type, type); assert.equal(Number(row.size_bytes), bytes.length);
    assert.equal(row.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.match(row.stored_name, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png|pdf)$/, 'server-generated random name');
    assert.ok(!row.stored_name.includes('proof'), 'the uploaded name never reaches the disk name');
    const onDisk = path.join(storageDir, row.stored_name);
    assert.ok(bytes.equals(await readFile(onDisk)), 'stored bytes are unchanged');
    assert.equal((await stat(onDisk)).mode & 0o777, 0o600, 'file is owner-only');
    assert.ok(!JSON.stringify(r.data).includes(row.stored_name) && !JSON.stringify(r.data).includes(storageBase), 'no stored name or disk path in the response');
  }
  const detail = (await call('bde1', 'GET', `/payments/${p.id}`)).data.payment;
  assert.equal(detail.receiptCount, 3); assert.equal(detail.instalments[0].receipts.length, 3);
  assert.ok(!/stored|\/tmp\/|\.png"|\.pdf"/.test(JSON.stringify(detail.instalments[0].receipts.map((x) => Object.keys(x)))), 'metadata only');
  assert.deepEqual(detail.receiptRules, { maxBytes: MAX_BYTES, allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'], maxPerInstalment: 5 });

  // display name is sanitised
  const named = await upload('bde1', inst.id, png(), { name: '../../etc/<evil>.png' });
  assert.equal(named.data.receipt.originalName, '_evil_.png');

  // refused uploads write nothing
  const filesBefore = await filesOnDisk();
  const rowsBefore = Number((await dbOne('SELECT COUNT(*) n FROM payment_receipts WHERE user_id = ?', [ids.bde1])).n);
  const html = Buffer.concat([Buffer.from('<!DOCTYPE html><html><script>alert(1)</script>'), randomBytes(60)]);
  const svg = Buffer.concat([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), randomBytes(20)]);
  const refused = [
    ['html labelled image/png', upload('bde1', inst.id, html, { type: 'image/png' }), 415],
    ['svg labelled image/png', upload('bde1', inst.id, svg, { type: 'image/png' }), 415],
    ['svg declared as image/svg+xml', upload('bde1', inst.id, svg, { type: 'image/svg+xml' }), 415],
    ['png bytes labelled image/jpeg', upload('bde1', inst.id, png(), { type: 'image/jpeg' }), 415],
    ['pdf bytes labelled image/png', upload('bde1', inst.id, pdf(), { type: 'image/png' }), 415],
    ['plain text', upload('bde1', inst.id, Buffer.from('just text, not a receipt at all'), { type: 'text/plain' }), 415],
    ['octet-stream', upload('bde1', inst.id, png(), { type: 'application/octet-stream' }), 415],
    ['no content type', upload('bde1', inst.id, png(), { type: null }), 415],
    ['multipart (browser form post)', upload('bde1', inst.id, png(), { type: 'multipart/form-data; boundary=x' }), 415],
    ['urlencoded (browser form post)', upload('bde1', inst.id, Buffer.from('a=b'), { type: 'application/x-www-form-urlencoded' }), 415],
    ['json body sent to the upload route', upload('bde1', inst.id, Buffer.from('{"a":1}'), { type: 'application/json' }), 415],
    ['too large', upload('bde1', inst.id, png(MAX_BYTES), { type: 'image/png' }), 413],
    ['empty body', upload('bde1', inst.id, Buffer.alloc(0), { type: 'image/png' }), null]
  ];
  for (const [name, promise, expected] of refused) {
    const r = await promise;
    if (expected) assert.equal(r.status, expected, name); else assert.ok(r.status >= 400 && r.status < 500, `${name}: got ${r.status}`);
    assert.ok(r.data && r.data.error, `${name}: JSON error body`);
  }
  assert.deepEqual(await filesOnDisk(), filesBefore, 'no file written by any refused upload');
  assert.equal(Number((await dbOne('SELECT COUNT(*) n FROM payment_receipts WHERE user_id = ?', [ids.bde1])).n), rowsBefore);

  // instalment id handling
  assert.equal((await upload('bde1', 'abc', png())).status, 400);
  assert.equal((await upload('bde1', 987654321, png())).status, 404);
  assert.deepEqual(await filesOnDisk(), filesBefore);

  // at most 5 files per instalment (4 so far on this instalment: png, jpg, pdf, named)
  assert.equal((await upload('bde1', inst.id, png())).status, 201);
  const sixth = await upload('bde1', inst.id, png());
  assert.equal(sixth.status, 409); assert.equal(sixth.data.error.code, 'TOO_MANY_RECEIPTS');

  // no orphans: every row has its file and every file has its row
  const rows = await db.query('SELECT stored_name FROM payment_receipts WHERE user_id IN (?, ?, ?)', [ids.bde1, ids.bde2, ids.bde3]);
  assert.deepEqual(rows.map((r) => r.stored_name).sort(), await filesOnDisk());
});

test('duplicate proof files are warned about; other BDEs\' records are only counted', async () => {
  const lead1 = await makeLead('bde1', 'Itest DupFile ' + tag); const lead2 = await makeLead('bde2', 'Itest DupFileB ' + tag);
  const p1 = await makePayment('bde1', lead1); const p2 = await makePayment('bde2', lead2);
  const i1a = (await addInst('bde1', p1.id, '1000', '2026-06-20')).data.instalment; const i1b = (await addInst('bde1', p1.id, '1000', '2026-06-21')).data.instalment;
  const i2 = (await addInst('bde2', p2.id, '1000', '2026-06-20')).data.instalment;
  const shared = png(300);
  assert.equal((await upload('bde1', i1a.id, shared)).status, 201);
  const ownDup = await upload('bde1', i1b.id, shared);
  assert.equal(ownDup.status, 409); assert.equal(ownDup.data.error.code, 'POSSIBLE_DUPLICATE_RECEIPT');
  assert.equal(ownDup.data.error.details.own.length, 1); assert.equal(ownDup.data.error.details.otherBdeMatches, 0);
  const otherDup = await upload('bde2', i2.id, shared);
  assert.equal(otherDup.status, 409); assert.equal(otherDup.data.error.details.own.length, 0); assert.equal(otherDup.data.error.details.otherBdeMatches, 1);
  assert.ok(!JSON.stringify(otherDup.data).includes(String(i1a.id)), 'nothing about the other BDE\'s instalment is revealed');
  const files = await filesOnDisk();
  assert.equal((await upload('bde1', i1b.id, shared, { query: '&confirmDuplicate=1' })).status, 201, 'explicit confirmation attaches it');
  assert.equal((await filesOnDisk()).length, files.length + 1);
});

test('receipt download: owner and Admin only, safe headers, never reachable as a static file', async () => {
  const leadId = await makeLead('bde1', 'Itest Download ' + tag);
  const p = await makePayment('bde1', leadId);
  const inst = (await addInst('bde1', p.id, '1000', '2026-06-20')).data.instalment;
  const img = png(300); const doc = pdf(300);
  const imgRc = (await upload('bde1', inst.id, img, { type: 'image/png', name: 'screen.png' })).data.receipt;
  const docRc = (await upload('bde1', inst.id, doc, { type: 'application/pdf', name: 'bank.pdf' })).data.receipt;

  let r = await download('bde1', `/api/payment-receipts/${imgRc.id}/file`);
  assert.equal(r.status, 200); assert.ok(r.buf.equals(img), 'owner gets the exact bytes');
  assert.equal(r.headers.get('content-type'), 'image/png'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('cache-control'), /no-store/); assert.match(r.headers.get('content-security-policy'), /default-src 'none'; sandbox/);
  assert.equal(r.headers.get('content-disposition'), `inline; filename="receipt-${imgRc.id}.png"`, 'generated name, not the uploaded one');
  assert.equal(r.headers.get('content-length'), String(img.length));
  r = await download('bde1', `/api/payment-receipts/${docRc.id}/file`);
  assert.equal(r.status, 200); assert.ok(r.buf.equals(doc)); assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(r.headers.get('content-disposition'), `attachment; filename="receipt-${docRc.id}.pdf"`, 'PDFs are downloaded, not rendered');

  r = await download('admin', `/api/admin/payment-receipts/${imgRc.id}/file`);
  assert.equal(r.status, 200); assert.ok(r.buf.equals(img), 'admin can view proof across the team');
  assert.equal((await download(null, `/api/payment-receipts/${imgRc.id}/file`)).status, 401);
  assert.equal((await download('bde2', `/api/payment-receipts/${imgRc.id}/file`)).status, 404);
  assert.equal((await download('bde2', `/api/admin/payment-receipts/${imgRc.id}/file`)).status, 403);
  assert.equal((await download('admin', `/api/payment-receipts/${imgRc.id}/file`)).status, 403, 'admin uses the admin path');
  assert.equal((await download('bde1', '/api/payment-receipts/abc/file')).status, 400);
  assert.equal((await download('bde1', '/api/payment-receipts/987654321/file')).status, 404);
  for (const bad of ['..%2f..%2f..%2fetc%2fpasswd', '%2e%2e%2f%2e%2e%2fetc%2fpasswd', '1%2f..%2f..%2fx']) {
    const t = await download('bde1', `/api/payment-receipts/${bad}/file`);
    assert.ok([400, 404].includes(t.status), `${bad} -> ${t.status}`); assert.ok(!t.buf.includes('root:'));
  }

  // never reachable as a static file under any plausible URL
  const stored = (await dbOne('SELECT stored_name FROM payment_receipts WHERE id = ?', [imgRc.id])).stored_name;
  for (const url of [`/${stored}`, `/receipts/${stored}`, `/storage/receipts/${stored}`, `/api/receipts/${stored}`, `/uploads/${stored}`, `/api/uploads/${stored}`, `/api/payment-receipts/${stored}`]) {
    const t = await download('admin', url);
    assert.equal(t.status, 404, url); assert.ok(!t.buf.equals(img), url);
  }

  // a file missing on disk is a clean 404, not a crash or a leak
  await unlink(path.join(storageDir, stored));
  r = await download('bde1', `/api/payment-receipts/${imgRc.id}/file`);
  assert.equal(r.status, 404); assert.ok(!r.buf.toString().includes(storageBase), 'no server path in the error');
  assert.equal((await download('bde1', `/api/payment-receipts/${docRc.id}/file`)).status, 200, 'other files unaffected');
});

test('Admin: team-wide read-only view with the responsible BDE, filters, detail with proof metadata, missing-proof filter', async () => {
  const lead = await makeLead('bde1', 'Itest AdminView ' + tag, 'AV Course');
  const p = await makePayment('bde1', lead, { courseOrInternship: 'AV Course' });
  const withProof = (await addInst('bde1', p.id, '1000', '2026-06-20')).data.instalment;
  const noProof = (await addInst('bde1', p.id, '2000', '2026-06-21')).data.instalment;
  const rc = (await upload('bde1', withProof.id, png(), { name: 'view.png' })).data.receipt;

  let r = await call('admin', 'GET', `/admin/payments?q=${encodeURIComponent('Itest AdminView ' + tag)}`);
  assert.equal(r.status, 200); assert.equal(r.data.total, 1);
  assert.equal(r.data.payments[0].bde.employeeId, emp.bde1); assert.equal(r.data.payments[0].bde.name, 'Itest bde1');
  assert.equal(r.data.payments[0].receiptCount, 1); assert.equal(r.data.payments[0].status, 'partially_paid');
  r = await call('admin', 'GET', `/admin/payments/${p.id}`);
  assert.equal(r.status, 200); assert.equal(r.data.payment.bde.employeeId, emp.bde1);
  const insts = r.data.payment.instalments;
  assert.equal(insts.length, 2); assert.equal(insts.find((i) => i.id === withProof.id).receipts[0].id, rc.id); assert.equal(insts.find((i) => i.id === noProof.id).receipts.length, 0);
  assert.ok(!JSON.stringify(r.data).includes('stored_name') && !JSON.stringify(r.data).includes(storageBase));

  // BDE filter and the missing-proof filter (an instalment without any file)
  r = await call('admin', 'GET', `/admin/payments?bdeId=${ids.bde3}`);
  assert.equal(r.data.total, 4); assert.ok(r.data.payments.every((x) => x.bde.employeeId === emp.bde3));
  assert.equal((await call('admin', 'GET', '/admin/payments?bdeId=987654321')).data.total, 0);
  r = await call('admin', 'GET', `/admin/payments?bdeId=${ids.bde1}&missingProof=yes&q=AdminView`);
  assert.equal(r.data.total, 1, 'has an instalment without proof');
  await upload('bde1', noProof.id, png());
  r = await call('admin', 'GET', `/admin/payments?bdeId=${ids.bde1}&missingProof=yes&q=AdminView`);
  assert.equal(r.data.total, 0, 'every instalment now has proof');
  assert.equal((await call('admin', 'GET', '/admin/payments?bdeId=abc')).status, 400);
  assert.equal((await call('admin', 'GET', '/admin/payments/987654321')).status, 404);
  assert.equal((await call('admin', 'GET', '/admin/payments/abc')).status, 400);
  assert.equal((await call('admin', 'GET', '/admin/payments?status=bogus')).status, 400);
});

test('interview "payment confirmed" is derived from payment records and stays consistent (Phase 6)', async () => {
  const L = await makeLead('bde2', 'Itest Derived ' + tag); const other = await makeLead('bde2', 'Itest Derived Other ' + tag);
  const iv = (leadId, over = {}) => ({ leadId, scheduledAt: '2026-06-20T10:00', attendance: 'pending', outcome: 'pending', interestedInJoining: null, ...over });
  const created = (await call('bde2', 'POST', '/interviews', iv(L, { paymentConfirmed: true }))).data.interview; // typed value must be ignored
  assert.equal(created.paymentConfirmed, false, 'no payment record yet; the typed value is ignored');
  assert.equal((await dbOne('SELECT payment_confirmed FROM interviews WHERE id = ?', [created.id])).payment_confirmed, 0, 'legacy column never written');
  const confirmed = async (qs) => (await call('bde2', 'GET', '/interviews?' + qs)).data.interviews.map((i) => i.id);
  assert.ok((await confirmed('paymentConfirmed=no')).includes(created.id)); assert.ok(!(await confirmed('paymentConfirmed=yes')).includes(created.id));

  const p = await makePayment('bde2', L); // a commitment exists -> confirmed
  assert.equal((await call('bde2', 'GET', `/interviews/${created.id}`)).data.interview.paymentConfirmed, true);
  assert.ok((await confirmed('paymentConfirmed=yes')).includes(created.id)); assert.ok(!(await confirmed('paymentConfirmed=no')).includes(created.id));
  assert.equal((await call('admin', 'GET', `/admin/interviews/${created.id}`)).data.interview.paymentConfirmed, true, 'admin sees the same derived value');
  const put = await call('bde2', 'PUT', `/interviews/${created.id}`, iv(L, { paymentConfirmed: false }));
  assert.equal(put.status, 200); assert.equal(put.data.interview.paymentConfirmed, true, 'editing the interview cannot un-confirm a lead that has a payment record');

  // a payment on a DIFFERENT lead does not confirm this interview; instalments do not change the (commitment-based) rule
  const otherInterview = (await call('bde2', 'POST', '/interviews', iv(other))).data.interview;
  assert.equal(otherInterview.paymentConfirmed, false);
  await addInst('bde2', p.id, '500', '2026-06-21');
  assert.equal((await call('bde2', 'GET', `/interviews/${otherInterview.id}`)).data.interview.paymentConfirmed, false);

  // admin interview overview counts the derived flag
  const row = (await call('admin', 'GET', '/admin/interviews/overview')).data.bdes.find((b) => b.employeeId === emp.bde2);
  assert.equal(row.scheduled, 2); assert.equal(row.paymentConfirmed, 1);
});
