import { D, chainageOverlaps } from '@epc/shared';
import type { Tx } from '../lib/db';
import { bad } from '../lib/errors';
import { currentRevision } from './boq';

export const ALLOC_LIVE = ['ACTIVE', 'PENDING_EXCEPTION'] as const;

export interface AllocInput { activityId: string; workOrderItemId: string; quantity: string; zone?: string | null; chainageFrom?: string | null; chainageTo?: string | null; excludeId?: string }

/** Scope quantity of an activity = current approved BOQ quantity × conversion factor. */
export async function activityScope(tx: Tx, activityId: string) {
  const a = await tx.executionActivity.findUniqueOrThrow({ where: { id: activityId } });
  const rev = await currentRevision(a.contractId, tx);
  if (!rev) throw bad('No approved BOQ revision');
  const item = await tx.boqItem.findUnique({ where: { revisionId_itemKey: { revisionId: rev.id, itemKey: a.itemKey } } });
  if (!item) throw bad('Activity BOQ item is not in the current revision');
  return { activity: a, item, scope: D(item.quantity.toString()).times(a.conversionFactor.toString()).toDecimalPlaces(3) };
}

/**
 * Returns hard errors (cannot be overridden) and exceptions (need a reason + override approval).
 */
export async function checkAllocation(tx: Tx, i: AllocInput) {
  const errors: string[] = [];
  const exceptions: { code: string; message: string }[] = [];
  const woi = await tx.workOrderItem.findUnique({ where: { id: i.workOrderItemId }, include: { workOrder: true, rates: true } });
  if (!woi) throw bad('Work order item not found');
  if (woi.activityId !== i.activityId) errors.push('Work order line is for a different BOQ activity (wrong BOQ linkage)');
  if (woi.workOrder.status !== 'APPROVED') errors.push(`Work order ${woi.workOrder.woNo} is ${woi.workOrder.status}; only approved work orders can receive allocations`);
  if (!woi.rates.length) exceptions.push({ code: 'UNAPPROVED_RATE', message: 'Work order line has no approved rate' });
  const q = D(i.quantity);
  if (q.lte(0)) errors.push('Quantity must be greater than zero');
  const hasCh = i.chainageFrom != null && i.chainageTo != null && i.chainageFrom !== '' && i.chainageTo !== '';
  if (hasCh && D(i.chainageTo!).lte(D(i.chainageFrom!))) errors.push('Chainage To must be greater than Chainage From');
  if (errors.length) return { errors, exceptions, woi };

  const { scope, activity } = await activityScope(tx, i.activityId);
  const others = await tx.workAllocation.findMany({ where: { activityId: i.activityId, status: { in: [...ALLOC_LIVE] }, ...(i.excludeId ? { id: { not: i.excludeId } } : {}) }, include: { subcontractor: { select: { name: true } } } });
  const allocated = others.reduce((s, o) => s.plus(o.quantity.toString()), D(0));
  if (allocated.plus(q).gt(scope)) exceptions.push({ code: 'SCOPE_EXCEEDED', message: `Total allocation ${allocated.plus(q)} ${activity.unit} exceeds available scope ${scope} ${activity.unit} (already allocated ${allocated})` });
  const onItem = others.filter((o) => o.workOrderItemId === i.workOrderItemId).reduce((s, o) => s.plus(o.quantity.toString()), D(0));
  if (onItem.plus(q).gt(woi.quantity.toString())) exceptions.push({ code: 'WO_LIMIT_EXCEEDED', message: `Allocation ${onItem.plus(q)} exceeds work order line quantity ${woi.quantity}` });
  if (hasCh) {
    for (const o of others) {
      if (o.chainageFrom != null && o.chainageTo != null && chainageOverlaps(i.chainageFrom!, i.chainageTo!, o.chainageFrom.toString(), o.chainageTo.toString()))
        exceptions.push({ code: 'CHAINAGE_OVERLAP', message: `Chainage ${i.chainageFrom}–${i.chainageTo} overlaps ${o.chainageFrom}–${o.chainageTo} allocated to ${o.subcontractor.name}` });
    }
    const len = D(i.chainageTo!).minus(i.chainageFrom!);
    if (['RM', 'M'].includes(activity.unit) && !len.times(activity.conversionFactor.toString()).eq(q) && D(activity.conversionFactor.toString()).eq(1) && !len.eq(q))
      exceptions.push({ code: 'CHAINAGE_QTY_MISMATCH', message: `Quantity ${q} differs from chainage length ${len}` });
  }
  if (i.zone) {
    const z = others.find((o) => o.zone && o.zone.trim().toLowerCase() === i.zone!.trim().toLowerCase());
    if (z) exceptions.push({ code: z.workOrderItemId === i.workOrderItemId ? 'DUPLICATE' : 'ZONE_OVERLAP', message: `Work zone "${i.zone}" is already allocated to ${z.subcontractor.name}` });
  }
  return { errors, exceptions, woi };
}
