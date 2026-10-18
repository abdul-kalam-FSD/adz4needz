// Pure rules that turn a month of CALL-LOG events and MANUAL daily reports into one set of calling figures per BDE. No I/O.
// Used by the repository, so the on-screen team report, "My Month", the target progress and both exports all see the same numbers.
//
// SOURCE RULE (the same rule the admin daily table uses), applied PER BDE PER WORKING DATE:
//   - the day has at least one non-undone call-log event  -> the day's figures come from the call log; a manual report for that
//     same day is IGNORED (reported only as manual_ignored_calls), so a day is never counted twice;
//   - otherwise, if the day has a manual daily report      -> the typed figures are used;
//   - otherwise the day has no activity.
//
// DEFINITIONS (identical to the daily Call desk figures; see docs/call-log-assumptions.md):
//   total_calls        every call counts, including repeat calls to the same lead (call-log days) + typed total (manual-only days)
//   not_interested, follow_up_required, no_response   calls with that result (call-log days) + typed counts (manual-only days)
//   interested         INTERESTED LEADS: distinct leads whose LATEST call in the month was "interested" (call-log days)
//                      + typed "interested" of manual-only days. Manual days carry no lead identity, so they cannot be de-duplicated.
//   interested_calls   calls that ended "interested" (events) + the same typed number
//   distinct_leads     distinct leads called on call-log days of the month (manual days carry no lead identity: not included)
//   repeat_calls       call-log calls - distinct_leads
//   conversion         interested / total_calls (see conversionPercent in call-log.js)
// Note: because a lead is counted once per MONTH here, the monthly interested figure can be lower than the sum of the daily ones.
const day = (v) => String(v).slice(0, 10);
const n = (v) => Number(v ?? 0) || 0;
const byTime = (a, b) => (a.called_at < b.called_at ? -1 : a.called_at > b.called_at ? 1 : Number(a.id) - Number(b.id));
const KEY = { interested: 'interested', not_interested: 'notInterested', follow_up: 'followUp', no_response: 'noResponse' };

// month: the object from parseMonth(). manualDays: rows of daily_reports. events: call_logs rows (non-undone).
// Returns Map<String(user_id), figures>. A BDE with no activity in the month is absent from the map.
export function monthlyCallingByUser({ month, manualDays = [], events = [] }) {
  const inMonth = (d) => d >= month.start && d < month.endExclusive;
  const users = new Map();
  const slot = (id) => {
    const k = String(id);
    if (!users.has(k)) users.set(k, { events: [], logDays: new Set(), manual: new Map() });
    return users.get(k);
  };
  for (const e of events) {
    const d = day(e.call_date);
    if (e.voided_at || !inMonth(d)) continue; // undone calls and anything outside the month never count
    const u = slot(e.user_id); u.events.push(e); u.logDays.add(d);
  }
  for (const m of manualDays) {
    const d = day(m.report_date);
    if (!inMonth(d)) continue;
    slot(m.user_id).manual.set(d, m);
  }

  const out = new Map();
  for (const [uid, u] of users) {
    let manualCalls = 0; let manualIgnored = 0; let manualOnlyDays = 0; let mixedDays = 0;
    const typed = { interested: 0, notInterested: 0, followUp: 0, noResponse: 0 };
    for (const [d, m] of u.manual) {
      if (u.logDays.has(d)) { mixedDays += 1; manualIgnored += n(m.total_calls); continue; }
      manualOnlyDays += 1; manualCalls += n(m.total_calls);
      typed.interested += n(m.interested); typed.notInterested += n(m.not_interested); typed.followUp += n(m.follow_up_required); typed.noResponse += n(m.no_response);
    }
    const sorted = [...u.events].sort(byTime);
    const tally = { interested: 0, notInterested: 0, followUp: 0, noResponse: 0 };
    const latest = new Map();
    for (const e of sorted) { tally[KEY[e.outcome]] += 1; latest.set(String(e.lead_id), e.outcome); }
    const interestedLeads = [...latest.values()].filter((o) => o === 'interested').length;
    const logCalls = sorted.length;
    out.set(uid, {
      days_reported: u.logDays.size + manualOnlyDays,
      total_calls: logCalls + manualCalls,
      interested: interestedLeads + typed.interested,
      interested_calls: tally.interested + typed.interested,
      not_interested: tally.notInterested + typed.notInterested,
      follow_up_required: tally.followUp + typed.followUp,
      no_response: tally.noResponse + typed.noResponse,
      distinct_leads: latest.size,
      repeat_calls: logCalls - latest.size,
      call_log_days: u.logDays.size, manual_only_days: manualOnlyDays, mixed_days: mixedDays,
      call_log_calls: logCalls, manual_calls: manualCalls, manual_ignored_calls: manualIgnored
    });
  }
  return out;
}
