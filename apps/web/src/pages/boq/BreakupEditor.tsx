import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { computeBreakup, standardConversion, UNIT_CODES, type BreakupResult, type UnitCode } from '@epc/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { dateTime, inr, num, unitLabel } from '../../lib/format';
import { Button, Facts, Field, Notice, PageHeader, Sheet, Status, Textarea, cx } from '../../components/ui';
import { RateLayers } from '../../components/boq/RateLayers';

interface Act { id?: string; code: string; name: string; method: 'PERCENT' | 'FIXED_RATE'; percentage: string; fixedRate: string; unit: string; conversionFactor: string; conversionBasis: string; locked?: boolean }

const okCls = 'border-rule bg-sheet';
const badCls = 'border-red bg-red-wash';
const isNum = (v: string) => /^\s*-?\d*\.?\d+\s*$/.test(v);
const fromApi = (a: any): Act => ({
  id: a.id, code: a.code, name: a.name, method: a.method, percentage: a.percentage ?? '', fixedRate: a.fixedRate ?? '', unit: a.unit,
  conversionFactor: a.conversionFactor ?? '1', conversionBasis: a.conversionBasis ?? '', locked: a.workOrderItems?.length > 0,
});
const cellCls = 'h-8 rounded-[3px] border px-2 text-[13px] focus:border-teal focus:outline-none disabled:bg-rule-soft';

/** Does this activity need an engineering basis for its unit conversion? (mirrors the API rule) */
const needsBasis = (parentUnit: string, a: Act) => {
  const std = standardConversion(parentUnit as UnitCode, a.unit as UnitCode);
  return !std || !isNum(a.conversionFactor) || !std.eq(a.conversionFactor.trim());
};

export function BreakupEditor() {
  const { projectId } = useProject();
  const { contractId, itemKey } = useParams();
  const { can } = useAuth();
  const url = `/contracts/${contractId}/items/${itemKey}/breakup`;
  const { data, error: loadErr } = useApi<any>(url);
  const { data: contract } = useApi<any>(`/contracts/${contractId}`);
  const canEdit = can('activity.edit', { projectId });
  const canApprove = can('activity.approve', { projectId });

  const [acts, setActs] = useState<Act[]>([]);
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => { if (data && !dirty) setActs(data.activities.map(fromApi)); }, [data, dirty]);
  const edit = (i: number, patch: Partial<Act>) => { setActs((l) => l.map((a, k) => (k === i ? { ...a, ...patch } : a))); setDirty(true); };
  const add = () => { setActs((l) => [...l, { code: '', name: '', method: 'PERCENT', percentage: '', fixedRate: '', unit: data?.item.unit ?? 'NO', conversionFactor: '1', conversionBasis: '' }]); setDirty(true); };
  const remove = (i: number) => { setActs((l) => l.filter((_, k) => k !== i)); setDirty(true); };

  const item = data?.item;
  // Live recompute with the same shared function the API uses.
  const live = useMemo(() => {
    if (!item) return null;
    const inputErr: string[] = [];
    acts.forEach((a, i) => {
      const label = a.code || `Row ${i + 1}`;
      if (!a.code.trim()) inputErr.push(`Row ${i + 1}: activity code is required`);
      if (a.name.trim().length < 2) inputErr.push(`${label}: name is required`);
      const v = a.method === 'PERCENT' ? a.percentage : a.fixedRate;
      if (!isNum(v)) inputErr.push(`${label}: ${a.method === 'PERCENT' ? 'percentage' : 'fixed rate'} must be a number`);
      if (!isNum(a.conversionFactor)) inputErr.push(`${label}: conversion factor must be a number`);
      else if (needsBasis(item.unit, a) && !a.conversionBasis.trim()) inputErr.push(`${label}: state the engineering basis for ${num(a.conversionFactor, 6)} ${unitLabel(a.unit)} per ${unitLabel(item.unit)}`);
    });
    let calc: BreakupResult | null = null;
    try {
      calc = computeBreakup({ clientRate: item.rate, quantity: item.quantity, unit: unitLabel(item.unit) }, acts.map((a) => ({
        code: a.code || '?', name: a.name, method: a.method,
        percentage: a.method === 'PERCENT' && isNum(a.percentage) ? a.percentage.trim() : '0',
        fixedRate: a.method === 'FIXED_RATE' && isNum(a.fixedRate) ? a.fixedRate.trim() : '0',
        unit: a.unit, conversionFactor: isNum(a.conversionFactor) ? a.conversionFactor.trim() : '0',
      })));
    } catch { calc = null; }
    return { calc, errors: [...inputErr, ...(calc?.errors ?? [])], warnings: calc?.warnings ?? [] };
  }, [acts, item]);

  const save = useAction(() => api.put(url, {
    activities: acts.map((a) => ({ id: a.id, code: a.code.trim(), name: a.name.trim(), method: a.method, percentage: a.method === 'PERCENT' ? a.percentage.trim() : null, fixedRate: a.method === 'FIXED_RATE' ? a.fixedRate.trim() : null, unit: a.unit, conversionFactor: a.conversionFactor.trim(), conversionBasis: a.conversionBasis.trim() || null })),
    reason: reason.trim() || undefined,
  }), { onSuccess: () => { setDirty(false); setReason(''); } });
  const approve = useAction(() => api.post(`${url}/approve`, { comment: reason.trim() || undefined }), { onSuccess: () => { setReason(''); save.reset(); } });

  const back = <><Link to={`/p/${projectId}/contracts`} className="hover:underline">Contracts</Link> / <Link to={`/p/${projectId}/contracts/${contractId}`} className="hover:underline">{contract?.contractNo ?? 'Contract'}</Link></>;
  if (loadErr) return <><PageHeader back={back} title="Activity breakup" /><Notice error={loadErr} /></>;
  if (!data || !live) return null;

  const saved = data.activities as any[];
  const allApproved = saved.length > 0 && saved.every((a) => a.status === 'APPROVED');
  const status = saved.length === 0 ? null : allApproved ? 'APPROVED' : 'DRAFT';
  const approvedAt = allApproved ? saved.map((a) => a.approvedAt).sort().at(-1) : null;
  const pu = unitLabel(item.unit);
  const calc = live.calc;

  return (
    <>
      <PageHeader back={back} title={`Item ${item.itemNo} · activity breakup`} description={item.description}
        actions={<>
          {status && <Status value={status} label={status === 'APPROVED' ? 'Breakup approved' : 'Breakup draft'} />}
          {canEdit && <Button variant={dirty ? 'primary' : 'secondary'} disabled={!dirty || live.errors.length > 0 || acts.length === 0} busy={save.isPending} onClick={() => save.mutate(undefined)}>Save breakup</Button>}
          {canApprove && status === 'DRAFT' && <Button variant="primary" disabled={dirty} busy={approve.isPending} onClick={() => approve.mutate(undefined)}>Approve breakup</Button>}
        </>} />

      <div className="mb-4 grid gap-2">
        {save.error ? <Notice error={save.error} onClose={() => save.reset()} /> : null}
        {approve.error ? <Notice error={approve.error} onClose={() => approve.reset()} /> : null}
        {save.isSuccess && !dirty && <Notice tone="success" title="Breakup saved as draft" onClose={() => save.reset()}>{canApprove ? 'Approve it to use the activities in work orders and measurements.' : 'It now needs approval by someone with the approve-breakup permission.'}</Notice>}
        {status === 'APPROVED' && !dirty && <Notice tone="success" title="Breakup approved">{approvedAt ? `Approved ${dateTime(approvedAt)}. ` : ''}{canEdit ? 'Saving any change returns it to draft for re-approval.' : ''}</Notice>}
        {dirty && status === 'APPROVED' && <Notice tone="warning" title="Unsaved changes to an approved breakup">Saving returns the breakup to draft; it must be approved again.</Notice>}
      </div>

      <Sheet title="Client BOQ item" className="mb-4">
        <Facts items={[['Item', item.itemNo], ['Client rate', `${inr(item.rate)} / ${pu}`], ['Quantity', `${num(item.quantity)} ${pu}`], ['Amount', inr(item.amount)], ['BOQ revision', `R${data.revision.revisionNo} (approved)`]]} cols={5} />
      </Sheet>

      <Sheet flush title="Execution activities" className="mb-4"
        actions={<span className="text-xs text-ink-soft">The allocation splits the client rate for budgeting; it is not the subcontractor rate.</span>}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-rule bg-paper text-left text-ink-soft">
                <th className="px-2 py-2 font-medium">Code</th>
                <th className="px-2 py-2 font-medium">Activity</th>
                <th className="px-2 py-2 font-medium">Method</th>
                <th className="px-2 py-2 text-right font-medium">Share / rate</th>
                <th className="px-2 py-2 font-medium">Unit</th>
                <th className="px-2 py-2 text-right font-medium" title={`Activity units per 1 ${pu}`}>Per 1 {pu}</th>
                <th className="border-l border-rule px-2 py-2 text-right font-medium">Share</th>
                <th className="px-2 py-2 text-right font-medium">₹ / {pu}</th>
                <th className="px-2 py-2 text-right font-medium">Scope qty</th>
                <th className="px-2 py-2 text-right font-medium">Budget rate</th>
                <th className="px-2 py-2 text-right font-medium">Budget amount</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {acts.length === 0 && <tr><td colSpan={12} className="px-3 py-8 text-center text-ink-soft">Not broken down yet. Add the activities this item is executed and paid in (e.g. supply, laying, jointing, testing).</td></tr>}
              {acts.map((a, i) => {
                const c = calc?.activities[i];
                const basisNeeded = isNum(a.conversionFactor) && needsBasis(item.unit, a);
                const ro = !canEdit;
                return (
                  <Fragment key={a.id ?? `new-${i}`}>
                  <tr className={cx('align-top', !(basisNeeded || a.conversionBasis) && 'border-b border-rule-soft')}>
                    <td className="px-1.5 py-1.5"><input aria-label="Activity code" disabled={ro} value={a.code} maxLength={20} onChange={(e) => edit(i, { code: e.target.value.toUpperCase() })} className={cx(cellCls, okCls, 'w-[64px] font-medium')} /></td>
                    <td className="px-1.5 py-1.5"><input aria-label="Activity name" disabled={ro} value={a.name} onChange={(e) => edit(i, { name: e.target.value })} className={cx(cellCls, okCls, 'w-full min-w-[120px]')} /></td>
                    <td className="px-1.5 py-1.5">
                      <select aria-label="Allocation method" disabled={ro} value={a.method} onChange={(e) => edit(i, { method: e.target.value as Act['method'] })} className={cx(cellCls, okCls, 'w-[96px]')}>
                        <option value="PERCENT">Percent</option>
                        <option value="FIXED_RATE">Fixed ₹</option>
                      </select>
                    </td>
                    <td className="px-1.5 py-1.5">
                      <div className="relative w-[92px]">
                        {a.method === 'PERCENT'
                          ? <><input aria-label="Percentage" inputMode="decimal" disabled={ro} value={a.percentage} onChange={(e) => edit(i, { percentage: e.target.value })} className={cx(cellCls, 'w-full pr-6 text-right tabular-nums', a.percentage && !isNum(a.percentage) ? badCls : okCls)} /><span className="pointer-events-none absolute right-2 top-1.5 text-ink-soft">%</span></>
                          : <><span className="pointer-events-none absolute left-2 top-1.5 text-ink-soft">₹</span><input aria-label={`Fixed rate per ${pu}`} inputMode="decimal" disabled={ro} value={a.fixedRate} onChange={(e) => edit(i, { fixedRate: e.target.value })} className={cx(cellCls, 'w-full pl-5 text-right tabular-nums', a.fixedRate && !isNum(a.fixedRate) ? badCls : okCls)} /></>}
                      </div>
                    </td>
                    <td className="px-1.5 py-1.5">
                      <select aria-label="Activity unit" disabled={ro} value={a.unit} onChange={(e) => edit(i, { unit: e.target.value })} className={cx(cellCls, okCls, 'w-[76px]')}>
                        {UNIT_CODES.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                      </select>
                    </td>
                    <td className="px-1.5 py-1.5"><input aria-label="Conversion factor" inputMode="decimal" disabled={ro} value={a.conversionFactor} onChange={(e) => edit(i, { conversionFactor: e.target.value })} className={cx(cellCls, 'w-[70px] text-right tabular-nums', !isNum(a.conversionFactor) ? badCls : okCls)} /></td>
                    <td className="num border-l border-rule px-1.5 py-2">{c ? `${num(c.share.toString(), 2)}%` : '—'}</td>
                    <td className="num px-1.5 py-2">{c ? inr(c.allocatedRatePerParentUnit.toString()) : '—'}</td>
                    <td className="num px-1.5 py-2">{c ? <>{num(c.scopeQuantity.toString())}<span className="text-xs text-ink-soft"> {unitLabel(a.unit)}</span></> : '—'}</td>
                    <td className="num px-1.5 py-2 font-medium">{c ? <>{inr(c.budgetRatePerActivityUnit.toString())}<span className="text-xs font-normal text-ink-soft"> /{unitLabel(a.unit)}</span></> : '—'}</td>
                    <td className="num px-1.5 py-2">{c ? inr(c.budgetAmount.toString()) : '—'}</td>
                    <td className="px-1 py-1.5">
                      {canEdit && <Button size="sm" variant="ghost" aria-label={`Remove ${a.code || 'activity'}`} disabled={a.locked} title={a.locked ? 'Used by a work order; it cannot be removed' : 'Remove activity'} onClick={() => remove(i)}><Trash2 className="size-3.5" /></Button>}
                    </td>
                  </tr>
                  {(basisNeeded || a.conversionBasis) && (
                    <tr className="border-b border-rule-soft">
                      <td />
                      <td colSpan={5} className="px-1.5 pb-2">
                        <label className="flex items-center gap-2 text-xs text-ink-soft">
                          <span className="whitespace-nowrap">Conversion basis{basisNeeded ? ' (required)' : ''}</span>
                          <input aria-label="Conversion basis" disabled={ro} value={a.conversionBasis} placeholder={`Why ${a.conversionFactor} ${unitLabel(a.unit)} per ${pu}, e.g. 6 m pipe lengths`} onChange={(e) => edit(i, { conversionBasis: e.target.value })}
                            className={cx(cellCls, 'w-full text-ink', basisNeeded && !a.conversionBasis.trim() ? badCls : okCls)} />
                        </label>
                      </td>
                      <td colSpan={6} />
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
            {calc && acts.length > 0 && (
              <tfoot className="border-t-2 border-rule bg-paper font-semibold">
                <tr>
                  <td colSpan={6} className="px-2 py-2">
                    {canEdit && <Button size="sm" onClick={add}><Plus className="size-3.5" /> Add activity</Button>}
                  </td>
                  <td className={cx('num border-l border-rule px-2 py-2', !calc.totalShare.eq(100) && 'text-amber')}>{num(calc.totalShare.toString(), 2)}%</td>
                  <td className="num px-1.5 py-2">{inr(calc.totalAllocatedRate.toString())}</td>
                  <td />
                  <td className="num px-1.5 py-2 text-xs font-normal text-ink-soft">of {inr(item.rate)} / {pu}</td>
                  <td className={cx('num px-2 py-2', !calc.totalBudget.eq(calc.parentAmount) && 'text-amber')}>{inr(calc.totalBudget.toString())}</td>
                  <td />
                </tr>
                {!calc.unallocatedRate.isZero() && (
                  <tr className="font-normal"><td colSpan={7} /><td className="num px-2 pb-2 text-xs text-amber" colSpan={4}>Unallocated {inr(calc.unallocatedRate.toString())} / {pu}</td><td /></tr>
                )}
              </tfoot>
            )}
          </table>
          {acts.length === 0 && canEdit && <div className="border-t border-rule-soft px-3 py-2"><Button size="sm" onClick={add}><Plus className="size-3.5" /> Add activity</Button></div>}
        </div>
        <div className="grid gap-2 border-t border-rule-soft px-4 py-3">
          {live.errors.length > 0 && <Notice tone="error" title="Fix before saving"><ul className="list-disc pl-4">{live.errors.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
          {live.warnings.length > 0 && <Notice tone="warning" title="Check before approving"><ul className="list-disc pl-4">{live.warnings.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
          {live.errors.length === 0 && acts.length > 0 && calc?.balanced && <p className="text-[13px] text-green">Balanced: the activities allocate exactly {inr(item.rate)} per {pu}.</p>}
          {(canEdit || canApprove) && (
            <Field label="Reason / comment (recorded in the audit log)" className="max-w-2xl">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Split as per approved rate analysis" className="min-h-[56px]" />
            </Field>
          )}
        </div>
      </Sheet>

      <h2 className="mb-1 mt-6 text-[17px] font-bold">Rate layers</h2>
      <p className="mb-3 max-w-[80ch] text-[13px] text-ink-soft">For each activity: what the client pays for it (the budget rate allocated from the client rate) against what each subcontractor is paid, the margin per unit, the planned margin on the work order quantity, and the margin earned on approved measurements.{dirty ? ' Figures below reflect the saved breakup.' : ''}</p>
      {saved.length === 0 ? <p className="text-[13px] text-ink-soft">Save a breakup to see rate layers.</p> : <RateLayers item={item} activities={saved} />}
    </>
  );
}
