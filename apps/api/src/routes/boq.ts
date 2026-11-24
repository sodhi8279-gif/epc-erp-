import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { D, money, UNIT_CODES } from '@epc/shared';
import { prisma } from '../lib/db';
import { requirePermission, projectScope } from '../lib/auth';
import { audit, logWorkflow } from '../lib/audit';
import { bad, conflict, notFound } from '../lib/errors';
import { idParam, zDate, zDec, zDecPos, zId } from '../lib/zod';
import { putObject, getObject } from '../lib/storage';
import { storeUpload } from './documents';
import { addItem, assertDraft, compareRevision, createRevision, validateRevision } from '../services/boq';
import { extractRows, FIELDS, importSummary, isPdf, previewWorkbook, readSheets, validateRows, type ImportRow } from '../services/boqImport';

async function contractScope(contractId: string) {
  const c = await prisma.contract.findUnique({ where: { id: contractId }, include: { project: true } });
  if (!c) throw notFound('Contract');
  return { contract: c, scope: { companyId: c.project.companyId, projectId: c.projectId } };
}
async function revisionScope(revisionId: string) {
  const r = await prisma.boqRevision.findUnique({ where: { id: revisionId } });
  if (!r) throw notFound('BOQ revision');
  return { rev: r, ...(await contractScope(r.contractId)) };
}

const itemBody = z.object({
  itemNo: z.string().min(1), description: z.string().min(1), unit: z.enum(UNIT_CODES as [string, ...string[]]), quantity: zDecPos, rate: zDecPos,
  sectionId: zId.nullable().optional(), isHeader: z.boolean().optional(), kind: z.enum(['ORIGINAL', 'EXTRA', 'SUBSTITUTED', 'DEVIATED']).optional(),
  substitutesKey: z.string().nullable().optional(), specRef: z.string().nullable().optional(), drawingRef: z.string().nullable().optional(), contractRef: z.string().nullable().optional(), sortOrder: z.number().int().optional(),
});

const routes: FastifyPluginAsyncZod = async (app) => {
  // ── Contracts
  app.get('/projects/:projectId/contracts', { schema: { tags: ['boq'], params: z.object({ projectId: zId }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    return prisma.contract.findMany({ where: { projectId: req.params.projectId }, include: { revisions: { orderBy: { revisionNo: 'asc' }, select: { id: true, revisionNo: true, type: true, status: true, title: true, effectiveDate: true } } }, orderBy: { createdAt: 'asc' } });
  });
  const contractBody = z.object({
    contractNo: z.string().min(1), title: z.string().min(3), client: z.string().min(2), type: z.enum(['ITEM_RATE', 'PERCENTAGE_RATE', 'LUMP_SUM', 'EPC', 'DESIGN_BUILD']).default('ITEM_RATE'),
    contractValue: zDecPos, agreementDate: zDate.optional(), loaRef: z.string().optional(), startDate: zDate.optional(), completionDate: zDate.optional(), rebatePercent: zDec.optional(),
  });
  app.post('/projects/:projectId/contracts', { schema: { tags: ['boq'], params: z.object({ projectId: zId }), body: contractBody } }, async (req) => {
    const scope = await projectScope(req.params.projectId);
    await requirePermission(req.user, 'contract.manage', scope);
    return prisma.$transaction(async (tx) => {
      const c = await tx.contract.create({ data: { ...req.body, projectId: req.params.projectId } });
      await audit(tx, req.user, { entityType: 'Contract', entityId: c.id, action: 'CREATE', after: c, ...scope });
      return c;
    });
  });
  app.get('/contracts/:id', { schema: { tags: ['boq'], params: idParam } }, async (req) => {
    const { scope } = await contractScope(req.params.id);
    await requirePermission(req.user, 'project.view', scope);
    return prisma.contract.findUniqueOrThrow({ where: { id: req.params.id }, include: { project: { select: { id: true, name: true, code: true, companyId: true } }, revisions: { orderBy: { revisionNo: 'asc' } } } });
  });
  app.patch('/contracts/:id', { schema: { tags: ['boq'], params: idParam, body: contractBody.partial() } }, async (req) => {
    const { scope, contract } = await contractScope(req.params.id);
    await requirePermission(req.user, 'contract.manage', scope);
    return prisma.$transaction(async (tx) => {
      const c = await tx.contract.update({ where: { id: contract.id }, data: req.body });
      await audit(tx, req.user, { entityType: 'Contract', entityId: c.id, action: 'UPDATE', before: contract, after: c, ...scope });
      return c;
    });
  });

  // ── Revisions
  app.post('/contracts/:id/revisions', { schema: { tags: ['boq'], params: idParam, body: z.object({ type: z.enum(['ORIGINAL', 'REVISED', 'VARIATION']), title: z.string().min(2), authorityRef: z.string().optional(), remarks: z.string().optional(), sourceDocumentId: zId.optional() }) } }, async (req) => {
    const { scope } = await contractScope(req.params.id);
    await requirePermission(req.user, 'boq.edit', scope);
    return prisma.$transaction(async (tx) => {
      const r = await createRevision(tx, req.params.id, req.user.id, req.body);
      await audit(tx, req.user, { entityType: 'BoqRevision', entityId: r.id, action: 'CREATE', after: r, ...scope });
      await logWorkflow(tx, req.user, { entityType: 'BoqRevision', entityId: r.id, action: 'create', toStatus: 'DRAFT' });
      return r;
    });
  });
  app.get('/revisions/:id', { schema: { tags: ['boq'], params: idParam } }, async (req) => {
    const { scope } = await revisionScope(req.params.id);
    await requirePermission(req.user, 'project.view', scope);
    const rev = await prisma.boqRevision.findUniqueOrThrow({ where: { id: req.params.id }, include: { sections: { orderBy: { sortOrder: 'asc' } }, items: { orderBy: { sortOrder: 'asc' } }, contract: { select: { id: true, contractNo: true, title: true, projectId: true } } } });
    const total = money(rev.items.reduce((s, i) => s.plus(i.amount.toString()), D(0)));
    return { ...rev, total };
  });
  app.get('/revisions/:id/compare', { schema: { tags: ['boq'], params: idParam } }, async (req) => {
    const { scope } = await revisionScope(req.params.id);
    await requirePermission(req.user, 'project.view', scope);
    return compareRevision(req.params.id);
  });
  app.get('/revisions/:id/validate', { schema: { tags: ['boq'], params: idParam } }, async (req) => {
    const { scope } = await revisionScope(req.params.id);
    await requirePermission(req.user, 'project.view', scope);
    return prisma.$transaction((tx) => validateRevision(tx, req.params.id));
  });
  app.delete('/revisions/:id', { schema: { tags: ['boq'], params: idParam } }, async (req) => {
    const { scope, rev } = await revisionScope(req.params.id);
    await requirePermission(req.user, 'boq.edit', scope);
    if (rev.status !== 'DRAFT' && rev.status !== 'REJECTED') throw conflict('Only draft or rejected revisions can be discarded');
    await prisma.$transaction(async (tx) => {
      await tx.boqImport.updateMany({ where: { revisionId: rev.id }, data: { revisionId: null, status: 'CANCELLED' } });
      await tx.boqRevision.delete({ where: { id: rev.id } });
      await audit(tx, req.user, { entityType: 'BoqRevision', entityId: rev.id, action: 'DISCARD', before: rev, ...scope });
    });
    return { ok: true };
  });

  const transition = (action: 'submit' | 'approve' | 'reject') => async (req: { params: { id: string }; body: { comment?: string; effectiveDate?: Date; acknowledgeWarnings?: boolean }; user: import('../lib/auth').AuthUser }) => {
    const { scope, rev, contract } = await revisionScope(req.params.id);
    await requirePermission(req.user, action === 'submit' ? 'boq.edit' : 'boq.approve', scope);
    return prisma.$transaction(async (tx) => {
      const from = rev.status;
      if (action === 'submit' && from !== 'DRAFT') throw conflict('Only a draft revision can be submitted');
      if (action !== 'submit' && from !== 'SUBMITTED') throw conflict('Only a submitted revision can be approved or rejected');
      if (action === 'reject' && !req.body.comment) throw bad('A reason is required to reject');
      let to = action === 'submit' ? 'SUBMITTED' : action === 'approve' ? 'APPROVED' : 'REJECTED';
      if (action !== 'reject') {
        const v = await validateRevision(tx, rev.id);
        if (v.errors.length) throw bad('BOQ revision has errors', v.errors);
        if (action === 'approve' && v.warnings.length && !req.body.acknowledgeWarnings) throw conflict('Approval needs acknowledgement of warnings', v.warnings);
      }
      if (action === 'reject') to = 'DRAFT'; // returned to draft for correction, the rejection is in the workflow log
      if (action === 'approve') {
        await tx.boqRevision.updateMany({ where: { contractId: contract.id, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
        await tx.boqRevision.update({ where: { id: rev.id }, data: { status: 'APPROVED', approvedById: req.user.id, approvedAt: new Date(), effectiveDate: req.body.effectiveDate ?? new Date() } });
        if (rev.type === 'ORIGINAL' || rev.type === 'REVISED') {
          const total = await (await import('../services/boq')).recomputeRevisionTotals(tx, rev.id);
          await tx.contract.update({ where: { id: contract.id }, data: { contractValue: total.toString() } });
        }
      } else {
        await tx.boqRevision.update({ where: { id: rev.id }, data: { status: to as 'SUBMITTED' | 'DRAFT' } });
      }
      await logWorkflow(tx, req.user, { entityType: 'BoqRevision', entityId: rev.id, action, fromStatus: from, toStatus: to, comment: req.body.comment });
      await audit(tx, req.user, { entityType: 'BoqRevision', entityId: rev.id, action: action.toUpperCase(), before: { status: from }, after: { status: to }, reason: req.body.comment, ...scope });
      return tx.boqRevision.findUniqueOrThrow({ where: { id: rev.id } });
    });
  };
  const tBody = z.object({ comment: z.string().optional(), effectiveDate: zDate.optional(), acknowledgeWarnings: z.boolean().optional() });
  app.post('/revisions/:id/submit', { schema: { tags: ['boq'], params: idParam, body: tBody } }, (req) => transition('submit')(req));
  app.post('/revisions/:id/approve', { schema: { tags: ['boq'], params: idParam, body: tBody } }, (req) => transition('approve')(req));
  app.post('/revisions/:id/reject', { schema: { tags: ['boq'], params: idParam, body: tBody } }, (req) => transition('reject')(req));

  // ── Sections & items (draft only)
  app.post('/revisions/:id/sections', { schema: { tags: ['boq'], params: idParam, body: z.object({ code: z.string().min(1), name: z.string().min(1), sortOrder: z.number().int().default(0) }) } }, async (req) => {
    const { scope } = await revisionScope(req.params.id);
    await requirePermission(req.user, 'boq.edit', scope);
    return prisma.$transaction(async (tx) => { await assertDraft(tx, req.params.id); return tx.boqSection.create({ data: { ...req.body, revisionId: req.params.id } }); });
  });
  app.post('/revisions/:id/items', { schema: { tags: ['boq'], params: idParam, body: itemBody } }, async (req) => {
    const { scope } = await revisionScope(req.params.id);
    await requirePermission(req.user, 'boq.edit', scope);
    return prisma.$transaction(async (tx) => {
      const i = await addItem(tx, req.params.id, req.body);
      await audit(tx, req.user, { entityType: 'BoqItem', entityId: i.id, action: 'CREATE', after: i, ...scope });
      return i;
    });
  });
  app.patch('/boq-items/:id', { schema: { tags: ['boq'], params: idParam, body: itemBody.partial() } }, async (req) => {
    const item = await prisma.boqItem.findUnique({ where: { id: req.params.id } });
    if (!item) throw notFound('BOQ item');
    const { scope } = await revisionScope(item.revisionId);
    await requirePermission(req.user, 'boq.edit', scope);
    return prisma.$transaction(async (tx) => {
      await assertDraft(tx, item.revisionId);
      const q = req.body.quantity ?? item.quantity.toString();
      const r = req.body.rate ?? item.rate.toString();
      const isHeader = req.body.isHeader ?? item.isHeader;
      const updated = await tx.boqItem.update({ where: { id: item.id }, data: { ...req.body, amount: isHeader ? '0' : money(D(q).times(r)).toString() } });
      await audit(tx, req.user, { entityType: 'BoqItem', entityId: item.id, action: 'UPDATE', before: item, after: updated, ...scope });
      return updated;
    });
  });
  app.delete('/boq-items/:id', { schema: { tags: ['boq'], params: idParam } }, async (req) => {
    const item = await prisma.boqItem.findUnique({ where: { id: req.params.id } });
    if (!item) throw notFound('BOQ item');
    const { scope } = await revisionScope(item.revisionId);
    await requirePermission(req.user, 'boq.edit', scope);
    await prisma.$transaction(async (tx) => {
      await assertDraft(tx, item.revisionId);
      await tx.boqItem.delete({ where: { id: item.id } });
      await audit(tx, req.user, { entityType: 'BoqItem', entityId: item.id, action: 'DELETE', before: item, ...scope });
    });
    return { ok: true };
  });

  // ── Import wizard: upload → map → review/correct → confirm (creates a DRAFT revision only)
  app.post('/contracts/:id/imports', { schema: { tags: ['boq-import'], params: idParam, consumes: ['multipart/form-data'] } }, async (req) => {
    const { scope } = await contractScope(req.params.id);
    await requirePermission(req.user, 'boq.edit', scope);
    const { file, buf } = await storeUpload(req);
    const obj = await putObject(buf);
    let sheets;
    try { sheets = await previewWorkbook(buf, file.filename); } catch (e) { sheets = null; var parseError = (e as Error).message; }
    return prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({ data: { companyId: scope.companyId, projectId: scope.projectId, entityType: 'Contract', entityId: req.params.id, category: 'BOQ_SOURCE', originalName: file.filename, mimeType: file.mimetype, size: buf.length, ...obj, uploadedById: req.user.id } });
      const imp = await tx.boqImport.create({ data: { contractId: req.params.id, documentId: doc.id, createdById: req.user.id, status: sheets ? 'UPLOADED' : 'CANCELLED' } });
      await audit(tx, req.user, { entityType: 'BoqImport', entityId: imp.id, action: 'UPLOAD', after: { file: file.filename, sha256: obj.sha256 }, ...scope });
      return { import: imp, document: doc, sheets, parseError, fields: FIELDS };
    });
  });
  // `?sheets=1` also returns the sheet previews for a MAPPED import, so the user can go back and change the mapping.
  app.get('/imports/:id', { schema: { tags: ['boq-import'], params: idParam, querystring: z.object({ sheets: z.enum(['0', '1']).optional() }) } }, async (req) => {
    const imp = await prisma.boqImport.findUnique({ where: { id: req.params.id } });
    if (!imp) throw notFound('Import');
    const { scope } = await contractScope(imp.contractId);
    await requirePermission(req.user, 'project.view', scope);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: imp.documentId } });
    const rows = (imp.rows as unknown as ImportRow[] | null) ?? [];
    return { ...imp, document: doc, summary: importSummary(rows), sheets: imp.status === 'UPLOADED' || (imp.status === 'MAPPED' && req.query.sheets === '1') ? await previewWorkbook(await getObject(doc.storagePath), doc.originalName) : undefined };
  });
  const mappingSchema = z.object(Object.fromEntries(FIELDS.map((f) => [f, z.number().int().positive().optional()]))) as z.ZodType<Partial<Record<(typeof FIELDS)[number], number>>>;
  app.post('/imports/:id/map', { schema: { tags: ['boq-import'], params: idParam, body: z.object({ sheetName: z.string(), headerRow: z.number().int().positive(), mapping: mappingSchema }) } }, async (req) => {
    const imp = await prisma.boqImport.findUnique({ where: { id: req.params.id } });
    if (!imp) throw notFound('Import');
    if (imp.status === 'CONFIRMED' || imp.status === 'CANCELLED') throw conflict(`Import is ${imp.status}`);
    const { scope } = await contractScope(imp.contractId);
    await requirePermission(req.user, 'boq.edit', scope);
    const m = req.body.mapping;
    if (!m.description || !m.quantity || !m.rate || !m.itemNo) throw bad('Item number, description, quantity and rate columns must be mapped');
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: imp.documentId } });
    const sheets = await readSheets(await getObject(doc.storagePath), doc.originalName);
    const ws = sheets.find((s) => s.name === req.body.sheetName);
    if (!ws) throw bad('Sheet not found');
    const rows = extractRows(ws.matrix, req.body.headerRow, m, { joinWrapped: isPdf(doc.originalName) });
    await prisma.boqImport.update({ where: { id: imp.id }, data: { status: 'MAPPED', sheetName: req.body.sheetName, headerRow: req.body.headerRow, mapping: m, rows: rows as never } });
    return { rows, summary: importSummary(rows) };
  });
  const rowSchema = z.object({ rowNo: z.number(), kind: z.enum(['ITEM', 'HEADER', 'SKIP']), itemNo: z.string(), description: z.string(), unitRaw: z.string(), unit: z.string().nullable(), unitInferred: z.string().nullable().optional(), quantity: z.string().nullable(), rate: z.string().nullable(), amount: z.string().nullable(), specRef: z.string().nullable().optional(), drawingRef: z.string().nullable().optional(), issues: z.array(z.any()).optional() });
  app.put('/imports/:id/rows', { schema: { tags: ['boq-import'], params: idParam, body: z.object({ rows: z.array(rowSchema) }) } }, async (req) => {
    const imp = await prisma.boqImport.findUnique({ where: { id: req.params.id } });
    if (!imp || imp.status !== 'MAPPED') throw conflict('Import must be mapped before corrections');
    const { scope } = await contractScope(imp.contractId);
    await requirePermission(req.user, 'boq.edit', scope);
    const rows = validateRows(req.body.rows.map((r) => ({ ...r, issues: [] })) as ImportRow[]);
    await prisma.boqImport.update({ where: { id: imp.id }, data: { rows: rows as never } });
    return { rows, summary: importSummary(rows) };
  });
  app.post('/imports/:id/confirm', { schema: { tags: ['boq-import'], params: idParam, body: z.object({ title: z.string().min(2), acknowledgeWarnings: z.boolean().default(false) }) } }, async (req) => {
    const imp = await prisma.boqImport.findUnique({ where: { id: req.params.id } });
    if (!imp || imp.status !== 'MAPPED') throw conflict('Import must be mapped and reviewed before confirmation');
    const { scope } = await contractScope(imp.contractId);
    await requirePermission(req.user, 'boq.edit', scope);
    const rows = validateRows((imp.rows as unknown as ImportRow[]) ?? []);
    const s = importSummary(rows);
    if (s.errors > 0) throw bad(`${s.errors} error(s) must be corrected before the BOQ can be created`);
    if (s.warnings > 0 && !req.body.acknowledgeWarnings) throw conflict(`${s.warnings} warning(s) must be acknowledged`);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: imp.documentId } });
    return prisma.$transaction(async (tx) => {
      const approved = await tx.boqRevision.findFirst({ where: { contractId: imp.contractId, status: 'APPROVED' } });
      const rev = await createRevision(tx, imp.contractId, req.user.id, { type: approved ? 'REVISED' : 'ORIGINAL', title: req.body.title, sourceDocumentId: imp.documentId, remarks: `Imported from ${doc.originalName}${imp.sheetName && !isPdf(doc.originalName) ? ` (sheet ${imp.sheetName})` : ''}` });
      // For a revised BOQ: match imported rows to existing items by item number so item identity (and history) is kept.
      const existing = approved ? await tx.boqItem.findMany({ where: { revisionId: rev.id } }) : [];
      const byNo = new Map(existing.map((e) => [e.itemNo.toUpperCase(), e]));
      let order = 0;
      let section: string | null = null;
      for (const r of rows) {
        if (r.kind === 'SKIP') continue;
        order += 10;
        const match = byNo.get(r.itemNo.toUpperCase());
        if (r.kind === 'HEADER') {
          if (match) { byNo.delete(r.itemNo.toUpperCase()); continue; }
          const h = await addItem(tx, rev.id, { itemNo: r.itemNo || `H${order}`, description: r.description, unit: 'LS', quantity: '0', rate: '0', isHeader: true, sortOrder: order });
          section = h.id;
          continue;
        }
        void section;
        const amount = money(D(r.quantity!).times(r.rate!)).toString();
        if (match) {
          byNo.delete(r.itemNo.toUpperCase());
          const changed = !D(match.quantity.toString()).eq(r.quantity!) || !D(match.rate.toString()).eq(r.rate!);
          await tx.boqItem.update({ where: { id: match.id }, data: { description: r.description, unit: r.unit!, quantity: r.quantity!, rate: r.rate!, amount, kind: changed && match.kind === 'ORIGINAL' ? 'DEVIATED' : match.kind, sortOrder: order } });
        } else {
          await addItem(tx, rev.id, { itemNo: r.itemNo, description: r.description, unit: r.unit!, quantity: r.quantity!, rate: r.rate!, sortOrder: order, specRef: r.specRef, drawingRef: r.drawingRef });
        }
      }
      // Items missing from a revised import are removed from the draft (visible in the comparison before approval).
      for (const left of byNo.values()) await tx.boqItem.delete({ where: { id: left.id } });
      await tx.boqImport.update({ where: { id: imp.id }, data: { status: 'CONFIRMED', revisionId: rev.id } });
      await audit(tx, req.user, { entityType: 'BoqImport', entityId: imp.id, action: 'CONFIRM', after: { revisionId: rev.id, ...s }, ...scope });
      await logWorkflow(tx, req.user, { entityType: 'BoqRevision', entityId: rev.id, action: 'import', toStatus: 'DRAFT', comment: `Imported ${s.items} items` });
      return { revision: rev, summary: s };
    });
  });

  /** BOQ status for a contract: per item, quantities across the execution chain. */
  app.get('/contracts/:id/boq-status', { schema: { tags: ['boq'], params: idParam } }, async (req) => {
    const { scope } = await contractScope(req.params.id);
    await requirePermission(req.user, 'project.view', scope);
    const rev = await prisma.boqRevision.findFirst({ where: { contractId: req.params.id, status: 'APPROVED' } });
    if (!rev) return { revision: null, items: [] };
    const original = await prisma.boqRevision.findFirst({ where: { contractId: req.params.id, type: 'ORIGINAL', status: { in: ['APPROVED', 'SUPERSEDED'] } } });
    const origItems = original ? await prisma.boqItem.findMany({ where: { revisionId: original.id } }) : [];
    const items = await prisma.boqItem.findMany({ where: { revisionId: rev.id }, orderBy: { sortOrder: 'asc' } });
    const acts = await prisma.executionActivity.findMany({ where: { contractId: req.params.id }, select: { id: true, itemKey: true, status: true } });
    return { revision: rev, items: items.map((i) => ({ ...i, originalQuantity: origItems.find((o) => o.itemKey === i.itemKey)?.quantity ?? null, activityCount: acts.filter((a) => a.itemKey === i.itemKey).length, breakupApproved: acts.some((a) => a.itemKey === i.itemKey) && acts.filter((a) => a.itemKey === i.itemKey).every((a) => a.status === 'APPROVED') })) };
  });
};
export default routes;
