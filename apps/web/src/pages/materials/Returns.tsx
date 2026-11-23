import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { D } from '@epc/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { date, inr, isoDate, num, unitLabel } from '../../lib/format';
import { Button, Dialog, Field, Input, Notice, PageHeader, Select, Sheet, Table, Tabs, Tag, Textarea } from '../../components/ui';
import { altQty, CONDITIONS, conditionLabel, LineEditor, MaterialOptions, Qty, useMaterialData } from '../../components/materials/common';

type RetLine = { materialId: string; quantity: string; condition: string; batchNo: string };
type TrLine = { materialId: string; quantity: string; batchNo: string };
const blankRet = (): RetLine => ({ materialId: '', quantity: '', condition: 'GOOD', batchNo: '' });
const blankTr = (): TrLine => ({ materialId: '', quantity: '', batchNo: '' });

/** Material currently held by a subcontractor on a work order, by material (from the contractor ledger). */
function useHeld(projectId: string, subcontractorId: string, workOrderId: string) {
  const { data } = useApi<any[]>(subcontractorId && workOrderId ? `/projects/${projectId}/contractor-ledger?subcontractorId=${subcontractorId}&workOrderId=${workOrderId}` : null);
  return useMemo(() => { const m = new Map<string, string>(); for (const e of data ?? []) m.set(e.materialId, e.balance); return data ? m : undefined; }, [data]);
}

export function Returns() {
  const { projectId, companyId } = useProject();
  const { can } = useAuth();
  const md = useMaterialData(projectId, companyId);
  const { data } = useApi<any[]>(`/projects/${projectId}/returns`);
  const [tab, setTab] = useState<'returns' | 'transfers'>('returns');
  const returns = data?.filter((r) => !r.transferToIssueId);
  const transfers = data?.filter((r) => r.transferToIssueId);
  const canIssue = can('material.issue', { projectId });
  const woNo = (id: string) => md.wos?.find((w) => w.id === id)?.woNo ?? '…';
  const storeName = (id: string) => md.stores?.find((s) => s.id === id)?.name ?? '…';

  return (
    <>
      <PageHeader title="Returns & transfers" description="Material coming back from subcontractors to the store, and material moved from one subcontractor or work order to another without passing through stock." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'returns', label: `Returns${returns ? ` (${returns.length})` : ''}` }, { value: 'transfers', label: `Transfers${transfers ? ` (${transfers.length})` : ''}` }]} />
      {tab === 'returns' ? (
        <ReturnsTab projectId={projectId} canIssue={canIssue} md={md} rows={returns} woNo={woNo} storeName={storeName} />
      ) : (
        <TransfersTab projectId={projectId} canIssue={canIssue} md={md} rows={transfers} woNo={woNo} />
      )}
    </>
  );
}

type MD = ReturnType<typeof useMaterialData>;

function ReturnsTab({ projectId, canIssue, md, rows, woNo, storeName }: { projectId: string; canIssue: boolean; md: MD; rows?: any[]; woNo: (id: string) => string; storeName: (id: string) => string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ storeId: '', date: isoDate(), subcontractorId: '', workOrderId: '', receivedByName: '', remarks: '' });
  const [lines, setLines] = useState<RetLine[]>([blankRet()]);
  const wos = (md.wos ?? []).filter((w) => w.subcontractorId === f.subcontractorId);
  const held = useHeld(projectId, f.subcontractorId, f.workOrderId);
  const save = useAction(() => api.post(`/projects/${projectId}/returns`, { ...f, remarks: f.remarks || undefined, lines: lines.map((l) => ({ ...l, batchNo: l.batchNo || null })) }), { onSuccess: () => { setOpen(false); setLines([blankRet()]); setF({ ...f, remarks: '' }); } });
  const notRestocked = lines.some((l) => !CONDITIONS.find(([k]) => k === l.condition)?.[2]);

  return (
    <>
      <div className="mb-3 flex justify-end">{canIssue && <Button variant="primary" onClick={() => { save.reset(); setF({ ...f, storeId: f.storeId || md.stores?.[0]?.id || '' }); setOpen(true); }}><Plus className="size-4" /> Record return</Button>}</div>
      <Sheet flush>
        <Table rows={rows} rowKey={(r) => r.id} empty="No returns recorded yet." cols={[
          { key: 'no', header: 'Return voucher', cell: (r) => <div><div className="font-medium">{r.voucherNo}</div><div className="text-xs text-ink-soft">{date(r.date)}</div></div> },
          { key: 's', header: 'Subcontractor / work order', cell: (r) => <div><div>{r.subcontractor?.name}</div><div className="text-xs text-ink-soft">{woNo(r.workOrderId)}</div></div> },
          { key: 'st', header: 'Store', cell: (r) => storeName(r.storeId) },
          { key: 'l', header: 'Materials', cell: (r) => <ul className="space-y-0.5">{(r.lines as any[]).map((l) => { const m = md.matById(l.materialId); return <li key={l.id}><span className="font-medium">{m?.code ?? '…'}</span> <Qty m={m} q={l.quantity} inline /> <Tag tone={l.restock ? 'green' : 'amber'}>{conditionLabel(l.condition)}{l.restock ? '' : ', not restocked'}</Tag></li>; })}</ul> },
          { key: 'v', header: 'Value at issue rate', align: 'right', cell: (r) => inr((r.lines as any[]).reduce((s, l) => s.plus(D(l.quantity).times(l.rate)), D(0)).toDecimalPlaces(2).toString()) },
          { key: 'rb', header: 'Received by', cell: (r) => r.receivedByName },
        ]} />
      </Sheet>

      <Dialog wide open={open} onClose={() => setOpen(false)} title="Record return"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate(undefined)}>Record return</Button></>}>
        <div className="grid gap-3 sm:grid-cols-3">
          {save.error ? <div className="sm:col-span-3"><Notice error={save.error} /></div> : null}
          <Field label="Store receiving"><Select value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}><option value="">Select store</option>{md.stores?.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select></Field>
          <Field label="Date of return"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Received by (store)"><Input value={f.receivedByName} onChange={(e) => setF({ ...f, receivedByName: e.target.value })} /></Field>
          <Field label="Subcontractor"><Select value={f.subcontractorId} onChange={(e) => setF({ ...f, subcontractorId: e.target.value, workOrderId: '' })}><option value="">Select subcontractor</option>{md.subs?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Work order" className="sm:col-span-2"><Select value={f.workOrderId} disabled={!f.subcontractorId} onChange={(e) => setF({ ...f, workOrderId: e.target.value })}><option value="">Select work order</option>{wos.map((w) => <option key={w.id} value={w.id}>{w.woNo} · {w.title}</option>)}</Select></Field>
          <div className="sm:col-span-3">
            <LineEditor lines={lines} onChange={setLines} blank={blankRet} cols={[
              { header: 'Material', width: '240px', cell: (l, set) => { const m = md.matById(l.materialId); const h = held?.get(l.materialId); return <div><Select aria-label="Material" value={l.materialId} onChange={(e) => set({ materialId: e.target.value })}><MaterialOptions materials={md.materials} /></Select>{m && held && <div className="mt-0.5 text-xs text-ink-soft">Held by subcontractor on this work order: {num(h ?? 0)} {unitLabel(m.unit)}</div>}</div>; } },
              { header: 'Quantity', width: '120px', cell: (l, set) => { const m = md.matById(l.materialId); const a = altQty(m, l.quantity); return <div><Input aria-label="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => set({ quantity: e.target.value })} />{m && <div className="mt-0.5 text-right text-xs text-ink-soft">{unitLabel(m.unit)}{a && ` = ${num(a)} ${unitLabel(m.altUnit!)}`}</div>}</div>; } },
              { header: 'Condition', width: '150px', cell: (l, set) => <Select aria-label="Condition" value={l.condition} onChange={(e) => set({ condition: e.target.value })}>{CONDITIONS.map(([k, lab, restock]) => <option key={k} value={k}>{lab}{restock ? '' : ' (not restocked)'}</option>)}</Select> },
              { header: 'Batch / heat', width: '110px', cell: (l, set) => <Input aria-label="Batch" value={l.batchNo} onChange={(e) => set({ batchNo: e.target.value })} placeholder={md.matById(l.materialId)?.batchTracked ? 'Batch issued' : 'Optional'} /> },
            ]} />
          </div>
          <div className="sm:col-span-3">
            <Notice tone={notRestocked ? 'warning' : 'info'} title="Only good and excess material goes back into stock">
              Damaged, rejected and scrap material is recorded against the subcontractor's balance but is not added to usable store stock. Damaged returns are flagged in the reconciliation as recoverable at the issue rate.
            </Notice>
          </div>
          <Field label="Remarks (optional)" className="sm:col-span-3"><Textarea value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        </div>
      </Dialog>
    </>
  );
}

function TransfersTab({ projectId, canIssue, md, rows, woNo }: { projectId: string; canIssue: boolean; md: MD; rows?: any[]; woNo: (id: string) => string }) {
  const { data: issues } = useApi<any[]>(`/projects/${projectId}/issues`);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ storeId: '', date: isoDate(), fromSubcontractorId: '', fromWorkOrderId: '', toSubcontractorId: '', toWorkOrderId: '', receivedByName: '', remarks: '' });
  const [lines, setLines] = useState<TrLine[]>([blankTr()]);
  const fromWos = (md.wos ?? []).filter((w) => w.subcontractorId === f.fromSubcontractorId);
  const toWos = (md.wos ?? []).filter((w) => w.subcontractorId === f.toSubcontractorId && w.status === 'APPROVED' && w.id !== f.fromWorkOrderId);
  const held = useHeld(projectId, f.fromSubcontractorId, f.fromWorkOrderId);
  const save = useAction(() => api.post(`/projects/${projectId}/transfers`, { ...f, remarks: f.remarks || undefined, lines: lines.map((l) => ({ ...l, batchNo: l.batchNo || null })) }), { onSuccess: () => { setOpen(false); setLines([blankTr()]); setF({ ...f, remarks: '' }); } });

  return (
    <>
      <div className="mb-3 flex justify-end">{canIssue && <Button variant="primary" onClick={() => { save.reset(); setF({ ...f, storeId: f.storeId || md.stores?.[0]?.id || '' }); setOpen(true); }}><Plus className="size-4" /> Transfer material</Button>}</div>
      <Sheet flush>
        <Table rows={rows} rowKey={(r) => r.id} empty="No transfers recorded yet." cols={[
          { key: 'no', header: 'Vouchers', cell: (r) => { const iss = issues?.find((i) => i.id === r.transferToIssueId); return <div><div className="font-medium">{r.voucherNo} / {iss?.voucherNo ?? '…'}</div><div className="text-xs text-ink-soft">{date(r.date)}</div></div>; } },
          { key: 'f', header: 'From', cell: (r) => <div><div>{r.subcontractor?.name}</div><div className="text-xs text-ink-soft">{woNo(r.workOrderId)}</div></div> },
          { key: 't', header: 'To', cell: (r) => { const iss = issues?.find((i) => i.id === r.transferToIssueId); return iss ? <div><div>{iss.subcontractor?.name}</div><div className="text-xs text-ink-soft">{iss.workOrder?.woNo}</div></div> : '…'; } },
          { key: 'l', header: 'Materials', cell: (r) => <ul className="space-y-0.5">{(r.lines as any[]).map((l) => { const m = md.matById(l.materialId); return <li key={l.id}><span className="font-medium">{m?.code ?? '…'}</span> <Qty m={m} q={l.quantity} inline /></li>; })}</ul> },
          { key: 'v', header: 'Value', align: 'right', cell: (r) => inr((r.lines as any[]).reduce((s, l) => s.plus(D(l.quantity).times(l.rate)), D(0)).toDecimalPlaces(2).toString()) },
          { key: 'rb', header: 'Received by', cell: (r) => r.receivedByName },
        ]} />
      </Sheet>

      <Dialog wide open={open} onClose={() => setOpen(false)} title="Transfer material"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate(undefined)}>Transfer material</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {save.error ? <div className="sm:col-span-2"><Notice error={save.error} /></div> : null}
          <p className="text-[13px] text-ink-soft sm:col-span-2">A transfer is recorded as a return from the source (at its issue rate) and an issue to the destination, linked to each other. The destination work order must be approved.</p>
          <fieldset className="grid gap-3 rounded-[3px] border border-rule p-3">
            <legend className="px-1 text-[13px] font-semibold">From</legend>
            <Field label="Subcontractor"><Select value={f.fromSubcontractorId} onChange={(e) => setF({ ...f, fromSubcontractorId: e.target.value, fromWorkOrderId: '' })}><option value="">Select subcontractor</option>{md.subs?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Work order"><Select value={f.fromWorkOrderId} disabled={!f.fromSubcontractorId} onChange={(e) => setF({ ...f, fromWorkOrderId: e.target.value })}><option value="">Select work order</option>{fromWos.map((w) => <option key={w.id} value={w.id}>{w.woNo} · {w.title}</option>)}</Select></Field>
          </fieldset>
          <fieldset className="grid gap-3 rounded-[3px] border border-rule p-3">
            <legend className="px-1 text-[13px] font-semibold">To</legend>
            <Field label="Subcontractor"><Select value={f.toSubcontractorId} onChange={(e) => setF({ ...f, toSubcontractorId: e.target.value, toWorkOrderId: '' })}><option value="">Select subcontractor</option>{md.subs?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Approved work order"><Select value={f.toWorkOrderId} disabled={!f.toSubcontractorId} onChange={(e) => setF({ ...f, toWorkOrderId: e.target.value })}><option value="">Select work order</option>{toWos.map((w) => <option key={w.id} value={w.id}>{w.woNo} · {w.title}</option>)}</Select></Field>
          </fieldset>
          <Field label="Store of record"><Select value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}><option value="">Select store</option>{md.stores?.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Received by (destination representative)" className="sm:col-span-2"><Input value={f.receivedByName} onChange={(e) => setF({ ...f, receivedByName: e.target.value })} /></Field>
          <div className="sm:col-span-2">
            <LineEditor lines={lines} onChange={setLines} blank={blankTr} cols={[
              { header: 'Material', width: '240px', cell: (l, set) => { const m = md.matById(l.materialId); return <div><Select aria-label="Material" value={l.materialId} onChange={(e) => set({ materialId: e.target.value })}><MaterialOptions materials={md.materials} /></Select>{m && held && <div className="mt-0.5 text-xs text-ink-soft">Held by source: {num(held.get(l.materialId) ?? 0)} {unitLabel(m.unit)}</div>}</div>; } },
              { header: 'Quantity', width: '120px', cell: (l, set) => { const m = md.matById(l.materialId); const a = altQty(m, l.quantity); return <div><Input aria-label="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => set({ quantity: e.target.value })} />{m && <div className="mt-0.5 text-right text-xs text-ink-soft">{unitLabel(m.unit)}{a && ` = ${num(a)} ${unitLabel(m.altUnit!)}`}</div>}</div>; } },
              { header: 'Batch / heat', width: '110px', cell: (l, set) => <Input aria-label="Batch" value={l.batchNo} onChange={(e) => set({ batchNo: e.target.value })} placeholder={md.matById(l.materialId)?.batchTracked ? 'Required' : 'Optional'} /> },
            ]} />
          </div>
          <Field label="Remarks (optional)" className="sm:col-span-2"><Textarea value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        </div>
      </Dialog>
    </>
  );
}
