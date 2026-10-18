import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallLogService } from '../src/modules/call-logs/call-logs.service.js';
import { fakeCallLogRepo } from './helpers/fake-call-log-repo.js';

const bde = (id) => ({ id, role: 'bde', employeeId: 'E' + id, name: 'BDE ' + id });
const admin = { id: 1, role: 'admin', employeeId: 'ADM', name: 'Admin' };
let n = 0;
const rid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const NOW = Date.UTC(2026, 9, 13, 5, 0, 0); // 2026-10-13 10:30 IST
function make(opts = {}) {
  const repo = fakeCallLogRepo(opts.repo);
  const clock = { t: opts.now ?? NOW };
  const svc = createCallLogService({ repo, adminRepo: opts.adminRepo, now: () => clock.t, offsetMinutes: 330 });
  return { repo, svc, clock };
}
const call = (leadId, outcome, extra = {}) => ({ leadId, outcome, clientRequestId: rid(), ...extra });
const status = (p, s, code) => assert.rejects(p, (e) => e.status === s && (!code || e.code === code));

test('record: the BDE comes from the SESSION; a userId in the body changes nothing; the lead moves to the matching status', async () => {
  const { repo, svc } = make();
  const r = await svc.record(bde(10), { ...call(1, 'interested'), userId: 11, user_id: 11 });
  assert.equal(r.duplicate, false); assert.equal(r.leadStatusUpdated, true);
  assert.equal(repo.state.logs[0].user_id, 10); assert.equal(repo.state.logs[0].call_date, '2026-10-13'); assert.equal(repo.state.logs[0].called_at, '2026-10-13 05:00:00');
  assert.equal(repo.state.leads[0].lead_status_id, 2);
  assert.equal(r.call.outcome, 'interested'); assert.equal(r.call.voidedAt, null);
});
test('record: each outcome maps to its own lead status', async () => {
  const { repo, svc } = make();
  for (const [o, id] of [['interested', 2], ['follow_up', 3], ['no_response', 4], ['not_interested', 5]]) {
    await svc.record(bde(10), call(1, o)); assert.equal(repo.state.leads[0].lead_status_id, id, o);
  }
});
test('record: a lead that belongs to another BDE, or does not exist, is 404 and nothing is written (no hint which)', async () => {
  const { repo, svc } = make();
  await status(svc.record(bde(10), call(3, 'interested')), 404, 'NOT_FOUND');
  await status(svc.record(bde(10), call(999, 'interested')), 404, 'NOT_FOUND');
  assert.equal(repo.state.logs.length, 0); assert.equal(repo.state.leads[2].lead_status_id, 1);
});
test('record: admins and anonymous callers cannot record calls', async () => {
  const { repo, svc } = make();
  await status(svc.record(admin, call(1, 'interested')), 403); await status(svc.record(undefined, call(1, 'interested')), 403);
  assert.equal(repo.state.logs.length, 0);
});
test('record: invalid input -> 400 with field messages, nothing is written', async () => {
  const { repo, svc } = make();
  for (const body of [{}, { ...call(1, 'interested'), outcome: 'maybe' }, { ...call(1, 'interested'), clientRequestId: 'x' }, { ...call(1, 'interested'), leadId: 'abc' }, null]) {
    await assert.rejects(svc.record(bde(10), body), (e) => e.status === 400 && e.code === 'VALIDATION_ERROR');
  }
  assert.equal(repo.state.logs.length, 0);
});

test('duplicate click: the same request id sent twice is ONE call; the second answer says duplicate and counts nothing', async () => {
  const { repo, svc } = make();
  const body = call(1, 'interested');
  const first = await svc.record(bde(10), body); const second = await svc.record(bde(10), body);
  assert.equal(first.duplicate, false); assert.equal(second.duplicate, true); assert.equal(second.call.id, first.call.id);
  assert.equal(repo.state.logs.length, 1);
  assert.equal((await svc.dailySummary(bde(10))).stats.totalCalls, 1);
});
test('duplicate click that arrives at the same moment (database says duplicate key): the winner is returned, no error, no second row', async () => {
  const { repo, svc } = make();
  const body = call(1, 'interested');
  repo.state.racingWinner = { id: 77, user_id: 10, lead_id: 1, outcome: 'interested', call_date: '2026-10-13', called_at: '2026-10-13 05:00:00', client_request_id: body.clientRequestId.toLowerCase(), voided_at: null };
  const dup = new Error('Duplicate entry'); dup.code = 'ER_DUP_ENTRY'; repo.state.failNextInsertWith = dup;
  const r = await svc.record(bde(10), body);
  assert.equal(r.duplicate, true); assert.equal(r.call.id, '77'); assert.equal(repo.state.logs.length, 1);
});
test('deadlock reported by the database: the call is retried and saved once; if it keeps failing the error is reported, never shown as success', async () => {
  const { repo, svc } = make();
  const dead = Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK' });
  repo.state.failNextInsertWith = dead;
  const r = await svc.record(bde(10), call(1, 'interested'));
  assert.equal(r.duplicate, false); assert.equal(repo.state.logs.length, 1);
  const always = make(); let tries = 0;
  always.repo.insertWithLeadUpdate = async () => { tries++; throw dead; };
  await assert.rejects(always.svc.record(bde(10), call(1, 'interested')), (e) => e.code === 'ER_LOCK_DEADLOCK');
  assert.equal(tries, 3, 'a bounded number of attempts'); assert.equal(always.repo.state.logs.length, 0);
});
test('deadlock where the other copy of the click was saved meanwhile: the original call is returned, not an error', async () => {
  const { repo, svc } = make();
  const body = call(1, 'interested');
  repo.state.racingWinner = { id: 55, user_id: 10, lead_id: 1, outcome: 'interested', call_date: '2026-10-13', called_at: '2026-10-13 05:00:00', client_request_id: body.clientRequestId.toLowerCase(), voided_at: null };
  repo.state.failNextInsertWith = Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK' });
  const r = await svc.record(bde(10), body);
  assert.equal(r.duplicate, true); assert.equal(r.call.id, '55'); assert.equal(repo.state.logs.length, 1);
});
test('a duplicate-key error with no saved call behind it is NOT hidden (it would mean a bug)', async () => {
  const { repo, svc } = make();
  repo.state.failNextInsertWith = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
  await assert.rejects(svc.record(bde(10), call(1, 'interested')), (e) => e.code === 'ER_DUP_ENTRY');
  assert.equal(repo.state.logs.length, 0);
});
test('two different clicks on the same lead are TWO calls (repeat calls count)', async () => {
  const { repo, svc } = make();
  await svc.record(bde(10), call(1, 'no_response')); await svc.record(bde(10), call(1, 'no_response'));
  assert.equal(repo.state.logs.length, 2);
  const s = (await svc.dailySummary(bde(10))).stats;
  assert.equal(s.totalCalls, 2); assert.equal(s.uniqueLeadsCalled, 1); assert.equal(s.repeatCalls, 1);
});
test('a request id reused for a DIFFERENT lead or outcome is refused (409), never silently returned as success', async () => {
  const { repo, svc } = make();
  const body = call(1, 'interested'); await svc.record(bde(10), body);
  await status(svc.record(bde(10), { ...body, outcome: 'not_interested' }), 409, 'REQUEST_ID_REUSED');
  await status(svc.record(bde(10), { ...body, leadId: 2 }), 409, 'REQUEST_ID_REUSED');
  assert.equal(repo.state.logs.length, 1);
});
test('the same request id used by two different BDEs is two independent calls', async () => {
  const { repo, svc } = make();
  const id = rid();
  await svc.record(bde(10), { leadId: 1, outcome: 'interested', clientRequestId: id }); await svc.record(bde(11), { leadId: 3, outcome: 'interested', clientRequestId: id });
  assert.equal(repo.state.logs.length, 2);
});
test('errors are never reported as success: an unexpected database failure propagates and no call is recorded', async () => {
  const { repo, svc } = make();
  repo.state.failNextInsertWith = new Error('connection lost');
  await assert.rejects(svc.record(bde(10), call(1, 'interested')), /connection lost/);
  assert.equal(repo.state.logs.length, 0); assert.equal(repo.state.leads[0].lead_status_id, 1);
  const retry = await svc.record(bde(10), call(1, 'interested')); assert.equal(retry.duplicate, false); // a new attempt works normally
});

test('follow-up: the date is stored on the lead; a past date is refused; other outcomes never touch the lead\'s date', async () => {
  const { repo, svc } = make();
  await svc.record(bde(10), call(1, 'follow_up', { followUpDate: '2026-10-20' })); assert.equal(repo.state.leads[0].follow_up_date, '2026-10-20');
  await svc.record(bde(10), call(2, 'no_response')); assert.equal(repo.state.leads[1].follow_up_date, '2026-10-01', 'date untouched');
  await assert.rejects(svc.record(bde(10), call(1, 'follow_up', { followUpDate: '2026-10-12' })), (e) => e.status === 400 && Boolean(e.fields.followUpDate));
  await svc.record(bde(10), call(1, 'follow_up', { followUpDate: '2026-10-13' })); // today is allowed
  await svc.record(bde(10), call(1, 'follow_up')); assert.equal(repo.state.leads[0].follow_up_date, '2026-10-13', 'follow-up without a date keeps the old date');
});
test('a missing or retired lead status does not block recording the call; the response says the status was not updated', async () => {
  const { repo, svc } = make({ repo: { statuses: [{ id: 1, name: 'New', is_active: 1 }, { id: 2, name: 'Interested', is_active: 0 }] } });
  const r = await svc.record(bde(10), call(1, 'interested'));
  assert.equal(r.leadStatusUpdated, false); assert.equal(repo.state.logs.length, 1); assert.equal(repo.state.leads[0].lead_status_id, 1);
});

test('working date: a call at 00:30 IST belongs to the NEW day, and a call at 23:59 IST to the old one', async () => {
  const { repo, svc, clock } = make();
  clock.t = Date.UTC(2026, 9, 13, 18, 29, 59); await svc.record(bde(10), call(1, 'no_response'));
  clock.t = Date.UTC(2026, 9, 13, 18, 30, 0); await svc.record(bde(10), call(1, 'no_response'));
  assert.deepEqual(repo.state.logs.map((l) => l.call_date), ['2026-10-13', '2026-10-14']);
});

test('undo: removes the call from the counts, keeps the row, and is harmless to repeat', async () => {
  const { repo, svc } = make();
  const a = await svc.record(bde(10), call(1, 'interested')); await svc.record(bde(10), call(2, 'no_response'));
  const u = await svc.undo(bde(10), a.call.id);
  assert.equal(u.alreadyUndone, false); assert.ok(u.call.voidedAt); assert.equal(repo.state.logs.length, 2, 'row kept for the audit trail');
  assert.equal((await svc.dailySummary(bde(10))).stats.totalCalls, 1);
  assert.equal((await svc.undo(bde(10), a.call.id)).alreadyUndone, true);
  assert.equal((await svc.dailySummary(bde(10))).stats.totalCalls, 1);
});
test('undo: only own calls (404 otherwise), only today\'s calls (409), only BDEs, only a valid id', async () => {
  const { svc, clock } = make();
  const a = await svc.record(bde(10), call(1, 'interested'));
  await status(svc.undo(bde(11), a.call.id), 404); await status(svc.undo(bde(10), '999'), 404);
  await status(svc.undo(admin, a.call.id), 403);
  for (const bad of ['abc', '0', '1e3', undefined]) await status(svc.undo(bde(10), bad), 400);
  clock.t = NOW + 24 * 3600 * 1000;
  await status(svc.undo(bde(10), a.call.id), 409, 'CANNOT_UNDO');
});
test('undo does not change the lead status (documented); recording the right outcome corrects it', async () => {
  const { repo, svc } = make();
  const a = await svc.record(bde(10), call(1, 'interested')); await svc.undo(bde(10), a.call.id);
  assert.equal(repo.state.leads[0].lead_status_id, 2);
  await svc.record(bde(10), call(1, 'not_interested')); assert.equal(repo.state.leads[0].lead_status_id, 5);
});
test('a voided call\'s request id cannot be used to bring it back (retry returns the voided original)', async () => {
  const { repo, svc } = make();
  const body = call(1, 'interested'); const a = await svc.record(bde(10), body); await svc.undo(bde(10), a.call.id);
  const again = await svc.record(bde(10), body);
  assert.equal(again.duplicate, true); assert.ok(again.call.voidedAt); assert.equal((await svc.dailySummary(bde(10))).stats.totalCalls, 0); assert.equal(repo.state.logs.length, 1);
});

test('dailySummary: own calls only, newest first, with names; undo is offered only for today; a bad date is 400', async () => {
  const { svc, clock } = make();
  await svc.record(bde(10), call(1, 'interested')); clock.t += 60000; await svc.record(bde(10), call(2, 'no_response')); await svc.record(bde(11), call(3, 'interested'));
  const s = await svc.dailySummary(bde(10));
  assert.equal(s.date, '2026-10-13'); assert.equal(s.stats.totalCalls, 2); assert.deepEqual(s.entries.map((e) => e.candidateName), ['Babu', 'Anu']); assert.ok(s.entries.every((e) => e.canUndo));
  const past = await svc.dailySummary(bde(10), '2026-10-12'); assert.equal(past.stats.totalCalls, 0); assert.equal(past.today, '2026-10-13');
  clock.t += 24 * 3600 * 1000;
  assert.ok((await svc.dailySummary(bde(10), '2026-10-13')).entries.every((e) => e.canUndo === false));
  for (const bad of ['2026-02-30', 'today', '13-10-2026']) await assert.rejects(svc.dailySummary(bde(10), bad), (e) => e.status === 400);
  await status(svc.dailySummary(admin), 403);
});
test('dailySummary: more than 30 calls -> stats count all, the list shows the newest 30', async () => {
  const { svc, clock } = make();
  for (let i = 0; i < 35; i++) { clock.t += 1000; await svc.record(bde(10), call(1, 'no_response')); }
  const s = await svc.dailySummary(bde(10)); assert.equal(s.stats.totalCalls, 35); assert.equal(s.entries.length, 30);
});

// ---- admin ----
const person = (id, name, extra = {}) => ({ id, employee_id: 'E' + id, name, is_active: 1, report_id: null, total_calls: null, interested: null, not_interested: null, follow_up_required: null, no_response: null, ...extra });
const manual = { report_id: 9, total_calls: 40, interested: 6, not_interested: 20, follow_up_required: 4, no_response: 10 };
function adminSvc(people, seed) {
  const m = make({ adminRepo: { overviewForDate: async (d) => { m.asked = d; return people; } } });
  return m;
}
test('admin stats: the call log is the source when it has calls; the manual report is used otherwise; they are NEVER added together', async () => {
  const people = [person(10, 'Anu', manual), person(11, 'Babu', manual), person(12, 'Chitra'), person(13, 'Dev')];
  const m = adminSvc(people);
  await m.svc.record(bde(10), call(1, 'interested')); await m.svc.record(bde(10), call(2, 'not_interested')); // BDE 10 has BOTH a manual report (40 calls) and 2 logged calls
  const r = await m.svc.adminDailyStats('2026-10-13');
  const by = (id) => r.bdes.find((b) => b.id === id);
  assert.equal(m.asked, '2026-10-13');
  assert.equal(by(10).source, 'call_log'); assert.equal(by(10).status, 'calls_recorded'); assert.equal(by(10).totalCalls, 2, 'not 42');
  assert.deepEqual(by(10).manualReport, { totalCalls: 40, interested: 6, notInterested: 20, followUpRequired: 4, noResponse: 10 }, 'manual figures stay visible for comparison');
  assert.equal(by(11).source, 'manual'); assert.equal(by(11).status, 'manual_report'); assert.equal(by(11).totalCalls, 40);
  assert.equal(by(11).interestedLeads, 6); assert.equal(by(11).conversionRate, 0.15); assert.equal(by(11).uniqueLeadsCalled, null);
  assert.equal(by(12).source, 'none'); assert.equal(by(12).status, 'no_activity'); assert.equal(by(12).totalCalls, null); assert.equal(by(12).conversionRate, null);
  assert.deepEqual({ ...r.totals }, { bdeCount: 4, callsRecorded: 1, manualOnly: 1, noActivity: 2, totalCalls: 42, interested: 7, notInterested: 21, followUpRequired: 4, noResponse: 10, interestedLeads: 7, conversionRate: 0.167 });
});
test('admin stats: a BDE\'s repeat calls and unique leads are reported; conversion = interested leads / calls', async () => {
  const m = adminSvc([person(10, 'Anu')]);
  for (const o of ['no_response', 'no_response', 'interested']) await m.svc.record(bde(10), call(1, o));
  await m.svc.record(bde(10), call(2, 'follow_up'));
  const b = (await m.svc.adminDailyStats('2026-10-13')).bdes[0];
  assert.equal(b.totalCalls, 4); assert.equal(b.uniqueLeadsCalled, 2); assert.equal(b.repeatCalls, 2); assert.equal(b.interestedLeads, 1); assert.equal(b.conversionRate, 0.25);
  assert.equal(b.interested, 1); assert.equal(b.noResponse, 2); assert.equal(b.followUpRequired, 1); assert.ok(b.lastActivityAt);
});
test('admin stats: undone calls are excluded; a day with only undone calls is "no activity", not "0 calls"', async () => {
  const m = adminSvc([person(10, 'Anu')]);
  const a = await m.svc.record(bde(10), call(1, 'interested')); await m.svc.undo(bde(10), a.call.id);
  const b = (await m.svc.adminDailyStats('2026-10-13')).bdes[0];
  assert.equal(b.status, 'no_activity'); assert.equal(b.totalCalls, null);
});
test('admin stats: a manual report of 0 calls is a manual report with no conversion rate (not 0%); other days are not mixed in', async () => {
  const m = adminSvc([person(10, 'Anu', { ...manual, total_calls: 0, interested: 0, not_interested: 0, follow_up_required: 0, no_response: 0 })]);
  await m.svc.record(bde(10), call(1, 'interested'));
  const other = (await m.svc.adminDailyStats('2026-10-12')).bdes[0];
  assert.equal(other.source, 'manual'); assert.equal(other.totalCalls, 0); assert.equal(other.conversionRate, null);
});
test('admin stats: bad or missing date -> 400 and no query runs', async () => {
  const m = adminSvc([]);
  for (const bad of [undefined, '', '2026-02-30', '10/10/2026', ['2026-10-10'], null]) await assert.rejects(m.svc.adminDailyStats(bad), (e) => e.status === 400 && Boolean(e.fields.date));
  assert.equal(m.asked, undefined);
});
