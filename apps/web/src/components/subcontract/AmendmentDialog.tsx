import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { D, money } from '@epc/shared';
import { api } from '../../lib/api';
import { useAction } from '../../lib/hooks';
import { inr, isoDate, num, unitLabel } from '../../lib/format';
import { Button, Dialog, Field, Input, Notice, Select, Textarea } from '../ui';
import { budgetRate } from './common';

interface NewLine { activityId: string; description: string; quantity: string; rate: string }
const isNum = (v: string) => v.trim() !== '' && !Number.isNaN(Number(v));

/** Raise an amendment on an approved work order: rate / quantity changes to existing lines and new lines. */
export function AmendmentDialog({ wo, activities, open, onClose }: { wo: any; activities: any[] | undefined; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [effectiveFrom, setEff] = useState(isoDate());
  const [authority, setAuthority] = useState('');
  const [edits, setEdits] = useState<Record<string, { newRate: string; newQuantity: string }>>({});
  const [newLines, setNewLines] = useState<NewLine[]>([]);
  const retro = effectiveFrom !== '' && effectiveFrom < isoDate();
  const rateChange = Object.values(edits).some((e) => e.newRate.trim()) || newLines.length > 0;
  const changes = [
    ...Object.entries(edits).filter(([, e]) => e.newRate.trim() || e.newQuantity.trim()).map(([workOrderItemId, e]) => ({ workOrderItemId, ...(e.newRate.trim() ? { newRate: e.newRate.trim() } : {}), ...(e.newQuantity.trim() ? { newQuantity: e.newQuantity.trim() } : {}) })),
    ...newLines.map((l) => ({ activityId: l.activityId || undefined, description: l.description || undefined, newQuantity: l.quantity, newRate: l.rate })),
  ];
  let delta = D(0);
  for (const it of wo.items) {
    const e = edits[it.id];
    if (!e || (!e.newRate.trim() && !e.newQuantity.trim())) continue;
    const q = isNum(e.newQuantity) ? e.newQuantity : String(it.quantity), r = isNum(e.newRate) ? e.newRate : String(it.rate);
    delta = delta.plus(money(D(q).times(r)).minus(String(it.amount)));
  }
  for (const l of newLines) if (isNum(l.quantity) && isNum(l.rate)) delta = delta.plus(money(D(l.quantity).times(l.rate)));

  const submit = useAction(() => api.post(`/work-orders/${wo.id}/amendments`, { reason, effectiveFrom, retrospectiveAuthority: authority || undefined, changes }), {
    onSuccess: () => { setReason(''); setAuthority(''); setEdits({}); setNewLines([]); onClose(); },
  });
  const existingActs = new Set(wo.items.map((i: any) => i.activityId));
  const acts = (activities ?? []).filter((a) => a.status === 'APPROVED' && a.boqItem && !existingActs.has(a.id));
  const setEdit = (id: string, p: Partial<{ newRate: string; newQuantity: string }>) => setEdits({ ...edits, [id]: { ...{ newRate: '', newQuantity: '' }, ...edits[id], ...p } });
  const setNL = (i: number, p: Partial<NewLine>) => setNewLines(newLines.map((l, j) => (j === i ? { ...l, ...p } : l)));

  return (
    <Dialog wide open={open} onClose={onClose} title={`Raise amendment to ${wo.woNo}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={submit.isPending} disabled={!changes.length || reason.trim().length < 5 || (retro && rateChange && !authority.trim())} onClick={() => submit.mutate(undefined)}>Submit amendment</Button></>}>
      <div className="space-y-4">
        {submit.error ? <Notice error={submit.error} /> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Reason" className="sm:col-span-2" hint="At least 5 characters"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rate revised for rocky strata per site instruction" /></Field>
          <Field label="Effective from" hint="Rates apply to work measured on or after this date"><Input type="date" min={wo.startDate?.slice(0, 10)} value={effectiveFrom} onChange={(e) => setEff(e.target.value)} /></Field>
          {retro && (
            <Field label="Retrospective authority" className="sm:col-span-3" error={rateChange && !authority.trim() ? 'Required: the effective date is in the past' : undefined} hint="Client revision / approval letter that authorises a backdated rate">
              <Input value={authority} onChange={(e) => setAuthority(e.target.value)} placeholder="e.g. BOQ R2 approval, letter no. … dated …" />
            </Field>
          )}
        </div>

        <div>
          <h3 className="mb-1 text-[13px] font-semibold">Changes to existing lines</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead><tr className="border-b border-rule bg-paper text-left text-ink-soft"><th className="px-2 py-1.5 font-medium">Line</th><th className="px-2 py-1.5 text-right font-medium">Current qty</th><th className="px-2 py-1.5 text-right font-medium">Current rate</th><th className="w-32 px-2 py-1.5 text-right font-medium">New qty</th><th className="w-32 px-2 py-1.5 text-right font-medium">New rate (₹)</th></tr></thead>
              <tbody>
                {wo.items.map((it: any) => (
                  <tr key={it.id} className="border-b border-rule-soft">
                    <td className="px-2 py-1.5"><span className="font-medium">{it.lineNo}.</span> {it.activity?.code} {it.description}</td>
                    <td className="num px-2 py-1.5">{num(it.quantity)} {unitLabel(it.unit)}</td>
                    <td className="num px-2 py-1.5">{inr(it.rate)}</td>
                    <td className="px-2 py-1"><Input aria-label={`New quantity line ${it.lineNo}`} inputMode="decimal" className="h-8" value={edits[it.id]?.newQuantity ?? ''} onChange={(e) => setEdit(it.id, { newQuantity: e.target.value })} /></td>
                    <td className="px-2 py-1"><Input aria-label={`New rate line ${it.lineNo}`} inputMode="decimal" className="h-8" value={edits[it.id]?.newRate ?? ''} onChange={(e) => setEdit(it.id, { newRate: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between"><h3 className="text-[13px] font-semibold">New lines</h3><Button size="sm" onClick={() => setNewLines([...newLines, { activityId: '', description: '', quantity: '', rate: '' }])}><Plus className="size-3.5" /> Add new line</Button></div>
          {newLines.length === 0 && <p className="text-[13px] text-ink-soft">None. Add a line for an activity not yet on this work order.</p>}
          <div className="space-y-2">
            {newLines.map((l, i) => {
              const a = acts.find((x) => x.id === l.activityId);
              return (
                <div key={i} className="grid gap-2 rounded-[3px] border border-rule-soft p-2 sm:grid-cols-[1fr_120px_120px_auto]">
                  <div>
                    <Select aria-label={`New line ${i + 1} activity`} value={l.activityId} onChange={(e) => setNL(i, { activityId: e.target.value })}>
                      <option value="">Select activity…</option>
                      {acts.map((x) => <option key={x.id} value={x.id}>{x.contractNo} · Item {x.boqItem.itemNo} · {x.code} {x.name} ({unitLabel(x.unit)})</option>)}
                    </Select>
                    {a && <div className="mt-1 text-xs text-ink-soft">Scope {num(a.scopeQuantity)} {unitLabel(a.unit)} · budget rate {inr(budgetRate(a))} · client rate {inr(a.boqItem.rate)}/{unitLabel(a.boqItem.unit)}</div>}
                  </div>
                  <Input aria-label={`New line ${i + 1} quantity`} placeholder="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => setNL(i, { quantity: e.target.value })} />
                  <Input aria-label={`New line ${i + 1} rate`} placeholder="Rate (₹)" inputMode="decimal" value={l.rate} onChange={(e) => setNL(i, { rate: e.target.value })} />
                  <Button variant="ghost" aria-label={`Remove new line ${i + 1}`} onClick={() => setNewLines(newLines.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex justify-between border-t border-rule-soft pt-3 text-[13px]"><span className="text-ink-soft">Change in work order value</span><span className={`num font-semibold ${delta.gt(0) ? 'text-amber' : ''}`}>{delta.gte(0) ? '+' : ''}{inr(delta.toString())}</span></div>
        <p className="text-[13px] text-ink-soft">The amendment needs approval by someone other than you. An increase in value is checked against the approver's financial limit.</p>
      </div>
    </Dialog>
  );
}
