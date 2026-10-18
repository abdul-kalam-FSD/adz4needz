export const todayValue = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};
export const formatDate = (text) => {
  const [y, m, d] = text.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
// "2026-06-15T14:30" (wall-clock, as stored) -> "15 Jun 2026, 02:30 pm"
export const formatDateTime = (text) => {
  const [date, time = '00:00'] = text.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
// "12500.00" -> "12,500.00" (Indian digit grouping, exact: no floating point). No currency symbol: the PDF names no currency.
export const displayMoney = (text) => {
  const [int, frac = '00'] = String(text).split('.');
  const neg = int.startsWith('-');
  return `${neg ? '-' : ''}${BigInt(neg ? int.slice(1) : int).toLocaleString('en-IN')}.${frac}`;
};
