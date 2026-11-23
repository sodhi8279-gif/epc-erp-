import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { requirePermission, hasPermission } from '../lib/auth';
import { audit, logWorkflow } from '../lib/audit';
import { bad, conflict, forbidden, notFound } from '../lib/errors';
import { idParam, zDate, zDec, zId } from '../lib/zod';

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const up = (s?: string | null) => (s ? s.trim().toUpperCase() : s);
const body = z.object({
  code: z.string().min(2).max(20), name: z.string().min(2), firmName: z.string().optional().nullable(), constitution: z.string().optional().nullable(),
  address: z.string().optional().nullable(), state: z.string().optional().nullable(), gstin: z.string().optional().nullable().transform(up), pan: z.string().optional().nullable().transform(up),
  contactPerson: z.string().optional().nullable(), phone: z.string().optional().nullable(), email: z.string().email().optional().nullable().or(z.literal('')),
  bankName: z.string().optional().nullable(), bankAccount: z.string().regex(/^\d{9,18}$/, 'Account number must be 9–18 digits').optional().nullable().or(z.literal('')), ifsc: z.string().optional().nullable().transform(up),
  workCategories: z.array(z.string()).default([]), gstRegistered: z.boolean().default(true), gstRate: zDec.optional(), tdsSection: z.string().optional().nullable(), tdsRate: zDec.optional(),
  retentionPercent: zDec.optional(), paymentTermsDays: z.number().int().min(0).max(365).optional(),
}).superRefine((v, ctx) => {
  if (v.pan && !PAN_RE.test(v.pan)) ctx.addIssue({ code: 'custom', path: ['pan'], message: 'Invalid PAN format' });
  if (v.gstin && !GSTIN_RE.test(v.gstin)) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'Invalid GSTIN format' });
  if (v.gstin && v.pan && v.gstin.slice(2, 12) !== v.pan) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'GSTIN does not contain the PAN' });
  if (v.ifsc && !IFSC_RE.test(v.ifsc)) ctx.addIssue({ code: 'custom', path: ['ifsc'], message: 'Invalid IFSC format' });
  if (v.gstRegistered && !v.gstin) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'GSTIN is required for a GST-registered subcontractor' });
});
const BANK_FIELDS = ['bankName', 'bankAccount', 'ifsc', 'pan', 'gstin'] as const;

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get('/companies/:id/subcontractors', { schema: { tags: ['subcontractors'], params: idParam, querystring: z.object({ status: z.string().optional(), q: z.string().optional() }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', { companyId: req.params.id }).catch(async () => {
      // project-scoped users can still see subcontractors working on their projects
      const any = await prisma.userRoleAssignment.findFirst({ where: { userId: req.user.id, companyId: req.params.id } });
      if (!any && !req.user.isSuperAdmin) throw forbidden();
    });
    return prisma.subcontractor.findMany({
      where: { companyId: req.params.id, ...(req.query.status ? { status: req.query.status as never } : {}), ...(req.query.q ? { OR: [{ name: { contains: req.query.q, mode: 'insensitive' } }, { code: { contains: req.query.q, mode: 'insensitive' } }] } : {}) },
      include: { _count: { select: { workOrders: true } } }, orderBy: { name: 'asc' },
    });
  });
  app.get('/subcontractors/:id', { schema: { tags: ['subcontractors'], params: idParam } }, async (req) => {
    const s = await prisma.subcontractor.findUnique({ where: { id: req.params.id }, include: { compliance: true, workOrders: { include: { project: { select: { name: true, code: true } } }, orderBy: { createdAt: 'desc' } } } });
    if (!s) throw notFound('Subcontractor');
    const any = req.user.isSuperAdmin || (await prisma.userRoleAssignment.findFirst({ where: { userId: req.user.id, companyId: s.companyId } }));
    if (!any) throw forbidden();
    return s;
  });
  app.post('/companies/:id/subcontractors', { schema: { tags: ['subcontractors'], params: idParam, body } }, async (req) => {
    await requirePermission(req.user, 'subcontractor.manage', { companyId: req.params.id });
    return prisma.$transaction(async (tx) => {
      const s = await tx.subcontractor.create({ data: { ...req.body, email: req.body.email || null, bankAccount: req.body.bankAccount || null, code: req.body.code.toUpperCase(), companyId: req.params.id, status: 'ONBOARDING' } });
      await audit(tx, req.user, { entityType: 'Subcontractor', entityId: s.id, action: 'CREATE', after: s, companyId: s.companyId });
      return s;
    });
  });
  app.patch('/subcontractors/:id', { schema: { tags: ['subcontractors'], params: idParam, body: z.object({ data: z.record(z.any()), reason: z.string().optional() }) } }, async (req) => {
    const before = await prisma.subcontractor.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Subcontractor');
    await requirePermission(req.user, 'subcontractor.manage', { companyId: before.companyId });
    const merged = body.parse({ ...before, gstRate: before.gstRate.toString(), tdsRate: before.tdsRate.toString(), retentionPercent: before.retentionPercent.toString(), ...req.body.data });
    const changedSensitive = BANK_FIELDS.filter((f) => (merged[f] ?? null) !== (before[f] ?? null));
    // Bank/tax identity changes on an active subcontractor are a payment-fraud risk: they need approval authority and a reason.
    if (changedSensitive.length && before.status !== 'ONBOARDING') {
      if (!(await hasPermission(req.user, 'subcontractor.approve', { companyId: before.companyId }))) throw forbidden(`Changing ${changedSensitive.join(', ')} of an approved subcontractor requires approval authority`);
      if (!req.body.reason) throw bad('A reason is required for changing bank or tax details');
    }
    const { code: _c, ...data } = merged;
    return prisma.$transaction(async (tx) => {
      const s = await tx.subcontractor.update({ where: { id: before.id }, data: { ...data, email: data.email || null, bankAccount: data.bankAccount || null } });
      await audit(tx, req.user, { entityType: 'Subcontractor', entityId: s.id, action: changedSensitive.length ? 'UPDATE_SENSITIVE' : 'UPDATE', before, after: s, reason: req.body.reason, companyId: s.companyId });
      return s;
    });
  });
  app.post('/subcontractors/:id/status', { schema: { tags: ['subcontractors'], params: idParam, body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'BLACKLISTED', 'INACTIVE']), comment: z.string().optional() }) } }, async (req) => {
    const s = await prisma.subcontractor.findUnique({ where: { id: req.params.id }, include: { compliance: true } });
    if (!s) throw notFound('Subcontractor');
    await requirePermission(req.user, 'subcontractor.approve', { companyId: s.companyId });
    if (req.body.status === 'ACTIVE') {
      const missing = [!s.pan && 'PAN', !s.bankAccount && 'bank account', !s.ifsc && 'IFSC'].filter(Boolean);
      if (missing.length) throw bad(`Cannot activate: ${missing.join(', ')} missing`);
      const expired = s.compliance.filter((c) => c.validTo && c.validTo < new Date());
      if (expired.length) throw bad(`Cannot activate: expired compliance documents (${expired.map((e) => e.docType).join(', ')})`);
    }
    if (req.body.status !== 'ACTIVE' && !req.body.comment) throw bad('A reason is required');
    return prisma.$transaction(async (tx) => {
      const u = await tx.subcontractor.update({ where: { id: s.id }, data: { status: req.body.status, ...(req.body.status === 'ACTIVE' ? { approvedById: req.user.id, approvedAt: new Date() } : {}) } });
      await logWorkflow(tx, req.user, { entityType: 'Subcontractor', entityId: s.id, action: req.body.status.toLowerCase(), fromStatus: s.status, toStatus: req.body.status, comment: req.body.comment });
      await audit(tx, req.user, { entityType: 'Subcontractor', entityId: s.id, action: 'STATUS', before: { status: s.status }, after: { status: u.status }, reason: req.body.comment, companyId: s.companyId });
      return u;
    });
  });
  // Compliance documents (insurance, labour licence, ESI/EPF registration, agreement, performance security…)
  app.post('/subcontractors/:id/compliance', { schema: { tags: ['subcontractors'], params: idParam, body: z.object({ docType: z.string().min(2), docNo: z.string().optional(), validFrom: zDate.optional(), validTo: zDate.optional(), documentId: zId.optional(), remarks: z.string().optional() }) } }, async (req) => {
    const s = await prisma.subcontractor.findUnique({ where: { id: req.params.id } });
    if (!s) throw notFound('Subcontractor');
    await requirePermission(req.user, 'subcontractor.manage', { companyId: s.companyId });
    return prisma.$transaction(async (tx) => {
      const c = await tx.subcontractorCompliance.create({ data: { ...req.body, subcontractorId: s.id } });
      await audit(tx, req.user, { entityType: 'Subcontractor', entityId: s.id, action: 'ADD_COMPLIANCE', after: c, companyId: s.companyId });
      return c;
    });
  });
  app.post('/compliance/:id/verify', { schema: { tags: ['subcontractors'], params: idParam } }, async (req) => {
    const c = await prisma.subcontractorCompliance.findUnique({ where: { id: req.params.id }, include: { subcontractor: true } });
    if (!c) throw notFound('Compliance document');
    await requirePermission(req.user, 'subcontractor.approve', { companyId: c.subcontractor.companyId });
    if (!c.documentId) throw conflict('Attach the document before verifying');
    return prisma.$transaction(async (tx) => {
      const u = await tx.subcontractorCompliance.update({ where: { id: c.id }, data: { verified: true, verifiedById: req.user.id, verifiedAt: new Date() } });
      await audit(tx, req.user, { entityType: 'Subcontractor', entityId: c.subcontractorId, action: 'VERIFY_COMPLIANCE', after: u, companyId: c.subcontractor.companyId });
      return u;
    });
  });
};
export default routes;
