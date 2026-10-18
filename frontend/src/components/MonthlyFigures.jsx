import { barWidth, callSourceNote, distinctLeadsNote, formatAmount, formatCount, formatPercent } from '../lib/report-format.js';

// Real database figures for one block (the team total or one BDE). Calculated values are labelled as such.
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
  return (
    <ul className="summary-cards">
      {cards.map(([label, value, note]) => (
        <li key={label} className="stat-card">
          <div className="stat-label">{label}</div>
          <div className="stat-value">{value}</div>
          {note && <div className="stat-note">{note}</div>}
        </li>
      ))}
    </ul>
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

// Target vs actual table. `renderAction(bde)` adds an optional last column (admin: edit targets).
export function TargetTable({ rows, renderAction }) {
  const headers = ['BDE', 'Calls (actual / target)', 'Calls achieved', 'Interested leads (actual / target)', 'Interested achieved', 'Interviews (actual / target)', 'Interviews achieved', 'Revenue (received / target)', 'Revenue achieved'];
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">Monthly actual figures against targets. Achieved percentages are calculated.</caption>
        <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}{renderAction && <th>Targets</th>}</tr></thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td>{b.name} ({b.employeeId}){b.isActive ? '' : ' — inactive'}</td>
              <td>{b.figures.calls.total} / {formatCount(b.targets.calls)}</td>
              <td><Progress pct={b.achievement.calls} label={`${b.name} calls achieved`} /></td>
              <td>{b.figures.calls.interested} / {formatCount(b.targets.interested)}</td>
              <td><Progress pct={b.achievement.interested} label={`${b.name} interested achieved`} /></td>
              <td>{b.figures.interviews.scheduled} / {formatCount(b.targets.interviews)}</td>
              <td><Progress pct={b.achievement.interviews} label={`${b.name} interviews achieved`} /></td>
              <td>{formatAmount(b.figures.revenueReceived)} / {formatAmount(b.targets.revenue)}</td>
              <td><Progress pct={b.achievement.revenue} label={`${b.name} revenue achieved`} /></td>
              {renderAction && <td>{renderAction(b)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
