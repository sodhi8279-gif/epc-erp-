import { D, Decimal, qty } from './decimal';

export const MEASUREMENT_TYPES = ['GENERIC', 'PIPELINE', 'EXCAVATION', 'RCC', 'REBAR'] as const;
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];

export interface MeasurementLineInput {
  description?: string | null;
  nos?: Decimal.Value | null;
  length?: Decimal.Value | null;
  breadth?: Decimal.Value | null;
  depth?: Decimal.Value | null; // height / depth
  chainageFrom?: Decimal.Value | null;
  chainageTo?: Decimal.Value | null;
  barDia?: Decimal.Value | null; // mm
  cuttingLength?: Decimal.Value | null; // m
  unitWeight?: Decimal.Value | null; // kg/m, overrides d²/162
  directQty?: Decimal.Value | null; // for lump sum / count items
  isDeduction?: boolean;
}

export interface ComputedLine { quantity: Decimal; formula: string }

const present = (v: unknown) => v !== null && v !== undefined && v !== '';

/** Standard unit weight of a round bar in kg/m: d²/162 (d in mm). IS 1786 nominal mass basis. */
export const barUnitWeight = (diaMm: Decimal.Value) => D(diaMm).pow(2).div(162);

/**
 * Compute a single measurement line. Formulas are the standard MB abstractions:
 *  PIPELINE  : length = chainageTo − chainageFrom (or explicit length) × nos
 *  EXCAVATION/RCC/GENERIC : nos × L × B × D (blank dimensions are treated as 1, as in a manual MB)
 *  REBAR     : nos × cutting length × unit weight (kg) — output in the unit requested (KG or MT)
 */
export function computeLine(type: MeasurementType, l: MeasurementLineInput, outUnit?: string): ComputedLine {
  const nos = present(l.nos) ? D(l.nos) : new Decimal(1);
  let q: Decimal;
  let f: string;
  if (present(l.directQty)) {
    q = D(l.directQty);
    f = `${q.toString()} (direct)`;
  } else if (type === 'PIPELINE') {
    let len: Decimal;
    if (present(l.chainageFrom) && present(l.chainageTo)) {
      len = D(l.chainageTo).minus(D(l.chainageFrom));
      if (len.isNegative()) throw new Error('Chainage To must be greater than Chainage From');
      f = `(${D(l.chainageTo)} − ${D(l.chainageFrom)})`;
    } else {
      len = D(l.length);
      f = `${len}`;
    }
    q = nos.times(len);
    f = `${nos} × ${f}`;
  } else if (type === 'REBAR') {
    if (!present(l.barDia) && !present(l.unitWeight)) throw new Error('Bar diameter or unit weight is required');
    const uw = present(l.unitWeight) ? D(l.unitWeight) : barUnitWeight(l.barDia!);
    const kg = nos.times(D(l.cuttingLength)).times(uw);
    const toMt = outUnit === 'MT';
    const toQtl = outUnit === 'QTL';
    q = toMt ? kg.div(1000) : toQtl ? kg.div(100) : kg;
    f = `${nos} × ${D(l.cuttingLength)} m × ${uw.toDecimalPlaces(4)} kg/m${toMt ? ' ÷ 1000' : toQtl ? ' ÷ 100' : ''}`;
  } else {
    const dims = [l.length, l.breadth, l.depth].filter(present).map(D);
    q = dims.reduce((a, b) => a.times(b), nos);
    f = [nos.toString(), ...dims.map(String)].join(' × ');
  }
  if (l.isDeduction) {
    q = q.negated();
    f = `− (${f})`;
  }
  return { quantity: qty(q), formula: f };
}

export function computeMeasurement(type: MeasurementType, lines: MeasurementLineInput[], outUnit?: string) {
  const computed = lines.map((l) => computeLine(type, l, outUnit));
  const total = qty(computed.reduce((a, c) => a.plus(c.quantity), new Decimal(0)));
  return { lines: computed, total };
}

/** Half-open interval overlap on chainage [from, to). Touching ends are not an overlap. */
export const chainageOverlaps = (aFrom: Decimal.Value, aTo: Decimal.Value, bFrom: Decimal.Value, bTo: Decimal.Value) =>
  D(aFrom).lt(D(bTo)) && D(bFrom).lt(D(aTo));
