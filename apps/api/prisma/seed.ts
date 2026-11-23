/**
 * Seed.
 *   pnpm seed                → company + super administrator only (use for a real deployment)
 *   pnpm seed --demo         → adds a clearly labelled DEMO project with users for each role, a BOQ,
 *                              activity breakups, subcontractors and work orders, for training and testing.
 * Credentials come from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (defaults are for local development only).
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLES, D, money } from '@epc/shared';
import { randomUUID } from 'node:crypto';

const db = new PrismaClient();
const demo = process.argv.includes('--demo');
const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@epc.local').toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';

async function main() {
  const company = await db.company.upsert({ where: { code: process.env.SEED_COMPANY_CODE ?? 'HQ' }, update: {}, create: { code: process.env.SEED_COMPANY_CODE ?? 'HQ', name: process.env.SEED_COMPANY_NAME ?? 'Your EPC Company' } });
  for (const [code, r] of Object.entries(DEFAULT_ROLES)) {
    const role = await db.role.upsert({ where: { companyId_code: { companyId: company.id, code } }, update: {}, create: { companyId: company.id, code, name: r.name, department: r.department } });
    await db.rolePermission.createMany({ data: r.permissions.map((permission) => ({ roleId: role.id, permission })), skipDuplicates: true });
  }
  const admin = await db.user.upsert({ where: { email: adminEmail }, update: {}, create: { email: adminEmail, name: 'Super Administrator', passwordHash: await bcrypt.hash(adminPassword, 10), isSuperAdmin: true } });
  const saRole = await db.role.findUniqueOrThrow({ where: { companyId_code: { companyId: company.id, code: 'SUPER_ADMIN' } } });
  await db.userRoleAssignment.upsert({ where: { userId_roleId_projectId: { userId: admin.id, roleId: saRole.id, projectId: null as unknown as string } }, update: {}, create: { userId: admin.id, roleId: saRole.id, companyId: company.id } }).catch(async () => {
    if (!(await db.userRoleAssignment.findFirst({ where: { userId: admin.id, roleId: saRole.id } }))) await db.userRoleAssignment.create({ data: { userId: admin.id, roleId: saRole.id, companyId: company.id } });
  });
  console.log(`Company ${company.name}; super administrator ${adminEmail}`);
  if (!demo) return;

  if (await db.project.findFirst({ where: { companyId: company.id, code: 'DEMO-PL' } })) { console.log('Demo project already exists'); return; }
  const project = await db.project.create({ data: { companyId: company.id, code: 'DEMO-PL', name: 'DEMO · Water transmission main (training data)', type: 'PIPELINE', client: 'Demo Client Department', state: 'Himachal Pradesh', location: 'Demo district', startDate: new Date('2025-04-01') } });
  await db.store.create({ data: { projectId: project.id, code: 'MAIN', name: 'Main Site Store' } });
  const pw = await bcrypt.hash('Demo@12345', 10);
  const roles = await db.role.findMany({ where: { companyId: company.id } });
  const users: Record<string, string> = {};
  for (const code of ['HEAD_COMMERCIAL', 'FINANCE_HEAD', 'CONTRACT_MANAGER', 'PROJECT_MANAGER', 'SITE_ENGINEER', 'BILLING_ENGINEER', 'STOREKEEPER', 'QUANTITY_SURVEYOR', 'INTERNAL_AUDITOR']) {
    const email = `${code.toLowerCase().replace(/_/g, '.')}@demo.local`;
    const u = await db.user.create({ data: { email, name: `Demo ${roles.find((r) => r.code === code)!.name}`, passwordHash: pw } });
    const hq = ['HEAD_COMMERCIAL', 'FINANCE_HEAD', 'CONTRACT_MANAGER', 'INTERNAL_AUDITOR', 'QUANTITY_SURVEYOR'].includes(code);
    await db.userRoleAssignment.create({ data: { userId: u.id, roleId: roles.find((r) => r.code === code)!.id, companyId: company.id, projectId: hq ? null : project.id, financialLimit: code === 'HEAD_COMMERCIAL' ? '5000000' : null } });
    users[code] = u.id;
  }
  const contract = await db.contract.create({ data: { projectId: project.id, contractNo: 'DEMO/CW/01', title: 'Providing, laying and commissioning of transmission main with pumping station', client: 'Demo Client Department', contractValue: 0, agreementDate: new Date('2025-03-15') } });
  const rev = await db.boqRevision.create({ data: { contractId: contract.id, revisionNo: 0, type: 'ORIGINAL', title: 'Original BOQ', createdById: admin.id } });
  const items = [
    ['1', 'Earthwork excavation in all kinds of soil for pipe trench', 'CUM', '10000', '320'],
    ['2', 'Providing, laying, jointing, testing and commissioning of 600 mm dia MS pipeline', 'RM', '1000', '10000'],
    ['3', 'Butt welding of MS pipes', 'JOINT', '2000', '1500'],
    ['4', 'Flanged joints', 'NO', '500', '2500'],
    ['5', 'RCC M30 concrete in pump house', 'CUM', '1200', '9000'],
    ['6', 'TMT reinforcement Fe 500D', 'MT', '150', '78000'],
  ];
  const created: Record<string, string> = {};
  let order = 0;
  for (const [no, desc, unit, q, r] of items) {
    const key = randomUUID();
    created[no] = key;
    await db.boqItem.create({ data: { revisionId: rev.id, itemKey: key, itemNo: no, description: desc, unit, quantity: q, rate: r, amount: money(D(q).times(r)).toString(), sortOrder: (order += 10) } });
  }
  const total = items.reduce((s, i) => s.plus(D(i[3]).times(i[4])), D(0));
  await db.boqRevision.update({ where: { id: rev.id }, data: { status: 'APPROVED', approvedById: admin.id, approvedAt: new Date(), effectiveDate: new Date('2025-04-01') } });
  await db.contract.update({ where: { id: contract.id }, data: { contractValue: total.toString() } });
  const mk = (itemKey: string, code: string, name: string, method: 'PERCENT' | 'FIXED_RATE', share: string, unit: string, factor = '1', basis?: string) =>
    db.executionActivity.create({ data: { contractId: contract.id, itemKey, code, name, method, percentage: method === 'PERCENT' ? share : null, fixedRate: method === 'FIXED_RATE' ? share : null, unit, conversionFactor: factor, conversionBasis: basis, sequence: 10, status: 'APPROVED', approvedById: admin.id, approvedAt: new Date() } });
  const sup = await mk(created['2'], 'SUP', 'Pipe supply', 'PERCENT', '80', 'RM');
  const lay = await mk(created['2'], 'LAY', 'Pipe laying', 'PERCENT', '12', 'RM');
  await mk(created['2'], 'WLD', 'Jointing / welding', 'PERCENT', '5', 'JOINT', '0.166667', 'MS pipes in 6 m lengths: one joint per 6 RM');
  await mk(created['2'], 'TST', 'Hydro testing & commissioning', 'PERCENT', '3', 'RM');
  const exc = await mk(created['1'], 'EXC', 'Trench excavation', 'PERCENT', '100', 'CUM');
  const rcc = await mk(created['5'], 'RCC', 'RCC M30 placing (labour)', 'PERCENT', '100', 'CUM');
  void sup;
  const subA = await db.subcontractor.create({ data: { companyId: company.id, code: 'DEMO-SC-A', name: 'Demo Contractor A', firmName: 'Demo Infra Works', gstin: '02AAAAA0000A1Z5', pan: 'AAAAA0000A', bankName: 'Demo Bank', bankAccount: '000000000001', ifsc: 'DEMO0000001', workCategories: ['PIPELINE', 'EARTHWORK'], status: 'ACTIVE', approvedById: admin.id, approvedAt: new Date() } });
  const subB = await db.subcontractor.create({ data: { companyId: company.id, code: 'DEMO-SC-B', name: 'Demo Contractor B', gstRegistered: false, pan: 'BBBBB0000B', bankName: 'Demo Bank', bankAccount: '000000000002', ifsc: 'DEMO0000002', workCategories: ['RCC', 'PIPELINE'], status: 'ACTIVE', approvedById: admin.id, approvedAt: new Date() } });
  for (const [i, [sub, lines]] of ([[subA, [[lay, '600', '750'], [exc, '6000', '180']]], [subB, [[lay, '400', '800'], [rcc, '600', '4500']]]] as const).entries()) {
    const wo = await db.workOrder.create({ data: { projectId: project.id, subcontractorId: sub.id, woNo: `WO-000${i + 1}`, title: `Demo work order ${i + 1}`, startDate: new Date('2025-04-01'), retentionPercent: '5', status: 'APPROVED', createdById: users.CONTRACT_MANAGER, approvedById: users.HEAD_COMMERCIAL, approvedAt: new Date(),
      items: { create: lines.map(([a, q, r], n) => ({ activityId: a.id, lineNo: n + 1, description: a.name, unit: a.unit, quantity: q, rate: r, amount: money(D(q).times(r)).toString() })) } }, include: { items: true } });
    await db.workOrder.update({ where: { id: wo.id }, data: { value: wo.items.reduce((s, x) => s.plus(x.amount.toString()), D(0)).toString() } });
    await db.workOrderItemRate.createMany({ data: wo.items.map((x) => ({ workOrderItemId: x.id, rate: x.rate, effectiveFrom: new Date('2025-04-01'), approvedById: users.HEAD_COMMERCIAL })) });
  }
  await db.docSequence.create({ data: { projectId: project.id, series: 'WO', next: 3 } });
  await db.material.createMany({ data: [
    { companyId: company.id, code: 'CEM-OPC53', name: 'OPC 53 grade cement', category: 'CEMENT', unit: 'BAG', altUnit: 'KG', altFactor: '50', standardRate: '405' },
    { companyId: company.id, code: 'TMT-12', name: 'TMT bar Fe 500D 12 mm', category: 'STEEL', unit: 'MT', altUnit: 'KG', altFactor: '1000', standardRate: '60000', batchTracked: true },
    { companyId: company.id, code: 'ELEC-E6013', name: 'Welding electrode E6013 3.15 mm', category: 'ELECTRODE', unit: 'KG', standardRate: '180', defaultBasis: 'FREE_ISSUE' },
  ] });
  console.log('Demo project created. Demo users: <role>@demo.local / Demo@12345 (e.g. billing.engineer@demo.local)');
}
main().finally(() => db.$disconnect());
