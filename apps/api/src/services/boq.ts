import { randomUUID } from 'node:crypto';
import { D, money } from '@epc/shared';
import type { Tx } from '../lib/db';
import { prisma } from '../lib/db';
import { bad, conflict, notFound } from '../lib/errors';

/** The approved (or since-superseded) revision that governed the contract on a given date. */
export async function revisionInForce(contractId: string, date: Date, db: Tx | typeof prisma = prisma) {
  const revs = await db.boqRevision.findMany({ where: { contractId, status: { in: ['APPROVED', 'SUPERSEDED'] } }, orderBy: { revisionNo: 'desc' } });
  return revs.find((r) => !r.effectiveDate || r.effectiveDate <= date) ?? revs[revs.length - 1] ?? null;
}
export async function currentRevision(contractId: string, db: Tx | typeof prisma = prisma) {
  return db.boqRevision.findFirst({ where: { contractId, status: 'APPROVED' } });
}

/** The BOQ item (by stable key) in the revision in force on a date. */
export async function boqItemInForce(contractId: string, itemKey: string, date: Date, db: Tx | typeof prisma = prisma) {
  const rev = await revisionInForce(contractId, date, db);
  if (!rev) throw bad('Contract has no approved BOQ revision');
  const item = await db.boqItem.findUnique({ where: { revisionId_itemKey: { revisionId: rev.id, itemKey } } });
  if (!item) throw bad(`BOQ item is not part of revision R${rev.revisionNo} in force on ${date.toISOString().slice(0, 10)}`);
  return item;
}

export async function assertDraft(tx: Tx, revisionId: string) {
  const rev = await tx.boqRevision.findUnique({ where: { id: revisionId } });
  if (!rev) throw notFound('BOQ revision');
  if (rev.status !== 'DRAFT') throw conflict(`BOQ revision R${rev.revisionNo} is ${rev.status}; only draft revisions can be edited`);
  return rev;
}

export async function recomputeRevisionTotals(tx: Tx, revisionId: string) {
  const items = await tx.boqItem.findMany({ where: { revisionId, isHeader: false } });
  return money(items.reduce((s, i) => s.plus(i.amount.toString()), D(0)));
}

/** Create a new draft revision, copying all items (with their stable keys) from an approved base. */
export async function createRevision(tx: Tx, contractId: string, userId: string, input: { type: 'ORIGINAL' | 'REVISED' | 'VARIATION'; title: string; basedOnId?: string | null; authorityRef?: string | null; remarks?: string | null; sourceDocumentId?: string | null }) {
  const open = await tx.boqRevision.findFirst({ where: { contractId, status: { in: ['DRAFT', 'SUBMITTED'] } } });
  if (open) throw conflict(`Revision R${open.revisionNo} is still ${open.status}. Approve, reject or discard it first.`);
  const approved = await tx.boqRevision.findFirst({ where: { contractId, status: 'APPROVED' } });
  if (input.type === 'ORIGINAL' && approved) throw conflict('An approved BOQ already exists; create a REVISED or VARIATION revision');
  if (input.type !== 'ORIGINAL' && !approved) throw bad('The original BOQ must be approved before revisions');
  const basedOnId = input.type === 'ORIGINAL' ? null : (input.basedOnId ?? approved!.id);
  if (basedOnId && basedOnId !== approved?.id) throw bad('Revisions must be based on the current approved revision');
  const last = await tx.boqRevision.findFirst({ where: { contractId }, orderBy: { revisionNo: 'desc' } });
  const rev = await tx.boqRevision.create({
    data: { contractId, revisionNo: (last?.revisionNo ?? -1) + 1, type: input.type, title: input.title, basedOnId, authorityRef: input.authorityRef, remarks: input.remarks, sourceDocumentId: input.sourceDocumentId, createdById: userId },
  });
  if (basedOnId) {
    const sections = await tx.boqSection.findMany({ where: { revisionId: basedOnId } });
    const secMap = new Map<string, string>();
    for (const s of sections) {
      const ns = await tx.boqSection.create({ data: { revisionId: rev.id, code: s.code, name: s.name, sortOrder: s.sortOrder } });
      secMap.set(s.id, ns.id);
    }
    const items = await tx.boqItem.findMany({ where: { revisionId: basedOnId } });
    await tx.boqItem.createMany({
      data: items.map(({ id: _id, revisionId: _r, sectionId, ...i }) => ({ ...i, revisionId: rev.id, sectionId: sectionId ? secMap.get(sectionId) ?? null : null })),
    });
  }
  return rev;
}

export interface ItemInput { itemNo: string; description: string; unit: string; quantity: string; rate: string; sectionId?: string | null; isHeader?: boolean; kind?: 'ORIGINAL' | 'EXTRA' | 'SUBSTITUTED' | 'DEVIATED'; substitutesKey?: string | null; specRef?: string | null; drawingRef?: string | null; contractRef?: string | null; sortOrder?: number }

export async function addItem(tx: Tx, revisionId: string, i: ItemInput) {
  const rev = await assertDraft(tx, revisionId);
  const dup = await tx.boqItem.findFirst({ where: { revisionId, itemNo: { equals: i.itemNo, mode: 'insensitive' } } });
  if (dup) throw conflict(`Item number ${i.itemNo} already exists in this revision`);
  const max = await tx.boqItem.aggregate({ where: { revisionId }, _max: { sortOrder: true } });
  const kind = i.kind ?? (rev.type === 'ORIGINAL' ? 'ORIGINAL' : 'EXTRA');
  if (kind === 'SUBSTITUTED' && !i.substitutesKey) throw bad('A substituted item must reference the item it substitutes');
  return tx.boqItem.create({
    data: {
      revisionId, itemKey: randomUUID(), itemNo: i.itemNo, description: i.description, unit: i.unit, quantity: i.isHeader ? 0 : i.quantity, rate: i.isHeader ? 0 : i.rate,
      amount: i.isHeader ? 0 : money(D(i.quantity).times(i.rate)).toString(), isHeader: !!i.isHeader, kind, substitutesKey: i.substitutesKey, sectionId: i.sectionId ?? null,
      specRef: i.specRef, drawingRef: i.drawingRef, contractRef: i.contractRef, sortOrder: i.sortOrder ?? (max._max.sortOrder ?? 0) + 10,
    },
  });
}

/** Validation before submission/approval. */
export async function validateRevision(tx: Tx, revisionId: string) {
  const rev = await tx.boqRevision.findUniqueOrThrow({ where: { id: revisionId } });
  const items = await tx.boqItem.findMany({ where: { revisionId } });
  const errors: string[] = [];
  const warnings: string[] = [];
  const nos = new Map<string, number>();
  for (const i of items) {
    const k = i.itemNo.toUpperCase();
    nos.set(k, (nos.get(k) ?? 0) + 1);
    if (!i.isHeader && D(i.quantity.toString()).lt(0)) errors.push(`${i.itemNo}: negative quantity`);
  }
  for (const [k, n] of nos) if (n > 1) errors.push(`Item number ${k} appears ${n} times`);
  if (!items.some((i) => !i.isHeader)) errors.push('Revision has no BOQ items');
  if (rev.basedOnId) {
    // Items already measured must still exist, and should not drop below approved measured quantity.
    const keys = new Set(items.map((i) => i.itemKey));
    const measured = await tx.measurement.groupBy({
      by: ['activityId'], where: { status: { in: ['PM_APPROVED', 'COMMERCIAL_REVIEWED', 'CERTIFIED'] }, activity: { contractId: rev.contractId } }, _sum: { quantity: true },
    });
    const acts = await tx.executionActivity.findMany({ where: { id: { in: measured.map((m) => m.activityId) } } });
    for (const m of measured) {
      const a = acts.find((x) => x.id === m.activityId)!;
      if (!keys.has(a.itemKey)) errors.push(`An item with approved measurements (activity ${a.code}) has been removed from the revision`);
      else {
        const item = items.find((i) => i.itemKey === a.itemKey)!;
        const scope = D(item.quantity.toString()).times(a.conversionFactor.toString());
        if (scope.lt(m._sum.quantity?.toString() ?? 0)) warnings.push(`${item.itemNo} / ${a.code}: revised scope ${scope.toFixed(3)} is below approved measured ${m._sum.quantity}`);
      }
    }
  }
  return { errors, warnings, total: await recomputeRevisionTotals(tx, revisionId) };
}

/** Item-by-item comparison of a revision with the revision it was based on. */
export async function compareRevision(revisionId: string) {
  const rev = await prisma.boqRevision.findUniqueOrThrow({ where: { id: revisionId } });
  const cur = await prisma.boqItem.findMany({ where: { revisionId }, orderBy: { sortOrder: 'asc' } });
  const base = rev.basedOnId ? await prisma.boqItem.findMany({ where: { revisionId: rev.basedOnId } }) : [];
  const baseMap = new Map(base.map((b) => [b.itemKey, b]));
  const rows = cur.filter((c) => !c.isHeader).map((c) => {
    const b = baseMap.get(c.itemKey);
    baseMap.delete(c.itemKey);
    const dq = b ? D(c.quantity.toString()).minus(b.quantity.toString()) : D(c.quantity.toString());
    const change = !b ? 'ADDED' : !dq.isZero() || !D(c.rate.toString()).eq(b.rate.toString()) || c.description !== b.description || c.unit !== b.unit ? 'CHANGED' : 'UNCHANGED';
    return { itemKey: c.itemKey, itemNo: c.itemNo, description: c.description, unit: c.unit, kind: c.kind, change, baseQuantity: b?.quantity ?? null, quantity: c.quantity, quantityDelta: dq.toString(), baseRate: b?.rate ?? null, rate: c.rate, baseAmount: b?.amount ?? null, amount: c.amount, amountDelta: money(D(c.amount.toString()).minus(b?.amount.toString() ?? 0)).toString() };
  });
  for (const b of baseMap.values()) if (!b.isHeader) rows.push({ itemKey: b.itemKey, itemNo: b.itemNo, description: b.description, unit: b.unit, kind: b.kind, change: 'REMOVED', baseQuantity: b.quantity, quantity: D(0) as never, quantityDelta: D(b.quantity.toString()).negated().toString(), baseRate: b.rate, rate: b.rate, baseAmount: b.amount, amount: D(0) as never, amountDelta: D(b.amount.toString()).negated().toString() });
  return rows;
}
