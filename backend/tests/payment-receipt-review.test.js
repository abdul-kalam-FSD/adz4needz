import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPaymentService } from '../src/modules/payments/payments.service.js';

const admin = { id: 1, role: 'admin' }; const bde = { id: 10, role: 'bde' };

function fakeRepo() {
  const receipt = { id: 5, review_status: 'pending', review_note: null, reviewed_at: null, reviewer_name: null, reviewer_employee_id: null };
  const calls = [];
  return {
    receipt, calls,
    reviewReceipt: async (a) => { calls.push(a); if (a.id !== '5') return false; Object.assign(receipt, { review_status: a.decision, review_note: a.note, reviewed_at: '2026-10-13 10:00:00', reviewer_name: 'Admin', reviewer_employee_id: 'ADM' }); return true; },
    findReceiptReview: async () => ({ ...receipt }),
    findPaymentById: async (id, scope) => (String(id) === '7' && (scope === null || scope === 10)
      ? { id: 7, lead_id: 1, user_id: 10, course_or_internship: 'Java', amount_committed: '1000.00', commitment_date: '2026-10-01', created_at: 'c', updated_at: 'u', bde_employee_id: 'E10', bde_name: 'BDE', candidate_name: 'P', phone: '9', email: null, lead_course: 'Java', paid_amount: '500.00', instalment_count: 1, receipt_count: 1 } : null),
    overview: async () => [],
    proofCounts: async (id) => { calls.push({ proofCountsFor: id }); return { pending: 2, approved: 3, rejected: 1 }; },
    listInstalments: async () => [{ instalment_id: 3, amount: '500.00', paid_on: '2026-10-05', instalment_created_at: 'c', receipt_id: 5, original_name: 'r.png', mime_type: 'image/png', size_bytes: 10, uploaded_at: 'u', ...receipt }]
  };
}
const make = () => { const repo = fakeRepo(); return { repo, svc: createPaymentService({ repo, storage: {}, maxBytes: 1000 }) }; };
const code = (p, status) => assert.rejects(p, (e) => e.status === status);

test('only an admin can review a proof (BDE and anonymous are refused, nothing is written)', async () => {
  const { svc, repo } = make();
  for (const a of [bde, null, { id: 3, role: 'x' }]) await code(svc.reviewReceipt(a, '5', { decision: 'approved' }), 403);
  assert.equal(repo.calls.length, 0);
});

test('approve works with or without a note; the reviewer and time are recorded', async () => {
  const { svc, repo } = make();
  const r = await svc.reviewReceipt(admin, '5', { decision: 'approved' });
  assert.deepEqual(r, { id: 5, reviewStatus: 'approved', reviewNote: null, reviewedAt: '2026-10-13 10:00:00', reviewedBy: { name: 'Admin', employeeId: 'ADM' } });
  assert.equal(repo.calls[0].reviewerId, 1);
  const r2 = await svc.reviewReceipt(admin, '5', { decision: 'approved', note: '  Matches bank statement ' });
  assert.equal(r2.reviewNote, 'Matches bank statement');
});

test('reject needs a reason; invalid decision / note / id are rejected before any write', async () => {
  const { svc, repo } = make();
  for (const body of [{ decision: 'rejected' }, { decision: 'rejected', note: '   ' }, { decision: 'maybe' }, {}, { decision: 'approved', note: 'x'.repeat(301) }, { decision: 'approved', note: 'a\u0000b' }, { decision: 'approved', note: 5 }, null, []]) {
    await code(svc.reviewReceipt(admin, '5', body), 400);
  }
  for (const id of ['abc', '0', '5; DROP', undefined]) await code(svc.reviewReceipt(admin, id, { decision: 'approved' }), 400);
  assert.equal(repo.calls.length, 0);
  const rej = await svc.reviewReceipt(admin, '5', { decision: 'rejected', note: 'Amount not visible' });
  assert.equal(rej.reviewStatus, 'rejected'); assert.equal(rej.reviewNote, 'Amount not visible');
});

test('a receipt that does not exist is 404', async () => {
  const { svc } = make();
  await code(svc.reviewReceipt(admin, '999', { decision: 'approved' }), 404);
});

test('the BDE and the admin both see review status on the payment detail; unreviewed proofs read as pending', async () => {
  const { svc, repo } = make();
  let d = await svc.get(bde, '7');
  assert.equal(d.instalments[0].receipts[0].reviewStatus, 'pending'); assert.equal(d.instalments[0].receipts[0].reviewNote, null);
  await svc.reviewReceipt(admin, '5', { decision: 'rejected', note: 'Blurry' });
  d = await svc.get(bde, '7');
  assert.deepEqual(d.instalments[0].receipts[0].reviewStatus, 'rejected'); assert.equal(d.instalments[0].receipts[0].reviewNote, 'Blurry'); assert.equal(d.instalments[0].receipts[0].reviewedBy.employeeId, 'ADM');
  assert.equal((await svc.get(admin, '7')).instalments[0].receipts[0].reviewStatus, 'rejected');
  assert.equal(repo.calls.length, 1);
});

test('BDE payment summary reports the review state of their own proofs only', async () => {
  const { svc, repo } = make();
  const r = await svc.summary(bde, {});
  assert.deepEqual(r.proofs, { awaitingReview: 2, approved: 3, rejected: 1 });
  assert.deepEqual(repo.calls.at(-1), { proofCountsFor: 10 });
  await code(svc.summary(admin, {}), 403);
});

test('wiring (text): the review route is PUT-only on a separate admin-only router; migration 014 is three additive ALTERs', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /api\.use\('\/admin\/receipt-reviews', authenticate, authorize\('admin'\), receiptReviewRouter\)/);
  assert.equal((app.match(/receiptReviewRouter\.\w+\(/g) || []).length, 1); assert.match(app, /receiptReviewRouter\.put\('\/:id'/);
  assert.ok(app.indexOf("api.use('/admin/receipt-reviews'") < app.indexOf("api.use('/admin', authenticate"));
  assert.equal((app.match(/adminRouter\.(post|put|patch|delete)\(/g) || []).length, 0);
  const sql = readFileSync(new URL('../db/migrations/014_receipt_review.sql', import.meta.url), 'utf8').replace(/--.*$/gm, '');
  const stmts = sql.split(';').map((x) => x.trim()).filter(Boolean); assert.equal(stmts.length, 3); assert.ok(stmts.every((x) => /^ALTER TABLE payment_receipts\b/.test(x))); assert.ok(!/\b(DROP|DELETE|UPDATE|TRUNCATE|RENAME)\b/i.test(sql));
});
