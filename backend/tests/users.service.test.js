import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserService } from '../src/modules/users/users.service.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { hashToken } from '../src/lib/session-token.js';
import { HttpError } from '../src/lib/http-error.js';

const OLD = 'old-password-123';
const NEW = 'brand-new-pass-456';
const TOKEN = 'raw-session-token-current';
const OTHER_TOKENS = ['raw-other-1', 'raw-other-2'];
const me = { id: 7, employeeId: 'E7', name: 'Anu', role: 'bde' };
const tick = () => new Promise((r) => setImmediate(r));

let oldHash;
test.before(async () => { oldHash = await hashPassword(OLD); });

const newState = (tokens = [TOKEN, ...OTHER_TOKENS]) => ({
  hash: oldHash,
  profile: { id: 7, employee_id: 'E7', name: 'Anu', role: 'bde', phone: '9876543210', email: 'anu@example.com', created_at: '2026-01-01 00:00:00', password_hash: 'MUST-NOT-LEAK' },
  sessions: new Set(tokens.map(hashToken)),
  otherUserSessions: new Set([hashToken('someone-else')])
});
// Errors shaped like mysql2's: a server-side refusal carries an SQLSTATE; a lost connection is fatal and has none.
const serverRejection = () => Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213, sqlState: '40001', fatal: false });
const lostConnection = () => Object.assign(new Error('connection lost'), { code: 'PROTOCOL_CONNECTION_LOST', fatal: true });

// In-memory repository with failure injection. Sessions are keyed by token hash, like the real table.
// opts.update: 'reject' | 'lost-before' | 'lost-after' | 'zero' | 'null' | 'fatal-with-sqlstate' | 'no-sqlstate'
function fakeRepo(opts = {}) {
  const calls = [];
  const state = opts.state || newState();
  let deletes = 0;
  const repo = {
    async findProfileById(id) { calls.push(['findProfileById', id]); if (opts.findProfileThrows) throw new Error('db'); return id === state.profile.id && !opts.noProfile ? state.profile : null; },
    async findPasswordHashById(id) { calls.push(['findPasswordHashById', id]); if (opts.hashThrows) throw new Error('db'); return opts.noHash ? null : state.hash; },
    async updateContact(id, v) { calls.push(['updateContact', id, v]); if (opts.contactNull) return null; state.profile = { ...state.profile, ...v }; return 1; },
    // Compare-and-set, like the real SQL: only replaces the hash that was passed as "expected".
    async updatePasswordHash(id, h, expected) {
      calls.push(['updatePasswordHash', id, h, expected]);
      if (opts.beforeUpdate) await opts.beforeUpdate();
      switch (opts.update) {
        case 'reject': throw serverRejection();
        case 'lost-before': throw lostConnection();
        case 'lost-after': state.hash = h; state.sessions.add(hashToken('late-login')); throw lostConnection(); // committed, answer lost
        case 'zero': return 0;
        case 'null': return null;
        case 'fatal-with-sqlstate': throw Object.assign(serverRejection(), { fatal: true });
        case 'no-sqlstate': throw Object.assign(new Error('x'), { code: 'ER_LOCK_DEADLOCK' });
        default: if (state.hash !== expected) return 0; state.hash = h; return 1;
      }
    },
    async deleteOtherSessions(id, keep) {
      deletes += 1; calls.push(['deleteOtherSessions', id, keep]);
      const mode = deletes === 1 ? opts.del1 : opts.del2;
      if (mode === 'throw') throw Object.assign(new Error('connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
      if (mode === 'null') return null;
      let n = 0; for (const h of [...state.sessions]) if (h !== keep) { state.sessions.delete(h); n++; } return n;
    }
  };
  return { repo, calls, state };
}
const names = (calls) => calls.map((c) => c[0]);
async function rejection(promise) { try { await promise; } catch (e) { return e; } assert.fail('expected a rejection'); }
const silenced = async (fn) => { const orig = console.error; const logged = []; console.error = (...a) => logged.push(a.join(' ')); try { return { result: await fn(), logged }; } finally { console.error = orig; } };
const change = (svc, token = TOKEN, body = { currentPassword: OLD, newPassword: NEW }) => svc.changePassword(me, token, body);

// ---- getProfile ----
test('getProfile: returns exactly the public profile; no hash or token fields', async () => {
  const { repo, calls } = fakeRepo();
  const p = await createUserService({ repo }).getProfile(me);
  assert.deepEqual(Object.keys(p).sort(), ['createdAt', 'email', 'employeeId', 'id', 'name', 'phone', 'role']);
  assert.ok(!JSON.stringify(p).includes('MUST-NOT-LEAK'));
  assert.deepEqual(calls, [['findProfileById', 7]]);
});
test('getProfile: ownership - always the session user id; a missing row is 404', async () => {
  const { repo, calls } = fakeRepo({ noProfile: true });
  const e = await rejection(createUserService({ repo }).getProfile({ ...me, id: 99 }));
  assert.equal(e.status, 404);
  assert.deepEqual(calls, [['findProfileById', 99]]);
});
test('getProfile: users without contact details get nulls', async () => {
  const { repo, state } = fakeRepo(); state.profile.phone = undefined; state.profile.email = null;
  const p = await createUserService({ repo }).getProfile(me);
  assert.equal(p.phone, null); assert.equal(p.email, null);
});

// ---- updateProfile ----
test('updateProfile: updates only provided fields, keeps the other, returns the fresh profile', async () => {
  const { repo, calls } = fakeRepo();
  const p = await createUserService({ repo }).updateProfile(me, { phone: '+91 90000 11111' });
  assert.equal(p.phone, '+91 90000 11111'); assert.equal(p.email, 'anu@example.com');
  assert.deepEqual(calls.find((c) => c[0] === 'updateContact'), ['updateContact', 7, { phone: '+91 90000 11111', email: 'anu@example.com' }]);
});
test('updateProfile: null clears a field', async () => {
  const { repo } = fakeRepo();
  const p = await createUserService({ repo }).updateProfile(me, { email: null });
  assert.equal(p.email, null); assert.equal(p.phone, '9876543210');
});
test('updateProfile: invalid values and unexpected fields -> 400 and nothing is written', async () => {
  for (const body of [{ phone: 'abc' }, { email: 'nope' }, { name: 'Hacker', phone: '9876543210' }, { role: 'admin', email: 'a@b.co' }, { id: 1, phone: '9876543210' }, {}, null]) {
    const { repo, calls } = fakeRepo();
    const e = await rejection(createUserService({ repo }).updateProfile(me, body));
    assert.ok(e instanceof HttpError && e.status === 400 && e.code === 'VALIDATION_ERROR', JSON.stringify(body));
    assert.equal(calls.length, 0, 'no repository call at all: ' + JSON.stringify(body));
  }
});
test('updateProfile: the user id comes only from the session', async () => {
  const { repo, calls } = fakeRepo();
  await createUserService({ repo }).updateProfile(me, { phone: '9876543210' });
  assert.ok(calls.every((c) => c[1] === 7));
});
test('updateProfile: unexpected driver result -> 500, a database error propagates as a plain error', async () => {
  const e1 = await rejection(createUserService({ repo: fakeRepo({ contactNull: true }).repo }).updateProfile(me, { phone: '9876543210' }));
  assert.equal(e1.status, 500);
  const e2 = await rejection(createUserService({ repo: fakeRepo({ findProfileThrows: true }).repo }).updateProfile(me, { phone: '9876543210' }));
  assert.ok(!(e2 instanceof HttpError));
});

// ---- changePassword: rejections that must not touch anything ----
test('changePassword: invalid input (same password, too short, unexpected field) never reaches the repository', async () => {
  for (const body of [{ currentPassword: OLD, newPassword: OLD }, { currentPassword: OLD, newPassword: 'short' }, { currentPassword: OLD, newPassword: NEW, role: 'admin' }, null]) {
    const { repo, calls } = fakeRepo();
    const e = await rejection(change(createUserService({ repo }), TOKEN, body));
    assert.equal(e.status, 400); assert.equal(calls.length, 0);
  }
});
test('changePassword: wrong current password -> 400 on that field, nothing deleted or updated', async () => {
  const { repo, calls, state } = fakeRepo();
  const e = await rejection(change(createUserService({ repo }), TOKEN, { currentPassword: 'not-the-password', newPassword: NEW }));
  assert.equal(e.status, 400); assert.ok(e.fields.currentPassword);
  assert.deepEqual(names(calls), ['findPasswordHashById']);
  assert.equal(state.hash, oldHash); assert.equal(state.sessions.size, 3);
});
test('changePassword: no session token -> 401 and no repository call (would otherwise sign the caller out too)', async () => {
  for (const token of [undefined, '', null, 5]) {
    const { repo, calls } = fakeRepo();
    // called directly: the change() helper would replace an undefined token with the default one
    const e = await rejection(createUserService({ repo }).changePassword(me, token, { currentPassword: OLD, newPassword: NEW }));
    assert.equal(e.status, 401); assert.equal(calls.length, 0);
  }
});
test('changePassword: user without a stored hash -> 401', async () => {
  const e = await rejection(change(createUserService({ repo: fakeRepo({ noHash: true }).repo })));
  assert.equal(e.status, 401);
});

// ---- changePassword: success ----
test('changePassword: success - new password verifies, old does not, only the current session survives', async () => {
  const { repo, calls, state } = fakeRepo();
  const r = await change(createUserService({ repo }));
  assert.deepEqual(r, { changed: true });
  assert.deepEqual(names(calls), ['findPasswordHashById', 'deleteOtherSessions', 'updatePasswordHash', 'deleteOtherSessions']);
  assert.equal(await verifyPassword(NEW, state.hash), true);
  assert.equal(await verifyPassword(OLD, state.hash), false);
  assert.ok(state.hash.startsWith('scrypt$'), 'stored in the existing scrypt format, never plain text');
  assert.deepEqual([...state.sessions], [hashToken(TOKEN)]);
  assert.ok(state.otherUserSessions.has(hashToken('someone-else')), "another user's sessions are untouched");
});
test('changePassword: session deletion uses the authenticated user id and the HASH of the caller token', async () => {
  const { repo, calls } = fakeRepo();
  await change(createUserService({ repo }));
  for (const c of calls.filter((x) => x[0] === 'deleteOtherSessions')) {
    assert.equal(c[1], 7); assert.equal(c[2], hashToken(TOKEN)); assert.notEqual(c[2], TOKEN);
  }
  assert.equal(calls.find((c) => c[0] === 'updatePasswordHash')[1], 7);
});
test('changePassword: the update is a compare-and-set on the hash that was just verified', async () => {
  const { repo, calls } = fakeRepo();
  await change(createUserService({ repo }));
  const update = calls.find((c) => c[0] === 'updatePasswordHash');
  assert.equal(update[3], oldHash, 'the verified current hash is passed as the condition');
  assert.notEqual(update[2], oldHash); assert.ok(update[2].startsWith('scrypt$'));
});
test('changePassword: zero other sessions is a normal success', async () => {
  const { repo } = fakeRepo({ state: newState([TOKEN]) });
  assert.deepEqual(await change(createUserService({ repo })), { changed: true });
});

// ---- changePassword: failures before the update ----
test('FAILURE first session cleanup throws -> 500 SESSION_INVALIDATION_FAILED, password NOT changed, update never attempted', async () => {
  const { repo, calls, state } = fakeRepo({ del1: 'throw' });
  const { result: e } = await silenced(() => rejection(change(createUserService({ repo }))));
  assert.equal(e.status, 500); assert.equal(e.code, 'SESSION_INVALIDATION_FAILED'); assert.match(e.message, /NOT changed/);
  assert.ok(!names(calls).includes('updatePasswordHash'));
  assert.equal(state.hash, oldHash);
});
test('FAILURE first session cleanup returns an unexpected result -> treated as failure', async () => {
  const { repo, calls, state } = fakeRepo({ del1: 'null' });
  const e = await rejection(change(createUserService({ repo })));
  assert.equal(e.code, 'SESSION_INVALIDATION_FAILED'); assert.ok(!names(calls).includes('updatePasswordHash')); assert.equal(state.hash, oldHash);
});

// ---- R2: the update is REJECTED by the server vs. its outcome is UNKNOWN ----
test('R2 update REJECTED by the server (SQLSTATE, connection usable) -> 500 PASSWORD_UPDATE_FAILED, hash unchanged, no further cleanup', async () => {
  const { repo, calls, state } = fakeRepo({ update: 'reject' });
  const { result: e } = await silenced(() => rejection(change(createUserService({ repo }))));
  assert.equal(e.status, 500); assert.equal(e.code, 'PASSWORD_UPDATE_FAILED'); assert.match(e.message, /not changed/);
  assert.equal(state.hash, oldHash);
  assert.deepEqual(names(calls), ['findPasswordHashById', 'deleteOtherSessions', 'updatePasswordHash'], 'a refused update needs no second cleanup');
});
test('R2 AMBIGUOUS post-commit failure (MySQL committed, the answer was lost) -> UNCONFIRMED, never "not changed", late session cleaned up', async () => {
  const { repo, calls, state } = fakeRepo({ update: 'lost-after' });
  const { result: e } = await silenced(() => rejection(change(createUserService({ repo }))));
  assert.equal(e.status, 500); assert.equal(e.code, 'PASSWORD_UPDATE_UNCONFIRMED');
  assert.match(e.message, /could not confirm/);
  assert.ok(!/not changed|NOT changed|unchanged/i.test(e.message), 'must not claim the password stayed the same');
  assert.match(e.message, /NEW password first/);
  assert.equal(await verifyPassword(NEW, state.hash), true, 'in this scenario the password really was changed');
  assert.deepEqual(names(calls), ['findPasswordHashById', 'deleteOtherSessions', 'updatePasswordHash', 'deleteOtherSessions'], 'best-effort cleanup was attempted');
  assert.equal(state.sessions.has(hashToken('late-login')), false, 'the session created in the window was removed');
});
test('R2 AMBIGUOUS failure where the update never reached MySQL -> same UNCONFIRMED answer, cleanup is harmless', async () => {
  const { repo, calls, state } = fakeRepo({ update: 'lost-before' });
  const { result: e } = await silenced(() => rejection(change(createUserService({ repo }))));
  assert.equal(e.code, 'PASSWORD_UPDATE_UNCONFIRMED');
  assert.equal(state.hash, oldHash);
  assert.equal(names(calls).at(-1), 'deleteOtherSessions');
});
test('R2 AMBIGUOUS failure and the best-effort cleanup also fails -> still UNCONFIRMED (cleanup failure is not masked as success or changes the error)', async () => {
  const { repo, state } = fakeRepo({ update: 'lost-after', del2: 'throw' });
  const { result: e } = await silenced(() => rejection(change(createUserService({ repo }))));
  assert.equal(e.code, 'PASSWORD_UPDATE_UNCONFIRMED');
  assert.equal(state.sessions.has(hashToken('late-login')), true, 'stale session survives because cleanup failed: the message tells the user how to recover');
});
test('R2 unexpected driver result from the update (not a number) -> UNCONFIRMED, not success and not "failed"', async () => {
  const { repo, calls } = fakeRepo({ update: 'null' });
  const e = await rejection(change(createUserService({ repo })));
  assert.equal(e.code, 'PASSWORD_UPDATE_UNCONFIRMED');
  assert.equal(names(calls).at(-1), 'deleteOtherSessions');
});
test('R2 classification is conservative: a fatal error, or an error without an SQLSTATE, is treated as UNKNOWN', async () => {
  for (const update of ['fatal-with-sqlstate', 'no-sqlstate', 'lost-before']) {
    const e = await rejection(change(createUserService({ repo: fakeRepo({ update }).repo })));
    assert.equal(e.code, 'PASSWORD_UPDATE_UNCONFIRMED', update);
  }
});

// ---- R3: compare-and-set, concurrent changes ----
test('R3 zero rows matched (the hash changed after it was verified) -> 409, this request changed nothing, no further cleanup', async () => {
  const { repo, calls, state } = fakeRepo({ update: 'zero' });
  const e = await rejection(change(createUserService({ repo })));
  assert.equal(e.status, 409); assert.equal(e.code, 'PASSWORD_CHANGED_CONCURRENTLY'); assert.match(e.message, /did not change it/);
  assert.equal(state.hash, oldHash);
  assert.deepEqual(names(calls), ['findPasswordHashById', 'deleteOtherSessions', 'updatePasswordHash']);
});
test('R3 stale verified hash against the real compare-and-set: another request changed the password in between -> 409, nothing overwritten', async () => {
  const { repo, state } = fakeRepo();
  const realFind = repo.findPasswordHashById;
  repo.findPasswordHashById = async (id) => { const h = await realFind(id); state.hash = await hashPassword('someone-elses-new-pass'); return h; }; // hash replaced after it was read
  const e = await rejection(change(createUserService({ repo })));
  assert.equal(e.code, 'PASSWORD_CHANGED_CONCURRENTLY');
  assert.equal(await verifyPassword('someone-elses-new-pass', state.hash), true, 'the other change was NOT overwritten');
});
async function runConcurrent(winner) {
  const st = newState(['devA', 'devB']);
  let arrived = 0; let open; const barrier = new Promise((r) => { open = r; });
  const hook = (delay) => async () => { arrived += 1; if (arrived === 2) open(); await barrier; for (let i = 0; i < delay; i++) await tick(); };
  const a = createUserService({ repo: fakeRepo({ state: st, beforeUpdate: hook(winner === 'A' ? 0 : 8) }).repo });
  const b = createUserService({ repo: fakeRepo({ state: st, beforeUpdate: hook(winner === 'B' ? 0 : 8) }).repo });
  const results = await Promise.allSettled([
    a.changePassword(me, 'devA', { currentPassword: OLD, newPassword: 'password-from-A-111' }),
    b.changePassword(me, 'devB', { currentPassword: OLD, newPassword: 'password-from-B-222' })
  ]);
  return { st, results };
}
for (const winner of ['A', 'B']) {
  test(`R3 two simultaneous changes (both verified the same old password, ${winner} updates first): exactly one succeeds, the other gets 409, only the winner's password is valid`, async () => {
    const { st, results } = await silenced(() => runConcurrent(winner)).then((r) => r.result);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.equal(bad.length, 1);
    assert.equal(bad[0].reason.code, 'PASSWORD_CHANGED_CONCURRENTLY');
    const winnerPw = `password-from-${winner}-${winner === 'A' ? '111' : '222'}`;
    const loserPw = `password-from-${winner === 'A' ? 'B' : 'A'}-${winner === 'A' ? '222' : '111'}`;
    assert.equal(await verifyPassword(winnerPw, st.hash), true, 'the winner password is the effective one');
    assert.equal(await verifyPassword(loserPw, st.hash), false, 'the losing request did not overwrite it');
    assert.equal(await verifyPassword(OLD, st.hash), false);
  });
}

// ---- failure after a CONFIRMED update ----
test('FAILURE final session cleanup fails -> NOT reported as complete success; message says the password WAS changed', async () => {
  const { repo, state } = fakeRepo({ del2: 'throw' });
  const { result: e } = await silenced(() => rejection(change(createUserService({ repo }))));
  assert.equal(e.status, 500); assert.equal(e.code, 'SESSIONS_NOT_FULLY_CLOSED'); assert.match(e.message, /WAS changed/);
  assert.equal(await verifyPassword(NEW, state.hash), true, 'the password really is the new one in this case');
});
test('FAILURE final cleanup returns an unexpected result -> same incomplete-success error', async () => {
  const e = await rejection(change(createUserService({ repo: fakeRepo({ del2: 'null' }).repo })));
  assert.equal(e.code, 'SESSIONS_NOT_FULLY_CLOSED');
});
test('FAILURE reading the stored hash: a database error propagates as a plain error (-> generic 500)', async () => {
  const e = await rejection(change(createUserService({ repo: fakeRepo({ hashThrows: true }).repo })));
  assert.ok(!(e instanceof HttpError));
});

// ---- R4: honest messages, no leakage ----
test('R4 no message refers to an admin clearing sessions (that feature does not exist yet) or promises every session is closed', async () => {
  const scenarios = [{ del1: 'throw' }, { update: 'reject' }, { update: 'lost-after' }, { update: 'zero' }, { del2: 'throw' }];
  for (const opts of scenarios) {
    const { result: e } = await silenced(() => rejection(change(createUserService({ repo: fakeRepo(opts).repo }))));
    assert.ok(!/admin/i.test(e.message), JSON.stringify(opts) + ': ' + e.message);
    assert.ok(!/\b(all|every)\b.*sessions? (were|was|have been) signed out/i.test(e.message), e.message);
  }
});
test('R4 every non-success code carries a message that matches what is actually known', async () => {
  const expect = [
    [{ del1: 'throw' }, 'SESSION_INVALIDATION_FAILED', /NOT changed/],
    [{ update: 'reject' }, 'PASSWORD_UPDATE_FAILED', /not changed/],
    [{ update: 'zero' }, 'PASSWORD_CHANGED_CONCURRENTLY', /did not change it/],
    [{ update: 'lost-after' }, 'PASSWORD_UPDATE_UNCONFIRMED', /could not confirm/],
    [{ del2: 'throw' }, 'SESSIONS_NOT_FULLY_CLOSED', /WAS changed/]
  ];
  for (const [opts, code, re] of expect) {
    const { result: e } = await silenced(() => rejection(change(createUserService({ repo: fakeRepo(opts).repo }))));
    assert.equal(e.code, code); assert.match(e.message, re, code);
  }
});
test('failure logs never contain passwords, the raw token, hashes or the driver message, and have a fixed format', async () => {
  const secrets = [OLD, NEW, TOKEN, oldHash, hashToken(TOKEN)];
  const cases = [{ del1: 'throw' }, { update: 'reject' }, { update: 'lost-after' }, { update: 'lost-after', del2: 'throw' }, { del2: 'throw' }];
  for (const opts of cases) {
    const { result, logged } = await silenced(async () => rejection(change(createUserService({ repo: fakeRepo(opts).repo }))));
    const text = logged.join('\n') + JSON.stringify({ message: result.message, code: result.code, fields: result.fields });
    for (const s of secrets) assert.ok(!text.includes(s), 'leaked a secret in ' + JSON.stringify(opts));
    assert.ok(!/connection lost|deadlock/.test(logged.join('\n')), 'driver message not logged');
    assert.ok(logged.length >= 1);
    for (const line of logged) assert.match(line, /^change-password: [a-z ]+ failed \([A-Za-z_]+\)$/, line);
  }
});
