// Phase 3B Call desk and Leads: colour pairs the two screens use, scoped (not shared) styling, and a source-level check that every
// API call, outcome, route link and handler was kept. It does NOT render anything.
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
const cd = rd('../pages/CallDeskPage.jsx');
const leads = rd('../components/LeadsListView.jsx');

test('Call desk and Leads colours: every text/background pair reaches its contrast threshold', () => {
  need(t('text'), t('surface-subtle'), 4.5, 'lead status chip');
  need(t('muted'), t('surface'), 4.5, 'follow-up date label, contact lines, next action');
  need(t('text'), t('surface'), 4.5, 'undo button text');
  need(t('field-border'), t('surface'), 3, 'undo dashed border');
  need(t('ink'), t('surface'), 7, 'metric figures');
});

test('shared selectors were NOT restyled: the Call desk and Leads use scoped modifiers', () => {
  assert.match(cd, /className="filters filters-bar"/); assert.match(leads, /className="filters filters-bar"/);
  assert.ok(!/className="page-head"/.test(cd), 'Call desk uses PageHeader'); assert.match(rd('../pages/LeadsPage.jsx'), /<PageHeader title="Leads"/);
  // the shared .filters rule still has its original grid layout (Payments and Interviews rely on it)
  assert.match(rule('.filters'), /display: grid/); assert.match(rule('.filters'), /grid-template-columns: repeat\(auto-fit, minmax\(170px, 1fr\)\)/);
  assert.match(rule('.filters-bar'), /display: flex/);
  for (const sel of ['.status-chip', '.btn-undo', '.call-desk-table td', '.leads-table td', '.cd-outcomes', '.followup-cell']) assert.ok(!/gradient|box-shadow/.test(rule(sel)), sel + ' is flat');
});

test('Undo is visually distinct from the four result buttons', () => {
  assert.match(rule('.btn-undo'), /border: 1px dashed var\(--field-border\)/); assert.match(rule('.btn-undo'), /background: transparent/);
  for (const k of ['yes', 'no', 'follow', 'none']) assert.ok(!/dashed/.test(rule('.btn-outcome-' + k)), k + ' result button has a solid border');
  assert.match(cd, /className="btn btn-undo"/);
});

test('Call desk keeps its four outcomes, its request flow and every API call', () => {
  assert.match(cd, /OUTCOMES\.map\(\(o\) => \(\s*<button key=\{o\.key\} type="button" className=\{`btn btn-outcome btn-outcome-\$\{o\.tone\}`\}/);
  assert.match(cd, /aria-disabled=\{r\.pending \? 'true' : undefined\}/); assert.match(cd, /if \(!r\.pending\) record\(l, o\.key\)/);
  assert.ok(!/<button key=\{o\.key\}[^>]*\sdisabled=/.test(cd), 'result buttons are never really disabled (aria-disabled only)');
  for (const call of ['api.callSummary()', 'api.listLeads(', 'api.leadStatuses()', 'api.recordCall(', 'api.undoCall(']) assert.ok(cd.includes(call), call);
  for (const keep of ['listShowsRows(list)', 'listRequest.current', 'loadLeads({ background: true })', 'clientRequestId', 'followUpDate']) assert.ok(cd.includes(keep), keep);
  const lib = rd('../lib/call-desk.js');
  for (const label of ["'Interested'", "'Not interested'", "'Follow-up'", "'No response'"]) assert.ok(lib.includes(label), label);
});

test('Leads keeps its fields, handlers and links', () => {
  for (const call of ['api.listLeads(', 'api.setLeadStatus(', 'api.leadStatuses(']) assert.ok(leads.includes(call), call);
  for (const keep of ['aria-pressed', 'status-select', 'followUpFrom', 'followUpTo', '/leads/${l.id}/edit', '/interviews/new?leadId=${l.id}', '/payments/new?leadId=${l.id}']) assert.ok(leads.includes(keep), keep);
  for (const f of ['l.candidateName', 'l.phone', 'l.email', 'l.courseOrInternship', 'l.nextAction']) assert.ok(leads.includes(f), f);
  assert.match(leads, /<FollowUp lead=\{l\} \/>/); assert.match(cd, /<FollowUp lead=\{l\} \/>/);
  for (const id of ['f-q', 'f-status', 'f-followup', 'f-from', 'f-to']) assert.ok(leads.includes(`"${id}"`), id);
});

test('FollowUp is presentation only: same three states and the same badge classes as before', () => {
  const f = rd('../components/FollowUp.jsx');
  for (const k of ["overdue: ['badge-overdue', 'Overdue']", "today: ['badge-today', 'Due today']", "upcoming: ['badge-upcoming', 'Upcoming']"]) assert.ok(f.includes(k), k);
  assert.ok(!/fetch\(|api\.|useNavigate|useAuth/.test(f));
});
