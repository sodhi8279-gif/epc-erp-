import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { D, money } from '@epc/shared';
import { prisma } from '../lib/db';
import { requirePermission, projectScope } from '../lib/auth';
import { audit, logWorkflow } from '../lib/audit';
import { nextNo } from '../lib/sequence';
import { bad, conflict, notFound } from '../lib/errors';
import { idParam, zDate, zDec, zDecPos, zId } from '../lib/zod';
import { recomputeWoValue } from '../services/workorders';

const itemIn = z.object({ activityId: zId, description: z.string().optional(), quantity: zDecPos, rate: zDecPos });
const woBody = z.object({
  subcontractorId: zId, title: z.string().min(3), description: z.string().optional(), startDate: zDate.optional(), completionDate: zDate.optional(),
  materialResponsibility: z.enum(['COMPANY_RECOVERABLE', 'COMPANY_FREE_ISSUE', 'SUBCONTRACTOR', 'MIXED']).default('COMPANY_RECOVERABLE'),
  retentionPercent: zDec.optional(), securityDepositPercent: zDec.optional(), advanceAmount: zDec.optional(), advanceRecoveryPercent: zDec.optional(),
  paymentTerms: z.string().optional(), recoveryConditions: z.string().optional(), otherDeductions: z.string().optional(), woNo: z.string().optional(),
  items: z.array(itemIn).min(1),
});

async function woCtx(id: string) {
  const wo = await prisma.workOrder.findUnique({ where: { id }, include: { project: true } });
  if (!wo) throw notFound('Work order');
  return { wo, scope: { companyId: wo.project.companyId, projectId: wo.projectId } };
}

async function buildItems(projectId: string, items: z.infer<typeof itemIn>[]) {
  const acts = await prisma.executionActivity.findMany({ where: { id: { in: items.map((i) => i.activityId) } }, include: { contract: true } });
  const seen = new Set<string>();
  return items.map((i, idx) => {
    const a = acts.find((x) => x.id === i.activityId);
    if (!a) throw bad(`Activity not found (line ${idx + 1})`);
    if (a.contract.projectId !== projectId) throw bad(`Activity ${a.code} belongs to another project`);
    if (a.status !== 'APPROVED') throw bad(`Activity ${a.code} breakup is not approved`);
    if (seen.has(a.id)) throw bad(`Activity ${a.code} appears twice; use one line per activity`);
    seen.add(a.id);
    return { activityId: a.id, lineNo: idx + 1, description: i.description || a.name, unit: a.unit, quantity: i.quantity, rate: i.rate, amount: money(D(i.quantity).times(i.rate)).toString() };
  });
}

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get('/projects/:projectId/work-orders', { schema: { tags: ['work-orders'], params: z.object({ projectId: zId }), querystring: z.object({ subcontractorId: zId.optional(), status: z.string().optional() }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    return prisma.workOrder.findMany({ where: { projectId: req.params.projectId, subcontractorId: req.query.subcontractorId, ...(req.query.status ? { status: req.query.status as never } : {}) }, include: { subcontractor: { select: { id: true, name: true, code: true } }, _count: { select: { items: true } } }, orderBy: { createdAt: 'desc' } });
  });
  app.get('/work-orders/:id', { schema: { tags: ['work-orders'], params: idParam } }, async (req) => {
    const { scope } = await woCtx(req.params.id);
    await requirePermission(req.user, 'project.view', scope);
    const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: req.params.id }, include: { subcontractor: true, items: { orderBy: { lineNo: 'asc' }, include: { rates: { orderBy: { effectiveFrom: 'asc' } }, activity: true } }, amendments: { orderBy: { amendmentNo: 'asc' } } } });
    const measured = await prisma.measurement.groupBy({ by: ['workOrderItemId', 'status'], where: { workOrderId: wo.id, status: { not: 'REVERSED' } }, _sum: { quantity: true } });
    const allocated = await prisma.workAllocation.groupBy({ by: ['workOrderItemId'], where: { workOrderId: wo.id, status: { in: ['ACTIVE', 'PENDING_EXCEPTION'] } }, _sum: { quantity: true } });
    return { ...wo, items: wo.items.map((i) => ({ ...i, allocated: allocated.find((a) => a.workOrderItemId === i.id)?._sum.quantity ?? 0, approvedQty: measured.filter((m) => m.workOrderItemId === i.id && ['PM_APPROVED', 'COMMERCIAL_REVIEWED', 'CERTIFIED'].includes(m.status)).reduce((s, m) => s.plus(m._sum.quantity?.toString() ?? 0), D(0)).toString() })) };
  });
  app.post('/projects/:projectId/work-orders', { schema: { tags: ['work-orders'], params: z.object({ projectId: zId }), body: woBody } }, async (req) => {
    const scope = await projectScope(req.params.projectId);
    await requirePermission(req.user, 'workorder.edit', scope);
    const sub = await prisma.subcontractor.findUnique({ where: { id: req.body.subcontractorId } });
    if (!sub || sub.companyId !== scope.companyId) throw bad('Subcontractor not found in this company');
    if (['BLACKLISTED', 'SUSPENDED', 'INACTIVE'].includes(sub.status)) throw conflict(`Subcontractor is ${sub.status}`);
    const items = await buildItems(req.params.projectId, req.body.items);
    const { items: _i, woNo, ...rest } = req.body;
    return prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.create({ data: { ...rest, projectId: req.params.projectId, woNo: woNo || (await nextNo(tx, req.params.projectId, 'WO')), retentionPercent: rest.retentionPercent ?? sub.retentionPercent.toString(), createdById: req.user.id, items: { create: items } } });
      await recomputeWoValue(tx, wo.id);
      await audit(tx, req.user, { entityType: 'WorkOrder', entityId: wo.id, action: 'CREATE', after: req.body, ...scope });
      await logWorkflow(tx, req.user, { entityType: 'WorkOrder', entityId: wo.id, action: 'create', toStatus: 'DRAFT' });
      return tx.workOrder.findUniqueOrThrow({ where: { id: wo.id }, include: { items: true } });
    });
  });
  app.put('/work-orders/:id', { schema: { tags: ['work-orders'], params: idParam, body: woBody.omit({ subcontractorId: true, woNo: true }) } }, async (req) => {
    const { wo, scope } = await woCtx(req.params.id);
    await requirePermission(req.user, 'workorder.edit', scope);
    if (!['DRAFT', 'REJECTED'].includes(wo.status)) throw conflict('Only draft or rejected work orders can be edited; use an amendment');
    const items = await buildItems(wo.projectId, req.body.items);
    const { items: _i, ...rest } = req.body;
    return prisma.$transaction(async (tx) => {
      const before = await tx.workOrder.findUnique({ where: { id: wo.id }, include: { items: true } });
      await tx.workOrderItem.deleteMany({ where: { workOrderId: wo.id } });
      await tx.workOrder.update({ where: { id: wo.id }, data: { ...rest, status: 'DRAFT', items: { create: items } } });
      await recomputeWoValue(tx, wo.id);
      await audit(tx, req.user, { entityType: 'WorkOrder', entityId: wo.id, action: 'UPDATE', before, after: req.body, ...scope });
      return tx.workOrder.findUniqueOrThrow({ where: { id: wo.id }, include: { items: true } });
    });
  });

  const tBody = z.object({ comment: z.string().optional() });
  app.post('/work-orders/:id/:action', { schema: { tags: ['work-orders'], params: z.object({ id: zId, action: z.enum(['submit', 'approve', 'reject', 'suspend', 'close']) }), body: tBody } }, async (req) => {
    const { wo, scope } = await woCtx(req.params.id);
    const a = req.params.action;
    const map = { submit: { from: ['DRAFT', 'REJECTED'], to: 'SUBMITTED', perm: 'workorder.edit' }, approve: { from: ['SUBMITTED'], to: 'APPROVED', perm: 'workorder.approve' }, reject: { from: ['SUBMITTED'], to: 'REJECTED', perm: 'workorder.approve' }, suspend: { from: ['APPROVED'], to: 'SUSPENDED', perm: 'workorder.approve' }, close: { from: ['APPROVED', 'SUSPENDED'], to: 'CLOSED', perm: 'workorder.approve' } } as const;
    const t = map[a];
    if (!(t.from as readonly string[]).includes(wo.status)) throw conflict(`Cannot ${a} a ${wo.status} work order`);
    // Approval is limited by the approver's financial limit on the work order value.
    await requirePermission(req.user, t.perm, scope, a === 'approve' ? wo.value.toString() : undefined);
    if (['reject', 'suspend', 'close'].includes(a) && !req.body.comment) throw bad('A reason is required');
    if (a === 'approve') {
      if (wo.createdById === req.user.id && !req.user.isSuperAdmin) throw conflict('The person who drafted a work order cannot approve it');
      const sub = await prisma.subcontractor.findUniqueOrThrow({ where: { id: wo.subcontractorId } });
      if (sub.status !== 'ACTIVE') throw conflict('Subcontractor must be approved (ACTIVE) before a work order can be approved');
    }
    return prisma.$transaction(async (tx) => {
      const u = await tx.workOrder.update({ where: { id: wo.id }, data: { status: t.to, ...(a === 'approve' ? { approvedById: req.user.id, approvedAt: new Date() } : {}) } });
      if (a === 'approve') {
        const items = await tx.workOrderItem.findMany({ where: { workOrderId: wo.id } });
        await tx.workOrderItemRate.createMany({ data: items.map((i) => ({ workOrderItemId: i.id, rate: i.rate, effectiveFrom: wo.startDate ?? new Date(0), approvedById: req.user.id })) });
      }
      await logWorkflow(tx, req.user, { entityType: 'WorkOrder', entityId: wo.id, action: a, fromStatus: wo.status, toStatus: t.to, comment: req.body.comment });
      await audit(tx, req.user, { entityType: 'WorkOrder', entityId: wo.id, action: a.toUpperCase(), before: { status: wo.status }, after: { status: t.to }, reason: req.body.comment, ...scope });
      return u;
    });
  });

  // Amendments: rate/quantity changes and new lines. Rate changes are prospective unless a retrospective authority is cited.
  const change = z.object({ workOrderItemId: zId.optional(), activityId: zId.optional(), description: z.string().optional(), newRate: zDecPos.optional(), newQuantity: zDecPos.optional() });
  app.post('/work-orders/:id/amendments', { schema: { tags: ['work-orders'], params: idParam, body: z.object({ reason: z.string().min(5), effectiveFrom: zDate, retrospectiveAuthority: z.string().optional(), changes: z.array(change).min(1) }) } }, async (req) => {
    const { wo, scope } = await woCtx(req.params.id);
    await requirePermission(req.user, 'workorder.edit', scope);
    if (wo.status !== 'APPROVED') throw conflict('Amendments apply to approved work orders');
    // A rate dated before the work order's own start would be shadowed by the original rate in rate history.
    if (wo.startDate && req.body.effectiveFrom < wo.startDate) throw bad('Effective date cannot be before the work order start date');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const rateChange = req.body.changes.some((c) => c.newRate !== undefined);
    if (rateChange && req.body.effectiveFrom < today && !req.body.retrospectiveAuthority) throw bad('A retrospective rate change must cite the authorising revision / approval');
    const items = await prisma.workOrderItem.findMany({ where: { workOrderId: wo.id } });
    for (const c of req.body.changes) {
      if (c.workOrderItemId && !items.find((i) => i.id === c.workOrderItemId)) throw bad('Change refers to an item of another work order');
      if (!c.workOrderItemId && (!c.activityId || c.newRate === undefined || c.newQuantity === undefined)) throw bad('A new line needs activity, rate and quantity');
    }
    return prisma.$transaction(async (tx) => {
      const last = await tx.workOrderAmendment.findFirst({ where: { workOrderId: wo.id }, orderBy: { amendmentNo: 'desc' } });
      const am = await tx.workOrderAmendment.create({ data: { workOrderId: wo.id, amendmentNo: (last?.amendmentNo ?? 0) + 1, reason: req.body.reason + (req.body.retrospectiveAuthority ? ` [Authority: ${req.body.retrospectiveAuthority}]` : ''), effectiveFrom: req.body.effectiveFrom, changes: req.body.changes, createdById: req.user.id } });
      await logWorkflow(tx, req.user, { entityType: 'WorkOrderAmendment', entityId: am.id, action: 'submit', toStatus: 'SUBMITTED' });
      await audit(tx, req.user, { entityType: 'WorkOrder', entityId: wo.id, action: 'AMENDMENT_SUBMIT', after: am, ...scope });
      return am;
    });
  });
  app.post('/amendments/:id/:action', { schema: { tags: ['work-orders'], params: z.object({ id: zId, action: z.enum(['approve', 'reject']) }), body: tBody } }, async (req) => {
    const am = await prisma.workOrderAmendment.findUnique({ where: { id: req.params.id } });
    if (!am) throw notFound('Amendment');
    if (am.status !== 'SUBMITTED') throw conflict('Amendment is not pending');
    const { wo, scope } = await woCtx(am.workOrderId);
    const changes = am.changes as { workOrderItemId?: string; activityId?: string; description?: string; newRate?: string; newQuantity?: string }[];
    const items = await prisma.workOrderItem.findMany({ where: { workOrderId: wo.id } });
    // Value increase governs the financial limit check.
    let delta = D(0);
    for (const c of changes) {
      const it = items.find((i) => i.id === c.workOrderItemId);
      const q = D(c.newQuantity ?? it?.quantity.toString() ?? 0), r = D(c.newRate ?? it?.rate.toString() ?? 0);
      delta = delta.plus(q.times(r).minus(it ? it.amount.toString() : 0));
    }
    await requirePermission(req.user, 'workorder.approve', scope, req.params.action === 'approve' ? Decimal_max0(delta) : undefined);
    if (req.params.action === 'reject' && !req.body.comment) throw bad('A reason is required');
    if (req.params.action === 'approve' && am.createdById === req.user.id && !req.user.isSuperAdmin) throw conflict('The person who raised an amendment cannot approve it');
    return prisma.$transaction(async (tx) => {
      if (req.params.action === 'approve') {
        let line = items.length;
        for (const c of changes) {
          if (c.workOrderItemId) {
            const it = items.find((i) => i.id === c.workOrderItemId)!;
            const q = c.newQuantity ?? it.quantity.toString(), r = c.newRate ?? it.rate.toString();
            await tx.workOrderItem.update({ where: { id: it.id }, data: { quantity: q, rate: r, amount: money(D(q).times(r)).toString() } });
            if (c.newRate !== undefined) await tx.workOrderItemRate.create({ data: { workOrderItemId: it.id, rate: c.newRate, effectiveFrom: am.effectiveFrom, amendmentId: am.id, approvedById: req.user.id } });
          } else {
            const a = await tx.executionActivity.findUnique({ where: { id: c.activityId! }, include: { contract: true } });
            if (!a || a.contract.projectId !== wo.projectId || a.status !== 'APPROVED') throw bad('New line activity is invalid or not approved');
            const ni = await tx.workOrderItem.create({ data: { workOrderId: wo.id, activityId: a.id, lineNo: ++line, description: c.description || a.name, unit: a.unit, quantity: c.newQuantity!, rate: c.newRate!, amount: money(D(c.newQuantity!).times(c.newRate!)).toString() } });
            await tx.workOrderItemRate.create({ data: { workOrderItemId: ni.id, rate: c.newRate!, effectiveFrom: am.effectiveFrom, amendmentId: am.id, approvedById: req.user.id } });
          }
        }
        await recomputeWoValue(tx, wo.id);
      }
      const status = req.params.action === 'approve' ? 'APPROVED' : 'REJECTED';
      const u = await tx.workOrderAmendment.update({ where: { id: am.id }, data: { status, approvedById: req.user.id, approvedAt: new Date() } });
      await logWorkflow(tx, req.user, { entityType: 'WorkOrderAmendment', entityId: am.id, action: req.params.action, fromStatus: 'SUBMITTED', toStatus: status, comment: req.body.comment });
      await audit(tx, req.user, { entityType: 'WorkOrder', entityId: wo.id, action: `AMENDMENT_${status}`, after: { amendmentNo: am.amendmentNo, changes, delta: delta.toString() }, reason: req.body.comment, ...scope });
      return u;
    });
  });
};
const Decimal_max0 = (d: ReturnType<typeof D>) => (d.gt(0) ? d.toString() : '0');
export default routes;
