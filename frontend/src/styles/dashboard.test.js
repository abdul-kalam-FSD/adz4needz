// Phase 3A dashboards: colour pairs used by the dashboard components, and a source-level check that the redesign kept every API call,
// calculation helper and route link (it does NOT render anything).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = rd('./styles.css');
const root = css.slice(css.indexOf(':root {'), css.indexOf('\n}\n', css.indexOf(':root {')));
const t = (n) => { const m = root.match(new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})')); assert.ok(m, 'token --' + n); return m[1].toLowerCase(); };
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const need = (fg, bg, min, what) => assert.ok(ratio(fg, bg) >= min, `${what}: ${fg} on ${bg} is ${ratio(fg, bg).toFixed(2)}:1, needs ${min}:1`);
const rule = (sel) => { const i = css.indexOf('\n' + sel + ' {'); assert.ok(i > -1, 'rule not found: ' + sel); return css.slice(i, css.indexOf('}', i)); };

test('dashboard colours: every text/background pair reaches its contrast threshold', () => {
  const surface = t('surface');
  need(t('muted'), surface, 4.5, 'KPI label and note'); need(t('purple-900'), surface, 7, 'KPI figure');
  need(t('error'), surface, 4.5, 'overdue figure'); need(t('ink'), t('warning-bg'), 7, 'attention title');
  need(t('text'), surface, 4.5, 'attention text'); need(t('ink'), surface, 7, 'metric figure');
  need(t('primary-dark'), surface, 4.5, 'KPI and attention link'); need(t('primary-dark'), t('warning-bg'), 4.5, 'link on the attention panel');
  need('#ffffff', t('warning'), 4.5, 'attention count badge'); need(t('muted'), t('warning-bg'), 4.5, 'muted text on the attention panel');
  need(t('muted'), surface, 4.5, 'section meta and "Nothing right now"');
});

test('dashboard CSS uses the approved tokens (no gradients, no shadows, no new hard-coded colours)', () => {
  for (const sel of ['.dash-attention', '.dash-item', '.kpi', '.kpi-value', '.dash-card', '.dash-metrics dd']) {
    const r = rule(sel);
    assert.ok(!/gradient|box-shadow/.test(r), sel + ' is flat');
  }
  assert.match(rule('.kpi-value'), /color: var\(--purple-900\)/); assert.match(rule('.kpi-value.is-alert'), /color: var\(--error\)/);
  assert.match(rule('.kpi-row'), /repeat\(4, minmax\(0, 1fr\)\)/); assert.match(css, /@media \(max-width: 1023px\) \{ \.kpi-row \{ grid-template-columns: repeat\(2/);
  assert.match(rule('.dash-attention'), /border-left: 5px solid var\(--warning-edge\)/);
  assert.match(rule('.dash-card'), /border-radius: var\(--radius-card\)/); assert.match(rule('.kpi'), /border-radius: var\(--radius-card\)/);
});

test('both dashboards use the shared PageHeader and shared dashboard parts, with no explanatory hint paragraphs', () => {
  for (const f of ['../pages/BdeDashboardPage.jsx', '../pages/AdminDashboardPage.jsx']) {
    const src = rd(f); assert.match(src, /<PageHeader/); assert.ok(!/<h1>/.test(src.replace(/\/\/.*$/gm, '')), f + ' has no hand-written h1');
    assert.ok(!/className="hint"/.test(src), f + ' has no hint paragraph');
  }
  assert.ok(!/className="hint"/.test(rd('../components/AdminKpis.jsx')) && !/className="hint"/.test(rd('../components/AdminCallStats.jsx')));
  assert.match(rd('../components/AdminKpis.jsx'), /<Attention/); assert.match(rd('../pages/BdeDashboardPage.jsx'), /<Attention/);
});

test('BDE dashboard still reads the same six APIs and the same helpers; Admin still reads the same endpoints', () => {
  const bde = rd('../pages/BdeDashboardPage.jsx');
  for (const call of ['api.listDailyReports()', 'api.callSummary()', 'api.leadSummary(today)', 'api.interviewSummary(today)', "api.paymentSummary('')", 'api.monthlyReport(month)']) assert.ok(bde.includes(call), call);
  for (const h of ['attentionItems(', 'reportForDay(', 'todayLocal(', 'formatPercent(callStats.conversionRate)']) assert.ok(bde.includes(h), h);
  const kp = rd('../components/AdminKpis.jsx');
  for (const call of ['api.adminCallStats(date)', 'api.adminMonthlyReport(', 'api.adminLeadSummary(date)', 'api.adminInterviewSummary(date)', 'api.adminInterviewOverview(']) assert.ok(kp.includes(call), call);
  assert.ok(kp.includes('dashboardCards(') && kp.includes('todoItems('));
  assert.ok(rd('../components/AdminCallStats.jsx').includes('api.adminCallStats(date)') && rd('../pages/AdminDashboardPage.jsx').includes('api.adminDailyOverview(d)'));
  assert.ok(rd('../components/AdminCallStats.jsx').includes('formatPercent(t.conversionRate)') && rd('../components/AdminCallStats.jsx').includes('formatPercent(b.conversionRate)'));
});

test('dashboards keep their links to the existing routes', () => {
  const bde = rd('../pages/BdeDashboardPage.jsx') + rd('../lib/dashboard.js');
  for (const to of ['/call-desk', '/daily-report', '/leads', '/interviews', '/payments', '/monthly']) assert.ok(bde.includes("'" + to + "'") || bde.includes('"' + to + '"'), to);
  const admin = rd('../lib/admin-dashboard.js') + rd('../components/AdminCallStats.jsx') + rd('../pages/AdminDashboardPage.jsx');
  for (const to of ['/admin/leads', '/admin/interviews', '/admin/bdes']) assert.ok(admin.includes(to), to);
});
