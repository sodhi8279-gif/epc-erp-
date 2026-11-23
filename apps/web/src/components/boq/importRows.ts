import { D, money, normaliseUnit, parseLooseNumber, type Decimal } from '@epc/shared';

/** Mirrors apps/api/src/services/boqImport.ts so the review grid can show issues while the user edits. The server re-validates on save. */
export type ImportField = 'itemNo' | 'description' | 'unit' | 'quantity' | 'rate' | 'amount' | 'specRef' | 'drawingRef';
export const IMPORT_FIELDS: { key: ImportField; label: string; required?: boolean }[] = [
  { key: 'itemNo', label: 'Item no.', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'unit', label: 'Unit' },
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'rate', label: 'Rate', required: true },
  { key: 'amount', label: 'Amount' },
  { key: 'specRef', label: 'Specification ref.' },
  { key: 'drawingRef', label: 'Drawing ref.' },
];
export type Mapping = Partial<Record<ImportField, number>>;
export type RowKind = 'ITEM' | 'HEADER' | 'SKIP';
export interface Issue { level: 'error' | 'warning'; field?: ImportField; message: string }
export interface ImportRow {
  rowNo: number; kind: RowKind; itemNo: string; description: string; unitRaw: string; unit: string | null;
  quantity: string | null; rate: string | null; amount: string | null; specRef?: string | null; drawingRef?: string | null; issues?: Issue[];
}
export interface ImportSummary { items: number; headers: number; skipped: number; errors: number; warnings: number; total: string }

export const colLetter = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

const num = (v: string | null | undefined): Decimal | null => { try { return parseLooseNumber(v); } catch { return null; } };

/** Issues per row (same rules as the server), computed without mutating the rows. */
export function computeIssues(rows: ImportRow[]): Issue[][] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const out: Issue[] = [];
    const dup = () => {
      const k = r.itemNo.trim().toUpperCase();
      if (!k) return;
      if (seen.has(k)) out.push({ level: 'error', field: 'itemNo', message: `Duplicate item number (also on source row ${seen.get(k)})` });
      else seen.set(k, r.rowNo);
    };
    // Headings also become BOQ rows, so their item numbers must be unique too.
    if (r.kind === 'HEADER') { dup(); return out; }
    if (r.kind !== 'ITEM') return out;
    const unit = r.unit ?? normaliseUnit(r.unitRaw);
    const q = num(r.quantity), rt = num(r.rate);
    if (!r.itemNo.trim()) out.push({ level: 'error', field: 'itemNo', message: 'Item number is missing' });
    if (!r.description.trim()) out.push({ level: 'error', field: 'description', message: 'Description is missing' });
    if (!unit) out.push({ level: 'error', field: 'unit', message: r.unitRaw ? `Unit "${r.unitRaw}" not recognised` : 'Unit is missing' });
    if (q === null) out.push({ level: 'error', field: 'quantity', message: 'Quantity is missing or not a number' });
    else if (q.lt(0)) out.push({ level: 'error', field: 'quantity', message: 'Quantity is negative' });
    if (rt === null) out.push({ level: 'error', field: 'rate', message: 'Rate is missing or not a number' });
    if (q !== null && rt !== null) {
      const calc = money(q.times(rt));
      const a = num(r.amount);
      if (a === null) out.push({ level: 'warning', field: 'amount', message: `Amount missing; will be computed as ₹${calc.toFixed(2)}` });
      else if (calc.minus(a).abs().gt(1)) out.push({ level: 'warning', field: 'amount', message: `Amount ₹${a.toFixed(2)} ≠ qty × rate ₹${calc.toFixed(2)}; the computed value will be used` });
    }
    dup();
    return out;
  });
}

export function summarise(rows: ImportRow[], issues: Issue[][]): ImportSummary {
  let items = 0, headers = 0, skipped = 0, errors = 0, warnings = 0, total = D(0);
  rows.forEach((r, i) => {
    if (r.kind === 'HEADER') { headers++; errors += issues[i].length; }
    else if (r.kind === 'SKIP') skipped++;
    else {
      items++;
      for (const x of issues[i]) x.level === 'error' ? errors++ : warnings++;
      const q = num(r.quantity), rt = num(r.rate);
      if (q && rt) total = total.plus(q.times(rt));
    }
  });
  return { items, headers, skipped, errors, warnings, total: money(total).toString() };
}

export const computedAmount = (r: ImportRow): string | null => {
  const q = num(r.quantity), rt = num(r.rate);
  return q && rt ? money(q.times(rt)).toString() : null;
};

/** Shape sent to PUT /imports/:id/rows: numbers normalised, issues left to the server. */
export const toPayload = (rows: ImportRow[]) => rows.map((r) => ({
  rowNo: r.rowNo, kind: r.kind, itemNo: r.itemNo.trim(), description: r.description, unitRaw: r.unitRaw, unit: r.unit,
  quantity: num(r.quantity)?.toString() ?? null, rate: num(r.rate)?.toString() ?? null, amount: num(r.amount)?.toString() ?? null,
  specRef: r.specRef ?? null, drawingRef: r.drawingRef ?? null,
}));

/** Header text of a column at the chosen header row (falls back to up to two rows above, for merged multi-line headers). */
export function headerText(rows: (string | null)[][], headerRow: number, col: number): string {
  for (let r = headerRow - 1; r >= Math.max(0, headerRow - 3); r--) {
    const t = rows[r]?.[col - 1];
    if (t && t.trim()) return t.replace(/\s+/g, ' ').trim();
  }
  return '';
}
