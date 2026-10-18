// Login-vs-password-change race (R1). Four layers, from abstract to concrete:
//   1. interleaving MODEL: which designs are safe under stated assumptions (not MySQL)
//   2. repository + service unit tests with a recording fake db
//   3. the REAL repositories and services run against an in-memory SQL fake, with deterministic gates at statement boundaries
//   4. source guards for the assumptions the fix relies on
// None of this is MySQL. The MySQL version of layer 3 is tests-integration/login-race.db.test.js (NOT run yet).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { check, DESIGNS } from './helpers/login-race-model.js';
import { deferred, gatedDb, withTimeout } from './helpers/gated-db.js';
import { createFakeSqlDb } from './helpers/fake-sql-db.js';
import { createAuthRepository } from '../src/modules/auth/auth.repository.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createUserRepository } from '../src/modules/users/users.repository.js';
import { createUserService } from '../src/modules/users/users.service.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { hashToken } from '../src/lib/session-token.js';

const OLD = 'old-password-123';
const NEW = 'brand-new-pass-456';
const GENERIC = 'Employee ID or password is incorrect.';
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// ---------- 1. model ----------
test('MODEL: the current design (insert only) has race interleavings, including "login verified, whole change, then insert"', () => {
  const r = check('current');
  assert.ok(r.violations.length > 0);
  assert.ok(r.violations.includes('A P2 P3 P4 B'), r.violations.join(' | '));
});
test('MODEL: insert-then-verify has no violating interleaving and leaves no orphan session', () => {
  const r = check('insert-then-verify');
  assert.equal(r.total, 20);
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.orphans, []);
});
test('MODEL: an INSERT ... SELECT whose read is not locking (split check + insert) is NOT safe; one atomic step would be (isolation-dependent)', () => {
  assert.ok(check('conditional-split').violations.length > 0, 'READ COMMITTED style: unsafe');
  assert.deepEqual(check('conditional-atomic').violations, [], 'only if the read locks (REPEATABLE READ / SERIALIZABLE): documented behaviour, unverified here');
});
test('MODEL: the fix depends on the password change finishing its final clean-up; if that fails the API must say so', () => {
  const r = check('insert-then-verify', { skipP4: true });
  assert.ok(r.violations.length > 0, 'without the final clean-up an early session can survive');
  // ...which is exactly the case users.service reports as SESSIONS_NOT_FULLY_CLOSED (tested in users.service.test.js).
  assert.match(read('../src/modules/users/users.service.js'), /SESSIONS_NOT_FULLY_CLOSED/);
});
test('MODEL: every design is covered', () => { assert.deepEqual(DESIGNS.sort(), ['conditional-atomic', 'conditional-split', 'current', 'insert-then-verify']); });

// ---------- 2. repository unit tests ----------
function recDb(results = []) {
  const calls = [];
  return { calls, async query(sql, params) { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); const r = results.shift(); if (r instanceof Error) throw r; return r; } };
}
const sess = { userId: 7, tokenHash: 'TH', ttlHours: 8, passwordHash: 'PH' };
const SEL = 'SELECT 1 AS ok FROM users WHERE id = ? AND is_active = 1 AND BINARY password_hash = ? LIMIT 1';

test('createSession: inserts, re-checks the user row, keeps the session and returns exactly true', async () => {
  const db = recDb([{ affectedRows: 1 }, [{ ok: 1 }]]);
  const r = await createAuthRepository(db).createSession(sess);
  assert.equal(r, true);
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /^INSERT INTO sessions /);
  assert.deepEqual(db.calls[0].params, [7, 'TH', 8]);
  assert.equal(db.calls[1].sql, SEL);
  assert.deepEqual(db.calls[1].params, [7, 'PH']);
});
test('createSession: password (or account) changed -> removes the session by its HASH and returns exactly false', async () => {
  const db = recDb([{ affectedRows: 1 }, [], { affectedRows: 1 }]);
  const r = await createAuthRepository(db).createSession(sess);
  assert.equal(r, false);
  assert.equal(db.calls[2].sql, 'DELETE FROM sessions WHERE token_hash = ?');
  assert.deepEqual(db.calls[2].params, ['TH']);
});
test('createSession fails closed: an unexpected answer to the re-check counts as "changed"', async () => {
  for (const odd of [undefined, null, 'x', { affectedRows: 1 }, [{ ok: 1 }, { ok: 1 }]]) {
    const db = recDb([{ affectedRows: 1 }, odd, { affectedRows: 1 }]);
    assert.equal(await createAuthRepository(db).createSession(sess), false, JSON.stringify(odd));
    assert.match(db.calls.at(-1).sql, /^DELETE FROM sessions WHERE token_hash/);
  }
});
test('createSession: the re-check fails -> session removed again and the ORIGINAL error is thrown', async () => {
  const boom = Object.assign(new Error('lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
  const db = recDb([{ affectedRows: 1 }, boom, { affectedRows: 1 }]);
  await assert.rejects(createAuthRepository(db).createSession(sess), (e) => e === boom);
  assert.equal(db.calls[2].sql, 'DELETE FROM sessions WHERE token_hash = ?');
});
test('createSession: a failing clean-up never hides the outcome (false stays false, the original error stays the error)', async () => {
  const del = new Error('delete failed');
  assert.equal(await createAuthRepository(recDb([{ affectedRows: 1 }, [], del])).createSession(sess), false);
  const boom = new Error('select failed');
  await assert.rejects(createAuthRepository(recDb([{ affectedRows: 1 }, boom, del])).createSession(sess), (e) => e === boom);
});
test('createSession: if the INSERT itself fails nothing else runs', async () => {
  const db = recDb([new Error('insert failed')]);
  await assert.rejects(createAuthRepository(db).createSession(sess), /insert failed/);
  assert.equal(db.calls.length, 1);
});
test('createSession cannot run without the verified hash: refused before any SQL', async () => {
  for (const passwordHash of [undefined, null, '', 5]) {
    const db = recDb([{ affectedRows: 1 }]);
    await assert.rejects(createAuthRepository(db).createSession({ ...sess, passwordHash }), TypeError);
    assert.equal(db.calls.length, 0);
  }
});
test('createSession never sends the raw token or the password hash into the sessions table', async () => {
  const db = recDb([{ affectedRows: 1 }, [{ ok: 1 }]]);
  await createAuthRepository(db).createSession({ ...sess, tokenHash: 'ONLY-THE-HASH', passwordHash: 'PH' });
  assert.ok(!JSON.stringify(db.calls[0].params).includes('PH'));
});

// ---------- 2b. service unit tests (existing fake style) ----------
function fakeAuthRepo(over = {}) {
  const calls = [];
  const user = { id: 7, employee_id: 'E7', name: 'Anu', role: 'bde', is_active: 1, password_hash: null };
  return {
    calls, user,
    repo: {
      async findUserByEmployeeId(id) { calls.push(['find', id]); return id === 'E7' ? user : null; },
      async createSession(args) { calls.push(['createSession', args]); return 'created' in over ? over.created : true; },
      async deleteExpiredSessionsForUser() { calls.push(['expired']); },
      async deleteSessionByHash() {}, async findActiveSessionUser() { return null; }
    }
  };
}
test('login: passes the exact hash it verified against to createSession', async () => {
  const f = fakeAuthRepo(); f.user.password_hash = await hashPassword(OLD);
  await createAuthService({ repo: f.repo, ttlHours: 8 }).login('E7', OLD);
  const args = f.calls.find((c) => c[0] === 'createSession')[1];
  assert.equal(args.passwordHash, f.user.password_hash);
  assert.equal(args.userId, 7); assert.equal(args.ttlHours, 8);
  assert.match(args.tokenHash, /^[0-9a-f]{64}$/);
});
test('login: createSession refuses (false) -> the same generic 401 as any failed login, no token, no clean-up call', async () => {
  const f = fakeAuthRepo({ created: false }); f.user.password_hash = await hashPassword(OLD);
  const svc = createAuthService({ repo: f.repo, ttlHours: 8 });
  const e = await svc.login('E7', OLD).then(() => assert.fail('should reject'), (x) => x);
  assert.equal(e.status, 401); assert.equal(e.code, 'INVALID_CREDENTIALS'); assert.equal(e.message, GENERIC);
  assert.ok(!f.calls.some((c) => c[0] === 'expired'));
  const wrong = await svc.login('E7', 'wrong-password-1').then(() => assert.fail(), (x) => x);
  assert.equal(wrong.message, e.message, 'a race refusal is indistinguishable from a wrong password');
  assert.equal(wrong.code, e.code);
});
test('login: true (and, for the existing fakes, undefined) keeps the normal success path', async () => {
  for (const created of [true, undefined]) {
    const f = fakeAuthRepo({ created }); f.user.password_hash = await hashPassword(OLD);
    const r = await createAuthService({ repo: f.repo, ttlHours: 8 }).login('E7', OLD);
    assert.ok(r.token && r.user.employeeId === 'E7' && !('password_hash' in r.user));
    assert.ok(f.calls.some((c) => c[0] === 'expired'));
  }
});
test('login: the real repository returns a strict boolean, so the "=== false" check cannot fail open', async () => {
  const yes = await createAuthRepository(recDb([{ affectedRows: 1 }, [{ ok: 1 }]])).createSession(sess);
  const no = await createAuthRepository(recDb([{ affectedRows: 1 }, [], {}])).createSession(sess);
  assert.equal(yes, true); assert.equal(no, false);
});

// ---------- 3. REAL repositories + services, deterministic gates, in-memory SQL ----------
const me = { id: 7, role: 'bde' };
async function world() {
  const fake = createFakeSqlDb({ users: [{ id: 7, employee_id: 'E7', name: 'Anu', role: 'bde', is_active: 1, password_hash: await hashPassword(OLD) }] });
  const plainAuth = createAuthService({ repo: createAuthRepository(fake), ttlHours: 8 });
  const keep = (await plainAuth.login('E7', OLD)).token; // the device that will change the password
  const authWith = (rules, repoMod) => createAuthService({ repo: repoMod(createAuthRepository(gatedDb(fake, rules))), ttlHours: 8 });
  const userWith = (rules = []) => createUserService({ repo: createUserRepository(gatedDb(fake, rules)) });
  const change = (svc) => svc.changePassword(me, keep, { currentPassword: OLD, newPassword: NEW });
  const sessionsLeft = () => fake.state.sessions.map((s) => s.token_hash);
  return { fake, plainAuth, keep, authWith, userWith, change, sessionsLeft };
}
const same = (r) => r;
async function failure(promise) { try { await promise; } catch (e) { return e; } assert.fail('expected a rejection'); }

test('SCENARIO 1 login inserted its session BEFORE the change: the change\'s own clean-up removes it, and the login re-check refuses the login', async () => {
  const w = await world(); const inserted = deferred(); const release = deferred();
  const lAuth = w.authWith([{ match: /^INSERT INTO sessions/, after: async () => { inserted.resolve(); await release.promise; } }], same);
  const loginP = lAuth.login('E7', OLD);
  await withTimeout(inserted.promise, 5000, 'login insert');
  await w.change(w.userWith());                      // P2, P3, P4 all complete while the login is paused after its insert
  release.resolve();
  const e = await failure(loginP);
  assert.equal(e.code, 'INVALID_CREDENTIALS'); assert.equal(e.message, GENERIC);
  assert.deepEqual(w.sessionsLeft(), [hashToken(w.keep)], 'only the device that changed the password is signed in');
  assert.equal(await verifyPassword(NEW, w.fake.state.users.get(7).password_hash), true);
});
test('SCENARIO 2 the login completes entirely while the password change is paused between its first clean-up and the update -> the final clean-up removes it', async () => {
  const w = await world(); const atUpdate = deferred(); const release = deferred();
  const pSvc = w.userWith([{ match: /^UPDATE users SET password_hash/, before: async () => { atUpdate.resolve(); await release.promise; } }]);
  const changeP = w.change(pSvc);
  await withTimeout(atUpdate.promise, 5000, 'password update');
  const { token } = await w.plainAuth.login('E7', OLD); // password still old: the login is legitimately accepted
  assert.ok(await w.plainAuth.getUserForSession(token), 'valid at this moment');
  release.resolve(); await changeP;
  assert.equal(await w.plainAuth.getUserForSession(token), null, 'removed by the final clean-up');
  assert.deepEqual(w.sessionsLeft(), [hashToken(w.keep)]);
});
test('SCENARIO 3 login read the user, the whole password change runs, then the login (still holding the OLD hash) continues -> refused', async () => {
  const w = await world(); const read1 = deferred(); const release = deferred();
  const lAuth = w.authWith([{ match: /^SELECT id, employee_id, name, password_hash/, after: async () => { read1.resolve(); await release.promise; } }], same);
  const loginP = lAuth.login('E7', OLD);
  await withTimeout(read1.promise, 5000, 'login read');
  await w.change(w.userWith());
  release.resolve();
  const e = await failure(loginP);
  assert.equal(e.message, GENERIC);
  assert.deepEqual(w.sessionsLeft(), [hashToken(w.keep)]);
});
test('SCENARIO 4 password already written but its final clean-up not yet run, while a login that read the OLD hash inserts and re-checks -> refused and discarded', async () => {
  const w = await world(); const read1 = deferred(); const rel1 = deferred(); const atP4 = deferred(); const relP4 = deferred();
  const lAuth = w.authWith([{ match: /^SELECT id, employee_id, name, password_hash/, after: async () => { read1.resolve(); await rel1.promise; } }], same);
  const loginP = lAuth.login('E7', OLD);
  await withTimeout(read1.promise, 5000, 'login read');
  const pSvc = w.userWith([{ match: /^DELETE FROM sessions WHERE user_id = \? AND token_hash <> \?/, nth: 2, before: async () => { atP4.resolve(); await relP4.promise; } }]);
  const changeP = w.change(pSvc);
  await withTimeout(atP4.promise, 5000, 'final clean-up');   // P2 and P3 are done, P4 has not run
  rel1.resolve();
  const e = await failure(loginP);                           // insert, re-check sees the new hash, discard
  assert.equal(e.message, GENERIC);
  assert.deepEqual(w.sessionsLeft(), [hashToken(w.keep)], 'the refused login left nothing behind even before P4 ran');
  relP4.resolve(); await changeP;
  assert.deepEqual(w.sessionsLeft(), [hashToken(w.keep)]);
});
test('SCENARIO 5 control: the Phase 5 behaviour (insert, no re-check) DOES keep a valid session when the insert happens after the change, so the scenarios can detect the bug', async () => {
  const w = await world(); const read1 = deferred(); const release = deferred();
  const insertOnly = (repo) => ({ ...repo, async createSession({ userId, tokenHash, ttlHours }) {
    await w.fake.query('INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR), UTC_TIMESTAMP())', [userId, tokenHash, ttlHours]);
  } });
  const lAuth = w.authWith([{ match: /^SELECT id, employee_id, name, password_hash/, after: async () => { read1.resolve(); await release.promise; } }], insertOnly);
  const loginP = lAuth.login('E7', OLD);                 // same steps as scenario 3, but with the old insert-only createSession
  await withTimeout(read1.promise, 5000, 'legacy login read');
  await w.change(w.userWith());                          // the whole change, including both clean-ups, is over
  release.resolve();
  const { token } = await loginP;
  assert.ok(await w.plainAuth.getUserForSession(token), 'the race: an old-password login holds a valid session after the password change');
});
test('SCENARIO 6 no concurrency: ordinary login, password change and re-login behave as before', async () => {
  const w = await world();
  const { token } = await w.plainAuth.login('E7', OLD);
  await w.change(w.userWith());
  assert.equal(await w.plainAuth.getUserForSession(token), null);
  assert.ok((await w.plainAuth.login('E7', NEW)).token);
  assert.equal((await failure(w.plainAuth.login('E7', OLD))).message, GENERIC);
});

// ---------- 4. source guards for the assumptions the fix relies on ----------
// Merged-tree note: since Phase 6 the shared db object also has a transaction helper (src/db/pool.js), used ONLY by the payments
// module on its own pooled connection. The login-race fix needs only that the AUTH and USERS statements are autocommitted, so the
// ban is scoped to those two modules, plus two checks that the shared plain-query path still runs each statement on its own.
// This is a source guard (reasoning), not proof: the merged-tree tests-integration/login-race.db.test.js has to show it on MySQL.
test('assumption: the auth and users modules never open a transaction or pin a connection, and db.query still runs each statement on its own via pool.execute (autocommit)', () => {
  const dirs = ['../src/modules/auth', '../src/modules/users'];
  const walk = (rel) => readdirSync(new URL(rel + '/', import.meta.url), { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(rel + '/' + d.name) : [rel + '/' + d.name]);
  const files = dirs.flatMap(walk).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 6, 'the scan must really cover the auth and users modules: ' + files.join(', '));
  for (const file of files) {
    const src = read(file);
    assert.ok(!/START TRANSACTION|BEGIN\b|getConnection|beginTransaction|SET (SESSION )?TRANSACTION|SET autocommit/i.test(src), file);
    assert.ok(!/\.transaction\(/.test(src), file + ' must not use the transaction helper');
  }
  // the plain query path that those modules use stays a single pooled statement (no pinned connection)
  const pool = read('../src/db/pool.js');
  const query = pool.match(/async query\([^)]*\) \{[\s\S]*?\n    \},/);
  assert.ok(query, 'could not find db.query in src/db/pool.js');
  assert.match(query[0], /pool\.execute\(/);
  assert.ok(!/getConnection|beginTransaction|conn\./.test(query[0]), 'db.query must not use a pinned connection');
  // and the auth and users repositories are built on that plain db object
  const server = read('../src/server.js');
  assert.match(server, /createAuthRepository\(db\)/);
  assert.match(server, /createUserRepository\(db\)/);
});
test('createSession source: re-check is BINARY, checks is_active, runs AFTER the insert, and uses no locking clause', () => {
  const src = read('../src/modules/auth/auth.repository.js');
  const body = src.slice(src.indexOf('async createSession'), src.indexOf('async findActiveSessionUser'));
  assert.match(body, /BINARY password_hash = \?/);
  assert.match(body, /is_active = 1/);
  assert.ok(body.indexOf('INSERT INTO sessions') < body.indexOf('SELECT 1 AS ok'), 'insert first, re-check second');
  assert.ok(!/FOR (SHARE|UPDATE)|LOCK IN SHARE MODE/i.test(body), 'correctness must not depend on locking clauses');
});
test('login source: only the strict "=== false" refusal, generic error, and the token is returned only after createSession', () => {
  const src = read('../src/modules/auth/auth.service.js');
  assert.match(src, /if \(created === false\) throw invalid\(\);/);
  assert.ok(src.indexOf('createSession') < src.indexOf('return { token'), 'token is returned only after the session check');
  assert.equal((src.match(/INVALID_CREDENTIALS/g) || []).length, 1, 'one generic error shape');
});
