// Phase 3D (Daily Report, Reports, My Month): structure-level checks on the real source files.
// SCOPE AND LIMITS: like the other files in this folder these tests read the .jsx/.css text. They do NOT render the pages, click anything or
// measure layout (the repository has no JSX test runner and no committed browser tests). They pin what must stay the same (ids, labels, state
// logic, API calls, null and percentage handling) and what the redesign added.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const css = rd('styles/styles.css');
const daily = rd('pages/DailyReportPage.jsx');
const myMonth = rd('pages/MonthlyReportPage.jsx');
const admin = rd('pages/AdminReportsPage.jsx');
const range = rd('components/RangeReport.jsx');
const figures = rd('components/MonthlyFigures.jsx');
const picker = rd('components/MonthPicker.jsx');
const sectionAt = css.indexOf('Daily Report, Reports and My Month (v2)');
const section = css.slice(css.lastIndexOf('/*', sectionAt));   // from the opening of the section's header comment to the end of the file
const ruleBody = (sel) => { const m = css.slice(0, sectionAt).match(new RegExp('(?:^|\\n)' + sel.replace(/[.[\]()]/g, '\\$&') + ' \\{([^}]*)\\}')); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };

test('the three screens use the shared PageHeader and no longer carry their own <h1>', () => {
  for (const [name, src, title] of [['Daily', daily, 'Daily Calling Report'], ['My Month', myMonth, 'My Month'], ['Reports', admin, 'Reports']]) {
    assert.ok(src.includes('<PageHeader') && src.includes(`title="${title}"`), name);
    assert.ok(!/<h1[ >]/.test(src), name + ' has no hand-written <h1>');
  }
  assert.ok(!/<h1[ >]/.test(range) && !/<h1[ >]/.test(figures), 'the shared components have no <h1>');
  assert.equal((admin.match(/<PageHeader/g) || []).length, 1, 'the Reports page has one header for both report types');
});

test('Reports: both control levels keep their buttons, state and behaviour (only the classes changed)', () => {
  assert.ok(admin.includes("const [kind, setKind] = useState('monthly')"));
  assert.ok(admin.includes("aria-pressed={kind === 'monthly'} onClick={() => setKind('monthly')}>Monthly with targets"));
  assert.ok(admin.includes("aria-pressed={kind !== 'monthly'} onClick={() => setKind(kind === 'monthly' ? 'day' : kind)}>Day / Week / Custom"));
  assert.ok(admin.includes('role="group" aria-label="Report type"') && admin.includes("{kind === 'monthly' ? <MonthlyView /> : <RangeReport kind={kind} onKind={setKind} />}"));
  assert.ok(range.includes('role="group" aria-label="Report period"'));
  assert.ok(range.includes("PERIODS.map((k) => <button key={k} type=\"button\" className={'seg-btn' + (k === kind ? ' is-active' : '')} aria-pressed={k === kind} onClick={() => onKind(k)}>{LABEL[k]}</button>)"));
  assert.ok(range.includes("const range = kind === 'custom' ? custom : periodRange(kind, anchor);") && range.includes('const problem = rangeProblem(range.from, range.to);'));
  for (const id of ['rr-from', 'rr-to', 'rr-anchor']) assert.ok(range.includes(`id="${id}"`), id);
  assert.ok(range.includes('api.adminRangeReport(range.from, range.to)') && admin.includes('api.adminMonthlyReport(month)'));
});

test('downloads: the same helper-built links with the same labels, and hidden when the custom range is invalid', () => {
  assert.ok(admin.includes("href={monthlyExportUrl(month, 'xlsx')}>Download Excel") && admin.includes("href={monthlyExportUrl(month, 'pdf')}>Download PDF"));
  assert.ok(range.includes("href={rangeExportUrl(range.from, range.to, 'xlsx')}>Download Excel") && range.includes("href={rangeExportUrl(range.from, range.to, 'pdf')}>Download PDF"));
  assert.match(range, /\{!problem && \(\s*<div className="download-row">/);
});

test('targets: literal optional labels, validation, save and cancel flow, and the form moves focus to its first field', () => {
  for (const l of ['Calls target', 'Interested target', 'Interviews scheduled target', 'Revenue received target']) assert.ok(admin.includes(`'${l} (optional)'`), l);
  assert.ok(admin.includes("targetInput(form.calls, 'count')") && admin.includes("targetInput(form.revenue, 'money')"));
  assert.ok(admin.includes('api.adminSetTargets({ month, bdeId: editing.id, targetCalls: parsed.calls.value, targetInterested: parsed.interested.value, targetInterviews: parsed.interviews.value, targetRevenue: parsed.revenue.value })'));
  assert.ok(admin.includes("setSaved(`Targets saved for ${editing.name}.`)") && admin.includes('onClick={() => setEditing(null)} disabled={saving}>Cancel'));
  assert.ok(admin.includes("if (editing) document.getElementById('t-calls')?.focus();"));
  assert.ok(admin.includes('renderAction={(b) => <button type="button" className="btn btn-secondary" onClick={() => startEdit(b)}>Set targets</button>}'));
});

test('figures: all ten figures keep their labels, values and note functions; four are headline figures, six are listed', () => {
  for (const l of ['Calls made', 'Interested leads', 'Distinct leads called', 'Not interested', 'Follow-up required', 'No response', 'Leads added', 'Interviews scheduled', 'Payment commitments', 'Revenue received']) assert.ok(figures.includes(`['${l}', `), l);
  assert.ok(figures.includes('callSourceNote(f.calls)') && figures.includes('distinctLeadsNote(f.calls)'));
  assert.ok(figures.includes("'conversion (interested leads ÷ calls): —'") && figures.includes('% conversion (interested leads ÷ calls, calculated)'));
  assert.ok(figures.includes('formatAmount(f.revenueReceived)') && figures.includes('money actually recorded as received') && figures.includes('committed`'));
  assert.ok(figures.includes("const HEADLINE = ['Calls made', 'Interested leads', 'Interviews scheduled', 'Revenue received'];"));
  assert.ok(figures.includes('const others = cards.filter((c) => !HEADLINE.includes(c[0]));') && figures.includes('{note && <dd className="fig-note">{note}</dd>}'));
});

test('targets and achievement: null shows an em dash, percentages above 100 stay text, only the bar is clamped', () => {
  assert.ok(figures.includes('<div className="progress-value">{formatPercent(pct)}</div>'), 'the text is the real, unclamped percentage');
  assert.ok(figures.includes("style={{ width: barWidth(pct) + '%' }}") && figures.includes('aria-valuenow={Math.min(pct, 100)}') && figures.includes('pct >= 100 ? \' is-complete\''));
  assert.ok(figures.includes('pct !== null && pct !== undefined && ('), 'no bar when there is no target');
  assert.ok(figures.includes('formatCount(b.targets.calls)') && figures.includes('formatAmount(b.targets.revenue)') && figures.includes('b.achievement.revenue'));
  for (const a of ['calls achieved', 'interested achieved', 'interviews achieved', 'revenue achieved']) assert.ok(figures.includes('`${b.name} ' + a + '`'), a);
  assert.ok(figures.includes('Monthly actual figures against targets. Achieved percentages are calculated.'));
  assert.ok(figures.includes('formatPercent(b.calculated.interestedPercentOfCalls)'));
  assert.ok(myMonth.includes('Object.values(me.targets).every((v) => v === null)') && myMonth.includes('No target has been set for you this month.'));
});

test('per BDE: a comparison table, and every BDE keeps all ten figures in an expandable block, in both report views', () => {
  assert.ok(figures.includes('export function BdeComparison({ bdes })'));
  assert.match(figures, /<details key=\{b\.id\} className="bde-detail">\s*<summary>\{b\.name\} \(\{b\.employeeId\}\)[^]*?<section aria-label=\{b\.name\}><FigureCards block=\{b\} \/><\/section>/);
  for (const h of ['Calls', 'Interested leads', 'Conversion', 'Interviews scheduled', 'Payment commitments', 'Revenue received']) assert.ok(figures.includes(`<th className="num">${h}</th>`), h);
  assert.ok(admin.includes('<BdeComparison bdes={r.bdes} />') && range.includes('<BdeComparison bdes={r.bdes} />'));
  assert.ok(!/<h3>\{b\.name\} \(\{b\.employeeId\}\)<\/h3>/.test(admin + range), 'the old always-open per-BDE card grids are gone');
  assert.ok(admin.includes('r.total.bdesWithTargets') && admin.includes('Team revenue received:') && range.includes('Revenue received in this period:'));
});

test('month picker: same input id, same handlers, same month guard', () => {
  assert.ok(picker.includes('id="report-month"') && picker.includes('htmlFor="report-month"') && picker.includes('type="month" min="2020-01"'));
  assert.ok(picker.includes('onChange(shiftMonth(month, -1))') && picker.includes('onChange(shiftMonth(month, 1))') && picker.includes('if (MONTH_RE.test(e.target.value)) onChange(e.target.value);'));
  assert.equal((picker.match(/disabled=\{disabled\}/g) || []).length, 3);
  assert.ok(picker.includes('Previous month') && picker.includes('Next month'));
});

test('explanations were shortened on the page but kept in full inside "How these figures are counted"', () => {
  assert.ok(myMonth.includes('<details className="how-counted">') && myMonth.includes('Your own figures for the month, taken from your Call desk calls and daily reports (for each day, one or the other, never both), plus leads, interviews and payments. Targets are set by an admin; "achieved" is calculated as actual ÷ target.'));
  assert.ok(admin.includes('<details className="how-counted">') && admin.includes("Figures come from the database. Calls come from the Call desk and from manual daily reports, one source per BDE per day (a day with Call desk calls ignores that day's manual report)."));
  assert.ok(admin.includes('Percentages marked "achieved" are calculated as actual ÷ target. Leave a target blank for no target.'));
  assert.ok(daily.includes('If the same day also has Call desk calls, only the Call desk calls are counted (this report is kept but not added), so nothing is counted twice.'));
  assert.ok(daily.includes('<Link to="/call-desk">Call desk</Link>'));
});

test('Daily Report: same form ids, validation, submit guard and API calls; the latest-30 note shows only when exactly 30 come back', () => {
  assert.ok(daily.includes("const fieldId = (key) => 'field-' + key;") && daily.includes("id={fieldId('reportDate')}") && daily.includes('id={fieldId(f.key)}'));
  assert.ok(daily.includes('id="number-hint"') && daily.includes('aria-describedby={`number-hint ${f.key}-error`}') && daily.includes('aria-describedby="reportDate-error"') && daily.includes('id="error-summary"'));
  assert.ok(daily.includes('if (saving) return;') && daily.includes('validateDailyReport({ reportDate, ...counts })') && daily.includes('api.createDailyReport(result.value)') && daily.includes('document.getElementById(fieldId(first.key))?.focus()'));
  assert.ok(daily.includes('await api.listDailyReports()'), 'the list is still requested with no arguments (no API change, no paging)');
  assert.ok(!/setPage|className="pager"|>Previous<|>Next<|pageSize|\?limit=|offset/.test(daily), 'no pagination was added');
  assert.ok(daily.includes('const LATEST_SHOWN = 30;') && daily.includes('list.state === \'ready\' && list.items.length === LATEST_SHOWN && <p className="hint">Showing your latest 30 reports.</p>'));
  assert.ok(daily.includes('state-message" role="status">Loading your reports') && daily.includes('state-message" role="alert">{list.message}') && daily.includes('onClick={loadReports}>Retry'));
  assert.ok(daily.includes('No reports submitted yet.'));
});

test('stylesheet: the new rules are scoped, flat and token-only, and the shared rules they sit next to are unchanged', () => {
  assert.ok(sectionAt > 0 && section.length > 1500, 'the Phase 3D section exists');
  assert.ok(css.indexOf('Payments and Interviews (v2)') > 0 && css.indexOf('Payments and Interviews (v2)') < sectionAt, 'the Phase 3C section is still there, before this one');
  assert.ok(!/gradient|box-shadow|#[0-9a-fA-F]{3,8}\b|rgb\(/.test(section.replace(/\/\*[\s\S]*?\*\//g, '')), 'no gradients, shadows or hard-coded colours (comments excluded)');
  for (const sel of ['.report-tabs', '.tab-btn', '.seg', '.seg-btn', '.report-controls', '.download-row', '.month-bar', '.fig-list', '.fig-item', '.tgt-line', '.target-table', '.cmp-table', '.bde-detail', '.daily-grid', '.daily-form']) assert.ok(section.includes(sel + ' ') || section.includes(sel + ',') || section.includes(sel + ':'), sel);
  assert.equal(ruleBody('.toolbar'), 'display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 16px; margin-bottom: var(--space-2);');
  assert.match(ruleBody('.summary-cards'), /grid-template-columns: repeat\(auto-fill, minmax\(190px, 1fr\)\)/);
  assert.match(ruleBody('.report-form'), /max-width: 600px/);
  assert.match(ruleBody('.progress'), /background: #dbe3ea/); assert.match(ruleBody('.progress-bar'), /background: var\(--teal-700\)/);
  assert.match(ruleBody('.kpi-row'), /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(section, /\.table-wrap\.target-table table\.table-wide, \.table-wrap\.cmp-table table\.table-wide, \.table-wrap\.reports-table table\.table-wide \{ min-width: 0; \}/);
});
