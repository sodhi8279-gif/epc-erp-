import { fmtINR, D, UNITS, type UnitCode } from '@epc/shared';
export const inr = (v: unknown, dp = 2) => (v === null || v === undefined || v === '' ? '—' : `₹${fmtINR(v as string, dp)}`);
export const num = (v: unknown, dp = 3) => {
  if (v === null || v === undefined || v === '') return '—';
  const d = D(v as string);
  return fmtINR(d.toDecimalPlaces(dp).toString(), Math.min(dp, Math.max(0, d.decimalPlaces())));
};
export const date = (v: unknown) => (v ? new Date(v as string).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const dateTime = (v: unknown) => (v ? new Date(v as string).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const unitLabel = (u: string) => UNITS[u as UnitCode]?.label ?? u;
export const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);
export const humanize = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
