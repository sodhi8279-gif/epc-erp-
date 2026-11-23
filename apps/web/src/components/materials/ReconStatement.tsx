import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { D } from '@epc/shared';
import { inr, num, unitLabel } from '../../lib/format';
import { cx, Input } from '../ui';
import { basisLabel } from './common';

export interface ReconLine {
  materialId: string; materialCode: string; materialName: string; unit: string; altUnit: string | null; altFactor: string | null; basis: string; openingBasis: string;
  opening: string; issued: string; returned: string; netIssued: string; available: string; theoretical: string; permissibleWastage: string; allowable: string;
  closingStock: string; actualConsumption: string; difference: string; excess: string; underConsumption: string;
  excessRecovery: string; balanceRecovery: string; totalRecoverable: string; closingValue: string;
  wastagePercent: string; recoveryRate: string; issueRate: string; damagedReturned: string; damageRecovery: string; closingStockEntered: string | null;
  theoreticalBreakdown: { activity: string; workQty: string; workUnit: string; norm: string; wastagePercent: string; theoretical: string; wastage: string; basis: string }[];
  flags: string[];
}

/** Editable inputs for one material (only on the prepare screen). */
export interface LineInputs { closing: string; penal: string; setClosing: (v: string) => void; setPenal: (v: string) => void }

/** The A–J reconciliation ladder for each material, with excess (recovered now) kept visibly apart from the balance carried forward. */
export function ReconStatement({ lines, isFinal, inputs }: { lines: ReconLine[]; isFinal: boolean; inputs?: (materialId: string) => LineInputs }) {
  if (!lines.length) return <p className="text-ink-soft">No recoverable or free-issue material was issued to this subcontractor, and no approved norm applies to its work. Subcontractor-supplied and returnable items are not reconciled here.</p>;
  return <div className="space-y-5">{lines.map((l) => <MaterialLadder key={l.materialId} l={l} isFinal={isFinal} inputs={inputs?.(l.materialId)} />)}</div>;
}

function MaterialLadder({ l, isFinal, inputs }: { l: ReconLine; isFinal: boolean; inputs?: LineInputs }) {
  const hasAlt = !!(l.altUnit && l.altFactor);
  const alt = (v: string) => (hasAlt ? D(v).times(l.altFactor!).toDecimalPlaces(3).toString() : null);
  const u = unitLabel(l.unit), au = l.altUnit ? unitLabel(l.altUnit) : '';
  const Q = ({ v, strong, tone }: { v: string; strong?: boolean; tone?: string }) => (
    <>
      <td className={cx('num px-3 py-1.5', strong && 'font-semibold', tone)}>{num(v)} <span className="text-ink-soft">{u}</span></td>
      {hasAlt && <td className={cx('num px-3 py-1.5', strong && 'font-semibold', tone)}>{num(alt(v))} <span className="text-ink-soft">{au}</span></td>}
    </>
  );
  const Row = ({ k, label, note, v, strong, tone, sub, extra }: { k?: string; label: ReactNode; note?: ReactNode; v: string; strong?: boolean; tone?: string; sub?: boolean; extra?: ReactNode }) => (
    <tr className={cx('border-b border-rule-soft align-top', strong && 'bg-paper')}>
      <td className={cx('w-8 px-3 py-1.5 font-display font-semibold', sub ? 'text-ink-soft' : 'text-teal-deep')}>{k}</td>
      <td className={cx('px-3 py-1.5', sub && 'text-ink-soft', strong && 'font-semibold')}>{label}{note && <div className="text-xs font-normal text-ink-soft">{note}</div>}</td>
      <Q v={v} strong={strong} tone={tone} />
      <td className="px-3 py-1.5 text-xs text-ink-soft">{extra}</td>
    </tr>
  );
  const excess = D(l.excess), closing = D(l.closingStock), diff = D(l.difference);
  const damage = D(l.damageRecovery);
  const closingEntered = l.closingStockEntered !== null && l.closingStockEntered !== '';

  return (
    <section className="rounded-[4px] border border-rule bg-sheet">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule px-4 py-2.5">
        <h3 className="text-[15px] font-semibold">{l.materialCode} · {l.materialName}</h3>
        <span className="text-xs text-ink-soft">{basisLabel(l.basis)} · issue rate {inr(l.issueRate)} / {u} · recovery rate {inr(l.recoveryRate)} / {u}{hasAlt ? ` · 1 ${u} = ${num(l.altFactor)} ${au}` : ''}</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-rule bg-paper text-left text-ink-soft">
              <th className="px-3 py-1.5" /><th className="px-3 py-1.5 font-medium">Step</th>
              <th className="px-3 py-1.5 text-right font-medium">Quantity ({u})</th>
              {hasAlt && <th className="px-3 py-1.5 text-right font-medium">Quantity ({au})</th>}
              <th className="px-3 py-1.5 font-medium">How it is worked out</th>
            </tr>
          </thead>
          <tbody>
            <Row k="A" label="Opening balance with subcontractor" note={l.openingBasis} v={l.opening} />
            <Row k="B" label="Issued during the period" v={l.issued} />
            <Row k="C" label="Returned during the period" note={D(l.damagedReturned).gt(0) ? `includes ${num(l.damagedReturned)} ${u} returned damaged` : undefined} v={l.returned} />
            <Row k="D" label="Net issued" v={l.netIssued} strong extra="B − C" />
            <Row label="Available with subcontractor" v={l.available} sub extra="A + D" />
            <Row k="E" label="Theoretical consumption" note="Approved measured work × approved norm" v={l.theoretical} strong extra={l.theoreticalBreakdown.length ? 'Σ by activity, below' : 'No approved norm for the work done'} />
            {l.theoreticalBreakdown.map((p, i) => (
              <tr key={i} className="border-b border-rule-soft align-top text-ink-soft">
                <td />
                <td className="py-1.5 pl-6 pr-3"><span className="text-ink">{p.activity}</span><div className="text-xs">{num(p.workQty)} {unitLabel(p.workUnit)} approved × {p.norm.replace(/(\w+)\/(\w+)$/, (_, a, b) => `${unitLabel(a)} per ${unitLabel(b)}`)}{D(p.wastagePercent).gt(0) ? ` · ${num(p.wastagePercent)}% wastage` : ''}</div></td>
                <td className="num px-3 py-1.5">{num(p.theoretical)} {u}</td>
                {hasAlt && <td className="num px-3 py-1.5">{num(alt(p.theoretical))} {au}</td>}
                <td className="px-3 py-1.5 text-xs">{p.basis}</td>
              </tr>
            ))}
            <tr className="border-b border-rule-soft bg-paper align-top">
              <td className="px-3 py-1.5 font-display font-semibold text-teal-deep">F</td>
              <td className="px-3 py-1.5 font-semibold">Actual consumption<div className="text-xs font-normal text-ink-soft">Available less verified closing stock (J)</div></td>
              <Q v={l.actualConsumption} strong />
              <td className="px-3 py-1.5 text-xs text-ink-soft">A + D − J{!closingEntered && ' (no stock count: all treated as consumed)'}</td>
            </tr>
            <Row label="Difference from theoretical" v={l.difference} sub tone={diff.gt(0) ? 'text-amber' : undefined} extra="F − E" />
            <Row k="G" label="Permissible wastage" v={l.permissibleWastage} extra={`E × ${num(l.wastagePercent)}%`} />
            <Row label="Allowable consumption" v={l.allowable} sub extra="E + G" />
            <Row k="H" label="Excess consumption" v={l.excess} strong tone={excess.gt(0) ? 'text-red' : undefined} extra="F − (E + G), if more than zero" />
            <tr className="border-b border-rule-soft bg-paper align-top">
              <td className="px-3 py-1.5 font-display font-semibold text-teal-deep">I</td>
              <td className="px-3 py-1.5 font-semibold">Recoverable now</td>
              <td colSpan={hasAlt ? 2 : 1} className="num px-3 py-1.5 font-semibold">{inr(l.totalRecoverable)}</td>
              <td className="px-3 py-1.5 text-xs text-ink-soft">
                H × {inr(l.recoveryRate)} = {inr(l.excessRecovery)}
                {D(l.balanceRecovery).gt(0) && <> + final balance {inr(l.balanceRecovery)}</>}
                {damage.gt(0) && <> + damaged returns {inr(l.damageRecovery)}</>}
              </td>
            </tr>
            <tr className="align-top">
              <td className="px-3 py-1.5 font-display font-semibold text-teal-deep">J</td>
              <td className="px-3 py-1.5 font-semibold">Closing balance with subcontractor<div className="text-xs font-normal text-ink-soft">Physically verified stock still held</div>
                {inputs && (
                  <div className="mt-2 grid max-w-md gap-2 sm:grid-cols-2">
                    <label className="text-xs text-ink-soft">Verified closing stock ({u})<Input inputMode="decimal" value={inputs.closing} placeholder="Not counted" onChange={(e) => inputs.setClosing(e.target.value)} className="mt-0.5" />{hasAlt && inputs.closing && <span className="mt-0.5 block text-right">= {num(alt(inputs.closing || '0'))} {au}</span>}</label>
                    <label className="text-xs text-ink-soft">Penal recovery rate (₹ / {u})<Input inputMode="decimal" value={inputs.penal} placeholder={num(l.recoveryRate, 2)} onChange={(e) => inputs.setPenal(e.target.value)} className="mt-0.5" /><span className="mt-0.5 block">Blank = rate on the issue vouchers</span></label>
                  </div>
                )}
              </td>
              <Q v={l.closingStock} strong />
              <td className="px-3 py-1.5 text-xs text-ink-soft">Valued {inr(l.closingValue)} at issue rate</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 border-t border-rule p-4 md:grid-cols-2">
        <div className={cx('rounded-[3px] border-l-4 px-3 py-2.5', excess.gt(0) ? 'border-red bg-red-wash' : 'border-rule bg-paper')}>
          <div className="text-xs font-medium text-ink-soft">Excess consumption · recovered in this reconciliation</div>
          <div className="mt-0.5 text-[17px] font-semibold tabular-nums">{num(l.excess)} {u}{hasAlt && <span className="text-[13px] font-normal text-ink-soft"> ({num(alt(l.excess))} {au})</span>} · {inr(l.excessRecovery)}</div>
          <p className="mt-1 text-xs text-ink-soft">Material consumed beyond the norm and permissible wastage. It is gone, so it is deducted from the subcontractor's bill now.</p>
        </div>
        <div className={cx('rounded-[3px] border-l-4 px-3 py-2.5', isFinal && closing.gt(0) ? 'border-red bg-red-wash' : 'border-teal bg-teal-wash')}>
          <div className="text-xs font-medium text-ink-soft">{isFinal ? 'Unreturned balance · recovered on final reconciliation' : 'Unconsumed balance · carried forward, not recovered now'}</div>
          <div className="mt-0.5 text-[17px] font-semibold tabular-nums">{num(l.closingStock)} {u}{hasAlt && <span className="text-[13px] font-normal text-ink-soft"> ({num(alt(l.closingStock))} {au})</span>} · {inr(isFinal ? l.balanceRecovery : l.closingValue)}</div>
          <p className="mt-1 text-xs text-ink-soft">{isFinal ? 'Work is complete: material still held and not returned is recovered at the issue rate.' : 'Material still with the subcontractor for future work. It becomes the opening balance (A) of the next reconciliation and is recovered only on final reconciliation or if not returned.'}</p>
        </div>
      </div>

      {l.flags.length > 0 && (
        <ul className="space-y-1 border-t border-rule-soft px-4 py-2.5 text-[13px]">
          {l.flags.map((f, i) => <li key={i} className="flex gap-2 text-amber"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><span className="text-ink">{f}</span></li>)}
        </ul>
      )}
    </section>
  );
}
