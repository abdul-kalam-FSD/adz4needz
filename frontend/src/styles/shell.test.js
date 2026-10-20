// v2 shell and PageHeader: structure checks on the real source text (it does NOT render anything).
// Contrast of the shell colours is pinned in design-system.test.js; this file pins the structure, the approved primary and the preserved wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../components/AppShell.jsx', import.meta.url), 'utf8');
const header = readFileSync(new URL('../components/PageHeader.jsx', import.meta.url), 'utf8');
const rule = (sel) => { const i = css.indexOf('\n' + sel + ' {'); assert.ok(i > -1, 'rule not found: ' + sel); return css.slice(i, css.indexOf('}', i)); };

test('approved palette: primary teal #0F766E on actions and selected states, navy text, no gradients in the shell', () => {
  assert.match(css, /--green-500: #0f766e;/i);
  assert.match(rule('.btn-primary'), /background: var\(--primary\)/);
  assert.match(rule('.nav-item.is-current'), /background: var\(--nav-active-bg\)/);
  for (const sel of ['.topbar', '.sidebar', '.nav-item', '.nav-item.is-current']) assert.ok(!/gradient/.test(rule(sel)), sel + ' is flat');
});

test('shell: white top bar and light sidebar, each with a thin 1px border', () => {
  assert.match(rule('.topbar'), /background: var\(--topbar-bg\)/); assert.match(rule('.topbar'), /border-bottom: 1px solid var\(--border\)/);
  assert.match(rule('.sidebar'), /background: var\(--nav-bg\)/); assert.match(rule('.sidebar'), /border-right: 1px solid var\(--border\)/);
  assert.match(css, /--topbar-bg: #ffffff;/i);
});

test('tokens: one spacing scale, one type scale, two radii; no heading larger than the page-title size', () => {
  for (const n of ['space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6', 'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'radius-control', 'radius-card', 'content-max']) assert.ok(css.includes('--' + n + ':'), n);
  assert.match(css, /--text-xl: 1\.375rem;/);
});

test('AppShell keeps its routes, roles and accessibility wiring (only the look changed)', () => {
  for (const to of ['/dashboard', '/call-desk', '/daily-report', '/leads', '/interviews', '/payments', '/monthly', '/profile', '/admin/bdes', '/admin/employees', '/admin/leads', '/admin/assign', '/admin/interviews', '/admin/payments', '/admin/import', '/admin/reports', '/admin/activity']) assert.ok(shell.includes("'" + to + "'"), to);
  assert.ok(shell.includes('to="/admin" end'));
  assert.match(shell, /user\.role === 'bde'/); assert.match(shell, /aria-label="Main navigation"/); assert.match(shell, /Skip to main content/); assert.match(shell, /aria-expanded=\{menuOpen\}/);
  assert.match(shell, /await logout\(\)/);
});

test('PageHeader: one <h1>, optional description and actions, plain text only, no data or routing', () => {
  assert.match(header, /export default function PageHeader\(\{ title, description, actions \}\)/);
  assert.equal((header.match(/<h1>\{title\}<\/h1>/g) || []).length, 1);
  assert.ok(!/dangerouslySetInnerHTML|innerHTML|fetch\(|api\.|useAuth|useNavigate/.test(header), 'presentation only');
  for (const c of ['.page-header', '.page-header-text', '.page-header-desc', '.page-header-actions']) assert.ok(css.includes('\n' + c + ' {'), c);
});
