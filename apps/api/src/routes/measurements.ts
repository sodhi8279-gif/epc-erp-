import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { D, MEASUREMENT_TRANSITIONS, RETURN_PERMISSION_BY_STAGE, EDITABLE_MEASUREMENT, MEASUREMENT_TYPES, type MeasurementStatus } from '@epc/shared';
import { prisma } from '../lib/db';
import { requirePermission, projectScope } from '../lib/auth';
import { audit, logWorkflow } from '../lib/audit';
import { nextNo } from '../lib/sequence';
import { bad, conflict, notFound } from '../lib/errors';
import { idParam, zDate, zDecOpt, zId } from '../lib/zod';
import { prepareMeasurement, linesToInput } from '../services/measurement';
import { rateOn } from '../services/workorders';

const line = z.object({ description: z.string().nullable().optional(), nos: zDecOpt, length: zDecOpt, breadth: zDecOpt, depth: zDecOpt, chainageFrom: zDecOpt, chainageTo: zDecOpt, barDia: zDecOpt, cuttingLength: zDecOpt, unitWeight: zDecOpt, directQty: zDecOpt, isDeduction: z.boolean().optional() });
const body = z.object({
  workOrderItemId: zId, allocationId: zId.nullable().optional(), date: zDate, type: z.enum(MEASUREMENT_TYPES), mbNo: z.string().nullable().optional(), mbPage: z.string().nullable().optional(),
  location: z.string().nullable().optional(), structure: z.string().nullable().optional(), drawingRef: z.string().nullable().optional(), zone: z.string().nullable().optional(),
  chainageFrom: zDecOpt, chainageTo: zDecOpt, attributes: z.record(z.any()).nullable().optional(), measurementRule: z.string().nullable().optional(), remarks: z.string().nullable().optional(), lines: z.array(line).min(1),
});

const full = { lines: { orderBy: { lineNo: 'asc' as const } }, workOrder: { select: { id: true, woNo: true, subcontractor: { select: { id: true, name: true, code: true } } } }, activity: { select: { id: true, code: true, name: true, unit: true } }, boqItem: { select: { id: true, itemNo: true, description: true, unit: true, revisionId: true } }, allocation: { select: { id: true, zone: true, chainageFrom: true, chainageTo: true, quantity: true } } };

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get('/projects/:projectId/measurements', { schema: { tags: ['measurements'], params: z.object({ projectId: zId }), querystring: z.object({ status: z.string().optional(), workOrderId: zId.optional(), activityId: zId.optional(), subcontractorId: zId.optional(), from: zDate.optional(), to: zDate.optional() }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    const q = req.query;
    return prisma.measurement.findMany({ where: { projectId: req.params.projectId, ...(q.status ? { status: { in: q.status.split(',') as never } } : {}), workOrderId: q.workOrderId, activityId: q.activityId, ...(q.subcontractorId ? { workOrder: { subcontractorId: q.subcontractorId } } : {}), date: { gte: q.from, lte: q.to } }, include: { workOrder: full.workOrder, activity: full.activity, boqItem: { select: { itemNo: true } } }, orderBy: [{ date: 'desc' }, { measurementNo: 'desc' }], take: 1000 });
  });
  app.get('/measurements/:id', { schema: { tags: ['measurements'], params: idParam } }, async (req) => {
    const m = await prisma.measurement.findUnique({ where: { id: req.params.id }, include: { ...full, snapshots: { orderBy: { revision: 'asc' } } } });
    if (!m) throw notFound('Measurement');
    await requirePermission(req.user, 'project.view', await projectScope(m.projectId));
    const history = await prisma.workflowAction.findMany({ where: { entityType: 'Measurement', entityId: m.id }, orderBy: { at: 'asc' } });
    const related = await prisma.measurement.findMany({ where: { OR: [{ reversalOfId: m.id }, { id: m.reversalOfId ?? undefined }] }, select: { id: true, measurementNo: true, quantity: true, status: true } });
    return { ...m, history, related };
  });
  /** Live computation preview (no persistence) so the form can show formulas and safeguard results before saving. */
  app.post('/projects/:projectId/measurements/preview', { schema: { tags: ['measurements'], params: z.object({ projectId: zId }), body: body.extend({ excludeId: zId.optional() }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    try {
      const p = await prisma.$transaction((tx) => prepareMeasurement(tx, req.params.projectId, { ...req.body, chainageFrom: req.body.chainageFrom ?? null, chainageTo: req.body.chainageTo ?? null }, req.body.excludeId));
      return { ok: true, quantity: p.quantity.toString(), unit: p.woi.unit, lines: p.lineData, boqItem: { itemNo: p.boqItem.itemNo, revisionId: p.boqItem.revisionId }, errors: [] };
    } catch (e) {
      const err = e as { message: string; details?: string[] };
      return { ok: false, errors: err.details ?? [err.message] };
    }
  });
  app.post('/projects/:projectId/measurements', { schema: { tags: ['measurements'], params: z.object({ projectId: zId }), body } }, async (req) => {
    const scope = await projectScope(req.params.projectId);
    await requirePermission(req.user, 'measurement.create', scope);
    return prisma.$transaction(async (tx) => {
      const wo = await tx.workOrderItem.findUniqueOrThrow({ where: { id: req.body.workOrderItemId } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${wo.activityId}))`;
      const p = await prepareMeasurement(tx, req.params.projectId, { ...req.body, chainageFrom: req.body.chainageFrom ?? null, chainageTo: req.body.chainageTo ?? null });
      const m = await tx.measurement.create({
        data: {
          projectId: req.params.projectId, measurementNo: await nextNo(tx, req.params.projectId, 'MS', 5), mbNo: req.body.mbNo, mbPage: req.body.mbPage, date: req.body.date, type: req.body.type,
          workOrderId: p.woi.workOrderId, workOrderItemId: p.woi.id, activityId: p.woi.activityId, boqItemId: p.boqItem.id, allocationId: req.body.allocationId ?? null,
          location: req.body.location, structure: req.body.structure, drawingRef: req.body.drawingRef, zone: req.body.zone, chainageFrom: p.chainageFrom, chainageTo: p.chainageTo,
          attributes: (req.body.attributes ?? undefined) as never, measurementRule: req.body.measurementRule, remarks: req.body.remarks, quantity: p.quantity.toString(), unit: p.woi.unit, createdById: req.user.id,
          lines: { create: p.lineData },
        },
        include: full,
      });
      await audit(tx, req.user, { entityType: 'Measurement', entityId: m.id, action: 'CREATE', after: m, ...scope });
      await logWorkflow(tx, req.user, { entityType: 'Measurement', entityId: m.id, action: 'create', toStatus: 'DRAFT' });
      return m;
    });
  });
  app.put('/measurements/:id', { schema: { tags: ['measurements'], params: idParam, body } }, async (req) => {
    const before = await prisma.measurement.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!before) throw notFound('Measurement');
    const scope = await projectScope(before.projectId);
    await requirePermission(req.user, 'measurement.create', scope);
    if (!(EDITABLE_MEASUREMENT as string[]).includes(before.status)) throw conflict(`A ${before.status} measurement cannot be edited`);
    return prisma.$transaction(async (tx) => {
      const p = await prepareMeasurement(tx, before.projectId, { ...req.body, chainageFrom: req.body.chainageFrom ?? null, chainageTo: req.body.chainageTo ?? null }, before.id);
      await tx.measurementLine.deleteMany({ where: { measurementId: before.id } });
      const m = await tx.measurement.update({
        where: { id: before.id },
        data: {
          mbNo: req.body.mbNo, mbPage: req.body.mbPage, date: req.body.date, type: req.body.type, workOrderId: p.woi.workOrderId, workOrderItemId: p.woi.id, activityId: p.woi.activityId, boqItemId: p.boqItem.id,
          allocationId: req.body.allocationId ?? null, location: req.body.location, structure: req.body.structure, drawingRef: req.body.drawingRef, zone: req.body.zone, chainageFrom: p.chainageFrom, chainageTo: p.chainageTo,
          attributes: (req.body.attributes ?? undefined) as never, measurementRule: req.body.measurementRule, remarks: req.body.remarks, quantity: p.quantity.toString(), unit: p.woi.unit, lines: { create: p.lineData },
        },
        include: full,
      });
      await audit(tx, req.user, { entityType: 'Measurement', entityId: m.id, action: 'UPDATE', before, after: m, ...scope });
      return m;
    });
  });
  app.delete('/measurements/:id', { schema: { tags: ['measurements'], params: idParam } }, async (req) => {
    const m = await prisma.measurement.findUnique({ where: { id: req.params.id } });
    if (!m) throw notFound('Measurement');
    const scope = await projectScope(m.projectId);
    await requirePermission(req.user, 'measurement.create', scope);
    if (m.status !== 'DRAFT' || m.revision > 1) throw conflict('Only never-submitted drafts can be deleted');
    await prisma.$transaction(async (tx) => {
      await tx.measurement.delete({ where: { id: m.id } });
      await audit(tx, req.user, { entityType: 'Measurement', entityId: m.id, action: 'DELETE', before: m, ...scope });
    });
    return { ok: true };
  });

  app.post('/measurements/:id/transition', { schema: { tags: ['measurements'], params: idParam, body: z.object({ action: z.enum(['submit', 'verify', 'scrutinize', 'approve', 'review', 'certify', 'return']), comment: z.string().optional() }) } }, async (req) => {
    const m = await prisma.measurement.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!m) throw notFound('Measurement');
    const scope = await projectScope(m.projectId);
    const t = MEASUREMENT_TRANSITIONS.find((x) => x.action === req.body.action)!;
    if (!t.from.includes(m.status as MeasurementStatus)) throw conflict(`Cannot ${t.label.toLowerCase()} a ${m.status} measurement`);
    const perm = t.action === 'return' ? RETURN_PERMISSION_BY_STAGE[m.status as MeasurementStatus]! : t.permission;
    await requirePermission(req.user, perm, scope, t.action === 'certify' || t.action === 'approve' ? D(m.quantity.toString()).times(m.rate?.toString() ?? '0').toString() : undefined);
    if (t.requiresComment && !req.body.comment) throw bad('Comments are required when returning a measurement');
    // Segregation of duties: whoever recorded a measurement cannot approve or certify it.
    if (['approve', 'certify'].includes(t.action) && m.createdById === req.user.id && !req.user.isSuperAdmin) throw conflict('The person who recorded the measurement cannot approve or certify it');
    return prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = { status: t.to };
      if (t.action === 'submit') {
        // Re-run every safeguard at submission (other measurements may have been approved meanwhile).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${m.activityId}))`;
        await prepareMeasurement(tx, m.projectId, { workOrderItemId: m.workOrderItemId, allocationId: m.allocationId, date: m.date, type: m.type, zone: m.zone, structure: m.structure, chainageFrom: m.chainageFrom?.toString() ?? null, chainageTo: m.chainageTo?.toString() ?? null, lines: linesToInput(m.lines) }, m.id);
        const revision = m.status === 'RETURNED' ? m.revision + 1 : m.revision;
        data.revision = revision;
        await tx.measurementSnapshot.create({ data: { measurementId: m.id, revision, data: JSON.parse(JSON.stringify(m)) } });
      }
      if (t.action === 'approve') data.rate = (await rateOn(m.workOrderItemId, m.date, tx)).toString();
      const u = await tx.measurement.update({ where: { id: m.id }, data, include: full });
      await logWorkflow(tx, req.user, { entityType: 'Measurement', entityId: m.id, action: t.action, fromStatus: m.status, toStatus: t.to, comment: req.body.comment });
      await audit(tx, req.user, { entityType: 'Measurement', entityId: m.id, action: t.action.toUpperCase(), before: { status: m.status }, after: { status: t.to, rate: data.rate }, reason: req.body.comment, ...scope });
      return u;
    });
  });

  /** Reversal of an approved/certified measurement: a negative entry with the same approval standing; the original stays as history. */
  app.post('/measurements/:id/reverse', { schema: { tags: ['measurements'], params: idParam, body: z.object({ reason: z.string().min(5) }) } }, async (req) => {
    const m = await prisma.measurement.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!m) throw notFound('Measurement');
    const scope = await projectScope(m.projectId);
    await requirePermission(req.user, 'measurement.reverse', scope);
    if (!['PM_APPROVED', 'COMMERCIAL_REVIEWED', 'CERTIFIED'].includes(m.status)) throw conflict('Only approved or certified measurements are reversed; edit or return others');
    if (m.reversedById || m.reversalOfId) throw conflict('Measurement is already reversed or is itself a reversal');
    return prisma.$transaction(async (tx) => {
      const r = await tx.measurement.create({
        data: {
          projectId: m.projectId, measurementNo: await nextNo(tx, m.projectId, 'MS', 5), date: new Date(), type: m.type, workOrderId: m.workOrderId, workOrderItemId: m.workOrderItemId, activityId: m.activityId, boqItemId: m.boqItemId,
          allocationId: m.allocationId, location: m.location, structure: m.structure, zone: m.zone, chainageFrom: m.chainageFrom, chainageTo: m.chainageTo, quantity: D(m.quantity.toString()).negated().toString(), unit: m.unit, rate: m.rate,
          status: 'DRAFT', reversalOfId: m.id, remarks: `Reversal of ${m.measurementNo}: ${req.body.reason}`, createdById: req.user.id,
          lines: { create: [{ lineNo: 1, description: `Reversal of ${m.measurementNo}`, directQty: D(m.quantity.toString()).negated().toString(), quantity: D(m.quantity.toString()).negated().toString(), formula: `− ${m.quantity} (reversal)` }] },
        },
      });
      // Lines are only writable while DRAFT; then the reversal takes the original's approval standing.
      await tx.measurement.update({ where: { id: r.id }, data: { status: m.status } });
      await tx.measurement.update({ where: { id: m.id }, data: { reversedById: r.id } });
      await logWorkflow(tx, req.user, { entityType: 'Measurement', entityId: m.id, action: 'reverse', fromStatus: m.status, toStatus: m.status, comment: req.body.reason });
      await logWorkflow(tx, req.user, { entityType: 'Measurement', entityId: r.id, action: 'create-reversal', toStatus: r.status, comment: req.body.reason });
      await audit(tx, req.user, { entityType: 'Measurement', entityId: m.id, action: 'REVERSE', after: { reversalId: r.id }, reason: req.body.reason, ...scope });
      return r;
    });
  });
};
export default routes;
