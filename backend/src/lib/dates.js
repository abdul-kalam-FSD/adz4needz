// Date-only helpers (YYYY-MM-DD strings). UTC math so the server timezone never matters.
export function addDays(dateText, days) {
  const [y, m, d] = dateText.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
