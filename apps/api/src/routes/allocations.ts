import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { D, APPROVED_MEASUREMENT } from '@epc/shared';
import { prisma } from '../lib/db';
import { requirePermission, projectScope } from '../lib/auth';
import { audit, logWorkflow } from '../lib/audit';
import { bad, conflict, notFound } from '../lib/errors';
import { idParam, zDate, zDecOpt, zDecPos, zId } from '../lib/zod';
import { checkAllocation, ALLOC_LIVE } from '../services/allocation';
import { currentRevision } from '../services/boq';

const allocBody = z.object({ activityId: zId, workOrderItemId: zId, quantity: zDecPos, zone: z.string().nullable().optional(), chainageFrom: zDecOpt, chainageTo: zDecOpt, remarks: z.string().optional(), exceptionReason: z.string().optional() });

const routes: FastifyPluginAsyncZod = async (app) => {
  app.post('/projects/:projectId/allocations/check', { schema: { tags: ['allocation'], params: z.object({ projectId: zId }), body: allocBody } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    const r = await prisma.$transaction((tx) => checkAllocation(tx, { ...req.body, chainageFrom: req.body.chainageFrom ?? null, chainageTo: req.body.chainageTo ?? null }));
    return { errors: r.errors, exceptions: r.exceptions };
  });
  app.post('/projects/:projectId/allocations', { schema: { tags: ['allocation'], params: z.object({ projectId: zId }), body: allocBody } }, async (req) => {
    const scope = await projectScope(req.params.projectId);
    await requirePermission(req.user, 'allocation.edit', scope);
    return prisma.$transaction(async (tx) => {
      // Serialise allocations per activity so concurrent requests cannot jointly over-allocate.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${req.body.activityId}))`;
      const r = await checkAllocation(tx, { ...req.body, chainageFrom: req.body.chainageFrom ?? null, chainageTo: req.body.chainageTo ?? null });
      if (r.errors.length) throw bad('Allocation is not valid', r.errors);
      if (r.woi.workOrder.projectId !== req.params.projectId) throw bad('Work order belongs to another project');
      if (r.exceptions.length && !req.body.exceptionReason) throw conflict('Allocation needs an authorised exception', r.exceptions);
      const a = await tx.workAllocation.create({
        data: {
          projectId: req.params.projectId, activityId: req.body.activityId, workOrderId: r.woi.workOrderId, workOrderItemId: r.woi.id, subcontractorId: r.woi.workOrder.subcontractorId,
          quantity: req.body.quantity, zone: req.body.zone ?? null, chainageFrom: req.body.chainageFrom ?? null, chainageTo: req.body.chainageTo ?? null, remarks: req.body.remarks,
          status: r.exceptions.length ? 'PENDING_EXCEPTION' : 'ACTIVE', exceptions: r.exceptions.map((e) => `${e.code}: ${e.message}`), exceptionReason: req.body.exceptionReason ?? null, createdById: req.user.id,
        },
      });
      await audit(tx, req.user, { entityType: 'WorkAllocation', entityId: a.id, action: 'CREATE', after: a, reason: req.body.exceptionReason, ...scope });
      await logWorkflow(tx, req.user, { entityType: 'WorkAllocation', entityId: a.id, action: 'create', toStatus: a.status, comment: req.body.exceptionReason });
      return a;
    });
  });
  app.post('/allocations/:id/:action', { schema: { tags: ['allocation'], params: z.object({ id: zId, action: z.enum(['approve-exception', 'reject-exception', 'cancel']) }), body: z.object({ comment: z.string().optional() }) } }, async (req) => {
    const a = await prisma.workAllocation.findUnique({ where: { id: req.params.id } });
    if (!a) throw notFound('Allocation');
    const scope = await projectScope(a.projectId);
    const act = req.params.action;
    if (act === 'cancel') {
      await requirePermission(req.user, 'allocation.edit', scope);
      if (!req.body.comment) throw bad('A reason is required');
      const used = await prisma.measurement.count({ where: { allocationId: a.id, status: { not: 'REVERSED' } } });
      if (used) throw conflict('Allocation has measurements against it and cannot be cancelled');
    } else {
      await requirePermission(req.user, 'allocation.override', scope);
      if (a.status !== 'PENDING_EXCEPTION') throw conflict('Allocation has no pending exception');
      if (a.createdById === req.user.id && !req.user.isSuperAdmin) throw conflict('The person who requested the exception cannot approve it');
      if (act === 'reject-exception' && !req.body.comment) throw bad('A reason is required');
    }
    const to = act === 'approve-exception' ? 'ACTIVE' : act === 'reject-exception' ? 'REJECTED' : 'CANCELLED';
    return prisma.$transaction(async (tx) => {
      const u = await tx.workAllocation.update({ where: { id: a.id }, data: { status: to, ...(act === 'approve-exception' ? { approvedById: req.user.id, approvedAt: new Date() } : {}) } });
      await logWorkflow(tx, req.user, { entityType: 'WorkAllocation', entityId: a.id, action: act, fromStatus: a.status, toStatus: to, comment: req.body.comment });
      await audit(tx, req.user, { entityType: 'WorkAllocation', entityId: a.id, action: act.toUpperCase(), before: { status: a.status }, after: { status: to }, reason: req.body.comment, ...scope });
      return u;
    });
  });
  app.get('/projects/:projectId/allocations', { schema: { tags: ['allocation'], params: z.object({ projectId: zId }), querystring: z.object({ activityId: zId.optional(), subcontractorId: zId.optional(), status: z.string().optional() }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    return prisma.workAllocation.findMany({ where: { projectId: req.params.projectId, activityId: req.query.activityId, subcontractorId: req.query.subcontractorId, ...(req.query.status ? { status: req.query.status as never } : {}) }, include: { subcontractor: { select: { name: true, code: true } }, workOrder: { select: { woNo: true } }, workOrderItem: { select: { rate: true, unit: true } }, activity: { select: { code: true, name: true, unit: true } } }, orderBy: { createdAt: 'desc' } });
  });

  /**
   * Allocation matrix: every activity with the full quantity chain kept separate —
   * contract → revised → scope → allocated → executed (site progress) → measured (MB) → approved → certified → billed → paid.
   */
  app.get('/projects/:projectId/allocation-matrix', { schema: { tags: ['allocation'], params: z.object({ projectId: zId }), querystring: z.object({ contractId: zId.optional() }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    const contracts = await prisma.contract.findMany({ where: { projectId: req.params.projectId, ...(req.query.contractId ? { id: req.query.contractId } : {}) } });
    const rows = [];
    for (const c of contracts) {
      const rev = await currentRevision(c.id);
      if (!rev) continue;
      const orig = await prisma.boqRevision.findFirst({ where: { contractId: c.id, type: 'ORIGINAL', status: { in: ['APPROVED', 'SUPERSEDED'] } } });
      const items = await prisma.boqItem.findMany({ where: { revisionId: rev.id } });
      const origItems = orig ? await prisma.boqItem.findMany({ where: { revisionId: orig.id } }) : [];
      const acts = await prisma.executionActivity.findMany({ where: { contractId: c.id, active: true }, orderBy: { sequence: 'asc' } });
      const actIds = acts.map((a) => a.id);
      const [allocs, prog, meas] = await Promise.all([
        prisma.workAllocation.findMany({ where: { activityId: { in: actIds }, status: { in: [...ALLOC_LIVE] } }, include: { subcontractor: { select: { id: true, name: true, code: true } }, workOrderItem: { select: { rate: true } }, workOrder: { select: { woNo: true } } } }),
        prisma.progressEntry.groupBy({ by: ['activityId', 'subcontractorId'], where: { activityId: { in: actIds } }, _sum: { quantity: true } }),
        prisma.measurement.findMany({ where: { activityId: { in: actIds }, status: { notIn: ['REVERSED'] } }, select: { activityId: true, status: true, quantity: true, workOrder: { select: { subcontractorId: true } } } }),
      ]);
      for (const a of acts) {
        const item = items.find((i) => i.itemKey === a.itemKey);
        if (!item) continue;
        const o = origItems.find((x) => x.itemKey === a.itemKey);
        const f = D(a.conversionFactor.toString());
        const scope = D(item.quantity.toString()).times(f);
        const ms = meas.filter((m) => m.activityId === a.id);
        const sumBy = (pred: (m: (typeof ms)[number]) => boolean, sub?: string) => ms.filter((m) => pred(m) && (!sub || m.workOrder.subcontractorId === sub)).reduce((s, m) => s.plus(m.quantity.toString()), D(0));
        const isMeasured = (m: (typeof ms)[number]) => !['DRAFT', 'RETURNED'].includes(m.status);
        const isApproved = (m: (typeof ms)[number]) => (APPROVED_MEASUREMENT as string[]).includes(m.status);
        const isCert = (m: (typeof ms)[number]) => m.status === 'CERTIFIED';
        const al = allocs.filter((x) => x.activityId === a.id);
        const allocated = al.reduce((s, x) => s.plus(x.quantity.toString()), D(0));
        const executed = prog.filter((p) => p.activityId === a.id).reduce((s, p) => s.plus(p._sum.quantity?.toString() ?? 0), D(0));
        const bySub = new Map<string, { subcontractor: { id: string; name: string; code: string }; allocations: { id: string; woNo: string; quantity: string; rate: string; zone: string | null; chainageFrom: string | null; chainageTo: string | null; status: string }[] }>();
        for (const x of al) {
          const e = bySub.get(x.subcontractorId) ?? { subcontractor: x.subcontractor, allocations: [] };
          e.allocations.push({ id: x.id, woNo: x.workOrder.woNo, quantity: x.quantity.toString(), rate: x.workOrderItem.rate.toString(), zone: x.zone, chainageFrom: x.chainageFrom?.toString() ?? null, chainageTo: x.chainageTo?.toString() ?? null, status: x.status });
          bySub.set(x.subcontractorId, e);
        }
        const subs = [...bySub.values()].map((s) => {
          const q = s.allocations.reduce((t, x) => t.plus(x.quantity), D(0));
          const value = s.allocations.reduce((t, x) => t.plus(D(x.quantity).times(x.rate)), D(0));
          const ex = prog.filter((p) => p.activityId === a.id && p.subcontractorId === s.subcontractor.id).reduce((t, p) => t.plus(p._sum.quantity?.toString() ?? 0), D(0));
          return { ...s, allocated: q.toString(), value: value.toDecimalPlaces(2).toString(), executed: ex.toString(), measured: sumBy(isMeasured, s.subcontractor.id).toString(), approved: sumBy(isApproved, s.subcontractor.id).toString(), certified: sumBy(isCert, s.subcontractor.id).toString(), balance: q.minus(sumBy(isMeasured, s.subcontractor.id)).toString() };
        });
        rows.push({
          contractId: c.id, contractNo: c.contractNo, itemKey: a.itemKey, itemNo: item.itemNo, itemDescription: item.description, itemUnit: item.unit,
          activityId: a.id, activityCode: a.code, activityName: a.name, unit: a.unit, breakupStatus: a.status,
          contractQty: o ? D(o.quantity.toString()).times(f).toDecimalPlaces(3).toString() : null, revisedQty: scope.toDecimalPlaces(3).toString(),
          allocated: allocated.toString(), unallocated: scope.minus(allocated).toDecimalPlaces(3).toString(), executed: executed.toString(),
          measured: sumBy(isMeasured).toString(), approved: sumBy(isApproved).toString(), certified: sumBy(isCert).toString(),
          billed: null, paid: null, // populated by the billing & payments module (pending specification)
          remaining: scope.minus(sumBy(isMeasured)).toDecimalPlaces(3).toString(), subcontractors: subs,
        });
      }
    }
    return rows;
  });

  // Daily site progress
  app.post('/projects/:projectId/progress', { schema: { tags: ['allocation'], params: z.object({ projectId: zId }), body: z.object({ allocationId: zId, date: zDate, quantity: zDecPos, location: z.string().optional(), chainageFrom: zDecOpt, chainageTo: zDecOpt, manpower: z.number().int().optional(), remarks: z.string().optional() }) } }, async (req) => {
    const scope = await projectScope(req.params.projectId);
    await requirePermission(req.user, 'measurement.create', scope);
    const a = await prisma.workAllocation.findUnique({ where: { id: req.body.allocationId } });
    if (!a || a.projectId !== req.params.projectId || a.status !== 'ACTIVE') throw bad('Allocation not found or not active');
    if (req.body.date > new Date()) throw bad('Progress cannot be recorded for a future date');
    return prisma.$transaction(async (tx) => {
      const p = await tx.progressEntry.create({ data: { ...req.body, chainageFrom: req.body.chainageFrom ?? null, chainageTo: req.body.chainageTo ?? null, projectId: req.params.projectId, activityId: a.activityId, subcontractorId: a.subcontractorId, createdById: req.user.id } });
      await audit(tx, req.user, { entityType: 'ProgressEntry', entityId: p.id, action: 'CREATE', after: p, ...scope });
      return p;
    });
  });
  app.get('/projects/:projectId/progress', { schema: { tags: ['allocation'], params: z.object({ projectId: zId }), querystring: z.object({ from: zDate.optional(), to: zDate.optional() }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    return prisma.progressEntry.findMany({ where: { projectId: req.params.projectId, date: { gte: req.query.from, lte: req.query.to } }, include: { activity: { select: { code: true, name: true, unit: true } }, allocation: { include: { subcontractor: { select: { name: true } } } } }, orderBy: { date: 'desc' }, take: 500 });
  });
};
export default routes;
