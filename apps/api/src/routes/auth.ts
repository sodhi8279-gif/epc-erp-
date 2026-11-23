import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/db';
import { AppError } from '../lib/errors';
import { permissionsFor } from '../lib/auth';
import { ALL_PERMISSIONS } from '@epc/shared';

const routes: FastifyPluginAsyncZod = async (app) => {
  app.post('/auth/login', { schema: { tags: ['auth'], body: z.object({ email: z.string().email(), password: z.string().min(1) }) } }, async (req, reply) => {
    const u = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } });
    if (!u || !u.active || !(await bcrypt.compare(req.body.password, u.passwordHash))) throw new AppError(401, 'BAD_CREDENTIALS', 'Incorrect email or password');
    const token = app.jwt.sign({ sub: u.id });
    reply.setCookie('epc_token', token, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' });
    return { token, user: { id: u.id, name: u.name, email: u.email, isSuperAdmin: u.isSuperAdmin } };
  });

  app.post('/auth/logout', { schema: { tags: ['auth'] } }, async (_req, reply) => {
    reply.clearCookie('epc_token', { path: '/' });
    return { ok: true };
  });

  /** Current user plus effective permissions per company and per project (drives what the UI offers). */
  app.get('/auth/me', { schema: { tags: ['auth'] } }, async (req) => {
    const u = req.user;
    const assignments = await prisma.userRoleAssignment.findMany({ where: { userId: u.id }, include: { role: true, project: { select: { name: true, code: true } }, company: { select: { name: true } } } });
    const scopes: Record<string, string[]> = {};
    if (u.isSuperAdmin) scopes['*'] = ALL_PERMISSIONS;
    const companies = [...new Set(assignments.map((a) => a.companyId))];
    for (const c of companies) {
      scopes[`company:${c}`] = [...(await permissionsFor(u.id, { companyId: c })).keys()];
      const projects = await prisma.project.findMany({ where: { companyId: c }, select: { id: true } });
      for (const p of projects) {
        const perms = [...(await permissionsFor(u.id, { companyId: c, projectId: p.id })).keys()];
        if (perms.length) scopes[`project:${p.id}`] = perms;
      }
    }
    return {
      user: u,
      assignments: assignments.map((a) => ({ id: a.id, role: a.role.name, roleCode: a.role.code, company: a.company.name, companyId: a.companyId, projectId: a.projectId, project: a.project?.name ?? null, financialLimit: a.financialLimit })),
      scopes,
    };
  });

  app.post('/auth/change-password', { schema: { tags: ['auth'], body: z.object({ current: z.string(), next: z.string().min(10) }) } }, async (req) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
    if (!(await bcrypt.compare(req.body.current, u.passwordHash))) throw new AppError(400, 'BAD_CREDENTIALS', 'Current password is incorrect');
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(req.body.next, 10) } });
    return { ok: true };
  });
};
export default routes;
