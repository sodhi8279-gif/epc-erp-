import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import { setupApp } from './helpers';
import { prisma } from '../src/lib/db';
import { extractRows, previewWorkbook, readWorkbook, sheetMatrix } from '../src/services/boqImport';

/** Builds a workbook shaped like a PDF-converted government RA bill: title rows, 3-row header, messy numbers, page footers, missing units. */
async function messyBoq() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Table 1');
  ws.getCell('A1').value = 'Jal Shakti Vibhag\nRUNNING ACCOUNT BILL';
  ws.getCell('A3').value = 'Tender Type: Item Rate Tender';
  ws.getCell('A4').value = 'S.No'; ws.getCell('B4').value = 'Item of Work'; ws.getCell('D4').value = 'As Per Revised Schedule of Quantity';
  ws.getCell('D6').value = 'Quantity'; ws.getCell('E6').value = 'Rate'; ws.getCell('G6').value = 'Unit'; ws.getCell('K6').value = 'Amount';
  const rows: (string | number | null)[][] = [
    ['1.00. A', 'Water Treatment Plant (heading)', 0, 0, null, 0],
    ['1.01. A', 'Proposed WTP at Nagnoli - 90 KLD', 1, '520000.0\n0', 'job', 520000],
    ['1.02. A', 'Proposed WTP at Haroli Khad', 1, '2380000.\n00', null, 2380000],
    ['Work ID : 2022-41380 Running Bill No: 32 Page No: 1 of 57', null, null, null, null, null],
    ['2.01. A', 'Submersible pump 1.42 LPS', 2, '123000.0\n0', 'nos', 240000],
    ['2.01. A', 'Duplicate number row', 1, '10', 'nos', 10],
  ];
  rows.forEach((r, i) => { const row = ws.getRow(7 + i); row.getCell(1).value = r[0]; row.getCell(2).value = r[1]; row.getCell(4).value = r[2]; row.getCell(5).value = r[3]; row.getCell(7).value = r[4]; row.getCell(11).value = r[5]; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('BOQ import engine', () => {
  it('suggests the header row and columns across a multi-row header', async () => {
    const buf = await messyBoq();
    const [sheet] = await previewWorkbook(buf, 'bill.xlsx');
    expect(sheet.suggestedHeaderRow).toBe(6);
    expect(sheet.suggestedMapping).toMatchObject({ itemNo: 1, description: 2, quantity: 4, rate: 5, unit: 7, amount: 11 });
  });
  it('classifies headings, skips page footers and flags every inconsistency', async () => {
    const wb = await readWorkbook(await messyBoq(), 'bill.xlsx');
    const rows = extractRows(sheetMatrix(wb.worksheets[0]), 6, { itemNo: 1, description: 2, quantity: 4, rate: 5, unit: 7, amount: 11 });
    const items = rows.filter((r) => r.kind === 'ITEM');
    expect(rows.find((r) => r.itemNo === '1.00. A')!.kind).toBe('HEADER');
    expect(items[0].rate).toBe('520000');
    // No unit in the file: taken from the other item under the same heading, with a warning to check it.
    expect(items[1].unit).toBe('JOB');
    expect(items[1].issues.map((i) => i.message)).toContain('Unit not in the file; taken as JOB from item 1.01. A under the same heading');
    expect(items[2].issues.some((i) => /≠ qty × rate/.test(i.message))).toBe(true); // 2 × 123000 ≠ 240000
    expect(items[3].issues.some((i) => /Duplicate item number/.test(i.message))).toBe(true);
    // Footer row: text only in the item-number column and no description → still an ITEM with errors? No: it has no description or numbers → SKIP
    expect(rows.find((r) => r.itemNo.startsWith('Work ID'))!.kind).toBe('SKIP');
  });
});

describe('BOQ import wizard API', () => {
  let ctx: Awaited<ReturnType<typeof setupApp>>;
  beforeAll(async () => { ctx = await setupApp(); });
  afterAll(async () => { await ctx.app.close(); await prisma.$disconnect(); });

  it('upload → map → correct → confirm creates a DRAFT revision only, preserving the original file', async () => {
    const { api, app, token } = ctx;
    const company = await api.post('/companies', { code: 'IMP', name: 'Import Co' });
    const project = await api.post('/projects', { companyId: company.id, code: 'WTP-1', name: 'WTP', type: 'WTP' });
    const contract = await api.post(`/projects/${project.id}/contracts`, { contractNo: 'C1', title: 'Design build WTP', client: 'Client', contractValue: '0' });
    const buf = await messyBoq();
    const boundary = '----epc' + Date.now();
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="RA32.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const up = await app.inject({ method: 'POST', url: `/api/contracts/${contract.id}/imports`, payload: body, headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    expect(up.statusCode).toBe(200);
    const { import: imp, sheets, document } = up.json();
    expect(document.sha256).toHaveLength(64);
    const mapped = await api.post(`/imports/${imp.id}/map`, { sheetName: sheets[0].name, headerRow: sheets[0].suggestedHeaderRow, mapping: sheets[0].suggestedMapping });
    expect(mapped.summary.errors).toBeGreaterThan(0);
    expect(mapped.rows.find((r: any) => r.itemNo === '1.02. A').unitInferred).toMatch(/taken as JOB/);
    expect((await api.call('POST', `/imports/${imp.id}/confirm`, { title: 'Original' })).status).toBe(400);
    // User corrections: set the missing unit and drop the duplicate row
    const rows = mapped.rows.map((r: any) => (r.itemNo === '1.02. A' ? { ...r, unit: 'JOB', unitRaw: 'job' } : r)).filter((r: any) => r.description !== 'Duplicate number row');
    const fixed = await api.put(`/imports/${imp.id}/rows`, { rows });
    expect(fixed.summary.errors).toBe(0);
    expect(fixed.summary.warnings).toBe(1);
    expect((await api.call('POST', `/imports/${imp.id}/confirm`, { title: 'Original' })).status).toBe(409);
    const done = await api.post(`/imports/${imp.id}/confirm`, { title: 'Original BOQ (imported)', acknowledgeWarnings: true });
    expect(done.revision.status).toBe('DRAFT');
    const rev = await api.get(`/revisions/${done.revision.id}`);
    expect(rev.items.filter((i: any) => !i.isHeader).length).toBe(3);
    expect(rev.total).toBe('3146000'); // amounts recomputed from qty × rate, not trusted from the file
    expect(rev.sourceDocumentId).toBe(document.id);
  });

  it('parses the real RA bill workbook when present (not committed)', async () => {
    const p = '/mnt/project-files/Project Audit/RUNNING BILL 32.xlsx';
    if (!fs.existsSync(p)) return;
    const [sheet] = await previewWorkbook(fs.readFileSync(p), 'RUNNING BILL 32.xlsx');
    expect(sheet.suggestedHeaderRow).toBe(6);
    const wb = await readWorkbook(fs.readFileSync(p), 'x.xlsx');
    const rows = extractRows(sheetMatrix(wb.worksheets[0]), sheet.suggestedHeaderRow!, sheet.suggestedMapping);
    const items = rows.filter((r) => r.kind === 'ITEM');
    expect(items.find((r) => r.itemNo === '10.04.C')).toBeTruthy(); // item number broken across lines is rejoined
    expect(rows.filter((r) => /^Work ID/.test(r.itemNo) && r.kind !== 'SKIP')).toHaveLength(0); // page footers
    expect(items.some((r) => /Recover|Release Amount|Income Tax/i.test(r.description))).toBe(false); // payment memorandum is not BOQ
    console.log(`real RA bill: ${items.length} items, ${rows.filter((r) => r.kind === 'HEADER').length} headings, ${items.filter((r) => r.issues.some((i) => i.level === 'error')).length} rows with errors`);
    expect(items.length).toBeGreaterThan(50);
  });
});
