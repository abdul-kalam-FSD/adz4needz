// Phase 1 UI/UX changes: text-level and structure-level checks on the real source files.
// SCOPE AND LIMITS: these tests read the .jsx/.css text. They do NOT render the pages, click anything, or measure focus or scroll position.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { PAYMENT_STATUS_BADGE, PAYMENT_STATUS_LABEL, REVIEW_BADGE, REVIEW_LABEL } from './payment-labels.js';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const css = read('styles/styles.css');

test('LST-02: every quick-filter button reports whether its filter is the one in use (aria-pressed), and keeps its click behaviour', () => {
  const cases = [
    ['components/LeadsListView.jsx', 3, 'applied.followUp'],
    ['components/InterviewsListView.jsx', 3, 'applied.when'],
    ['components/PaymentsListView.jsx', 3, 'applied.status']
  ];
  for (const [file, expected, source] of cases) {
    const src = read(file);
    const buttons = (src.match(/<button[\s\S]*?<\/button>/g) || []).filter((b) => b.includes('summary-button'));
    assert.equal(buttons.length, expected, file + ' has ' + expected + ' quick filters');
    for (const b of buttons) {
      assert.ok(b.includes('aria-pressed={' + source + ' === '), file + ': ' + b.slice(0, 90));
      assert.ok(/onClick=\{\(\) => quick\('/.test(b), file + ' still calls quick(...)');
    }
  }
  assert.match(css, /\.summary-button\[aria-pressed="true"\] \{/, 'the pressed look exists in the stylesheet');
});

test('CAL-01: Call desk re-reads the list in the background after a call and after an undo, and keeps rows on screen while it does', () => {
  const src = read('pages/CallDeskPage.jsx');
  assert.equal((src.match(/loadLeads\(\{ background: true \}\)/g) || []).length >= 3, true, 'record, undo and the refresh-again button');
  assert.ok(!/setList\(\(l\) => \(\{ \.\.\.l, state: 'loading' \}\)\)/.test(src), 'the old "blank the rows while reloading" line is gone');
  assert.ok(/listShowsRows\(list\)/.test(src));
  assert.ok(!/list\.state === 'ready' &&/.test(src), 'rows are not gated on the "ready" state alone');
  assert.ok(/listRequest\.current/.test(src), 'a slower, older answer cannot overwrite a newer one');
});

test('CAL-01: the outcome buttons stay focusable while their own save runs (aria-disabled, not disabled), and a second click is still ignored', () => {
  const src = read('pages/CallDeskPage.jsx');
  const btn = src.match(/<button key=\{o\.key\}[\s\S]*?<\/button>/)[0];
  assert.ok(btn.includes("aria-disabled={r.pending ? 'true' : undefined}"));
  assert.ok(!/(?<![-\w])disabled=/.test(btn), 'no real disabled attribute on the outcome buttons');
  assert.ok(btn.includes('if (!r.pending) record(l, o.key)'));
  assert.match(css, /\.btn-outcome\[aria-disabled="true"\] \{/);
});

test('PAY-06: payment status and proof review status each have their own class and their own label, and no class is shared', () => {
  const classes = [...Object.values(PAYMENT_STATUS_BADGE), ...Object.values(REVIEW_BADGE)];
  assert.equal(new Set(classes).size, 6);
  assert.deepEqual(Object.keys(PAYMENT_STATUS_LABEL).sort(), Object.keys(PAYMENT_STATUS_BADGE).sort());
  assert.deepEqual(Object.keys(REVIEW_LABEL).sort(), Object.keys(REVIEW_BADGE).sort());
  const labels = [...Object.values(PAYMENT_STATUS_LABEL), ...Object.values(REVIEW_LABEL)];
  assert.equal(new Set(labels).size, 6, 'six different words, so the state never depends on colour alone');
  for (const c of classes) assert.match(css, new RegExp('\\n\\.' + c + ' \\{'), c + ' is defined');
});

test('PAY-06: the marker in front of each status differs too (ring, half, dot, dashed ring, check, cross)', () => {
  assert.match(css, /\.badge-review-approved::before \{ content: "\\2713"/);
  assert.match(css, /\.badge-review-rejected::before \{ content: "\\2715"/);
  assert.match(css, /\.badge-pay-partial::before \{ background: linear-gradient/);
  assert.match(css, /\.badge-review-pending::before \{ box-shadow: none; border: 1\.5px dashed/);
});

test('PAY-02: the admin payments page no longer says proof is unverified or that payments are plainly read-only', () => {
  const src = read('pages/AdminPaymentsPage.jsx');
  assert.ok(!/has not been verified by anyone/.test(src));
  assert.ok(/approved or rejected by an admin/.test(src));
  assert.ok(/approve or reject it/.test(src));
});

test('AUT-01 / AUT-02: both sign-in tabs explain who resets a forgotten password; no screen mentions a Team Lead or TL role', () => {
  const login = read('pages/LoginPage.jsx');
  assert.equal((login.match(/Forgot your password\?/g) || []).length, 2);
  assert.ok(/Ask your admin to reset it/.test(login));
  assert.ok(!/\/api\/.*reset|forgot-password|resetPassword/i.test(login), 'no new reset request is made from the sign-in page');
  for (const dir of ['pages', 'components']) {
    for (const f of readdirSync(new URL('../' + dir + '/', import.meta.url)).filter((n) => n.endsWith('.jsx'))) {
      const src = read(dir + '/' + f);
      assert.ok(!/\bTL\b|Team Lead|team lead|team leader/i.test(src), dir + '/' + f + ' mentions a Team Lead');
    }
  }
});

test('FRM-02: optional fields say "(optional)", required fields carry no mark, and no field changed its required rule', () => {
  const lead = read('pages/LeadFormPage.jsx');
  assert.ok(lead.includes("'Follow-up date (optional)'") && lead.includes("'Next action (optional)'"));
  assert.ok(!lead.includes('Next action required'));
  assert.ok(lead.includes('Fields marked (optional) can be left empty'));
  const profile = read('pages/ProfilePage.jsx');
  assert.ok(profile.includes('Phone (optional)') && profile.includes('Email (optional)'));
  const reports = read('pages/AdminReportsPage.jsx');
  for (const l of ['Calls target', 'Interested target', 'Interviews scheduled target', 'Revenue received target']) assert.ok(reports.includes(`'${l} (optional)'`));
  const imp = read('pages/AdminImportPage.jsx');
  assert.ok(!/' \*'/.test(imp), 'no asterisk convention left in the import mapping');
  assert.ok(imp.includes('f.required ? ') && imp.includes('(optional)'));
});

test('VIS-01 / VIS-03: the legacy stylesheet is gone and nothing imports it; the app loads exactly one stylesheet', () => {
  assert.equal(existsSync(new URL('../styles/style.css', import.meta.url)), false);
  const main = read('main.jsx');
  assert.equal((main.match(/\.css'/g) || []).length, 1);
  assert.ok(main.includes("./styles/styles.css"));
});

test('VIS-01: the new shared tokens exist and the repeated values now use them', () => {
  for (const t of ['--on-dark', '--on-dark-muted', '--success-border', '--success-soft', '--warning-border', '--warning-edge']) assert.ok(css.includes('  ' + t + ':'), t);
  assert.ok(css.includes('border-left: 5px solid var(--warning-edge)'));
  assert.ok(!/stroke='%235b21b6'/.test(css), 'the old off-palette violet in the select arrow is gone');
});
