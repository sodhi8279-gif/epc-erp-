import { D, money } from '@epc/shared';
import type { Tx } from '../lib/db';
import { prisma } from '../lib/db';
import { bad } from '../lib/errors';

/** Subcontract rate in force on a date (rate history is prospective). */
export async function rateOn(workOrderItemId: string, date: Date, db: Tx | typeof prisma = prisma) {
  const hist = await db.workOrderItemRate.findMany({ where: { workOrderItemId }, orderBy: { effectiveFrom: 'desc' } });
  const r = hist.find((h) => h.effectiveFrom <= date) ?? hist[hist.length - 1];
  if (!r) throw bad('Work order item has no approved rate');
  return r.rate;
}

export async function recomputeWoValue(tx: Tx, workOrderId: string) {
  const items = await tx.workOrderItem.findMany({ where: { workOrderId } });
  const value = money(items.reduce((s, i) => s.plus(i.amount.toString()), D(0)));
  await tx.workOrder.update({ where: { id: workOrderId }, data: { value: value.toString() } });
  return value;
}
