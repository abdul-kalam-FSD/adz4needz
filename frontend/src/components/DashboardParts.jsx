import { Link } from 'react-router-dom';
import { formatAmount } from '../lib/report-format.js';

// Presentation-only building blocks shared by the BDE and Admin dashboards, so both look and behave the same: the "Needs attention" list,
// the KPI row, section headings and cards. No data fetching, no calculations and no routing decisions live here; pages pass in figures
// they already have. Styles: the "Dashboards" section of styles.css (.dash-*, .kpi-*).

// Money as shown on the dashboards: rupee sign + the existing amount formatting; a missing figure is an em dash, never 0.
export const rupees = (v) => (v === null || v === undefined ? '\u2014' : '\u20B9' + formatAmount(v));

// items: [{ key, to, text, cta, count? }]. loading: still fetching. incomplete: a source failed, so an empty list must NOT claim "nothing".
export function Attention({ items, loading = false, incomplete = false }) {
  const clear = !loading && !incomplete && items.length === 0;
  return (
    <section className={'dash-attention' + (clear ? ' is-clear' : '')} aria-label="Needs attention">
      <div className="dash-attention-head">
        <h2>Needs attention</h2>
        {loading ? <span className="dash-muted" role="status">Checking…</span>
          : clear ? <span className="dash-muted">Nothing right now</span>
          : items.length === 0 ? <span className="dash-muted">Some items could not be checked</span>
          : <span className="dash-count">{items.length}</span>}
      </div>
      {items.length > 0 && (
        <ul className="dash-items">
          {items.map((i) => (
            <li key={i.key} className="dash-item">
              <span className="dash-item-text">{i.count !== undefined ? <><strong>{i.count}</strong> {i.text}</> : i.text}</span>
              <Link className="dash-item-cta" to={i.to}>{i.cta}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// One row of equal-height KPI cards (4 across on desktop, 2 across on tablet and phone).
export function KpiRow({ label, children }) {
  return <ul className="kpi-row" aria-label={label}>{children}</ul>;
}

// state: { loading, error } of the request that feeds this card; a failed card shows an em dash and a retry, never a made-up zero.
export function Kpi({ label, value, note, to, cta, alert = false, loading = false, error = '', onRetry }) {
  return (
    <li className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value' + (alert && !loading && !error ? ' is-alert' : '')}>{loading ? '…' : error ? '\u2014' : value}</div>
      {error ? <div className="kpi-note kpi-error" role="alert">{error}{onRetry && <> <button type="button" className="btn-link" onClick={onRetry}>Try again</button></>}</div>
        : !loading && note ? <div className="kpi-note">{note}</div> : null}
      {to && <div className="kpi-foot"><Link className="kpi-link" to={to}>{cta}</Link></div>}
    </li>
  );
}

// Heading above a table or card group: title on the left, optional short meta (a date, a link) on the right.
export function SectionHead({ title, meta }) {
  return (
    <div className="dash-section-head">
      <h2>{title}</h2>
      {meta ? <div className="dash-section-meta">{meta}</div> : null}
    </div>
  );
}

// Card with its own loading and error state, used for the secondary BDE blocks.
export function Card({ title, status, meta, state, retry, children }) {
  return (
    <section className="dash-card" aria-label={title}>
      <div className="dash-card-head"><div className="dash-card-title"><h2>{title}</h2>{status || null}</div>{meta ? <div className="dash-section-meta">{meta}</div> : null}</div>
      {state.loading && <p className="dash-muted" role="status">Loading…</p>}
      {state.error && <div className="alert alert-error" role="alert"><p>{state.error}</p><button type="button" className="btn btn-secondary" onClick={retry}>Try again</button></div>}
      {!state.loading && !state.error && children}
    </section>
  );
}

// Small label/value pairs: [[label, value], ...]
export function Metrics({ items, caption }) {
  return (
    <div>
      {caption ? <p className="dash-caption">{caption}</p> : null}
      <dl className="dash-metrics">
        {items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </div>
  );
}
