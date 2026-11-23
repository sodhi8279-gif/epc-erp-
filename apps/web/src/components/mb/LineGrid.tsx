import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { barUnitWeight, computeLine, D, Decimal, type MeasurementType } from '@epc/shared';
import { num, unitLabel } from '../../lib/format';
import { Button, cx } from '../ui';

export interface LineDraft {
  key: string; description: string; nos: string; length: string; breadth: string; depth: string; chainageFrom: string; chainageTo: string;
  barDia: string; cuttingLength: string; unitWeight: string; directQty: string; isDeduction: boolean;
}
let seq = 0;
export const blankLine = (): LineDraft => ({ key: `l${++seq}`, description: '', nos: '', length: '', breadth: '', depth: '', chainageFrom: '', chainageTo: '', barDia: '', cuttingLength: '', unitWeight: '', directQty: '', isDeduction: false });
export const lineFromApi = (l: any): LineDraft => {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return { key: `l${++seq}`, description: s(l.description), nos: s(l.nos), length: s(l.length), breadth: s(l.breadth), depth: s(l.depth), chainageFrom: s(l.chainageFrom), chainageTo: s(l.chainageTo), barDia: s(l.barDia), cuttingLength: s(l.cuttingLength), unitWeight: s(l.unitWeight), directQty: s(l.directQty), isDeduction: !!l.isDeduction };
};
/** Only the fields that matter for this type are sent; blanks are omitted. */
export const lineToApi = (type: MeasurementType, l: LineDraft) => {
  const keep = (k: keyof LineDraft) => FIELDS[type].some((c) => c.k === k) || k === 'directQty';
  const out: Record<string, unknown> = { description: l.description || null, isDeduction: l.isDeduction };
  for (const k of ['nos', 'length', 'breadth', 'depth', 'chainageFrom', 'chainageTo', 'barDia', 'cuttingLength', 'unitWeight', 'directQty'] as const) if (keep(k) && l[k].trim() !== '') out[k] = l[k].trim();
  return out;
};

type Col = { k: keyof LineDraft; label: string; w: string; hint?: string };
export const FIELDS: Record<MeasurementType, Col[]> = {
  PIPELINE: [{ k: 'nos', label: 'Nos', w: '64px' }, { k: 'chainageFrom', label: 'Ch. from (m)', w: '104px' }, { k: 'chainageTo', label: 'Ch. to (m)', w: '104px' }, { k: 'length', label: 'or length (m)', w: '96px', hint: 'Used when chainages are blank' }],
  EXCAVATION: [{ k: 'nos', label: 'Nos', w: '64px' }, { k: 'length', label: 'L (m)', w: '88px' }, { k: 'breadth', label: 'B (m)', w: '88px' }, { k: 'depth', label: 'D (m)', w: '88px' }],
  RCC: [{ k: 'nos', label: 'Nos', w: '64px' }, { k: 'length', label: 'L (m)', w: '88px' }, { k: 'breadth', label: 'B (m)', w: '88px' }, { k: 'depth', label: 'D / H (m)', w: '88px' }],
  GENERIC: [{ k: 'nos', label: 'Nos', w: '64px' }, { k: 'length', label: 'L (m)', w: '88px' }, { k: 'breadth', label: 'B (m)', w: '88px' }, { k: 'depth', label: 'D / H (m)', w: '88px' }],
  REBAR: [{ k: 'barDia', label: 'Dia (mm)', w: '72px' }, { k: 'nos', label: 'Nos', w: '64px' }, { k: 'cuttingLength', label: 'Cut length (m)', w: '100px' }, { k: 'unitWeight', label: 'Unit wt (kg/m)', w: '100px', hint: 'Blank = d²/162' }],
};

export function computeDraft(type: MeasurementType, l: LineDraft, unit?: string): { quantity?: Decimal; formula?: string; error?: string; empty?: boolean } {
  const input = lineToApi(type, l) as any;
  const filled = Object.keys(input).some((k) => !['description', 'isDeduction'].includes(k));
  if (!filled) return { empty: true };
  try {
    for (const k of Object.keys(input)) if (!['description', 'isDeduction'].includes(k)) { const d = D(input[k]); if (!d.isFinite()) throw new Error(); }
  } catch { return { error: 'Enter numbers only' }; }
  try {
    if (type === 'PIPELINE' && !input.directQty && !(input.chainageFrom && input.chainageTo) && !input.length) return { error: 'Give both chainages or a length' };
    if (type === 'REBAR' && !input.directQty && !input.cuttingLength) return { error: 'Cutting length is required' };
    const r = computeLine(type, input, unit);
    return { quantity: r.quantity, formula: r.formula };
  } catch (e) { return { error: (e as Error).message }; }
}

/**
 * Measurement line grid. Keyboard: Enter moves to a new line (adds one at the end), Tab moves across,
 * Ctrl/Cmd+Backspace on an empty line removes it.
 */
export function LineGrid({ type, unit, lines, onChange }: { type: MeasurementType; unit?: string; lines: LineDraft[]; onChange: (l: LineDraft[]) => void }) {
  const cols = FIELDS[type];
  const wrap = useRef<HTMLDivElement>(null);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  useEffect(() => {
    if (focusRow === null) return;
    wrap.current?.querySelector<HTMLInputElement>(`[data-row="${focusRow}"][data-col="0"]`)?.focus();
    setFocusRow(null);
  }, [focusRow, lines.length]);

  const upd = (i: number, patch: Partial<LineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const add = (after: number) => { const n = [...lines]; n.splice(after + 1, 0, blankLine()); onChange(n); setFocusRow(after + 1); };
  const remove = (i: number) => { const n = lines.filter((_, j) => j !== i); onChange(n.length ? n : [blankLine()]); setFocusRow(Math.max(0, i - 1)); };
  const onKey = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (i === lines.length - 1) add(i); else setFocusRow(i + 1);
    } else if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey) && lines.length > 1) { e.preventDefault(); remove(i); }
    else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); setFocusRow(Math.min(lines.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); setFocusRow(Math.max(0, i - 1)); }
  };
  const computed = lines.map((l) => computeDraft(type, l, unit));
  const total = computed.reduce((s, c) => (c.quantity ? s.plus(c.quantity) : s), new Decimal(0));
  const cell = 'h-8 w-full rounded-[3px] border border-transparent bg-transparent px-1.5 text-right tabular-nums hover:border-rule focus:border-teal focus:bg-sheet focus:outline-none';
  const uw = (l: LineDraft) => { try { return l.barDia ? barUnitWeight(l.barDia).toDecimalPlaces(3).toString() : ''; } catch { return ''; } };

  return (
    <div ref={wrap}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-rule bg-paper text-left text-ink-soft">
              <th className="w-8 px-2 py-2 font-medium">#</th>
              <th className="min-w-[240px] px-2 py-2 font-medium">Description</th>
              {cols.map((c) => <th key={c.k} style={{ width: c.w, minWidth: c.w }} className="px-2 py-2 text-right font-medium" title={c.hint}>{c.label}</th>)}
              <th style={{ width: '96px', minWidth: '96px' }} className="px-2 py-2 text-right font-medium" title="Overrides the computed quantity (lump sum / counted items)">Direct qty</th>
              <th className="w-14 px-2 py-2 text-center font-medium" title="Deduction lines are subtracted">Deduct</th>
              <th className="min-w-[200px] px-2 py-2 font-medium">Formula</th>
              <th className="min-w-[110px] px-2 py-2 text-right font-medium">Quantity</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const c = computed[i];
              return (
                <tr key={l.key} className={cx('border-b border-rule-soft align-middle', l.isDeduction && 'bg-amber-wash/40')}>
                  <td className="px-2 text-ink-soft tabular-nums">{i + 1}</td>
                  <td className="px-1"><input data-row={i} data-col={0} className={cx(cell, 'text-left')} value={l.description} onChange={(e) => upd(i, { description: e.target.value })} onKeyDown={onKey(i)} placeholder={type === 'PIPELINE' ? 'e.g. DI K9 300 mm laid & jointed' : type === 'REBAR' ? 'e.g. Footing F1 bottom mesh' : 'e.g. Trench Ch 0–60'} aria-label={`Line ${i + 1} description`} /></td>
                  {cols.map((col, ci) => (
                    <td key={col.k} className="px-1">
                      <input data-row={i} data-col={ci + 1} inputMode="decimal" className={cell} value={l[col.k] as string} onChange={(e) => upd(i, { [col.k]: e.target.value })} onKeyDown={onKey(i)}
                        placeholder={col.k === 'nos' ? '1' : col.k === 'unitWeight' ? uw(l) : ''} aria-label={`Line ${i + 1} ${col.label}`} />
                    </td>
                  ))}
                  <td className="px-1"><input inputMode="decimal" className={cell} value={l.directQty} onChange={(e) => upd(i, { directQty: e.target.value })} onKeyDown={onKey(i)} aria-label={`Line ${i + 1} direct quantity`} /></td>
                  <td className="text-center"><input type="checkbox" className="size-4 accent-[#0f6e6a]" checked={l.isDeduction} onChange={(e) => upd(i, { isDeduction: e.target.checked })} aria-label={`Line ${i + 1} is a deduction`} /></td>
                  <td className="px-2 text-ink-soft">{c.error ? <span className="text-red">{c.error}</span> : c.formula ? <span className="font-mono text-[12px]">{c.formula}</span> : ''}</td>
                  <td className={cx('num px-2 font-medium', c.quantity?.isNegative() && 'text-red')}>{c.quantity ? num(c.quantity.toString()) : ''}</td>
                  <td className="px-1"><button type="button" onClick={() => remove(i)} className="p-1 text-ink-soft hover:text-red" aria-label={`Remove line ${i + 1}`} tabIndex={-1}><Trash2 className="size-4" /></button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-rule bg-paper font-semibold">
            <tr>
              <td colSpan={cols.length + 5} className="px-2 py-2">Total {unit ? `(${unitLabel(unit)})` : ''}</td>
              <td className={cx('num px-2 py-2', total.isNegative() && 'text-red')}>{num(total.toString())}{unit ? ` ${unitLabel(unit)}` : ''}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" onClick={() => add(lines.length - 1)}><Plus className="size-3.5" /> Add line</Button>
        <span className="text-xs text-ink-soft">Enter adds a line · Tab moves across · Ctrl+Backspace removes the line · Blank dimensions count as 1{type === 'REBAR' ? ' · Unit weight defaults to d²/162 kg/m' : ''}</span>
      </div>
    </div>
  );
}
