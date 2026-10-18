import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, rangeExportUrl } from '../api/client.js';
import { FigureCards } from './MonthlyFigures.jsx';
import { PERIODS, periodRange, rangeProblem } from '../lib/report-period.js';
import { formatAmount } from '../lib/report-format.js';
import { todayValue } from '../lib/format.js';

const LABEL = { day: 'Day', week: 'Week', month: 'Month', custom: 'Custom' };
const errorText = (err) => {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  const f = Object.values(err.fields || {}).filter(Boolean);
  return f.length ? `${err.message} ${f.join(' ')}` : err.message;
};

// Report for a Day, Week, Month or Custom date range. Same figures and rules as the Monthly report (the server reuses its query), without targets.
export default function RangeReport({ kind, onKind }) {
  const today = todayValue();
  const [custom, setCustom] = useState({ from: today, to: today });
  const [anchor, setAnchor] = useState(today); // the date the Day / Week / Month choice is based on
  const range = kind === 'custom' ? custom : periodRange(kind, anchor);
  const problem = rangeProblem(range.from, range.to);
  const [state, setState] = useState({ loading: true, error: '', report: null });

  const load = useCallback(async () => {
    if (problem) { setState({ loading: false, error: '', report: null }); return; }
    setState((s) => ({ ...s, loading: true, error: '' }));
    try { setState({ loading: false, error: '', report: (await api.adminRangeReport(range.from, range.to)).report }); }
    catch (err) { setState({ loading: false, error: errorText(err), report: null }); }
  }, [range.from, range.to, problem]);
  useEffect(() => { load(); }, [load]);

  const r = state.report;
  return (
    <>
      <div className="toolbar" role="group" aria-label="Report period">
        {PERIODS.map((k) => <button key={k} type="button" className={'btn ' + (k === kind ? 'btn-primary' : 'btn-secondary')} aria-pressed={k === kind} onClick={() => onKind(k)}>{LABEL[k]}</button>)}
      </div>
      {kind === 'custom' ? (
        <div className="toolbar">
          <div className="field"><label htmlFor="rr-from">From</label><input id="rr-from" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></div>
          <div className="field"><label htmlFor="rr-to">To</label><input id="rr-to" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></div>
        </div>
      ) : (
        <div className="toolbar">
          <div className="field"><label htmlFor="rr-anchor">{kind === 'day' ? 'Date' : kind === 'week' ? 'Any date in the week' : 'Any date in the month'}</label><input id="rr-anchor" type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} /></div>
          <p className="hint">Showing {range.from} to {range.to}.</p>
        </div>
      )}
      {problem && <p className="field-error" role="alert">{problem}</p>}
      {!problem && (
        <p>
          <a className="btn btn-secondary" href={rangeExportUrl(range.from, range.to, 'xlsx')}>Download Excel</a>{' '}
          <a className="btn btn-secondary" href={rangeExportUrl(range.from, range.to, 'pdf')}>Download PDF</a>
        </p>
      )}
      {state.error && <div className="alert alert-error" role="alert"><p>{state.error}</p><button type="button" className="btn btn-secondary" onClick={load}>Try again</button></div>}
      {state.loading && !problem && <p role="status">Loading the report…</p>}
      {r && !state.loading && (
        <>
          <h2>{r.label}: whole team</h2>
          {r.bdes.length === 0 ? <p>No BDEs or activity found for this period.</p> : <FigureCards block={r.total} />}
          {r.bdes.length > 0 && <p className="hint">Revenue received in this period: {formatAmount(r.total.figures.revenueReceived)}. Targets are set per month; use the Month view of the monthly report to see them.</p>}
          {r.bdes.map((b) => (
            <section key={b.id} aria-label={b.name}><h3>{b.name} ({b.employeeId})</h3><FigureCards block={b} /></section>
          ))}
        </>
      )}
    </>
  );
}
