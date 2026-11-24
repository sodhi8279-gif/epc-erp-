import { memo, useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { UNIT_CODES } from '@epc/shared';
import { inr, unitLabel } from '../../lib/format';
import { Button, Input, cx } from '../ui';
import { computedAmount, type ImportField, type ImportRow, type Issue, type RowKind } from './importRows';

const KINDS: { value: RowKind; label: string }[] = [{ value: 'ITEM', label: 'Item' }, { value: 'HEADER', label: 'Heading' }, { value: 'SKIP', label: 'Skip' }];
type Filter = 'all' | 'errors' | 'warnings' | 'nounit' | 'ITEM' | 'HEADER' | 'SKIP';
const PAGE = 200;

const small = 'h-7 rounded-[3px] border border-rule bg-sheet px-1.5 text-[13px] focus:border-teal focus:outline-none';
const cell = 'h-7 rounded-[3px] border px-1.5 text-[13px] focus:border-teal focus:outline-none disabled:bg-transparent disabled:border-transparent';
const tone = (issues: Issue[], f: ImportField) => {
  const l = issues.filter((x) => x.field === f);
  return l.some((x) => x.level === 'error') ? 'border-red/70 bg-red-wash' : l.length ? 'border-amber/60 bg-amber-wash' : 'border-rule bg-sheet';
};

interface RowProps { r: ImportRow; i: number; issues: Issue[]; issuesKey: string; selected: boolean; readOnly: boolean; onChange: (i: number, patch: Partial<ImportRow>) => void; onToggle: (rowNo: number) => void }
const GridRow = memo(function GridRow({ r, i, issues, selected, readOnly, onChange, onToggle }: RowProps) {
  const item = r.kind === 'ITEM';
  const comp = item ? computedAmount(r) : null;
  return (
    <tr className={cx('border-b border-rule-soft align-top', r.kind === 'HEADER' && 'bg-paper', r.kind === 'SKIP' && 'text-ink-soft/60', selected && 'bg-teal-wash/60')}>
      <td className="px-2 py-1"><input type="checkbox" aria-label={`Select source row ${r.rowNo}`} checked={selected} onChange={() => onToggle(r.rowNo)} /></td>
      <td className="num px-2 py-1.5 text-xs text-ink-soft">{r.rowNo}</td>
      <td className="px-1 py-1">
        <select aria-label="Row kind" disabled={readOnly} value={r.kind} onChange={(e) => onChange(i, { kind: e.target.value as RowKind })} className={cx(cell, 'border-rule bg-sheet w-[88px]')}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </td>
      <td className="px-1 py-1"><input aria-label="Item no." disabled={readOnly || r.kind === 'SKIP'} value={r.itemNo} onChange={(e) => onChange(i, { itemNo: e.target.value })} className={cx(cell, r.kind !== 'SKIP' ? tone(issues, 'itemNo') : 'border-rule bg-sheet', 'w-[96px]', r.kind === 'HEADER' && 'font-semibold')} /></td>
      <td className="px-1 py-1">
        <textarea aria-label="Description" disabled={readOnly || r.kind === 'SKIP'} rows={r.kind === 'ITEM' ? 2 : 1} value={r.description} onChange={(e) => onChange(i, { description: e.target.value })}
          className={cx(cell, 'block h-auto w-[min(34ch,30vw)] min-w-[200px] resize-y py-0.5 leading-snug', item ? tone(issues, 'description') : 'border-rule bg-sheet', r.kind === 'HEADER' && 'font-semibold')} />
        {issues.length > 0 && <ul className="mt-1 w-[min(34ch,30vw)] min-w-[200px] space-y-0.5 text-xs">{issues.map((x, k) => <li key={k} className={x.level === 'error' ? 'text-red' : 'text-amber'}>{x.message}</li>)}</ul>}
      </td>
      <td className="px-1 py-1">
        {item && <>
          <select aria-label="Unit" disabled={readOnly} value={r.unit ?? ''} onChange={(e) => onChange(i, { unit: e.target.value || null, unitInferred: null })} className={cx(cell, tone(issues, 'unit'), 'w-[84px]')}>
            <option value="">—</option>
            {UNIT_CODES.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
          </select>
          {r.unitRaw && r.unitRaw !== r.unit && <div className="mt-0.5 max-w-[84px] truncate text-[11px] text-ink-soft" title={`In file: ${r.unitRaw}`}>File: {r.unitRaw}</div>}
        </>}
      </td>
      <td className="px-1 py-1">{item && <input aria-label="Quantity" inputMode="decimal" disabled={readOnly} value={r.quantity ?? ''} onChange={(e) => onChange(i, { quantity: e.target.value || null })} className={cx(cell, tone(issues, 'quantity'), 'w-[96px] text-right tabular-nums')} />}</td>
      <td className="px-1 py-1">{item && <input aria-label="Rate" inputMode="decimal" disabled={readOnly} value={r.rate ?? ''} onChange={(e) => onChange(i, { rate: e.target.value || null })} className={cx(cell, tone(issues, 'rate'), 'w-[110px] text-right tabular-nums')} />}</td>
      <td className={cx('num px-2 py-1.5', item && issues.some((x) => x.field === 'amount') && 'text-amber')}>{item ? (r.amount ? inr(r.amount) : '—') : ''}</td>
      <td className="num px-2 py-1.5 font-medium">{item ? inr(comp) : ''}</td>
    </tr>
  );
}, (a, b) => a.r === b.r && a.selected === b.selected && a.issuesKey === b.issuesKey && a.readOnly === b.readOnly && a.i === b.i);

/** Step 3: the extracted rows, editable, with live validation, filters and bulk actions. */
export function ReviewGrid({ rows, setRows, issues, readOnly }: { rows: ImportRow[]; setRows: Dispatch<SetStateAction<ImportRow[]>>; issues: Issue[][]; readOnly?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [bulkUnit, setBulkUnit] = useState('');
  const [bulkKind, setBulkKind] = useState<RowKind>('SKIP');
  const [rawMap, setRawMap] = useState<Record<string, string>>({});

  const onChange = useCallback((i: number, patch: Partial<ImportRow>) => setRows((rs) => { const n = rs.slice(); n[i] = { ...n[i], ...patch }; return n; }), [setRows]);
  const onToggle = useCallback((rowNo: number) => setSel((s) => { const n = new Set(s); if (n.has(rowNo)) n.delete(rowNo); else n.add(rowNo); return n; }), []);
  const issueKeys = useMemo(() => issues.map((l) => l.map((x) => x.level[0] + (x.field ?? '') + x.message).join('|')), [issues]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: number[] = [];
    rows.forEach((r, i) => {
      const iss = issues[i] ?? [];
      if (filter === 'errors' && !iss.some((x) => x.level === 'error')) return;
      if (filter === 'warnings' && !iss.some((x) => x.level === 'warning')) return;
      if (filter === 'nounit' && !(r.kind === 'ITEM' && !r.unit)) return;
      if ((filter === 'ITEM' || filter === 'HEADER' || filter === 'SKIP') && r.kind !== filter) return;
      if (needle && !(`${r.itemNo} ${r.description} ${r.unitRaw}`.toLowerCase().includes(needle))) return;
      out.push(i);
    });
    return out;
  }, [rows, issues, filter, q]);

  const unknownUnits = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.kind === 'ITEM' && !r.unit && r.unitRaw.trim()) m.set(r.unitRaw.trim(), (m.get(r.unitRaw.trim()) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const missingUnit = useMemo(() => rows.filter((r) => r.kind === 'ITEM' && !r.unit && !r.unitRaw.trim()).length, [rows]);
  const inferredUnit = useMemo(() => rows.filter((r) => r.kind === 'ITEM' && r.unit && r.unitInferred && !r.unitRaw.trim()).length, [rows]);

  const allVisibleSelected = visible.length > 0 && visible.every((i) => sel.has(rows[i].rowNo));
  const toggleAll = () => setSel((s) => { const n = new Set(s); if (allVisibleSelected) visible.forEach((i) => n.delete(rows[i].rowNo)); else visible.forEach((i) => n.add(rows[i].rowNo)); return n; });
  const applyToSelected = (patch: Partial<ImportRow>) => setRows((rs) => rs.map((r) => (sel.has(r.rowNo) ? { ...r, ...patch } : r)));
  const selectedItems = rows.filter((r) => sel.has(r.rowNo) && r.kind === 'ITEM').length;

  return (
    <div className="rounded-[4px] border border-rule bg-sheet">
      {!readOnly && (unknownUnits.length > 0 || missingUnit > 0 || inferredUnit > 0) && (
        <div className="border-b border-rule-soft px-4 py-3">
          <div className="text-[13px] font-medium">Units to resolve</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
            {inferredUnit > 0 && <span>{inferredUnit} items had no unit in the file; it was filled in from the description or the item above. <button type="button" className="text-teal underline" onClick={() => { setFilter('warnings'); setLimit(PAGE); }}>Check them</button>.</span>}
            {missingUnit > 0 && <span>{missingUnit} items have no unit in the file. <button type="button" className="text-teal underline" onClick={() => { setFilter('nounit'); setLimit(PAGE); }}>Show them</button>, select and set the unit in bulk.</span>}
            {unknownUnits.map(([raw, n]) => (
              <span key={raw} className="inline-flex items-center gap-1.5">
                <span>“{raw}” on {n} {n === 1 ? 'item' : 'items'}:</span>
                <select aria-label={`Unit for ${raw}`} value={rawMap[raw] ?? ''} onChange={(e) => setRawMap({ ...rawMap, [raw]: e.target.value })} className={cx(small, "w-[96px]")}>
                  <option value="">Choose…</option>
                  {UNIT_CODES.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                </select>
                <Button size="sm" disabled={!rawMap[raw]} onClick={() => setRows((rs) => rs.map((r) => (r.kind === 'ITEM' && !r.unit && r.unitRaw.trim() === raw ? { ...r, unit: rawMap[raw] } : r)))}>Apply</Button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2 border-b border-rule-soft px-4 py-3">
        <Input aria-label="Search rows" placeholder="Search item no., description or unit" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} className="h-8 w-full sm:w-[280px]" />
        <select aria-label="Show" value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setLimit(PAGE); }} className={cx(small, "h-8")}>
          <option value="all">All rows</option>
          <option value="errors">Rows with errors</option>
          <option value="warnings">Rows with warnings</option>
          <option value="nounit">Items without a unit</option>
          <option value="ITEM">Items only</option>
          <option value="HEADER">Headings only</option>
          <option value="SKIP">Skipped rows</option>
        </select>
        <span className="pb-1.5 text-[13px] text-ink-soft">{visible.length} of {rows.length} rows shown</span>
      </div>
      {!readOnly && (
        <div className={cx('flex flex-wrap items-center gap-2 border-b border-rule-soft px-4 py-2 text-[13px]', sel.size ? 'bg-teal-wash/50' : 'bg-paper')}>
          <span className="font-medium">{sel.size} selected{sel.size ? ` (${selectedItems} items)` : ''}</span>
          <span className="text-ink-soft">·</span>
          <select aria-label="Unit to set" value={bulkUnit} onChange={(e) => setBulkUnit(e.target.value)} className={cx(small, "w-[110px]")}>
            <option value="">Unit…</option>
            {UNIT_CODES.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
          </select>
          <Button size="sm" disabled={!sel.size || !bulkUnit} onClick={() => applyToSelected({ unit: bulkUnit, unitInferred: null })}>Set unit</Button>
          <select aria-label="Kind to set" value={bulkKind} onChange={(e) => setBulkKind(e.target.value as RowKind)} className={cx(small, "w-[100px]")}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <Button size="sm" disabled={!sel.size} onClick={() => applyToSelected({ kind: bulkKind })}>Set kind</Button>
          {sel.size > 0 && <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear selection</Button>}
        </div>
      )}
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-rule bg-paper text-left text-ink-soft">
              <th className="bg-paper px-2 py-2"><input type="checkbox" aria-label="Select all shown rows" checked={allVisibleSelected} onChange={toggleAll} /></th>
              <th className="bg-paper px-2 py-2 text-right font-medium">Row</th>
              <th className="bg-paper px-2 py-2 font-medium">Kind</th>
              <th className="bg-paper px-2 py-2 font-medium">Item no.</th>
              <th className="bg-paper px-2 py-2 font-medium">Description and issues</th>
              <th className="bg-paper px-2 py-2 font-medium">Unit</th>
              <th className="bg-paper px-2 py-2 text-right font-medium">Qty</th>
              <th className="bg-paper px-2 py-2 text-right font-medium">Rate</th>
              <th className="bg-paper px-2 py-2 text-right font-medium">Amount in file</th>
              <th className="bg-paper px-2 py-2 text-right font-medium">Computed amount</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-ink-soft">No rows match.</td></tr>}
            {visible.slice(0, limit).map((i) => (
              <GridRow key={rows[i].rowNo} r={rows[i]} i={i} issues={issues[i] ?? []} issuesKey={issueKeys[i] ?? ''} selected={sel.has(rows[i].rowNo)} readOnly={!!readOnly} onChange={onChange} onToggle={onToggle} />
            ))}
          </tbody>
        </table>
        {visible.length > limit && (
          <div className="flex items-center justify-center gap-2 border-t border-rule-soft px-4 py-3 text-[13px]">
            <span className="text-ink-soft">Showing {limit} of {visible.length}.</span>
            <Button size="sm" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, visible.length - limit)} more</Button>
            <Button size="sm" variant="ghost" onClick={() => setLimit(visible.length)}>Show all</Button>
          </div>
        )}
      </div>
    </div>
  );
}
