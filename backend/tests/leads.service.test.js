import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLeadService, followUpState } from '../src/modules/leads/leads.service.js';

const bde = (id) => ({ id, role: 'bde', employeeId: 'E' + id, name: 'BDE ' + id });
const admin = { id: 1, role: 'admin', employeeId: 'ADM', name: 'Admin' };
const body = { candidateName: 'Priya R', phone: '98765 43210', email: 'priya@example.com', courseOrInternship: 'Full Stack', leadStatusId: 2, followUpDate: '2026-10-20', nextAction: 'Call' };

// In-memory stand-in for the repository. It mirrors the SQL rules (scope, duplicate keys) so service logic can be tested.
function fakeRepo() {
  const statuses = [{ id: 1, name: 'New', is_active: 1, closes_follow_up: 0 }, { id: 2, name: 'Interested', is_active: 1, closes_follow_up: 0 },
                    { id: 3, name: 'Not Interested', is_active: 1, closes_follow_up: 1 }, { id: 9, name: 'Retired', is_active: 0, closes_follow_up: 0 }];
  const users = { 10: { employee_id: 'E10', name: 'BDE 10' }, 11: { employee_id: 'E11', name: 'BDE 11' }, 12: { employee_id: 'E12', name: 'BDE 12' } };
  const rows = []; const calls = { search: [], summary: [] }; let next = 1;
  const joined = (l) => ({ ...l, bde_employee_id: users[l.user_id].employee_id, bde_name: users[l.user_id].name,
    status_name: statuses.find((s) => s.id === l.lead_status_id).name, closes_follow_up: statuses.find((s) => s.id === l.lead_status_id).closes_follow_up });
  return {
    rows, calls,
    listStatuses: async () => statuses.filter((s) => s.is_active),
    findStatus: async (id) => statuses.find((s) => s.id === id) || null,
    insert: async (userId, v) => { const id = next++; rows.push({ id, user_id: userId, candidate_name: v.candidateName, phone: v.phone, phone_key: v.phoneKey, email: v.email, email_key: v.emailKey,
      course_or_internship: v.courseOrInternship, lead_status_id: v.leadStatusId, follow_up_date: v.followUpDate, next_action: v.nextAction, created_at: 'c', updated_at: 'u' }); return id; },
    findById: async (id, scope) => { const l = rows.find((r) => String(r.id) === String(id) && (scope == null || r.user_id === scope)); return l ? joined(l) : null; },
    update: async (id, userId, v) => { const l = rows.find((r) => r.id === Number(id) && r.user_id === userId); if (!l) return;
      Object.assign(l, { candidate_name: v.candidateName, phone: v.phone, phone_key: v.phoneKey, email: v.email, email_key: v.emailKey, course_or_internship: v.courseOrInternship, lead_status_id: v.leadStatusId, follow_up_date: v.followUpDate, next_action: v.nextAction }); },
    setStatus: async (id, userId, statusId) => { const l = rows.find((r) => r.id === Number(id) && r.user_id === userId); if (l) { l.lead_status_id = statusId; l.updated_at = 'u2'; } },
    findDuplicates: async ({ phoneKey, emailKey, excludeId }) => rows.filter((l) => (phoneKey && l.phone_key === phoneKey || emailKey && l.email_key === emailKey) && l.id !== excludeId).map(joined),
    search: async ({ scopeUserId, filters }) => { calls.search.push({ scopeUserId, filters }); const list = rows.filter((l) => scopeUserId == null || l.user_id === scopeUserId).filter((l) => !filters.bdeId || l.user_id === filters.bdeId); return { rows: list.map(joined), total: list.length }; },
    followUpSummary: async (a) => { calls.summary.push(a); return { overdue: 1, today: 2, upcoming: 3 }; }
  };
}
const make = () => { const repo = fakeRepo(); return { repo, svc: createLeadService({ repo }) }; };
const status = (p, s) => assert.rejects(p, (e) => e.status === s);

test('create: owner comes from the SESSION, not from the request body', async () => {
  const { repo, svc } = make();
  const lead = await svc.create(bde(10), { ...body, userId: 11, user_id: 11, bdeId: 11 });
  assert.equal(repo.rows[0].user_id, 10); assert.equal(lead.candidateName, 'Priya R'); assert.equal(lead.status.name, 'Interested');
  assert.equal('bde' in lead, false, 'BDE view does not need the bde block');
});
test('create: validation errors -> 400 with fields, nothing stored', async () => {
  const { repo, svc } = make();
  await assert.rejects(svc.create(bde(10), { ...body, candidateName: '', phone: '', email: '' }), (e) => e.status === 400 && e.code === 'VALIDATION_ERROR' && Boolean(e.fields.candidateName) && Boolean(e.fields.phone));
  assert.equal(repo.rows.length, 0);
});
test('create: unknown or retired status -> 400', async () => {
  const { svc } = make();
  for (const id of [999, 9]) await assert.rejects(svc.create(bde(10), { ...body, leadStatusId: id }), (e) => e.status === 400 && Boolean(e.fields.leadStatusId));
});
test('admin can NOT create or edit (read-only), unknown roles are blocked too', async () => {
  const { svc } = make();
  await status(svc.create(admin, body), 403);
  const lead = await svc.create(bde(10), body);
  await status(svc.update(admin, String(lead.id), body), 403);
  await status(svc.list({ id: 5, role: 'intern' }, {}), 403);
  await status(svc.get(undefined, '1'), 403);
});

test('OWNERSHIP: BDE sees and edits only own leads; others look like "not found"', async () => {
  const { svc, repo } = make();
  const mine = await svc.create(bde(10), body);
  await status(svc.get(bde(11), String(mine.id)), 404);
  await status(svc.update(bde(11), String(mine.id), { ...body, candidateName: 'Hacked' }), 404);
  assert.equal(repo.rows[0].candidate_name, 'Priya R');
  assert.equal((await svc.get(bde(10), String(mine.id))).id, mine.id);
});
test('OWNERSHIP: list scope is the session user for BDEs even if bdeId is sent; admin is team-wide', async () => {
  const { svc, repo } = make();
  await svc.create(bde(10), body); await svc.create(bde(11), { ...body, phone: '90000 11111', email: 'b@x.com' });
  const mine = await svc.list(bde(10), { bdeId: '11' });
  assert.equal(mine.total, 1); assert.deepEqual(repo.calls.search[0].scopeUserId, 10); assert.equal(repo.calls.search[0].filters.bdeId, null);
  const all = await svc.list(admin, {});
  assert.equal(all.total, 2); assert.equal(repo.calls.search[1].scopeUserId, null);
  const one = await svc.list(admin, { bdeId: '11' });
  assert.equal(one.total, 1);
});
test('ADMIN: sees every lead and the responsible BDE; BDE responses do not carry that block', async () => {
  const { svc } = make();
  const l = await svc.create(bde(10), body);
  const a = await svc.get(admin, String(l.id));
  assert.deepEqual(a.bde, { id: 10, employeeId: 'E10', name: 'BDE 10' });
  assert.equal((await svc.list(admin, {})).leads[0].bde.name, 'BDE 10');
  assert.equal('bde' in (await svc.list(bde(10), {})).leads[0], false);
});
test('lead responses never expose internal duplicate keys', async () => {
  const { svc } = make(); const l = await svc.create(bde(10), body);
  assert.ok(!JSON.stringify(l).match(/phone_key|email_key|phoneKey|emailKey|user_id/));
});

test('DUPLICATES: same phone (any formatting) or email -> 409 with own details, nothing created, nothing merged', async () => {
  const { svc, repo } = make();
  await svc.create(bde(10), body);
  await assert.rejects(svc.create(bde(10), { ...body, candidateName: 'Priya Again', phone: '+91-98765-43210', email: '' }),
    (e) => e.status === 409 && e.code === 'POSSIBLE_DUPLICATE' && e.details.own.length === 1 && e.details.own[0].candidateName === 'Priya R' && e.details.otherBdeMatches === 0);
  await assert.rejects(svc.create(bde(10), { ...body, phone: '', email: 'PRIYA@example.com' }), (e) => e.status === 409);
  assert.equal(repo.rows.length, 1);
});
test('DUPLICATES: another BDE\'s lead is reported as a COUNT only (no names/contacts leak)', async () => {
  const { svc } = make();
  await svc.create(bde(10), body);
  await assert.rejects(svc.create(bde(11), { ...body, candidateName: 'Someone Else' }), (e) => {
    assert.equal(e.status, 409); assert.equal(e.details.own.length, 0); assert.equal(e.details.otherBdeMatches, 1);
    assert.ok(!JSON.stringify(e.details).match(/Priya|98765|priya@/)); return true; });
});
test('DUPLICATES: explicit confirmation creates a SEPARATE record (no merge)', async () => {
  const { svc, repo } = make();
  await svc.create(bde(10), body);
  const again = await svc.create(bde(10), { ...body, confirmDuplicate: true });
  assert.equal(repo.rows.length, 2); assert.notEqual(again.id, repo.rows[0].id);
});
test('DUPLICATES: leads without phone/email overlap are not flagged', async () => {
  const { svc } = make(); await svc.create(bde(10), body);
  await svc.create(bde(10), { ...body, candidateName: 'Same Name Different Person', phone: '80000 22222', email: 'other@x.com' });
});

test('UPDATE: editing fields works; status change to active status; follow-up cleared', async () => {
  const { svc } = make(); const l = await svc.create(bde(10), body);
  const u = await svc.update(bde(10), String(l.id), { ...body, candidateName: 'Priya Ravi', leadStatusId: 3, followUpDate: '', nextAction: '' });
  assert.equal(u.candidateName, 'Priya Ravi'); assert.equal(u.status.name, 'Not Interested'); assert.equal(u.followUpDate, null);
});
test('UPDATE: own record is not flagged as its own duplicate; changing to another lead\'s contact is', async () => {
  const { svc } = make(); const a = await svc.create(bde(10), body);
  await svc.update(bde(10), String(a.id), { ...body, nextAction: 'new note' });
  const b = await svc.create(bde(10), { ...body, candidateName: 'B', phone: '80000 22222', email: 'b@x.com' });
  await assert.rejects(svc.update(bde(10), String(b.id), { ...body, candidateName: 'B' }), (e) => e.status === 409);
  const ok = await svc.update(bde(10), String(b.id), { ...body, candidateName: 'B', confirmDuplicate: true });
  assert.equal(ok.candidateName, 'B');
});
test('UPDATE: a lead already in a retired status can be edited without changing status; moving INTO a retired one is refused', async () => {
  const { svc, repo } = make(); const l = await svc.create(bde(10), body);
  repo.rows[0].lead_status_id = 9;
  await svc.update(bde(10), String(l.id), { ...body, leadStatusId: 9, nextAction: 'x' });
  await status(svc.update(bde(10), String(l.id), { ...body, leadStatusId: 1 }).then(() => svc.update(bde(10), String(l.id), { ...body, leadStatusId: 9 })), 400);
});
test('ids are validated before any lookup', async () => {
  const { svc } = make();
  for (const bad of ['abc', '0', '-1', '1; DROP TABLE leads', '', undefined, '9'.repeat(30)]) { await status(svc.get(bde(10), bad), 400); await status(svc.update(bde(10), bad, body), 400); }
});

test('list/summary: bad query -> 400 before any database call; follow-up state is computed from the caller\'s "today"', async () => {
  const { svc, repo } = make();
  await status(svc.list(bde(10), { followUp: 'overdue' }), 400);
  await status(svc.followUpSummary(bde(10), {}), 400);
  assert.equal(repo.calls.search.length, 0);
  await svc.create(bde(10), { ...body, followUpDate: '2026-10-05' });
  const r = await svc.list(bde(10), { today: '2026-10-10' });
  assert.equal(r.leads[0].followUpState, 'overdue'); assert.equal(r.upcomingDays, 7);
  assert.deepEqual((await svc.followUpSummary(bde(10), { today: '2026-10-10' })).counts, { overdue: 1, today: 2, upcoming: 3 });
  assert.equal(repo.calls.summary[0].scopeUserId, 10);
  assert.equal((await svc.followUpSummary(admin, { today: '2026-10-10' })) && repo.calls.summary[1].scopeUserId, null);
});
test('followUpState rules', () => {
  const t = '2026-10-10';
  assert.equal(followUpState('2026-10-09', t, 0), 'overdue'); assert.equal(followUpState('2026-10-10', t, 0), 'today');
  assert.equal(followUpState('2026-10-17', t, 0), 'upcoming'); assert.equal(followUpState('2026-10-18', t, 0), 'later');
  assert.equal(followUpState(null, t, 0), null); assert.equal(followUpState('2026-10-01', t, 1), null, 'closed statuses are not overdue');
  assert.equal(followUpState('2026-10-01', null, 0), null);
});
test('status list is available to BDE and admin', async () => {
  const { svc } = make();
  assert.equal((await svc.listStatuses(bde(10))).length, 3); assert.equal((await svc.listStatuses(admin))[2].closesFollowUp, true);
});

// Source-level guards (Express is not installed here, so app.js cannot be executed in this environment)
test('app.js: /leads routes require the bde role; admin lead routes are GET only', () => {
  const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const leadRoutes = src.split('\n').filter((l) => /^\s*api\.(get|post|put|delete|patch)\('\/leads/.test(l));
  assert.equal(leadRoutes.length, 6); // summary, list, create, get, update, one-click status
  for (const l of leadRoutes) assert.match(l, /authenticate, authorize\('bde'\)/, l);
  assert.equal((src.match(/api\.delete\(/g) || []).length, 0, 'no delete routes: deleting leads is not a confirmed requirement');
  assert.match(src, /api\.get\('\/lead-statuses', authenticate,/);
});
test('migrations: statuses seed is clearly marked as PROPOSED and leads have no UNIQUE contact key', () => {
  const seed = readFileSync(new URL('../db/migrations/004_seed_proposed_lead_statuses.sql', import.meta.url), 'utf8');
  assert.match(seed, /PROPOSED/); assert.match(seed, /NOT confirmed/);
  const ddl = readFileSync(new URL('../db/migrations/003_lead_statuses_leads.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(ddl, /^\s*UNIQUE KEY[^\n]*(phone|email)/im, 'real UNIQUE KEY lines only (comments are ignored)');
  assert.match(ddl, /FOREIGN KEY \(user_id\) REFERENCES users/); assert.match(ddl, /FOREIGN KEY \(lead_status_id\)/);
});

test('setStatus: changes only the status of the BDE\'s own lead', async () => {
  const { repo, svc } = make();
  await svc.create(bde(10), body);
  const before = { ...repo.rows[0] };
  const lead = await svc.setStatus(bde(10), '1', { leadStatusId: 3 });
  assert.equal(lead.status.name, 'Not Interested');
  const after = repo.rows[0];
  assert.equal(after.lead_status_id, 3); assert.equal(after.candidate_name, before.candidate_name); assert.equal(after.phone, before.phone);
  assert.equal(after.follow_up_date, before.follow_up_date); assert.equal(after.next_action, before.next_action);
});
test('setStatus: another BDE\'s lead is 404 and nothing changes; admin is refused', async () => {
  const { repo, svc } = make();
  await svc.create(bde(10), body);
  await status(svc.setStatus(bde(11), '1', { leadStatusId: 3 }), 404);
  await status(svc.setStatus(admin, '1', { leadStatusId: 3 }), 403);
  assert.equal(repo.rows[0].lead_status_id, 2);
});
test('setStatus: unknown lead 404; retired, unknown or malformed status 400, nothing changes', async () => {
  const { repo, svc } = make();
  await svc.create(bde(10), body);
  await status(svc.setStatus(bde(10), '99', { leadStatusId: 1 }), 404);
  for (const bad of [9, 77, 0, -1, 1.5, 'abc', null, undefined, {}, [], '1; DROP TABLE leads']) {
    await assert.rejects(svc.setStatus(bde(10), '1', { leadStatusId: bad }), (e) => e.status === 400 && Boolean(e.fields.leadStatusId), String(bad));
  }
  await status(svc.setStatus(bde(10), '1', undefined), 400);
  assert.equal(repo.rows[0].lead_status_id, 2);
});
test('setStatus: the same status again is accepted and is a no-op; a string id is accepted', async () => {
  const { repo, svc } = make();
  await svc.create(bde(10), body);
  const same = await svc.setStatus(bde(10), '1', { leadStatusId: 2 });
  assert.equal(same.status.name, 'Interested'); assert.equal(repo.rows[0].updated_at, 'u');
  assert.equal((await svc.setStatus(bde(10), '1', { leadStatusId: '1' })).status.name, 'New');
});
