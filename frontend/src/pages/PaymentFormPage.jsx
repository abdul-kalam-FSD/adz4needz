import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { validatePayment } from '../lib/validate-payment.js';
import { todayValue, displayMoney } from '../lib/format.js';

const ORDER = ['leadId', 'courseOrInternship', 'amountCommitted', 'commitmentDate'];
const id = (key) => 'pm-' + key;

// Creates or edits a payment COMMITMENT. Money received is recorded afterwards as instalments on the payment page.
export default function PaymentFormPage() {
  const { id: paymentId } = useParams();
  const [params] = useSearchParams();
  const editing = Boolean(paymentId);
  const leadParam = params.get('leadId');
  const navigate = useNavigate();
  const today = useMemo(todayValue, []);
  const [values, setValues] = useState({ courseOrInternship: '', amountCommitted: '', commitmentDate: today });
  const [lead, setLead] = useState(null);
  const [paid, setPaid] = useState(null); // amount already received (edit mode)
  const [load, setLoad] = useState({ state: 'loading', message: '', code: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (editing) {
          const { payment } = await api.getPayment(paymentId);
          if (!active) return;
          setLead({ id: payment.lead.id, candidateName: payment.lead.candidateName, courseOrInternship: payment.lead.courseOrInternship });
          setValues({ courseOrInternship: payment.courseOrInternship, amountCommitted: payment.amountCommitted, commitmentDate: payment.commitmentDate });
          setPaid(payment.amountPaid);
        } else if (leadParam) {
          const { lead: l } = await api.getLead(leadParam); // missing / invalid / someone else's lead -> error below
          if (!active) return;
          setLead({ id: l.id, candidateName: l.candidateName, courseOrInternship: l.courseOrInternship });
          setValues((v) => ({ ...v, courseOrInternship: l.courseOrInternship }));
        }
        if (active) setLoad({ state: 'ready', message: '', code: '' });
      } catch (err) {
        if (active) setLoad({ state: 'error', message: err.message, code: err.code });
      }
    })();
    return () => { active = false; };
  }, [editing, paymentId, leadParam]);

  const set = (key) => (e) => { setValues((s) => ({ ...s, [key]: e.target.value })); setErrors((er) => ({ ...er, [key]: undefined })); };
  function showErrors(map) {
    setErrors(map);
    const first = ORDER.find((k) => map[k]);
    if (first) document.getElementById(id(first))?.focus();
  }
  async function runSearch(e) {
    e.preventDefault();
    setSearching(true); setFormError('');
    try {
      const qs = new URLSearchParams({ q: search.trim(), today, page: '1', pageSize: '20' }).toString();
      setResults((await api.listLeads(qs)).leads);
    } catch (err) { setFormError(err.message); } finally { setSearching(false); }
  }
  function chooseLead(e) {
    const found = (results || []).find((l) => String(l.id) === e.target.value);
    setLead(found ? { id: found.id, candidateName: found.candidateName, courseOrInternship: found.courseOrInternship } : null);
    if (found) setValues((v) => ({ ...v, courseOrInternship: v.courseOrInternship || found.courseOrInternship }));
    setErrors((er) => ({ ...er, leadId: undefined }));
  }

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    setFormError(''); setErrors({});
    const payload = { courseOrInternship: values.courseOrInternship, amountCommitted: values.amountCommitted, commitmentDate: values.commitmentDate };
    if (!editing) payload.leadId = lead ? lead.id : '';
    const check = validatePayment(payload, { forCreate: !editing });
    if (!check.ok) { showErrors(check.errors); return; }
    setSaving(true);
    try {
      if (editing) { await api.updatePayment(paymentId, payload); navigate('/payments/' + paymentId, { state: { saved: 'Payment updated.' } }); }
      else { const { payment } = await api.createPayment(payload); navigate('/payments/' + payment.id, { state: { saved: 'Payment recorded. Add the amounts you receive as instalments.' } }); }
    } catch (err) {
      setSaving(false);
      if (err.fields && Object.keys(err.fields).length) showErrors(err.fields);
      setFormError(err.message);
    }
  }

  const back = <p><Link to={editing ? '/payments/' + paymentId : '/payments'}>Back to {editing ? 'payment' : 'payments'}</Link></p>;
  if (load.state === 'loading') return <>{back}<p className="state-message">Loading…</p></>;
  if (load.state === 'error') {
    const what = editing ? 'Payment' : 'Lead';
    return <>{back}<div className="alert alert-error" role="alert"><strong>{load.code === 'NOT_FOUND' ? `${what} not found.` : 'Could not load the form.'}</strong> {load.message}</div></>;
  }

  const errorList = ORDER.filter((k) => errors[k]);
  const common = (key) => ({ id: id(key), 'aria-invalid': errors[key] ? 'true' : undefined, 'aria-describedby': id(key) + '-error' });
  const err = (key) => errors[key] && <p className="field-error" id={id(key) + '-error'}>{errors[key]}</p>;

  return (
    <>
      {back}
      <h1>{editing ? 'Edit payment' : 'Add payment'}</h1>
      <form className="report-form" onSubmit={submit} noValidate aria-busy={saving}>
        {errorList.length > 0 && (
          <div className="alert alert-error" role="alert">
            <p className="alert-title">{errorList.length === 1 ? 'Fix 1 field before saving:' : `Fix ${errorList.length} fields before saving:`}</p>
            <ul>{errorList.map((k) => <li key={k}>{errors[k]}</li>)}</ul>
          </div>
        )}

        {lead && (editing || leadParam) ? (
          <div className="lead-box"><p><strong>{lead.candidateName}</strong> · {lead.courseOrInternship}</p></div>
        ) : (
          <div className="field">
            <label htmlFor="pm-search">Find the candidate (one of your leads)</label>
            <div className="actions">
              <input id="pm-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, email or course" maxLength={100} />
              <button type="button" className="btn btn-secondary" onClick={runSearch} disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
            </div>
            {results && results.length === 0 && <p className="hint-inline">No matching leads. Add the lead first on the Leads page.</p>}
            {results && results.length > 0 && (
              <select {...common('leadId')} value={lead ? String(lead.id) : ''} onChange={chooseLead} aria-label="Choose a lead">
                <option value="">Choose a lead</option>
                {results.map((l) => <option key={l.id} value={l.id}>{l.candidateName} · {l.courseOrInternship}</option>)}
              </select>
            )}
            {lead && <p className="hint-inline">Selected: {lead.candidateName}</p>}
            {!results && !errors.leadId && <p className="hint-inline">Search, then choose the lead. Or start from the Leads page.</p>}
            {err('leadId')}
          </div>
        )}

        <div className="field">
          <label htmlFor={id('courseOrInternship')}>Course or internship</label>
          <input type="text" {...common('courseOrInternship')} value={values.courseOrInternship} onChange={set('courseOrInternship')} maxLength={150} />
          {err('courseOrInternship')}
        </div>
        <div className="field">
          <label htmlFor={id('amountCommitted')}>Committed amount</label>
          <input type="text" inputMode="decimal" autoComplete="off" {...common('amountCommitted')} value={values.amountCommitted} onChange={set('amountCommitted')} placeholder="e.g. 15000 or 15000.50" />
          {editing && paid !== null && <p className="hint-inline">Already received: {displayMoney(paid)}. The commitment cannot be set below this.</p>}
          {err('amountCommitted')}
        </div>
        <div className="field">
          <label htmlFor={id('commitmentDate')}>Date the candidate committed</label>
          <input type="date" {...common('commitmentDate')} value={values.commitmentDate} onChange={set('commitmentDate')} />
          {err('commitmentDate')}
        </div>

        {formError && <div className="alert alert-error" role="alert"><strong>Payment not saved.</strong> {formError}</div>}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add payment'}</button>
          <Link className="btn btn-secondary btn-as-link" to={editing ? '/payments/' + paymentId : '/payments'}>Cancel</Link>
        </div>
      </form>
    </>
  );
}
