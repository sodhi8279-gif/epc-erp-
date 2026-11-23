import { D, Decimal, money, qty } from './decimal';

export interface ReconInput {
  opening: Decimal.Value; // balance with subcontractor at start of period (base unit)
  issued: Decimal.Value;
  returned: Decimal.Value;
  theoretical: Decimal.Value; // Σ(work qty × norm)
  wastagePercent: Decimal.Value; // permissible wastage on theoretical consumption
  closingStock?: Decimal.Value | null; // physically verified balance with subcontractor; null = assume fully consumed
  recoveryRate: Decimal.Value; // ₹ per base unit for excess consumption
  issueRate: Decimal.Value; // ₹ per base unit, used to value balances
  isFinal?: boolean; // final reconciliation: unreturned balance becomes recoverable
}

export interface ReconResult {
  opening: Decimal; issued: Decimal; returned: Decimal; netIssued: Decimal; available: Decimal;
  theoretical: Decimal; permissibleWastage: Decimal; allowable: Decimal;
  closingStock: Decimal; actualConsumption: Decimal; difference: Decimal;
  excess: Decimal; underConsumption: Decimal;
  excessRecovery: Decimal; balanceRecovery: Decimal; totalRecoverable: Decimal; closingValue: Decimal;
  flags: string[];
}

/**
 * Material reconciliation (A–J):
 *  D = B − C (net issue); available = A + D
 *  F (actual) = available − closing stock
 *  G = E × wastage%; excess H = max(0, F − (E + G)); I = H × recovery rate
 *  J (closing) = verified stock, carried forward. Excess consumption and unconsumed balance are
 *  different things: excess is consumed material beyond norm (recovered), the balance is still held
 *  by the subcontractor (carried forward, recovered only on final reconciliation or non-return).
 */
export function reconcile(i: ReconInput): ReconResult {
  const flags: string[] = [];
  const opening = qty(i.opening), issued = qty(i.issued), returned = qty(i.returned);
  const netIssued = qty(issued.minus(returned));
  const available = qty(opening.plus(netIssued));
  const theoretical = qty(i.theoretical);
  const permissibleWastage = qty(theoretical.times(D(i.wastagePercent)).div(100));
  const allowable = qty(theoretical.plus(permissibleWastage));
  const closingKnown = i.closingStock !== null && i.closingStock !== undefined && i.closingStock !== '';
  const closingStock = closingKnown ? qty(i.closingStock) : new Decimal(0);
  if (!closingKnown) flags.push('No verified closing stock: all available material treated as consumed');
  const actualConsumption = qty(available.minus(closingStock));
  if (actualConsumption.isNegative()) flags.push('Closing stock exceeds material available: check issues, returns or stock count');
  const difference = qty(actualConsumption.minus(theoretical));
  const excess = Decimal.max(0, actualConsumption.minus(allowable));
  const underConsumption = Decimal.max(0, theoretical.minus(actualConsumption));
  if (underConsumption.gt(0)) flags.push('Consumption below theoretical norm: verify work quality / measurements');
  if (excess.gt(0)) flags.push('Excess consumption beyond permissible wastage');
  const excessRecovery = money(excess.times(D(i.recoveryRate)));
  const balanceRecovery = i.isFinal ? money(Decimal.max(0, closingStock).times(D(i.issueRate))) : new Decimal(0);
  if (i.isFinal && closingStock.gt(0)) flags.push('Final reconciliation: unreturned balance recovered at issue rate');
  return {
    opening, issued, returned, netIssued, available, theoretical, permissibleWastage, allowable,
    closingStock, actualConsumption, difference, excess: qty(excess), underConsumption: qty(underConsumption),
    excessRecovery, balanceRecovery, totalRecoverable: money(excessRecovery.plus(balanceRecovery)),
    closingValue: money(closingStock.times(D(i.issueRate))), flags,
  };
}
