import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyReportService } from '../src/modules/daily-reports/daily-reports.service.js';

const body = { reportDate: '2026-10-10', totalCalls: 50, interested: 10, notInterested: 20, followUpRequired: 5, noResponse: 15 };

function fakeRepo() {
  const rows = [];
  return {
    rows,
    insert: async (userId, v) => {
      if (rows.some((r) => r.userId === userId && r.reportDate === v.reportDate)) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
      rows.push({ userId, ...v });
    },
    findByUserAndDate: async (userId, d) => rows.find((r) => r.userId === userId && r.reportDate === d) || null,
    listByUser: async (userId, limit) => rows.filter((r) => r.userId === userId).slice(0, limit)
  };
}

test('valid report is saved for the SESSION user, ignoring any userId in the body', async () => {
  const repo = fakeRepo(); const s = createDailyReportService({ repo });
  const saved = await s.submit(3, { ...body, userId: 999, user_id: 999 });
  assert.equal(repo.rows.length, 1); assert.equal(repo.rows[0].userId, 3); assert.equal(saved.totalCalls, 50);
});
test('invalid input -> 400 with field errors and nothing is inserted', async () => {
  const repo = fakeRepo(); const s = createDailyReportService({ repo });
  await assert.rejects(s.submit(3, { ...body, totalCalls: -5, reportDate: '' }), (e) => e.status === 400 && e.code === 'VALIDATION_ERROR' && Boolean(e.fields.totalCalls) && Boolean(e.fields.reportDate));
  assert.equal(repo.rows.length, 0);
});
test('categories larger than total calls are accepted (no sum rule)', async () => {
  const s = createDailyReportService({ repo: fakeRepo() });
  await s.submit(1, { ...body, totalCalls: 1, interested: 40, notInterested: 40 });
});
test('second report for the same BDE and date -> 409 (assumption pending TL)', async () => {
  const s = createDailyReportService({ repo: fakeRepo() });
  await s.submit(3, body);
  await assert.rejects(s.submit(3, body), (e) => e.status === 409 && e.code === 'DUPLICATE_REPORT' && Boolean(e.fields.reportDate));
});
test('two different BDEs can report the same date', async () => {
  const s = createDailyReportService({ repo: fakeRepo() });
  await s.submit(3, body); await s.submit(4, body);
});
test('unexpected database errors are not swallowed', async () => {
  const repo = { ...fakeRepo(), insert: async () => { throw new Error('db down'); } };
  await assert.rejects(createDailyReportService({ repo }).submit(3, body), /db down/);
});
test('listOwn only asks the repository for the session user', async () => {
  const repo = fakeRepo(); const s = createDailyReportService({ repo });
  await s.submit(3, body); await s.submit(4, { ...body, reportDate: '2026-10-09' });
  const mine = await s.listOwn(3, 30); assert.equal(mine.length, 1); assert.equal(mine[0].userId, 3);
});
