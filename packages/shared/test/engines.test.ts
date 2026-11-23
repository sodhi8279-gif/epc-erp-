import { describe, expect, it } from 'vitest';
import { computeBreakup, activityMargin, reconcile, computeLine, computeMeasurement, chainageOverlaps, parseLooseNumber, normaliseUnit, fmtINR, barUnitWeight } from '../src';

describe('BOQ activity breakup', () => {
  const parent = { clientRate: 10000, quantity: 1000, unit: 'RM' };
  it('splits the 600 mm MS pipeline example 80/12/5/3 and balances', () => {
    const r = computeBreakup(parent, [
      { code: 'SUP', name: 'Pipe supply', method: 'PERCENT', percentage: 80, unit: 'RM', conversionFactor: 1 },
      { code: 'LAY', name: 'Pipe laying', method: 'PERCENT', percentage: 12, unit: 'RM', conversionFactor: 1 },
      { code: 'WLD', name: 'Jointing/welding', method: 'PERCENT', percentage: 5, unit: 'JOINT', conversionFactor: '0.1666666667' },
      { code: 'TST', name: 'Testing', method: 'PERCENT', percentage: 3, unit: 'RM', conversionFactor: 1 },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.balanced).toBe(true);
    expect(r.parentAmount.toString()).toBe('10000000');
    expect(r.activities.map((a) => a.allocatedRatePerParentUnit.toString())).toEqual(['8000', '1200', '500', '300']);
    expect(r.activities[1].budgetAmount.toString()).toBe('1200000');
    // welding: 1000 RM / 6 m pipes ≈ 166.667 joints, ₹500/RM → ₹3000/joint
    expect(r.activities[2].scopeQuantity.toString()).toBe('166.667');
    expect(r.activities[2].budgetRatePerActivityUnit.toFixed(0)).toBe('3000');
  });
  it('rejects percentages that do not total 100', () => {
    const r = computeBreakup(parent, [
      { code: 'A', name: 'a', method: 'PERCENT', percentage: 80, unit: 'RM', conversionFactor: 1 },
      { code: 'B', name: 'b', method: 'PERCENT', percentage: 15, unit: 'RM', conversionFactor: 1 },
    ]);
    expect(r.balanced).toBe(false);
    expect(r.errors[0]).toMatch(/95%/);
  });
  it('supports mixed allocation and warns about unallocated rate', () => {
    const r = computeBreakup(parent, [
      { code: 'A', name: 'a', method: 'PERCENT', percentage: 80, unit: 'RM', conversionFactor: 1 },
      { code: 'B', name: 'b', method: 'FIXED_RATE', fixedRate: 1500, unit: 'RM', conversionFactor: 1 },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.unallocatedRate.toString()).toBe('500');
    expect(r.warnings.length).toBe(1);
  });
  it('rejects over-allocation', () => {
    const r = computeBreakup(parent, [
      { code: 'A', name: 'a', method: 'FIXED_RATE', fixedRate: 9000, unit: 'RM', conversionFactor: 1 },
      { code: 'B', name: 'b', method: 'FIXED_RATE', fixedRate: 1500, unit: 'RM', conversionFactor: 1 },
    ]);
    expect(r.errors.some((e) => e.includes('exceeds'))).toBe(true);
  });
  it('separates internal budget from subcontractor rate (₹1,200 vs ₹750)', () => {
    const m = activityMargin(1200, 750, 1500);
    expect(m.perUnit.toString()).toBe('450');
    expect(m.total.toString()).toBe('675000');
  });
});

describe('material reconciliation', () => {
  it('reproduces the RCC M30 cement example', () => {
    const r = reconcile({ opening: 0, issued: 42500, returned: 1000, theoretical: 100 * 380, wastagePercent: 0, recoveryRate: 9, issueRate: 8.1 });
    expect(r.netIssued.toString()).toBe('41500');
    expect(r.theoretical.toString()).toBe('38000');
    expect(r.difference.toString()).toBe('3500');
    expect(r.excess.toString()).toBe('3500');
    expect(r.excessRecovery.toString()).toBe('31500');
  });
  it('applies permissible wastage and carries the verified balance forward', () => {
    const r = reconcile({ opening: 0, issued: 42500, returned: 1000, theoretical: 38000, wastagePercent: 2, closingStock: 1500, recoveryRate: 9, issueRate: 8.1 });
    expect(r.permissibleWastage.toString()).toBe('760');
    expect(r.actualConsumption.toString()).toBe('40000');
    expect(r.excess.toString()).toBe('1240');
    expect(r.balanceRecovery.toString()).toBe('0');
    expect(r.closingValue.toString()).toBe('12150');
  });
  it('recovers unreturned balance on final reconciliation', () => {
    const r = reconcile({ opening: 0, issued: 1000, returned: 0, theoretical: 900, wastagePercent: 2, closingStock: 50, recoveryRate: 10, issueRate: 8, isFinal: true });
    expect(r.excess.toString()).toBe('32');
    expect(r.balanceRecovery.toString()).toBe('400');
    expect(r.totalRecoverable.toString()).toBe('720');
  });
  it('flags under-consumption', () => {
    const r = reconcile({ opening: 0, issued: 30000, returned: 0, theoretical: 38000, wastagePercent: 2, recoveryRate: 9, issueRate: 8 });
    expect(r.underConsumption.toString()).toBe('8000');
    expect(r.flags.some((f) => f.includes('below'))).toBe(true);
  });
});

describe('measurement formulas', () => {
  it('RCC volume nos × L × B × H', () => {
    expect(computeLine('RCC', { nos: 4, length: '0.45', breadth: '0.45', depth: '3.2' }).quantity.toString()).toBe('2.592');
  });
  it('rebar weight via d²/162', () => {
    expect(barUnitWeight(12).toFixed(3)).toBe('0.889');
    const l = computeLine('REBAR', { nos: 100, cuttingLength: '6', barDia: 12 }, 'MT');
    expect(l.quantity.toString()).toBe('0.533');
  });
  it('pipeline length from chainage and deductions', () => {
    const m = computeMeasurement('PIPELINE', [{ chainageFrom: 1000, chainageTo: '1250.5' }, { length: 10, isDeduction: true }]);
    expect(m.total.toString()).toBe('240.5');
    expect(() => computeLine('PIPELINE', { chainageFrom: 50, chainageTo: 10 })).toThrow();
  });
  it('chainage overlap is half-open', () => {
    expect(chainageOverlaps(0, 100, 100, 200)).toBe(false);
    expect(chainageOverlaps(0, 100, 99, 200)).toBe(true);
  });
});

describe('import helpers', () => {
  it('parses PDF-converted numbers', () => {
    expect(parseLooseNumber('520000.0\n0')!.toString()).toBe('520000');
    expect(parseLooseNumber('1,20,000.50')!.toString()).toBe('120000.5');
    expect(parseLooseNumber('abc')).toBeNull();
  });
  it('normalises units', () => {
    expect(normaliseUnit('Cum')).toBe('CUM');
    expect(normaliseUnit('nos')).toBe('NO');
    expect(normaliseUnit('R.M.')).toBe('RM');
    expect(normaliseUnit('furlong')).toBeNull();
  });
  it('formats Indian grouping', () => {
    expect(fmtINR(10000000)).toBe('1,00,00,000.00');
  });
});
