import type { Tx } from './db';
import type { AuthUser } from './auth';

const plain = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export async function audit(tx: Tx, user: AuthUser, e: { entityType: string; entityId: string; action: string; before?: unknown; after?: unknown; reason?: string; projectId?: string | null; companyId?: string | null }) {
  let companyId = e.companyId ?? null;
  if (!companyId && e.projectId) companyId = (await tx.project.findUnique({ where: { id: e.projectId }, select: { companyId: true } }))?.companyId ?? null;
  await tx.auditLog.create({
    data: {
      userId: user.id, userName: user.name, entityType: e.entityType, entityId: e.entityId, action: e.action,
      before: plain(e.before), after: plain(e.after), reason: e.reason, projectId: e.projectId ?? null, companyId,
    },
  });
}

export async function logWorkflow(tx: Tx, user: AuthUser, e: { entityType: string; entityId: string; action: string; fromStatus?: string | null; toStatus: string; comment?: string | null }) {
  await tx.workflowAction.create({ data: { ...e, fromStatus: e.fromStatus ?? null, comment: e.comment ?? null, userId: user.id, userName: user.name } });
}
