import { useMemo, useState } from 'react';
import { Plus, Printer } from 'lucide-react';
import { D, type Decimal } from '@epc/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { date, inr, isoDate, num, unitLabel } from '../../lib/format';
import { Button, Dialog, Field, Input, Notice, PageHeader, Select, Sheet, Status, Table, Tabs, Textarea } from '../../components/ui';
import { altQty, BASES, basisLabel, LineEditor, MaterialOptions, Qty, useMaterialData, useProjectActivities, useScrollTop, type Material } from '../../components/materials/common';
import { IssueVoucher } from '../../components/materials/IssueVoucher';

type ReqLine = { materialId: string; quantity: string };
type IssLine = { materialId: string; quantity: string; basis: string; issueRate: string; recoveryRate: string; recoveryTerms: string; batchNo: string };
const blankReq = (): ReqLine => ({ materialId: '', quantity: '' });
const blankIss = (): IssLine => ({ materialId: '', quantity: '', basis: '', issueRate: '', recoveryRate: '', recoveryTerms: '', batchNo: '' });

/** Default supply basis: the work order's material responsibility wins over the material default. */
function defaultBasis(wo: any, m?: Material) {
  if (wo?.materialResponsibility === 'COMPANY_FREE_ISSUE') return 'FREE_ISSUE';
  return m?.defaultBasis ?? 'RECOVERABLE';
}

export function Issues() {
  const { projectId, companyId, project } = useProject();
  const { can } = useAuth();
  const md = useMaterialData(projectId, companyId);
  const activities = useProjectActivities(projectId);
  const { data: reqs } = useApi<any[]>(`/projects/${projectId}/requisitions`);
  const { data: issues } = useApi<any[]>(`/projects/${projectId}/issues`);
  const [tab, setTab] = useState<'vouchers' | 'requisitions'>('vouchers');
  const [printing, setPrinting] = useState<any>(null);
  useScrollTop(printing);

  const subName = (id: string) => md.subs?.find((s) => s.id === id)?.name ?? '…';
  const woNo = (id: string) => md.wos?.find((w) => w.id === id)?.woNo ?? '…';
  const actName = (id?: string | null) => { if (!id) return null; const a = activities?.find((x) => x.id === id); return a ? `${a.code} · ${a.name}` : '…'; };

  /** Quantity already issued against each requisition line (non-cancelled vouchers). */
  const issuedAgainst = useMemo(() => {
    const m = new Map<string, Decimal>();
    for (const i of issues ?? []) if (i.requisitionId && i.status !== 'CANCELLED') for (const l of i.lines) { const k = `${i.requisitionId}:${l.materialId}`; m.set(k, (m.get(k) ?? D(0)).plus(l.quantity)); }
    return m;
  }, [issues]);
  const reqBalance = (r: any, materialId: string) => { const l = (r.lines as ReqLine[]).find((x) => x.materialId === materialId); return l ? D(l.quantity).minus(issuedAgainst.get(`${r.id}:${materialId}`) ?? 0) : D(0); };

  if (printing) {
    const i = issues?.find((x) => x.id === printing.id) ?? printing;
    return <IssueVoucher issue={i} project={project} store={md.stores?.find((s) => s.id === i.storeId)} activity={activities?.find((a) => a.id === i.activityId)} requisition={reqs?.find((r) => r.id === i.requisitionId)} matById={md.matById} onBack={() => setPrinting(null)} />;
  }

  return (
    <>
      <PageHeader title="Issues & requisitions" description="Subcontractors requisition material against an approved work order; the store issues it on a voucher, which the subcontractor's representative acknowledges." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'vouchers', label: `Issue vouchers${issues ? ` (${issues.length})` : ''}` }, { value: 'requisitions', label: `Requisitions${reqs ? ` (${reqs.filter((r) => r.status === 'SUBMITTED').length} pending)` : ''}` }]} />
      {tab === 'requisitions'
        ? <Requisitions projectId={projectId} can={can} md={md} reqs={reqs} subName={subName} woNo={woNo} actName={actName} reqBalance={reqBalance} />
        : <Vouchers projectId={projectId} can={can} md={md} issues={issues} reqs={reqs} actName={actName} reqBalance={reqBalance} onPrint={setPrinting} />}
    </>
  );
}

type MD = ReturnType<typeof useMaterialData>;
type Can = ReturnType<typeof useAuth>['can'];

/** Approved work orders of a subcontractor, and the selected work order's activities. */
function useWoPicker(md: MD, subcontractorId: string, workOrderId: string) {
  const wos = (md.wos ?? []).filter((w) => w.subcontractorId === subcontractorId && w.status === 'APPROVED');
  const { data: wo } = useApi<any>(workOrderId ? `/work-orders/${workOrderId}` : null);
  const acts: any[] = wo ? [...new Map((wo.items as any[]).map((i) => [i.activity.id, i.activity])).values()] : [];
  return { wos, wo, acts };
}

function Requisitions({ projectId, can, md, reqs, subName, woNo, actName, reqBalance }: { projectId: string; can: Can; md: MD; reqs?: any[]; subName: (id: string) => string; woNo: (id: string) => string; actName: (id?: string | null) => string | null; reqBalance: (r: any, m: string) => Decimal }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ date: isoDate(), subcontractorId: '', workOrderId: '', activityId: '', purpose: '' });
  const [lines, setLines] = useState<ReqLine[]>([blankReq()]);
  const { wos, acts } = useWoPicker(md, f.subcontractorId, f.workOrderId);
  const create = useAction(() => api.post(`/projects/${projectId}/requisitions`, { date: f.date, subcontractorId: f.subcontractorId, workOrderId: f.workOrderId, activityId: f.activityId || undefined, purpose: f.purpose || undefined, lines }), { onSuccess: () => { setOpen(false); setLines([blankReq()]); } });
  const [decide, setDecide] = useState<{ r: any; action: 'approve' | 'reject' } | null>(null);
  const [comment, setComment] = useState('');
  const act = useAction((d: { id: string; action: string; comment: string }) => api.post(`/requisitions/${d.id}/${d.action}`, { comment: d.comment || undefined }), { onSuccess: () => setDecide(null) });
  const canApprove = can('material.approve', { projectId });

  return (
    <>
      <div className="mb-3 flex justify-end">{can('material.requisition', { projectId }) && <Button variant="primary" onClick={() => { create.reset(); setOpen(true); }}><Plus className="size-4" /> New requisition</Button>}</div>
      <Sheet flush>
        <Table rows={reqs} rowKey={(r) => r.id} empty="No requisitions yet." cols={[
          { key: 'no', header: 'Requisition', cell: (r) => <div><div className="font-medium">{r.reqNo}</div><div className="text-xs text-ink-soft">{date(r.date)}</div></div> },
          { key: 's', header: 'Subcontractor / work order', cell: (r) => <div><div>{subName(r.subcontractorId)}</div><div className="text-xs text-ink-soft">{woNo(r.workOrderId)}{r.activityId ? ` · ${actName(r.activityId)}` : ''}</div></div> },
          { key: 'p', header: 'Purpose', cell: (r) => r.purpose || <span className="text-ink-soft">—</span> },
          { key: 'l', header: 'Materials (requested · balance to issue)', cell: (r) => (
            <ul className="space-y-0.5">{(r.lines as ReqLine[]).map((l, i) => { const m = md.matById(l.materialId); const bal = reqBalance(r, l.materialId); return <li key={i}><span className="font-medium">{m?.code ?? '…'}</span> <Qty m={m} q={l.quantity} inline />{r.status === 'APPROVED' && <span className={bal.gt(0) ? 'text-ink-soft' : 'text-green'}> · {bal.gt(0) ? `${num(bal.toString())} to issue` : 'fully issued'}</span>}</li>; })}</ul>
          ) },
          { key: 'st', header: 'Status', cell: (r) => <Status value={r.status} label={r.status === 'SUBMITTED' ? 'Pending approval' : undefined} /> },
          { key: 'a', header: '', align: 'right', cell: (r) => (r.status === 'SUBMITTED' && canApprove ? (
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="primary" onClick={() => { act.reset(); setComment(''); setDecide({ r, action: 'approve' }); }}>Approve</Button>
              <Button size="sm" variant="danger" onClick={() => { act.reset(); setComment(''); setDecide({ r, action: 'reject' }); }}>Reject</Button>
            </div>
          ) : null) },
        ]} />
      </Sheet>

      <Dialog open={!!decide} onClose={() => setDecide(null)} title={decide?.action === 'approve' ? `Approve requisition ${decide?.r.reqNo}` : `Reject requisition ${decide?.r.reqNo}`}
        footer={<><Button onClick={() => setDecide(null)}>Cancel</Button><Button variant={decide?.action === 'approve' ? 'primary' : 'danger'} busy={act.isPending} onClick={() => decide && act.mutate({ id: decide.r.id, action: decide.action, comment })}>{decide?.action === 'approve' ? 'Approve requisition' : 'Reject requisition'}</Button></>}>
        <div className="grid gap-3">
          {act.error ? <Notice error={act.error} /> : null}
          <Field label={decide?.action === 'reject' ? 'Reason for rejection' : 'Comment (optional)'}><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        </div>
      </Dialog>

      <Dialog wide open={open} onClose={() => setOpen(false)} title="New requisition"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={create.isPending} onClick={() => create.mutate(undefined)}>Submit requisition</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {create.error ? <div className="sm:col-span-2"><Notice error={create.error} /></div> : null}
          <Field label="Subcontractor"><Select value={f.subcontractorId} onChange={(e) => setF({ ...f, subcontractorId: e.target.value, workOrderId: '', activityId: '' })}><option value="">Select subcontractor</option>{md.subs?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Approved work order" hint={f.subcontractorId && !wos.length ? 'This subcontractor has no approved work order on the project' : undefined}><Select value={f.workOrderId} disabled={!f.subcontractorId} onChange={(e) => setF({ ...f, workOrderId: e.target.value, activityId: '' })}><option value="">Select work order</option>{wos.map((w) => <option key={w.id} value={w.id}>{w.woNo} · {w.title}</option>)}</Select></Field>
          <Field label="Activity (optional)"><Select value={f.activityId} disabled={!f.workOrderId} onChange={(e) => setF({ ...f, activityId: e.target.value })}><option value="">Not specific to an activity</option>{acts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Purpose (optional)" className="sm:col-span-2"><Input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="e.g. Raft slab pour, valve chamber VC-3" /></Field>
          <div className="sm:col-span-2">
            <LineEditor lines={lines} onChange={setLines} blank={blankReq} cols={[
              { header: 'Material', width: '260px', cell: (l, set) => <Select aria-label="Material" value={l.materialId} onChange={(e) => set({ materialId: e.target.value })}><MaterialOptions materials={md.materials} filter={(m) => m.defaultBasis !== 'SUBCONTRACTOR_SUPPLIED'} /></Select> },
              { header: 'Quantity', width: '140px', cell: (l, set) => { const m = md.matById(l.materialId); const a = altQty(m, l.quantity); return <div><Input aria-label="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => set({ quantity: e.target.value })} />{m && <div className="mt-0.5 text-right text-xs text-ink-soft">{unitLabel(m.unit)}{a && ` = ${num(a)} ${unitLabel(m.altUnit!)}`}</div>}</div>; } },
            ]} />
          </div>
        </div>
      </Dialog>
    </>
  );
}

function Vouchers({ projectId, can, md, issues, reqs, actName, reqBalance, onPrint }: { projectId: string; can: Can; md: MD; issues?: any[]; reqs?: any[]; actName: (id?: string | null) => string | null; reqBalance: (r: any, m: string) => Decimal; onPrint: (i: any) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ storeId: '', date: isoDate(), subcontractorId: '', workOrderId: '', activityId: '', requisitionId: '', receivedByName: '', remarks: '' });
  const [lines, setLines] = useState<IssLine[]>([blankIss()]);
  const { wos, wo, acts } = useWoPicker(md, f.subcontractorId, f.workOrderId);
  const { data: stock } = useApi<any[]>(f.storeId ? `/projects/${projectId}/stock?storeId=${f.storeId}` : null);
  const stockOf = (materialId: string) => stock?.find((s) => s.material.id === materialId);
  const openReqs = (reqs ?? []).filter((r) => r.status === 'APPROVED' && r.workOrderId === f.workOrderId && (r.lines as ReqLine[]).some((l) => reqBalance(r, l.materialId).gt(0)));

  const pickReq = (id: string) => {
    setF({ ...f, requisitionId: id, activityId: id ? reqs?.find((r) => r.id === id)?.activityId ?? f.activityId : f.activityId });
    const r = reqs?.find((x) => x.id === id);
    if (r) setLines((r.lines as ReqLine[]).map((l) => ({ ...blankIss(), materialId: l.materialId, quantity: Decimal0(reqBalance(r, l.materialId)) })).filter((l) => D(l.quantity).gt(0)));
  };

  const save = useAction(() => api.post(`/projects/${projectId}/issues`, {
    storeId: f.storeId, date: f.date, subcontractorId: f.subcontractorId, workOrderId: f.workOrderId, activityId: f.activityId || null, requisitionId: f.requisitionId || null,
    receivedByName: f.receivedByName || undefined, remarks: f.remarks || undefined,
    lines: lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity, basis: l.basis || defaultBasis(wo, md.matById(l.materialId)), issueRate: l.issueRate || null, recoveryRate: l.recoveryRate || null, recoveryTerms: l.recoveryTerms || null, batchNo: l.batchNo || null })),
  }), { onSuccess: (i: any) => { setOpen(false); setLines([blankIss()]); setF({ ...f, requisitionId: '', receivedByName: '', remarks: '' }); onPrint(i); } });

  const [ack, setAck] = useState<any>(null);
  const [ackName, setAckName] = useState('');
  const doAck = useAction((d: { id: string; name: string }) => api.post(`/issues/${d.id}/acknowledge`, { receivedByName: d.name }), { onSuccess: () => setAck(null) });
  const [cancel, setCancel] = useState<any>(null);
  const [reason, setReason] = useState('');
  const doCancel = useAction((d: { id: string; reason: string }) => api.post(`/issues/${d.id}/cancel`, { reason: d.reason }), { onSuccess: () => setCancel(null) });
  const canIssue = can('material.issue', { projectId });
  const canCancel = can('material.approve', { projectId });

  return (
    <>
      <div className="mb-3 flex justify-end">{canIssue && <Button variant="primary" onClick={() => { save.reset(); setF({ ...f, storeId: f.storeId || md.stores?.[0]?.id || '' }); setOpen(true); }}><Plus className="size-4" /> Issue material</Button>}</div>
      <Sheet flush>
        <Table rows={issues} rowKey={(r) => r.id} empty="No material issued yet." rowClassName={(r) => (r.status === 'CANCELLED' ? 'opacity-60' : undefined)} cols={[
          { key: 'no', header: 'Voucher', cell: (r) => <div><div className="font-medium">{r.voucherNo}</div><div className="text-xs text-ink-soft">{date(r.date)}</div></div> },
          { key: 's', header: 'Subcontractor / work order', cell: (r) => <div><div>{r.subcontractor?.name}</div><div className="text-xs text-ink-soft">{r.workOrder?.woNo}{r.activityId ? ` · ${actName(r.activityId)}` : ''}</div></div> },
          { key: 'l', header: 'Materials', cell: (r) => <ul className="space-y-0.5">{(r.lines as any[]).map((l) => { const m = md.matById(l.materialId); return <li key={l.id}><span className="font-medium">{m?.code ?? '…'}</span> <Qty m={m} q={l.quantity} inline /> <span className="text-ink-soft">· {basisLabel(l.basis)}</span></li>; })}</ul> },
          { key: 'v', header: 'Value', align: 'right', cell: (r) => inr((r.lines as any[]).reduce((s, l) => s.plus(l.issueValue), D(0)).toString()) },
          { key: 'rb', header: 'Received by', cell: (r) => r.receivedByName || <span className="text-ink-soft">—</span> },
          { key: 'st', header: 'Status', cell: (r) => <Status value={r.status} label={r.status === 'ISSUED' ? 'Awaiting acknowledgement' : undefined} /> },
          { key: 'a', header: '', align: 'right', cell: (r) => (
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => onPrint(r)}><Printer className="size-3.5" /> Voucher</Button>
              {r.status === 'ISSUED' && canIssue && <Button size="sm" onClick={() => { doAck.reset(); setAckName(r.receivedByName ?? ''); setAck(r); }}>Acknowledge</Button>}
              {r.status === 'ISSUED' && canCancel && <Button size="sm" variant="danger" onClick={() => { doCancel.reset(); setReason(''); setCancel(r); }}>Cancel</Button>}
            </div>
          ) },
        ]} />
      </Sheet>

      <Dialog open={!!ack} onClose={() => setAck(null)} title={`Acknowledge ${ack?.voucherNo ?? ''}`}
        footer={<><Button onClick={() => setAck(null)}>Cancel</Button><Button variant="primary" busy={doAck.isPending} onClick={() => doAck.mutate({ id: ack.id, name: ackName })}>Record acknowledgement</Button></>}>
        <div className="grid gap-3">
          {doAck.error ? <Notice error={doAck.error} /> : null}
          <p className="text-[13px] text-ink-soft">Record that the subcontractor's representative received the material on this voucher. An acknowledged voucher can no longer be cancelled; unused material must come back on a return.</p>
          <Field label="Received by (name)"><Input value={ackName} onChange={(e) => setAckName(e.target.value)} /></Field>
        </div>
      </Dialog>
      <Dialog open={!!cancel} onClose={() => setCancel(null)} title={`Cancel ${cancel?.voucherNo ?? ''}`}
        footer={<><Button onClick={() => setCancel(null)}>Keep voucher</Button><Button variant="danger" busy={doCancel.isPending} onClick={() => doCancel.mutate({ id: cancel.id, reason })}>Cancel voucher</Button></>}>
        <div className="grid gap-3">
          {doCancel.error ? <Notice error={doCancel.error} /> : null}
          <p className="text-[13px] text-ink-soft">The material goes back into store stock and the voucher no longer counts against the subcontractor.</p>
          <Field label="Reason" hint="At least 5 characters"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Dialog>

      <Dialog wide open={open} onClose={() => setOpen(false)} title="Issue material"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate(undefined)}>Issue material</Button></>}>
        <div className="grid gap-3 sm:grid-cols-3">
          {save.error ? <div className="sm:col-span-3"><Notice error={save.error} /></div> : null}
          <Field label="Store"><Select value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}><option value="">Select store</option>{md.stores?.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select></Field>
          <Field label="Date of issue"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Received by (name)" hint="Subcontractor's representative"><Input value={f.receivedByName} onChange={(e) => setF({ ...f, receivedByName: e.target.value })} /></Field>
          <Field label="Subcontractor"><Select value={f.subcontractorId} onChange={(e) => setF({ ...f, subcontractorId: e.target.value, workOrderId: '', activityId: '', requisitionId: '' })}><option value="">Select subcontractor</option>{md.subs?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Approved work order" hint={f.subcontractorId && !wos.length ? 'No approved work order for this subcontractor' : wo ? `Material responsibility: ${wo.materialResponsibility.replace(/_/g, ' ').toLowerCase()}` : undefined}>
            <Select value={f.workOrderId} disabled={!f.subcontractorId} onChange={(e) => setF({ ...f, workOrderId: e.target.value, activityId: '', requisitionId: '' })}><option value="">Select work order</option>{wos.map((w) => <option key={w.id} value={w.id}>{w.woNo} · {w.title}</option>)}</Select>
          </Field>
          <Field label="Activity (optional)"><Select value={f.activityId} disabled={!f.workOrderId} onChange={(e) => setF({ ...f, activityId: e.target.value })}><option value="">Not specific to an activity</option>{acts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></Field>
          <Field label="Against requisition (optional)" className="sm:col-span-3" hint={f.workOrderId && !openReqs.length ? 'No approved requisition with a balance on this work order' : 'Choosing one fills the lines with its unissued balance'}>
            <Select value={f.requisitionId} disabled={!f.workOrderId} onChange={(e) => pickReq(e.target.value)}><option value="">No requisition</option>{openReqs.map((r) => <option key={r.id} value={r.id}>{r.reqNo} · {date(r.date)}{r.purpose ? ` · ${r.purpose}` : ''}</option>)}</Select>
          </Field>
          {wo?.materialResponsibility === 'SUBCONTRACTOR' && <div className="sm:col-span-3"><Notice tone="warning" title="Material is the subcontractor's responsibility on this work order">Issue only what is agreed as an exception, on a recoverable basis.</Notice></div>}
          <div className="sm:col-span-3">
            <LineEditor lines={lines} onChange={setLines} blank={blankIss} cols={[
              { header: 'Material', width: '220px', cell: (l, set) => {
                const m = md.matById(l.materialId); const s = stockOf(l.materialId);
                return <div>
                  <Select aria-label="Material" value={l.materialId} onChange={(e) => set({ materialId: e.target.value, basis: '' })}><MaterialOptions materials={md.materials} filter={(x) => x.defaultBasis !== 'SUBCONTRACTOR_SUPPLIED'} /></Select>
                  {m && f.storeId && <div className={`mt-0.5 text-xs ${s && l.quantity && D(s.quantity).lt(safe(l.quantity)) ? 'text-red' : 'text-ink-soft'}`}>In store: {num(s?.quantity ?? 0)} {unitLabel(m.unit)}{s?.altQuantity ? ` (${num(s.altQuantity)} ${unitLabel(m.altUnit!)})` : ''}</div>}
                </div>;
              } },
              { header: 'Quantity', width: '110px', cell: (l, set) => { const m = md.matById(l.materialId); const a = altQty(m, l.quantity); return <div><Input aria-label="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => set({ quantity: e.target.value })} />{m && <div className="mt-0.5 text-right text-xs text-ink-soft">{unitLabel(m.unit)}{a && ` = ${num(a)} ${unitLabel(m.altUnit!)}`}</div>}</div>; } },
              { header: 'Supply basis', width: '150px', cell: (l, set) => { const m = md.matById(l.materialId); const def = defaultBasis(wo, m); return <Select aria-label="Supply basis" value={l.basis || def} onChange={(e) => set({ basis: e.target.value === def ? '' : e.target.value })}>{BASES.filter(([k]) => k !== 'SUBCONTRACTOR_SUPPLIED').map(([k, lab]) => <option key={k} value={k}>{lab}{k === def ? ' (default)' : ''}</option>)}</Select>; } },
              { header: 'Issue rate', width: '110px', cell: (l, set) => { const s = stockOf(l.materialId); const m = md.matById(l.materialId); const avg = s && D(s.avgRate).gt(0) ? s.avgRate : m?.standardRate; return <div><Input aria-label="Issue rate" inputMode="decimal" value={l.issueRate} placeholder={avg ? num(avg, 2) : ''} onChange={(e) => set({ issueRate: e.target.value })} /><div className="mt-0.5 text-right text-xs text-ink-soft">Blank = weighted avg</div></div>; } },
              { header: 'Recovery rate', width: '110px', cell: (l, set) => { const m = md.matById(l.materialId); const basis = l.basis || defaultBasis(wo, m); return <div><Input aria-label="Recovery rate" inputMode="decimal" value={l.recoveryRate} placeholder={basis === 'RECOVERABLE' ? 'Issue rate' : '0'} onChange={(e) => set({ recoveryRate: e.target.value })} /><div className="mt-0.5 text-right text-xs text-ink-soft">{basis === 'RECOVERABLE' ? 'Blank = issue rate' : 'Not recovered'}</div></div>; } },
              { header: 'Recovery terms', width: '140px', cell: (l, set) => <Input aria-label="Recovery terms" value={l.recoveryTerms} placeholder="e.g. Penal 1.5× beyond 2%" onChange={(e) => set({ recoveryTerms: e.target.value })} /> },
              { header: 'Batch / heat', width: '100px', cell: (l, set) => { const m = md.matById(l.materialId); return <Input aria-label="Batch" value={l.batchNo} placeholder={m?.batchTracked ? 'Required' : 'Optional'} className={m?.batchTracked && !l.batchNo ? 'border-amber' : ''} onChange={(e) => set({ batchNo: e.target.value })} />; } },
            ]} />
          </div>
          <Field label="Remarks (optional)" className="sm:col-span-3"><Textarea value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        </div>
      </Dialog>
    </>
  );
}

const safe = (v: string) => { try { return D(v); } catch { return D(0); } };
const Decimal0 = (d: Decimal) => (d.gt(0) ? d.toString() : '0');
