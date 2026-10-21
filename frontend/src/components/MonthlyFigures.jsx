import { barWidth, callSourceNote, distinctLeadsNote, formatAmount, formatCount, formatPercent } from '../lib/report-format.js';
import { Kpi, KpiRow } from './DashboardParts.jsx';

// Real database figures for one block (the team total or one BDE). Calculated values are labelled as such.
// The ten figures, their values and their notes are exactly the ones this screen has always shown; only the layout changed:
// four headline figures in a KPI row, the other six in a compact list.
const HEADLINE = ['Calls made', 'Interested leads', 'Interviews scheduled', 'Revenue received'];

export function FigureCards({ block }) {
  const f = block.figures;
  const cards = [
    ['Calls made', f.calls.total, callSourceNote(f.calls)],
    ['Interested leads', f.calls.interested, block.calculated.interestedPercentOfCalls === null ? 'conversion (interested leads ÷ calls): —' : `${block.calculated.interestedPercentOfCalls}% conversion (interested leads ÷ calls, calculated)`],
    ['Distinct leads called', f.calls.distinctLeads, distinctLeadsNote(f.calls)],
    ['Not interested', f.calls.notInterested, ''],
    ['Follow-up required', f.calls.followUpRequired, ''],
    ['No response', f.calls.noResponse, ''],
    ['Leads added', f.leadsCreated, ''],
    ['Interviews scheduled', f.interviews.scheduled, `${f.interviews.attended} attended, ${f.interviews.didNotAttend} did not attend, ${f.interviews.selected} selected`],
    ['Payment commitments', f.payments.commitments, `${formatAmount(f.payments.committedAmount)} committed`],
    ['Revenue received', formatAmount(f.revenueReceived), 'money actually recorded as received']
  ];
  const headline = HEADLINE.map((l) => cards.find((c) => c[0] === l));
  const others = cards.filter((c) => !HEADLINE.includes(c[0]));
  return (
    <>
      <KpiRow label="Headline figures">
        {headline.map(([label, value, note]) => <Kpi key={label} label={label} value={value} note={note} />)}
      </KpiRow>
      <dl className="fig-list" aria-label="Other figures">
        {others.map(([label, value, note]) => (
          <div key={label} className="fig-item">
            <dt>{label}</dt>
            <dd className="fig-value">{value}</dd>
            {note && <dd className="fig-note">{note}</dd>}
          </div>
        ))}
      </dl>
    </>
  );
}

function Progress({ pct, label }) {
  return (
    <div>
      <div className="progress-value">{formatPercent(pct)}</div>
      {pct !== null && pct !== undefined && (
        <div className="progress" role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(pct, 100)}>
          <div className={'progress-bar' + (pct >= 100 ? ' is-complete' : '')} style={{ width: barWidth(pct) + '%' }} />
        </div>
      )}
    </div>
  );
}

// The four target measures of one BDE: label, "actual / target" text, achievement. Shared by the table and the cards so they cannot differ.
function targetMeasures(b) {
  return [
    { key: 'calls', label: 'Calls', actual: b.figures.calls.total, target: formatCount(b.targets.calls), pct: b.achievement.calls, aria: `${b.name} calls achieved` },
    { key: 'interested', label: 'Interested leads', actual: b.figures.calls.interested, target: formatCount(b.targets.interested), pct: b.achievement.interested, aria: `${b.name} interested achieved` },
    { key: 'interviews', label: 'Interviews scheduled', actual: b.figures.interviews.scheduled, target: formatCount(b.targets.interviews), pct: b.achievement.interviews, aria: `${b.name} interviews achieved` },
    { key: 'revenue', label: 'Revenue received', actual: formatAmount(b.figures.revenueReceived), target: formatAmount(b.targets.revenue), pct: b.achievement.revenue, aria: `${b.name} revenue achieved` }
  ];
}

// Target vs actual table. Each measure is one column: "actual / target" with the calculated achievement under it.
// `renderAction(bde)` adds an optional last column (admin: edit targets).
export function TargetTable({ rows, renderAction }) {
  const headers = ['BDE', 'Calls', 'Interested leads', 'Interviews scheduled', 'Revenue received'];
  return (
    <>
      <p className="hint tgt-legend">Each cell shows actual / target, then the achieved percentage (calculated as actual ÷ target).</p>
      <div className="table-wrap target-table">
        <table>
          <caption className="sr-only">Monthly actual figures against targets. Achieved percentages are calculated.</caption>
          <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}{renderAction && <th>Targets</th>}</tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td><span className="cell-name">{b.name}</span> <span className="muted">({b.employeeId})</span>{b.isActive ? '' : ' — inactive'}</td>
                {targetMeasures(b).map((m) => (
                  <td key={m.key}>
                    <div className="tgt-line"><strong>{m.actual}</strong> / {m.target}</div>
                    <Progress pct={m.pct} label={m.aria} />
                  </td>
                ))}
                {renderAction && <td>{renderAction(b)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// My Month: the same four measures as cards (a one-row table would repeat the BDE's own name).
export function TargetCards({ block }) {
  return (
    <ul className="kpi-row tgt-cards" aria-label="Targets and achievement">
      {targetMeasures(block).map((m) => (
        <li key={m.key} className="kpi">
          <div className="kpi-label">{m.label}</div>
          <div className="kpi-value">{m.actual} <span className="tgt-of">/ {m.target}</span></div>
          <Progress pct={m.pct} label={m.aria} />
        </li>
      ))}
    </ul>
  );
}

// Admin, per BDE: one comparison table of the main figures, and under it every BDE's complete set of figures in an expandable block,
// so nothing that used to be on the page is lost. Values are the same database figures and calculated ratios shown elsewhere ("—" when missing).
export function BdeComparison({ bdes }) {
  return (
    <>
      <div className="table-wrap cmp-table">
        <table>
          <caption className="sr-only">Main figures for each BDE. Open a BDE below the table for every figure.</caption>
          <thead>
            <tr>
              <th>BDE</th><th className="num">Calls</th><th className="num">Interested leads</th><th className="num">Conversion</th>
              <th className="num">Interviews scheduled</th><th className="num">Payment commitments</th><th className="num">Revenue received</th>
            </tr>
          </thead>
          <tbody>
            {bdes.map((b) => (
              <tr key={b.id}>
                <td><span className="cell-name">{b.name}</span> <span className="muted">({b.employeeId})</span>{b.isActive ? '' : ' — inactive'}</td>
                <td className="num">{b.figures.calls.total}</td>
                <td className="num">{b.figures.calls.interested}</td>
                <td className="num">{formatPercent(b.calculated.interestedPercentOfCalls)}</td>
                <td className="num">{b.figures.interviews.scheduled}</td>
                <td className="num">{b.figures.payments.commitments}</td>
                <td className="num">{formatAmount(b.figures.revenueReceived)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bde-details">
        {bdes.map((b) => (
          <details key={b.id} className="bde-detail">
            <summary>{b.name} ({b.employeeId}) <span className="muted">all figures</span></summary>
            <section aria-label={b.name}><FigureCards block={b} /></section>
          </details>
        ))}
      </div>
    </>
  );
}
