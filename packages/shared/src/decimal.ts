import Decimal from 'decimal.js';

// Financial and engineering arithmetic never uses binary floating point.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Num = Decimal.Value | null | undefined;

export const D = (v: Num): Decimal => {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  if (Decimal.isDecimal(v)) return v as Decimal;
  return new Decimal(typeof v === 'string' ? v.replace(/,/g, '').trim() || '0' : v);
};

/** Money: 2 dp, half-up (Indian commercial convention). */
export const money = (v: Num) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
/** Engineering quantity: 3 dp. */
export const qty = (v: Num) => D(v).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
/** Rates: 2 dp. Percentages: 4 dp. */
export const rate = (v: Num) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const pct = (v: Num) => D(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

export const sum = (vals: Num[]) => vals.reduce<Decimal>((a, v) => a.plus(D(v)), new Decimal(0));

export const fmtINR = (v: Num, dp = 2) => {
  const n = D(v).toFixed(dp);
  const [int, frac] = n.split('.');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return (neg ? '-' : '') + grouped + (frac ? '.' + frac : '');
};

/** Parse messy numeric cells from PDF-to-Excel conversions, e.g. "520000.0\n0", "1,20,000.00", "₹ 500". */
export const parseLooseNumber = (raw: unknown): Decimal | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? new Decimal(raw) : null;
  if (Decimal.isDecimal(raw)) return raw as Decimal;
  let s = String(raw).replace(/[\s ]+/g, '').replace(/[₹,]|Rs\.?|INR/gi, '');
  if (s === '' || s === '-') return null;
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  if (!/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return null;
  return new Decimal(s);
};
