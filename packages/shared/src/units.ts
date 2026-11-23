import { D, Decimal } from './decimal';

/** Canonical units used across BOQ, activities, measurements and materials. */
export const UNITS = {
  CUM: { label: 'Cum', name: 'Cubic metre', dim: 'volume' },
  SQM: { label: 'Sqm', name: 'Square metre', dim: 'area' },
  RM: { label: 'RM', name: 'Running metre', dim: 'length' },
  M: { label: 'M', name: 'Metre', dim: 'length' },
  KM: { label: 'Km', name: 'Kilometre', dim: 'length' },
  NO: { label: 'No.', name: 'Number', dim: 'count' },
  JOINT: { label: 'Joint', name: 'Welding / jointing joint', dim: 'count' },
  KG: { label: 'Kg', name: 'Kilogram', dim: 'mass' },
  QTL: { label: 'Qtl', name: 'Quintal', dim: 'mass' },
  MT: { label: 'MT', name: 'Metric tonne', dim: 'mass' },
  BAG: { label: 'Bag', name: 'Bag', dim: 'count' },
  LTR: { label: 'Ltr', name: 'Litre', dim: 'volume_liquid' },
  HOUR: { label: 'Hour', name: 'Hour', dim: 'time' },
  DAY: { label: 'Day', name: 'Day', dim: 'time' },
  MONTH: { label: 'Month', name: 'Month', dim: 'time' },
  LS: { label: 'LS', name: 'Lump sum', dim: 'lumpsum' },
  JOB: { label: 'Job', name: 'Job', dim: 'lumpsum' },
  SET: { label: 'Set', name: 'Set', dim: 'count' },
} as const;
export type UnitCode = keyof typeof UNITS;
export const UNIT_CODES = Object.keys(UNITS) as UnitCode[];

/** Exact conversions within a physical dimension. Anything else needs an approved engineering conversion. */
const STANDARD: Record<string, Decimal.Value> = {
  'KG>MT': '0.001', 'MT>KG': '1000', 'KG>QTL': '0.01', 'QTL>KG': '100', 'QTL>MT': '0.1', 'MT>QTL': '10',
  'M>RM': '1', 'RM>M': '1', 'KM>M': '1000', 'M>KM': '0.001', 'KM>RM': '1000', 'RM>KM': '0.001',
  'HOUR>DAY': '0.125', 'DAY>HOUR': '8',
};
export const standardConversion = (from: UnitCode, to: UnitCode): Decimal | null => {
  if (from === to) return new Decimal(1);
  const f = STANDARD[`${from}>${to}`];
  return f === undefined ? null : D(f);
};

const ALIASES: Record<string, UnitCode> = {
  CUM: 'CUM', CUMT: 'CUM', M3: 'CUM', 'CU.M': 'CUM', 'CU.M.': 'CUM', CUBICMETRE: 'CUM', CUBICMETER: 'CUM',
  SQM: 'SQM', M2: 'SQM', 'SQ.M': 'SQM', SQMT: 'SQM',
  RM: 'RM', RMT: 'RM', 'R.M': 'RM', 'R.M.': 'RM', RUNNINGMETRE: 'RM', RUNNINGMETER: 'RM', MTR: 'M', M: 'M', METRE: 'M', METER: 'M', KM: 'KM',
  NO: 'NO', 'NO.': 'NO', NOS: 'NO', 'NOS.': 'NO', NUMBER: 'NO', EACH: 'NO', EA: 'NO', PCS: 'NO',
  JOINT: 'JOINT', JOINTS: 'JOINT', JT: 'JOINT',
  KG: 'KG', KGS: 'KG', QTL: 'QTL', QUINTAL: 'QTL', MT: 'MT', TONNE: 'MT', TON: 'MT', TONNES: 'MT',
  BAG: 'BAG', BAGS: 'BAG', LTR: 'LTR', LITRE: 'LTR', L: 'LTR',
  HOUR: 'HOUR', HR: 'HOUR', HRS: 'HOUR', DAY: 'DAY', DAYS: 'DAY', MONTH: 'MONTH',
  LS: 'LS', 'L.S': 'LS', 'L.S.': 'LS', LUMPSUM: 'LS', JOB: 'JOB', SET: 'SET', SETS: 'SET',
};
/** Normalise a unit string from an imported document. Returns null if not recognised (user must map it). */
export const normaliseUnit = (raw: unknown): UnitCode | null => {
  if (raw === null || raw === undefined) return null;
  const k = String(raw).toUpperCase().replace(/[\s_-]+/g, '');
  return ALIASES[k] ?? null;
};
