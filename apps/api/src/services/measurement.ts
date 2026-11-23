import { D, computeMeasurement, chainageOverlaps, LIVE_MEASUREMENT, type MeasurementLineInput, type MeasurementType } from '@epc/shared';
import type { Tx } from '../lib/db';
import { bad } from '../lib/errors';
import { boqItemInForce } from './boq';
import { activityScope } from './allocation';

export interface MeasureInput {
  workOrderItemId: string; allocationId?: string | null; date: Date; type: MeasurementType; mbNo?: string | null; mbPage?: string | null;
  location?: string | null; structure?: string | null; drawingRef?: string | null; zone?: string | null; chainageFrom?: string | null; chainageTo?: string | null;
  attributes?: Record<string, unknown> | null; measurementRule?: string | null; remarks?: string | null; lines: MeasurementLineInput[];
}

const has = (v: unknown) => v !== null && v !== undefined && v !== '';

/** Every validation that protects against double payment. Returns derived fields for persistence. */
export async function prepareMeasurement(tx: Tx, projectId: string, i: MeasureInput, excludeId?: string) {
  const woi = await tx.workOrderItem.findUnique({ where: { id: i.workOrderItemId }, include: { workOrder: true, activity: true } });
  if (!woi) throw bad('Work order line not found');
  const wo = woi.workOrder;
  if (wo.projectId !== projectId) throw bad('Work order belongs to another project');
  if (wo.status !== 'APPROVED') throw bad(`Work order ${wo.woNo} is ${wo.status}; measurements need an approved work order`);
  if (woi.activity.status !== 'APPROVED') throw bad('Activity breakup is not approved');
  const today = new Date(); today.setHours(23, 59, 59, 999);
  if (i.date > today) throw bad('Measurement date cannot be in the future');
  if (!i.lines.length) throw bad('At least one measurement line is required');

  let calc;
  try { calc = computeMeasurement(i.type, i.lines, woi.unit); } catch (e) { throw bad((e as Error).message); }
  const quantity = calc.total;
  if (quantity.lte(0)) throw bad('Measured quantity must be greater than zero');

  // Header chainage derives from line chainages when not given.
  const chs = i.lines.filter((l) => has(l.chainageFrom) && has(l.chainageTo) && !l.isDeduction);
  const chainageFrom = has(i.chainageFrom) ? D(i.chainageFrom!) : chs.length ? chs.map((l) => D(l.chainageFrom!)).reduce((a, b) => (a.lt(b) ? a : b)) : null;
  const chainageTo = has(i.chainageTo) ? D(i.chainageTo!) : chs.length ? chs.map((l) => D(l.chainageTo!)).reduce((a, b) => (a.gt(b) ? a : b)) : null;
  const ranges: [string, string][] = chs.length ? chs.map((l) => [D(l.chainageFrom!).toString(), D(l.chainageTo!).toString()]) : chainageFrom && chainageTo ? [[chainageFrom.toString(), chainageTo.toString()]] : [];

  const errors: string[] = [];
  const boqItem = await boqItemInForce(woi.activity.contractId, woi.activity.itemKey, i.date, tx);

  let allocation = null;
  if (i.allocationId) {
    allocation = await tx.workAllocation.findUnique({ where: { id: i.allocationId } });
    if (!allocation || allocation.workOrderItemId !== woi.id) errors.push('Allocation does not belong to this work order line');
    else if (allocation.status !== 'ACTIVE') errors.push(`Allocation is ${allocation.status}`);
  }

  const live = await tx.measurement.findMany({
    where: { activityId: woi.activityId, status: { in: [...LIVE_MEASUREMENT] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    include: { lines: true, workOrder: { select: { woNo: true, subcontractor: { select: { name: true } } } } },
  });
  // 1. Overlapping chainage / zone against any other live measurement of the same activity (any subcontractor).
  for (const m of live) {
    if (m.reversalOfId || m.reversedById) continue;
    const mRanges: [string, string][] = m.lines.filter((l) => l.chainageFrom && l.chainageTo && !l.isDeduction).map((l) => [l.chainageFrom!.toString(), l.chainageTo!.toString()]);
    if (!mRanges.length && m.chainageFrom && m.chainageTo) mRanges.push([m.chainageFrom.toString(), m.chainageTo.toString()]);
    for (const [f, t] of ranges) for (const [mf, mt] of mRanges) {
      if (chainageOverlaps(f, t, mf, mt)) errors.push(`Chainage ${f}–${t} overlaps ${mf}–${mt} already recorded in ${m.measurementNo} (${m.workOrder.subcontractor.name}, ${m.status})`);
    }
    if (i.zone && m.zone && m.zone.trim().toLowerCase() === i.zone.trim().toLowerCase() && i.structure && m.structure && m.structure.trim().toLowerCase() === i.structure.trim().toLowerCase())
      errors.push(`Structure "${i.structure}" in zone "${i.zone}" is already measured in ${m.measurementNo}`);
  }
  // 2. Quantity ceilings: allocation → work order line → BOQ scope.
  const sumQ = (pred: (m: (typeof live)[number]) => boolean) => live.filter(pred).reduce((s, m) => s.plus(m.quantity.toString()), D(0));
  if (allocation) {
    const used = sumQ((m) => m.allocationId === allocation!.id);
    if (used.plus(quantity).gt(allocation.quantity.toString())) errors.push(`Cumulative ${used.plus(quantity)} exceeds allocated ${allocation.quantity} ${woi.unit}`);
  }
  const onWoi = sumQ((m) => m.workOrderItemId === woi.id);
  if (onWoi.plus(quantity).gt(woi.quantity.toString())) errors.push(`Cumulative ${onWoi.plus(quantity)} exceeds work order quantity ${woi.quantity} ${woi.unit}; an amendment is required`);
  const { scope } = await activityScope(tx, woi.activityId);
  const onAct = sumQ(() => true);
  if (onAct.plus(quantity).gt(scope)) errors.push(`Cumulative ${onAct.plus(quantity)} exceeds BOQ scope ${scope} ${woi.unit}; the BOQ must be revised (deviation)`);
  if (errors.length) throw bad('Measurement failed safeguards', errors);

  return {
    woi, boqItem, quantity, calc, chainageFrom: chainageFrom?.toString() ?? null, chainageTo: chainageTo?.toString() ?? null,
    lineData: i.lines.map((l, idx) => ({
      lineNo: idx + 1, description: l.description ?? null, nos: has(l.nos) ? String(l.nos) : null, length: has(l.length) ? String(l.length) : null, breadth: has(l.breadth) ? String(l.breadth) : null,
      depth: has(l.depth) ? String(l.depth) : null, chainageFrom: has(l.chainageFrom) ? String(l.chainageFrom) : null, chainageTo: has(l.chainageTo) ? String(l.chainageTo) : null,
      barDia: has(l.barDia) ? String(l.barDia) : null, cuttingLength: has(l.cuttingLength) ? String(l.cuttingLength) : null, unitWeight: has(l.unitWeight) ? String(l.unitWeight) : null,
      directQty: has(l.directQty) ? String(l.directQty) : null, isDeduction: !!l.isDeduction, quantity: calc.lines[idx].quantity.toString(), formula: calc.lines[idx].formula,
    })),
  };
}

export const linesToInput = (lines: { description: string | null; nos: unknown; length: unknown; breadth: unknown; depth: unknown; chainageFrom: unknown; chainageTo: unknown; barDia: unknown; cuttingLength: unknown; unitWeight: unknown; directQty: unknown; isDeduction: boolean }[]): MeasurementLineInput[] =>
  lines.map((l) => ({ description: l.description, nos: l.nos?.toString() ?? null, length: l.length?.toString() ?? null, breadth: l.breadth?.toString() ?? null, depth: l.depth?.toString() ?? null, chainageFrom: l.chainageFrom?.toString() ?? null, chainageTo: l.chainageTo?.toString() ?? null, barDia: l.barDia?.toString() ?? null, cuttingLength: l.cuttingLength?.toString() ?? null, unitWeight: l.unitWeight?.toString() ?? null, directQty: l.directQty?.toString() ?? null, isDeduction: l.isDeduction }));
