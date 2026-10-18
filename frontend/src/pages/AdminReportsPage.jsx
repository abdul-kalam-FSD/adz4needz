import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, monthlyExportUrl } from '../api/client.js';
import MonthPicker from '../components/MonthPicker.jsx';
import { FigureCards, TargetTable } from '../components/MonthlyFigures.jsx';
import { currentMonth, formatAmount, targetInput } from '../lib/report-format.js';
import RangeReport from '../components/RangeReport.jsx';

const errorText = (err) => {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  const f = Object.values(err.fields || {}).filter(Boolean);
  return f.length ? `${err.message} ${f.join(' ')}` : err.message;
};

function MonthlyView() {
  const [month, setMonth] = useState(currentMonth());
  const [state, setState] = useState({ loading: true, error: '', report: null });
  const [editing, setEditing] = useState(null); // BDE row being edited
  const [form, setForm] = useState({ calls: '', interested: '', interviews: '', revenue: '' });
  const [formErrors, setFormErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await api.adminMonthlyReport(month);
      setState({ loading: false, error: '', report: data.report });
    } catch (err) {
      setState({ loading: false, error: errorText(err), report: null });
    }
  }, [month]);
  useEffect(() => { load(); setEditing(null); setSaved(''); }, [load]);

  function startEdit(b) {
    setEditing(b); setSaveError(''); setFormErrors({}); setSaved('');
    setForm({ calls: b.targets.calls ?? '', interested: b.targets.interested ?? '', interviews: b.targets.interviews ?? '', revenue: b.targets.revenue ?? '' });
  }

  async function handleSave(e) {
    e.preventDefault();
    if (saving || !editing) return;
    const parsed = { calls: targetInput(form.calls, 'count'), interested: targetInput(form.interested, 'count'), interviews: targetInput(form.interviews, 'count'), revenue: targetInput(form.revenue, 'money') };
    const errs = {};
    for (const [k, v] of Object.entries(parsed)) if (v.error) errs[k] = v.error;
    setFormErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true); setSaveError('');
    try {
      await api.adminSetTargets({ month, bdeId: editing.id, targetCalls: parsed.calls.value, targetInterested: parsed.interested.value, targetInterviews: parsed.interviews.value, targetRevenue: parsed.revenue.value });
      setSaved(`Targets saved for ${editing.name}.`);
      setEditing(null);
      await load();
    } catch (err) {
      setSaveError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  const r = state.report;
  const field = (key, label, hint) => (
    <div className="field" key={key}>
      <label htmlFor={'t-' + key}>{label}</label>
      <input id={'t-' + key} type="text" inputMode="decimal" value={form[key]} aria-invalid={formErrors[key] ? 'true' : undefined} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      {hint && <span className="hint">{hint}</span>}
      {formErrors[key] && <span className="field-error">{formErrors[key]}</span>}
    </div>
  );

  return (
    <>
      <h1>Monthly Report</h1>
      <p className="hint">Figures come from the database. Calls come from the Call desk and from manual daily reports, one source per BDE per day (a day with Call desk calls ignores that day's manual report). Interested = interested leads; conversion = interested leads ÷ calls. Percentages marked "achieved" are calculated as actual ÷ target. Leave a target blank for no target.</p>
      <MonthPicker month={month} onChange={setMonth} disabled={state.loading} />
      <p>
        <a className="btn btn-secondary" href={monthlyExportUrl(month, 'xlsx')}>Download Excel</a>{' '}
        <a className="btn btn-secondary" href={monthlyExportUrl(month, 'pdf')}>Download PDF</a>
      </p>
      {state.error && <div className="alert alert-error" role="alert"><p>{state.error}</p><button type="button" className="btn btn-secondary" onClick={load}>Try again</button></div>}
      {state.loading && <p role="status">Loading the report…</p>}
      {saved && <div className="alert alert-success" role="status"><p>{saved}</p></div>}
      {r && !state.loading && (
        <>
          <h2>{r.label}: whole team</h2>
          {r.bdes.length === 0 ? <p>No BDEs or activity found for this month.</p> : <FigureCards block={r.total} />}
          {r.bdes.length > 0 && (
            <>
              <h2>Targets and achievement</h2>
              {r.total.bdesWithTargets === 0 && <p className="hint">No targets are set for this month yet. Use "Set targets" on a BDE row.</p>}
              <TargetTable rows={r.bdes} renderAction={(b) => <button type="button" className="btn btn-secondary" onClick={() => startEdit(b)}>Set targets</button>} />
              <p className="hint">Team target is the sum of the targets that were set ({r.total.bdesWithTargets} of {r.bdes.length} BDEs). Team revenue received: {formatAmount(r.total.figures.revenueReceived)}.</p>
            </>
          )}
          {editing && (
            <form onSubmit={handleSave} noValidate aria-label={`Targets for ${editing.name}`}>
              <h3>Targets for {editing.name} — {r.label}</h3>
              <div className="toolbar">
                {field('calls', 'Calls target (optional)')}
                {field('interested', 'Interested target (optional)')}
                {field('interviews', 'Interviews scheduled target (optional)')}
                {field('revenue', 'Revenue received target (optional)', 'Amount, for example 50000')}
              </div>
              {saveError && <div className="alert alert-error" role="alert"><p>{saveError}</p></div>}
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save targets'}</button>{' '}
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
            </form>
          )}
          {r.bdes.length > 0 && (
            <>
              <h2>Per BDE figures</h2>
              {r.bdes.map((b) => (
                <section key={b.id} aria-label={b.name}>
                  <h3>{b.name} ({b.employeeId})</h3>
                  <FigureCards block={b} />
                </section>
              ))}
            </>
          )}
        </>
      )}
    </>
  );
}

export default function AdminReportsPage() {
  // 'monthly' keeps the full monthly report with targets exactly as before; the other choices show a date-range report.
  const [kind, setKind] = useState('monthly');
  return (
    <>
      <div className="toolbar" role="group" aria-label="Report type">
        <button type="button" className={'btn ' + (kind === 'monthly' ? 'btn-primary' : 'btn-secondary')} aria-pressed={kind === 'monthly'} onClick={() => setKind('monthly')}>Monthly with targets</button>
        <button type="button" className={'btn ' + (kind !== 'monthly' ? 'btn-primary' : 'btn-secondary')} aria-pressed={kind !== 'monthly'} onClick={() => setKind(kind === 'monthly' ? 'day' : kind)}>Day / Week / Custom</button>
      </div>
      {kind === 'monthly' ? <MonthlyView /> : (<><h1>Report</h1><RangeReport kind={kind} onKind={setKind} /></>)}
    </>
  );
}
