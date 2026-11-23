import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { D, money, sum } from '@epc/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { inr, isoDate, num, unitLabel } from '../../lib/format';
import { Button, Field, Input, Notice, PageHeader, Select, Sheet, Textarea } from '../../components/ui';
import { budgetRate, fieldErrors, MATERIAL_RESP, useProjectActivities } from '../../components/subcontract/common';

interface Line { activityId: string; description: string; quantity: string; rate: string }
const blankLine: Line = { activityId: '', description: '', quantity: '', rate: '' };
const blank = {
  subcontractorId: '', title: '', description: '', startDate: isoDate(), completionDate: '', materialResponsibility: 'COMPANY_RECOVERABLE',
  retentionPercent: '', securityDepositPercent: '0', advanceAmount: '0', advanceRecoveryPercent: '0', paymentTerms: '', recoveryConditions: '', otherDeductions: '',
};
const isNum = (v: string) => v.trim() !== '' && !Number.isNaN(Number(v));

export function WorkOrderForm() {
  const { projectId, companyId } = useProject();
  const { id } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const { data: wo } = useApi<any>(id ? `/work-orders/${id}` : null);
  const { data: subs } = useApi<any[]>(companyId ? `/companies/${companyId}/subcontractors` : null);
  const { activities } = useProjectActivities(projectId);
  const [f, setF] = useState(blank);
  const [lines, setLines] = useState<Line[]>([{ ...blankLine }]);
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    if (!wo || loaded) return;
    const d = (v: string | null) => (v ? v.slice(0, 10) : '');
    setF({
      subcontractorId: wo.subcontractorId, title: wo.title, description: wo.description ?? '', startDate: d(wo.startDate), completionDate: d(wo.completionDate), materialResponsibility: wo.materialResponsibility,
      retentionPercent: String(wo.retentionPercent), securityDepositPercent: String(wo.securityDepositPercent), advanceAmount: String(wo.advanceAmount), advanceRecoveryPercent: String(wo.advanceRecoveryPercent),
      paymentTerms: wo.paymentTerms ?? '', recoveryConditions: wo.recoveryConditions ?? '', otherDeductions: wo.otherDeductions ?? '',
    });
    setLines(wo.items.map((i: any) => ({ activityId: i.activityId, description: i.description, quantity: String(i.quantity), rate: String(i.rate) })));
    setLoaded(true);
  }, [wo, loaded]);

  const eligible = (subs ?? []).filter((s) => ['ACTIVE', 'ONBOARDING'].includes(s.status) || s.id === f.subcontractorId);
  const sub = subs?.find((s) => s.id === f.subcontractorId);
  const approvedActs = (activities ?? []).filter((a) => a.status === 'APPROVED' && a.boqItem);
  const contracts = [...new Set(approvedActs.map((a) => a.contractNo))];
  const amount = (l: Line) => (isNum(l.quantity) && isNum(l.rate) ? money(D(l.quantity).times(l.rate)) : null);
  const total = sum(lines.map((l) => amount(l)?.toString() ?? 0));

  const save = useAction(() => {
    const body: any = {
      ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? undefined : v])),
      items: lines.map((l) => ({ activityId: l.activityId, description: l.description || undefined, quantity: l.quantity, rate: l.rate })),
    };
    if (id) { delete body.subcontractorId; return api.put(`/work-orders/${id}`, body); }
    return api.post(`/projects/${projectId}/work-orders`, body);
  }, { onSuccess: (w: any) => nav(`/p/${projectId}/work-orders/${w.id}`) });
  const errs = fieldErrors(save.error);
  const setLine = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const used = new Set(lines.map((l) => l.activityId));

  if (id && wo && !['DRAFT', 'REJECTED'].includes(wo.status)) return <Notice tone="warning" title={`Work order ${wo.woNo} is ${wo.status.toLowerCase()}`}>Only draft or rejected work orders can be edited. <Link className="text-teal underline" to={`/p/${projectId}/work-orders/${id}`}>Raise an amendment</Link> instead.</Notice>;
  if (!can('workorder.edit', { projectId })) return <><PageHeader title="New work order" /><Notice tone="warning" title="You cannot draft work orders on this project">Ask a contract manager or project manager to draft it.</Notice></>;

  return (
    <>
      <PageHeader back={<Link to={id ? `/p/${projectId}/work-orders/${id}` : `/p/${projectId}/work-orders`} className="hover:underline">{id ? wo?.woNo ?? 'Work order' : 'Work orders'}</Link>}
        title={id ? `Edit ${wo?.woNo ?? 'work order'}` : 'New work order'} description="Saved as a draft. Submit it for approval from the work order page." />
      <div className="space-y-4">
        {save.error ? <Notice error={save.error} /> : null}
        <Sheet title="Terms">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Subcontractor" className="sm:col-span-2" error={errs.subcontractorId} hint={sub?.status === 'ONBOARDING' ? 'Still onboarding: the work order can be drafted but not approved until the subcontractor is activated.' : 'Active and onboarding subcontractors only'}>
              <Select value={f.subcontractorId} disabled={!!id} onChange={(e) => { const s = subs?.find((x) => x.id === e.target.value); setF({ ...f, subcontractorId: e.target.value, retentionPercent: f.retentionPercent || String(s?.retentionPercent ?? '') }); }}>
                <option value="">Select…</option>
                {eligible.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}{s.status !== 'ACTIVE' ? ` (${s.status.toLowerCase()})` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Title / name of work" className="sm:col-span-2" error={errs.title}><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Start date" error={errs.startDate}><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
            <Field label="Completion date" error={errs.completionDate}><Input type="date" value={f.completionDate} onChange={(e) => setF({ ...f, completionDate: e.target.value })} /></Field>
            <Field label="Material responsibility" className="sm:col-span-2" error={errs.materialResponsibility}><Select value={f.materialResponsibility} onChange={(e) => setF({ ...f, materialResponsibility: e.target.value })}>{Object.entries(MATERIAL_RESP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Retention (%)" error={errs.retentionPercent} hint={sub ? `Subcontractor default ${num(sub.retentionPercent)}%` : undefined}><Input inputMode="decimal" value={f.retentionPercent} onChange={(e) => setF({ ...f, retentionPercent: e.target.value })} /></Field>
            <Field label="Security deposit (%)" error={errs.securityDepositPercent}><Input inputMode="decimal" value={f.securityDepositPercent} onChange={(e) => setF({ ...f, securityDepositPercent: e.target.value })} /></Field>
            <Field label="Mobilisation advance (₹)" error={errs.advanceAmount}><Input inputMode="decimal" value={f.advanceAmount} onChange={(e) => setF({ ...f, advanceAmount: e.target.value })} /></Field>
            <Field label="Advance recovery (% of each bill)" error={errs.advanceRecoveryPercent}><Input inputMode="decimal" value={f.advanceRecoveryPercent} onChange={(e) => setF({ ...f, advanceRecoveryPercent: e.target.value })} /></Field>
            <Field label="Payment terms" className="sm:col-span-2" error={errs.paymentTerms}><Textarea value={f.paymentTerms} onChange={(e) => setF({ ...f, paymentTerms: e.target.value })} placeholder={sub ? `e.g. Within ${sub.paymentTermsDays} days of certified RA bill` : ''} /></Field>
            <Field label="Recovery conditions" className="sm:col-span-2" error={errs.recoveryConditions}><Textarea value={f.recoveryConditions} onChange={(e) => setF({ ...f, recoveryConditions: e.target.value })} placeholder="e.g. Material issued recovered at issue rate; excess wastage at penal rate" /></Field>
            <Field label="Other deductions" className="sm:col-span-2" error={errs.otherDeductions}><Textarea value={f.otherDeductions} onChange={(e) => setF({ ...f, otherDeductions: e.target.value })} placeholder="e.g. Labour cess 1%, water and electricity at actuals" /></Field>
            <Field label="Scope description" className="sm:col-span-2" error={errs.description}><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          </div>
        </Sheet>

        <Sheet title="Lines" flush actions={<Button size="sm" onClick={() => setLines([...lines, { ...blankLine }])}><Plus className="size-3.5" /> Add line</Button>}>
          {activities && approvedActs.length === 0 && <div className="p-4"><Notice tone="warning" title="No approved BOQ activities">Approve the BOQ breakup of at least one item before drafting a work order.</Notice></div>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-rule bg-paper text-left text-ink-soft">
                  <th className="px-3 py-2 font-medium">BOQ activity</th>
                  <th className="px-3 py-2 font-medium">Unit</th>
                  <th className="px-3 py-2 text-right font-medium">Scope qty</th>
                  <th className="px-3 py-2 text-right font-medium" title="Internal budget rate per activity unit from the approved breakup">Budget rate</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">Quantity</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">Rate (₹)</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const a = approvedActs.find((x) => x.id === l.activityId);
                  const br = a ? budgetRate(a) : null;
                  const over = a && isNum(l.quantity) && a.scopeQuantity && D(l.quantity).gt(a.scopeQuantity);
                  const aboveBudget = br && isNum(l.rate) && D(l.rate).gt(br);
                  const lineErr = (k: string) => errs[`items.${i}.${k}`];
                  return (
                    <tr key={i} className="border-b border-rule-soft align-top">
                      <td className="px-3 py-2">
                        <Select aria-label={`Line ${i + 1} activity`} value={l.activityId} onChange={(e) => setLine(i, { activityId: e.target.value })} className="min-w-[280px]">
                          <option value="">Select activity…</option>
                          {contracts.map((c) => (
                            <optgroup key={c} label={c}>
                              {approvedActs.filter((x) => x.contractNo === c).map((x) => <option key={x.id} value={x.id} disabled={used.has(x.id) && x.id !== l.activityId}>Item {x.boqItem.itemNo} · {x.code} {x.name}</option>)}
                            </optgroup>
                          ))}
                        </Select>
                        {lineErr('activityId') && <div className="mt-1 text-xs text-red">{lineErr('activityId')}</div>}
                        {a && <div className="mt-1 line-clamp-2 max-w-[48ch] text-xs text-ink-soft" title={a.boqItem.description}>{a.boqItem.description} · client rate {inr(a.boqItem.rate)}/{unitLabel(a.boqItem.unit)}</div>}
                        <Input aria-label={`Line ${i + 1} description`} placeholder={a ? `Description (default: ${a.name})` : 'Description'} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className="mt-1 h-8 text-[13px]" />
                      </td>
                      <td className="px-3 py-2 pt-4">{a ? unitLabel(a.unit) : '—'}</td>
                      <td className="num px-3 py-2 pt-4">{a ? num(a.scopeQuantity) : '—'}</td>
                      <td className="num px-3 py-2 pt-4">{br ? inr(br) : '—'}</td>
                      <td className="px-3 py-2"><Input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />{over && <div className="mt-1 text-xs text-amber">Above scope</div>}{lineErr('quantity') && <div className="mt-1 text-xs text-red">{lineErr('quantity')}</div>}</td>
                      <td className="px-3 py-2"><Input aria-label={`Line ${i + 1} rate`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />{lineErr('rate') && <div className="mt-1 text-xs text-red">{lineErr('rate')}</div>}{aboveBudget && <div className="mt-1 text-xs text-amber">Above budget rate</div>}</td>
                      <td className="num px-3 py-2 pt-4">{amount(l) ? inr(amount(l)!.toString()) : '—'}</td>
                      <td className="px-1 py-2 pt-3"><Button size="sm" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-rule bg-paper font-semibold">
                <tr><td colSpan={6} className="px-3 py-2">Work order value</td><td className="num px-3 py-2">{inr(total.toString())}</td><td /></tr>
              </tfoot>
            </table>
          </div>
        </Sheet>
        <div className="flex justify-end gap-2">
          <Button onClick={() => nav(-1)}>Cancel</Button>
          <Button variant="primary" busy={save.isPending} disabled={!loaded} onClick={() => save.mutate(undefined)}>{id ? 'Save work order' : 'Save draft work order'}</Button>
        </div>
      </div>
    </>
  );
}
