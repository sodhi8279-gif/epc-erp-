import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { D } from '@epc/shared';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { humanize, inr, num, unitLabel } from '../../lib/format';
import { Button, cx } from '../ui';

export const BASES: [string, string][] = [
  ['RECOVERABLE', 'Recoverable'],
  ['FREE_ISSUE', 'Free issue'],
  ['SUBCONTRACTOR_SUPPLIED', 'Subcontractor-supplied'],
  ['RETURNABLE', 'Returnable tools'],
  ['CONSUMABLE', 'Consumable'],
  ['SCRAP', 'Scrap'],
];
export const basisLabel = (b?: string | null) => (b ? BASES.find(([k]) => k === b)?.[1] ?? humanize(b) : '—');

export const CONDITIONS: [string, string, boolean][] = [
  ['GOOD', 'Good', true],
  ['EXCESS', 'Excess (unused)', true],
  ['DAMAGED', 'Damaged', false],
  ['REJECTED', 'Rejected', false],
  ['SCRAP', 'Scrap', false],
];
export const conditionLabel = (c?: string | null) => (c ? CONDITIONS.find(([k]) => k === c)?.[1] ?? humanize(c) : '—');

export const CATEGORIES = ['CEMENT', 'STEEL', 'STRUCTURAL_STEEL', 'PIPE', 'FITTING', 'VALVE', 'ELECTRODE', 'FASTENER', 'AGGREGATE', 'SAND', 'ADMIXTURE', 'CONSUMABLE', 'TOOL', 'OTHER'];

export interface Material { id: string; code: string; name: string; category: string; unit: string; altUnit: string | null; altFactor: string | null; defaultBasis: string; standardRate: string; batchTracked: boolean; active: boolean }

/** Company materials, stores, subcontractors and work orders: the pickers every material screen needs. */
export function useMaterialData(projectId: string | undefined, companyId: string | undefined) {
  const materials = useApi<Material[]>(companyId ? `/companies/${companyId}/materials` : null).data;
  const stores = useApi<any[]>(projectId ? `/projects/${projectId}/stores` : null).data;
  const subs = useApi<any[]>(companyId ? `/companies/${companyId}/subcontractors` : null).data;
  const wos = useApi<any[]>(projectId ? `/projects/${projectId}/work-orders` : null).data;
  const matById = (id?: string | null) => materials?.find((m) => m.id === id);
  return { materials, stores, subs, wos, matById };
}

/** Activities on all contracts of the project (for norm and issue pickers). */
export function useProjectActivities(projectId: string) {
  return useQuery<any[]>({
    queryKey: ['project-activities', projectId],
    queryFn: async () => {
      const contracts = await api.get<any[]>(`/projects/${projectId}/contracts`);
      const lists = await Promise.all(contracts.map((c) => api.get<any[]>(`/contracts/${c.id}/activities`).then((acts) => acts.map((a) => ({ ...a, contractNo: c.contractNo })))));
      return lists.flat();
    },
    enabled: !!projectId,
  }).data;
}

/** Quantity in the secondary unit, e.g. bags → kg. */
export function altQty(m: Pick<Material, 'altUnit' | 'altFactor'> | undefined, q: unknown): string | null {
  if (!m?.altUnit || !m.altFactor || q === null || q === undefined || q === '') return null;
  try { return D(q as string).times(m.altFactor).toString(); } catch { return null; }
}

/** Quantity with unit, and the secondary-unit equivalent under it when the material has one. */
export function Qty({ m, q, unit, alt, inline, className }: { m?: Pick<Material, 'unit' | 'altUnit' | 'altFactor'>; q: unknown; unit?: string; alt?: string | null; inline?: boolean; className?: string }) {
  const u = unit ?? m?.unit;
  const a = alt !== undefined ? alt : altQty(m, q);
  return (
    <span className={cx('num', className)}>
      {num(q)} <span className="text-ink-soft">{u ? unitLabel(u) : ''}</span>
      {a !== null && m?.altUnit && (inline ? <span className="text-ink-soft"> ({num(a)} {unitLabel(m.altUnit)})</span> : <span className="block text-xs text-ink-soft">{num(a)} {unitLabel(m.altUnit)}</span>)}
    </span>
  );
}

/** Money with a proper minus sign for outflows. */
export const signedInr = (v: unknown) => { const d = D((v ?? 0) as string); return d.isNegative() ? `−${inr(d.abs().toString())}` : inr(v); };

export const matLabel = (m?: Pick<Material, 'code' | 'name'> | null) => (m ? `${m.code} · ${m.name}` : '—');

/**
 * Editable line grid used by receipts, requisitions, issues, returns and transfers.
 * Each column renders its own control for a line; rows can be added and removed.
 */
export interface LineCol<L> { header: ReactNode; cell: (line: L, set: (patch: Partial<L>) => void, i: number) => ReactNode; width?: string; align?: 'right' }
export function LineEditor<L>({ lines, onChange, blank, cols, addLabel = 'Add line' }: { lines: L[]; onChange: (l: L[]) => void; blank: () => L; cols: LineCol<L>[]; addLabel?: string }) {
  const set = (i: number) => (patch: Partial<L>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div>
      <div className="overflow-x-auto rounded-[3px] border border-rule">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-rule bg-paper text-left text-ink-soft">
              {cols.map((c, i) => <th key={i} style={{ minWidth: c.width }} className={cx('px-2 py-1.5 font-medium', c.align === 'right' && 'text-right')}>{c.header}</th>)}
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-rule-soft align-top last:border-0">
                {cols.map((c, j) => <td key={j} className="px-2 py-1.5">{c.cell(l, set(i), i)}</td>)}
                <td className="px-1 py-1.5 text-center">
                  <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, j) => j !== i))} className="mt-2 text-ink-soft hover:text-red disabled:opacity-30"><Trash2 className="size-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => onChange([...lines, blank()])}><Plus className="size-3.5" /> {addLabel}</Button>
    </div>
  );
}

/** Material picker grouped by category. */
export function MaterialOptions({ materials, filter, emptyLabel = 'Select material' }: { materials: Material[] | undefined; filter?: (m: Material) => boolean; emptyLabel?: string }) {
  const list = (materials ?? []).filter((m) => m.active && (!filter || filter(m)));
  const cats = [...new Set(list.map((m) => m.category))];
  return (
    <>
      <option value="">{emptyLabel}</option>
      {cats.map((c) => <optgroup key={c} label={humanize(c)}>{list.filter((m) => m.category === c).map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name} ({unitLabel(m.unit)})</option>)}</optgroup>)}
    </>
  );
}

/**
 * Print only this block. A print stylesheet hides the rest of the app while `active`;
 * the block itself stays visible on screen as the print preview.
 */
export function PrintArea({ children }: { children: ReactNode }) {
  return (
    <div className="mat-print-area">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body * { visibility: hidden !important; }
          .mat-print-area, .mat-print-area * { visibility: visible !important; }
          .mat-print-area { position: absolute; left: 0; top: 0; width: 100%; background: #fff; color: #000; font-size: 11pt; }
          .mat-print-area .no-print { display: none !important; }
          .mat-print-area section { border-color: #999 !important; break-inside: avoid; }
          .mat-print-area table { font-size: 9.5pt; }
        }
      `}</style>
      {children}
    </div>
  );
}
export function PrintButton({ label = 'Print' }: { label?: string }) {
  return <Button className="no-print" onClick={() => window.print()}><Printer className="size-4" /> {label}</Button>;
}

/** Scroll to top when a view switches (print previews, detail panes). */
export function useScrollTop(dep: unknown) {
  useEffect(() => { window.scrollTo({ top: 0 }); }, [dep]);
}

export function SignatureBlock({ label, name, sub }: { label: string; name?: string | null; sub?: string }) {
  return (
    <div className="min-w-0 pt-10">
      <div className="border-t border-ink pt-1.5 text-[13px]">
        <div className="font-medium">{label}</div>
        <div className="text-ink-soft">Name: {name || '______________________'}</div>
        {sub && <div className="text-ink-soft">{sub}</div>}
        <div className="text-ink-soft">Date: ______________</div>
      </div>
    </div>
  );
}
