import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { D, money, UNIT_CODES } from '@epc/shared';
import { prisma, type Tx } from '../lib/db';
import { requirePermission, projectScope, type AuthUser } from '../lib/auth';
import { audit, logWorkflow } from '../lib/audit';
import { nextNo } from '../lib/sequence';
import { bad, conflict, notFound } from '../lib/errors';
import { idParam, zDate, zDec, zDecOpt, zDecPos, zId } from '../lib/zod';
import { buildReconciliation, contractorBalance, stockPosition } from '../services/materials';

const pp = z.object({ projectId: zId });
const categories = ['CEMENT', 'STEEL', 'STRUCTURAL_STEEL', 'PIPE', 'FITTING', 'VALVE', 'ELECTRODE', 'FASTENER', 'AGGREGATE', 'SAND', 'ADMIXTURE', 'CONSUMABLE', 'TOOL', 'OTHER'] as const;
const bases = ['RECOVERABLE', 'FREE_ISSUE', 'SUBCONTRACTOR_SUPPLIED', 'RETURNABLE', 'CONSUMABLE', 'SCRAP'] as const;
const units = UNIT_CODES as [string, ...string[]];

async function storeIn(projectId: string, storeId: string) {
  const s = await prisma.store.findUnique({ where: { id: storeId } });
  if (!s || s.projectId !== projectId) throw bad('Store does not belong to this project');
  return s;
}

/** Issue lines into the ledger with stock checks. Shared by issues and transfers. */
async function postIssue(tx: Tx, user: AuthUser, projectId: string, d: { storeId: string; date: Date; subcontractorId: string; workOrderId: string; activityId?: string | null; requisitionId?: string | null; receivedByName?: string | null; remarks?: string | null; transferFromReturnId?: string | null; skipStockCheck?: boolean; lines: { materialId: string; quantity: string; basis?: string; issueRate?: string | null; recoveryRate?: string | null; recoveryTerms?: string | null; batchNo?: string | null }[] }) {
  const wo = await tx.workOrder.findUnique({ where: { id: d.workOrderId } });
  if (!wo || wo.projectId !== projectId || wo.subcontractorId !== d.subcontractorId) throw bad('Work order does not match project and subcontractor');
  if (wo.status !== 'APPROVED') throw bad(`Work order ${wo.woNo} is ${wo.status}`);
  if (d.requisitionId) {
    const rq = await tx.materialRequisition.findUnique({ where: { id: d.requisitionId } });
    if (!rq || rq.status !== 'APPROVED' || rq.workOrderId !== d.workOrderId) throw bad('Requisition is not approved for this work order');
    const issuedAgainst = await tx.materialIssueLine.findMany({ where: { issue: { requisitionId: rq.id, status: { not: 'CANCELLED' } } } });
    for (const l of d.lines) {
      const req = (rq.lines as { materialId: string; quantity: string }[]).find((x) => x.materialId === l.materialId);
      if (!req) throw bad('Material is not on the requisition');
      const done = issuedAgainst.filter((x) => x.materialId === l.materialId).reduce((s, x) => s.plus(x.quantity.toString()), D(0));
      if (done.plus(l.quantity).gt(req.quantity)) throw bad(`Issue exceeds requisition balance (${D(req.quantity).minus(done)} remaining)`);
    }
  }
  const voucherNo = await nextNo(tx, projectId, 'MIV');
  const lineData = [];
  for (const l of d.lines) {
    const m = await tx.material.findUnique({ where: { id: l.materialId } });
    if (!m) throw bad('Material not found');
    const basis = (l.basis ?? (wo.materialResponsibility === 'COMPANY_FREE_ISSUE' ? 'FREE_ISSUE' : m.defaultBasis)) as (typeof bases)[number];
    if (basis === 'SUBCONTRACTOR_SUPPLIED') throw bad(`${m.name} is subcontractor-supplied and cannot be issued from company stock`);
    if (m.batchTracked && !l.batchNo) throw bad(`${m.name} requires a batch / heat number`);
    const pos = await stockPosition(tx, d.storeId, m.id, m.batchTracked ? l.batchNo : null);
    if (!d.skipStockCheck && pos.quantity.lt(l.quantity)) throw bad(`Insufficient stock of ${m.name}${l.batchNo ? ` (batch ${l.batchNo})` : ''}: ${pos.quantity} ${m.unit} available`);
    const rate = l.issueRate ?? (pos.avgRate.gt(0) ? pos.avgRate : D(m.standardRate.toString())).toString();
    const recoveryRate = l.recoveryRate ?? (basis === 'RECOVERABLE' ? rate : '0');
    lineData.push({ materialId: m.id, quantity: l.quantity, issueRate: rate, issueValue: money(D(l.quantity).times(rate)).toString(), basis, recoveryRate, recoveryTerms: l.recoveryTerms ?? null, batchNo: l.batchNo ?? null });
  }
  const issue = await tx.materialIssue.create({
    data: { projectId, voucherNo, date: d.date, storeId: d.storeId, subcontractorId: d.subcontractorId, workOrderId: d.workOrderId, activityId: d.activityId ?? null, requisitionId: d.requisitionId ?? null, transferFromReturnId: d.transferFromReturnId ?? null, issuedById: user.id, issuedByName: user.name, receivedByName: d.receivedByName ?? null, remarks: d.remarks ?? null, lines: { create: lineData } },
    include: { lines: true },
  });
  await tx.stockTransaction.createMany({ data: issue.lines.map((l) => ({ storeId: d.storeId, materialId: l.materialId, date: d.date, type: 'ISSUE' as const, quantity: D(l.quantity.toString()).negated().toString(), rate: l.issueRate, value: D(l.issueValue.toString()).negated().toString(), batchNo: l.batchNo, refType: 'MaterialIssue', refId: issue.id, refNo: voucherNo })) });
  await audit(tx, user, { entityType: 'MaterialIssue', entityId: issue.id, action: 'ISSUE', after: issue, projectId });
  return issue;
}

async function postReturn(tx: Tx, user: AuthUser, projectId: string, d: { storeId: string; date: Date; subcontractorId: string; workOrderId: string; receivedByName: string; remarks?: string | null; transfer?: boolean; lines: { materialId: string; quantity: string; condition: 'GOOD' | 'EXCESS' | 'DAMAGED' | 'REJECTED' | 'SCRAP'; batchNo?: string | null }[] }) {
  const wo = await tx.workOrder.findUnique({ where: { id: d.workOrderId } });
  if (!wo || wo.projectId !== projectId || wo.subcontractorId !== d.subcontractorId) throw bad('Work order does not match project and subcontractor');
  const voucherNo = await nextNo(tx, projectId, 'MRV');
  const lineData = [];
  for (const l of d.lines) {
    const bal = await contractorBalance(tx, d.subcontractorId, l.materialId, { workOrderId: d.workOrderId });
    if (bal.balance.lt(l.quantity)) throw bad(`Return of ${l.quantity} exceeds material held by the subcontractor on this work order (${bal.balance})`);
    const restock = ['GOOD', 'EXCESS'].includes(l.condition);
    lineData.push({ materialId: l.materialId, quantity: l.quantity, condition: l.condition, rate: bal.avgIssueRate.toString(), restock, batchNo: l.batchNo ?? null });
  }
  const ret = await tx.materialReturn.create({ data: { projectId, voucherNo, date: d.date, storeId: d.storeId, subcontractorId: d.subcontractorId, workOrderId: d.workOrderId, receivedByName: d.receivedByName, createdById: user.id, remarks: d.remarks ?? null, lines: { create: lineData } }, include: { lines: true } });
  const txns = [];
  for (const l of ret.lines) {
    const v = money(D(l.quantity.toString()).times(l.rate.toString()));
    txns.push({ storeId: d.storeId, materialId: l.materialId, date: d.date, type: 'RETURN' as const, quantity: l.quantity, rate: l.rate, value: v.toString(), batchNo: l.batchNo, refType: 'MaterialReturn', refId: ret.id, refNo: voucherNo });
    // Damaged / rejected / scrap material is received for the record but does not become usable stock.
    if (!l.restock) txns.push({ storeId: d.storeId, materialId: l.materialId, date: d.date, type: 'SCRAP_OUT' as const, quantity: D(l.quantity.toString()).negated().toString(), rate: l.rate, value: v.negated().toString(), batchNo: l.batchNo, refType: 'MaterialReturn', refId: ret.id, refNo: `${voucherNo}/${l.condition}` });
  }
  await tx.stockTransaction.createMany({ data: txns });
  await audit(tx, user, { entityType: 'MaterialReturn', entityId: ret.id, action: d.transfer ? 'TRANSFER_OUT' : 'RETURN', after: ret, projectId });
  return ret;
}

const issueLine = z.object({ materialId: zId, quantity: zDecPos, basis: z.enum(bases).optional(), issueRate: zDecOpt, recoveryRate: zDecOpt, recoveryTerms: z.string().nullable().optional(), batchNo: z.string().nullable().optional() });

const routes: FastifyPluginAsyncZod = async (app) => {
  // ── Master data
  app.get('/companies/:id/materials', { schema: { tags: ['materials'], params: idParam } }, async (req) => {
    await requirePermission(req.user, 'project.view', { companyId: req.params.id }).catch(async () => { if (!(await prisma.userRoleAssignment.findFirst({ where: { userId: req.user.id, companyId: req.params.id } })) && !req.user.isSuperAdmin) throw notFound('Company'); });
    return prisma.material.findMany({ where: { companyId: req.params.id }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  });
  const matBody = z.object({ code: z.string().min(1).max(30), name: z.string().min(2), category: z.enum(categories), unit: z.enum(units), altUnit: z.enum(units).nullable().optional(), altFactor: zDecOpt, defaultBasis: z.enum(bases).default('RECOVERABLE'), standardRate: zDec.default('0'), batchTracked: z.boolean().default(false), active: z.boolean().optional() });
  app.post('/companies/:id/materials', { schema: { tags: ['materials'], params: idParam, body: matBody } }, async (req) => {
    await requirePermission(req.user, 'material.master', { companyId: req.params.id });
    if (req.body.altUnit && !req.body.altFactor) throw bad('Conversion factor is required for the secondary unit');
    return prisma.$transaction(async (tx) => {
      const m = await tx.material.create({ data: { ...req.body, code: req.body.code.toUpperCase(), companyId: req.params.id } });
      await audit(tx, req.user, { entityType: 'Material', entityId: m.id, action: 'CREATE', after: m, companyId: req.params.id });
      return m;
    });
  });
  app.patch('/materials/:id', { schema: { tags: ['materials'], params: idParam, body: matBody.partial().omit({ code: true, unit: true }) } }, async (req) => {
    const m = await prisma.material.findUnique({ where: { id: req.params.id } });
    if (!m) throw notFound('Material');
    await requirePermission(req.user, 'material.master', { companyId: m.companyId });
    if (req.body.altFactor && m.altFactor && !D(req.body.altFactor).eq(m.altFactor.toString()) && (await prisma.stockTransaction.count({ where: { materialId: m.id } }))) throw conflict('Unit conversion cannot change after stock movements exist');
    return prisma.$transaction(async (tx) => {
      const u = await tx.material.update({ where: { id: m.id }, data: req.body });
      await audit(tx, req.user, { entityType: 'Material', entityId: m.id, action: 'UPDATE', before: m, after: u, companyId: m.companyId });
      return u;
    });
  });
  app.get('/projects/:projectId/stores', { schema: { tags: ['materials'], params: pp } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    return prisma.store.findMany({ where: { projectId: req.params.projectId }, orderBy: { code: 'asc' } });
  });
  app.post('/projects/:projectId/stores', { schema: { tags: ['materials'], params: pp, body: z.object({ code: z.string().min(1), name: z.string().min(2), location: z.string().optional() }) } }, async (req) => {
    const scope = await projectScope(req.params.projectId);
    await requirePermission(req.user, 'material.master', scope);
    return prisma.store.create({ data: { ...req.body, code: req.body.code.toUpperCase(), projectId: req.params.projectId } });
  });

  // ── Stock
  app.get('/projects/:projectId/stock', { schema: { tags: ['materials'], params: pp, querystring: z.object({ storeId: zId.optional() }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    const rows = await prisma.stockTransaction.groupBy({ by: ['storeId', 'materialId'], where: { store: { projectId: req.params.projectId }, storeId: req.query.storeId }, _sum: { quantity: true, value: true } });
    const mats = await prisma.material.findMany({ where: { id: { in: rows.map((r) => r.materialId) } } });
    const stores = await prisma.store.findMany({ where: { projectId: req.params.projectId } });
    return rows.map((r) => {
      const q = D(r._sum.quantity?.toString() ?? 0), v = D(r._sum.value?.toString() ?? 0);
      const m = mats.find((x) => x.id === r.materialId)!;
      return { storeId: r.storeId, store: stores.find((s) => s.id === r.storeId)?.name, material: m, quantity: q.toString(), value: money(v).toString(), avgRate: q.gt(0) ? v.div(q).toDecimalPlaces(4).toString() : '0', altQuantity: m.altFactor ? q.times(m.altFactor.toString()).toDecimalPlaces(3).toString() : null };
    });
  });
  app.get('/projects/:projectId/stock-ledger', { schema: { tags: ['materials'], params: pp, querystring: z.object({ storeId: zId, materialId: zId }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    const tx = await prisma.stockTransaction.findMany({ where: { storeId: req.query.storeId, materialId: req.query.materialId }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
    let bal = D(0), val = D(0);
    return tx.map((t) => { bal = bal.plus(t.quantity.toString()); val = val.plus(t.value.toString()); return { ...t, balance: bal.toString(), balanceValue: money(val).toString() }; });
  });

  // ── Receipts (GRN)
  app.post('/projects/:projectId/receipts', { schema: { tags: ['materials'], params: pp, body: z.object({ storeId: zId, date: zDate, supplier: z.string().optional(), invoiceRef: z.string().optional(), remarks: z.string().optional(), lines: z.array(z.object({ materialId: zId, quantity: zDecPos, rate: zDecPos, batchNo: z.string().nullable().optional() })).min(1) }) } }, async (req) => {
    const scope = await projectScope(req.params.projectId);
    await requirePermission(req.user, 'material.receive', scope);
    await storeIn(req.params.projectId, req.body.storeId);
    const mats = await prisma.material.findMany({ where: { id: { in: req.body.lines.map((l) => l.materialId) }, companyId: scope.companyId } });
    for (const l of req.body.lines) { const m = mats.find((x) => x.id === l.materialId); if (!m) throw bad('Material not found'); if (m.batchTracked && !l.batchNo) throw bad(`${m.name} requires a batch / heat number`); }
    return prisma.$transaction(async (tx) => {
      const grnNo = await nextNo(tx, req.params.projectId, 'GRN');
      const g = await tx.materialReceipt.create({ data: { projectId: req.params.projectId, storeId: req.body.storeId, grnNo, date: req.body.date, supplier: req.body.supplier, invoiceRef: req.body.invoiceRef, remarks: req.body.remarks, lines: req.body.lines, createdById: req.user.id } });
      await tx.stockTransaction.createMany({ data: req.body.lines.map((l) => ({ storeId: req.body.storeId, materialId: l.materialId, date: req.body.date, type: 'RECEIPT' as const, quantity: l.quantity, rate: l.rate, value: money(D(l.quantity).times(l.rate)).toString(), batchNo: l.batchNo ?? null, refType: 'MaterialReceipt', refId: g.id, refNo: grnNo })) });
      await audit(tx, req.user, { entityType: 'MaterialReceipt', entityId: g.id, action: 'RECEIVE', after: g, ...scope });
      return g;
    });
  });
  app.get('/projects/:projectId/receipts', { schema: { tags: ['materials'], params: pp } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    return prisma.materialReceipt.findMany({ where: { projectId: req.params.projectId }, orderBy: { date: 'desc' }, take: 500 });
  });

  // ── Requisitions
  app.post('/projects/:projectId/requisitions', { schema: { tags: ['materials'], params: pp, body: z.object({ date: zDate, subcontractorId: zId, workOrderId: zId, activityId: zId.optional(), purpose: z.string().optional(), lines: z.array(z.object({ materialId: zId, quantity: zDecPos })).min(1) }) } }, async (req) => {
    const scope = await projectScope(req.params.projectId);
    await requirePermission(req.user, 'material.requisition', scope);
    const wo = await prisma.workOrder.findUnique({ where: { id: req.body.workOrderId } });
    if (!wo || wo.projectId !== req.params.projectId || wo.subcontractorId !== req.body.subcontractorId || wo.status !== 'APPROVED') throw bad('Requisition needs an approved work order of this subcontractor');
    return prisma.$transaction(async (tx) => {
      const r = await tx.materialRequisition.create({ data: { ...req.body, projectId: req.params.projectId, reqNo: await nextNo(tx, req.params.projectId, 'MRQ'), createdById: req.user.id } });
      await logWorkflow(tx, req.user, { entityType: 'MaterialRequisition', entityId: r.id, action: 'submit', toStatus: 'SUBMITTED' });
      await audit(tx, req.user, { entityType: 'MaterialRequisition', entityId: r.id, action: 'CREATE', after: r, ...scope });
      return r;
    });
  });
  app.get('/projects/:projectId/requisitions', { schema: { tags: ['materials'], params: pp } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    return prisma.materialRequisition.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' }, take: 500 });
  });
  app.post('/requisitions/:id/:action', { schema: { tags: ['materials'], params: z.object({ id: zId, action: z.enum(['approve', 'reject']) }), body: z.object({ comment: z.string().optional() }) } }, async (req) => {
    const r = await prisma.materialRequisition.findUnique({ where: { id: req.params.id } });
    if (!r) throw notFound('Requisition');
    const scope = await projectScope(r.projectId);
    await requirePermission(req.user, 'material.approve', scope);
    if (r.status !== 'SUBMITTED') throw conflict('Requisition is not pending');
    if (req.params.action === 'reject' && !req.body.comment) throw bad('A reason is required');
    const to = req.params.action === 'approve' ? 'APPROVED' : 'REJECTED';
    return prisma.$transaction(async (tx) => {
      const u = await tx.materialRequisition.update({ where: { id: r.id }, data: { status: to, approvedById: req.user.id, approvedAt: new Date() } });
      await logWorkflow(tx, req.user, { entityType: 'MaterialRequisition', entityId: r.id, action: req.params.action, fromStatus: r.status, toStatus: to, comment: req.body.comment });
      return u;
    });
  });

  // ── Issues
  app.post('/projects/:projectId/issues', { schema: { tags: ['materials'], params: pp, body: z.object({ storeId: zId, date: zDate, subcontractorId: zId, workOrderId: zId, activityId: zId.nullable().optional(), requisitionId: zId.nullable().optional(), receivedByName: z.string().optional(), remarks: z.string().optional(), lines: z.array(issueLine).min(1) }) } }, async (req) => {
    const scope = await projectScope(req.params.projectId);
    await requirePermission(req.user, 'material.issue', scope);
    await storeIn(req.params.projectId, req.body.storeId);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${req.body.storeId}))`;
      return postIssue(tx, req.user, req.params.projectId, req.body);
    });
  });
  app.get('/projects/:projectId/issues', { schema: { tags: ['materials'], params: pp, querystring: z.object({ subcontractorId: zId.optional() }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    return prisma.materialIssue.findMany({ where: { projectId: req.params.projectId, subcontractorId: req.query.subcontractorId }, include: { lines: true, subcontractor: { select: { name: true, code: true } }, workOrder: { select: { woNo: true } } }, orderBy: [{ date: 'desc' }, { voucherNo: 'desc' }], take: 500 });
  });
  app.post('/issues/:id/acknowledge', { schema: { tags: ['materials'], params: idParam, body: z.object({ receivedByName: z.string().min(2) }) } }, async (req) => {
    const i = await prisma.materialIssue.findUnique({ where: { id: req.params.id } });
    if (!i) throw notFound('Issue voucher');
    const scope = await projectScope(i.projectId);
    await requirePermission(req.user, 'material.issue', scope);
    if (i.status !== 'ISSUED') throw conflict(`Voucher is ${i.status}`);
    return prisma.$transaction(async (tx) => {
      const u = await tx.materialIssue.update({ where: { id: i.id }, data: { status: 'ACKNOWLEDGED', receivedByName: req.body.receivedByName, acknowledgedAt: new Date() } });
      await audit(tx, req.user, { entityType: 'MaterialIssue', entityId: i.id, action: 'ACKNOWLEDGE', after: { receivedByName: req.body.receivedByName }, ...scope });
      return u;
    });
  });
  app.post('/issues/:id/cancel', { schema: { tags: ['materials'], params: idParam, body: z.object({ reason: z.string().min(5) }) } }, async (req) => {
    const i = await prisma.materialIssue.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!i) throw notFound('Issue voucher');
    const scope = await projectScope(i.projectId);
    await requirePermission(req.user, 'material.approve', scope);
    if (i.status !== 'ISSUED') throw conflict('Only unacknowledged vouchers can be cancelled; record a return instead');
    return prisma.$transaction(async (tx) => {
      await tx.materialIssue.update({ where: { id: i.id }, data: { status: 'CANCELLED', remarks: `${i.remarks ?? ''} [Cancelled: ${req.body.reason}]` } });
      await tx.stockTransaction.createMany({ data: i.lines.map((l) => ({ storeId: i.storeId, materialId: l.materialId, date: new Date(), type: 'ADJUSTMENT' as const, quantity: l.quantity, rate: l.issueRate, value: l.issueValue, batchNo: l.batchNo, refType: 'MaterialIssueCancel', refId: i.id, refNo: `${i.voucherNo}/CANCEL` })) });
      await audit(tx, req.user, { entityType: 'MaterialIssue', entityId: i.id, action: 'CANCEL', reason: req.body.reason, ...scope });
      return { ok: true };
    });
  });

  // ── Returns & transfers
  const retLine = z.object({ materialId: zId, quantity: zDecPos, condition: z.enum(['GOOD', 'EXCESS', 'DAMAGED', 'REJECTED', 'SCRAP']), batchNo: z.string().nullable().optional() });
  app.post('/projects/:projectId/returns', { schema: { tags: ['materials'], params: pp, body: z.object({ storeId: zId, date: zDate, subcontractorId: zId, workOrderId: zId, receivedByName: z.string().min(2), remarks: z.string().optional(), lines: z.array(retLine).min(1) }) } }, async (req) => {
    const scope = await projectScope(req.params.projectId);
    await requirePermission(req.user, 'material.issue', scope);
    await storeIn(req.params.projectId, req.body.storeId);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${req.body.subcontractorId}))`;
      return postReturn(tx, req.user, req.params.projectId, req.body);
    });
  });
  app.get('/projects/:projectId/returns', { schema: { tags: ['materials'], params: pp } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    return prisma.materialReturn.findMany({ where: { projectId: req.params.projectId }, include: { lines: true, subcontractor: { select: { name: true, code: true } } }, orderBy: [{ date: 'desc' }, { voucherNo: 'desc' }], take: 500 });
  });
  /** Transfer between subcontractors or between work orders: an MRV out of the source and an MIV into the destination, linked. */
  app.post('/projects/:projectId/transfers', { schema: { tags: ['materials'], params: pp, body: z.object({ storeId: zId, date: zDate, fromSubcontractorId: zId, fromWorkOrderId: zId, toSubcontractorId: zId, toWorkOrderId: zId, receivedByName: z.string().min(2), remarks: z.string().optional(), lines: z.array(z.object({ materialId: zId, quantity: zDecPos, batchNo: z.string().nullable().optional() })).min(1) }) } }, async (req) => {
    const scope = await projectScope(req.params.projectId);
    await requirePermission(req.user, 'material.issue', scope);
    await storeIn(req.params.projectId, req.body.storeId);
    const b = req.body;
    if (b.fromWorkOrderId === b.toWorkOrderId) throw bad('Source and destination work orders are the same');
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${b.fromSubcontractorId}))`;
      const ret = await postReturn(tx, req.user, req.params.projectId, { storeId: b.storeId, date: b.date, subcontractorId: b.fromSubcontractorId, workOrderId: b.fromWorkOrderId, receivedByName: b.receivedByName, remarks: `Transfer: ${b.remarks ?? ''}`, transfer: true, lines: b.lines.map((l) => ({ ...l, condition: 'GOOD' as const })) });
      const iss = await postIssue(tx, req.user, req.params.projectId, { storeId: b.storeId, date: b.date, subcontractorId: b.toSubcontractorId, workOrderId: b.toWorkOrderId, receivedByName: b.receivedByName, remarks: `Transfer from ${ret.voucherNo}`, transferFromReturnId: ret.id, lines: ret.lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity.toString(), issueRate: l.rate.toString(), batchNo: l.batchNo })) });
      await tx.materialReturn.update({ where: { id: ret.id }, data: { transferToIssueId: iss.id } });
      return { return: ret, issue: iss };
    });
  });

  /** Subcontractor material ledger: chronological issues (+) and returns (−) with running balance. */
  app.get('/projects/:projectId/contractor-ledger', { schema: { tags: ['materials'], params: pp, querystring: z.object({ subcontractorId: zId, workOrderId: zId.optional(), materialId: zId.optional() }) } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    const q = req.query;
    const [iss, rets] = await Promise.all([
      prisma.materialIssueLine.findMany({ where: { materialId: q.materialId, issue: { projectId: req.params.projectId, subcontractorId: q.subcontractorId, workOrderId: q.workOrderId, status: { not: 'CANCELLED' } } }, include: { issue: { select: { voucherNo: true, date: true, workOrder: { select: { woNo: true } }, status: true } } } }),
      prisma.materialReturnLine.findMany({ where: { materialId: q.materialId, ret: { projectId: req.params.projectId, subcontractorId: q.subcontractorId, workOrderId: q.workOrderId } }, include: { ret: { select: { voucherNo: true, date: true, workOrderId: true, transferToIssueId: true } } } }),
    ]);
    const mats = await prisma.material.findMany({ where: { id: { in: [...new Set([...iss, ...rets].map((x) => x.materialId))] } } });
    const entries = [
      ...iss.map((l) => ({ date: l.issue.date, voucherNo: l.issue.voucherNo, type: 'ISSUE', workOrder: l.issue.workOrder.woNo, materialId: l.materialId, qtyIn: l.quantity.toString(), qtyOut: '0', rate: l.issueRate.toString(), value: l.issueValue.toString(), basis: l.basis, recoveryRate: l.recoveryRate.toString(), recoverableValue: money(D(l.quantity.toString()).times(l.recoveryRate.toString())).toString(), status: l.issue.status, condition: null as string | null })),
      ...rets.map((l) => ({ date: l.ret.date, voucherNo: l.ret.voucherNo, type: l.ret.transferToIssueId ? 'TRANSFER_OUT' : 'RETURN', workOrder: null as string | null, materialId: l.materialId, qtyIn: '0', qtyOut: l.quantity.toString(), rate: l.rate.toString(), value: money(D(l.quantity.toString()).times(l.rate.toString())).negated().toString(), basis: null, recoveryRate: '0', recoverableValue: '0', status: 'POSTED', condition: l.condition as string | null })),
    ].sort((a, b) => +a.date - +b.date || a.voucherNo.localeCompare(b.voucherNo));
    const bal = new Map<string, ReturnType<typeof D>>();
    return entries.map((e) => {
      const b = (bal.get(e.materialId) ?? D(0)).plus(e.qtyIn).minus(e.qtyOut);
      bal.set(e.materialId, b);
      const m = mats.find((x) => x.id === e.materialId)!;
      return { ...e, material: { code: m.code, name: m.name, unit: m.unit }, balance: b.toString() };
    });
  });

  // ── Consumption norms
  app.get('/projects/:projectId/norms', { schema: { tags: ['reconciliation'], params: pp } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    return prisma.consumptionNorm.findMany({ where: { projectId: req.params.projectId }, include: { material: true, activity: { select: { code: true, name: true, unit: true } } } });
  });
  app.post('/projects/:projectId/norms', { schema: { tags: ['reconciliation'], params: pp, body: z.object({ activityId: zId, materialId: zId, normQty: zDecPos, normUnit: z.enum(units), wastagePercent: zDec.default('0'), basis: z.string().min(3) }) } }, async (req) => {
    const scope = await projectScope(req.params.projectId);
    await requirePermission(req.user, 'material.norms', scope);
    const a = await prisma.executionActivity.findUnique({ where: { id: req.body.activityId }, include: { contract: true } });
    if (!a || a.contract.projectId !== req.params.projectId) throw bad('Activity not in project');
    const m = await prisma.material.findUnique({ where: { id: req.body.materialId } });
    if (!m) throw bad('Material not found');
    (await import('../services/materials')).normToBase(m, req.body.normUnit, req.body.normQty); // validates unit is convertible
    return prisma.$transaction(async (tx) => {
      const existing = await tx.consumptionNorm.findUnique({ where: { activityId_materialId: { activityId: a.id, materialId: m.id } } });
      const n = existing
        ? await tx.consumptionNorm.update({ where: { id: existing.id }, data: { ...req.body, status: 'DRAFT', approvedById: null, approvedAt: null } })
        : await tx.consumptionNorm.create({ data: { ...req.body, projectId: req.params.projectId } });
      await audit(tx, req.user, { entityType: 'ConsumptionNorm', entityId: n.id, action: existing ? 'UPDATE' : 'CREATE', before: existing, after: n, ...scope });
      return n;
    });
  });
  app.post('/norms/:id/approve', { schema: { tags: ['reconciliation'], params: idParam } }, async (req) => {
    const n = await prisma.consumptionNorm.findUnique({ where: { id: req.params.id } });
    if (!n) throw notFound('Norm');
    const scope = await projectScope(n.projectId);
    await requirePermission(req.user, 'reconciliation.approve', scope);
    return prisma.$transaction(async (tx) => {
      const u = await tx.consumptionNorm.update({ where: { id: n.id }, data: { status: 'APPROVED', approvedById: req.user.id, approvedAt: new Date() } });
      await audit(tx, req.user, { entityType: 'ConsumptionNorm', entityId: n.id, action: 'APPROVE', after: u, ...scope });
      return u;
    });
  });

  // ── Reconciliation
  const reconBody = z.object({ subcontractorId: zId, workOrderId: zId.nullable().optional(), periodFrom: zDate, periodTo: zDate, isFinal: z.boolean().default(false), closingStock: z.record(z.string().nullable()).optional(), penalRates: z.record(z.string()).optional() });
  app.post('/projects/:projectId/reconciliations/compute', { schema: { tags: ['reconciliation'], params: pp, body: reconBody } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    if (req.body.periodTo < req.body.periodFrom) throw bad('Period end is before period start');
    return buildReconciliation(prisma, req.params.projectId, req.body);
  });
  app.post('/projects/:projectId/reconciliations', { schema: { tags: ['reconciliation'], params: pp, body: reconBody } }, async (req) => {
    const scope = await projectScope(req.params.projectId);
    await requirePermission(req.user, 'reconciliation.prepare', scope);
    if (req.body.periodTo < req.body.periodFrom) throw bad('Period end is before period start');
    return prisma.$transaction(async (tx) => {
      const overlap = await tx.materialReconciliation.findFirst({ where: { projectId: req.params.projectId, subcontractorId: req.body.subcontractorId, workOrderId: req.body.workOrderId ?? null, status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] }, periodFrom: { lte: req.body.periodTo }, periodTo: { gte: req.body.periodFrom } } });
      if (overlap) throw conflict(`Period overlaps reconciliation ${overlap.reconNo}`);
      const s = await buildReconciliation(tx, req.params.projectId, req.body);
      const r = await tx.materialReconciliation.create({ data: { projectId: req.params.projectId, reconNo: await nextNo(tx, req.params.projectId, 'MRC'), subcontractorId: req.body.subcontractorId, workOrderId: req.body.workOrderId ?? null, periodFrom: req.body.periodFrom, periodTo: req.body.periodTo, isFinal: req.body.isFinal, lines: s.lines as never, totalRecoverable: s.totalRecoverable, createdById: req.user.id } });
      await logWorkflow(tx, req.user, { entityType: 'MaterialReconciliation', entityId: r.id, action: 'prepare', toStatus: 'DRAFT' });
      await audit(tx, req.user, { entityType: 'MaterialReconciliation', entityId: r.id, action: 'CREATE', after: { reconNo: r.reconNo, total: s.totalRecoverable }, ...scope });
      return r;
    });
  });
  app.get('/projects/:projectId/reconciliations', { schema: { tags: ['reconciliation'], params: pp } }, async (req) => {
    await requirePermission(req.user, 'project.view', await projectScope(req.params.projectId));
    return prisma.materialReconciliation.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' } });
  });
  app.get('/reconciliations/:id', { schema: { tags: ['reconciliation'], params: idParam } }, async (req) => {
    const r = await prisma.materialReconciliation.findUnique({ where: { id: req.params.id } });
    if (!r) throw notFound('Reconciliation');
    await requirePermission(req.user, 'project.view', await projectScope(r.projectId));
    const sub = await prisma.subcontractor.findUnique({ where: { id: r.subcontractorId }, select: { name: true, code: true } });
    const history = await prisma.workflowAction.findMany({ where: { entityType: 'MaterialReconciliation', entityId: r.id }, orderBy: { at: 'asc' } });
    return { ...r, subcontractor: sub, history };
  });
  app.post('/reconciliations/:id/:action', { schema: { tags: ['reconciliation'], params: z.object({ id: zId, action: z.enum(['submit', 'approve', 'reject']) }), body: z.object({ comment: z.string().optional() }) } }, async (req) => {
    const r = await prisma.materialReconciliation.findUnique({ where: { id: req.params.id } });
    if (!r) throw notFound('Reconciliation');
    const scope = await projectScope(r.projectId);
    const a = req.params.action;
    await requirePermission(req.user, a === 'submit' ? 'reconciliation.prepare' : 'reconciliation.approve', scope, a === 'approve' ? r.totalRecoverable.toString() : undefined);
    const from = a === 'submit' ? 'DRAFT' : 'SUBMITTED';
    if (r.status !== from) throw conflict(`Reconciliation is ${r.status}`);
    if (a === 'reject' && !req.body.comment) throw bad('A reason is required');
    if (a === 'approve' && r.createdById === req.user.id && !req.user.isSuperAdmin) throw conflict('The preparer cannot approve the reconciliation');
    const to = a === 'submit' ? 'SUBMITTED' : a === 'approve' ? 'APPROVED' : 'REJECTED';
    return prisma.$transaction(async (tx) => {
      const u = await tx.materialReconciliation.update({ where: { id: r.id }, data: { status: to, ...(a === 'approve' ? { approvedById: req.user.id, approvedAt: new Date() } : {}) } });
      await logWorkflow(tx, req.user, { entityType: 'MaterialReconciliation', entityId: r.id, action: a, fromStatus: r.status, toStatus: to, comment: req.body.comment });
      await audit(tx, req.user, { entityType: 'MaterialReconciliation', entityId: r.id, action: a.toUpperCase(), reason: req.body.comment, after: { status: to }, ...scope });
      return u;
    });
  });
};
export default routes;
