import ExcelJS from 'exceljs';
import { D, money, normaliseUnit, parseLooseNumber } from '@epc/shared';

export type Field = 'itemNo' | 'description' | 'unit' | 'quantity' | 'rate' | 'amount' | 'specRef' | 'drawingRef';
export const FIELDS: Field[] = ['itemNo', 'description', 'unit', 'quantity', 'rate', 'amount', 'specRef', 'drawingRef'];
export type Mapping = Partial<Record<Field, number>>; // column index (1-based)

export interface SheetPreview { name: string; rowCount: number; columnCount: number; rows: (string | null)[][]; suggestedHeaderRow: number | null; suggestedMapping: Mapping }

export interface ImportRow {
  rowNo: number; // source row
  kind: 'ITEM' | 'HEADER' | 'SKIP';
  itemNo: string; description: string; unitRaw: string; unit: string | null;
  quantity: string | null; rate: string | null; amount: string | null; specRef?: string | null; drawingRef?: string | null;
  issues: { level: 'error' | 'warning'; field?: Field; message: string }[];
}

const cellText = (v: ExcelJS.CellValue): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return v.result === undefined || v.result === null ? null : String(v.result);
    if ('text' in v) return String(v.text);
    if ('error' in v) return null;
  }
  return String(v);
};

export async function readWorkbook(buf: Buffer, filename: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(filename)) {
    const { Readable } = await import('node:stream');
    await wb.csv.read(Readable.from(buf));
  } else if (/\.xlsx$/i.test(filename)) {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } else {
    throw new Error('Only .xlsx and .csv BOQ files can be parsed. Save legacy .xls files as .xlsx; PDF BOQs are stored but must be converted to Excel for extraction.');
  }
  return wb;
}

export function sheetMatrix(ws: ExcelJS.Worksheet, maxRows = Infinity): (string | null)[][] {
  const out: (string | null)[][] = [];
  const cols = ws.columnCount;
  const last = Math.min(ws.rowCount, maxRows);
  for (let r = 1; r <= last; r++) {
    const row = ws.getRow(r);
    const vals: (string | null)[] = [];
    for (let c = 1; c <= cols; c++) vals.push(cellText(row.getCell(c).value));
    out.push(vals);
  }
  return out;
}

const PATTERNS: [Field, RegExp][] = [
  ['itemNo', /^(s\.?\s*no|sl\.?\s*no|item\s*no|item\s*code|sr\.?\s*no|boq\s*(item|ref)|item)\.?$/i],
  ['description', /(description|item of work|particulars|name of item|specification of item)/i],
  ['unit', /^(unit|uom|units)\.?$/i],
  ['quantity', /^(qty|quantity|boq qty|contract qty|tender qty)\.?$/i],
  ['rate', /^(rate|unit rate|rate \(rs\.?\)|rate in rs\.?|rate \(₹\)|quoted rate)/i],
  ['amount', /^(amount|total|amount \(rs\.?\)|amount in rs\.?|value)/i],
  ['specRef', /(spec|specification ref)/i],
  ['drawingRef', /(drawing|dwg)/i],
];

/** Suggest a header row and column mapping by scanning the top of the sheet (multi-row headers are merged per column). */
export function suggestMapping(rows: (string | null)[][]): { headerRow: number | null; mapping: Mapping } {
  let best: { headerRow: number; mapping: Mapping; score: number } | null = null;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const mapping: Mapping = {};
    const width = Math.max(...rows.slice(Math.max(0, r - 2), r + 1).map((x) => x.length));
    for (let c = 0; c < width; c++) {
      // Look at this row and up to two rows above (merged multi-line headers).
      const texts = [rows[r]?.[c], rows[r - 1]?.[c], rows[r - 2]?.[c]].filter(Boolean).map((t) => t!.replace(/\s+/g, ' ').trim());
      for (const t of texts) {
        const hit = PATTERNS.find(([f, re]) => mapping[f] === undefined && re.test(t));
        if (hit) { mapping[hit[0]] = c + 1; break; }
      }
    }
    const score = Object.keys(mapping).length + (mapping.description ? 2 : 0) + (mapping.quantity ? 1 : 0);
    if (score >= 4 && (!best || score > best.score)) best = { headerRow: r + 1, mapping, score };
  }
  return best ? { headerRow: best.headerRow, mapping: best.mapping } : { headerRow: null, mapping: {} };
}

export async function previewWorkbook(buf: Buffer, filename: string): Promise<SheetPreview[]> {
  const wb = await readWorkbook(buf, filename);
  return wb.worksheets.map((ws) => {
    const all = sheetMatrix(ws, 400);
    const s = suggestMapping(all);
    return { name: ws.name, rowCount: ws.rowCount, columnCount: ws.columnCount, rows: all.slice(0, 40), suggestedHeaderRow: s.headerRow, suggestedMapping: s.mapping };
  });
}

/** Classify and validate every row under the header. Nothing here is trusted until a user confirms it. */
export function extractRows(matrix: (string | null)[][], headerRow: number, m: Mapping): ImportRow[] {
  const get = (row: (string | null)[], f: Field) => (m[f] ? (row[m[f]! - 1] ?? null) : null);
  const out: ImportRow[] = [];
  for (let i = headerRow; i < matrix.length; i++) {
    const row = matrix[i];
    const description = (get(row, 'description') ?? '').trim();
    const itemNo = (get(row, 'itemNo') ?? '').replace(/\s+/g, ' ').trim();
    const unitRaw = (get(row, 'unit') ?? '').trim();
    const qRaw = get(row, 'quantity'), rRaw = get(row, 'rate'), aRaw = get(row, 'amount');
    const q = parseLooseNumber(qRaw), r = parseLooseNumber(rRaw), a = parseLooseNumber(aRaw);
    const r0: ImportRow = { rowNo: i + 1, kind: 'ITEM', itemNo, description, unitRaw, unit: normaliseUnit(unitRaw), quantity: q?.toString() ?? null, rate: r?.toString() ?? null, amount: a?.toString() ?? null, specRef: get(row, 'specRef'), drawingRef: get(row, 'drawingRef'), issues: [] };
    if (!description && !q && !r) { r0.kind = 'SKIP'; out.push(r0); continue; }
    if (description && (q === null || q.isZero()) && (r === null || r.isZero())) { r0.kind = 'HEADER'; out.push(r0); continue; }
    out.push(r0);
  }
  return validateRows(out);
}

export function validateRows(rows: ImportRow[]): ImportRow[] {
  const seen = new Map<string, number>();
  for (const r of rows) {
    r.issues = [];
    // Item numbers must be unique across items AND headings: both become BOQ rows with a unique item number.
    if (r.kind === 'HEADER' && r.itemNo) {
      const k = r.itemNo.toUpperCase();
      if (seen.has(k)) r.issues.push({ level: 'error', field: 'itemNo', message: `Duplicate item number (also on source row ${seen.get(k)})` });
      else seen.set(k, r.rowNo);
    }
    if (r.kind !== 'ITEM') continue;
    r.unit = r.unit ?? normaliseUnit(r.unitRaw);
    if (!r.itemNo) r.issues.push({ level: 'error', field: 'itemNo', message: 'Item number is missing' });
    if (!r.description) r.issues.push({ level: 'error', field: 'description', message: 'Description is missing' });
    if (!r.unit) r.issues.push({ level: 'error', field: 'unit', message: r.unitRaw ? `Unit "${r.unitRaw}" not recognised` : 'Unit is missing' });
    if (r.quantity === null) r.issues.push({ level: 'error', field: 'quantity', message: 'Quantity is missing or not a number' });
    else if (D(r.quantity).lt(0)) r.issues.push({ level: 'error', field: 'quantity', message: 'Quantity is negative' });
    if (r.rate === null) r.issues.push({ level: 'error', field: 'rate', message: 'Rate is missing or not a number' });
    if (r.quantity !== null && r.rate !== null) {
      const calc = money(D(r.quantity).times(r.rate));
      if (r.amount === null) r.issues.push({ level: 'warning', field: 'amount', message: `Amount missing; will be computed as ₹${calc.toFixed(2)}` });
      else if (calc.minus(r.amount).abs().gt(1)) r.issues.push({ level: 'warning', field: 'amount', message: `Amount ₹${D(r.amount).toFixed(2)} ≠ qty × rate ₹${calc.toFixed(2)}; the computed value will be used` });
    }
    if (r.itemNo) {
      const k = r.itemNo.toUpperCase();
      if (seen.has(k)) r.issues.push({ level: 'error', field: 'itemNo', message: `Duplicate item number (also on source row ${seen.get(k)})` });
      else seen.set(k, r.rowNo);
    }
  }
  return rows;
}

export const importSummary = (rows: ImportRow[]) => {
  const items = rows.filter((r) => r.kind === 'ITEM');
  const headers = rows.filter((r) => r.kind === 'HEADER');
  return {
    items: items.length, headers: rows.filter((r) => r.kind === 'HEADER').length, skipped: rows.filter((r) => r.kind === 'SKIP').length,
    errors: [...items, ...headers].reduce((n, r) => n + (r.issues ?? []).filter((i) => i.level === 'error').length, 0),
    warnings: items.reduce((n, r) => n + r.issues.filter((i) => i.level === 'warning').length, 0),
    total: money(items.reduce((s, r) => (r.quantity && r.rate ? s.plus(D(r.quantity).times(r.rate)) : s), D(0))).toString(),
  };
};
