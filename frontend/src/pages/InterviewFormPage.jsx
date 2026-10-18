import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { validateInterview } from '../lib/validate-interview.js';
import { todayValue } from '../lib/format.js';
import { ATTENDANCE_LABEL, OUTCOME_LABEL } from '../lib/interview-labels.js';

const EMPTY = { scheduledAt: '', attendance: 'pending', outcome: 'pending', interested: '' };
const ORDER = ['leadId', 'scheduledAt', 'attendance', 'outcome', 'interestedInJoining'];
const id = (key) => 'iv-' + key;
const toInterestedValue = (v) => (v === true ? 'yes' : v === false ? 'no' : '');
const fromInterestedValue = (v) => (v === 'yes' ? true : v === 'no' ? false : null);

export default function InterviewFormPage() {
  const { id: interviewId } = useParams();
  const [params] = useSearchParams();
  const editing = Boolean(interviewId);
  const leadParam = params.get('leadId');
  const navigate = useNavigate();
  const today = useMemo(todayValue, []);
  const [values, setValues] = useState(EMPTY);
  const [derivedPayment, setDerivedPayment] = useState(null); // from payment records, read-only (edit mode only)
  const [lead, setLead] = useState(null);            // { id, candidateName, courseOrInternship }
  const [load, setLoad] = useState({ state: 'loading', message: '', code: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  // lead picker (only when creating without a ?leadId=)
  const [search, setSearch] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (editing) {
          const { interview } = await api.getInterview(interviewId);
          if (!active) return;
          setLead({ id: interview.lead.id, candidateName: interview.lead.candidateName, courseOrInternship: interview.lead.courseOrInternship });
          setValues({ scheduledAt: interview.scheduledAt, attendance: interview.attendance, outcome: interview.outcome, interested: toInterestedValue(interview.interestedInJoining) });
          setDerivedPayment(interview.paymentConfirmed);
        } else if (leadParam) {
          const { lead: l } = await api.getLead(leadParam); // missing / invalid / someone else's lead -> error below
          if (!active) return;
          setLead({ id: l.id, candidateName: l.candidateName, courseOrInternship: l.courseOrInternship });
        }
        if (active) setLoad({ state: 'ready', message: '', code: '' });
      } catch (err) {
        if (active) setLoad({ state: 'error', message: err.message, code: err.code });
      }
    })();
    return () => { active = false; };
  }, [editing, interviewId, leadParam]);

  const set = (key) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setValues((s) => ({ ...s, [key]: v })); setErrors((er) => ({ ...er, [key]: undefined, ...(key === 'interested' ? { interestedInJoining: undefined } : {}) })); };
  const setAttendance = (e) => {
    const attendance = e.target.value;
    // An outcome only makes sense after attendance, so leaving "Attended" clears it back to Pending.
    setValues((s) => ({ ...s, attendance, outcome: attendance === 'attended' ? s.outcome : 'pending' }));
    setErrors((er) => ({ ...er, attendance: undefined, outcome: undefined }));
  };

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
    } catch (err) { setFormError(err.message); }
    finally { setSearching(false); }
  }
  function chooseLead(e) {
    const found = (results || []).find((l) => String(l.id) === e.target.value);
    setLead(found ? { id: found.id, candidateName: found.candidateName, courseOrInternship: found.courseOrInternship } : null);
    setErrors((er) => ({ ...er, leadId: undefined }));
  }

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    setFormError(''); setErrors({});
    const payload = { scheduledAt: values.scheduledAt, attendance: values.attendance, outcome: values.outcome, interestedInJoining: fromInterestedValue(values.interested) };
    if (!editing) payload.leadId = lead ? lead.id : '';
    const check = validateInterview(payload, { forCreate: !editing });
    if (!check.ok) { showErrors(check.errors); return; }
    setSaving(true);
    try {
      if (editing) await api.updateInterview(interviewId, payload); else await api.createInterview(payload);
      navigate('/interviews', { state: { saved: editing ? 'Interview updated.' : 'Interview scheduled.' } });
    } catch (err) {
      setSaving(false);
      if (err.fields && Object.keys(err.fields).length) showErrors(err.fields);
      setFormError(err.message); // values stay in the form
    }
  }

  const back = <p><Link to="/interviews">Back to interviews</Link></p>;
  if (load.state === 'loading') return <>{back}<p className="state-message">Loading…</p></>;
  if (load.state === 'error') {
    const what = editing ? 'Interview' : 'Lead';
    return <>{back}<div className="alert alert-error" role="alert"><strong>{load.code === 'NOT_FOUND' ? `${what} not found.` : 'Could not load the form.'}</strong> {load.message}</div></>;
  }

  const errorList = ORDER.filter((k) => errors[k]);
  const common = (key, errKey = key) => ({ id: id(errKey), 'aria-invalid': errors[errKey] ? 'true' : undefined, 'aria-describedby': id(errKey) + '-error' });
  const err = (key) => errors[key] && <p className="field-error" id={id(key) + '-error'}>{errors[key]}</p>;
  const outcomeLocked = values.attendance !== 'attended';

  return (
    <>
      {back}
      <h1>{editing ? 'Edit interview' : 'Schedule interview'}</h1>
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
            <label htmlFor="iv-search">Find the candidate (one of your leads)</label>
            <div className="actions">
              <input id="iv-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, email or course" maxLength={100} />
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
          <label htmlFor={id('scheduledAt')}>Interview date and time</label>
          <input type="datetime-local" {...common('scheduledAt')} value={values.scheduledAt} onChange={set('scheduledAt')} />
          {err('scheduledAt')}
        </div>
        <div className="field">
          <label htmlFor={id('attendance')}>Attendance</label>
          <select {...common('attendance')} value={values.attendance} onChange={setAttendance}>
            {Object.entries(ATTENDANCE_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
          {err('attendance')}
        </div>
        <div className="field">
          <label htmlFor={id('outcome')}>Outcome</label>
          <select {...common('outcome')} value={values.outcome} onChange={set('outcome')} disabled={outcomeLocked}>
            {Object.entries(OUTCOME_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
          {outcomeLocked && <p className="hint-inline">Available after attendance is set to Attended.</p>}
          {err('outcome')}
        </div>
        <div className="field">
          <label htmlFor={id('interestedInJoining')}>Interested in joining</label>
          <select {...common('interestedInJoining')} value={values.interested} onChange={set('interested')}>
            <option value="">Not recorded yet</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
          {err('interestedInJoining')}
        </div>
        <div className="field">
          <span className="label-text">Payment confirmed</span>
          <p className="hint-inline">
            {derivedPayment === null && 'Taken automatically from the lead\'s payment records (not entered here).'}
            {derivedPayment === true && 'Yes: a payment record exists for this lead (taken automatically from Payments).'}
            {derivedPayment === false && 'No: there is no payment record for this lead yet.'}
            {lead && derivedPayment !== true && <> <Link to={`/payments/new?leadId=${lead.id}`}>Add a payment</Link></>}
          </p>
        </div>

        {formError && <div className="alert alert-error" role="alert"><strong>Interview not saved.</strong> {formError}</div>}

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Schedule interview'}</button>
          <Link className="btn btn-secondary btn-as-link" to="/interviews">Cancel</Link>
        </div>
      </form>
    </>
  );
}
