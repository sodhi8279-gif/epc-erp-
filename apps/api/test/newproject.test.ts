import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import JSZip from 'jszip';
import { setupApp } from './helpers';
import { prisma } from '../src/lib/db';
import { extractRows, importSummary, previewWorkbook, readSheets } from '../src/services/boqImport';
import { extractAgreementFields, parseIndianDate, parseRupees } from '../src/services/agreement';

/** A minimal one-page PDF with text placed at (x, y-from-top) positions, like a printed RA bill. */
function pdfWithText(lines: [number, number, string][]) {
  const H = 612;
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = lines.map(([x, y, s]) => `BT /F1 8 Tf ${x} ${H - y} Td (${esc(s)}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// Shaped like a subcontractor RA bill printed to PDF: wrapped description, totals, then a recoveries block.
const RA_BILL: [number, number, string][] = [
  [300, 40, 'Name of Work:- Rural Water Supply Scheme, District Chamba'],
  [56, 100, 'S.N.'], [126, 100, 'Description of Work'], [262, 100, 'Up to date'], [318, 100, 'Previous'], [366, 100, 'This Bill'], [414, 100, 'Unit'], [452, 100, 'Rate per Unit'], [568, 100, 'Up to date'], [640, 100, 'Previous'], [690, 100, 'This Bill'],
  [62, 120, '1'], [80, 120, 'Pump House (100% released'],
  [80, 130, 'on completion)'], [272, 130, '1.00'], [322, 130, '0.00'], [373, 130, '1.00'], [418, 130, 'Job'], [459, 130, '2400000'], [568, 130, '2400000.00'], [640, 130, '0.00'], [685, 130, '2400000.00'],
  [80, 137, 'of the building'],
  [62, 145, '2'], [80, 145, 'Excavation Building'], [267, 145, '480.00'], [322, 145, '0.00'], [368, 145, '480.00'], [416, 145, 'Cum'], [462, 145, '250.00'], [570, 145, '120000.00'], [640, 145, '0.00'], [687, 145, '120000.00'],
  [62, 160, '3'], [80, 160, 'PCC Retaining Wall'], [267, 160, '289.45'], [322, 160, '0.00'], [368, 160, '289.45'], [416, 160, 'Cum'], [460, 160, '6500.00'], [568, 160, '1881425.00'], [640, 160, '0.00'], [685, 160, '1881425.00'],
  [62, 175, '4'], [80, 175, 'Septic tank'], [272, 175, '1.00'], [322, 175, '0.00'], [373, 175, '1.00'], [416, 175, 'NOS'], [455, 175, '121000.00'], [570, 175, '121000.00'], [640, 175, '0.00'], [687, 175, '121000.00'],
  [470, 190, 'TOTAL Amount'], [574, 190, '4522425'], [640, 190, '0.00'], [691, 190, '4522425'],
  [221, 205, 'Recovery'],
  [226, 220, 'Cement'], [287, 220, '2340'], [329, 220, '0'], [373, 220, '2340'], [419, 220, 'Bag'], [469, 220, '405'], [570, 220, '947700.00'], [640, 220, '0.00'], [687, 220, '947700.00'],
];

describe('BOQ from a PDF RA bill', () => {
  it('rebuilds the table, joins wrapped lines, and stops at totals and recoveries', async () => {
    const buf = pdfWithText(RA_BILL);
    const [sheet] = await previewWorkbook(buf, 'bill.pdf');
    expect(sheet.name).toBe('PDF, 1 page');
    expect(sheet.suggestedMapping).toMatchObject({ itemNo: 1, description: 2 });
    expect(sheet.suggestedMapping.quantity).toBeTruthy(); // the first "Up to date" column
    expect(sheet.suggestedMapping.unit).toBeTruthy();
    expect(sheet.suggestedMapping.rate).toBeTruthy();
    const [src] = await readSheets(buf, 'bill.pdf');
    const rows = extractRows(src.matrix, sheet.suggestedHeaderRow!, sheet.suggestedMapping, { joinWrapped: true });
    const items = rows.filter((r) => r.kind === 'ITEM');
    expect(items.map((r) => r.itemNo)).toEqual(['1', '2', '3', '4']);
    expect(items[0]).toMatchObject({ description: 'Pump House (100% released on completion) of the building', unit: 'JOB', quantity: '1', rate: '2400000' });
    expect(items[3].unit).toBe('NO');
    expect(importSummary(rows)).toMatchObject({ items: 4, errors: 0, total: '4522425' });
  });

  it('reads the real subcontractor RA bill PDF when present (not committed)', async () => {
    const p = '/mnt/project-files/Project Audit/Hem Raj RA P House  B.Morh.pdf';
    if (!fs.existsSync(p)) return;
    const buf = fs.readFileSync(p);
    const [sheet] = await previewWorkbook(buf, 'x.pdf');
    const [src] = await readSheets(buf, 'x.pdf');
    const rows = extractRows(src.matrix, sheet.suggestedHeaderRow!, sheet.suggestedMapping, { joinWrapped: true });
    expect(importSummary(rows)).toMatchObject({ items: 8, errors: 0, total: '5120425' });
  });

  it('explains when a PDF has no text (a scan)', async () => {
    await expect(readSheets(pdfWithText([]), 'scan.pdf')).rejects.toThrow(/no text layer/);
  });
});

const AGREEMENT = `CONTRACT AGREEMENT
Agreement No. HPRWSP/UNA/CW-07/2022 dated 05/12/2022
This Agreement is made on the 5th day of December 2022 between the Executive Engineer, PIU Hamirpur, Jal Shakti Vibhag, Government of Himachal Pradesh (hereinafter called the "Employer") and M/s R.G. Industries, Jalandhar (hereinafter called the "Contractor").
Name of Work: Design Build of Rural Water Supply Scheme at District Una
Letter of Acceptance No. PIU/HMR/2022/4471 dated 28/11/2022.
The Contract Price is Rs. 1,19,46,13,670/- (Rupees One Hundred Nineteen Crore only).
Date of commencement: 14/12/2022. Time for completion: 24 (twenty four) months.
This is an item rate contract.`;

describe('Agreement reader', () => {
  it('finds project and contract details with the text they came from', () => {
    const f = extractAgreementFields(AGREEMENT);
    expect(f.agreementNo?.value).toBe('HPRWSP/UNA/CW-07/2022');
    expect(f.agreementDate?.value).toBe('2022-12-05');
    expect(f.projectName?.value).toBe('Design Build of Rural Water Supply Scheme at District Una');
    expect(f.client?.value).toBe('Executive Engineer, PIU Hamirpur, Jal Shakti Vibhag, Government of Himachal Pradesh');
    expect(f.contractor?.value).toBe('M/s R.G. Industries, Jalandhar');
    expect(f.contractValue?.value).toBe('1194613670');
    expect(f.loaRef?.value).toBe('PIU/HMR/2022/4471');
    expect(f.startDate?.value).toBe('2022-12-14');
    expect(f.completionDate?.value).toBe('2024-12-13');
    expect(f.state?.value).toBe('Himachal Pradesh');
    expect(f.location?.value).toBe('Una');
    expect(f.contractType?.value).toBe('ITEM_RATE');
    expect(f.contractValue?.source).toMatch(/Contract Price/);
  });
  it('reads Indian dates and amounts', () => {
    expect(parseIndianDate('05/12/2022')).toBe('2022-12-05');
    expect(parseIndianDate('3rd March, 2024')).toBe('2024-03-03');
    expect(parseIndianDate('31/02/2024')).toBeNull();
    expect(parseRupees('4.25', 'crore')).toBe('42500000');
    expect(parseRupees('85', 'lakh')).toBe('8500000');
  });
});

describe('New project with agreement and BOQ', () => {
  let ctx: Awaited<ReturnType<typeof setupApp>>;
  beforeAll(async () => { ctx = await setupApp(); });
  afterAll(async () => { await ctx.app.close(); await prisma.$disconnect(); });

  const upload = (url: string, filename: string, buf: Buffer, fields: Record<string, string> = {}) => {
    const b = '----epc' + Math.random().toString(36).slice(2);
    const parts = [
      ...Object.entries(fields).map(([k, v]) => Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`),
    ];
    return ctx.app.inject({ method: 'POST', url: `/api${url}`, payload: Buffer.concat(parts), headers: { authorization: `Bearer ${ctx.token}`, 'content-type': `multipart/form-data; boundary=${b}` } });
  };

  it('agreement upload → project + contract → PDF BOQ import → draft revision', async () => {
    const { api } = ctx;
    const company = await api.post('/companies', { code: 'NPW', name: 'New Project Co' });
    // Word agreement (fields go before the file so they are read with it)
    const zip = new JSZip();
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${AGREEMENT.split('\n').map((l) => `<w:p><w:r><w:t>${l.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
    const docx = await zip.generateAsync({ type: 'nodebuffer' });
    const ex = await upload('/agreements/extract', 'agreement.docx', docx, { companyId: company.id });
    expect(ex.statusCode).toBe(200);
    const { document, suggestions, readError } = ex.json();
    expect(readError).toBeNull();
    expect(suggestions.agreementNo.value).toBe('HPRWSP/UNA/CW-07/2022');

    const p = await api.post('/projects', {
      companyId: company.id, code: 'UNA-WSS', name: suggestions.projectName.value, type: 'WATER_SUPPLY', client: suggestions.client.value, state: suggestions.state.value,
      startDate: suggestions.startDate.value, endDate: suggestions.completionDate.value,
      contract: { contractNo: suggestions.agreementNo.value, contractValue: suggestions.contractValue.value, agreementDate: suggestions.agreementDate.value, loaRef: suggestions.loaRef.value, type: 'ITEM_RATE' },
      agreementDocumentId: document.id,
    });
    expect(p.contract).toMatchObject({ contractNo: 'HPRWSP/UNA/CW-07/2022', client: suggestions.client.value, title: suggestions.projectName.value });
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(doc).toMatchObject({ projectId: p.id, entityType: 'Contract', entityId: p.contract.id, category: 'AGREEMENT' });
    // The same agreement cannot be attached to a second project.
    expect((await api.call('POST', '/projects', { companyId: company.id, code: 'X2', name: 'Second', type: 'OTHER', agreementDocumentId: document.id })).status).toBe(400);

    const up = await upload(`/contracts/${p.contract.id}/imports`, 'RA-1.pdf', pdfWithText(RA_BILL));
    expect(up.statusCode).toBe(200);
    const { import: imp, sheets, parseError } = up.json();
    expect(parseError).toBeUndefined();
    const mapped = await api.post(`/imports/${imp.id}/map`, { sheetName: sheets[0].name, headerRow: sheets[0].suggestedHeaderRow, mapping: sheets[0].suggestedMapping });
    expect(mapped.summary).toMatchObject({ items: 4, errors: 0 });
    const done = await api.post(`/imports/${imp.id}/confirm`, { title: 'Original BOQ from RA bill 1', acknowledgeWarnings: true });
    const rev = await api.get(`/revisions/${done.revision.id}`);
    expect(rev.items).toHaveLength(4);
    expect(rev.total).toBe('4522425');
    expect(rev.remarks).toBe('Imported from RA-1.pdf');
  });

  it('project without agreement still works, and a scanned agreement is reported', async () => {
    const { api } = ctx;
    const company = await api.post('/companies', { code: 'NPM', name: 'Manual Co' });
    const p = await api.post('/projects', { companyId: company.id, code: 'MAN-1', name: 'Manual project', type: 'CIVIL' });
    expect(p.contract).toBeNull();
    const ex = await upload('/agreements/extract', 'scan.pdf', pdfWithText([]), { companyId: company.id });
    expect(ex.json().readError).toMatch(/no text|scanned/i);
    expect((await api.call('POST', '/projects', { companyId: company.id, code: 'MAN-2', name: 'No client', type: 'CIVIL', contract: { contractNo: 'A-1' } })).status).toBe(400);
  });
});
