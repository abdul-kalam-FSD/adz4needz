// Regression tests for the monthly calling figures: manual-only days, call-log days, mixed-source days, repeated calls, undone calls,
// date boundaries, and a seeded property test against an independently written oracle. Pure logic, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyCallingByUser } from '../src/lib/monthly-calls.js';
import { parseMonth } from '../src/lib/monthly-report.js';
import { conversionPercent } from '../src/lib/call-log.js';

const OCT = parseMonth('2026-10');
let seq = 0;
const ev = (user, lead, outcome, date, time = '10:00:00', extra = {}) => ({ id: ++seq, user_id: user, lead_id: lead, outcome, call_date: date, called_at: `${date} ${time}`, voided_at: null, ...extra });
const man = (user, date, total, interested = 0, notInterested = 0, followUp = 0, noResponse = 0) => ({ user_id: user, report_date: date, total_calls: total, interested, not_interested: notInterested, follow_up_required: followUp, no_response: noResponse });
const run = (events, manualDays, month = OCT) => monthlyCallingByUser({ month, manualDays, events });
const one = (events, manualDays, user = 1, month = OCT) => run(events, manualDays, month).get(String(user));

test('manual-only days: typed figures are used exactly as before (backward compatible)', () => {
  const r = one([], [man(1, '2026-10-05', 50, 10, 20, 5, 15), man(1, '2026-10-06', 40, 8, 12, 10, 10)]);
  assert.equal(r.total_calls, 90); assert.equal(r.interested, 18); assert.equal(r.interested_calls, 18); assert.equal(r.not_interested, 32); assert.equal(r.follow_up_required, 15); assert.equal(r.no_response, 25);
  assert.equal(r.days_reported, 2); assert.equal(r.manual_only_days, 2); assert.equal(r.call_log_days, 0); assert.equal(r.mixed_days, 0);
  assert.equal(r.distinct_leads, 0, 'manual days carry no lead identity'); assert.equal(r.repeat_calls, 0); assert.equal(r.manual_ignored_calls, 0);
});
test('manual figures are not forced to add up: categories larger than the total are kept as typed (existing rule: no sum check)', () => {
  const r = one([], [man(1, '2026-10-05', 10, 9, 9, 9, 9)]);
  assert.equal(r.total_calls, 10); assert.equal(r.not_interested, 9);
});
test('call-log days: every call counts; outcomes add up to total; interested = distinct leads whose latest call is interested', () => {
  const events = [ev(1, 11, 'interested', '2026-10-05'), ev(1, 12, 'not_interested', '2026-10-05'), ev(1, 13, 'follow_up', '2026-10-05'), ev(1, 14, 'no_response', '2026-10-05'), ev(1, 15, 'interested', '2026-10-06')];
  const r = one(events, []);
  assert.equal(r.total_calls, 5); assert.equal(r.interested, 2); assert.equal(r.interested_calls, 2); assert.equal(r.not_interested, 1); assert.equal(r.follow_up_required, 1); assert.equal(r.no_response, 1);
  assert.equal(r.interested_calls + r.not_interested + r.follow_up_required + r.no_response, r.total_calls, 'outcomes add up to total calls');
  assert.equal(r.distinct_leads, 5); assert.equal(r.repeat_calls, 0); assert.equal(r.call_log_days, 2); assert.equal(r.days_reported, 2); assert.equal(r.manual_only_days, 0);
});
test('MIXED day: call log wins, the manual report for that day is ignored, never added', () => {
  const events = [ev(1, 11, 'interested', '2026-10-05'), ev(1, 12, 'no_response', '2026-10-05')];
  const r = one(events, [man(1, '2026-10-05', 40, 6, 20, 4, 10)]);
  assert.equal(r.total_calls, 2, 'not 42'); assert.equal(r.interested, 1, 'not 7'); assert.equal(r.not_interested, 0, 'typed 20 ignored');
  assert.equal(r.mixed_days, 1); assert.equal(r.manual_ignored_calls, 40); assert.equal(r.manual_only_days, 0); assert.equal(r.call_log_days, 1); assert.equal(r.days_reported, 1, 'one day, not two');
});
test('MIXED month: each day uses exactly one source (manual Mon, call log Tue, both Wed, nothing Thu)', () => {
  const events = [ev(1, 11, 'interested', '2026-10-06'), ev(1, 12, 'no_response', '2026-10-07')];
  const manual = [man(1, '2026-10-05', 30, 5, 10, 5, 10), man(1, '2026-10-07', 99, 99, 0, 0, 0)];
  const r = one(events, manual);
  assert.equal(r.total_calls, 30 + 1 + 1); assert.equal(r.interested, 5 + 1); assert.equal(r.no_response, 10 + 1); assert.equal(r.not_interested, 10);
  assert.equal(r.days_reported, 3); assert.equal(r.manual_only_days, 1); assert.equal(r.call_log_days, 2); assert.equal(r.mixed_days, 1); assert.equal(r.manual_ignored_calls, 99);
  assert.equal(r.call_log_calls, 2); assert.equal(r.manual_calls, 30); assert.equal(r.call_log_calls + r.manual_calls, r.total_calls);
});
test('repeated calls: the same lead called three times is 3 calls, 1 distinct lead, 2 repeat calls', () => {
  const r = one([ev(1, 11, 'no_response', '2026-10-05', '09:00:00'), ev(1, 11, 'no_response', '2026-10-05', '11:00:00'), ev(1, 11, 'interested', '2026-10-05', '15:00:00')], []);
  assert.equal(r.total_calls, 3); assert.equal(r.distinct_leads, 1); assert.equal(r.repeat_calls, 2); assert.equal(r.interested, 1); assert.equal(r.interested_calls, 1); assert.equal(r.no_response, 2);
  assert.equal(conversionPercent(r.interested, r.total_calls), 33.3);
});
test('repeated calls ACROSS days: a lead counts once per month; its latest call in the month decides', () => {
  const twice = one([ev(1, 11, 'interested', '2026-10-05'), ev(1, 11, 'interested', '2026-10-12')], []);
  assert.equal(twice.interested, 1, 'one interested lead'); assert.equal(twice.interested_calls, 2, 'two interested calls'); assert.equal(twice.distinct_leads, 1); assert.equal(twice.repeat_calls, 1); assert.equal(twice.total_calls, 2);
  const changedMind = one([ev(1, 11, 'interested', '2026-10-05'), ev(1, 11, 'not_interested', '2026-10-12')], []);
  assert.equal(changedMind.interested, 0); assert.equal(changedMind.interested_calls, 1);
  const cameBack = one([ev(1, 11, 'not_interested', '2026-10-05'), ev(1, 11, 'interested', '2026-10-12')], []);
  assert.equal(cameBack.interested, 1);
});
test('latest call is decided by time then id, not by the order rows arrive', () => {
  const a = ev(1, 11, 'not_interested', '2026-10-05', '09:00:00'); const b = ev(1, 11, 'interested', '2026-10-05', '09:00:00'); // same second: higher id is later
  assert.equal(one([b, a], []).interested, 1); assert.equal(one([a, b], []).interested, 1);
  const early = ev(1, 12, 'interested', '2026-10-20', '08:00:00'); const late = ev(1, 12, 'no_response', '2026-10-05', '08:00:00');
  assert.equal(one([late, early], []).interested, 1, 'chronological, not by call_date order of arrival');
});
test('undone calls never count; a day with only undone calls falls back to its manual report', () => {
  const r = one([ev(1, 11, 'interested', '2026-10-05', '10:00:00', { voided_at: '2026-10-05 10:01:00' })], [man(1, '2026-10-05', 20, 4, 6, 5, 5)]);
  assert.equal(r.total_calls, 20); assert.equal(r.manual_only_days, 1); assert.equal(r.call_log_days, 0); assert.equal(r.mixed_days, 0); assert.equal(r.interested, 4);
  assert.equal(run([ev(1, 11, 'interested', '2026-10-05', '10:00:00', { voided_at: 'x' })], []).has('1'), false, 'no activity at all -> absent');
});

test('date boundaries: Oct 1 and Oct 31 are in; Sep 30 and Nov 1 are out (events and manual reports)', () => {
  const events = [ev(1, 1, 'interested', '2026-09-30'), ev(1, 2, 'interested', '2026-10-01'), ev(1, 3, 'interested', '2026-10-31'), ev(1, 4, 'interested', '2026-11-01')];
  const manual = [man(1, '2026-09-30', 100), man(1, '2026-10-01', 7), man(1, '2026-10-31', 11), man(1, '2026-11-01', 100)];
  const r = one(events, manual);
  assert.equal(r.total_calls, 2, 'Oct 1 and Oct 31 call-log days only'); assert.equal(r.mixed_days, 2); assert.equal(r.manual_ignored_calls, 18); assert.equal(r.call_log_days, 2);
  const manualOnly = one([], manual); assert.equal(manualOnly.total_calls, 18); assert.equal(manualOnly.days_reported, 2);
});
test('date boundaries: December -> January, leap February, 30-day months', () => {
  const dec = parseMonth('2026-12'); const jan = parseMonth('2027-01'); const feb = parseMonth('2028-02'); const apr = parseMonth('2026-04');
  const events = [ev(1, 1, 'interested', '2026-12-31'), ev(1, 2, 'interested', '2027-01-01'), ev(1, 3, 'interested', '2028-02-29'), ev(1, 4, 'interested', '2028-03-01'), ev(1, 5, 'interested', '2026-04-30'), ev(1, 6, 'interested', '2026-05-01')];
  assert.equal(one(events, [], 1, dec).total_calls, 1); assert.equal(one(events, [], 1, jan).total_calls, 1);
  assert.equal(one(events, [], 1, feb).total_calls, 1); assert.equal(one(events, [], 1, apr).total_calls, 1);
});
test('date boundaries: the working date, not the UTC time, decides the month (a call at 00:30 IST on Nov 1 is November)', () => {
  const lateOct31Utc = ev(1, 1, 'interested', '2026-11-01', '19:00:00'); // called_at is on its own; call_date says Nov 1 (stored by the call desk)
  lateOct31Utc.called_at = '2026-10-31 19:00:00';
  assert.equal(run([lateOct31Utc], []).has('1'), false, 'not in October'); assert.equal(one([lateOct31Utc], [], 1, parseMonth('2026-11')).total_calls, 1);
});
test('values that arrive as strings or Date-like text from MySQL are handled; call_date with a time part is cut to the day', () => {
  const r = one([ev(1, '11', 'interested', '2026-10-05')], [{ user_id: '1', report_date: '2026-10-06 00:00:00', total_calls: '30', interested: '5', not_interested: '10', follow_up_required: '5', no_response: '10' }]);
  assert.equal(r.total_calls, 31); assert.equal(r.interested, 6); assert.equal(r.manual_only_days, 1);
});

test('BDEs never mix; a BDE with no activity is absent; ids that are numbers and strings are the same BDE and lead', () => {
  const m = run([ev(1, 11, 'interested', '2026-10-05'), ev(2, 11, 'not_interested', '2026-10-05'), ev('2', '12', 'interested', '2026-10-06')], [man(3, '2026-10-05', 10, 1, 1, 1, 7)]);
  assert.equal(m.get('1').total_calls, 1); assert.equal(m.get('1').interested, 1);
  assert.equal(m.get('2').total_calls, 2); assert.equal(m.get('2').interested, 1); assert.equal(m.get('2').distinct_leads, 2, 'lead 11 and lead 12');
  assert.equal(m.get('3').total_calls, 10); assert.equal(m.has('4'), false);
});
test('the inputs are not modified', () => {
  const events = [ev(1, 11, 'interested', '2026-10-05', '12:00:00'), ev(1, 11, 'no_response', '2026-10-05', '09:00:00')]; const manual = [man(1, '2026-10-05', 5)];
  const copy = JSON.stringify([events, manual]); run(events, manual); assert.equal(JSON.stringify([events, manual]), copy);
});

// ---- property test: a seeded random month checked against a separately written oracle (day by day, one lead at a time) ----
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }
function oracle(userId, events, manualDays, month) {
  const dates = []; for (let d = 1; d <= month.days; d++) dates.push(`${month.month}-${String(d).padStart(2, '0')}`);
  const res = { total: 0, intLeads: 0, intCalls: 0, notInt: 0, follow: 0, noResp: 0, days: 0, logDays: 0, manualDays: 0, mixed: 0, ignored: 0, distinct: 0 };
  const mine = events.filter((e) => e.user_id === userId && !e.voided_at);
  const latestByLead = new Map();
  for (const e of [...mine].sort((a, b) => `${a.called_at}#${String(a.id).padStart(12, '0')}`.localeCompare(`${b.called_at}#${String(b.id).padStart(12, '0')}`))) {
    if (e.call_date >= month.start && e.call_date < month.endExclusive) latestByLead.set(e.lead_id, e.outcome);
  }
  for (const date of dates) {
    const dayEvents = mine.filter((e) => e.call_date === date); const m = manualDays.find((x) => x.user_id === userId && x.report_date === date);
    if (dayEvents.length > 0) {
      res.logDays++; res.days++; res.total += dayEvents.length;
      for (const e of dayEvents) { if (e.outcome === 'interested') res.intCalls++; else if (e.outcome === 'not_interested') res.notInt++; else if (e.outcome === 'follow_up') res.follow++; else res.noResp++; }
      if (m) { res.mixed++; res.ignored += m.total_calls; }
    } else if (m) { res.manualDays++; res.days++; res.total += m.total_calls; res.intLeads += m.interested; res.intCalls += m.interested; res.notInt += m.not_interested; res.follow += m.follow_up_required; res.noResp += m.no_response; }
  }
  res.distinct = latestByLead.size; res.intLeads += [...latestByLead.values()].filter((o) => o === 'interested').length;
  return res;
}
test('property: 300 seeded random months (mixed sources, repeats, undone calls, out-of-month rows) match the oracle for every BDE', () => {
  const outcomes = ['interested', 'not_interested', 'follow_up', 'no_response'];
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = lcg(seed); const pick = (n) => Math.floor(rnd() * n);
    const events = []; const manualDays = []; let id = 0;
    for (let i = 0, n = pick(60); i < n; i++) {
      const user = 1 + pick(3); const day = 1 + pick(35) - 2; // days -1..33: some fall outside October
      const date = day < 1 ? `2026-09-${String(30 + day).padStart(2, '0')}` : day > 31 ? `2026-11-${String(day - 31).padStart(2, '0')}` : `2026-10-${String(day).padStart(2, '0')}`;
      events.push({ id: ++id, user_id: user, lead_id: 1 + pick(8), outcome: outcomes[pick(4)], call_date: date, called_at: `${date} ${String(pick(24)).padStart(2, '0')}:${String(pick(60)).padStart(2, '0')}:00`, voided_at: pick(6) === 0 ? 'x' : null });
    }
    const seen = new Set();
    for (let i = 0, n = pick(25); i < n; i++) {
      const user = 1 + pick(3); const d = 1 + pick(31); const date = `2026-10-${String(d).padStart(2, '0')}`; if (seen.has(`${user}|${date}`)) continue; seen.add(`${user}|${date}`);
      manualDays.push(man(user, date, pick(60), pick(10), pick(20), pick(10), pick(10)));
    }
    const got = run(events, manualDays);
    for (const user of [1, 2, 3]) {
      const want = oracle(user, events, manualDays, OCT); const g = got.get(String(user));
      if (want.days === 0) { assert.equal(g, undefined, `seed ${seed} user ${user}: no activity`); continue; }
      const label = `seed ${seed} user ${user}`;
      assert.deepEqual({ t: g.total_calls, il: g.interested, ic: g.interested_calls, ni: g.not_interested, fu: g.follow_up_required, nr: g.no_response, d: g.days_reported, ld: g.call_log_days, md: g.manual_only_days, mx: g.mixed_days, ig: g.manual_ignored_calls, dl: g.distinct_leads },
        { t: want.total, il: want.intLeads, ic: want.intCalls, ni: want.notInt, fu: want.follow, nr: want.noResp, d: want.days, ld: want.logDays, md: want.manualDays, mx: want.mixed, ig: want.ignored, dl: want.distinct }, label);
      assert.equal(g.call_log_calls + g.manual_calls, g.total_calls, label + ': sources add up to the total');
      assert.equal(g.days_reported, g.call_log_days + g.manual_only_days, label + ': a day is in exactly one source');
    }
  }
});
