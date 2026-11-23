import { D, Decimal, money, qty, reconcile, standardConversion, type UnitCode, APPROVED_MEASUREMENT } from '@epc/shared';
import type { Tx } from '../lib/db';
import { prisma } from '../lib/db';
import { bad } from '../lib/errors';

type Db = Tx | typeof prisma;

/** On-hand quantity and weighted-average rate of a material in a store (optionally a batch). */
export async function stockPosition(db: Db, storeId: string, materialId: string, batchNo?: string | null, asOf?: Date) {
  const rows = await db.stockTransaction.findMany({ where: { storeId, materialId, ...(batchNo ? { batchNo } : {}), ...(asOf ? { date: { lte: asOf } } : {}) }, select: { quantity: true, value: true } });
  const q = rows.reduce((s, r) => s.plus(r.quantity.toString()), D(0));
  const v = rows.reduce((s, r) => s.plus(r.value.toString()), D(0));
  return { quantity: qty(q), value: money(v), avgRate: q.gt(0) ? v.div(q).toDecimalPlaces(4) : D(0) };
}

/** Net material held by a subcontractor (issues − returns), optionally for one work order, up to a date. */
export async function contractorBalance(db: Db, subcontractorId: string, materialId: string, opts: { workOrderId?: string | null; before?: Date; upTo?: Date; from?: Date } = {}) {
  const dateF = { ...(opts.before ? { lt: opts.before } : {}), ...(opts.upTo ? { lte: opts.upTo } : {}), ...(opts.from ? { gte: opts.from } : {}) };
  const issues = await db.materialIssueLine.findMany({ where: { materialId, issue: { subcontractorId, status: { not: 'CANCELLED' }, ...(opts.workOrderId ? { workOrderId: opts.workOrderId } : {}), date: dateF } } });
  const rets = await db.materialReturnLine.findMany({ where: { materialId, ret: { subcontractorId, ...(opts.workOrderId ? { workOrderId: opts.workOrderId } : {}), date: dateF } } });
  const issued = issues.reduce((s, l) => s.plus(l.quantity.toString()), D(0));
  const issueValue = issues.reduce((s, l) => s.plus(l.issueValue.toString()), D(0));
  const recoverable = issues.filter((l) => D(l.recoveryRate.toString()).gt(0));
  const recQty = recoverable.reduce((s, l) => s.plus(l.quantity.toString()), D(0));
  const recRate = recQty.gt(0) ? recoverable.reduce((s, l) => s.plus(D(l.quantity.toString()).times(l.recoveryRate.toString())), D(0)).div(recQty) : D(0);
  const returned = rets.reduce((s, l) => s.plus(l.quantity.toString()), D(0));
  const damaged = rets.filter((l) => l.condition === 'DAMAGED').reduce((s, l) => s.plus(l.quantity.toString()), D(0));
  return { issued: qty(issued), returned: qty(returned), damaged: qty(damaged), balance: qty(issued.minus(returned)), avgIssueRate: issued.gt(0) ? issueValue.div(issued).toDecimalPlaces(4) : D(0), avgRecoveryRate: recRate.toDecimalPlaces(4) };
}

/** Converts a norm quantity into the material's stock unit. */
export function normToBase(m: { unit: string; altUnit: string | null; altFactor: Decimal.Value | null }, normUnit: string, v: Decimal.Value) {
  if (normUnit === m.unit) return D(v);
  if (m.altUnit && normUnit === m.altUnit && m.altFactor) return D(v).div(D(m.altFactor));
  const std = standardConversion(normUnit as UnitCode, m.unit as UnitCode);
  if (std) return D(v).times(std);
  throw bad(`No conversion from ${normUnit} to ${m.unit}`);
}

export interface ReconRequest { subcontractorId: string; workOrderId?: string | null; periodFrom: Date; periodTo: Date; isFinal?: boolean; closingStock?: Record<string, string | null>; penalRates?: Record<string, string> }

/** Builds the A–J reconciliation statement for every material issued to the subcontractor or governed by a norm on its work. */
export async function buildReconciliation(db: Db, projectId: string, r: ReconRequest) {
  const issuedMaterials = await db.materialIssueLine.findMany({ where: { issue: { projectId, subcontractorId: r.subcontractorId, status: { not: 'CANCELLED' }, ...(r.workOrderId ? { workOrderId: r.workOrderId } : {}) } }, select: { materialId: true, basis: true }, distinct: ['materialId'] });
  // Approved work in period by activity (net of reversals) for this subcontractor
  const meas = await db.measurement.groupBy({ by: ['activityId'], where: { projectId, status: { in: [...APPROVED_MEASUREMENT] }, date: { gte: r.periodFrom, lte: r.periodTo }, workOrder: { subcontractorId: r.subcontractorId }, ...(r.workOrderId ? { workOrderId: r.workOrderId } : {}) }, _sum: { quantity: true } });
  const measBefore = await db.measurement.groupBy({ by: ['activityId'], where: { projectId, status: { in: [...APPROVED_MEASUREMENT] }, date: { lt: r.periodFrom }, workOrder: { subcontractorId: r.subcontractorId }, ...(r.workOrderId ? { workOrderId: r.workOrderId } : {}) }, _sum: { quantity: true } });
  const actIds = [...new Set([...meas, ...measBefore].map((m) => m.activityId))];
  const norms = await db.consumptionNorm.findMany({ where: { projectId, activityId: { in: actIds }, status: 'APPROVED' }, include: { activity: { select: { code: true, name: true, unit: true } } } });
  const materialIds = [...new Set([...issuedMaterials.map((m) => m.materialId), ...norms.map((n) => n.materialId)])];
  const materials = await db.material.findMany({ where: { id: { in: materialIds } } });
  const lines = [];
  for (const mat of materials) {
    const basis = issuedMaterials.find((i) => i.materialId === mat.id)?.basis ?? mat.defaultBasis;
    if (basis === 'SUBCONTRACTOR_SUPPLIED' || basis === 'RETURNABLE') continue;
    // Opening: last approved reconciliation closing, else book balance before the period (net issue − theoretical).
    const prior = await db.materialReconciliation.findFirst({ where: { projectId, subcontractorId: r.subcontractorId, workOrderId: r.workOrderId ?? null, status: 'APPROVED', periodTo: { lt: r.periodFrom } }, orderBy: { periodTo: 'desc' } });
    const priorLine = prior ? (prior.lines as { materialId: string; closingStock: string }[]).find((l) => l.materialId === mat.id) : undefined;
    const issuedFrom = prior ? new Date(prior.periodTo.getTime() + 1) : r.periodFrom;
    let opening = D(0);
    let openingBasis = 'No earlier movement';
    if (priorLine) { opening = D(priorLine.closingStock); openingBasis = `Closing of ${prior!.reconNo}`; }
    else {
      const before = await contractorBalance(db, r.subcontractorId, mat.id, { workOrderId: r.workOrderId, before: r.periodFrom });
      const theoBefore = norms.filter((n) => n.materialId === mat.id).reduce((s, n) => s.plus(D(measBefore.find((m) => m.activityId === n.activityId)?._sum.quantity?.toString() ?? 0).times(normToBase(mat, n.normUnit, n.normQty.toString()))), D(0));
      if (!before.issued.isZero()) { opening = Decimal.max(0, before.balance.minus(theoBefore)); openingBasis = 'Book balance before period (net issue − theoretical consumption)'; }
    }
    const mov = await contractorBalance(db, r.subcontractorId, mat.id, { workOrderId: r.workOrderId, from: issuedFrom, upTo: endOfDay(r.periodTo) });
    const life = await contractorBalance(db, r.subcontractorId, mat.id, { workOrderId: r.workOrderId });
    const theoParts = norms.filter((n) => n.materialId === mat.id).map((n) => {
      const work = D(meas.find((m) => m.activityId === n.activityId)?._sum.quantity?.toString() ?? 0);
      const perUnit = normToBase(mat, n.normUnit, n.normQty.toString());
      const theo = work.times(perUnit);
      return { activity: `${n.activity.code} ${n.activity.name}`, workQty: work.toString(), workUnit: n.activity.unit, norm: `${n.normQty} ${n.normUnit}/${n.activity.unit}`, wastagePercent: n.wastagePercent.toString(), theoretical: qty(theo).toString(), wastage: qty(theo.times(n.wastagePercent.toString()).div(100)).toString(), basis: n.basis };
    });
    const theoretical = theoParts.reduce((s, p) => s.plus(p.theoretical), D(0));
    const wastage = theoParts.reduce((s, p) => s.plus(p.wastage), D(0));
    const effWastage = theoretical.gt(0) ? wastage.div(theoretical).times(100) : D(0);
    const closingRaw = r.closingStock?.[mat.id];
    const recoveryRate = r.penalRates?.[mat.id] ?? (life.avgRecoveryRate.gt(0) ? life.avgRecoveryRate : life.avgIssueRate).toString();
    const res = reconcile({ opening, issued: mov.issued, returned: mov.returned, theoretical, wastagePercent: effWastage, closingStock: closingRaw ?? null, recoveryRate, issueRate: life.avgIssueRate, isFinal: r.isFinal });
    const damageRecovery = money(mov.damaged.times(life.avgIssueRate));
    const flags = [...res.flags];
    if (!theoParts.length) flags.push('No approved consumption norm for the work executed; theoretical consumption is zero');
    if (mov.damaged.gt(0)) flags.push(`${mov.damaged} ${mat.unit} returned damaged: recoverable at issue rate`);
    const alt = (v: Decimal) => (mat.altUnit && mat.altFactor ? qty(v.times(mat.altFactor.toString())).toString() : null);
    const plain = Object.fromEntries(Object.entries(res).filter(([k]) => k !== 'flags').map(([k, v]) => [k, (v as Decimal).toString()]));
    lines.push({
      materialId: mat.id, materialCode: mat.code, materialName: mat.name, unit: mat.unit, altUnit: mat.altUnit, altFactor: mat.altFactor?.toString() ?? null, basis,
      openingBasis, ...plain, wastagePercent: effWastage.toDecimalPlaces(3).toString(), recoveryRate, issueRate: life.avgIssueRate.toString(), damagedReturned: mov.damaged.toString(), damageRecovery: damageRecovery.toString(),
      totalRecoverable: money(res.totalRecoverable.plus(damageRecovery)).toString(), closingStockEntered: closingRaw ?? null,
      inAltUnit: mat.altUnit ? { opening: alt(res.opening), issued: alt(res.issued), returned: alt(res.returned), netIssued: alt(res.netIssued), theoretical: alt(res.theoretical), permissibleWastage: alt(res.permissibleWastage), actualConsumption: alt(res.actualConsumption), difference: alt(res.difference), excess: alt(res.excess), closingStock: alt(res.closingStock) } : null,
      theoreticalBreakdown: theoParts, flags,
    });
  }
  const total = money(lines.reduce((s, l) => s.plus(l.totalRecoverable), D(0)));
  return { lines, totalRecoverable: total.toString() };
}

const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
