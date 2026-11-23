import { Fragment, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, FilePen, Pencil } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { date, dateTime, inr, num, unitLabel } from '../../lib/format';
import { Button, Dialog, Facts, Field, Notice, PageHeader, Sheet, Status, Tabs, Textarea } from '../../components/ui';
import { ActionError, MATERIAL_RESP, useProjectActivities, WorkflowHistory } from '../../components/subcontract/common';
import { AmendmentDialog } from '../../components/subcontract/AmendmentDialog';

type WoAction = 'submit' | 'approve' | 'reject' | 'suspend' | 'close';
const ACTION_LABEL: Record<WoAction, string> = { submit: 'Submit for approval', approve: 'Approve work order', reject: 'Reject work order', suspend: 'Suspend work order', close: 'Close work order' };
const NEEDS_REASON: WoAction[] = ['reject', 'suspend', 'close'];

export function WorkOrderDetail() {
  const { projectId } = useProject();
  const { id } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const { data: wo, error } = useApi<any>(`/work-orders/${id}`);
  const { activities } = useProjectActivities(projectId);
  const [tab, setTab] = useState<'lines' | 'amendments' | 'history'>('lines');
  const [pending, setPending] = useState<{ kind: 'wo'; action: WoAction } | { kind: 'am'; action: 'approve' | 'reject'; am: any } | null>(null);
  const [comment, setComment] = useState('');
  const [amendOpen, setAmendOpen] = useState(false);
  const [openRates, setOpenRates] = useState<Record<string, boolean>>({});
  const act = useAction((p: NonNullable<typeof pending>) => (p.kind === 'wo' ? api.post(`/work-orders/${id}/${p.action}`, { comment: comment || undefined }) : api.post(`/amendments/${p.am.id}/${p.action}`, { comment: comment || undefined })), {
    onSuccess: () => { setPending(null); setComment(''); },
  });

  if (error) return <Notice error={error} />;
  if (!wo) return null;
  const canEdit = can('workorder.edit', { projectId });
  const canApprove = can('workorder.approve', { projectId });
  const s = wo.status;
  const actions: WoAction[] = [
    ...(canEdit && ['DRAFT', 'REJECTED'].includes(s) ? (['submit'] as const) : []),
    ...(canApprove && s === 'SUBMITTED' ? (['reject', 'approve'] as const) : []),
    ...(canApprove && s === 'APPROVED' ? (['suspend'] as const) : []),
    ...(canApprove && ['APPROVED', 'SUSPENDED'].includes(s) ? (['close'] as const) : []),
  ];
  const start = (p: NonNullable<typeof pending>) => { act.reset(); setComment(''); setPending(p); };
  const run = (p: NonNullable<typeof pending>) => act.mutate(p);
  const actName = (aid: string) => activities?.find((a) => a.id === aid);
  const itemById = (iid: string) => wo.items.find((i: any) => i.id === iid);
  const pendingAm = wo.amendments.filter((a: any) => a.status === 'SUBMITTED');
  const needsReason = pending && (pending.kind === 'wo' ? NEEDS_REASON.includes(pending.action) : pending.action === 'reject');

  return (
    <>
      <PageHeader back={<Link to={`/p/${projectId}/work-orders`} className="hover:underline">Work orders</Link>} title={`${wo.woNo} · ${wo.title}`}
        description={<><Link to={`/subcontractors/${wo.subcontractor.id}`} className="hover:underline">{wo.subcontractor.code} · {wo.subcontractor.name}</Link> · value {inr(wo.value)}</>}
        actions={<>
          <Status value={s} />
          {canEdit && ['DRAFT', 'REJECTED'].includes(s) && <Button onClick={() => nav('edit')}><Pencil className="size-4" /> Edit</Button>}
          {canEdit && s === 'APPROVED' && <Button onClick={() => setAmendOpen(true)}><FilePen className="size-4" /> Raise amendment</Button>}
          {actions.map((a) => (
            <Button key={a} variant={a === 'approve' || a === 'submit' ? 'primary' : a === 'reject' ? 'danger' : 'secondary'} busy={act.isPending && act.variables?.kind === 'wo' && act.variables.action === a}
              onClick={() => (NEEDS_REASON.includes(a) || a === 'approve' ? start({ kind: 'wo', action: a }) : (act.reset(), run({ kind: 'wo', action: a })))}>{ACTION_LABEL[a]}</Button>
          ))}
        </>} />
      <div className="mb-4 space-y-2">
        {!pending && act.error ? <ActionError error={act.error} onClose={() => act.reset()} /> : null}
        {s === 'SUBMITTED' && <Notice tone="info" title="Awaiting approval">An approver other than the person who drafted it must approve. The work order value is checked against the approver's financial limit.</Notice>}
        {s === 'REJECTED' && <Notice tone="warning" title="Rejected">Edit the work order and submit it again.</Notice>}
        {wo.subcontractor.status !== 'ACTIVE' && ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(s) && <Notice tone="warning" title={`Subcontractor is ${wo.subcontractor.status.toLowerCase()}`}>The subcontractor must be activated before this work order can be approved.</Notice>}
        {pendingAm.length > 0 && <Notice tone="warning" title={`${pendingAm.length} amendment${pendingAm.length > 1 ? 's' : ''} awaiting approval`}><button className="text-teal underline" onClick={() => setTab('amendments')}>Review amendments</button></Notice>}
      </div>
      <Sheet title="Terms">
        <Facts items={[
          ['Start', date(wo.startDate)], ['Completion', date(wo.completionDate)], ['Material', MATERIAL_RESP[wo.materialResponsibility]], ['Retention', `${num(wo.retentionPercent)}%`],
          ['Security deposit', `${num(wo.securityDepositPercent)}%`], ['Advance', inr(wo.advanceAmount)], ['Advance recovery', `${num(wo.advanceRecoveryPercent)}% of each bill`], ['Approved', wo.approvedAt ? dateTime(wo.approvedAt) : 'Not yet'],
        ]} />
        {(wo.paymentTerms || wo.recoveryConditions || wo.otherDeductions || wo.description) && (
          <dl className="mt-4 grid gap-3 border-t border-rule-soft pt-3 text-[13px] sm:grid-cols-2">
            {[['Scope', wo.description], ['Payment terms', wo.paymentTerms], ['Recovery conditions', wo.recoveryConditions], ['Other deductions', wo.otherDeductions]].filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><dt className="text-xs text-ink-soft">{k}</dt><dd className="mt-0.5 whitespace-pre-line">{v}</dd></div>
            ))}
          </dl>
        )}
      </Sheet>

      <div className="mt-4">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'lines', label: `Lines (${wo.items.length})` }, { value: 'amendments', label: `Amendments (${wo.amendments.length})` }, { value: 'history', label: 'Approval history' }]} />
        {tab === 'lines' && (
          <Sheet flush>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-rule bg-paper text-left text-ink-soft">
                    <th className="px-3 py-2 font-medium">Line</th><th className="px-3 py-2 font-medium">Activity</th><th className="px-3 py-2 font-medium">Unit</th>
                    <th className="px-3 py-2 text-right font-medium">WO qty</th><th className="px-3 py-2 text-right font-medium">Allocated</th><th className="px-3 py-2 text-right font-medium">Approved (MB)</th>
                    <th className="px-3 py-2 text-right font-medium">Rate</th><th className="px-3 py-2 text-right font-medium">Amount</th><th className="px-3 py-2 font-medium">Rate history</th>
                  </tr>
                </thead>
                <tbody>
                  {wo.items.map((i: any) => {
                    const a = actName(i.activityId);
                    const op = openRates[i.id];
                    return (
                      <Fragment key={i.id}>
                        <tr className="border-b border-rule-soft align-top">
                          <td className="px-3 py-2 font-medium">{i.lineNo}</td>
                          <td className="px-3 py-2"><div>{i.description}</div><div className="text-xs text-ink-soft">{a ? `${a.contractNo} · Item ${a.boqItem?.itemNo} · ` : ''}{i.activity?.code} {i.activity?.name}</div></td>
                          <td className="px-3 py-2">{unitLabel(i.unit)}</td>
                          <td className="num px-3 py-2">{num(i.quantity)}</td>
                          <td className="num px-3 py-2">{num(i.allocated)}</td>
                          <td className="num px-3 py-2">{num(i.approvedQty)}</td>
                          <td className="num px-3 py-2">{inr(i.rate)}</td>
                          <td className="num px-3 py-2">{inr(i.amount)}</td>
                          <td className="px-3 py-2">{i.rates.length ? <button className="inline-flex items-center gap-1 text-teal hover:underline" onClick={() => setOpenRates({ ...openRates, [i.id]: !op })}>{op ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}{i.rates.length} rate{i.rates.length > 1 ? 's' : ''}</button> : <span className="text-ink-soft">Not approved</span>}</td>
                        </tr>
                        {op && (
                          <tr className="border-b border-rule-soft bg-paper/60">
                            <td />
                            <td colSpan={8} className="px-3 py-2">
                              <table className="text-xs"><thead><tr className="text-ink-soft"><th className="pr-6 text-left font-medium">Effective from</th><th className="pr-6 text-right font-medium">Rate</th><th className="pr-6 text-left font-medium">Source</th><th className="text-left font-medium">Approved</th></tr></thead>
                                <tbody>{i.rates.map((r: any) => <tr key={r.id}><td className="pr-6">{date(r.effectiveFrom)}</td><td className="num pr-6">{inr(r.rate)}</td><td className="pr-6">{r.amendmentId ? `Amendment ${wo.amendments.find((x: any) => x.id === r.amendmentId)?.amendmentNo ?? ''}` : 'Original work order'}</td><td>{dateTime(r.approvedAt)}</td></tr>)}</tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-rule bg-paper font-semibold"><tr><td colSpan={7} className="px-3 py-2">Work order value</td><td className="num px-3 py-2">{inr(wo.value)}</td><td /></tr></tfoot>
              </table>
            </div>
          </Sheet>
        )}
        {tab === 'amendments' && (
          <div className="space-y-3">
            {wo.amendments.length === 0 && <Notice tone="info" title="No amendments">{s === 'APPROVED' ? 'Use "Raise amendment" to change rates or quantities, or add lines.' : 'Amendments can be raised once the work order is approved.'}</Notice>}
            {[...wo.amendments].reverse().map((am: any) => (
              <Sheet key={am.id} title={<span className="flex items-center gap-2">Amendment {am.amendmentNo} <Status value={am.status} /></span>}
                actions={am.status === 'SUBMITTED' && canApprove && <><Button size="sm" variant="danger" onClick={() => start({ kind: 'am', action: 'reject', am })}>Reject amendment</Button><Button size="sm" variant="primary" onClick={() => start({ kind: 'am', action: 'approve', am })}>Approve amendment</Button></>}>
                <div className="mb-2 text-[13px]"><span className="text-ink-soft">Reason:</span> {am.reason}</div>
                <div className="mb-3 text-xs text-ink-soft">Effective from {date(am.effectiveFrom)} · raised {dateTime(am.createdAt)}{am.approvedAt ? ` · ${am.status === 'APPROVED' ? 'approved' : 'decided'} ${dateTime(am.approvedAt)}` : ''}</div>
                <ul className="divide-y divide-rule-soft border-y border-rule-soft text-[13px]">
                  {(am.changes as any[]).map((c, k) => {
                    const it = c.workOrderItemId ? itemById(c.workOrderItemId) : null;
                    const na = c.activityId ? actName(c.activityId) : null;
                    return (
                      <li key={k} className="flex flex-wrap justify-between gap-2 py-1.5">
                        <span>{it ? <>Line {it.lineNo} · {it.description}</> : <>New line · {na ? `${na.code} ${na.name}` : c.description ?? 'activity'}</>}</span>
                        <span className="num">
                          {c.newQuantity !== undefined && <>qty {it && am.status === 'SUBMITTED' ? `${num(it.quantity)} → ` : ''}{num(c.newQuantity)} </>}
                          {c.newRate !== undefined && <>· rate {it && am.status === 'SUBMITTED' ? `${inr(it.rate)} → ` : ''}{inr(c.newRate)}</>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Sheet>
            ))}
          </div>
        )}
        {tab === 'history' && (
          <div className="space-y-4">
            <WorkflowHistory entityType="WorkOrder" id={wo.id} />
          </div>
        )}
      </div>

      <AmendmentDialog wo={wo} activities={activities} open={amendOpen} onClose={() => setAmendOpen(false)} />
      <Dialog open={!!pending && (pending.kind === 'am' || NEEDS_REASON.includes(pending.action) || pending.action === 'approve')} onClose={() => setPending(null)}
        title={pending?.kind === 'am' ? `${pending.action === 'approve' ? 'Approve' : 'Reject'} amendment ${pending.am.amendmentNo}` : pending ? ACTION_LABEL[pending.action] : ''}
        footer={<><Button onClick={() => setPending(null)}>Cancel</Button><Button variant={pending?.action === 'reject' ? 'danger' : 'primary'} busy={act.isPending} disabled={!!needsReason && !comment.trim()} onClick={() => pending && run(pending)}>
          {pending?.kind === 'am' ? (pending.action === 'approve' ? 'Approve amendment' : 'Reject amendment') : pending ? ACTION_LABEL[pending.action] : ''}</Button></>}>
        <div className="space-y-3">
          {act.error ? <ActionError error={act.error} /> : null}
          {pending?.kind === 'wo' && pending.action === 'approve' && <p className="text-[13px] text-ink-soft">Approving fixes the rates of all {wo.items.length} lines from {date(wo.startDate)} and allows allocations against this work order. Value {inr(wo.value)}.</p>}
          {pending?.kind === 'am' && pending.action === 'approve' && <p className="text-[13px] text-ink-soft">Approved rate changes apply from {date(pending.am.effectiveFrom)}. Earlier measurements keep their old rate.</p>}
          <Field label={needsReason ? 'Reason' : 'Comment (optional)'}><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        </div>
      </Dialog>
    </>
  );
}
