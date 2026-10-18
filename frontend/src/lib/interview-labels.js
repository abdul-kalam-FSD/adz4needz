// Display text and badge styles for interview values. Values themselves come from the API.
export const ATTENDANCE_LABEL = { pending: 'Pending', attended: 'Attended', did_not_attend: 'Did Not Attend' };
export const OUTCOME_LABEL = { pending: 'Pending', selected: 'Selected', not_selected: 'Not Selected' };
export const ATTENDANCE_BADGE = { pending: 'badge-muted', attended: 'badge-success', did_not_attend: 'badge-overdue' };
export const OUTCOME_BADGE = { pending: 'badge-muted', selected: 'badge-success', not_selected: 'badge-overdue' };
// Date indicator computed by the server from the browser's "today".
export const STATE_BADGE = { today: ['badge-today', 'Today'], upcoming: ['badge-upcoming', 'Upcoming'], needs_update: ['badge-overdue', 'Update attendance'] };
export const interestedText = (v) => (v === true ? 'Yes' : v === false ? 'No' : 'Not recorded');
