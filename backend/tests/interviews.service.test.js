import test from 'node:test';
import assert from 'node:assert/strict';
import { createInterviewService, interviewState } from '../src/modules/interviews/interviews.service.js';

const bde = (id) => ({ id, role: 'bde', employeeId: 'E' + id, name: 'BDE ' + id });
const admin = { id: 1, role: 'admin', employeeId: 'ADM', name: 'Admin' };
const body = { leadId: 100, scheduledAt: '2026-06-15T14:30', attendance: 'pending', outcome: 'pending', interestedInJoining: null };

// In-memory stand-in for the repository. Mirrors the SQL rules (lead ownership, scope) so service logic can be tested.
function fakeRepo() {
  const leads = [{ id: 100, user_id: 10, candidate_name: 'Priya R', phone: '9876543210', email: 'p@x.com', course_or_internship: 'Full Stack' },
                 { id: 101, user_id: 11, candidate_name: 'Arun K', phone: '9000011111', email: null, course_or_internship: 'Data' }];
  const users = { 10: { employee_id: 'E10', name: 'BDE 10' }, 11: { employee_id: 'E11', name: 'BDE 11' } };
  const paidLeads = new Set(); // leads that have a payment record (stand-in for the derived flag)
  const rows = []; const calls = { search: [], summary: [], overview: [] }; let next = 1;
  const joined = (i) => { const l = leads.find((x) => x.id === Number(i.lead_id)); return { ...i, bde_employee_id: users[i.user_id].employee_id, bde_name: users[i.user_id].name,
    payment_confirmed: paidLeads.has(Number(i.lead_id)) ? 1 : 0, candidate_name: l.candidate_name, phone: l.phone, email: l.email, course_or_internship: l.course_or_internship }; };
  const flag = (v) => (v === null ? null : v ? 1 : 0);
  return {
    rows, calls, paidLeads,
    findOwnLead: async (leadId, userId) => leads.find((l) => String(l.id) === String(leadId) && l.user_id === userId) || null,
    insert: async (leadId, userId, v) => { const id = next++; rows.push({ id, lead_id: leadId, user_id: userId, scheduled_at: v.scheduledAt, attendance: v.attendance, outcome: v.outcome,
      interested_in_joining: flag(v.interestedInJoining), created_at: 'c', updated_at: 'u' }); return id; },
    findById: async (id, scope) => { const i = rows.find((r) => String(r.id) === String(id) && (scope == null || r.user_id === scope)); return i ? joined(i) : null; },
    update: async (id, userId, v) => { const i = rows.find((r) => r.id === Number(id) && r.user_id === userId); if (!i) return;
      Object.assign(i, { scheduled_at: v.scheduledAt, attendance: v.attendance, outcome: v.outcome, interested_in_joining: flag(v.interestedInJoining) }); },
    search: async ({ scopeUserId, filters }) => { calls.search.push({ scopeUserId, filters }); const list = rows.filter((i) => scopeUserId == null || i.user_id === scopeUserId).filter((i) => !filters.bdeId || String(i.user_id) === String(filters.bdeId)); return { rows: list.map(joined), total: list.length }; },
    summary: async (a) => { calls.summary.push(a); return { today: 1, upcoming: 2, needsUpdate: 3 }; },
    overview: async (a) => { calls.overview.push(a); return [
      { id: 10, employee_id: 'E10', name: 'BDE 10', is_active: 1, scheduled: '3', attended: '2', did_not_attend: '1', attendance_pending: '0', selected: '1', not_selected: '1', interested_in_joining: '2', payment_confirmed: '1' },
      { id: 11, employee_id: 'E11', name: 'BDE 11', is_active: 1, scheduled: '1', attended: '0', did_not_attend: '0', attendance_pending: '1', selected: '0', not_selected: '0', interested_in_joining: '0', payment_confirmed: '0' }]; }
  };
}
const make = () => { const repo = fakeRepo(); return { repo, svc: createInterviewService({ repo }) }; };
const status = (p, s) => assert.rejects(p, (e) => e.status === s);

test('create: owner comes from the SESSION and the interview links to the lead; no admin block for BDEs', async () => {
  const { repo, svc } = make();
  const i = await svc.create(bde(10), { ...body, userId: 11, user_id: 11, bdeId: 11 });
  assert.equal(repo.rows[0].user_id, 10); assert.equal(String(repo.rows[0].lead_id), '100');
  assert.equal(i.lead.candidateName, 'Priya R'); assert.equal(i.scheduledAt, '2026-06-15T14:30');
  assert.equal(i.attendance, 'pending'); assert.equal(i.interestedInJoining, null); assert.equal(i.paymentConfirmed, false);
  assert.equal('bde' in i, false);
});
test('create: validation errors -> 400 with fields, nothing stored', async () => {
  const { repo, svc } = make();
  await assert.rejects(svc.create(bde(10), { ...body, scheduledAt: 'tomorrow', attendance: 'x' }), (e) => e.status === 400 && e.code === 'VALIDATION_ERROR' && Boolean(e.fields.scheduledAt) && Boolean(e.fields.attendance));
  assert.equal(repo.rows.length, 0);
});
test('create: missing lead and ANOTHER BDE\'s lead give the same 404; malformed lead id is 400', async () => {
  const { repo, svc } = make();
  const other = await svc.create(bde(10), { ...body, leadId: 101 }).catch((e) => e);
  const missing = await svc.create(bde(10), { ...body, leadId: 99999 }).catch((e) => e);
  assert.equal(other.status, 404); assert.equal(missing.status, 404);
  assert.equal(other.message, missing.message);
  await assert.rejects(svc.create(bde(10), { ...body, leadId: 'abc' }), (e) => e.status === 400 && Boolean(e.fields.leadId));
  await assert.rejects(svc.create(bde(10), { ...body, leadId: undefined }), (e) => e.status === 400);
  assert.equal(repo.rows.length, 0);
});
test('admin can NOT create or edit (read-only); unknown roles are blocked', async () => {
  const { svc } = make();
  await status(svc.create(admin, body), 403);
  const i = await svc.create(bde(10), body);
  await status(svc.update(admin, String(i.id), body), 403);
  await status(svc.list({ id: 5, role: 'intern' }, {}), 403);
  await status(svc.get(undefined, '1'), 403);
  await status(svc.summary(null, { today: '2026-06-15' }), 403);
});
test('OWNERSHIP: BDE reads and edits only own interviews; others look like "not found"', async () => {
  const { svc, repo } = make();
  const mine = await svc.create(bde(10), body);
  await status(svc.get(bde(11), String(mine.id)), 404);
  await status(svc.update(bde(11), String(mine.id), { ...body, attendance: 'attended' }), 404);
  assert.equal(repo.rows[0].attendance, 'pending');
  assert.equal((await svc.get(bde(10), String(mine.id))).id, mine.id);
});
test('OWNERSHIP: list scope is the session user for BDEs even if bdeId is sent; admin is team-wide', async () => {
  const { svc, repo } = make();
  await svc.create(bde(10), body); await svc.create(bde(11), { ...body, leadId: 101 });
  const mine = await svc.list(bde(10), { bdeId: '11' });
  assert.equal(mine.interviews.length, 1); assert.equal(repo.calls.search[0].scopeUserId, 10); assert.equal(repo.calls.search[0].filters.bdeId, null);
  const all = await svc.list(admin, {});
  assert.equal(all.interviews.length, 2); assert.equal(repo.calls.search[1].scopeUserId, null);
  assert.deepEqual(all.interviews.map((i) => i.bde.employeeId).sort(), ['E10', 'E11']);
  const one = await svc.list(admin, { bdeId: '11' });
  assert.equal(one.interviews.length, 1); assert.equal(one.interviews[0].bde.name, 'BDE 11');
  await status(svc.list(admin, { bdeId: 'x' }), 400);
});
test('update: replaces the record, keeps the lead, id validated', async () => {
  const { svc, repo } = make();
  const i = await svc.create(bde(10), body);
  const u = await svc.update(bde(10), String(i.id), { ...body, leadId: 101, attendance: 'attended', outcome: 'selected', interestedInJoining: true, paymentConfirmed: true, scheduledAt: '2026-06-16T10:00' });
  assert.equal(u.attendance, 'attended'); assert.equal(u.outcome, 'selected'); assert.equal(u.interestedInJoining, true); assert.equal(u.scheduledAt, '2026-06-16T10:00');
  assert.equal(u.paymentConfirmed, false, 'a paymentConfirmed value in the body is ignored (Phase 6: derived from payments)');
  repo.paidLeads.add(100);
  assert.equal((await svc.get(bde(10), String(i.id))).paymentConfirmed, true, 'follows the payment records');
  assert.equal(String(repo.rows[0].lead_id), '100', 'leadId in an update body is ignored');
  await assert.rejects(svc.update(bde(10), String(i.id), { ...body, attendance: 'pending', outcome: 'selected' }), (e) => e.status === 400 && Boolean(e.fields.outcome));
  await assert.rejects(svc.update(bde(10), String(i.id), { scheduledAt: '2026-06-16T10:00' }), (e) => e.status === 400);
  assert.equal(repo.rows[0].outcome, 'selected', 'rejected update changed nothing');
  for (const bad of ['abc', '0', '-1', '1.5', '9'.repeat(30)]) await status(svc.update(bde(10), bad, body), 400);
  await status(svc.update(bde(10), '99999', body), 404);
});
test('get: state indicator needs "today" from the caller', async () => {
  const { svc } = make();
  const i = await svc.create(bde(10), body);
  assert.equal((await svc.get(bde(10), String(i.id))).state, null);
  assert.equal((await svc.get(bde(10), String(i.id), { today: '2026-06-20' })).state, 'needs_update');
  assert.equal((await svc.get(bde(10), String(i.id), { today: 'junk' })).state, null);
});
test('interviewState: today / upcoming / needs_update / done', () => {
  assert.equal(interviewState('2026-06-15 14:30:00', 'pending', '2026-06-15'), 'today');
  assert.equal(interviewState('2026-06-16 00:00:00', 'pending', '2026-06-15'), 'upcoming');
  assert.equal(interviewState('2026-06-14 23:59:00', 'pending', '2026-06-15'), 'needs_update');
  assert.equal(interviewState('2026-06-14 10:00:00', 'attended', '2026-06-15'), null);
  assert.equal(interviewState('2026-06-14 10:00:00', 'did_not_attend', '2026-06-15'), null);
  assert.equal(interviewState('2026-06-14 10:00:00', 'pending', null), null);
});
test('summary: today must be supplied; overview is admin only and totals add up', async () => {
  const { svc } = make();
  assert.deepEqual((await svc.summary(bde(10), { today: '2026-06-15' })).counts, { today: 1, upcoming: 2, needsUpdate: 3 });
  await status(svc.summary(bde(10), {}), 400);
  await status(svc.overview(bde(10), {}), 403);
  const o = await svc.overview(admin, {});
  assert.deepEqual(o.totals, { scheduled: 4, attended: 2, didNotAttend: 1, attendancePending: 1, selected: 1, notSelected: 1, interestedInJoining: 2, paymentConfirmed: 1 });
  assert.equal(o.bdes[0].scheduled, 3); assert.equal(typeof o.bdes[0].scheduled, 'number');
  await status(svc.overview(admin, { scheduledFrom: '2026-07-01', scheduledTo: '2026-06-01' }), 400);
});
test('no secrets or internal columns leak in responses', async () => {
  const { svc } = make();
  const i = await svc.create(bde(10), body);
  assert.equal(/user_id|password|hash|token/i.test(JSON.stringify(i)), false);
});
