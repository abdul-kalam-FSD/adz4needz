import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createPaymentService } from '../src/modules/payments/payments.service.js';
import { formatMoney, fromDecimalString } from '../src/lib/money.js';

const bde = (id) => ({ id, role: 'bde', employeeId: 'E' + id, name: 'BDE ' + id });
const admin = { id: 1, role: 'admin', employeeId: 'ADM', name: 'Admin' };
const MAX = 1000;
const pad = (head) => Buffer.concat([Buffer.from(head), Buffer.alloc(64)]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = pad('%PDF-1.7\n');
const upload = (over = {}) => ({ body: PNG, contentType: 'image/png', fileName: 'proof.png', confirmDuplicate: false, ...over });
const status = (p, s) => assert.rejects(p, (e) => e.status === s, `expected HTTP ${s}`);
const pay = { leadId: 100, courseOrInternship: 'Full Stack', amountCommitted: '10000', commitmentDate: '2026-06-15' };
const inst = { amount: '4000', paidOn: '2026-06-20' };

// In-memory stand-ins. They mirror the SQL rules (scope, cap, duplicate) so SERVICE logic can be tested without MySQL.
function fakeRepo() {
  const leads = [{ id: 100, user_id: 10, candidate_name: 'Priya R', phone: '9876543210', email: 'p@x.com', course_or_internship: 'Full Stack' },
                 { id: 101, user_id: 11, candidate_name: 'Arun K', phone: '9000011111', email: null, course_or_internship: 'Data' }];
  const payments = []; const instalments = []; const receipts = []; const state = { failReceiptInsert: false, overviewRows: [] };
  let pid = 1; let iid = 1; let rid = 1;
  const paidOf = (paymentId, except) => instalments.filter((i) => i.payment_id === paymentId && i.id !== except).reduce((a, i) => a + fromDecimalString(i.amount), 0n);
  const row = (p) => { const l = leads.find((x) => x.id === Number(p.lead_id)); const mine = instalments.filter((i) => i.payment_id === p.id);
    return { ...p, bde_employee_id: 'E' + p.user_id, bde_name: 'BDE ' + p.user_id, candidate_name: l.candidate_name, phone: l.phone, email: l.email, lead_course: l.course_or_internship,
      paid_amount: formatMoney(paidOf(p.id)), instalment_count: mine.length, receipt_count: receipts.filter((r) => mine.some((i) => i.id === r.instalment_id)).length }; };
  const scoped = (scope) => (x) => scope == null || x.user_id === scope;
  return {
    state, payments, instalments, receipts,
    findOwnLead: async (leadId, userId) => leads.find((l) => String(l.id) === String(leadId) && l.user_id === userId) || null,
    insertPayment: async (leadId, userId, v) => { const id = pid++; payments.push({ id, lead_id: Number(leadId), user_id: userId, course_or_internship: v.courseOrInternship, amount_committed: formatMoney(v.amountCommitted), commitment_date: v.commitmentDate, created_at: 'c', updated_at: 'u' }); return id; },
    findPaymentById: async (id, scope) => { const p = payments.find((x) => String(x.id) === String(id) && scoped(scope)(x)); return p ? row(p) : null; },
    updatePayment: async (id, userId, v) => { const p = payments.find((x) => String(x.id) === String(id) && x.user_id === userId); if (!p) return { ok: false, reason: 'NOT_FOUND' };
      const paid = paidOf(p.id); if (v.amountCommitted < paid) return { ok: false, reason: 'BELOW_PAID', paid };
      Object.assign(p, { course_or_internship: v.courseOrInternship, amount_committed: formatMoney(v.amountCommitted), commitment_date: v.commitmentDate }); return { ok: true }; },
    listInstalments: async (paymentId) => { const out = []; for (const i of instalments.filter((x) => x.payment_id === Number(paymentId))) { const rs = receipts.filter((r) => r.instalment_id === i.id);
      const base = { instalment_id: i.id, amount: i.amount, paid_on: i.paid_on, instalment_created_at: 'c' };
      if (!rs.length) out.push({ ...base, receipt_id: null }); for (const r of rs) out.push({ ...base, receipt_id: r.id, original_name: r.original_name, mime_type: r.mime_type, size_bytes: r.size_bytes, uploaded_at: 'u' }); } return out; },
    findInstalment: async (id, scope) => instalments.find((x) => String(x.id) === String(id) && scoped(scope)(x)) || null,
    addInstalment: async ({ paymentId, userId, amount, paidOn, confirmDuplicate }) => { const p = payments.find((x) => String(x.id) === String(paymentId) && x.user_id === userId); if (!p) return { ok: false, reason: 'NOT_FOUND' };
      const same = instalments.find((i) => i.payment_id === p.id && i.amount === formatMoney(amount) && i.paid_on === paidOn); if (same && !confirmDuplicate) return { ok: false, reason: 'DUPLICATE', existingId: same.id };
      const outstanding = fromDecimalString(p.amount_committed) - paidOf(p.id); if (amount > outstanding) return { ok: false, reason: 'OVER', outstanding };
      const id = iid++; instalments.push({ id, payment_id: p.id, user_id: userId, amount: formatMoney(amount), paid_on: paidOn }); return { ok: true, id }; },
    updateInstalment: async ({ id, userId, amount, paidOn, confirmDuplicate }) => { const i = instalments.find((x) => x.id === Number(id) && x.user_id === userId); if (!i) return { ok: false, reason: 'NOT_FOUND' };
      const p = payments.find((x) => x.id === i.payment_id); const same = instalments.find((o) => o.id !== i.id && o.payment_id === p.id && o.amount === formatMoney(amount) && o.paid_on === paidOn);
      if (same && !confirmDuplicate) return { ok: false, reason: 'DUPLICATE', existingId: same.id };
      const outstanding = fromDecimalString(p.amount_committed) - paidOf(p.id, i.id); if (amount > outstanding) return { ok: false, reason: 'OVER', outstanding };
      Object.assign(i, { amount: formatMoney(amount), paid_on: paidOn }); return { ok: true, paymentId: p.id }; },
    countReceipts: async (instalmentId) => receipts.filter((r) => r.instalment_id === Number(instalmentId)).length,
    findReceiptsByHash: async (sha) => receipts.filter((r) => r.sha256 === sha).map((r) => ({ id: r.id, user_id: r.user_id, instalment_id: r.instalment_id })),
    insertReceipt: async (r) => { if (state.failReceiptInsert) throw new Error('db down'); const id = rid++; receipts.push({ id, instalment_id: Number(r.instalmentId), user_id: r.userId, original_name: r.originalName, stored_name: r.storedName, mime_type: r.mimeType, size_bytes: r.sizeBytes, sha256: r.sha256 }); return id; },
    proofCounts: async (userId) => ({ pending: receipts.filter((r) => r.user_id === userId).length, approved: 0, rejected: 0 }),
    findReceipt: async (id, scope) => receipts.find((r) => String(r.id) === String(id) && scoped(scope)(r)) || null,
    search: async ({ scopeUserId, filters }) => { calls.search.push({ scopeUserId, filters }); const list = payments.filter(scoped(scopeUserId)).filter((p) => !filters.bdeId || String(p.user_id) === String(filters.bdeId)); return { rows: list.map(row), total: list.length }; },
    overview: async (a) => { calls.overview.push(a); return state.overviewRows; }
  };
}
const calls = { search: [], overview: [] };
function fakeStorage() {
  const files = new Map(); let n = 0;
  return { files, root: '/secret/server/path',
    save: async (buf, ext) => { const name = `file-${++n}.${ext}`; files.set(name, buf); return name; },
    remove: async (name) => { files.delete(name); },
    stat: async (name) => { if (!files.has(name)) { const e = new Error('gone'); e.code = 'ENOENT'; throw e; } return { size: files.get(name).length }; },
    openRead: (name) => Readable.from([files.get(name)]) };
}
const make = () => { calls.search.length = 0; calls.overview.length = 0; const repo = fakeRepo(); const storage = fakeStorage(); return { repo, storage, svc: createPaymentService({ repo, storage, maxBytes: MAX }) }; };
async function seed(svc, who = bde(10), over = {}) { const p = await svc.create(who, { ...pay, ...over }); return p; }

test('create: owner comes from the SESSION; response has derived status, exact amounts, no admin block for BDEs', async () => {
  const { svc, repo } = make();
  const p = await svc.create(bde(10), { ...pay, userId: 11, user_id: 11, status: 'paid', amountPaid: '9999' });
  assert.equal(repo.payments[0].user_id, 10);
  assert.equal(p.status, 'pending'); assert.equal(p.amountCommitted, '10000.00'); assert.equal(p.amountPaid, '0.00'); assert.equal(p.amountOutstanding, '10000.00');
  assert.equal(p.lead.candidateName, 'Priya R'); assert.equal(p.courseOrInternship, 'Full Stack'); assert.equal('bde' in p, false);
});
test('create: validation -> 400 with fields; missing and foreign lead give the same 404; malformed id 400; admin 403', async () => {
  const { svc, repo } = make();
  await assert.rejects(svc.create(bde(10), { ...pay, amountCommitted: '-5', commitmentDate: 'x' }), (e) => e.status === 400 && e.code === 'VALIDATION_ERROR' && !!e.fields.amountCommitted && !!e.fields.commitmentDate);
  const foreign = await svc.create(bde(10), { ...pay, leadId: 101 }).catch((e) => e); const missing = await svc.create(bde(10), { ...pay, leadId: 99999 }).catch((e) => e);
  assert.equal(foreign.status, 404); assert.equal(missing.status, 404); assert.equal(foreign.message, missing.message);
  await status(svc.create(bde(10), { ...pay, leadId: 'abc' }), 400);
  await status(svc.create(admin, pay), 403);
  assert.equal(repo.payments.length, 0);
});
test('status is DERIVED: pending -> partially paid -> paid, with exact outstanding amounts', async () => {
  const { svc } = make();
  const p = await seed(svc);
  let r = await svc.addInstalment(bde(10), String(p.id), inst);
  assert.equal(r.payment.status, 'partially_paid'); assert.equal(r.payment.amountPaid, '4000.00'); assert.equal(r.payment.amountOutstanding, '6000.00'); assert.equal(r.payment.instalmentCount, 1);
  r = await svc.addInstalment(bde(10), String(p.id), { amount: 6000, paidOn: '2026-06-25' });
  assert.equal(r.payment.status, 'paid'); assert.equal(r.payment.amountOutstanding, '0.00');
  const d = await svc.get(bde(10), String(p.id));
  assert.deepEqual(d.instalments.map((i) => [i.amount, i.paidOn]), [['4000.00', '2026-06-20'], ['6000.00', '2026-06-25']]);
});
test('exact cents: 0.1 + 0.2 style amounts never drift', async () => {
  const { svc } = make();
  const p = await seed(svc, bde(10), { amountCommitted: '0.30' });
  await svc.addInstalment(bde(10), String(p.id), { amount: '0.10', paidOn: '2026-06-20' });
  const r = await svc.addInstalment(bde(10), String(p.id), { amount: '0.20', paidOn: '2026-06-21' });
  assert.equal(r.payment.status, 'paid'); assert.equal(r.payment.amountPaid, '0.30');
});
test('over-payment is rejected with the outstanding balance, and nothing is stored', async () => {
  const { svc, repo } = make();
  const p = await seed(svc); await svc.addInstalment(bde(10), String(p.id), inst);
  await assert.rejects(svc.addInstalment(bde(10), String(p.id), { amount: '6000.01', paidOn: '2026-06-25' }), (e) => e.status === 400 && /6000\.00/.test(e.fields.amount));
  assert.equal(repo.instalments.length, 1);
});
test('possible duplicate instalment -> 409 with the existing id; confirmDuplicate saves it; nothing merged', async () => {
  const { svc, repo } = make();
  const p = await seed(svc); const first = await svc.addInstalment(bde(10), String(p.id), { amount: '1000', paidOn: '2026-06-20' });
  await assert.rejects(svc.addInstalment(bde(10), String(p.id), { amount: '1000.00', paidOn: '2026-06-20' }), (e) => e.status === 409 && e.code === 'POSSIBLE_DUPLICATE_INSTALMENT' && e.details.existingInstalmentId === first.instalment.id);
  assert.equal(repo.instalments.length, 1);
  await svc.addInstalment(bde(10), String(p.id), { amount: '1000', paidOn: '2026-06-20', confirmDuplicate: true });
  assert.equal(repo.instalments.length, 2);
});
test('edit instalment re-checks the cap and duplicates; edit payment cannot go below what was received', async () => {
  const { svc } = make();
  const p = await seed(svc); const a = await svc.addInstalment(bde(10), String(p.id), inst); await svc.addInstalment(bde(10), String(p.id), { amount: '3000', paidOn: '2026-06-22' });
  await assert.rejects(svc.updateInstalment(bde(10), String(a.instalment.id), { amount: '7000.01', paidOn: '2026-06-20' }), (e) => e.status === 400 && !!e.fields.amount);
  const ok = await svc.updateInstalment(bde(10), String(a.instalment.id), { amount: '7000', paidOn: '2026-06-21' });
  assert.equal(ok.payment.status, 'paid'); assert.equal(ok.instalment.amount, '7000.00');
  await assert.rejects(svc.update(bde(10), String(p.id), { ...pay, amountCommitted: '9999.99' }), (e) => e.status === 400 && /10000\.00/.test(e.fields.amountCommitted));
  const up = await svc.update(bde(10), String(p.id), { ...pay, leadId: 101, courseOrInternship: 'Data Science', amountCommitted: '12000' });
  assert.equal(up.amountCommitted, '12000.00'); assert.equal(up.status, 'partially_paid'); assert.equal(up.lead.id, 100, 'leadId in an update is ignored');
});
test('OWNERSHIP: another BDE gets 404 for every payment, instalment and receipt operation; nothing changes', async () => {
  const { svc, repo } = make();
  const p = await seed(svc); const i = await svc.addInstalment(bde(10), String(p.id), inst); const rc = await svc.uploadReceipt(bde(10), String(i.instalment.id), upload());
  const other = bde(11);
  await status(svc.get(other, String(p.id)), 404);
  await status(svc.update(other, String(p.id), pay), 404);
  await status(svc.addInstalment(other, String(p.id), inst), 404);
  await status(svc.updateInstalment(other, String(i.instalment.id), inst), 404);
  await status(svc.uploadReceipt(other, String(i.instalment.id), upload({ body: pad([0xff, 0xd8, 0xff, 0xe0]), contentType: 'image/jpeg' })), 404);
  await status(svc.openReceipt(other, String(rc.id)), 404);
  assert.equal(repo.instalments.length, 1); assert.equal(repo.receipts.length, 1); assert.equal(repo.payments[0].amount_committed, '10000.00');
  const mine = await svc.list(other, { leadId: '100' }); assert.equal(mine.payments.length, 0, 'list scope is the session user');
  assert.equal(calls.search.at(-1).scopeUserId, 11);
});
test('ADMIN is read-only: sees payments, detail and proof with the responsible BDE, cannot write anything', async () => {
  const { svc } = make();
  const p = await seed(svc); const i = await svc.addInstalment(bde(10), String(p.id), inst); const rc = await svc.uploadReceipt(bde(10), String(i.instalment.id), upload());
  const d = await svc.get(admin, String(p.id));
  assert.equal(d.bde.employeeId, 'E10'); assert.equal(d.instalments[0].receipts[0].id, rc.id);
  const all = await svc.list(admin, {}); assert.equal(all.payments.length, 1); assert.equal(calls.search.at(-1).scopeUserId, null);
  assert.equal((await svc.openReceipt(admin, String(rc.id))).mime, 'image/png');
  await status(svc.create(admin, pay), 403); await status(svc.update(admin, String(p.id), pay), 403); await status(svc.addInstalment(admin, String(p.id), inst), 403);
  await status(svc.updateInstalment(admin, String(i.instalment.id), inst), 403); await status(svc.uploadReceipt(admin, String(i.instalment.id), upload()), 403);
  await status(svc.summary(admin, {}), 403);
  await status(svc.list({ id: 5, role: 'intern' }, {}), 403); await status(svc.openReceipt(undefined, '1'), 403);
});
test('upload: stores the file, returns metadata only, sanitises the display name', async () => {
  const { svc, storage, repo } = make();
  const p = await seed(svc); const i = await svc.addInstalment(bde(10), String(p.id), inst);
  const r = await svc.uploadReceipt(bde(10), String(i.instalment.id), upload({ fileName: '../../etc/evil<name>.png' }));
  assert.deepEqual(Object.keys(r).sort(), ['id', 'mimeType', 'originalName', 'sizeBytes']);
  assert.equal(r.originalName, 'evil_name_.png'); assert.equal(r.mimeType, 'image/png'); assert.equal(r.sizeBytes, PNG.length);
  assert.equal(storage.files.size, 1); assert.equal(repo.receipts[0].mime_type, 'image/png'); assert.match(repo.receipts[0].sha256, /^[0-9a-f]{64}$/);
  const d = await svc.get(bde(10), String(p.id));
  const json = JSON.stringify(d);
  assert.equal(/stored_name|storedName|file-1|\/secret/.test(json), false, 'no stored file name or disk path in API output');
  assert.deepEqual(d.receiptRules, { maxBytes: MAX, allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'], maxPerInstalment: 5 });
});
test('upload: wrong or disguised files are refused BEFORE anything is written', async () => {
  const { svc, storage } = make();
  const p = await seed(svc); const id = String((await svc.addInstalment(bde(10), String(p.id), inst)).instalment.id);
  const cases = [
    ['html labelled as png', upload({ body: pad('<html><script>alert(1)</script>'), contentType: 'image/png' }), 415],
    ['svg labelled as png', upload({ body: pad('<svg xmlns="http://www.w3.org/2000/svg"/>'), contentType: 'image/png' }), 415],
    ['png bytes labelled jpeg', upload({ contentType: 'image/jpeg' }), 415],
    ['pdf bytes labelled png', upload({ body: PDF, contentType: 'image/png' }), 415],
    ['no content type', upload({ contentType: undefined }), 415],
    ['body is not a buffer (json sent)', upload({ body: { hello: 'world' }, contentType: 'application/json' }), 415],
    ['empty file', upload({ body: Buffer.alloc(0) }), 400],
    ['too large', upload({ body: Buffer.concat([PNG, Buffer.alloc(MAX)]) }), 413]];
  for (const [name, args, code] of cases) await assert.rejects(svc.uploadReceipt(bde(10), id, args), (e) => e.status === code, name);
  assert.equal(storage.files.size, 0);
  await status(svc.uploadReceipt(bde(10), '999', upload()), 404); await status(svc.uploadReceipt(bde(10), 'abc', upload()), 400);
  const ok = await svc.uploadReceipt(bde(10), id, upload({ body: PDF, contentType: 'application/pdf; charset=binary' }));
  assert.equal(ok.mimeType, 'application/pdf');
});
test('upload: at most 5 files per instalment', async () => {
  const { svc } = make();
  const p = await seed(svc); const id = String((await svc.addInstalment(bde(10), String(p.id), inst)).instalment.id);
  for (let n = 0; n < 5; n++) await svc.uploadReceipt(bde(10), id, upload({ body: Buffer.concat([PNG, Buffer.from([n])]) }));
  await assert.rejects(svc.uploadReceipt(bde(10), id, upload({ body: Buffer.concat([PNG, Buffer.from([99])]) })), (e) => e.status === 409 && e.code === 'TOO_MANY_RECEIPTS');
});
test('upload: the same file twice is a warning (409), other BDEs only counted, confirm attaches it', async () => {
  const { svc, repo } = make();
  const p = await seed(svc); const a = String((await svc.addInstalment(bde(10), String(p.id), inst)).instalment.id);
  const b = String((await svc.addInstalment(bde(10), String(p.id), { amount: '1000', paidOn: '2026-06-23' })).instalment.id);
  await svc.uploadReceipt(bde(10), a, upload());
  await assert.rejects(svc.uploadReceipt(bde(10), b, upload()), (e) => e.status === 409 && e.code === 'POSSIBLE_DUPLICATE_RECEIPT' && e.details.own.length === 1 && e.details.otherBdeMatches === 0);
  const p2 = await svc.create(bde(11), { ...pay, leadId: 101 }); const c = String((await svc.addInstalment(bde(11), String(p2.id), inst)).instalment.id);
  await assert.rejects(svc.uploadReceipt(bde(11), c, upload()), (e) => e.status === 409 && e.details.own.length === 0 && e.details.otherBdeMatches === 1 && !JSON.stringify(e.details).includes('E10'));
  assert.equal(repo.receipts.length, 1);
  await svc.uploadReceipt(bde(10), b, upload({ confirmDuplicate: true }));
  assert.equal(repo.receipts.length, 2);
});
test('upload: when the database write fails the stored file is removed (no orphans) and the error propagates', async () => {
  const { svc, repo, storage } = make();
  const p = await seed(svc); const id = String((await svc.addInstalment(bde(10), String(p.id), inst)).instalment.id);
  repo.state.failReceiptInsert = true;
  await assert.rejects(svc.uploadReceipt(bde(10), id, upload()), /db down/);
  assert.equal(storage.files.size, 0);
});
test('download: owner and admin get a stream with type, size and a generated name; a missing file is a clean 404', async () => {
  const { svc, storage } = make();
  const p = await seed(svc); const id = String((await svc.addInstalment(bde(10), String(p.id), inst)).instalment.id);
  const rc = await svc.uploadReceipt(bde(10), id, upload({ body: PDF, contentType: 'application/pdf' }));
  const f = await svc.openReceipt(bde(10), String(rc.id));
  assert.equal(f.mime, 'application/pdf'); assert.equal(f.inline, false); assert.equal(f.ext, 'pdf'); assert.equal(f.size, PDF.length);
  const chunks = []; for await (const c of f.stream()) chunks.push(c); assert.ok(Buffer.concat(chunks).equals(PDF));
  const img = await svc.uploadReceipt(bde(10), id, upload()); assert.equal((await svc.openReceipt(admin, String(img.id))).inline, true);
  storage.files.clear();
  await status(svc.openReceipt(bde(10), String(rc.id)), 404); await status(svc.openReceipt(bde(10), '99999'), 404); await status(svc.openReceipt(bde(10), 'abc'), 400);
});
test('summary and overview: totals are sums of the BDE rows (BigInt, exact); overview is admin only; bad range is 400', async () => {
  const { svc, repo } = make();
  const row = (id, o) => ({ id, employee_id: 'E' + id, name: 'BDE ' + id, is_active: 1, payments: '2', committed: '20000.10', paid_toward: '5000.05', pending: '1', partially_paid: '1', paid_count: '0', paid_committed: '0.00', instalments: '3', received: '5000.05', ...o });
  repo.state.overviewRows = [row(10, {}), row(11, { payments: '1', committed: '0.20', paid_toward: '0.20', pending: '0', partially_paid: '0', paid_count: '1', paid_committed: '0.20', instalments: '1', received: '0.20' })];
  const o = await svc.overview(admin, { dateFrom: '2026-06-01', dateTo: '2026-06-30' });
  assert.deepEqual(o.totals, { payments: 3, committed: '20000.30', outstanding: '15000.05', pending: 1, partiallyPaid: 1, paid: 1, completedAmount: '0.20', instalments: 4, received: '5000.25' });
  assert.equal(o.bdes[0].outstanding, '15000.05'); assert.equal(o.bdes[1].outstanding, '0.00'); assert.deepEqual(calls.overview[0].range, { dateFrom: '2026-06-01', dateTo: '2026-06-30' });
  await status(svc.overview(bde(10), {}), 403); await status(svc.overview(admin, { dateFrom: '2026-07-01', dateTo: '2026-06-01' }), 400);
  repo.state.overviewRows = [row(10, {})];
  const s = await svc.summary(bde(10), {}); assert.equal(s.totals.committed, '20000.10'); assert.equal(calls.overview.at(-1).scopeUserId, 10);
  repo.state.overviewRows = []; assert.equal((await svc.summary(bde(10), {})).totals.committed, '0.00');
});
