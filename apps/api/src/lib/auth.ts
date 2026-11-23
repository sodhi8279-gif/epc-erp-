import type { FastifyRequest } from 'fastify';
import { DEFAULT_ROLES, type Permission, D } from '@epc/shared';
import { prisma, type Tx } from './db';
import { AppError, forbidden } from './errors';

export interface AuthUser { id: string; name: string; email: string; isSuperAdmin: boolean }

declare module 'fastify' {
  interface FastifyRequest { user: AuthUser }
}
declare module '@fastify/jwt' {
  interface FastifyJWT { payload: { sub: string }; user: AuthUser }
}

export interface Scope { companyId: string; projectId?: string | null }

/** Collects the permissions a user holds in a company/project scope, with the highest financial limit per permission. */
export async function permissionsFor(userId: string, scope: Scope, db: Tx | typeof prisma = prisma) {
  const assignments = await db.userRoleAssignment.findMany({
    where: {
      userId, companyId: scope.companyId,
      OR: [{ projectId: null }, ...(scope.projectId ? [{ projectId: scope.projectId }] : [])],
    },
    include: { role: { include: { permissions: true } } },
  });
  const perms = new Map<string, { limit: string | null }>();
  for (const a of assignments) {
    for (const p of a.role.permissions) {
      const cur = perms.get(p.permission);
      const lim = a.financialLimit === null ? null : a.financialLimit.toString();
      if (!cur) perms.set(p.permission, { limit: lim });
      else if (cur.limit !== null && (lim === null || D(lim).gt(cur.limit))) cur.limit = lim;
    }
  }
  return perms;
}

/**
 * Throws 403 unless the user has the permission in scope. If `amount` is given, the user's financial
 * limit for that permission must cover it (null limit = unlimited).
 */
export async function requirePermission(user: AuthUser, permission: Permission, scope: Scope, amount?: string | number | null, db?: Tx) {
  if (user.isSuperAdmin) return;
  const perms = await permissionsFor(user.id, scope, db);
  const p = perms.get(permission);
  if (!p) throw forbidden(`Missing permission: ${permission}`);
  if (amount !== undefined && amount !== null && p.limit !== null && D(amount).gt(p.limit)) {
    throw new AppError(403, 'FINANCIAL_LIMIT', `Amount ₹${D(amount).toFixed(2)} exceeds your approval limit of ₹${D(p.limit).toFixed(2)}`);
  }
}

export async function hasPermission(user: AuthUser, permission: Permission, scope: Scope) {
  try { await requirePermission(user, permission, scope); return true; } catch { return false; }
}

export async function projectScope(projectId: string): Promise<Scope> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { companyId: true } });
  if (!p) throw new AppError(404, 'NOT_FOUND', 'Project not found');
  return { companyId: p.companyId, projectId };
}

/** Projects the user may see. */
export async function visibleProjectIds(user: AuthUser): Promise<string[] | 'ALL'> {
  if (user.isSuperAdmin) return 'ALL';
  const a = await prisma.userRoleAssignment.findMany({ where: { userId: user.id }, select: { companyId: true, projectId: true } });
  const companyWide = a.filter((x) => !x.projectId).map((x) => x.companyId);
  const projects = await prisma.project.findMany({
    where: { OR: [{ companyId: { in: companyWide } }, { id: { in: a.map((x) => x.projectId!).filter(Boolean) } }] },
    select: { id: true },
  });
  return projects.map((p) => p.id);
}

export const getUser = (req: FastifyRequest) => req.user;
export { DEFAULT_ROLES };
