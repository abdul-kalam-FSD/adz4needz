// Stylesheet checks for the Employee / Admin tab switch and the link-style buttons on the sign-in screen (computed from the real CSS).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const start = css.indexOf('.login-page {');
const block = css.slice(start, start + css.slice(start).indexOf('}') + 1);
const vars = Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const v = (n) => { assert.ok(vars[n], 'missing token --' + n); return vars[n]; };
const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const atLeast = (fg, bg, min, label) => { const r = ratio(v(fg), v(bg)); assert.ok(r >= min, `${label}: --${fg} on --${bg} is ${r.toFixed(2)}:1, needs ${min}:1`); };

test('tab text meets WCAG AA (4.5:1) in every state: idle on the track, hovered, and selected on the white pill', () => {
  atLeast('login-ink-muted', 'login-tab-track', 4.5, 'idle tab');
  atLeast('login-ink-muted', 'login-tab-hover', 4.5, 'hovered tab');
  atLeast('login-ink', 'login-tab-hover', 4.5, 'hovered tab (darker text)');
  atLeast('login-ink', 'login-panel', 7, 'selected tab');
});
test('the selected tab is told apart by more than colour (a border ring and a shadow), at 3:1 against the track', () => {
  assert.match(css, /\.login-tab\[aria-selected="true"\] \{[^}]*box-shadow:[^}]*0 0 0 1px var\(--login-field-border\)/);
  assert.ok(ratio(v('login-field-border'), v('login-tab-track')) >= 3, 'ring vs track');
});
test('link-style buttons use the accessible link colour (4.5:1 on white) and are underlined', () => {
  atLeast('login-link', 'login-panel', 4.5, 'link');
  assert.match(css, /\.login-link \{[^}]*text-decoration: underline/);
});
test('keyboard focus is visible on tabs and links; tabs are at least 44px tall', () => {
  assert.match(css, /\.login-tab:focus-visible \{ outline: 3px solid var\(--login-focus\)/);
  assert.match(css, /\.login-link:focus-visible \{ outline: 3px solid var\(--login-focus\)/);
  assert.match(css, /\.login-tab \{[^}]*min-height: 44px/);
});
test('reduced motion and forced-colors are handled for the tabs', () => {
  const rm = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].find((x) => x[1].includes('.login-panel-inner'));
  assert.ok(rm && /\.login-tab \{ transition: none; \}/.test(rm[1]));
  const fc = css.slice(css.indexOf('@media (forced-colors: active)'));
  assert.match(fc, /\.login-tab\[aria-selected="true"\] \{ border-color: Highlight; \}/);
});
test('the tab switch is two equal columns, so both labels fit on a 320px phone by wrapping rather than overflowing', () => {
  assert.match(css, /\.login-tabs \{[^}]*grid-template-columns: 1fr 1fr/);
  assert.match(css, /\.login-tab \{[^}]*line-height: 1\.2; text-align: center/);
});
