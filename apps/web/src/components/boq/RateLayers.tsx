import { D } from '@epc/shared';
import { inr, num, unitLabel } from '../../lib/format';
import { Sheet, Status, Table, Tag, cx } from '../ui';

const signed = (v: unknown) => {
  const d = D(v as string);
  return <span className={cx('num', d.lt(0) ? 'text-red font-semibold' : d.gt(0) ? 'text-green' : '')}>{inr(v)}</span>;
};

/**
 * Rate layers of one BOQ item: client rate → internal budget allocation per activity → each subcontractor's
 * agreed rate → margin per unit, planned margin on the work order quantity and margin on approved quantity.
 */
export function RateLayers({ item, activities }: { item: any; activities: any[] }) {
  if (!activities.length) return null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {activities.map((a) => {
        const c = a.calc;
        const budget = D(c.budgetRatePerActivityUnit);
        const unit = unitLabel(a.unit);
        const rows = a.contracts as any[];
        const tot = rows.reduce((s, r) => ({ planned: s.planned.plus(r.plannedMargin), cost: s.cost.plus(r.actualCost), earned: s.earned.plus(r.earnedBudget), margin: s.margin.plus(r.marginOnApproved), qty: s.qty.plus(r.quantity), approved: s.approved.plus(r.approvedQty) }), { planned: D(0), cost: D(0), earned: D(0), margin: D(0), qty: D(0), approved: D(0) });
        const max = rows.reduce((m, r) => (D(r.rate).gt(m) ? D(r.rate) : m), budget);
        const pctOf = (v: unknown) => (max.gt(0) ? Math.max(0, Math.min(100, D(v as string).div(max).times(100).toNumber())) : 0);
        return (
          <Sheet key={a.id} flush title={<span>{a.code} · {a.name}</span>}
            actions={<span className="text-[13px] text-ink-soft">Scope {num(c.scopeQuantity)} {unit} · {num(c.share, 2)}% of client rate</span>}>
            <div className="grid gap-4 border-b border-rule-soft px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
                <div><dt className="text-xs text-ink-soft">Client rate</dt><dd className="tabular-nums font-medium">{inr(item.rate)} / {unitLabel(item.unit)}</dd></div>
                <div><dt className="text-xs text-ink-soft">Allocated from client rate</dt><dd className="tabular-nums font-medium">{inr(c.allocatedRatePerParentUnit)} / {unitLabel(item.unit)}</dd></div>
                <div><dt className="text-xs text-ink-soft">Budget rate (client allocation)</dt><dd className="tabular-nums text-[15px] font-semibold">{inr(c.budgetRatePerActivityUnit)} / {unit}</dd></div>
                <div><dt className="text-xs text-ink-soft">Budget amount</dt><dd className="tabular-nums font-medium">{inr(c.budgetAmount)}</dd></div>
              </dl>
              <div className="space-y-1.5 text-xs" aria-label="Budget rate against subcontract rates">
                <div className="grid grid-cols-[120px_1fr_96px] items-center gap-2">
                  <span className="truncate font-medium">Budget</span>
                  <div className="h-3 bg-rule-soft"><div className="h-full bg-teal" style={{ width: `${pctOf(budget)}%` }} /></div>
                  <span className="num font-medium">{inr(budget)}</span>
                </div>
                {rows.map((r) => (
                  <div key={r.workOrderItemId} className="grid grid-cols-[120px_1fr_96px] items-center gap-2">
                    <span className="truncate" title={r.subcontractor.name}>{r.subcontractor.name}</span>
                    <div className="relative h-3 bg-rule-soft">
                      <div className={cx('h-full', D(r.rate).gt(budget) ? 'bg-red' : 'bg-[#6c9aa3]')} style={{ width: `${pctOf(r.rate)}%` }} />
                      <div className="absolute inset-y-[-2px] w-px bg-ink" style={{ left: `${pctOf(budget)}%` }} title="Budget rate" />
                    </div>
                    <span className="num">{inr(r.rate)}</span>
                  </div>
                ))}
                {rows.length === 0 && <p className="text-ink-soft">No approved work order for this activity yet.</p>}
              </div>
            </div>
            {rows.length > 0 && (
              <Table rows={rows} rowKey={(r: any) => r.workOrderItemId}
                cols={[
                  { key: 'wo', header: 'Work order', cell: (r: any) => <div><div className="font-medium">{r.workOrder}</div><div className="text-xs text-ink-soft">{r.subcontractor.name}</div></div> },
                  { key: 'b', header: `Budget / ${unit}`, align: 'right', cell: () => inr(c.budgetRatePerActivityUnit) },
                  { key: 'r', header: `Agreed rate / ${unit}`, align: 'right', cell: (r: any) => inr(r.rate) },
                  { key: 'm', header: 'Margin / unit', align: 'right', cell: (r: any) => <span>{signed(r.marginPerUnit)}{budget.gt(0) && <span className="block text-xs text-ink-soft">{num(D(r.marginPerUnit).div(budget).times(100).toFixed(1), 1)}%</span>}</span> },
                  { key: 'q', header: 'WO qty', align: 'right', cell: (r: any) => num(r.quantity) },
                  { key: 'pm', header: 'Planned margin', align: 'right', cell: (r: any) => signed(r.plannedMargin) },
                  { key: 'aq', header: 'Approved qty', align: 'right', cell: (r: any) => num(r.approvedQty) },
                  { key: 'ac', header: 'Actual cost', align: 'right', cell: (r: any) => inr(r.actualCost) },
                  { key: 'eb', header: 'Earned budget', align: 'right', cell: (r: any) => inr(r.earnedBudget) },
                  { key: 'ma', header: 'Margin on approved', align: 'right', cell: (r: any) => signed(r.marginOnApproved) },
                ]}
                footer={rows.length > 1 ? (
                  <tr>
                    <td className="px-3 py-2">Total</td><td /><td /><td />
                    <td className="num px-3">{num(tot.qty.toString())}</td>
                    <td className="px-3 py-2 text-right">{signed(tot.planned.toString())}</td>
                    <td className="num px-3">{num(tot.approved.toString())}</td>
                    <td className="num px-3">{inr(tot.cost.toString())}</td>
                    <td className="num px-3">{inr(tot.earned.toString())}</td>
                    <td className="px-3 py-2 text-right">{signed(tot.margin.toString())}</td>
                  </tr>
                ) : undefined} />
            )}
            {a.draftContracts.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-rule-soft px-4 py-2 text-[13px]">
                <span className="text-ink-soft">Not yet approved:</span>
                {a.draftContracts.map((d: any, i: number) => (
                  <span key={i} className="inline-flex items-center gap-1.5">{d.workOrder} at {inr(d.rate)} / {unit} for {num(d.quantity)} {unit} <Status value={d.status} /></span>
                ))}
              </div>
            )}
            {rows.length > 0 && D(tot.qty).gt(D(c.scopeQuantity)) && <div className="border-t border-rule-soft px-4 py-2"><Tag tone="amber">Work orders cover {num(tot.qty.toString())} {unit}, more than the scope of {num(c.scopeQuantity)} {unit}</Tag></div>}
          </Sheet>
        );
      })}
    </div>
  );
}
