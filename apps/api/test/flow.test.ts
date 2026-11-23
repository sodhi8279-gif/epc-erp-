import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupApp, userWithRole, type client } from './helpers';
import { prisma } from '../src/lib/db';

type C = ReturnType<typeof client>;
let app: Awaited<ReturnType<typeof setupApp>>['app'];
let api: C;
const S: Record<string, any> = {};
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => { ({ app, api } = await setupApp()); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe('end-to-end: contract → BOQ → breakup → subcontract → allocation → MB → materials', () => {
  it('sets up company, roles, project and contract', async () => {
    S.company = await api.post('/companies', { code: 'RGI', name: 'Test EPC Co' });
    const roles = await api.get(`/companies/${S.company.id}/roles`);
    expect(roles.length).toBe(14);
    S.project = await api.post('/projects', { companyId: S.company.id, code: 'PL-01', name: 'Pipeline Project', type: 'PIPELINE', state: 'Himachal Pradesh' });
    S.contract = await api.post(`/projects/${S.project.id}/contracts`, { contractNo: 'CW-01', title: 'Water transmission main', client: 'Jal Shakti Vibhag', contractValue: '0' });
    S.store = (await api.get(`/projects/${S.project.id}/stores`))[0];
    expect(S.store.code).toBe('MAIN');
  });

  it('creates, approves and locks the original BOQ', async () => {
    const rev = await api.post(`/contracts/${S.contract.id}/revisions`, { type: 'ORIGINAL', title: 'Original BOQ' });
    S.pipe = await api.post(`/revisions/${rev.id}/items`, { itemNo: '2', description: 'Providing, laying, jointing, testing and commissioning 600 mm MS pipeline', unit: 'RM', quantity: '1000', rate: '10000' });
    S.rcc = await api.post(`/revisions/${rev.id}/items`, { itemNo: '5', description: 'RCC M30', unit: 'CUM', quantity: '1200', rate: '9000' });
    const dup = await api.call('POST', `/revisions/${rev.id}/items`, { itemNo: '5', description: 'dup', unit: 'CUM', quantity: '1', rate: '1' });
    expect(dup.status).toBe(409);
    await api.post(`/revisions/${rev.id}/submit`, {});
    const approved = await api.post(`/revisions/${rev.id}/approve`, { effectiveDate: '2020-01-01' });
    expect(approved.status).toBe('APPROVED');
    const c = await api.get(`/contracts/${S.contract.id}`);
    expect(c.contractValue).toBe('20800000');
    // Service layer refuses edits…
    expect((await api.call('PATCH', `/boq-items/${S.pipe.id}`, { quantity: '5' })).status).toBe(409);
    // …and so does the database itself.
    await expect(prisma.boqItem.update({ where: { id: S.pipe.id }, data: { quantity: 5 } })).rejects.toThrow(/cannot be modified/);
    S.rev0 = rev;
  });

  it('enforces activity breakup rules and approves the 80/12/5/3 split', async () => {
    const base = (pct: string[]) => ({ activities: [
      { code: 'SUP', name: 'Pipe supply', method: 'PERCENT', percentage: pct[0], unit: 'RM', conversionFactor: '1' },
      { code: 'LAY', name: 'Pipe laying', method: 'PERCENT', percentage: pct[1], unit: 'RM', conversionFactor: '1' },
      { code: 'WLD', name: 'Jointing / welding', method: 'PERCENT', percentage: pct[2], unit: 'JOINT', conversionFactor: '0.166667', conversionBasis: '6 m pipe lengths: one joint per 6 RM' },
      { code: 'TST', name: 'Hydro testing', method: 'PERCENT', percentage: pct[3], unit: 'RM', conversionFactor: '1' },
    ] });
    const bad = await api.call('PUT', `/contracts/${S.contract.id}/items/${S.pipe.itemKey}/breakup`, base(['80', '12', '5', '2']));
    expect(bad.status).toBe(400);
    const noBasis = base(['80', '12', '5', '3']);
    delete (noBasis.activities[2] as any).conversionBasis;
    expect((await api.call('PUT', `/contracts/${S.contract.id}/items/${S.pipe.itemKey}/breakup`, noBasis)).status).toBe(400);
    await api.put(`/contracts/${S.contract.id}/items/${S.pipe.itemKey}/breakup`, base(['80', '12', '5', '3']));
    await api.post(`/contracts/${S.contract.id}/items/${S.pipe.itemKey}/breakup/approve`, {});
    await api.put(`/contracts/${S.contract.id}/items/${S.rcc.itemKey}/breakup`, { activities: [{ code: 'RCC', name: 'RCC M30 labour', method: 'PERCENT', percentage: '100', unit: 'CUM', conversionFactor: '1' }] });
    await api.post(`/contracts/${S.contract.id}/items/${S.rcc.itemKey}/breakup/approve`, {});
    const acts = await api.get(`/contracts/${S.contract.id}/activities`);
    S.lay = acts.find((a: any) => a.code === 'LAY');
    S.rccAct = acts.find((a: any) => a.code === 'RCC');
    expect(S.lay.scopeQuantity).toBe('1000');
  });

  it('validates and onboards subcontractors', async () => {
    const badGst = await api.call('POST', `/companies/${S.company.id}/subcontractors`, { code: 'X', name: 'Bad', gstin: '02ABCDE1234F1Z5', pan: 'ZZZZZ9999Z' });
    expect(badGst.status).toBe(400);
    S.subA = await api.post(`/companies/${S.company.id}/subcontractors`, { code: 'SC-A', name: 'Contractor A', gstin: '02AHKPB0866A2Z3', pan: 'AHKPB0866A', bankAccount: '11728019844', ifsc: 'SBIN0001480', workCategories: ['PIPELINE'] });
    S.subB = await api.post(`/companies/${S.company.id}/subcontractors`, { code: 'SC-B', name: 'Contractor B', gstRegistered: false, pan: 'ABCDE1234F', bankAccount: '123456789012', ifsc: 'HDFC0000123' });
    await api.post(`/subcontractors/${S.subA.id}/status`, { status: 'ACTIVE' });
    await api.post(`/subcontractors/${S.subB.id}/status`, { status: 'ACTIVE' });
  });

  it('applies segregation of duties and financial limits on work orders', async () => {
    const ce = await userWithRole(app, api, S.company.id, 'CONTRACT_MANAGER');
    const smallApprover = await userWithRole(app, api, S.company.id, 'HEAD_COMMERCIAL', { financialLimit: '500000' });
    const be = await userWithRole(app, api, S.company.id, 'BILLING_ENGINEER', { projectId: S.project.id });
    S.ce = ce; S.be = be;
    S.woA = await ce.post(`/projects/${S.project.id}/work-orders`, { subcontractorId: S.subA.id, title: 'Pipe laying & RCC', startDate: '2020-01-01', items: [{ activityId: S.lay.id, quantity: '1500', rate: '750' }, { activityId: S.rccAct.id, quantity: '200', rate: '4500' }] });
    expect(S.woA.value).toBe('2025000');
    await ce.post(`/work-orders/${S.woA.id}/submit`, {});
    expect((await be.call('POST', `/work-orders/${S.woA.id}/approve`, {})).status).toBe(403);
    const lim = await smallApprover.call('POST', `/work-orders/${S.woA.id}/approve`, {});
    expect(lim.status).toBe(403);
    expect(lim.body.error).toBe('FINANCIAL_LIMIT');
    await api.post(`/work-orders/${S.woA.id}/approve`, {});
    S.woB = await ce.post(`/projects/${S.project.id}/work-orders`, { subcontractorId: S.subB.id, title: 'Pipe laying stretch 2', startDate: '2020-01-01', items: [{ activityId: S.lay.id, quantity: '600', rate: '800' }] });
    await ce.post(`/work-orders/${S.woB.id}/submit`, {});
    await api.post(`/work-orders/${S.woB.id}/approve`, {});
    const wa = await api.get(`/work-orders/${S.woA.id}`);
    S.woiLay = wa.items.find((i: any) => i.activityId === S.lay.id);
    S.woiRcc = wa.items.find((i: any) => i.activityId === S.rccAct.id);
    S.woiLayB = (await api.get(`/work-orders/${S.woB.id}`)).items[0];
  });

  it('shows internal budget vs subcontract rate (₹1,200 vs ₹750 margin)', async () => {
    const b = await api.get(`/contracts/${S.contract.id}/items/${S.pipe.itemKey}/breakup`);
    const lay = b.activities.find((a: any) => a.code === 'LAY');
    expect(lay.calc.budgetRatePerActivityUnit).toBe('1200');
    expect(lay.contracts[0].marginPerUnit).toBe('450');
  });

  it('detects over-allocation and chainage overlap, and requires authorised exceptions', async () => {
    const a1 = await api.post(`/projects/${S.project.id}/allocations`, { activityId: S.lay.id, workOrderItemId: S.woiLay.id, quantity: '600', chainageFrom: '0', chainageTo: '600' });
    expect(a1.status).toBe('ACTIVE');
    S.allocA = a1;
    const overlap = await api.call('POST', `/projects/${S.project.id}/allocations`, { activityId: S.lay.id, workOrderItemId: S.woiLayB.id, quantity: '300', chainageFrom: '500', chainageTo: '800' });
    expect(overlap.status).toBe(409);
    expect(overlap.body.details.map((d: any) => d.code)).toContain('CHAINAGE_OVERLAP');
    const wrong = await api.call('POST', `/projects/${S.project.id}/allocations`, { activityId: S.lay.id, workOrderItemId: S.woiRcc.id, quantity: '10' });
    expect(wrong.status).toBe(400);
    const b1 = await api.post(`/projects/${S.project.id}/allocations`, { activityId: S.lay.id, workOrderItemId: S.woiLayB.id, quantity: '400', chainageFrom: '600', chainageTo: '1000' });
    S.allocB = b1;
    // Scope is 1000 RM and fully allocated now
    const over = await api.call('POST', `/projects/${S.project.id}/allocations`, { activityId: S.lay.id, workOrderItemId: S.woiLay.id, quantity: '100', zone: 'Village spur' });
    expect(over.body.details.map((d: any) => d.code)).toContain('SCOPE_EXCEEDED');
    const pending = await api.post(`/projects/${S.project.id}/allocations`, { activityId: S.lay.id, workOrderItemId: S.woiLay.id, quantity: '100', zone: 'Village spur', exceptionReason: 'Client instruction for spur line; BOQ deviation under process' });
    expect(pending.status).toBe('PENDING_EXCEPTION');
    expect((await api.call('POST', `/allocations/${pending.id}/approve-exception`, {})).status).toBe(200); // super admin
    S.allocRcc = await api.post(`/projects/${S.project.id}/allocations`, { activityId: S.rccAct.id, workOrderItemId: S.woiRcc.id, quantity: '200', zone: 'Pump house' });
  });

  it('runs the measurement workflow and blocks double measurement', async () => {
    const m = await S.be.post(`/projects/${S.project.id}/measurements`, { workOrderItemId: S.woiLay.id, allocationId: S.allocA.id, date: today, type: 'PIPELINE', attributes: { diameter: 600, material: 'MS' }, lines: [{ description: 'Ch 0–250', chainageFrom: '0', chainageTo: '250' }] });
    expect(m.quantity).toBe('250');
    expect(m.status).toBe('DRAFT');
    const dupl = await S.be.call('POST', `/projects/${S.project.id}/measurements`, { workOrderItemId: S.woiLay.id, allocationId: S.allocA.id, date: today, type: 'PIPELINE', lines: [{ chainageFrom: '200', chainageTo: '300' }] });
    expect(dupl.status).toBe(400);
    expect(JSON.stringify(dupl.body.details)).toMatch(/overlaps/);
    const tooMuch = await S.be.call('POST', `/projects/${S.project.id}/measurements`, { workOrderItemId: S.woiLay.id, allocationId: S.allocA.id, date: today, type: 'PIPELINE', lines: [{ chainageFrom: '250', chainageTo: '700' }] });
    expect(JSON.stringify(tooMuch.body.details)).toMatch(/exceeds allocated/);
    await S.be.post(`/measurements/${m.id}/transition`, { action: 'submit' });
    // Return needs a comment
    expect((await api.call('POST', `/measurements/${m.id}/transition`, { action: 'return' })).status).toBe(400);
    await api.post(`/measurements/${m.id}/transition`, { action: 'return', comment: 'Attach joint register' });
    await S.be.put(`/measurements/${m.id}`, { workOrderItemId: S.woiLay.id, allocationId: S.allocA.id, date: today, type: 'PIPELINE', lines: [{ description: 'Ch 0–240', chainageFrom: '0', chainageTo: '240' }] });
    await S.be.post(`/measurements/${m.id}/transition`, { action: 'submit' });
    for (const a of ['verify', 'scrutinize', 'approve', 'certify']) await api.post(`/measurements/${m.id}/transition`, { action: a });
    const done = await api.get(`/measurements/${m.id}`);
    expect(done.status).toBe('CERTIFIED');
    expect(done.revision).toBe(2);
    expect(done.rate).toBe('750');
    expect(done.snapshots.length).toBe(2);
    await expect(prisma.measurement.update({ where: { id: m.id }, data: { quantity: 999 } })).rejects.toThrow(/cannot be edited/);
    // Reversal frees the chainage for a corrected measurement
    await api.post(`/measurements/${m.id}/reverse`, { reason: 'Wrong chainage reference' });
    const fixed = await S.be.post(`/projects/${S.project.id}/measurements`, { workOrderItemId: S.woiLay.id, allocationId: S.allocA.id, date: today, type: 'PIPELINE', lines: [{ chainageFrom: '0', chainageTo: '250' }] });
    expect(fixed.quantity).toBe('250');
    S.mPipe = fixed;
  });

  it('computes RCC volumes and keeps the quantity chain separate in the allocation matrix', async () => {
    const m = await S.be.post(`/projects/${S.project.id}/measurements`, { workOrderItemId: S.woiRcc.id, allocationId: S.allocRcc.id, date: today, type: 'RCC', zone: 'Pump house', structure: 'Raft', attributes: { grade: 'M30' }, lines: [{ description: 'Raft', nos: '1', length: '10', breadth: '10', depth: '1' }] });
    expect(m.quantity).toBe('100');
    await S.be.post(`/measurements/${m.id}/transition`, { action: 'submit' });
    for (const a of ['verify', 'scrutinize', 'approve']) await api.post(`/measurements/${m.id}/transition`, { action: a });
    S.mRcc = m;
    await api.post(`/projects/${S.project.id}/progress`, { allocationId: S.allocA.id, date: today, quantity: '300' });
    const mx = await api.get(`/projects/${S.project.id}/allocation-matrix`);
    const lay = mx.find((r: any) => r.activityCode === 'LAY');
    expect(lay.revisedQty).toBe('1000');
    expect(lay.allocated).toBe('1100');
    expect(lay.executed).toBe('300');
    expect(lay.measured).toBe('0'); // certified 240 and its reversal net to 0; the corrected 250 is still a draft
    expect(lay.certified).toBe('0');
    const rcc = mx.find((r: any) => r.activityCode === 'RCC');
    expect(rcc.approved).toBe('100');
  });

  it('issues cement, records returns and reconciles against the 380 kg/Cum norm', async () => {
    const cement = await api.post(`/companies/${S.company.id}/materials`, { code: 'CEM-OPC53', name: 'OPC 53 cement', category: 'CEMENT', unit: 'BAG', altUnit: 'KG', altFactor: '50', defaultBasis: 'RECOVERABLE', standardRate: '400' });
    await api.post(`/projects/${S.project.id}/receipts`, { storeId: S.store.id, date: today, supplier: 'Cement supplier', lines: [{ materialId: cement.id, quantity: '1000', rate: '405' }] });
    const tooMuch = await api.call('POST', `/projects/${S.project.id}/issues`, { storeId: S.store.id, date: today, subcontractorId: S.subA.id, workOrderId: S.woA.id, lines: [{ materialId: cement.id, quantity: '1200' }] });
    expect(tooMuch.status).toBe(400);
    const iss = await api.post(`/projects/${S.project.id}/issues`, { storeId: S.store.id, date: today, subcontractorId: S.subA.id, workOrderId: S.woA.id, activityId: S.rccAct.id, lines: [{ materialId: cement.id, quantity: '850' }] });
    expect(iss.lines[0].issueRate).toBe('405');
    expect(iss.lines[0].issueValue).toBe('344250');
    await api.post(`/issues/${iss.id}/acknowledge`, { receivedByName: 'Site supervisor, Contractor A' });
    const overReturn = await api.call('POST', `/projects/${S.project.id}/returns`, { storeId: S.store.id, date: today, subcontractorId: S.subA.id, workOrderId: S.woA.id, receivedByName: 'Store', lines: [{ materialId: cement.id, quantity: '900', condition: 'GOOD' }] });
    expect(overReturn.status).toBe(400);
    await api.post(`/projects/${S.project.id}/returns`, { storeId: S.store.id, date: today, subcontractorId: S.subA.id, workOrderId: S.woA.id, receivedByName: 'Store', lines: [{ materialId: cement.id, quantity: '20', condition: 'GOOD' }] });
    const stock = await api.get(`/projects/${S.project.id}/stock`);
    expect(stock[0].quantity).toBe('170');
    const ledger = await api.get(`/projects/${S.project.id}/contractor-ledger?subcontractorId=${S.subA.id}`);
    expect(ledger[ledger.length - 1].balance).toBe('830');
    const norm = await api.post(`/projects/${S.project.id}/norms`, { activityId: S.rccAct.id, materialId: cement.id, normQty: '380', normUnit: 'KG', wastagePercent: '0', basis: 'Approved mix design M30, 380 kg/Cum' });
    await api.post(`/norms/${norm.id}/approve`);
    const r = await api.post(`/projects/${S.project.id}/reconciliations/compute`, { subcontractorId: S.subA.id, periodFrom: '2020-01-01', periodTo: today });
    const l = r.lines.find((x: any) => x.materialId === cement.id);
    expect(l.inAltUnit.netIssued).toBe('41500');
    expect(l.inAltUnit.theoretical).toBe('38000');
    expect(l.inAltUnit.difference).toBe('3500');
    expect(l.excess).toBe('70');
    expect(l.excessRecovery).toBe('28350'); // 70 bags × ₹405
    const saved = await S.be.post(`/projects/${S.project.id}/reconciliations`, { subcontractorId: S.subA.id, periodFrom: '2020-01-01', periodTo: today });
    await S.be.post(`/reconciliations/${saved.id}/submit`);
    expect((await S.be.call('POST', `/reconciliations/${saved.id}/approve`, {})).status).toBe(403);
    await api.post(`/reconciliations/${saved.id}/approve`);
    // Ledgers are append-only
    await expect(prisma.stockTransaction.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it('applies prospective rate amendments', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const retro = await S.ce.call('POST', `/work-orders/${S.woA.id}/amendments`, { reason: 'Rate revision', effectiveFrom: '2021-01-01', changes: [{ workOrderItemId: S.woiLay.id, newRate: '800' }] });
    expect(retro.status).toBe(400);
    const am = await S.ce.post(`/work-orders/${S.woA.id}/amendments`, { reason: 'Rate revision for rocky strata', effectiveFrom: tomorrow, changes: [{ workOrderItemId: S.woiLay.id, newRate: '800' }] });
    await api.post(`/amendments/${am.id}/approve`, {});
    const wo = await api.get(`/work-orders/${S.woA.id}`);
    const it = wo.items.find((i: any) => i.id === S.woiLay.id);
    expect(it.rate).toBe('800');
    expect(it.rates.length).toBe(2);
    // A measurement dated today still takes the old rate
    const { rateOn } = await import('../src/services/workorders');
    expect((await rateOn(S.woiLay.id, new Date())).toString()).toBe('750');
  });

  it('keeps a complete audit trail', async () => {
    const log = await api.get(`/audit?companyId=${S.company.id}&take=500`);
    const actions = new Set(log.map((l: any) => `${l.entityType}:${l.action}`));
    for (const a of ['BoqRevision:APPROVE', 'WorkOrder:APPROVE', 'Measurement:CERTIFY', 'Measurement:REVERSE', 'MaterialIssue:ISSUE', 'WorkAllocation:APPROVE-EXCEPTION']) expect(actions).toContain(a);
  });
});
