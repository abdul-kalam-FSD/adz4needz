import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, uploadReceipt, receiptUrl } from '../api/client.js';
import PageHeader from './PageHeader.jsx';
import { validateInstalment } from '../lib/validate-payment.js';
import { todayValue, formatDate, displayMoney } from '../lib/format.js';
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_BADGE, MAX_RECEIPT_TYPES_TEXT, reviewLabel, reviewBadge, checkReviewNote } from '../lib/payment-labels.js';

const sizeText = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const typeText = (mime) => ({ 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'application/pdf': 'PDF' }[mime] || mime);

// Quick checks before sending; the server repeats them and also checks the real file content.
function checkFile(file, rules) {
  if (!file) return 'Choose a file first.';
  if (!rules.allowedTypes.includes(file.type)) return `Only ${MAX_RECEIPT_TYPES_TEXT} files are accepted.`;
  if (file.size === 0) return 'The file is empty.';
  if (file.size > rules.maxBytes) return `The file is larger than the limit of ${sizeText(rules.maxBytes)}.`;
  return '';
}

// Review state of one proof, visible to both roles. Only an admin gets the Approve / Reject controls.
function ReceiptReview({ receipt, admin, onChanged }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(decision) {
    const problem = checkReviewNote(decision, note);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      await api.adminReviewReceipt(receipt.id, { decision, note: note.trim() });
      setRejecting(false); setNote('');
      await onChanged(decision === 'approved' ? 'Proof approved.' : 'Proof rejected.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const by = receipt.reviewedBy ? ` by ${receipt.reviewedBy.name} (${receipt.reviewedBy.employeeId})` : '';
  return (
    <div className="proof-review">
      <div className="proof-review-status">
        <span className="proof-review-label">Proof review</span>
        <span className={'badge ' + reviewBadge(receipt.reviewStatus)}>{reviewLabel(receipt.reviewStatus)}</span>
        {receipt.reviewStatus !== 'pending' && <span className="muted">{by}</span>}
      </div>
      {receipt.reviewNote && <p className="muted proof-note">Note: {receipt.reviewNote}</p>}
      {receipt.reviewStatus === 'rejected' && !admin && <p className="muted proof-note">Please upload a corrected proof.</p>}
      {admin && (
        <div className="proof-actions">
          {!rejecting ? (
            <>
              {receipt.reviewStatus !== 'approved' && <button type="button" className="btn btn-secondary" onClick={() => decide('approved')} disabled={busy}>Approve</button>}
              {receipt.reviewStatus !== 'rejected' && <button type="button" className="btn btn-secondary" onClick={() => { setRejecting(true); setError(''); }} disabled={busy}>Reject…</button>}
            </>
          ) : (
            <div className="field proof-reject">
              <label htmlFor={'rev-' + receipt.id}>Reason for rejecting (shown to the BDE)</label>
              <input id={'rev-' + receipt.id} type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="proof-actions">
                <button type="button" className="btn btn-primary" onClick={() => decide('rejected')} disabled={busy}>{busy ? 'Saving…' : 'Confirm rejection'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => { setRejecting(false); setNote(''); setError(''); }} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

function InstalmentRow({ inst, admin, rules, onChanged }) {
  const today = useMemo(todayValue, []);
  const [editing, setEditing] = useState(false);
  const [vals, setVals] = useState({ amount: inst.amount, paidOn: inst.paidOn });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [dup, setDup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dupFile, setDupFile] = useState('');

  async function save(confirmDuplicate = false) {
    setMessage(''); setErrors({}); setDup(false);
    const payload = { amount: vals.amount, paidOn: vals.paidOn, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) };
    const check = validateInstalment(payload);
    if (!check.ok) { setErrors(check.errors); return; }
    setSaving(true);
    try { await api.updateInstalment(inst.id, payload); setEditing(false); await onChanged('Instalment updated.'); }
    catch (err) {
      if (err.code === 'POSSIBLE_DUPLICATE_INSTALMENT') { setDup(true); setMessage(err.message); }
      else { setErrors(err.fields || {}); setMessage(err.message); }
    } finally { setSaving(false); }
  }

  async function send(confirmDuplicate = false) {
    setUploadError(''); setDupFile('');
    const problem = checkFile(file, rules);
    if (problem) { setUploadError(problem); return; }
    setUploading(true);
    try { await uploadReceipt(inst.id, file, { confirmDuplicate }); setFile(null); setFileKey((k) => k + 1); await onChanged('Proof uploaded.'); }
    catch (err) {
      if (err.code === 'POSSIBLE_DUPLICATE_RECEIPT') setDupFile(err.message); else setUploadError(err.message);
    } finally { setUploading(false); }
  }

  const fid = 'inst-' + inst.id;
  return (
    <tr>
      <td>
        {editing ? (
          <div className="field">
            <label htmlFor={fid + '-date'} className="sr-only">Payment date</label>
            <input id={fid + '-date'} type="date" value={vals.paidOn} onChange={(e) => setVals((v) => ({ ...v, paidOn: e.target.value }))} aria-invalid={errors.paidOn ? 'true' : undefined} />
            {errors.paidOn && <p className="field-error">{errors.paidOn}</p>}
          </div>
        ) : formatDate(inst.paidOn)}
      </td>
      <td className="num">
        {editing ? (
          <div className="field">
            <label htmlFor={fid + '-amount'} className="sr-only">Amount received</label>
            <input id={fid + '-amount'} type="text" inputMode="decimal" value={vals.amount} onChange={(e) => setVals((v) => ({ ...v, amount: e.target.value }))} aria-invalid={errors.amount ? 'true' : undefined} />
            {errors.amount && <p className="field-error">{errors.amount}</p>}
          </div>
        ) : displayMoney(inst.amount)}
      </td>
      <td className="proof-cell">
        {inst.receipts.length === 0 && <span className="muted">No proof yet</span>}
        {inst.receipts.length > 0 && (
          <ul className="receipt-list">
            {inst.receipts.map((r) => (
              <li key={r.id} className="proof-item">
                <div className="proof-file">
                  <a href={receiptUrl(r.id, admin)} target="_blank" rel="noopener noreferrer">{r.originalName}</a>{' '}
                  <span className="muted">({typeText(r.mimeType)}, {sizeText(r.sizeBytes)})</span>
                </div>
                <ReceiptReview receipt={r} admin={admin} onChanged={onChanged} />
              </li>
            ))}
          </ul>
        )}
        {!admin && !editing && inst.receipts.length < rules.maxPerInstalment && (
          <div className="field proof-upload">
            <label htmlFor={fid + '-file'}>Upload proof</label>
            <p className="hint-inline" id={fid + '-file-hint'}>{MAX_RECEIPT_TYPES_TEXT}, up to {sizeText(rules.maxBytes)}</p>
            <div className="proof-upload-row">
              <input key={fileKey} id={fid + '-file'} type="file" accept={rules.allowedTypes.join(',')} aria-describedby={fid + '-file-hint'} onChange={(e) => { setFile(e.target.files[0] || null); setUploadError(''); setDupFile(''); }} />
              <button type="button" className="btn btn-secondary" onClick={() => send(false)} disabled={uploading || !file}>{uploading ? 'Uploading…' : 'Upload proof'}</button>
            </div>
            {uploadError && <p className="field-error" role="alert">{uploadError}</p>}
            {dupFile && (
              <div className="alert alert-warning" role="alert">
                <p>{dupFile}</p>
                <button type="button" className="btn btn-secondary" onClick={() => send(true)} disabled={uploading}>Attach anyway</button>
              </div>
            )}
          </div>
        )}
      </td>
      {!admin && (
        <td>
          {editing ? (
            <>
              <button type="button" className="btn btn-primary" onClick={() => save(false)} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>{' '}
              <button type="button" className="btn btn-secondary" onClick={() => { setEditing(false); setErrors({}); setMessage(''); setDup(false); setVals({ amount: inst.amount, paidOn: inst.paidOn }); }}>Cancel</button>
              {message && !dup && <p className="field-error" role="alert">{message}</p>}
              {dup && (
                <div className="alert alert-warning" role="alert">
                  <p>{message}</p>
                  <button type="button" className="btn btn-secondary" onClick={() => save(true)} disabled={saving}>Save anyway</button>
                </div>
              )}
            </>
          ) : <button type="button" className="btn-link" onClick={() => setEditing(true)}>Edit</button>}
        </td>
      )}
    </tr>
  );
}

// mode "bde": the BDE's own payment (can edit, add instalments, attach proof). mode "admin": amounts read-only; the admin can view each proof and approve or reject it.
export default function PaymentDetailView({ mode }) {
  const admin = mode === 'admin';
  const { id } = useParams();
  const location = useLocation();
  const today = useMemo(todayValue, []);
  const [state, setState] = useState({ status: 'loading', payment: null, message: '', code: '' });
  const [flash, setFlash] = useState((location.state && location.state.saved) || '');
  const [form, setForm] = useState({ amount: '', paidOn: today });
  const [errors, setErrors] = useState({});
  const [formMessage, setFormMessage] = useState('');
  const [dup, setDup] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { payment } = await (admin ? api.adminGetPayment(id) : api.getPayment(id));
      setState({ status: 'ready', payment, message: '', code: '' });
    } catch (err) { setState({ status: 'error', payment: null, message: err.message, code: err.code }); }
  }, [admin, id]);
  useEffect(() => { load(); }, [load]);

  async function changed(message) { setFlash(message); await load(); }

  async function addInstalment(confirmDuplicate = false) {
    setErrors({}); setFormMessage(''); setDup(false);
    const payload = { amount: form.amount, paidOn: form.paidOn, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) };
    const check = validateInstalment(payload);
    if (!check.ok) { setErrors(check.errors); return; }
    setSaving(true);
    try {
      await api.addInstalment(id, payload);
      setForm({ amount: '', paidOn: today });
      await changed('Instalment recorded.');
    } catch (err) {
      if (err.code === 'POSSIBLE_DUPLICATE_INSTALMENT') { setDup(true); setFormMessage(err.message); }
      else { setErrors(err.fields || {}); setFormMessage(err.message); }
    } finally { setSaving(false); }
  }

  const listPath = admin ? '/admin/payments' : '/payments';
  const back = <p><Link to={listPath}>Back to payments</Link></p>;
  if (state.status === 'loading') return <>{back}<p className="state-message" role="status">Loading…</p></>;
  if (state.status === 'error') return <>{back}<div className="alert alert-error" role="alert"><strong>{state.code === 'NOT_FOUND' ? 'Payment not found.' : 'Could not load this payment.'}</strong> {state.message} <button type="button" className="btn btn-secondary" onClick={load}>Retry</button></div></>;

  const p = state.payment;
  const outstandingZero = p.amountOutstanding === '0.00';
  return (
    <>
      {back}
      <PageHeader title={p.lead.candidateName} actions={!admin ? <Link className="btn btn-secondary btn-as-link" to={`/payments/${p.id}/edit`}>Edit payment</Link> : null} />
      {flash && <div className="alert alert-success" role="status"><strong>{flash}</strong> <button type="button" className="btn-link" onClick={() => setFlash('')}>Dismiss</button></div>}

      <div className="card detail-summary">
        <dl className="detail-facts">
          <div><dt>Payment status</dt><dd><span className={'badge ' + PAYMENT_STATUS_BADGE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</span></dd></div>
          <div><dt>Course / internship</dt><dd>{p.courseOrInternship}</dd></div>
          <div><dt>Committed on</dt><dd>{formatDate(p.commitmentDate)}</dd></div>
          {(p.lead.phone || p.lead.email) && <div><dt>Contact</dt><dd>{[p.lead.phone, p.lead.email].filter(Boolean).join(' · ')}</dd></div>}
          {admin && <div><dt>Responsible BDE</dt><dd>{p.bde.name} <span className="muted">({p.bde.employeeId})</span></dd></div>}
        </dl>
        <div className="pay-summary">
          <div className="total-card"><span className="n">{displayMoney(p.amountCommitted)}</span><span className="l">Committed</span></div>
          <div className="total-card"><span className="n">{displayMoney(p.amountPaid)}</span><span className="l">Received</span></div>
          <div className="total-card"><span className="n">{displayMoney(p.amountOutstanding)}</span><span className="l">Outstanding</span></div>
        </div>
      </div>

      <div className="card">
        <h2>Instalments received</h2>
        <p className="hint">Proof review does not change the amounts received or the payment status.</p>
        {p.instalments.length === 0 ? <p className="state-message">Nothing received yet.</p> : (
          <div className="table-wrap instalments-table">
            <table>
              <thead><tr><th>Payment date</th><th className="num">Amount</th><th>Proof and review</th>{!admin && <th><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {p.instalments.map((i) => <InstalmentRow key={i.id + ':' + i.amount + ':' + i.paidOn + ':' + i.receipts.length + ':' + i.receipts.map((r) => r.reviewStatus).join('')} inst={i} admin={admin} rules={p.receiptRules} onChanged={changed} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!admin && !outstandingZero && (
        <div className="card">
          <h2>Record an instalment</h2>
          <p className="hint">Enter each amount you actually received. It cannot exceed the outstanding {displayMoney(p.amountOutstanding)}.</p>
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (!saving) addInstalment(false); }} noValidate>
            <div className="field">
              <label htmlFor="new-amount">Amount received</label>
              <input id="new-amount" type="text" inputMode="decimal" autoComplete="off" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} aria-invalid={errors.amount ? 'true' : undefined} aria-describedby="new-amount-error" />
              {errors.amount && <p className="field-error" id="new-amount-error">{errors.amount}</p>}
            </div>
            <div className="field">
              <label htmlFor="new-date">Payment date</label>
              <input id="new-date" type="date" value={form.paidOn} onChange={(e) => setForm((f) => ({ ...f, paidOn: e.target.value }))} aria-invalid={errors.paidOn ? 'true' : undefined} aria-describedby="new-date-error" />
              {errors.paidOn && <p className="field-error" id="new-date-error">{errors.paidOn}</p>}
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add instalment'}</button>
          </form>
          {formMessage && !dup && !errors.amount && !errors.paidOn && <p className="field-error" role="alert">{formMessage}</p>}
          {dup && (
            <div className="alert alert-warning" role="alert">
              <p>{formMessage}</p>
              <button type="button" className="btn btn-secondary" onClick={() => addInstalment(true)} disabled={saving}>Save anyway</button>
            </div>
          )}
        </div>
      )}
      {!admin && outstandingZero && <p className="hint">This payment is fully received.</p>}
    </>
  );
}
