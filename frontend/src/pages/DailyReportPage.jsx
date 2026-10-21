import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { COUNT_FIELDS, validateDailyReport } from '../lib/validate-daily-report.js';
import PageHeader from '../components/PageHeader.jsx';

const todayValue = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};
const emptyCounts = () => Object.fromEntries(COUNT_FIELDS.map((f) => [f.key, '']));
const fmt = (text) => {
  const [y, m, d] = text.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fieldId = (key) => 'field-' + key;
const ALL = [{ key: 'reportDate', label: 'Date' }, ...COUNT_FIELDS];
// The server returns the 30 most recent reports when the screen asks without a limit (it never pages). Exactly 30 back means older ones may exist.
const LATEST_SHOWN = 30;

export default function DailyReportPage() {
  const [reportDate, setReportDate] = useState(todayValue());
  const [counts, setCounts] = useState(emptyCounts());
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null); // { type: 'success' | 'error', lead, text }
  const [saving, setSaving] = useState(false);
  const [list, setList] = useState({ state: 'loading', items: [], message: '' });

  const loadReports = useCallback(async () => {
    setList((l) => ({ ...l, state: 'loading' }));
    try {
      const data = await api.listDailyReports();
      setList({ state: 'ready', items: data.reports, message: '' });
    } catch (err) {
      setList({ state: 'error', items: [], message: err.message });
    }
  }, []);
  useEffect(() => { loadReports(); }, [loadReports]);

  function showErrors(map) {
    setErrors(map);
    const first = ALL.find((f) => map[f.key]);
    if (first) document.getElementById(fieldId(first.key))?.focus();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return; // blocks repeat submits
    setStatus(null);
    setErrors({});

    const result = validateDailyReport({ reportDate, ...counts });
    if (!result.ok) { showErrors(result.errors); return; }

    setSaving(true);
    try {
      const data = await api.createDailyReport(result.value);
      setStatus({ type: 'success', lead: 'Report saved.', text: `Your report for ${fmt(data.report.reportDate)} has been recorded.` });
      setCounts(emptyCounts());
      loadReports();
    } catch (err) {
      // Entered values stay in the form so nothing has to be typed again.
      if (err.fields && Object.keys(err.fields).length) showErrors(err.fields);
      setStatus({ type: 'error', lead: 'Report not saved.', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  const errorList = ALL.filter((f) => errors[f.key]);

  return (
    <>
      <PageHeader title="Daily Calling Report" description={<>For days you did not use the <Link to="/call-desk">Call desk</Link>.</>} />
      <details className="how-counted">
        <summary>How this is counted</summary>
        <p>If the same day also has Call desk calls, only the Call desk calls are counted (this report is kept but not added), so nothing is counted twice.</p>
      </details>
      <form className="report-form daily-form" onSubmit={handleSubmit} noValidate aria-busy={saving}>
        {errorList.length > 0 && (
          <div className="alert alert-error" role="alert" id="error-summary">
            <p className="alert-title">{errorList.length === 1 ? 'Fix 1 field before submitting:' : `Fix ${errorList.length} fields before submitting:`}</p>
            <ul>{errorList.map((f) => <li key={f.key}>{errors[f.key]}</li>)}</ul>
          </div>
        )}

        <div className="daily-grid">
          <div className="field">
            <label htmlFor={fieldId('reportDate')}>Date</label>
            <input type="date" id={fieldId('reportDate')} value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              aria-invalid={errors.reportDate ? 'true' : undefined} aria-describedby="reportDate-error" />
            {errors.reportDate && <p className="field-error" id="reportDate-error">{errors.reportDate}</p>}
          </div>

          {COUNT_FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label htmlFor={fieldId(f.key)}>{f.label}</label>
              <input type="text" inputMode="numeric" autoComplete="off" id={fieldId(f.key)} value={counts[f.key]}
                onChange={(e) => setCounts((c) => ({ ...c, [f.key]: e.target.value }))}
                aria-invalid={errors[f.key] ? 'true' : undefined} aria-describedby={`number-hint ${f.key}-error`} />
              {errors[f.key] && <p className="field-error" id={`${f.key}-error`}>{errors[f.key]}</p>}
            </div>
          ))}

          <p className="hint daily-hint" id="number-hint">Enter whole numbers, 0 or more.</p>
        </div>

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Submit report'}</button>
        </div>

        {status && (
          <div className={'alert alert-' + status.type} role={status.type === 'error' ? 'alert' : 'status'}>
            <strong>{status.lead}</strong> {status.text}
          </div>
        )}
      </form>

      <section className="reports-section daily-history" aria-labelledby="reports-heading">
        <h2 id="reports-heading">Your submitted reports</h2>
        {list.state === 'ready' && list.items.length === LATEST_SHOWN && <p className="hint">Showing your latest 30 reports.</p>}
        <div className="table-wrap reports-table">
          {list.state === 'loading' && <p className="state-message" role="status">Loading your reports…</p>}
          {list.state === 'error' && (
            <p className="state-message" role="alert">{list.message} <button type="button" className="btn btn-secondary" onClick={loadReports}>Retry</button></p>
          )}
          {list.state === 'ready' && list.items.length === 0 && <p className="state-message">No reports submitted yet.</p>}
          {list.state === 'ready' && list.items.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Total calls</th><th className="num">Interested</th><th className="num">Not interested</th>
                  <th className="num">Follow-up</th><th className="num">No response</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((r) => (
                  <tr key={r.id}>
                    <td>{fmt(r.reportDate)}</td>
                    <td className="num">{r.totalCalls}</td><td className="num">{r.interested}</td><td className="num">{r.notInterested}</td>
                    <td className="num">{r.followUpRequired}</td><td className="num">{r.noResponse}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
