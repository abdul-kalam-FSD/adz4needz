// Checks the sign-in screen's stylesheet: WCAG contrast of every text/background pair (computed from the real CSS variables),
// plus structural requirements (breakpoints, reduced motion, visible focus, no external resources). It does NOT render the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const block = css.slice(css.indexOf('.login-page {'), css.indexOf('.login-page {') + css.slice(css.indexOf('.login-page {')).indexOf('}') + 1);
const vars = Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const v = (name) => { assert.ok(vars[name], 'missing token --' + name); return vars[name]; };

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const atLeast = (fg, bg, min, label) => { const r = ratio(v(fg), v(bg)); assert.ok(r >= min, `${label}: --${fg} on --${bg} is ${r.toFixed(2)}:1, needs ${min}:1`); };

test('all colour tokens are defined as 6-digit hex values', () => {
  assert.ok(Object.keys(vars).length >= 20, 'found ' + Object.keys(vars).length + ' tokens');
  for (const name of ['deep', 'mid', 'glow', 'green', 'green-strong', 'cyan', 'on-dark', 'on-dark-muted', 'on-green', 'panel', 'ink', 'ink-muted', 'field-border', 'placeholder', 'focus', 'error', 'error-bg', 'info', 'info-bg', 'success', 'success-bg']) v('login-' + name);
});
test('WCAG AA text contrast (4.5:1) on the form panel', () => {
  for (const fg of ['ink', 'ink-muted', 'placeholder', 'error', 'link']) if (vars['login-' + fg]) atLeast('login-' + fg, 'login-panel', 4.5, 'panel text');
  assert.ok(ratio(v('login-ink'), v('login-panel')) >= 7, 'headings reach AAA (7:1)');
});
test('WCAG AA text contrast on the flat purple brand panel (no gradient: one background colour)', () => {
  for (const fg of ['green', 'on-dark', 'on-dark-muted']) atLeast('login-' + fg, 'login-deep', 4.5, 'brand text on the panel');
  const brand = css.slice(css.indexOf('.login-brand {'), css.indexOf('.login-orb'));
  assert.match(brand, /background: var\(--login-deep\);/); assert.ok(!/gradient/.test(brand));
});
test('the sign-in button is white on sage (normal and hover); the logo tile keeps dark text on light sage', () => {
  atLeast('login-on-strong', 'login-green-strong', 4.5, 'button');
  assert.ok(ratio(v('login-on-strong'), '#566c5b') >= 4.5, 'button hover');
  atLeast('login-on-green', 'login-green', 4.5, 'logo tile');
});
test('message boxes: error, info and success text on their own backgrounds, and the error text on the white panel', () => {
  atLeast('login-error', 'login-error-bg', 4.5, 'alert'); atLeast('login-info', 'login-info-bg', 4.5, 'info notice'); atLeast('login-success', 'login-success-bg', 4.5, 'success notice');
});
test('non-text contrast (3:1): input borders and the focus ring against the white panel', () => {
  atLeast('login-field-border', 'login-panel', 3, 'input border'); atLeast('login-focus', 'login-panel', 3, 'focus ring');
});

test('responsive: tablet (640px) and desktop (960px) breakpoints exist, desktop is two columns, mobile is one stacked column', () => {
  assert.match(css, /@media \(min-width: 640px\) \{[\s\S]*?\.login-copy \{ display: block; \}/);
  assert.match(css, /@media \(min-width: 960px\) \{[\s\S]*?\.login-page \{ grid-template-columns: minmax\(0, 1\.4fr\) minmax\(0, 1fr\)/);
  assert.match(block, /grid-template-rows: auto 1fr;/); assert.match(block, /min-height: 100dvh;/);
});
test('reduced motion: the entrance animation, button lift, transitions and spinner are all switched off', () => {
  const m = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].find((x) => x[1].includes('.login-panel-inner')); assert.ok(m, 'a reduced-motion block for the sign-in screen is present');
  assert.match(m[1], /\.login-panel-inner \{ animation: none; \}/); assert.match(m[1], /transition: none/); assert.ok(!/translateY\(-1px\)/.test(css.slice(css.indexOf('.login-submit {'), css.indexOf('.login-spinner {'))), 'no lifting button'); assert.match(m[1], /\.login-spinner \{ animation: none;/);
});
test('visible keyboard focus on every control: inputs get a ring, the button and the show/hide control get an outline', () => {
  assert.match(css, /\.login-field input:focus-visible \{[^}]*box-shadow: 0 0 0 3px/);
  assert.match(css, /\.login-submit:focus-visible \{ outline: 3px solid var\(--login-focus\)/); assert.match(css, /\.login-eye:focus-visible \{ outline: 3px solid var\(--login-focus\)/);
  assert.ok(!/\.login-[a-z-]+[^{]*\{[^}]*outline:\s*none[^}]*\}(?![\s\S]{0,0})/.test(css.replace(/\.login-field input:focus, \.login-field input:focus-visible \{[^}]*\}/, '')), 'no login control removes its outline without the replacement above');
});
test('touch targets: inputs 48px, sign-in 52px, show/hide 44px', () => {
  assert.match(css, /\.login-field input \{[^}]*min-height: 48px/); assert.match(css, /\.login-submit \{[^}]*min-height: 52px/); assert.match(css, /\.login-eye \{[^}]*width: 44px; height: 44px/);
});
test('no external resources (fonts, images, imports) and a high-contrast fallback exists', () => {
  assert.ok(!/@import|url\(\s*['"]?https?:/i.test(css), 'no @import or remote url()');
  assert.match(css, /@media \(forced-colors: active\)/);
});
test('the old plain login classes are gone (nothing else uses them)', () => { assert.ok(!/\.login-wrap|\.login-card/.test(css)); });
