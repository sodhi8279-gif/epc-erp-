import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { D, money } from '@epc/shared';
import { prisma } from '../lib/db';
import { requirePermission, projectScope, visibleProjectIds } from '../lib/auth';
import { zId } from '../lib/zod';

const routes: FastifyPluginAsyncZod = async (app) => {
  /** Project dashboard: real aggregates only. */
  app.get('/projects/:projectId/summary', { schema: { tags: ['reports'], params: z.object({ projectId: zId }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    const pid = req.params.projectId;
    const contracts = await prisma.contract.findMany({ where: { projectId: pid } });
    const [woAgg, measByStatus, pendingAlloc, issues, recon, approvedMeas] = await Promise.all([
      prisma.workOrder.aggregate({ where: { projectId: pid, status: 'APPROVED' }, _sum: { value: true }, _count: true }),
      prisma.measurement.groupBy({ by: ['status'], where: { projectId: pid }, _count: true }),
      prisma.workAllocation.count({ where: { projectId: pid, status: 'PENDING_EXCEPTION' } }),
      prisma.materialIssueLine.aggregate({ where: { issue: { projectId: pid, status: { not: 'CANCELLED' } } }, _sum: { issueValue: true } }),
      prisma.materialReconciliation.aggregate({ where: { projectId: pid, status: 'APPROVED' }, _sum: { totalRecoverable: true } }),
      prisma.measurement.findMany({ where: { projectId: pid, status: { in: ['PM_APPROVED', 'COMMERCIAL_REVIEWED', 'CERTIFIED'] } }, select: { quantity: true, rate: true } }),
    ]);
    const approvedValue = money(approvedMeas.reduce((s, m) => s.plus(D(m.quantity.toString()).times(m.rate?.toString() ?? 0)), D(0)));
    return {
      contractValue: money(contracts.reduce((s, c) => s.plus(c.contractValue.toString()), D(0))).toString(),
      contracts: contracts.length,
      approvedWorkOrders: woAgg._count, workOrderValue: woAgg._sum.value ?? '0',
      measurementsByStatus: Object.fromEntries(measByStatus.map((m) => [m.status, m._count])),
      approvedMeasurementValue: approvedValue.toString(),
      pendingAllocationExceptions: pendingAlloc,
      materialIssuedValue: issues._sum.issueValue ?? '0',
      approvedMaterialRecoveries: recon._sum.totalRecoverable ?? '0',
    };
  });

  /** HQ consolidated view across visible projects. */
  app.get('/reports/portfolio', { schema: { tags: ['reports'] } }, async (req) => {
    const vis = await visibleProjectIds(req.user);
    const projects = await prisma.project.findMany({ where: vis === 'ALL' ? {} : { id: { in: vis } }, include: { company: { select: { name: true } } } });
    const out = [];
    for (const p of projects) {
      const [c, wo, pend] = await Promise.all([
        prisma.contract.aggregate({ where: { projectId: p.id }, _sum: { contractValue: true } }),
        prisma.workOrder.aggregate({ where: { projectId: p.id, status: 'APPROVED' }, _sum: { value: true } }),
        prisma.measurement.count({ where: { projectId: p.id, status: { in: ['SUBMITTED', 'SE_VERIFIED', 'BILLING_SCRUTINIZED', 'PM_APPROVED', 'COMMERCIAL_REVIEWED'] } } }),
      ]);
      out.push({ id: p.id, code: p.code, name: p.name, company: p.company.name, type: p.type, status: p.status, contractValue: c._sum.contractValue ?? '0', subcontractedValue: wo._sum.value ?? '0', measurementsPending: pend });
    }
    return out;
  });
};
export default routes;
