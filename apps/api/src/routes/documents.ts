import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { requirePermission } from '../lib/auth';
import { putObject, getObject } from '../lib/storage';
import { audit } from '../lib/audit';
import { bad, notFound } from '../lib/errors';
import { idParam } from '../lib/zod';

const ALLOWED = /\.(pdf|xlsx|xls|csv|docx|doc|jpg|jpeg|png|dwg|dxf|zip|txt)$/i;

export async function storeUpload(req: import('fastify').FastifyRequest) {
  const file = await req.file();
  if (!file) throw bad('No file uploaded');
  if (!ALLOWED.test(file.filename)) throw bad('File type not allowed');
  const buf = await file.toBuffer();
  const fields = Object.fromEntries(Object.entries(file.fields).map(([k, v]) => [k, (v as { value?: string })?.value]).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  return { file, buf, fields };
}

const routes: FastifyPluginAsyncZod = async (app) => {
  app.post('/documents', { schema: { tags: ['documents'], consumes: ['multipart/form-data'] } }, async (req) => {
    const { file, buf, fields } = await storeUpload(req);
    const companyId = fields.companyId;
    if (!companyId) throw bad('companyId is required');
    await requirePermission(req.user, 'document.upload', { companyId, projectId: fields.projectId || null });
    const obj = await putObject(buf);
    return prisma.$transaction(async (tx) => {
      const d = await tx.document.create({
        data: { companyId, projectId: fields.projectId || null, entityType: fields.entityType || null, entityId: fields.entityId || null, category: fields.category || 'GENERAL', originalName: file.filename, mimeType: file.mimetype, size: buf.length, ...obj, uploadedById: req.user.id },
      });
      await audit(tx, req.user, { entityType: 'Document', entityId: d.id, action: 'UPLOAD', after: { name: d.originalName, sha256: d.sha256, category: d.category, entityType: d.entityType, entityId: d.entityId }, companyId, projectId: d.projectId });
      return d;
    });
  });
  app.get('/documents', { schema: { tags: ['documents'], querystring: z.object({ companyId: z.string().uuid(), projectId: z.string().uuid().optional(), entityType: z.string().optional(), entityId: z.string().optional() }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', { companyId: req.query.companyId, projectId: req.query.projectId });
    return prisma.document.findMany({ where: { companyId: req.query.companyId, projectId: req.query.projectId, entityType: req.query.entityType, entityId: req.query.entityId }, orderBy: { uploadedAt: 'desc' } });
  });
  app.get('/documents/:id/download', { schema: { tags: ['documents'], params: idParam } }, async (req, reply) => {
    const d = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!d) throw notFound('Document');
    await requirePermission(req.user, 'project.view', { companyId: d.companyId, projectId: d.projectId });
    const buf = await getObject(d.storagePath);
    reply.header('Content-Type', d.mimeType).header('Content-Disposition', `attachment; filename="${encodeURIComponent(d.originalName)}"`);
    return reply.send(buf);
  });
};
export default routes;
