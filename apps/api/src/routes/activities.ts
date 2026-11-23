import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityMargin, computeBreakup, D, money, UNIT_CODES, standardConversion, type UnitCode } from '@epc/shared';
import { prisma } from '../lib/db';
import { requirePermission } from '../lib/auth';
import { audit, logWorkflow } from '../lib/audit';
import { bad, conflict, notFound } from '../lib/errors';
import { idParam, zDec, zDecOpt, zId } from '../lib/zod';
import { currentRevision } from '../services/boq';

async function ctx(contractId: string, itemKey: string) {
  const c = await prisma.contract.findUnique({ where: { id: contractId }, include: { project: true } });
  if (!c) throw notFound('Contract');
  const rev = await currentRevision(contractId);
  if (!rev) throw bad('Contract has no approved BOQ revision');
  const item = await prisma.boqItem.findUnique({ where: { revisionId_itemKey: { revisionId: rev.id, itemKey } } });
  if (!item) throw notFound('BOQ item in current revision');
  if (item.isHeader) throw bad('Heading rows cannot be broken down');
  return { contract: c, rev, item, scope: { companyId: c.project.companyId, projectId: c.projectId } };
}

const actBody = z.object({
  id: zId.optional(), code: z.string().min(1).max(20), name: z.string().min(2), method: z.enum(['PERCENT', 'FIXED_RATE']),
  percentage: zDecOpt, fixedRate: zDecOpt, unit: z.enum(UNIT_CODES as [string, ...string[]]), conversionFactor: zDec, conversionBasis: z.string().nullable().optional(),
});

const routes: FastifyPluginAsyncZod = async (app) => {
  /** Breakup + rate layers for one BOQ item: client rate → internal budget → subcontract rates → margin. */
  app.get('/contracts/:id/items/:itemKey/breakup', { schema: { tags: ['activities'], params: z.object({ id: zId, itemKey: z.string() }) } }, async (req) => {
    const { item, scope, rev } = await ctx(req.params.id, req.params.itemKey);
    await requirePermission(req.user, 'project.view', scope);
    const acts = await prisma.executionActivity.findMany({
      where: { contractId: req.params.id, itemKey: req.params.itemKey, active: true }, orderBy: { sequence: 'asc' },
      include: { workOrderItems: { include: { workOrder: { select: { id: true, woNo: true, status: true, subcontractor: { select: { id: true, name: true, code: true } } } } } } },
    });
    const calc = computeBreakup({ clientRate: item.rate.toString(), quantity: item.quantity.toString(), unit: item.unit }, acts.map((a) => ({ code: a.code, name: a.name, method: a.method, percentage: a.percentage?.toString(), fixedRate: a.fixedRate?.toString(), unit: a.unit, conversionFactor: a.conversionFactor.toString() })));
    // Measured/approved quantities per activity for actual-cost view
    const measured = await prisma.measurement.groupBy({ by: ['activityId', 'workOrderItemId'], where: { activityId: { in: acts.map((a) => a.id) }, status: { in: ['PM_APPROVED', 'COMMERCIAL_REVIEWED', 'CERTIFIED'] } }, _sum: { quantity: true } });
    const layers = acts.map((a, idx) => {
      const c = calc.activities[idx];
      const contracts = a.workOrderItems.filter((w) => w.workOrder.status === 'APPROVED').map((w) => {
        const q = measured.find((m) => m.workOrderItemId === w.id)?._sum.quantity?.toString() ?? '0';
        const m = activityMargin(c.budgetRatePerActivityUnit, w.rate.toString(), q);
        const mWo = activityMargin(c.budgetRatePerActivityUnit, w.rate.toString(), w.quantity.toString());
        return { workOrderItemId: w.id, workOrder: w.workOrder.woNo, subcontractor: w.workOrder.subcontractor, rate: w.rate, quantity: w.quantity, value: w.amount, marginPerUnit: m.perUnit, plannedMargin: mWo.total, approvedQty: q, actualCost: money(D(q).times(w.rate.toString())), earnedBudget: money(D(q).times(c.budgetRatePerActivityUnit)), marginOnApproved: m.total };
      });
      const draftContracts = a.workOrderItems.filter((w) => w.workOrder.status !== 'APPROVED').map((w) => ({ workOrder: w.workOrder.woNo, status: w.workOrder.status, rate: w.rate, quantity: w.quantity }));
      return { ...a, calc: c, contracts, draftContracts };
    });
    return { revision: { id: rev.id, revisionNo: rev.revisionNo }, item, calc, activities: layers };
  });

  /** Replace the breakup of a BOQ item. Activities already referenced by work orders can be edited (not deleted); approved breakups return to draft. */
  app.put('/contracts/:id/items/:itemKey/breakup', { schema: { tags: ['activities'], params: z.object({ id: zId, itemKey: z.string() }), body: z.object({ activities: z.array(actBody).min(1), reason: z.string().optional() }) } }, async (req) => {
    const { item, scope } = await ctx(req.params.id, req.params.itemKey);
    await requirePermission(req.user, 'activity.edit', scope);
    const input = req.body.activities;
    for (const a of input) {
      if (a.method === 'PERCENT' && (a.percentage === undefined || a.percentage === null)) throw bad(`${a.code}: percentage is required`);
      if (a.method === 'FIXED_RATE' && (a.fixedRate === undefined || a.fixedRate === null)) throw bad(`${a.code}: fixed rate is required`);
      // Non-identical units need a stated engineering basis.
      const std = standardConversion(item.unit as UnitCode, a.unit as UnitCode);
      if ((!std || !std.eq(a.conversionFactor)) && !a.conversionBasis) throw bad(`${a.code}: conversion ${item.unit} → ${a.unit} at ${a.conversionFactor} needs an engineering basis`);
    }
    const calc = computeBreakup({ clientRate: item.rate.toString(), quantity: item.quantity.toString(), unit: item.unit }, input.map((a) => ({ ...a, percentage: a.percentage ?? null, fixedRate: a.fixedRate ?? null })));
    if (calc.errors.length) throw bad('Breakup is not valid', calc.errors);
    return prisma.$transaction(async (tx) => {
      const existing = await tx.executionActivity.findMany({ where: { contractId: req.params.id, itemKey: req.params.itemKey }, include: { _count: { select: { workOrderItems: true, measurements: true } } } });
      const keepIds = new Set(input.filter((a) => a.id).map((a) => a.id));
      for (const e of existing.filter((x) => x.active && !keepIds.has(x.id))) {
        if (e._count.workOrderItems || e._count.measurements) throw conflict(`Activity ${e.code} is used by work orders or measurements and cannot be removed`);
        await tx.executionActivity.delete({ where: { id: e.id } });
      }
      let seq = 0;
      for (const a of input) {
        seq += 10;
        const data = { code: a.code, name: a.name, method: a.method, percentage: a.method === 'PERCENT' ? a.percentage : null, fixedRate: a.method === 'FIXED_RATE' ? a.fixedRate : null, unit: a.unit, conversionFactor: a.conversionFactor, conversionBasis: a.conversionBasis ?? null, sequence: seq, status: 'DRAFT' as const, approvedById: null, approvedAt: null };
        if (a.id) {
          const e = existing.find((x) => x.id === a.id);
          if (!e) throw bad('Unknown activity id');
          if (e._count.measurements && (e.unit !== a.unit || !D(e.conversionFactor.toString()).eq(a.conversionFactor))) throw conflict(`${e.code}: unit/conversion cannot change after measurements exist`);
          await tx.executionActivity.update({ where: { id: a.id }, data });
        } else {
          await tx.executionActivity.create({ data: { ...data, contractId: req.params.id, itemKey: req.params.itemKey } });
        }
      }
      await audit(tx, req.user, { entityType: 'BoqBreakup', entityId: `${req.params.id}:${req.params.itemKey}`, action: 'SAVE', before: existing, after: input, reason: req.body.reason, ...scope });
      return { calc };
    });
  });

  app.post('/contracts/:id/items/:itemKey/breakup/approve', { schema: { tags: ['activities'], params: z.object({ id: zId, itemKey: z.string() }), body: z.object({ comment: z.string().optional() }) } }, async (req) => {
    const { item, scope } = await ctx(req.params.id, req.params.itemKey);
    await requirePermission(req.user, 'activity.approve', scope);
    const acts = await prisma.executionActivity.findMany({ where: { contractId: req.params.id, itemKey: req.params.itemKey, active: true } });
    if (!acts.length) throw bad('No activities to approve');
    const calc = computeBreakup({ clientRate: item.rate.toString(), quantity: item.quantity.toString(), unit: item.unit }, acts.map((a) => ({ code: a.code, name: a.name, method: a.method, percentage: a.percentage?.toString(), fixedRate: a.fixedRate?.toString(), unit: a.unit, conversionFactor: a.conversionFactor.toString() })));
    if (calc.errors.length) throw bad('Breakup is not valid', calc.errors);
    return prisma.$transaction(async (tx) => {
      await tx.executionActivity.updateMany({ where: { id: { in: acts.map((a) => a.id) } }, data: { status: 'APPROVED', approvedById: req.user.id, approvedAt: new Date() } });
      for (const a of acts) await logWorkflow(tx, req.user, { entityType: 'ExecutionActivity', entityId: a.id, action: 'approve', fromStatus: a.status, toStatus: 'APPROVED', comment: req.body.comment });
      await audit(tx, req.user, { entityType: 'BoqBreakup', entityId: `${req.params.id}:${req.params.itemKey}`, action: 'APPROVE', after: calc, reason: req.body.comment, ...scope });
      return { ok: true, warnings: calc.warnings };
    });
  });

  /** All activities of a contract (for pickers), with parent BOQ item from current revision. */
  app.get('/contracts/:id/activities', { schema: { tags: ['activities'], params: idParam } }, async (req) => {
    const c = await prisma.contract.findUnique({ where: { id: req.params.id }, include: { project: true } });
    if (!c) throw notFound('Contract');
    await requirePermission(req.user, 'project.view', { companyId: c.project.companyId, projectId: c.projectId });
    const rev = await currentRevision(c.id);
    const items = rev ? await prisma.boqItem.findMany({ where: { revisionId: rev.id } }) : [];
    const acts = await prisma.executionActivity.findMany({ where: { contractId: c.id, active: true }, orderBy: [{ itemKey: 'asc' }, { sequence: 'asc' }] });
    return acts.map((a) => {
      const it = items.find((i) => i.itemKey === a.itemKey);
      return { ...a, boqItem: it ? { id: it.id, itemNo: it.itemNo, description: it.description, unit: it.unit, quantity: it.quantity, rate: it.rate } : null, scopeQuantity: it ? D(it.quantity.toString()).times(a.conversionFactor.toString()).toDecimalPlaces(3).toString() : null };
    });
  });
};
export default routes;
