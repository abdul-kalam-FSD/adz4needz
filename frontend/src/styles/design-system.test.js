// Checks the shared design system in styles.css (sections 1 to 8: tokens, app chrome, buttons, forms, cards, tables, badges).
// WCAG contrast is computed from the real CSS text, so the test cannot drift from the stylesheet.
//
// SCOPE AND LIMITS (read before trusting a pass):
//  - It checks colour pairs that are written as plain 6-digit hex values, plus a few structural rules (focus ring, reduced motion,
//    no remote resources, no hidden-drawer keyboard trap, tables contain their .sr-only cells).
//  - It does NOT render anything. Gradients are checked at their worst stop only where stated; translucent overlays (for example the
//    green wash behind the active menu item) are checked against the opaque colour underneath, not blended.
//  - The sign-in screen and Team chat have their own tests (login-contrast.test.js, chat-contrast.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')) + 1);
const tokens = Object.fromEntries([...root.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const t = (name) => { assert.ok(tokens[name], 'missing token --' + name); return tokens[name]; };
const need = (fg, bg, min, label) => { const r = ratio(fg, bg); assert.ok(r >= min, `${label}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}:1`); };
// First declaration block for an exact selector, as a map of property -> value.
function rule(selector) {
  const i = css.indexOf('\n' + selector + ' {');
  assert.ok(i > -1, 'rule not found: ' + selector);
  const body = css.slice(i, css.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const hex = (v) => { const m = String(v).match(/#[0-9a-fA-F]{6}/); assert.ok(m, 'no hex in ' + v); return m[0]; };

test('core tokens exist as 6-digit hex values', () => {
  for (const n of ['purple-950', 'purple-900', 'purple-700', 'purple-600', 'purple-500', 'green-400', 'green-500', 'green-ink', 'bg', 'surface', 'surface-tint', 'ink', 'text', 'muted', 'field-border', 'error', 'error-bg', 'success', 'success-bg', 'warning', 'warning-bg']) t(n);
});

test('body text and secondary text reach AA on every neutral surface; headings reach AAA on white', () => {
  for (const bg of ['bg', 'surface', 'surface-tint']) { need(t('text'), t(bg), 4.5, 'text'); need(t('muted'), t(bg), 4.5, 'muted text'); }
  need(t('ink'), t('surface'), 7, 'headings');
});

test('links and the focus ring are readable on light surfaces; the focus ring on the dark menu and top bar is readable too', () => {
  for (const bg of ['bg', 'surface']) need(t('purple-600'), t(bg), 4.5, 'link');
  need(t('purple-500'), t('surface'), 3, 'focus ring on white');
  need('#a9bcae', t('purple-900'), 3, 'focus ring on the menu');
  need('#a9bcae', t('purple-950'), 3, 'focus ring on the menu bottom');
  assert.match(css, /\.topbar :focus-visible, \.sidebar :focus-visible \{ outline-color: var\(--green-400\); \}/);
});

test('form controls: border is at least 3:1 against the field, the error state and messages are readable', () => {
  need(t('field-border'), t('surface'), 3, 'input border');
  need(t('error'), t('error-bg'), 4.5, 'error message');
  need(t('success'), t('success-bg'), 4.5, 'success message');
  need(t('warning'), t('warning-bg'), 4.5, 'warning message');
  need('#302d52', '#f4f3f8', 4.5, 'info notice');
  need('#2f4a38', '#eef4ef', 4.5, 'lead box');
});

test('primary button: white text on sage, in its normal and hover state; secondary and quiet buttons readable; no gradient or glow', () => {
  need(t('on-primary'), t('green-500'), 4.5, 'primary');
  need(t('on-primary'), t('primary-dark'), 4.5, 'primary hover');
  need(t('green-ink'), t('green-400'), 4.5, 'dark text on the light sage logo tile and menu badge');
  const btn = css.slice(css.indexOf('.btn-primary {'), css.indexOf('.btn-secondary {'));
  assert.ok(!/gradient|rgba\(100, 123, 104/.test(btn), 'primary button is flat');
  need(t('purple-800'), t('surface'), 4.5, 'secondary button');
  need(t('muted'), t('surface'), 4.5, 'quiet button');
});

test('app chrome: top bar, menu items, active item, user chip and both menu badges', () => {
  for (const bg of [t('purple-700'), t('purple-900'), t('purple-950')]) { need('#f4f3f8', bg, 4.5, 'top bar text'); need('#d6d3e6', bg, 4.5, 'top bar secondary text'); }
  for (const bg of [t('purple-900'), t('purple-950')]) { need('#d6d3e6', bg, 4.5, 'menu label'); need('#ffffff', bg, 4.5, 'active menu label'); need('#aaa6c9', bg, 3, 'menu icon'); need('#a9bcae', bg, 3, 'active marker'); need('#a8a5c4', bg, 4.5, 'disabled menu item'); }
  need('#ffffff', '#5b5590', 4.5, 'avatar initials (darkest stop)');
  need('#ffffff', '#5b5590', 4.5, 'avatar initials (lightest stop)');
  const badge = rule('.nav-badge'); const mention = rule('.nav-badge-mention');
  need(hex(badge.color), hex(badge.background), 4.5, 'unread badge'); need(hex(badge.color), hex(mention.background), 4.5, 'mention badge');
});

test('status badges: every variant is readable on its own background', () => {
  for (const name of ['overdue', 'today', 'upcoming', 'success', 'muted']) {
    const r = rule('.badge-' + name);
    need(hex(r.color), hex(r.background), 4.5, 'badge-' + name);
  }
});

test('tables and cards: header text, tinted header, stat figures and filter chips are readable', () => {
  need('#403b6b', t('surface-tint'), 4.5, 'table header');
  need(t('text'), '#f8f7fa', 4.5, 'table row hover');
  need('#292640', t('surface'), 7, 'stat figure');
  need(t('muted'), t('surface'), 4.5, 'stat label');
  need('#78350f', '#fbf5e6', 4.5, 'Needs attention panel');
});

test('call desk outcome buttons are readable on their tinted backgrounds', () => {
  for (const name of ['yes', 'no', 'follow', 'none']) { const r = rule('.btn-outcome-' + name); need(hex(r.color), hex(r.background), 4.5, 'btn-outcome-' + name); }
});

test('progress bars: the filled part is distinguishable from the track (3:1), at the darkest stop of each gradient', () => {
  need('#4f6554', '#e3e0ea', 3, 'progress fill');
  need('#4f6554', '#e3e0ea', 3, 'completed progress fill');
});

test('the mobile menu drawer is hidden from keyboards until opened, and has a scrim to close it', () => {
  const m = css.match(/@media \(max-width: 768px\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'a 768px block exists');
  assert.match(m[0], /\.sidebar \{[^}]*visibility: hidden/); assert.match(m[0], /\.sidebar\.is-open \{[^}]*visibility: visible/);
  assert.match(m[0], /\.scrim \{ display: block;/); assert.match(m[0], /\.menu-button \{ display: inline-grid; \}/);
});

test('tables scroll inside their wrapper and contain absolutely positioned .sr-only cells, so a wide table cannot widen the page', () => {
  assert.match(css, /\.table-wrap \{ position: relative;[^}]*overflow-x: auto;/);
  assert.match(css, /\.sr-only \{ position: absolute;/);
});

test('motion: hover lift and transitions are switched off for people who ask for reduced motion', () => {
  const m = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].find((x) => x[1].includes('transition: none !important'));
  assert.ok(m, 'a global reduced-motion block exists'); assert.match(m[1], /\.btn-primary:hover:not\(:disabled\) \{ transform: none; \}/);
});

test('no external resources (fonts, images, imports); only an inline data: image is used', () => {
  assert.ok(!/@import|url\(\s*['"]?https?:/i.test(css));
  assert.ok(/url\("data:image\/svg\+xml/.test(css), 'the select arrow is an inline data: image');
});

test('sage text (links, skip link) is the darker sage and reaches AA on EVERY surface it is drawn on, including the warm page and the amber panel', () => {
  for (const bg of ['#ffffff', t('bg'), t('surface-tint'), '#fbf5e6']) need(t('primary-dark'), bg, 4.5, 'sage link on ' + bg);
  assert.ok(!/(^|[^-])color: var\(--primary\);/m.test(css), 'no rule uses the lighter button sage (#647b68) as TEXT colour: it is 4.2:1 on the warm page');
});

// ---- Phase 1: payment / proof-review badges and the new shared tokens -------------------------------------------------------
const resolve = (v) => { const m = String(v).match(/var\(--([a-z0-9-]+)\)/); return m ? t(m[1]) : hex(v); };

test('payment and proof-review badges: all six are readable on their own backgrounds (4.5:1)', () => {
  for (const name of ['pay-pending', 'pay-partial', 'pay-paid', 'review-pending', 'review-approved', 'review-rejected']) {
    const r = rule('.badge-' + name);
    need(resolve(r.color), resolve(r.background), 4.5, 'badge-' + name);
  }
});

test('payment badges keep the existing palette: each colour pair is one that the app already used', () => {
  const allowed = new Set(['#5f5e69|#ebe9f1', '#78350f|#f6e9c8', '#2f5a3d|#e1ebe3', '#302d52|#e8e6ef', '#2f5a3d|#edf3ee', '#991b1b|#fee2e2']);
  for (const name of ['pay-pending', 'pay-partial', 'pay-paid', 'review-pending', 'review-approved', 'review-rejected']) {
    const r = rule('.badge-' + name);
    assert.ok(allowed.has((resolve(r.color) + '|' + resolve(r.background)).toLowerCase()), 'badge-' + name);
  }
});

test('new tokens: light text on the dark purple keeps AA, and the warning/success edge colours are the ones used before', () => {
  for (const bg of [t('purple-900'), t('purple-950')]) { need(t('on-dark-muted'), bg, 4.5, 'secondary text on dark'); need(t('purple-50'), bg, 4.5, 'text on dark'); }
  assert.equal(t('success-border'), '#b7ccbb'); assert.equal(t('warning-border'), '#e0c27a'); assert.equal(t('warning-edge'), '#c8892b'); assert.equal(t('success-soft'), '#eef4ef');
  need(t('success'), t('success-soft'), 4.5, 'success text on the soft success background');
});
