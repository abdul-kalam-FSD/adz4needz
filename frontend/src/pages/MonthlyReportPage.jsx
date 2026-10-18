import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import MonthPicker from '../components/MonthPicker.jsx';
import { FigureCards, TargetTable } from '../components/MonthlyFigures.jsx';
import { currentMonth } from '../lib/report-format.js';

export default function MonthlyReportPage() {
  const [month, setMonth] = useState(currentMonth());
  const [state, setState] = useState({ loading: true, error: '', report: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await api.monthlyReport(month);
      setState({ loading: false, error: '', report: data.report });
    } catch (err) {
      setState({ loading: false, error: err instanceof ApiError ? err.message : 'Something went wrong. Please try again.', report: null });
    }
  }, [month]);
  useEffect(() => { load(); }, [load]);
  const me = state.report && state.report.bdes[0];
  return (
    <>
      <h1>My Month</h1>
      <p className="hint">Your own figures for the month, taken from your Call desk calls and daily reports (for each day, one or the other, never both), plus leads, interviews and payments. Targets are set by an admin; "achieved" is calculated as actual ÷ target.</p>
      <MonthPicker month={month} onChange={setMonth} disabled={state.loading} />
      {state.error && <div className="alert alert-error" role="alert"><p>{state.error}</p><button type="button" className="btn btn-secondary" onClick={load}>Try again</button></div>}
      {state.loading && <p role="status">Loading…</p>}
      {state.report && !state.loading && !me && <p>No activity found for {state.report.label}.</p>}
      {me && !state.loading && (
        <>
          <h2>{state.report.label}</h2>
          <FigureCards block={me} />
          <h2>Targets</h2>
          {Object.values(me.targets).every((v) => v === null) && <p className="hint">No target has been set for you this month.</p>}
          <TargetTable rows={[me]} />
        </>
      )}
    </>
  );
}
