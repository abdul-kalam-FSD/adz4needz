import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { validateLead } from '../lib/validate-lead.js';
import { formatDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';

const EMPTY = { candidateName: '', phone: '', email: '', courseOrInternship: '', leadStatusId: '', followUpDate: '', nextAction: '' };
const ORDER = ['candidateName', 'phone', 'email', 'courseOrInternship', 'leadStatusId', 'followUpDate', 'nextAction'];
const id = (key) => 'lead-' + key;

export default function LeadFormPage() {
  const { id: leadId } = useParams();
  const editing = Boolean(leadId);
  const navigate = useNavigate();
  const [values, setValues] = useState(EMPTY);
  const [statuses, setStatuses] = useState([]);
  const [load, setLoad] = useState({ state: 'loading', message: '', code: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [dup, setDup] = useState(null); // possible-duplicate warning from the server
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const st = (await api.leadStatuses()).statuses;
        let list = st;
        if (editing) {
          const { lead } = await api.getLead(leadId);
          if (!active) return;
          if (!st.some((s) => s.id === lead.status.id)) list = [...st, { id: lead.status.id, name: lead.status.name }]; // keep a retired status visible
          setValues({
            candidateName: lead.candidateName, phone: lead.phone || '', email: lead.email || '', courseOrInternship: lead.courseOrInternship,
            leadStatusId: String(lead.status.id), followUpDate: lead.followUpDate || '', nextAction: lead.nextAction || ''
          });
        }
        if (active) { setStatuses(list); setLoad({ state: 'ready', message: '', code: '' }); }
      } catch (err) {
        if (active) setLoad({ state: 'error', message: err.message, code: err.code });
      }
    })();
    return () => { active = false; };
  }, [editing, leadId]);

  const set = (key) => (e) => { setValues((v) => ({ ...v, [key]: e.target.value })); setErrors((er) => ({ ...er, [key]: undefined })); };

  function showErrors(map) {
    setErrors(map);
    const first = ORDER.find((k) => map[k]);
    if (first) document.getElementById(id(first))?.focus();
  }

  async function submit(confirmDuplicate) {
    if (saving) return;
    setFormError(''); setErrors({});
    const check = validateLead({ ...values, confirmDuplicate });
    if (!check.ok) { showErrors(check.errors); return; }
    const payload = {
      candidateName: values.candidateName, phone: values.phone, email: values.email, courseOrInternship: values.courseOrInternship,
      leadStatusId: Number(values.leadStatusId), followUpDate: values.followUpDate, nextAction: values.nextAction, confirmDuplicate
    };
    setSaving(true);
    try {
      if (editing) await api.updateLead(leadId, payload); else await api.createLead(payload);
      navigate('/leads', { state: { saved: editing ? 'Lead updated.' : 'Lead added.' } });
    } catch (err) {
      setSaving(false);
      if (err.code === 'POSSIBLE_DUPLICATE' && err.details) { setDup(err.details); return; }
      if (err.fields && Object.keys(err.fields).length) showErrors(err.fields);
      setFormError(err.message); // values stay in the form
    }
  }

  const back = <p><Link to="/leads">Back to leads</Link></p>;
  if (load.state === 'loading') return <>{back}<p className="state-message">Loading…</p></>;
  if (load.state === 'error') {
    return <>{back}<div className="alert alert-error" role="alert"><strong>{load.code === 'NOT_FOUND' ? 'Lead not found.' : 'Could not load the form.'}</strong> {load.message}</div></>;
  }

  const errorList = ORDER.filter((k) => errors[k]);
  const field = (key, label, input, hint) => (
    <div className="field">
      <label htmlFor={id(key)}>{label}</label>
      {input}
      {hint && <p className="hint-inline">{hint}</p>}
      {errors[key] && <p className="field-error" id={id(key) + '-error'}>{errors[key]}</p>}
    </div>
  );
  const common = (key) => ({ id: id(key), value: values[key], onChange: set(key), 'aria-invalid': errors[key] ? 'true' : undefined, 'aria-describedby': id(key) + '-error' });

  return (
    <>
      {back}
      <PageHeader title={editing ? 'Edit lead' : 'Add lead'} />
      <form className="report-form" onSubmit={(e) => { e.preventDefault(); submit(false); }} noValidate aria-busy={saving}>
        {errorList.length > 0 && (
          <div className="alert alert-error" role="alert">
            <p className="alert-title">{errorList.length === 1 ? 'Fix 1 field before saving:' : `Fix ${errorList.length} fields before saving:`}</p>
            <ul>{errorList.map((k) => <li key={k}>{errors[k]}</li>)}</ul>
          </div>
        )}

        {dup && (
          <div className="alert alert-warning" role="alert">
            <p className="alert-title">Possible duplicate found. Nothing has been merged.</p>
            {dup.own.length > 0 && (
              <ul>
                {dup.own.map((d) => (
                  <li key={d.id}>
                    {d.candidateName} ({[d.phone, d.email].filter(Boolean).join(', ')}) · {d.courseOrInternship} · {d.statusName}
                    {d.followUpDate ? ` · follow-up ${formatDate(d.followUpDate)}` : ''} · <Link to={`/leads/${d.id}/edit`}>Open</Link>
                  </li>
                ))}
              </ul>
            )}
            {dup.otherBdeMatches > 0 && <p>{dup.otherBdeMatches} lead{dup.otherBdeMatches === 1 ? '' : 's'} with the same phone or email belong{dup.otherBdeMatches === 1 ? 's' : ''} to another BDE.</p>}
            <p>If this is a different candidate, you can save it anyway.</p>
            <div className="actions">
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => submit(true)}>{saving ? 'Saving…' : editing ? 'Save changes anyway' : 'Save as a new lead anyway'}</button>
              <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setDup(null)}>Go back and edit</button>
            </div>
          </div>
        )}

        <p className="hint" id="lead-form-hint">Fields marked (optional) can be left empty. All other fields are required.</p>
        {field('candidateName', 'Candidate name', <input type="text" autoComplete="off" maxLength={120} {...common('candidateName')} />)}
        {field('phone', 'Phone', <input type="tel" autoComplete="off" {...common('phone')} />, 'Needed if you do not enter an email. Enter at least one of the two.')}
        {field('email', 'Email', <input type="email" autoComplete="off" {...common('email')} />, 'Needed if you do not enter a phone number.')}
        {field('courseOrInternship', 'Course or internship interested in', <input type="text" autoComplete="off" maxLength={150} {...common('courseOrInternship')} />)}
        {field('leadStatusId', 'Lead status',
          <select {...common('leadStatusId')}>
            <option value="">Choose a status</option>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>,
          statuses.length === 0 ? 'No lead statuses are set up yet. Ask your admin.' : undefined)}
        {field('followUpDate', 'Follow-up date (optional)', <input type="date" {...common('followUpDate')} />)}
        {field('nextAction', 'Next action (optional)', <textarea rows={3} maxLength={500} {...common('nextAction')} />)}

        {formError && !dup && <div className="alert alert-error" role="alert"><strong>Lead not saved.</strong> {formError}</div>}

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save lead'}</button>
          <Link className="btn btn-secondary btn-as-link" to="/leads">Cancel</Link>
        </div>
      </form>
    </>
  );
}
