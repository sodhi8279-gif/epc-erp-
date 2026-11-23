import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { ALL_PERMISSIONS, DEFAULT_ROLES, PERMISSIONS, DEPARTMENTS } from '@epc/shared';
import { prisma } from '../lib/db';
import { requirePermission, visibleProjectIds, projectScope } from '../lib/auth';
import { audit } from '../lib/audit';
import { bad, forbidden, notFound } from '../lib/errors';
import { zDate, zDecOpt, zId, idParam } from '../lib/zod';

const projectTypes = ['WTP', 'STP', 'WATER_SUPPLY', 'PIPELINE', 'PUMPING_STATION', 'SEWERAGE', 'CIVIL', 'RCC_BUILDING', 'MECH_ELEC', 'INDUSTRIAL_EPC', 'HYDRO_MECHANICAL', 'OTHER'] as const;

export async function seedCompanyRoles(companyId: string) {
  for (const [code, r] of Object.entries(DEFAULT_ROLES)) {
    const role = await prisma.role.upsert({ where: { companyId_code: { companyId, code } }, update: {}, create: { companyId, code, name: r.name, department: r.department } });
    await prisma.rolePermission.createMany({ data: r.permissions.map((permission) => ({ roleId: role.id, permission })), skipDuplicates: true });
  }
}

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get('/meta/permissions', { schema: { tags: ['org'] } }, async () => ({ permissions: PERMISSIONS, departments: DEPARTMENTS, projectTypes }));

  // Companies
  app.get('/companies', { schema: { tags: ['org'] } }, async (req) => {
    if (req.user.isSuperAdmin) return prisma.company.findMany({ orderBy: { name: 'asc' } });
    const ids = (await prisma.userRoleAssignment.findMany({ where: { userId: req.user.id }, select: { companyId: true } })).map((a) => a.companyId);
    return prisma.company.findMany({ where: { id: { in: ids } }, orderBy: { name: 'asc' } });
  });
  app.post('/companies', { schema: { tags: ['org'], body: z.object({ code: z.string().min(2).max(20), name: z.string().min(2), gstin: z.string().optional(), pan: z.string().optional(), address: z.string().optional() }) } }, async (req) => {
    if (!req.user.isSuperAdmin) throw forbidden('Only a super administrator can create companies');
    const c = await prisma.company.create({ data: req.body });
    await seedCompanyRoles(c.id);
    await prisma.$transaction((tx) => audit(tx, req.user, { entityType: 'Company', entityId: c.id, action: 'CREATE', after: c, companyId: c.id }));
    return c;
  });

  // Projects
  app.get('/projects', { schema: { tags: ['org'] } }, async (req) => {
    const vis = await visibleProjectIds(req.user);
    return prisma.project.findMany({
      where: vis === 'ALL' ? {} : { id: { in: vis } },
      include: { company: { select: { name: true, code: true } }, _count: { select: { contracts: true, workOrders: true, measurements: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });
  app.get('/projects/:id', { schema: { tags: ['org'], params: idParam } }, async (req) => {
    const scope = await projectScope(req.params.id);
    await requirePermission(req.user, 'project.view', scope);
    return prisma.project.findUniqueOrThrow({ where: { id: req.params.id }, include: { company: true, contracts: true, stores: true } });
  });
  const projectBody = z.object({
    companyId: zId, code: z.string().min(2).max(30), name: z.string().min(3), type: z.enum(projectTypes), client: z.string().optional(),
    location: z.string().optional(), state: z.string().optional(), startDate: zDate.optional(), endDate: zDate.optional(),
    status: z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CLOSED']).optional(),
  });
  app.post('/projects', { schema: { tags: ['org'], body: projectBody } }, async (req) => {
    await requirePermission(req.user, 'org.manage', { companyId: req.body.companyId });
    return prisma.$transaction(async (tx) => {
      const p = await tx.project.create({ data: { ...req.body, createdById: req.user.id } });
      await tx.store.create({ data: { projectId: p.id, code: 'MAIN', name: 'Main Site Store' } });
      await audit(tx, req.user, { entityType: 'Project', entityId: p.id, action: 'CREATE', after: p, projectId: p.id, companyId: p.companyId });
      return p;
    });
  });
  app.patch('/projects/:id', { schema: { tags: ['org'], params: idParam, body: projectBody.omit({ companyId: true }).partial() } }, async (req) => {
    const before = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Project');
    await requirePermission(req.user, 'org.manage', { companyId: before.companyId });
    return prisma.$transaction(async (tx) => {
      const p = await tx.project.update({ where: { id: before.id }, data: req.body });
      await audit(tx, req.user, { entityType: 'Project', entityId: p.id, action: 'UPDATE', before, after: p, projectId: p.id, companyId: p.companyId });
      return p;
    });
  });

  // Roles & permissions (configurable per company)
  app.get('/companies/:id/roles', { schema: { tags: ['org'], params: idParam } }, async (req) => {
    await requirePermission(req.user, 'project.view', { companyId: req.params.id }).catch(async () => requirePermission(req.user, 'admin.roles', { companyId: req.params.id }));
    const roles = await prisma.role.findMany({ where: { companyId: req.params.id }, include: { permissions: true, _count: { select: { assignments: true } } }, orderBy: { name: 'asc' } });
    return roles.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permission) }));
  });
  const roleBody = z.object({ code: z.string().min(2).max(40), name: z.string().min(2), department: z.enum(DEPARTMENTS), permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])) });
  app.post('/companies/:id/roles', { schema: { tags: ['org'], params: idParam, body: roleBody } }, async (req) => {
    await requirePermission(req.user, 'admin.roles', { companyId: req.params.id });
    return prisma.$transaction(async (tx) => {
      const r = await tx.role.create({ data: { companyId: req.params.id, code: req.body.code.toUpperCase(), name: req.body.name, department: req.body.department, permissions: { create: req.body.permissions.map((permission) => ({ permission })) } } });
      await audit(tx, req.user, { entityType: 'Role', entityId: r.id, action: 'CREATE', after: req.body, companyId: req.params.id });
      return r;
    });
  });
  app.put('/roles/:id', { schema: { tags: ['org'], params: idParam, body: roleBody.omit({ code: true }) } }, async (req) => {
    const role = await prisma.role.findUnique({ where: { id: req.params.id }, include: { permissions: true } });
    if (!role) throw notFound('Role');
    await requirePermission(req.user, 'admin.roles', { companyId: role.companyId });
    if (role.code === 'SUPER_ADMIN' && !req.user.isSuperAdmin) throw forbidden('Only a super administrator can edit this role');
    return prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      const r = await tx.role.update({ where: { id: role.id }, data: { name: req.body.name, department: req.body.department, permissions: { create: req.body.permissions.map((permission) => ({ permission })) } } });
      await audit(tx, req.user, { entityType: 'Role', entityId: r.id, action: 'UPDATE_PERMISSIONS', before: role.permissions.map((p) => p.permission), after: req.body.permissions, companyId: role.companyId });
      return r;
    });
  });

  // Users
  app.get('/companies/:id/users', { schema: { tags: ['org'], params: idParam } }, async (req) => {
    await requirePermission(req.user, 'admin.users', { companyId: req.params.id });
    return prisma.user.findMany({
      where: { assignments: { some: { companyId: req.params.id } } },
      select: { id: true, name: true, email: true, active: true, isSuperAdmin: true, assignments: { where: { companyId: req.params.id }, include: { role: { select: { name: true, code: true } }, project: { select: { name: true, code: true } } } } },
      orderBy: { name: 'asc' },
    });
  });
  app.post('/companies/:id/users', {
    schema: { tags: ['org'], params: idParam, body: z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(10), roleId: zId, projectId: zId.nullable().optional(), financialLimit: zDecOpt }) },
  }, async (req) => {
    await requirePermission(req.user, 'admin.users', { companyId: req.params.id });
    const role = await prisma.role.findFirst({ where: { id: req.body.roleId, companyId: req.params.id } });
    if (!role) throw bad('Role does not belong to this company');
    if (role.code === 'SUPER_ADMIN' && !req.user.isSuperAdmin) throw forbidden('Only a super administrator can grant this role');
    return prisma.$transaction(async (tx) => {
      const email = req.body.email.toLowerCase();
      const existing = await tx.user.findUnique({ where: { email } });
      const u = existing ?? (await tx.user.create({ data: { name: req.body.name, email, passwordHash: await bcrypt.hash(req.body.password, 10) } }));
      const a = await tx.userRoleAssignment.create({ data: { userId: u.id, roleId: role.id, companyId: req.params.id, projectId: req.body.projectId ?? null, financialLimit: req.body.financialLimit ?? null } });
      await audit(tx, req.user, { entityType: 'User', entityId: u.id, action: existing ? 'ASSIGN_ROLE' : 'CREATE', after: { email, role: role.code, projectId: a.projectId, financialLimit: a.financialLimit }, companyId: req.params.id });
      return { id: u.id, name: u.name, email: u.email };
    });
  });
  app.post('/users/:id/assignments', { schema: { tags: ['org'], params: idParam, body: z.object({ companyId: zId, roleId: zId, projectId: zId.nullable().optional(), financialLimit: zDecOpt }) } }, async (req) => {
    await requirePermission(req.user, 'admin.users', { companyId: req.body.companyId });
    const role = await prisma.role.findFirst({ where: { id: req.body.roleId, companyId: req.body.companyId } });
    if (!role) throw bad('Role does not belong to this company');
    if (role.code === 'SUPER_ADMIN' && !req.user.isSuperAdmin) throw forbidden();
    return prisma.$transaction(async (tx) => {
      const a = await tx.userRoleAssignment.create({ data: { userId: req.params.id, roleId: role.id, companyId: req.body.companyId, projectId: req.body.projectId ?? null, financialLimit: req.body.financialLimit ?? null } });
      await audit(tx, req.user, { entityType: 'User', entityId: req.params.id, action: 'ASSIGN_ROLE', after: a, companyId: req.body.companyId });
      return a;
    });
  });
  app.delete('/assignments/:id', { schema: { tags: ['org'], params: idParam } }, async (req) => {
    const a = await prisma.userRoleAssignment.findUnique({ where: { id: req.params.id } });
    if (!a) throw notFound('Assignment');
    await requirePermission(req.user, 'admin.users', { companyId: a.companyId });
    await prisma.$transaction(async (tx) => {
      await tx.userRoleAssignment.delete({ where: { id: a.id } });
      await audit(tx, req.user, { entityType: 'User', entityId: a.userId, action: 'REVOKE_ROLE', before: a, companyId: a.companyId });
    });
    return { ok: true };
  });
  app.patch('/users/:id', { schema: { tags: ['org'], params: idParam, body: z.object({ companyId: zId, active: z.boolean().optional(), name: z.string().optional() }) } }, async (req) => {
    await requirePermission(req.user, 'admin.users', { companyId: req.body.companyId });
    if (req.params.id === req.user.id && req.body.active === false) throw bad('You cannot deactivate yourself');
    const { companyId, ...data } = req.body;
    return prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id: req.params.id }, data, select: { id: true, name: true, active: true } });
      await audit(tx, req.user, { entityType: 'User', entityId: u.id, action: 'UPDATE', after: data, companyId });
      return u;
    });
  });

  // Audit log
  app.get('/audit', { schema: { tags: ['org'], querystring: z.object({ companyId: zId, projectId: zId.optional(), entityType: z.string().optional(), entityId: z.string().optional(), take: z.coerce.number().max(500).default(100) }) } }, async (req) => {
    await requirePermission(req.user, 'audit.view', { companyId: req.query.companyId, projectId: req.query.projectId });
    return prisma.auditLog.findMany({
      where: { companyId: req.query.companyId, ...(req.query.projectId ? { projectId: req.query.projectId } : {}), ...(req.query.entityType ? { entityType: req.query.entityType } : {}), ...(req.query.entityId ? { entityId: req.query.entityId } : {}) },
      orderBy: { at: 'desc' }, take: req.query.take,
    });
  });
  app.get('/workflow/:entityType/:entityId', { schema: { tags: ['org'], params: z.object({ entityType: z.string(), entityId: z.string() }) } }, async (req) =>
    prisma.workflowAction.findMany({ where: { entityType: req.params.entityType, entityId: req.params.entityId }, orderBy: { at: 'asc' } }));
};
export default routes;
