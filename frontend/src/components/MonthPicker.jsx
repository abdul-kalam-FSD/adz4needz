import { MONTH_RE, shiftMonth } from '../lib/report-format.js';

export default function MonthPicker({ month, onChange, disabled }) {
  return (
    <div className="toolbar">
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => onChange(shiftMonth(month, -1))}>Previous month</button>
      <div className="field">
        <label htmlFor="report-month">Month</label>
        <input id="report-month" type="month" min="2020-01" value={month} disabled={disabled} onChange={(e) => { if (MONTH_RE.test(e.target.value)) onChange(e.target.value); }} />
      </div>
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => onChange(shiftMonth(month, 1))}>Next month</button>
    </div>
  );
}
