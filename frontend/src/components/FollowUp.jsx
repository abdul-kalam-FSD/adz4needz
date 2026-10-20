import { formatDate } from '../lib/format.js';

// Follow-up date plus its state badge (overdue / due today / upcoming), identical on the Call desk and the Leads list.
// Presentation only: the date and the state both come from the lead the API already returned.
const BADGE = { overdue: ['badge-overdue', 'Overdue'], today: ['badge-today', 'Due today'], upcoming: ['badge-upcoming', 'Upcoming'] };

export default function FollowUp({ lead }) {
  if (!lead.followUpDate) return <span className="muted">—</span>;
  const badge = lead.followUpState && BADGE[lead.followUpState];
  return (
    <span className="followup-cell">
      <span className="followup-day">{formatDate(lead.followUpDate)}</span>
      {badge && <span className={'badge ' + badge[0]}>{badge[1]}</span>}
    </span>
  );
}
