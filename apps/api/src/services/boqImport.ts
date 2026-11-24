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
  /** Set when the unit was not in the file and was filled in from the description or neighbouring items. */
  unitInferred?: string | null;
  issues: { level: 'error' | 'warning'; field?: Field; message: string }[];
}

/** One table to map: a worksheet, or the rows and columns rebuilt from a PDF. */
export interface SourceSheet { name: string; matrix: (string | null)[][] }

export const isPdf = (filename: string) => /\.pdf$/i.test(filename);

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
    throw new Error('Only .xlsx, .csv and .pdf BOQ files can be read. Save legacy .xls files as .xlsx.');
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
  ['itemNo', /^(s\.?\s*no|s\.?\s*n|sl\.?\s*no|item\s*no|item\s*code|sr\.?\s*no|boq\s*(item|ref)|item)\.?$/i],
  ['description', /(description|item of work|particulars|name of item|specification of item)/i],
  ['unit', /^(unit|uom|units)\.?$/i],
  // RA bills often show only executed quantities: the first "up to date" column is the quantity, the next the amount.
  ['quantity', /^(qty|quantity|boq qty|contract qty|tender qty|agreement qty|up ?to ?date( qty)?|qty up ?to ?date|quantity executed up ?to ?date)\.?$/i],
  ['rate', /^(rate|unit rate|rate \(rs\.?\)|rate in rs\.?|rate \(₹\)|quoted rate)/i],
  ['amount', /^(amount|total|amount \(rs\.?\)|amount in rs\.?|value|up ?to ?date)/i],
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

/** Every table in an uploaded BOQ / RA bill: each worksheet of an Excel file, or one table rebuilt from all pages of a PDF. */
export async function readSheets(buf: Buffer, filename: string): Promise<SourceSheet[]> {
  if (isPdf(filename)) {
    const { pdfTextItems, itemsToMatrix } = await import('./pdfText');
    const { pages, items } = await pdfTextItems(buf);
    if (items.length === 0) throw new Error('This PDF has no text layer (it is probably a scan), so nothing can be read from it. Upload the Excel copy, or enter the BOQ by hand.');
    return [{ name: `PDF, ${pages} page${pages === 1 ? '' : 's'}`, matrix: itemsToMatrix(items) }];
  }
  const wb = await readWorkbook(buf, filename);
  return wb.worksheets.map((ws) => ({ name: ws.name, matrix: sheetMatrix(ws) }));
}

export async function previewWorkbook(buf: Buffer, filename: string): Promise<SheetPreview[]> {
  const sheets = await readSheets(buf, filename);
  return sheets.map(({ name, matrix }) => {
    const top = matrix.slice(0, 400);
    const s = suggestMapping(top);
    const columnCount = Math.max(0, ...matrix.map((r) => r.length));
    // Show enough rows below the header to check the mapping against real items.
    const show = Math.max(40, (s.headerRow ?? 0) + 25);
    return { name, rowCount: matrix.length, columnCount, rows: matrix.slice(0, show), suggestedHeaderRow: s.headerRow, suggestedMapping: s.mapping };
  });
}

// A row that starts the recoveries / deductions / payment part of an RA bill: nothing after it is a BOQ item.
const STOP = /^(b\.\s*)?(recover(y|ies)|deductions?\b|less\s*:|net payable|memorandum of payment|abstract of (cost|payment)|ii\s*[-.]?\s*certificate)/i;
// Totals, sub-totals and carried-forward lines are skipped but do not end the table (a BOQ can have a total per part).
const TOTAL = /^((sub[- ]?)?(grand\s+)?total\b|carried (over|forward)|brought forward|c\/f\b|b\/f\b)/i;
const PAGE = /\bpage\s*(no\.?)?\s*:?\s*\d+\s*(of|\/)\s*\d+/i;
// In a PDF, a line without an item number that looks like a heading starts a new row instead of continuing the item above.
const HEADING_LIKE = (t: string) => /^(part|section|sub[- ]?head|schedule|chapter|bill\s+no)\b/i.test(t) || (t.length <= 80 && /[A-Z]{3}/.test(t) && t === t.toUpperCase());
const UNIT_IN_TEXT = /\b(?:in|per|unit\s*[:-]?)\s*(nos?\.?|numbers?|each|rmt|r\.m\.?|running metres?|metres?|meters?|mtrs?|rm|cum|cu\.?\s?m|sqm|sq\.?\s?m|kgs?|qtls?|quintals?|tonnes?|mt|jobs?|l\.?s\.?|lump\s?sum|sets?|joints?)(?![a-z])/i;

export interface ExtractOptions {
  /** PDF tables: description text that wraps onto following lines (and figures printed on a later line) belong to the item above. */
  joinWrapped?: boolean;
}

/** Classify and validate every row under the header. Nothing here is trusted until a user confirms it. */
export function extractRows(matrix: (string | null)[][], headerRow: number, m: Mapping, opts: ExtractOptions = {}): ImportRow[] {
  const get = (row: (string | null)[], f: Field) => (m[f] ? (row[m[f]! - 1] ?? null) : null);
  const norm = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  // Header text per mapped column (header row and up to two rows above), to drop page headers repeated on every page.
  const headerTexts = new Map<number, Set<string>>();
  for (const c of Object.values(m)) {
    if (!c) continue;
    const set = new Set<string>();
    for (let r = Math.max(0, headerRow - 3); r < headerRow; r++) { const t = norm(matrix[r]?.[c - 1]); if (t) set.add(t); }
    headerTexts.set(c, set);
  }
  const out: ImportRow[] = [];
  let stopped = false;
  // The item or heading that wrapped text can still be joined to (PDF only); any skipped line in between ends it.
  let open: ImportRow | null = null;
  for (let i = headerRow; i < matrix.length; i++) {
    const row = matrix[i];
    const description = (get(row, 'description') ?? '').replace(/[ \t]+/g, ' ').trim();
    // "10.04\n.C" (a number broken across lines by a PDF conversion) → "10.04.C"
    const itemNo = (get(row, 'itemNo') ?? '').replace(/\s*\n\s*/g, '').replace(/\s+/g, ' ').trim();
    const unitRaw = (get(row, 'unit') ?? '').trim();
    const qRaw = get(row, 'quantity'), rRaw = get(row, 'rate'), aRaw = get(row, 'amount');
    const q = parseLooseNumber(qRaw), r = parseLooseNumber(rRaw), a = parseLooseNumber(aRaw);
    const r0: ImportRow = { rowNo: i + 1, kind: 'ITEM', itemNo, description, unitRaw, unit: normaliseUnit(unitRaw), quantity: q?.toString() ?? null, rate: r?.toString() ?? null, amount: a?.toString() ?? null, specRef: get(row, 'specRef'), drawingRef: get(row, 'drawingRef'), issues: [] };
    // A cell merged down over several rows repeats on each of them in Excel: keep only the first.
    if (i > headerRow && row.some((c) => c) && row.length === matrix[i - 1]?.length && row.every((c, k) => c === matrix[i - 1][k])) { r0.kind = 'SKIP'; out.push(r0); open = null; continue; }
    const lead = (itemNo || description || row.find((c) => c && c.trim()) || '').trim();
    if (stopped || (out.some((x) => x.kind === 'ITEM') && STOP.test(lead))) { stopped = true; r0.kind = 'SKIP'; out.push(r0); open = null; continue; }
    if (TOTAL.test(lead) || TOTAL.test(description)) { r0.kind = 'SKIP'; out.push(r0); open = null; continue; }
    // Page headers/footers ("Page No: 3 of 57"), often one cell merged across the row so it repeats in every column.
    if (PAGE.test(lead) || (itemNo && itemNo.length > 25 && itemNo === description.replace(/\s+/g, ' ') && !q && !r)) { r0.kind = 'SKIP'; out.push(r0); open = null; continue; }
    const mapped = Object.values(m).filter((c): c is number => !!c).map((c) => [c, norm(row[c - 1])] as const).filter(([, t]) => t);
    if (mapped.length && mapped.every(([c, t]) => headerTexts.get(c)?.has(t))) { r0.kind = 'SKIP'; out.push(r0); open = null; continue; }

    const prev = open;
    if (opts.joinWrapped && prev && !itemNo && (description || q || r) && !(description && !q && !r && HEADING_LIKE(description))) {
      // Continuation of the row above: join the text, and take figures the row above does not have yet.
      if (description) prev.description = `${prev.description} ${description}`.trim();
      if (!prev.unitRaw && unitRaw) { prev.unitRaw = unitRaw; prev.unit = normaliseUnit(unitRaw); }
      prev.quantity ??= r0.quantity; prev.rate ??= r0.rate; prev.amount ??= r0.amount;
      const pq = prev.quantity ? D(prev.quantity) : null, pr = prev.rate ? D(prev.rate) : null;
      prev.kind = (pq === null || pq.isZero()) && (pr === null || pr.isZero()) ? 'HEADER' : 'ITEM';
      r0.kind = 'SKIP'; r0.description = ''; out.push(r0);
      continue;
    }
    open = null;
    if (!description && !q && !r) { r0.kind = 'SKIP'; out.push(r0); open = null; continue; }
    if (description && (q === null || q.isZero()) && (r === null || r.isZero())) { r0.kind = 'HEADER'; out.push(r0); open = r0; continue; }
    out.push(r0);
    open = r0;
  }
  // Headings after the last item are notes, signatures or summary lines.
  for (let i = out.length - 1; i >= 0 && out[i].kind !== 'ITEM'; i--) out[i].kind = 'SKIP';
  inferUnits(out);
  return validateRows(out);
}

/**
 * Converted RA bills often print the unit on only some rows. When the file has no unit for an item, take it from the
 * description ("... in Nos.") or, failing that, from the unit most used by the other items under the same heading.
 * Every filled-in unit carries a warning so it is checked in the review step.
 */
export function inferUnits(rows: ImportRow[]) {
  let start = 0;
  const groups: ImportRow[][] = [];
  rows.forEach((r, i) => { if (r.kind === 'HEADER') { groups.push(rows.slice(start, i)); start = i + 1; } });
  groups.push(rows.slice(start));
  for (const g of groups) {
    const items = g.filter((r) => r.kind === 'ITEM');
    const given = items.map((r) => (r.unit && r.unitRaw ? r : null));
    items.forEach((r, i) => {
      if (r.unit || r.unitRaw) return;
      const hit = r.description.match(UNIT_IN_TEXT);
      const word = hit ? hit[1].replace(/\.$/, '') : '';
      const fromText = hit ? normaliseUnit(word) ?? normaliseUnit(word.replace(/s$/i, '')) : null;
      if (fromText) { r.unit = fromText; r.unitInferred = `Unit not in the file; taken as ${fromText} from the description`; return; }
      // Nearest item above under the same heading that has a unit, else the nearest one below.
      let src: ImportRow | null = null;
      for (let k = i - 1; k >= 0 && !src; k--) src = given[k];
      for (let k = i + 1; k < items.length && !src; k++) src = given[k];
      if (src) { r.unit = src.unit; r.unitInferred = `Unit not in the file; taken as ${src.unit} from item ${src.itemNo || `on row ${src.rowNo}`} under the same heading`; }
    });
  }
  return rows;
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
    else if (r.unitInferred && !r.unitRaw) r.issues.push({ level: 'warning', field: 'unit', message: r.unitInferred });
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
