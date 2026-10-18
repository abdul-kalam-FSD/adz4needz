// Employee Sign In / Admin Sign In / Create BDE Account: the pure rules behind the sign-in screen and the request the API client sends.
// (Logic and text-level checks only. The React page itself has not been rendered or clicked in these tests.)
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CREATE_BDE_PATH, loginDestination, loginFailure, loginViewSearch, parseLoginView, safeDestination } from './validate-login.js';
import { api } from '../api/client.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const capture = () => { const seen = []; globalThis.fetch = async (url, init) => { seen.push({ url, init, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ user: { id: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }; return seen; };

test('Employee Sign In sends exactly the request it always has (no portal field at all)', async () => {
  const seen = capture();
  await api.login('EMP001', 'secret-pass-1');
  await api.login('EMP001', 'secret-pass-1', undefined);
  for (const c of seen) { assert.equal(c.url, '/api/auth/login'); assert.equal(c.init.method, 'POST'); assert.deepEqual(c.body, { employeeId: 'EMP001', password: 'secret-pass-1' }); assert.ok(!('portal' in c.body)); }
});
test('Admin Sign In sends portal "admin", and nothing else new (never a role)', async () => {
  const seen = capture();
  await api.login('ADM-1', 'secret-pass-1', 'admin');
  assert.deepEqual(seen[0].body, { employeeId: 'ADM-1', password: 'secret-pass-1', portal: 'admin' });
  assert.ok(!('role' in seen[0].body));
});

test('parseLoginView: Employee Sign In is the default; only exactly as=admin selects the admin tab; the create path needs the admin tab', () => {
  assert.deepEqual(parseLoginView(''), { portal: 'employee', createBde: false });
  assert.deepEqual(parseLoginView(undefined), { portal: 'employee', createBde: false });
  assert.deepEqual(parseLoginView('as=admin'), { portal: 'admin', createBde: false });
  assert.deepEqual(parseLoginView('?as=admin&task=create-bde'), { portal: 'admin', createBde: true });
  for (const junk of ['as=ADMIN', 'as=root', 'as=', 'task=create-bde', 'as=employee&task=create-bde', 'as=admin&task=create-admin', 'as=admin&task=']) {
    const v = parseLoginView(junk);
    assert.equal(v.createBde, false, junk);
    if (!junk.startsWith('as=admin')) assert.equal(v.portal, 'employee', junk);
  }
});
test('loginViewSearch round-trips with parseLoginView', () => {
  for (const view of [{ portal: 'employee', createBde: false }, { portal: 'admin', createBde: false }, { portal: 'admin', createBde: true }]) assert.deepEqual(parseLoginView(loginViewSearch(view)), view);
  assert.equal(loginViewSearch({ portal: 'employee', createBde: true }), '', 'the create path is never offered on the employee tab');
  assert.equal(loginViewSearch(), '');
});

test('loginDestination: the create path goes to the BDE account form; otherwise the existing safe-redirect rules apply unchanged', () => {
  assert.equal(CREATE_BDE_PATH, '/admin/employees');
  assert.equal(loginDestination({ createBde: true, notice: null, from: '/leads' }), '/admin/employees');
  assert.equal(loginDestination({ createBde: false, notice: null, from: '/leads' }), '/leads');
  assert.equal(loginDestination({ createBde: false, notice: 'signed_out', from: '/leads' }), '/');
  for (const evil of ['//evil.example', 'https://evil.example', '/login', '\\evil', null, undefined, '']) assert.equal(loginDestination({ createBde: false, notice: null, from: evil }), '/', String(evil));
  assert.equal(safeDestination('/admin/employees'), '/admin/employees');
});

test('loginFailure on the admin tab explains the 401 without saying which part was wrong; the employee wording is unchanged', () => {
  const admin = loginFailure({ status: 401 }, 'admin');
  assert.equal(admin.kind, 'credentials'); assert.match(admin.message, /not an administrator/);
  assert.equal(loginFailure({ status: 401 }).message, 'Employee ID or password is incorrect. Check them and try again.');
  assert.equal(loginFailure({ status: 401 }, 'employee').message, 'Employee ID or password is incorrect. Check them and try again.');
  for (const status of [0, 429, 500]) assert.equal(loginFailure({ status }, 'admin').kind, loginFailure({ status }).kind, 'other failures read the same on both tabs');
});

test('wiring (text): no public registration anywhere in the app; the create path ends at an admin-only route', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const paths = [...app.matchAll(/path="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(paths.filter((p) => /register|signup|sign-up|onboard|setup|bootstrap/i.test(p)), []);
  assert.match(app, /path="admin\/employees" element=\{<RequireRole role="admin"><AdminEmployeesPage \/><\/RequireRole>\}/);
  const client = readFileSync(new URL('../api/client.js', import.meta.url), 'utf8');
  assert.ok(!/register|signup|bootstrap|setup/i.test(client.replace(/\/\/[^\n]*/g, '')), 'the API client has no public register, signup or setup call');
  assert.match(client, /adminCreateEmployee: \(payload\) => request\('POST', '\/admin\/employees', payload\)/);
});
test('wiring (text): the sign-in page has two real tabs, sends the portal only for admin, and keeps its labels, ids and loading text', () => {
  const page = readFileSync(new URL('../pages/LoginPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /role="tablist"/); assert.match(page, /role="tab"/); assert.match(page, /role="tabpanel"/); assert.match(page, /aria-selected=\{portal === t\.portal\}/);
  assert.match(page, /Employee Sign In/); assert.match(page, /Admin Sign In/); assert.match(page, /Create BDE Account/);
  assert.match(page, /login\(check\.value\.employeeId, password, portal === 'admin' \? 'admin' : undefined\)/);
  assert.match(page, /id="employeeId"/); assert.match(page, /id="password"/); assert.match(page, /Signing in…/); assert.match(page, /validateLogin\(\{ employeeId, password \}\)/);
  assert.ok(!/fetch\(|api\.adminCreateEmployee/.test(page), 'the sign-in page never creates accounts itself');
});
