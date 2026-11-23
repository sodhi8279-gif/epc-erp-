import { D, Decimal, money, pct, qty, rate, sum } from './decimal';

export type AllocationMethod = 'PERCENT' | 'FIXED_RATE';

export interface BreakupActivityInput {
  id?: string;
  code: string;
  name: string;
  method: AllocationMethod;
  percentage?: Decimal.Value | null; // share of the client rate (PERCENT)
  fixedRate?: Decimal.Value | null; // ₹ per PARENT unit (FIXED_RATE)
  unit: string; // activity measurement unit
  conversionFactor: Decimal.Value; // activity units per ONE parent unit
}

export interface BreakupParent {
  clientRate: Decimal.Value; // ₹ per parent unit
  quantity: Decimal.Value; // approved parent quantity
  unit: string;
}

export interface BreakupActivityResult {
  code: string;
  name: string;
  method: AllocationMethod;
  share: Decimal; // % of client rate
  allocatedRatePerParentUnit: Decimal; // ₹ per parent unit
  scopeQuantity: Decimal; // in activity unit
  budgetRatePerActivityUnit: Decimal; // ₹ per activity unit
  budgetAmount: Decimal;
}

export interface BreakupResult {
  activities: BreakupActivityResult[];
  totalShare: Decimal;
  totalAllocatedRate: Decimal;
  unallocatedRate: Decimal;
  parentAmount: Decimal;
  totalBudget: Decimal;
  errors: string[];
  warnings: string[];
  balanced: boolean;
}

/**
 * Splits a client BOQ item into execution activities. The internal allocation (budget) is NOT the
 * subcontractor rate; it only apportions the client rate across activities so margin can be measured.
 */
export function computeBreakup(parent: BreakupParent, acts: BreakupActivityInput[]): BreakupResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const clientRate = D(parent.clientRate);
  const parentQty = D(parent.quantity);
  const codes = new Set<string>();

  const activities = acts.map((a) => {
    if (codes.has(a.code)) errors.push(`Duplicate activity code ${a.code}`);
    codes.add(a.code);
    const factor = D(a.conversionFactor);
    if (factor.lte(0)) errors.push(`${a.code}: conversion factor must be greater than zero`);
    let allocated: Decimal;
    let share: Decimal;
    if (a.method === 'PERCENT') {
      share = D(a.percentage);
      if (share.lt(0) || share.gt(100)) errors.push(`${a.code}: percentage must be between 0 and 100`);
      allocated = clientRate.times(share).div(100);
    } else {
      allocated = D(a.fixedRate);
      if (allocated.lt(0)) errors.push(`${a.code}: fixed rate cannot be negative`);
      share = clientRate.isZero() ? new Decimal(0) : allocated.div(clientRate).times(100);
    }
    const scope = parentQty.times(factor);
    const budgetRate = factor.gt(0) ? allocated.div(factor) : new Decimal(0);
    return {
      code: a.code,
      name: a.name,
      method: a.method,
      share: pct(share),
      allocatedRatePerParentUnit: rate(allocated),
      scopeQuantity: qty(scope),
      budgetRatePerActivityUnit: budgetRate.toDecimalPlaces(4),
      budgetAmount: money(allocated.times(parentQty)),
    };
  });

  const totalAllocatedRate = sum(activities.map((a) => a.allocatedRatePerParentUnit));
  const totalShare = clientRate.isZero() ? new Decimal(0) : totalAllocatedRate.div(clientRate).times(100);
  const unallocatedRate = clientRate.minus(totalAllocatedRate);
  const onlyPercent = acts.length > 0 && acts.every((a) => a.method === 'PERCENT');
  const pctSum = sum(acts.filter((a) => a.method === 'PERCENT').map((a) => a.percentage));

  if (onlyPercent && !pctSum.eq(100)) errors.push(`Percentage allocations total ${pctSum}%, they must total exactly 100%`);
  if (totalAllocatedRate.gt(clientRate.plus('0.005')))
    errors.push(`Allocated ₹${rate(totalAllocatedRate)} per unit exceeds the client rate ₹${rate(clientRate)}`);
  else if (!onlyPercent && unallocatedRate.abs().gt('0.005'))
    warnings.push(`₹${rate(unallocatedRate)} per ${parent.unit} of the client rate is not allocated to any activity`);

  return {
    activities,
    totalShare: pct(totalShare),
    totalAllocatedRate: rate(totalAllocatedRate),
    unallocatedRate: rate(unallocatedRate),
    parentAmount: money(clientRate.times(parentQty)),
    totalBudget: money(sum(activities.map((a) => a.budgetAmount))),
    errors,
    warnings,
    balanced: errors.length === 0 && unallocatedRate.abs().lte('0.005'),
  };
}

/** Margin of a subcontract rate against the internal budget for one activity. */
export function activityMargin(budgetRatePerActivityUnit: Decimal.Value, subcontractRate: Decimal.Value, quantity: Decimal.Value) {
  const perUnit = D(budgetRatePerActivityUnit).minus(D(subcontractRate));
  return { perUnit: rate(perUnit), total: money(perUnit.times(D(quantity))) };
}
