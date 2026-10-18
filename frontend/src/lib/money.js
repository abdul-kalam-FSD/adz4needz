// Exact money arithmetic. Amounts are handled as BigInt "paise" (hundredths) so there is never floating-point error,
// and are exchanged with the API and the database as decimal STRINGS ("12500.00").
// The PDF names no currency: ASSUMPTION (TL to confirm) a single currency, so no currency code is stored.
export const MAX_MONEY_TEXT = '9999999999.99'; // DECIMAL(12,2)
const INPUT = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

// Accepts a JSON number or a numeric string with at most 2 decimals. Returns BigInt paise (> 0) or null.
export function parseMoney(input) {
  let text;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    text = String(input);          // 1e21 -> "1e+21" and 0.30000000000000004 are rejected by the pattern below
  } else if (typeof input === 'string') text = input.trim();
  else return null;
  const m = INPUT.exec(text);
  if (!m) return null;
  const paise = BigInt(m[1]) * 100n + BigInt((m[2] || '').padEnd(2, '0'));
  return paise > 0n ? paise : null;
}

// "12500.00" / "12500" / "0" (as returned by MySQL DECIMAL or SUM) -> BigInt paise. Throws on anything else.
export function fromDecimalString(value) {
  const text = String(value ?? '0');
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m || (m[3] || '').replace(/0+$/, '').length > 2) throw new Error('Unexpected money value from the database');
  const p = BigInt(m[2]) * 100n + BigInt((m[3] || '').slice(0, 2).padEnd(2, '0'));
  return m[1] ? -p : p;
}

export function formatMoney(paise) {
  const p = BigInt(paise);
  const sign = p < 0n ? '-' : '';
  const abs = p < 0n ? -p : p;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export const sumMoney = (values) => values.reduce((a, v) => a + BigInt(v), 0n);

// Pending: nothing received. Partially Paid: something received, less than committed. Paid: committed amount reached.
// (Over-payment is rejected on entry, so "more than committed" cannot normally occur; it would still read as Paid.)
export function paymentStatus(committed, paid) {
  const c = BigInt(committed); const p = BigInt(paid);
  if (p <= 0n) return 'pending';
  return p < c ? 'partially_paid' : 'paid';
}
