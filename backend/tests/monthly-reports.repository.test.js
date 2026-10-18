// The real monthly repository + service + export tables, on a RECORDING fake database. It proves: the SQL placeholders match the
// parameters, the SQL no longer sums daily_reports (the double-count path), the call-log query ignores undone calls, and that ONE
// scenario gives identical numbers on the team screen, My Month, target progress and both export tables.
// It is NOT MySQL: the SQL text is checked, not executed. See tests-integration for what still needs a real database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonthlyReportRepository } from '../src/modules/monthly-reports/monthly-reports.repository.js';
import { createMonthlyReportService } from '../src/modules/monthly-reports/monthly-reports.service.js';
import { buildSummaryTable, buildPdfTable } from '../src/lib/monthly-report-export.js';
import { conversionPercent } from '../src/lib/call-log.js';

const placeholders = (sql) => (sql.match(/\?/g) || []).length;
const norm = (sql) => sql.replace(/\s+/g, ' ');

// BDE 10 (Asha): manual 05-05 (30 calls, 5 interested); call log 05-06; BOTH on 05-07 (manual 99 must be ignored).
// BDE 11 (Ravi): manual only. BDE 12 (Dev, inactive): only call-log calls. BDE 13: nothing.
function scenario() {
  const log = [];
  const ev = (id, user, lead, outcome, date, time) => ({ id, user_id: user, lead_id: lead, outcome, call_date: date, called_at: `${date} ${time}` });
  const manualAll = [
    { user_id: 10, report_date: '2026-10-05', total_calls: 30, interested: 5, not_interested: 10, follow_up_required: 5, no_response: 10 },
    { user_id: 10, report_date: '2026-10-07', total_calls: 99, interested: 99, not_interested: 0, follow_up_required: 0, no_response: 0 },
    { user_id: 11, report_date: '2026-10-05', total_calls: 40, interested: 8, not_interested: 12, follow_up_required: 10, no_response: 10 }
  ];
  const eventsAll = [
    ev(1, 10, 501, 'no_response', '2026-10-06', '09:00:00'), ev(2, 10, 501, 'interested', '2026-10-06', '11:00:00'), ev(3, 10, 502, 'not_interested', '2026-10-06', '12:00:00'),
    ev(4, 10, 503, 'interested', '2026-10-07', '10:00:00'), ev(5, 12, 601, 'interested', '2026-10-08', '10:00:00'), ev(6, 12, 602, 'no_response', '2026-10-08', '10:05:00')
  ];
  const users = [
    { id: 10, employee_id: 'E10', name: 'Asha', is_active: 1, leads_created: 3, interviews_scheduled: 2, interviews_attended: 1, interviews_no_show: 0, interviews_selected: 1, commitments: 1, committed: '10000.00', received: '4000.00', target_calls: 100, target_interested: 4, target_interviews: null, target_revenue: null },
    { id: 11, employee_id: 'E11', name: 'Ravi', is_active: 1, leads_created: 0, target_calls: null, target_interested: null, target_interviews: null, target_revenue: null },
    { id: 12, employee_id: 'E12', name: 'Dev', is_active: 0, leads_created: 0, target_calls: null, target_interested: null, target_interviews: null, target_revenue: null },
    { id: 13, employee_id: 'E13', name: 'Nil', is_active: 1, target_calls: 50, target_interested: null, target_interviews: null, target_revenue: null }
  ];
  const db = {
    log,
    async query(sql, params = []) {
      const s = norm(sql); log.push({ sql: s, params });
      assert.equal(placeholders(sql), params.length, 'placeholders vs params: ' + s.slice(0, 60));
      const scope = s.includes('u.id = ?') ? params[9] : (s.includes(' AND user_id = ?') ? params[2] : null);
      if (s.startsWith('SELECT u.id, u.employee_id')) return users.filter((u) => scope === null || String(u.id) === String(scope));
      if (s.includes('FROM daily_reports WHERE')) return manualAll.filter((m) => m.report_date >= params[0] && m.report_date < params[1] && (scope === null || String(m.user_id) === String(scope)));
      if (s.includes('FROM call_logs WHERE')) return eventsAll.filter((e) => e.call_date >= params[0] && e.call_date < params[1] && (scope === null || String(e.user_id) === String(scope)));
      throw new Error('unexpected SQL: ' + s.slice(0, 80));
    }
  };
  return db;
}
const admin = { id: 1, role: 'admin' };
const make = () => {
  const db = scenario(); const repo = createMonthlyReportRepository(db); const exported = [];
  const exporter = { xlsx: async (report) => { exported.push(['xlsx', report]); return Buffer.from('x'); }, pdf: async (report) => { exported.push(['pdf', report]); return Buffer.from('p'); } };
  return { db, repo, exported, svc: createMonthlyReportService({ repo, now: () => new Date('2026-10-20T08:00:00Z'), exporter }) };
};

test('SQL guards: no SUM over daily_reports (the double-count path), undone calls are filtered, inactive BDEs with either source stay visible', async () => {
  const { db, svc } = make(); await svc.teamReport(admin, '2026-10');
  const all = db.log.map((q) => q.sql).join('\n');
  assert.ok(!/SUM\(total_calls\)/i.test(all), 'daily_reports is no longer summed in SQL');
  assert.match(all, /FROM call_logs WHERE call_date >= \? AND call_date < \? AND voided_at IS NULL/);
  assert.match(all, /EXISTS \(SELECT 1 FROM daily_reports dr WHERE dr\.user_id = u\.id AND dr\.report_date >= \? AND dr\.report_date < \?\)/);
  assert.match(all, /EXISTS \(SELECT 1 FROM call_logs cl WHERE cl\.user_id = u\.id AND cl\.voided_at IS NULL AND cl\.call_date >= \? AND cl\.call_date < \?\)/);
  assert.equal(db.log.length, 3, 'exactly three queries: BDE rows, manual days, call events');
});
test('parameters: month bounds in the right positions, scoped to the session BDE for My Month', async () => {
  const a = make(); await a.svc.teamReport(admin, '2026-10');
  assert.deepEqual(a.db.log[0].params, ['2026-10-01 00:00:00', '2026-11-01 00:00:00', '2026-10-01 00:00:00', '2026-11-01 00:00:00', '2026-10-01', '2026-11-01', '2026-10-01', '2026-11-01', '2026-10-01', '2026-10-01', '2026-11-01', '2026-10-01', '2026-11-01']);
  assert.deepEqual(a.db.log[1].params, ['2026-10-01', '2026-11-01']); assert.deepEqual(a.db.log[2].params, ['2026-10-01', '2026-11-01']);
  const b = make(); const mine = await b.svc.ownReport({ id: 10, role: 'bde' }, '2026-10');
  assert.equal(b.db.log[0].params[9], 10, 'scope id from the session'); assert.deepEqual(b.db.log[1].params, ['2026-10-01', '2026-11-01', 10]); assert.deepEqual(b.db.log[2].params, ['2026-10-01', '2026-11-01', 10]);
  assert.equal(mine.bdes.length, 1); assert.equal(mine.bdes[0].employeeId, 'E10');
});
test('team report numbers for the mixed scenario (manual day, call-log day, both-sources day, inactive BDE with call-log data)', async () => {
  const { svc } = make(); const r = await svc.teamReport(admin, '2026-10');
  const by = (id) => r.bdes.find((b) => b.employeeId === id);
  const a = by('E10').figures.calls;
  assert.equal(a.total, 30 + 3 + 1, 'manual 05-05 (30) + call log 05-06 (3) + call log 05-07 (1); the manual 99 is ignored');
  assert.equal(a.interested, 5 + 2, 'typed 5 + leads 501 and 503 (501 latest = interested)'); assert.equal(a.interestedCalls, 5 + 2);
  assert.equal(a.notInterested, 10 + 1); assert.equal(a.noResponse, 10 + 1); assert.equal(a.followUpRequired, 5);
  assert.equal(a.distinctLeads, 3); assert.equal(a.repeatCalls, 1); assert.deepEqual(a.sources, { callLogDays: 2, manualOnlyDays: 1, mixedDays: 1, callLogCalls: 4, manualCalls: 30, manualIgnoredCalls: 99 });
  assert.equal(a.daysReported, 3); assert.equal(by('E10').calculated.interestedPercentOfCalls, conversionPercent(7, 34));
  assert.equal(by('E11').figures.calls.total, 40); assert.equal(by('E11').figures.calls.sources.manualOnlyDays, 1);
  assert.equal(by('E12').figures.calls.total, 2); assert.equal(by('E12').figures.calls.interested, 1, 'inactive BDE with call-log data is listed'); assert.equal(by('E12').isActive, false);
  assert.equal(by('E13').figures.calls.total, 0); assert.equal(by('E13').calculated.interestedPercentOfCalls, null, 'no calls -> no conversion, not 0');
  const t = r.total.figures.calls;
  assert.equal(t.total, 34 + 40 + 2); assert.equal(t.interested, 7 + 8 + 1); assert.equal(t.distinctLeads, 3 + 0 + 2); assert.equal(t.sources.manualIgnoredCalls, 99);
  assert.equal(r.total.calculated.interestedPercentOfCalls, conversionPercent(16, 76), 'team conversion is total interested / total calls, not an average of BDE rates');
});
test('target progress uses the merged figures: calls 34 of 100 = 34%, interested leads 7 of 4 = 175%; no target -> null', async () => {
  const { svc } = make(); const r = await svc.teamReport(admin, '2026-10'); const a = r.bdes.find((b) => b.employeeId === 'E10');
  assert.equal(a.achievement.calls, 34); assert.equal(a.achievement.interested, 175); assert.equal(a.achievement.interviews, null);
  assert.equal(r.bdes.find((b) => b.employeeId === 'E13').achievement.calls, 0, 'target 50, no calls: 0%');
  assert.equal(r.total.targets.calls, 150); assert.equal(r.total.achievement.calls, Math.floor((76 * 1000) / 150) / 10);
});
test('SAME numbers everywhere: team report, My Month, the export input, the Excel table and the PDF table', async () => {
  const { svc, exported } = make();
  const team = await svc.teamReport(admin, '2026-10'); const mine = await svc.ownReport({ id: 10, role: 'bde' }, '2026-10');
  assert.deepEqual(mine.bdes[0], team.bdes.find((b) => b.employeeId === 'E10'), 'My Month row == the team row for that BDE');
  await svc.exportReport(admin, '2026-10', 'xlsx'); await svc.exportReport(admin, '2026-10', 'pdf');
  for (const [, rep] of exported) assert.deepEqual(rep.bdes, team.bdes, 'the file is built from the same report as the screen'); // (generatedAt is not part of the report)
  const t = buildSummaryTable(team, 'x'); const col = (h) => t.headers.indexOf(h); const p = buildPdfTable(team);
  team.bdes.forEach((b, i) => {
    assert.equal(t.rows[i][col('Calls')], b.figures.calls.total); assert.equal(t.rows[i][col('Interested')], b.figures.calls.interested);
    assert.equal(t.rows[i][col('Conversion % (interested / calls, calculated)')], b.calculated.interestedPercentOfCalls);
    assert.equal(t.rows[i][col('Distinct leads called')], b.figures.calls.distinctLeads); assert.equal(t.rows[i][col('Repeat calls')], b.figures.calls.repeatCalls);
    assert.equal(t.rows[i][col('Days from Call desk')], b.figures.calls.sources.callLogDays); assert.equal(t.rows[i][col('Manual calls ignored (same day had Call desk calls)')], b.figures.calls.sources.manualIgnoredCalls);
    assert.equal(t.rows[i][col('Calls achieved % (calculated)')], b.achievement.calls); assert.equal(t.rows[i][col('Interested achieved % (calculated)')], b.achievement.interested);
    assert.equal(p.rows[i][1], String(b.figures.calls.total)); assert.equal(p.rows[i][2], String(b.figures.calls.interested)); assert.equal(p.rows[i][10], String(b.figures.calls.distinctLeads));
    assert.equal(p.rows[i][9], b.calculated.interestedPercentOfCalls === null ? '-' : `${b.calculated.interestedPercentOfCalls}%`);
  });
  const last = t.rows.length - 1;
  assert.equal(t.rows[last][0], 'TEAM TOTAL');
  assert.equal(t.rows[last][col('Calls')], team.bdes.reduce((s, b) => s + b.figures.calls.total, 0)); assert.equal(t.rows[last][col('Interested')], team.bdes.reduce((s, b) => s + b.figures.calls.interested, 0));
  assert.equal(t.rows[last][col('Conversion % (interested / calls, calculated)')], conversionPercent(16, 76));
  assert.equal(p.rows[last][9], `${conversionPercent(16, 76)}%`);
});
test('a BDE with no activity at all in the month still gets a row with zeros and no NaN anywhere', async () => {
  const { svc } = make(); const r = await svc.teamReport(admin, '2026-10'); const nil = r.bdes.find((b) => b.employeeId === 'E13');
  const flat = JSON.stringify(nil); assert.ok(!/NaN|null.*undefined/.test(flat)); assert.equal(nil.figures.calls.distinctLeads, 0); assert.equal(nil.figures.calls.daysReported, 0); assert.equal(nil.calculated.averageCallsPerReportedDay, null);
});
test('another month is not affected: September shows nothing for this data', async () => {
  const { svc } = make(); const r = await svc.teamReport(admin, '2026-09'); assert.equal(r.total.figures.calls.total, 0); assert.equal(r.total.figures.calls.sources.callLogDays, 0);
});
