import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCallLog, clockParts, summarizeEvents, summarizeByUser, conversionPercent, conversionRate, CALL_OUTCOMES, OUTCOME_STATUS_NAME } from '../src/lib/call-log.js';

const RID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const ok = { leadId: 7, outcome: 'interested', clientRequestId: RID };
let seq = 0;
const ev = (user, lead, outcome, time) => ({ id: ++seq, user_id: user, lead_id: lead, outcome, called_at: `2026-10-13 ${time}` });

test('outcomes: exactly the four categories of the Daily Calling Report, each mapped to a lead status name', () => {
  assert.deepEqual(CALL_OUTCOMES, ['interested', 'not_interested', 'follow_up', 'no_response']);
  assert.deepEqual(Object.keys(OUTCOME_STATUS_NAME), CALL_OUTCOMES);
});

test('validate: a good request is accepted; lead id is normalised to a string and the request id to lower case', () => {
  const r = validateCallLog({ ...ok, clientRequestId: RID.toUpperCase() });
  assert.equal(r.ok, true); assert.deepEqual(r.value, { leadId: '7', outcome: 'interested', clientRequestId: RID, followUpDate: null });
  assert.equal(validateCallLog({ ...ok, leadId: '123456789012345678' }).ok, true);
});
test('validate: bad lead ids, outcomes and request ids are rejected with a message per field', () => {
  for (const leadId of [undefined, null, 0, -1, 1.5, '0', '01', 'abc', '1234567890123456789', 9007199254740993, [1], {}]) assert.ok(validateCallLog({ ...ok, leadId }).errors.leadId, String(leadId));
  for (const outcome of [undefined, '', 'Interested', 'converted', 5, ['interested']]) assert.ok(validateCallLog({ ...ok, outcome }).errors.outcome, String(outcome));
  for (const clientRequestId of [undefined, '', 'abc', RID + 'x', 12345, '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6']) assert.ok(validateCallLog({ ...ok, clientRequestId }).errors.clientRequestId, String(clientRequestId));
  for (const body of [null, undefined, 'x', [], 5]) assert.equal(validateCallLog(body).ok, false);
});
test('validate: a follow-up date is only allowed with the follow_up outcome, and must be a real date', () => {
  assert.equal(validateCallLog({ ...ok, outcome: 'follow_up', followUpDate: '2026-10-20' }).value.followUpDate, '2026-10-20');
  assert.ok(validateCallLog({ ...ok, outcome: 'interested', followUpDate: '2026-10-20' }).errors.followUpDate);
  assert.ok(validateCallLog({ ...ok, outcome: 'follow_up', followUpDate: '2026-02-30' }).errors.followUpDate);
  assert.ok(validateCallLog({ ...ok, outcome: 'follow_up', followUpDate: 20261020 }).errors.followUpDate);
  assert.equal(validateCallLog({ ...ok, outcome: 'follow_up', followUpDate: '' }).value.followUpDate, null);
});
test('validate: extra fields such as userId, callDate or calledAt are ignored (never copied into the value)', () => {
  const r = validateCallLog({ ...ok, userId: 99, user_id: 99, callDate: '2020-01-01', calledAt: '2020-01-01 00:00:00', voidedAt: 'x' });
  assert.deepEqual(Object.keys(r.value).sort(), ['clientRequestId', 'followUpDate', 'leadId', 'outcome']);
});

test('clock: the working date follows the offset, the stored time stays UTC, both come from one instant', () => {
  assert.deepEqual(clockParts(Date.UTC(2026, 9, 13, 19, 0, 0), 330), { callDate: '2026-10-14', calledAt: '2026-10-13 19:00:00' }); // 00:30 IST next day
  assert.deepEqual(clockParts(Date.UTC(2026, 9, 13, 18, 29, 59), 330), { callDate: '2026-10-13', calledAt: '2026-10-13 18:29:59' }); // 23:59:59 IST
  assert.equal(clockParts(Date.UTC(2026, 9, 13, 0, 0, 0), 0).callDate, '2026-10-13');
  assert.equal(clockParts(Date.UTC(2026, 9, 13, 0, 0, 0), -300).callDate, '2026-10-12');
});

test('stats: no calls -> zero counts and a NULL conversion rate (not 0%)', () => {
  const s = summarizeEvents([]);
  assert.deepEqual(s, { totalCalls: 0, uniqueLeadsCalled: 0, repeatCalls: 0, outcomes: { interested: 0, notInterested: 0, followUp: 0, noResponse: 0 }, interestedLeads: 0, conversionRate: null, lastActivityAt: null });
});
test("stats: the TL's example, 30 calls to 30 different leads with 5 interested -> 30 calls, 5 interested leads, 5/30", () => {
  const events = [];
  for (let i = 1; i <= 30; i++) events.push(ev(1, 100 + i, i <= 5 ? 'interested' : i <= 15 ? 'not_interested' : i <= 22 ? 'follow_up' : 'no_response', `10:${String(i).padStart(2, '0')}:00`));
  const s = summarizeEvents(events);
  assert.equal(s.totalCalls, 30); assert.equal(s.uniqueLeadsCalled, 30); assert.equal(s.repeatCalls, 0);
  assert.deepEqual(s.outcomes, { interested: 5, notInterested: 10, followUp: 7, noResponse: 8 });
  assert.equal(s.interestedLeads, 5); assert.equal(s.conversionRate, 0.167);
  assert.equal(s.lastActivityAt, '2026-10-13 10:30:00');
});
test('stats: REPEATED calls to the same lead each count as a call; unique leads are reported separately and never replace the call count', () => {
  const s = summarizeEvents([ev(1, 5, 'no_response', '09:00:00'), ev(1, 5, 'no_response', '11:00:00'), ev(1, 5, 'interested', '15:00:00'), ev(1, 6, 'not_interested', '09:30:00')]);
  assert.equal(s.totalCalls, 4, 'four calls were made');
  assert.equal(s.uniqueLeadsCalled, 2); assert.equal(s.repeatCalls, 2);
  assert.deepEqual(s.outcomes, { interested: 1, notInterested: 1, followUp: 0, noResponse: 2 });
  assert.equal(Object.values(s.outcomes).reduce((a, b) => a + b, 0), s.totalCalls, 'outcomes always add up to total calls');
  assert.equal(s.interestedLeads, 1); assert.equal(s.conversionRate, 0.25); // 1 interested lead / 4 calls
});
test('stats: a lead is counted as interested only by its LATEST call of the day, and never twice', () => {
  const twice = summarizeEvents([ev(1, 5, 'interested', '09:00:00'), ev(1, 5, 'interested', '10:00:00')]);
  assert.equal(twice.interestedLeads, 1); assert.equal(twice.outcomes.interested, 2); assert.equal(twice.conversionRate, 0.5);
  const changedMind = summarizeEvents([ev(1, 5, 'interested', '09:00:00'), ev(1, 5, 'not_interested', '10:00:00')]);
  assert.equal(changedMind.interestedLeads, 0);
  const cameBack = summarizeEvents([ev(1, 5, 'not_interested', '09:00:00'), ev(1, 5, 'interested', '10:00:00')]);
  assert.equal(cameBack.interestedLeads, 1);
});
test('stats: the latest call is decided by time then id, not by the order the rows arrive in', () => {
  const a = { id: 2, user_id: 1, lead_id: 5, outcome: 'interested', called_at: '2026-10-13 10:00:00' };
  const b = { id: 1, user_id: 1, lead_id: 5, outcome: 'not_interested', called_at: '2026-10-13 09:00:00' };
  assert.equal(summarizeEvents([a, b]).interestedLeads, 1); assert.equal(summarizeEvents([b, a]).interestedLeads, 1);
  const sameSecondLow = { id: 10, user_id: 1, lead_id: 8, outcome: 'not_interested', called_at: '2026-10-13 10:00:00' };
  const sameSecondHigh = { id: 11, user_id: 1, lead_id: 8, outcome: 'interested', called_at: '2026-10-13 10:00:00' };
  assert.equal(summarizeEvents([sameSecondHigh, sameSecondLow]).interestedLeads, 1, 'tie on time -> higher id is later');
});
test('stats: lead ids that are numbers and strings are the same lead; the input array is not modified', () => {
  const events = [ev(1, 5, 'interested', '10:00:00'), ev(1, '5', 'no_response', '09:00:00')];
  const copy = JSON.stringify(events);
  assert.equal(summarizeEvents(events).uniqueLeadsCalled, 1); assert.equal(JSON.stringify(events), copy);
});
test('summarizeByUser: BDEs never mix, and a BDE without calls is simply absent', () => {
  const m = summarizeByUser([ev(1, 5, 'interested', '09:00:00'), ev(2, 5, 'not_interested', '09:00:00'), ev(2, 6, 'interested', '09:05:00')]);
  assert.equal(m.get('1').totalCalls, 1); assert.equal(m.get('2').totalCalls, 2); assert.equal(m.get('2').interestedLeads, 1); assert.equal(m.has('3'), false);
});

test('conversion: ONE definition. Percentage rounded half-up to one decimal with integer arithmetic; fraction is the same digits; no calls -> null', () => {
  assert.equal(conversionPercent(5, 30), 16.7); assert.equal(conversionRate(5, 30), 0.167);
  assert.equal(conversionPercent(1, 3), 33.3); assert.equal(conversionPercent(2, 3), 66.7); assert.equal(conversionPercent(20, 100), 20); assert.equal(conversionPercent(0, 10), 0);
  assert.equal(conversionPercent(1, 8), 12.5); assert.equal(conversionPercent(1, 16), 6.3, '6.25 rounds half up');
  assert.equal(conversionPercent(123, 1000), 12.3); assert.equal(conversionPercent(1235, 10000), 12.4, 'exact .05 boundary rounds up, with no float drift');
  assert.equal(conversionPercent(5, 0), null); assert.equal(conversionRate(5, 0), null); assert.equal(conversionPercent(0, 0), null); assert.equal(conversionPercent(null, null), null);
  for (const [i, t] of [[1, 7], [3, 11], [13, 97], [999, 1000]]) assert.equal(Math.round(conversionRate(i, t) * 1000), Math.round(conversionPercent(i, t) * 10), `${i}/${t}: same digits`);
});
