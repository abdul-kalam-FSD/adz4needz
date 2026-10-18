import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootstrapFirstAdmin, BootstrapError } from '../src/lib/bootstrap-admin.js';

// A tiny stand-in that understands exactly the two statements the bootstrap uses. It is NOT MySQL: it checks the decision logic only.
function fakeDb({ admins = 0, takenIds = [] } = {}) {
  const state = { admins, inserted: [], selects: 0 };
  return {
    state,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s === "SELECT 1 AS ok FROM users WHERE role = 'admin' LIMIT 1") { state.selects++; return state.admins > 0 ? [{ ok: 1 }] : []; }
      if (s.startsWith('INSERT INTO users') && s.includes("'admin'") && s.includes("WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')")) {
        if (takenIds.map((x) => x.toLowerCase()).includes(String(params[0]).toLowerCase())) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
        if (state.admins > 0) return { affectedRows: 0, insertId: 0 };
        state.admins++; state.inserted.push(params); return { affectedRows: 1, insertId: 9 };
      }
      throw new Error('unexpected SQL: ' + s);
    }
  };
}
const good = { employeeId: 'ADM-1', name: ' First Admin ', password: 'a-long-password-1' };
const hash = async (p) => 'HASH(' + p.length + ')';

test('creates the first admin while none exists; stores only the hash; returns no secret', async () => {
  const db = fakeDb();
  const r = await bootstrapFirstAdmin({ db, ...good, hash });
  assert.deepEqual(r, { id: 9, employeeId: 'ADM-1', name: 'First Admin', role: 'admin' });
  assert.deepEqual(db.state.inserted[0], ['ADM-1', 'First Admin', 'HASH(17)']);
  assert.ok(!JSON.stringify(r).includes('a-long-password') && !JSON.stringify(r).includes('HASH'));
});

test('refuses when an admin already exists (early check) and writes nothing', async () => {
  const db = fakeDb({ admins: 1 });
  await assert.rejects(bootstrapFirstAdmin({ db, ...good, hash }), (e) => e instanceof BootstrapError && e.code === 'ADMIN_EXISTS');
  assert.equal(db.state.inserted.length, 0);
});

test('refuses when an admin appears between the early check and the insert (the insert itself re-checks)', async () => {
  const db = fakeDb();
  const real = db.query.bind(db);
  db.query = async (sql, params) => { const out = await real(sql, params); if (sql.startsWith('SELECT 1 AS ok')) db.state.admins = 1; return out; }; // a rival admin is created right after the early check
  await assert.rejects(bootstrapFirstAdmin({ db, ...good, hash }), (e) => e.code === 'ADMIN_EXISTS');
  assert.equal(db.state.inserted.length, 0);
});

test('an employee ID already used by a non-admin is a clear error, not a silent takeover', async () => {
  const db = fakeDb({ takenIds: ['adm-1'] });
  await assert.rejects(bootstrapFirstAdmin({ db, ...good, hash }), (e) => e.code === 'EMPLOYEE_ID_EXISTS' && Boolean(e.fields.employeeId));
});

test('invalid details are refused before any database access (same rules as every other account)', async () => {
  for (const bad of [{ employeeId: 'has space' }, { employeeId: '' }, { name: '' }, { password: 'short' }, { password: ' '.repeat(12) }, { employeeId: 'ADMIN-12345', password: 'admin-12345' }]) {
    const db = fakeDb();
    await assert.rejects(bootstrapFirstAdmin({ db, ...good, ...bad, hash }), (e) => e instanceof BootstrapError && e.code === 'INVALID_INPUT');
    assert.equal(db.state.selects, 0); assert.equal(db.state.inserted.length, 0);
  }
});

test('no password or hash appears in any error message', async () => {
  for (const [db, over] of [[fakeDb({ admins: 1 }), {}], [fakeDb({ takenIds: ['ADM-1'] }), {}], [fakeDb(), { password: 'short' }]]) {
    try { await bootstrapFirstAdmin({ db, ...good, ...over, hash }); assert.fail('expected a rejection'); }
    catch (e) { assert.ok(!JSON.stringify([e.message, e.fields]).match(/a-long-password|short|HASH/)); }
  }
});

test('wiring (text): the bootstrap is a server-side script only; no HTTP route, no setup endpoint', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const routes = [...app.matchAll(/\b(?:api|app|\w+Router)\.(?:get|post|put|patch|delete|use|all)\(\s*'([^']*)'/g)].map((m) => m[1]);
  assert.ok(routes.length > 20, 'the route scan found the routes (' + routes.length + ')');
  assert.deepEqual(routes.filter((r) => /bootstrap|setup|register|signup|sign-up|onboard/i.test(r)), [], 'no bootstrap, setup, register or signup route');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['bootstrap-admin'], /scripts\/bootstrap-admin\.js$/);
  const script = readFileSync(new URL('../scripts/bootstrap-admin.js', import.meta.url), 'utf8');
  assert.ok(!/process\.env\.[A-Z_]*PASSWORD|--password/i.test(script.replace(/DB_PASSWORD/g, '')), 'the password is only ever typed at the hidden prompt');
  const lib = readFileSync(new URL('../src/lib/bootstrap-admin.js', import.meta.url), 'utf8');
  assert.match(lib, /WHERE NOT EXISTS \(SELECT 1 FROM users WHERE role = 'admin'\)/);
});
