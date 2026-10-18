// Source-level guards for the Profile module (Express is not installed in every environment, so app.js is checked as text,
// the same technique the existing leads/admin guards use). The real HTTP behaviour is covered by tests-integration/profile.db.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../src/lib/password.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const app = read('../src/app.js');
const lines = app.split('\n');

test('app.js: exactly three profile routes, all behind authenticate, none under the admin router', () => {
  const routes = lines.filter((l) => /^\s*api\.(get|post|put|patch|delete)\('\/profile/.test(l));
  assert.equal(routes.length, 3, routes.join('\n'));
  for (const l of routes) { assert.match(l, /authenticate,/, l); assert.ok(!/authorize\(/.test(l), 'any logged-in role may use their own profile: ' + l); }
  assert.ok(routes.some((l) => /api\.get\('\/profile',/.test(l)));
  assert.ok(routes.some((l) => /api\.patch\('\/profile',/.test(l)));
  assert.ok(routes.some((l) => /api\.post\('\/profile\/password', authenticate, passwordChangeLimiter,/.test(l)));
  assert.ok(!/adminRouter\.\w+\('\/profile/.test(app));
});
test('app.js: profile routes take no id from the URL and are registered after the JSON-only rule', () => {
  assert.ok(!/\/profile\/:/.test(app), 'no /profile/:id route: the user always comes from the session');
  assert.ok(!/api\.delete\('\/profile/.test(app));
  assert.ok(app.indexOf("api.use(requireJsonBody)") < app.indexOf("api.get('/profile'"), 'PATCH/POST /profile are JSON-only like every other write');
});
test('app.js: password change is rate limited per user, with the existing config value', () => {
  assert.match(app, /const passwordChangeLimiter = rateLimit\(/);
  assert.match(app, /keyGenerator: \(req\) => 'user:' \+ req\.user\.id/);
  const block = app.slice(app.indexOf('const passwordChangeLimiter'), app.indexOf("api.get('/profile'"));
  assert.match(block, /limit: config\.loginRateLimitMax/);
});
test('app.js and server.js wire the user service', () => {
  assert.match(app, /interviewService, userService, importService, monthlyReportService, employeeService, callLogService, chatService, assignmentService, activityService, leadSheetService, checkDb \}/);
  assert.match(app, /createUserHandlers\(\{ userService, config \}\)/);
  const server = read('../src/server.js');
  assert.match(server, /createUserService\(\{ repo: createUserRepository\(db\) \}\)/);
  assert.match(server, /interviewService, userService, importService, monthlyReportService, employeeService, callLogService, chatService, assignmentService, activityService, leadSheetService, checkDb:/);
});
test('existing guards still hold: no admin write routes were added by this module, no delete routes', () => {
  assert.equal((app.match(/adminRouter\.(post|put|patch|delete)\(/g) || []).length, 0);
  assert.equal((app.match(/api\.delete\(/g) || []).length, 0);
  assert.equal((app.match(/adminRouter\.get\(/g) || []).length, 14); // 10 in Module 1 + 4 read-only admin payment views from Phase 6; still no admin write routes
});

// ---- migrations ----
const dir = new URL('../db/migrations/', import.meta.url);
const sqlFiles = () => readdirSync(dir).filter((f) => f.endsWith('.sql')).sort(); // exactly how scripts/migrate.js discovers them
const statements = (name) => read('../db/migrations/' + name).split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').split(';').map((s) => s.trim()).filter(Boolean);

// Merged tree, "Option C" (no migration file was renamed): the numbers 007 and 008 each exist TWICE, once from Phase 6 (payments) and once
// from Module 1 (profile). The runner sorts by full file name, so the order below is the order in which a fresh database is built.
test('migrations: the runner discovers exactly these 20 files, in this order (007 and 008 each exist twice; see docs/migration-map.md)', () => {
  assert.deepEqual(sqlFiles(), [
    '001_users_sessions.sql', '002_daily_reports.sql', '003_lead_statuses_leads.sql', '004_seed_proposed_lead_statuses.sql',
    '005_leads_id_user_unique_key.sql', '006_interviews.sql',
    '007_payments.sql', '007_users_phone.sql',
    '008_payment_instalments.sql', '008_users_email.sql',
    '009_payment_receipts.sql', '010_deprecate_interview_payment_flag.sql',
    '011_lead_import_batches.sql', '012_lead_import_rows.sql', // admin Excel/CSV import
    '013_monthly_targets.sql', // monthly targets
    '014_receipt_review.sql', // payment-proof approve/reject
    '015_call_logs.sql', // Call desk: one row per recorded call
    '016_chat_messages.sql', // Team chat: messages
    '017_chat_mentions.sql', // Team chat: @mentions
    '018_chat_reads.sql' // Team chat: read cursors
  ]);
});
test('migrations 007/008: one additive nullable ALTER each, nothing destructive', () => {
  assert.deepEqual(statements('007_users_phone.sql'), ['ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL']);
  assert.deepEqual(statements('008_users_email.sql'), ['ALTER TABLE users ADD COLUMN email VARCHAR(254) NULL']);
  for (const f of ['007_users_phone.sql', '008_users_email.sql']) {
    const sql = statements(f).join(' ');
    assert.ok(!/\b(DROP|UPDATE|DELETE|TRUNCATE|RENAME|NOT NULL|UNIQUE)\b/i.test(sql), f);
  }
});
test('migrations 007/008: document that they must be applied before the profile API is used', () => {
  for (const f of ['007_users_phone.sql', '008_users_email.sql']) assert.match(read('../db/migrations/' + f), /npm run migrate|before the profile API|together with 007/i, f);
});
test('all 12 migration files are byte-for-byte unchanged (001-006 pinned from the Phase 5 original; 007_payments to 010 from the Phase 6 baseline; 007_users_phone and 008_users_email from the Module 1 checkpoint)', () => {
  const PIN = {
  '001_users_sessions.sql': 'c9417b0f5dce70f5d0c8ef081f106c2fe3088dcffacf2c58cacaefea4c6068f6',
  '002_daily_reports.sql': 'ad431b645d96b5fb980f7b7e262bc08c3d8e65828907e96ed04eaa92ad342e3b',
  '003_lead_statuses_leads.sql': '497538be967fa7dc4fe7eb68e067c53bb177f2c0b533c56142dc9aa2e2a683d5',
  '004_seed_proposed_lead_statuses.sql': 'd4e29a8940dfacecfd71f3de6a260d38a84057876761e2bab5cb4fa995675c0b',
  '005_leads_id_user_unique_key.sql': 'd9c3de2b0e0765cc6f38de4c5591741a329eda263feba99d41f5628ccf640098',
  '006_interviews.sql': '73105662c136aced579cff0efc1705a0e3f1e379c95ff1dc9b3f802a4395caaa',
  '007_payments.sql': '67ed6ff36f63a0d8a4ac7daaf3fc15f23296018e388490e79ce5815b27f39fb3',
  '007_users_phone.sql': '6b31e35dc09ab78c5edb0a987133da856a395f5b29eae84405344f7a95ad3a53',
  '008_payment_instalments.sql': 'dd56f578e19f1dd103a9cc8c3f26cedf9ddcb57883757033aff0cae3c4a7f6b0',
  '008_users_email.sql': '43375a84914f4974cdc0d1ca7bdc8feff0054e40acb090e3b19d9751ef3a850e',
  '009_payment_receipts.sql': '703684e3eec080dd811d84bfa174b53d5a8a7d6e255fd13e6134405ceb6266bc',
  '010_deprecate_interview_payment_flag.sql': '2f0b0fd0b2fbb53dc31d5f0b4f863e7258d069815b9fffe346f42ee1f3451728',
  };
  for (const [name, sum] of Object.entries(PIN)) assert.equal(createHash('sha256').update(readFileSync(new URL('../db/migrations/' + name, import.meta.url))).digest('hex'), sum, name);
});

// ---- password policy stays in step with account creation ----
test('password policy: the API minimum equals the create-user script minimum, and the maximum is the login maximum', () => {
  const script = read('../scripts/create-user.js');
  assert.match(script, new RegExp(`MIN_PASSWORD_LENGTH = ${MIN_PASSWORD_LENGTH};`));
  assert.equal(MIN_PASSWORD_LENGTH, 10); assert.equal(MAX_PASSWORD_LENGTH, 200);
});

// ---- documentation must not rot or overclaim ----
test('docs: README lists the 20 migration files and reports the MySQL verification (Module 1 checkpoint) with its limits', () => {
  const readme = read('../../README.md');
  assert.match(readme, /npm run migrate[^\n]*20 migration files/);
  assert.ok(!/12 migration files/.test(readme), 'stale migration count');
  assert.match(readme, /Verify on your machine/); assert.match(readme, /never been run end to end/i, 'the README must keep stating that the assembled app was not run end to end');
  assert.ok(!/migrations 001-006; safe to run again/.test(readme), 'stale 001-006 text');
  assert.ok(!/have not been run against MySQL at all/i.test(readme) && !/has \*\*not\*\* been run yet/i.test(readme), 'stale "not run" statements');
  assert.match(readme, /throwaway MySQL 8\.0\.46/);
  assert.match(readme, /43\/43 passed/);
  assert.match(readme, /not been run on a production-like server/i, 'the limits stay stated');
  assert.match(readme, /Firefox or Safari/);
});
test('docs: .env.example says LOGIN_RATE_LIMIT_MAX also limits password changes', () => {
  const env = read('../.env.example');
  const i = env.indexOf('LOGIN_RATE_LIMIT_MAX=');
  const comment = env.slice(env.lastIndexOf('\n\n', i) === -1 ? 0 : env.lastIndexOf('\n\n', i), i);
  assert.match(comment, /login/i); assert.match(comment, /password/i); assert.match(comment, /per (logged-in )?user|each (logged-in )?user/i);
});
test('docs: profile-assumptions.md records the verification that was run and keeps the unverified scenarios explicit', () => {
  const doc = read('../../docs/profile-assumptions.md').replace(/\*/g, ''); // ignore markdown emphasis
  assert.match(doc, /login that was already in flight|in-flight login/i);
  assert.match(doc, /Verification record/);
  for (const must of ['8.0.46-0ubuntu0.24.04.4', '43/43 passed', '62/62 checks', 'Chromium 141', 'REPEATABLE-READ', 'CHECKSUM TABLE', 'mysql2` 3.24.5']) assert.ok(doc.includes(must), 'missing: ' + must);
  // unverified scenarios must stay stated
  for (const must of ['production-like', 'other MySQL', 'Firefox', 'at the same instant', 'mocked']) assert.ok(doc.includes(must), 'limit no longer stated: ' + must);
  assert.ok(!/closes the small window/i.test(doc), 'old overclaim removed');
  assert.ok(!/ask an admin to clear/i.test(doc));
  assert.ok(!/NOT verified against MySQL|Not yet run|have not been run against MySQL/i.test(doc), 'stale "not verified" statements removed');
});
// ---- backend error codes and the frontend wording stay in step (the frontend must not contradict the backend) ----
test('frontend profile-messages.js handles every error code the change-password service can return', () => {
  const service = read('../src/modules/users/users.service.js');
  const codes = [...service.matchAll(/new HttpError\(\d+, '([A-Z_]+)'/g)].map((m) => m[1]).filter((c) => !['NOT_FOUND', 'INTERNAL_ERROR', 'VALIDATION_ERROR', 'UNAUTHENTICATED'].includes(c));
  assert.deepEqual([...new Set(codes)].sort(), ['PASSWORD_CHANGED_CONCURRENTLY', 'PASSWORD_UPDATE_FAILED', 'PASSWORD_UPDATE_UNCONFIRMED', 'SESSIONS_NOT_FULLY_CLOSED', 'SESSION_INVALIDATION_FAILED']);
  const front = read('../../frontend/src/lib/profile-messages.js');
  for (const c of codes) assert.ok(front.includes(`'${c}'`), 'frontend does not handle ' + c);
});

test('docs: the login-race fix claims only what the MySQL runs demonstrated', () => {
  const doc = read('../../docs/profile-assumptions.md').replace(/\*/g, '');
  assert.match(doc, /insert, then verify/i);
  assert.match(doc, /demonstrated only for the orderings tested/i);
  assert.match(doc, /Not proven for statements overlapping at the same instant/i);
  assert.match(doc, /20\/20 passed in three consecutive full `npm run test:db` runs/);
  assert.ok(!/(is|was) (now )?(verified|proven) (to be )?closed/i.test(doc));
  assert.ok(!/race is closed (in|on) (a )?(production|real server)/i.test(doc));
  const readme = read('../../README.md');
  assert.ok(!/no fix yet/i.test(readme), 'stale README text');
  assert.match(readme, /not proven for statements overlapping at the same instant/i);
  assert.match(readme, /five fixed statement orderings at all four isolation levels/);
});
