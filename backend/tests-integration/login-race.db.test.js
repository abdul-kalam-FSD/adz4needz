// Deterministic MySQL test of "login with the OLD password" racing "change password" (insert-then-verify fix).
// NOT part of `npm test`. Run with: npm run test:db
// Needs backend/.env pointing at a DEVELOPMENT database with ALL 12 migration files applied (never production): 001-010 plus the two
// Module 1 files 007_users_phone.sql and 008_users_email.sql (see docs/migration-map.md).
//
// How it is deterministic: nothing here sleeps or loops hoping for a collision. Every database call of the login and of the
// password change goes through a wrapper that can PAUSE at an exact statement boundary (see tests/helpers/gated-db.js).
// All statements run in autocommit mode, so a paused side holds no locks and cannot block the other side.
// Each scenario is run on dedicated connections under every isolation level, because the fix must not depend on the server default.
//
// What it proves when it passes: for these exact orderings, on this MySQL version and at each of these isolation levels,
// no session created by an old-password login survives a completed password change, and refused logins leave no session behind.
// What it does NOT prove: orderings in which two statements overlap inside the server at the same instant.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config/env.js';
import { createDb } from '../src/db/pool.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { hashToken } from '../src/lib/session-token.js';
import { createAuthRepository } from '../src/modules/auth/auth.repository.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createUserRepository } from '../src/modules/users/users.repository.js';
import { createUserService } from '../src/modules/users/users.service.js';
import { deferred, gatedDb, withTimeout } from '../tests/helpers/gated-db.js';

const LEVELS = ['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'];
const OLD = 'itest-old-' + randomBytes(6).toString('hex');
const NEW = 'itest-new-' + randomBytes(6).toString('hex');
const GENERIC = 'Employee ID or password is incorrect.';
const INSERT_SQL = 'INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR), UTC_TIMESTAMP())';

let config; let db;
const conns = []; const userIds = [];

before(async () => {
  config = loadConfig();
  db = createDb(config.db);
  const [row] = await db.query('SELECT VERSION() AS version, @@transaction_isolation AS isolation');
  console.log(`# MySQL ${row.version}, server default isolation: ${row.isolation}`);
  assert.match(row.version, /^(8|9|1\d)\./, 'the project supports MySQL 8.0 or newer');
});
after(async () => {
  for (const c of conns) await c.end().catch(() => {});
  if (db) {
    if (userIds.length) {
      const marks = userIds.map(() => '?').join(',');
      await db.query(`DELETE FROM sessions WHERE user_id IN (${marks})`, userIds);
      await db.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
    }
    await db.close();
  }
});

// A dedicated autocommit connection at a given isolation level, exposed with the same query() contract as src/db/pool.js.
async function dedicated(level) {
  const c = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database,
    charset: 'utf8mb4', dateStrings: true, timezone: 'Z'
  });
  conns.push(c);
  await c.query('SET autocommit = 1');
  await c.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${level}`);
  const [[state]] = await c.query('SELECT @@transaction_isolation AS level, @@autocommit AS autocommit');
  assert.equal(String(state.level).replace(/-/g, ' '), level, 'connection really runs at ' + level);
  assert.equal(Number(state.autocommit), 1);
  return { async query(sql, params = []) { const [rows] = await c.execute(sql, params); return rows; } };
}

async function world(level) {
  const emp = 'itest-lr-' + randomBytes(5).toString('hex');
  const hash = await hashPassword(OLD);
  const r = await db.query('INSERT INTO users (employee_id, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP())', [emp, 'Itest login race', hash, 'bde']);
  const id = r.insertId; userIds.push(id);
  const lDb = await dedicated(level); const pDb = await dedicated(level);
  const plainAuth = createAuthService({ repo: createAuthRepository(db), ttlHours: 1 });
  const keep = (await plainAuth.login(emp, OLD)).token;          // the device that will change the password
  return {
    emp, id, keep, plainAuth,
    authWith: (rules, mod = (x) => x) => createAuthService({ repo: mod(createAuthRepository(gatedDb(lDb, rules))), ttlHours: 1 }),
    userWith: (rules = []) => createUserService({ repo: createUserRepository(gatedDb(pDb, rules)) }),
    change(svc) { return svc.changePassword({ id }, keep, { currentPassword: OLD, newPassword: NEW }); },
    sessionsLeft: async () => (await db.query('SELECT token_hash FROM sessions WHERE user_id = ?', [id])).map((x) => x.token_hash),
    storedHash: async () => (await db.query('SELECT password_hash FROM users WHERE id = ?', [id]))[0].password_hash
  };
}
async function failure(promise) { try { await promise; } catch (e) { return e; } assert.fail('expected a rejection'); }

for (const level of LEVELS) {
  test(`[${level}] S1 login inserted BEFORE the change: the change's clean-up removes the session and the login is refused`, async () => {
    const w = await world(level); const inserted = deferred(); const release = deferred();
    const lAuth = w.authWith([{ match: /^INSERT INTO sessions/, after: async () => { inserted.resolve(); await release.promise; } }]);
    const loginP = lAuth.login(w.emp, OLD);
    await withTimeout(inserted.promise, 10000, 'login insert');
    await w.change(w.userWith());
    release.resolve();
    const e = await failure(loginP);
    assert.equal(e.code, 'INVALID_CREDENTIALS'); assert.equal(e.message, GENERIC);
    assert.deepEqual(await w.sessionsLeft(), [hashToken(w.keep)]);
    assert.equal(await verifyPassword(NEW, await w.storedHash()), true);
  });

  test(`[${level}] S2 login completes entirely while the change is paused before its UPDATE: the final clean-up removes it`, async () => {
    const w = await world(level); const atUpdate = deferred(); const release = deferred();
    const pSvc = w.userWith([{ match: /^UPDATE users SET password_hash/, before: async () => { atUpdate.resolve(); await release.promise; } }]);
    const changeP = w.change(pSvc);
    await withTimeout(atUpdate.promise, 10000, 'password update');
    const { token } = await w.plainAuth.login(w.emp, OLD);
    assert.ok(await w.plainAuth.getUserForSession(token));
    release.resolve(); await changeP;
    assert.equal(await w.plainAuth.getUserForSession(token), null);
    assert.deepEqual(await w.sessionsLeft(), [hashToken(w.keep)]);
  });

  test(`[${level}] S3 login read the user, the WHOLE change runs, then the login (old hash in hand) inserts and re-checks: refused, nothing left behind`, async () => {
    const w = await world(level); const read1 = deferred(); const release = deferred();
    const lAuth = w.authWith([{ match: /^SELECT id, employee_id, name, password_hash/, after: async () => { read1.resolve(); await release.promise; } }]);
    const loginP = lAuth.login(w.emp, OLD);
    await withTimeout(read1.promise, 10000, 'login read');
    await w.change(w.userWith());
    release.resolve();
    const e = await failure(loginP);
    assert.equal(e.message, GENERIC);
    assert.deepEqual(await w.sessionsLeft(), [hashToken(w.keep)]);
  });

  test(`[${level}] S4 password written but final clean-up not yet run: a login holding the old hash inserts, re-checks, is refused and discarded`, async () => {
    const w = await world(level); const read1 = deferred(); const rel1 = deferred(); const atP4 = deferred(); const relP4 = deferred();
    const lAuth = w.authWith([{ match: /^SELECT id, employee_id, name, password_hash/, after: async () => { read1.resolve(); await rel1.promise; } }]);
    const loginP = lAuth.login(w.emp, OLD);
    await withTimeout(read1.promise, 10000, 'login read');
    const pSvc = w.userWith([{ match: /^DELETE FROM sessions WHERE user_id = \? AND token_hash <> \?/, nth: 2, before: async () => { atP4.resolve(); await relP4.promise; } }]);
    const changeP = w.change(pSvc);
    await withTimeout(atP4.promise, 10000, 'final clean-up');
    rel1.resolve();
    const e = await failure(loginP);
    assert.equal(e.message, GENERIC);
    assert.deepEqual(await w.sessionsLeft(), [hashToken(w.keep)], 'nothing left behind even before the final clean-up ran');
    relP4.resolve(); await changeP;
    assert.deepEqual(await w.sessionsLeft(), [hashToken(w.keep)]);
  });

  test(`[${level}] S5 control: the old insert-only behaviour DOES leave a valid session when the insert happens after the change (the scenarios can detect the bug)`, async () => {
    const w = await world(level); const read1 = deferred(); const release = deferred();
    const insertOnly = (repo) => ({ ...repo, async createSession({ userId, tokenHash, ttlHours }) { await db.query(INSERT_SQL, [userId, tokenHash, ttlHours]); } });
    const lAuth = w.authWith([{ match: /^SELECT id, employee_id, name, password_hash/, after: async () => { read1.resolve(); await release.promise; } }], insertOnly);
    const loginP = lAuth.login(w.emp, OLD);
    await withTimeout(read1.promise, 10000, 'legacy login read');
    await w.change(w.userWith());
    release.resolve();
    const { token } = await loginP;
    assert.ok(await w.plainAuth.getUserForSession(token), 'the race exists without the re-check');
  });
}
