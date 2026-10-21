// Phase 3C (Payments and Interviews UI): structure-level checks on the real source files.
// SCOPE AND LIMITS: like the other files in this folder these tests read the .jsx/.css text. They do NOT render the pages, click anything or
// measure layout. They pin what must stay the same (ids, filter names, role gating, labels, API calls) and what the redesign added.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const css = rd('styles/styles.css');
const payList = rd('components/PaymentsListView.jsx');
const payDetail = rd('components/PaymentDetailView.jsx');
const intList = rd('components/InterviewsListView.jsx');
const sectionAt = css.indexOf('Payments and Interviews (v2)');
const section = css.slice(css.lastIndexOf('/*', sectionAt));   // from the opening of the section's header comment to the end of the file
const rule = (sel) => { const m = css.match(new RegExp('(?:^|\\n)' + sel.replace(/[.[\]()]/g, '\\$&') + ' \\{([^}]*)\\}')); return m ? m[1] : ''; };

test('all Payments and Interviews pages use the shared PageHeader, with the same titles and primary actions', () => {
  for (const [file, title, to] of [
    ['pages/PaymentsPage.jsx', 'My Payments', '/payments/new'],
    ['pages/InterviewsPage.jsx', 'My Interviews', '/interviews/new'],
    ['pages/AdminPaymentsPage.jsx', 'All Payments', null],
    ['pages/AdminInterviewsPage.jsx', 'All Interviews', null]
  ]) {
    const src = rd(file);
    assert.ok(src.includes('<PageHeader') && src.includes(`title="${title}"`), file);
    assert.ok(!/className="page-head"/.test(src) && !/<h1>/.test(src), file + ' has no old header');
    if (to) assert.ok(src.includes(`to="${to}"`), file + ' keeps its action');
    else assert.ok(!/<Link/.test(src), file + ' (admin) has no create action');
  }
  assert.ok(payDetail.includes('<PageHeader title={p.lead.candidateName}'));
  assert.ok(payDetail.includes('to={`/payments/${p.id}/edit`}') && /!admin \? <Link/.test(payDetail), 'Edit payment is still BDE only');
});

test('Payments list: same filter ids and parameters, three status quick filters, filters-bar layout', () => {
  for (const id of ['p-q', 'p-status', 'p-from', 'p-to', 'p-bde', 'p-proof']) assert.ok(payList.includes(`id="${id}"`), id);
  assert.match(payList, /const EMPTY = \{ q: '', status: '', commitmentFrom: '', commitmentTo: '', missingProof: '', bdeId: '' \}/);
  assert.match(payList, /className="filters filters-bar"/);
  const buttons = (payList.match(/<button[\s\S]*?<\/button>/g) || []).filter((b) => b.includes('summary-button'));
  assert.equal(buttons.length, 3);
  for (const [b, v] of buttons.map((x, i) => [x, ['pending', 'partially_paid', 'paid'][i]])) assert.ok(b.includes(`aria-pressed={applied.status === '${v}'}`) && b.includes(`quick('${v}')`), v);
  for (const call of ['api.paymentSummary(', 'api.adminListPayments(qs)', 'api.listPayments(qs)', 'api.adminListBdes()']) assert.ok(payList.includes(call), call);
});

test('Payments list: payment status and proof are separate columns with their own headings; the proof column still shows counts only', () => {
  assert.ok(payList.includes('<th>Payment status</th><th>Proof</th>'));
  assert.ok(payList.includes('PAYMENT_STATUS_BADGE[p.status]') && !/REVIEW_(BADGE|LABEL)|reviewLabel|reviewBadge/.test(payList), 'the list does not mix in proof-review state (the API does not send it)');
  assert.ok(payList.includes('receiptCount') && payList.includes('instalmentCount'));
  assert.ok(payList.includes("admin ? 'View' : 'Open'") && payList.includes('{admin && <th>BDE</th>}'));
});

test('Payment detail: proof upload is BDE only, approve/reject is admin only, every API call is unchanged', () => {
  for (const call of ['api.adminReviewReceipt(receipt.id, { decision, note: note.trim() })', 'uploadReceipt(inst.id, file, { confirmDuplicate })', 'api.addInstalment(id, payload)', 'api.updateInstalment(inst.id, payload)', 'api.adminGetPayment(id)', 'api.getPayment(id)']) assert.ok(payDetail.includes(call), call);
  assert.match(payDetail, /\{!admin && !editing && inst\.receipts\.length < rules\.maxPerInstalment && \(\s*<div className="field proof-upload">/);
  assert.match(payDetail, /\{admin && \(\s*<div className="proof-actions">/);
  assert.ok(payDetail.includes('checkReviewNote(decision, note)') && payDetail.includes("decide('approved')") && payDetail.includes("decide('rejected')"));
  assert.ok(payDetail.includes('POSSIBLE_DUPLICATE_RECEIPT') && payDetail.includes('POSSIBLE_DUPLICATE_INSTALMENT'));
});

test('Payment detail: "Payment status" and "Proof review" are labelled separately, and the page says review does not change amounts or status', () => {
  assert.ok(payDetail.includes('<dt>Payment status</dt>') && payDetail.includes('PAYMENT_STATUS_BADGE[p.status]'));
  assert.ok(payDetail.includes('className="proof-review-label">Proof review</span>') && payDetail.includes('reviewBadge(receipt.reviewStatus)'));
  assert.ok(payDetail.includes('Proof review does not change the amounts received or the payment status.'));
  assert.ok(!/outstandingZero.*approved|approved.*outstandingZero/.test(payDetail), 'approval is never used to decide anything about the amounts');
  assert.ok(payDetail.includes("const outstandingZero = p.amountOutstanding === '0.00';"), 'the "fully received" rule is still driven by the amounts');
});

test('Admin Payments page keeps the wording the Phase 1 tests pin, and states that review does not change amounts', () => {
  const src = rd('pages/AdminPaymentsPage.jsx');
  assert.ok(/approved or rejected by an admin/.test(src) && /approve or reject it/.test(src) && /proof review does not change the amounts/.test(src));
  assert.ok(src.includes('api.adminPaymentOverview(p.toString())'));
});

test('Interviews list: four filters are always visible, the other five sit under "More filters", all in one form with the same ids', () => {
  const at = intList.indexOf('<details className="filters-more"');
  const end = intList.indexOf('</details>');
  assert.ok(at > 0 && end > at);
  const before = intList.slice(intList.indexOf('<form className="filters filters-bar"'), at);
  const inside = intList.slice(at, end);
  for (const id of ['i-q', 'i-when', 'i-att', 'i-out']) assert.ok(before.includes(`'${id}'`) || before.includes(`id="${id}"`), id + ' is visible');
  for (const id of ['i-int', 'i-pay', 'i-from', 'i-to', 'i-bde']) { assert.ok(inside.includes(`'${id}'`) || inside.includes(`id="${id}"`), id + ' is under More filters'); assert.ok(!before.includes(id), id + ' is not duplicated above'); }
  assert.ok(before.includes('filter-actions') && before.includes('Apply') && before.includes('Clear filters'));
  assert.match(intList, /const EMPTY = \{ q: '', when: '', attendance: '', outcome: '', interested: '', paymentConfirmed: '', scheduledFrom: '', scheduledTo: '', bdeId: '' \}/);
  assert.ok(intList.includes("const MORE_KEYS = ['interested', 'paymentConfirmed', 'scheduledFrom', 'scheduledTo', 'bdeId']"));
  assert.ok(/setFilterError\('The "to" date must not be before the "from" date\.'\);\s*setMoreOpen\(true\);\s*return;/.test(intList), 'a date error opens the panel so it is visible');
  assert.ok(inside.includes('{admin && ('), 'the BDE filter is still admin only');
  assert.ok(inside.indexOf('i-bde') > inside.indexOf('{admin && ('));
});

test('Interviews list: three quick filters, same actions, same statuses and wording', () => {
  const buttons = (intList.match(/<button[\s\S]*?<\/button>/g) || []).filter((b) => b.includes('summary-button'));
  assert.equal(buttons.length, 3);
  for (const [b, v] of buttons.map((x, i) => [x, ['needs_update', 'today', 'upcoming'][i]])) assert.ok(b.includes(`aria-pressed={applied.when === '${v}'}`) && b.includes(`quick('${v}')`), v);
  assert.ok(intList.includes('<th>Payment</th>') && intList.includes('Confirmed</span>') && intList.includes('Not confirmed'), 'payment wording is unchanged');
  assert.ok(intList.includes('<th>Attendance</th><th>Outcome</th>') && intList.includes('<th>Interested</th>'));
  assert.ok(intList.includes('STATE_BADGE[i.state][1]') && intList.includes('formatDateTime(i.scheduledAt)'));
  assert.match(intList, /\{!admin && <td><div className="row-actions"><Link to=\{`\/interviews\/\$\{i\.id\}\/edit`\}/);
  assert.ok(!/<Link[^>]*\/interviews\/\$\{i\.id\}\/edit/.test(intList.slice(intList.indexOf('admin && <td>{i.bde'), intList.indexOf('admin && <td>{i.bde') + 120)), 'admin has no edit link');
  for (const call of ['api.adminListInterviews(qs)', 'api.listInterviews(qs)', 'api.adminInterviewSummary(today)', 'api.interviewSummary(today)']) assert.ok(intList.includes(call), call);
});

test('list states: loading is announced, errors are alerts with Retry, empty states still differ for filtered and unfiltered lists', () => {
  for (const src of [payList, intList]) {
    assert.match(src, /state-message" role="status">Loading/);
    assert.match(src, /state-message" role="alert">\{list\.message\} <button type="button" className="btn btn-secondary" onClick=\{load\}>Retry/);
    assert.ok(src.includes('filtered ?'));
  }
});

test('stylesheet: the new rules are scoped, flat and token-only; the shared rules they sit next to are untouched', () => {
  assert.ok(section.length > 500, 'the Phase 3C section exists');
  assert.ok(!/gradient|box-shadow|#[0-9a-fA-F]{3,8}\b|rgb\(/.test(section.replace(/\/\*[\s\S]*?\*\//g, '')), 'no gradients, shadows or hard-coded colours (comments excluded)');
  for (const sel of ['.pay-summary', '.detail-facts', '.filters-more', '.filters-more-grid', '.how-counted', '.cell-name', '.proof-cell', '.proof-item', '.proof-review', '.proof-upload', '.proof-actions']) assert.ok(section.includes(sel + ' ') || section.includes(sel + ','), sel);
  assert.match(rule('.filters'), /display: grid/); assert.match(rule('.filters'), /grid-template-columns: repeat\(auto-fit, minmax\(170px, 1fr\)\)/);
  assert.match(rule('.filters-bar'), /display: flex/);
  assert.match(section, /\.table-wrap\.payments-table table\.table-wide, \.table-wrap\.interviews-table table\.table-wide \{ min-width: 0; \}/);
  assert.ok(!/\.receipt-list \{[^}]*list-style/.test(css.slice(0, sectionAt)), 'the shared .receipt-list rule is unchanged');
});
