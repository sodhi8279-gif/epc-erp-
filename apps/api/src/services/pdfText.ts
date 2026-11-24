// Text extraction from PDFs, with positions, so that tabular documents (BOQs, RA bills, abstracts) can be rebuilt as
// rows and columns and then go through the same mapping and review steps as an Excel file.
// Only PDFs that contain text work; scanned images have no text layer (the caller tells the user to fill in by hand).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// Run the PDF parser on the main thread (no worker file to locate; also works inside the desktop's bundled server).
// @ts-expect-error The worker module ships without type declarations.
import * as pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfWorker;

export interface TextItem { page: number; x0: number; x1: number; y: number; h: number; str: string }

const MAX_PAGES = 300;

export async function pdfTextItems(buf: Buffer): Promise<{ pages: number; items: TextItem[] }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const items: TextItem[] = [];
  try {
    const n = Math.min(doc.numPages, MAX_PAGES);
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      for (const it of tc.items as { str?: string; transform: number[]; width: number; height: number }[]) {
        const str = (it.str ?? '').replace(/\s+/g, ' ').trim();
        if (!str) continue;
        const x0 = it.transform[4];
        const h = Math.abs(it.height || it.transform[3] || 8);
        items.push({ page: p, x0, x1: x0 + Math.max(it.width, 1), y: vp.height - it.transform[5], h, str });
      }
      page.cleanup();
    }
    return { pages: doc.numPages, items };
  } finally {
    await doc.destroy();
  }
}

/** Plain text in reading order (top to bottom, left to right), one line per text line. */
export async function pdfPlainText(buf: Buffer): Promise<string> {
  const { items } = await pdfTextItems(buf);
  return groupLines(items).map((l) => l.items.map((i) => i.str).join(' ')).join('\n');
}

interface Line { page: number; y: number; items: TextItem[] }

function groupLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || a.y - b.y || a.x0 - b.x0);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    const tol = Math.max(2, Math.min(it.h, 12) * 0.45);
    if (last && last.page === it.page && Math.abs(it.y - last.y) <= tol) last.items.push(it);
    else lines.push({ page: it.page, y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x0 - b.x0);
  return lines;
}

const NUMERIC = /^[-(]?[₹]?\s*\d[\d,]*(\.\d+)?\)?%?$/;

/**
 * Rebuild a table from positioned text. Column edges come from the lines that carry figures (at least three numbers):
 * wherever no text on those lines covers a horizontal position, there is a gap between columns. Every text item on
 * every line is then placed in the column it overlaps most. Text that wraps inside a cell stays on its own row; the
 * import step joins such continuation rows to their item.
 */
export function itemsToMatrix(items: TextItem[]): (string | null)[][] {
  const lines = groupLines(items);
  const dataLines = lines.filter((l) => l.items.filter((i) => NUMERIC.test(i.str)).length >= 3);
  const source = dataLines.length >= 2 ? dataLines : lines;
  // Coverage per 1pt slot: how many of those lines have text there. Slots covered by only a few lines (a "TOTAL" label
  // running across columns, a stray note) still count as gaps, so they do not glue two columns together.
  const maxX = Math.ceil(Math.max(...source.flatMap((l) => l.items.map((i) => i.x1)), 0)) + 2;
  const cover = new Array<number>(maxX + 1).fill(0);
  for (const l of source) {
    const seen = new Uint8Array(maxX + 1);
    for (const i of l.items) for (let x = Math.max(0, Math.floor(i.x0)); x <= Math.min(maxX, Math.ceil(i.x1)); x++) seen[x] = 1;
    for (let x = 0; x <= maxX; x++) cover[x] += seen[x];
  }
  const threshold = source.length >= 8 ? Math.floor(source.length * 0.12) : 0;
  const cols: [number, number][] = [];
  for (let x = 0; x <= maxX; x++) {
    if (cover[x] <= threshold) continue;
    const last = cols[cols.length - 1];
    if (last && last[1] === x - 1) last[1] = x;
    else cols.push([x, x]);
  }
  if (cols.length === 0) return [];
  const colOf = (it: TextItem) => {
    let best = -1, bestOverlap = 0;
    cols.forEach(([a, b], i) => { const o = Math.min(b, it.x1) - Math.max(a, it.x0); if (o > bestOverlap) { bestOverlap = o; best = i; } });
    if (best >= 0) return best;
    const c = (it.x0 + it.x1) / 2;
    let d = Infinity;
    cols.forEach(([a, b], i) => { const dist = c < a ? a - c : c > b ? c - b : 0; if (dist < d) { d = dist; best = i; } });
    return best;
  };
  return lines.map((l) => {
    const row: (string | null)[] = Array(cols.length).fill(null);
    for (const it of l.items) {
      const c = colOf(it);
      row[c] = row[c] ? `${row[c]} ${it.str}` : it.str;
    }
    return row;
  });
}
