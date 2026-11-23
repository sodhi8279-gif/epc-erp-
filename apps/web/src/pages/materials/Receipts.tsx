import { useState } from 'react';
import { Plus } from 'lucide-react';
import { D } from '@epc/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { date, inr, isoDate, unitLabel } from '../../lib/format';
import { Button, Dialog, Field, Input, Notice, PageHeader, Select, Sheet, Table, Textarea } from '../../components/ui';
import { altQty, LineEditor, MaterialOptions, Qty, useMaterialData } from '../../components/materials/common';

type Line = { materialId: string; quantity: string; rate: string; batchNo: string };
const blankLine = (): Line => ({ materialId: '', quantity: '', rate: '', batchNo: '' });
const amount = (l: { quantity: string; rate: string }) => { try { return D(l.quantity || 0).times(l.rate || 0); } catch { return D(0); } };

export function Receipts() {
  const { projectId, companyId } = useProject();
  const { can } = useAuth();
  const { materials, stores, matById } = useMaterialData(projectId, companyId);
  const { data } = useApi<any[]>(`/projects/${projectId}/receipts`);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ storeId: '', date: isoDate(), supplier: '', invoiceRef: '', remarks: '' });
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const save = useAction(() => api.post(`/projects/${projectId}/receipts`, {
    storeId: f.storeId, date: f.date, supplier: f.supplier || undefined, invoiceRef: f.invoiceRef || undefined, remarks: f.remarks || undefined,
    lines: lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity, rate: l.rate, batchNo: l.batchNo || null })),
  }), { onSuccess: () => { setOpen(false); setLines([blankLine()]); setF({ ...f, supplier: '', invoiceRef: '', remarks: '' }); } });
  const storeName = (id: string) => stores?.find((s) => s.id === id)?.name ?? '—';
  const total = lines.reduce((s, l) => s.plus(amount(l)), D(0));

  return (
    <>
      <PageHeader title="Material receipts" description="Goods received notes (GRN). Each receipt adds stock to a store at the invoice rate and updates the weighted-average rate."
        actions={can('material.receive', { projectId }) && <Button variant="primary" onClick={() => { save.reset(); setF({ ...f, storeId: f.storeId || stores?.[0]?.id || '' }); setOpen(true); }}><Plus className="size-4" /> Record receipt</Button>} />
      <Sheet flush>
        <Table rows={data} rowKey={(r) => r.id} empty="No receipts recorded yet." cols={[
          { key: 'no', header: 'GRN no.', cell: (r) => <span className="font-medium">{r.grnNo}</span> },
          { key: 'd', header: 'Date', cell: (r) => date(r.date) },
          { key: 's', header: 'Store', cell: (r) => storeName(r.storeId) },
          { key: 'sup', header: 'Supplier / invoice', cell: (r) => <div><div>{r.supplier || '—'}</div>{r.invoiceRef && <div className="text-xs text-ink-soft">Invoice {r.invoiceRef}</div>}</div> },
          { key: 'l', header: 'Materials', cell: (r) => (
            <ul className="space-y-0.5">{(r.lines as any[]).map((l, i) => { const m = matById(l.materialId); return <li key={i}><span className="font-medium">{m?.code ?? '…'}</span> <Qty m={m} q={l.quantity} inline /> @ {inr(l.rate)}{l.batchNo && <span className="text-ink-soft"> · batch {l.batchNo}</span>}</li>; })}</ul>
          ) },
          { key: 'v', header: 'Value', align: 'right', cell: (r) => inr((r.lines as any[]).reduce((s, l) => s.plus(amount(l)), D(0)).toString()) },
        ]} />
      </Sheet>

      <Dialog wide open={open} onClose={() => setOpen(false)} title="Record receipt"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate(undefined)}>Record receipt</Button></>}>
        <div className="grid gap-3 sm:grid-cols-4">
          {save.error ? <div className="sm:col-span-4"><Notice error={save.error} /></div> : null}
          <Field label="Store" className="sm:col-span-2"><Select value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}><option value="">Select store</option>{stores?.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</Select></Field>
          <Field label="Receipt date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Invoice / challan ref."><Input value={f.invoiceRef} onChange={(e) => setF({ ...f, invoiceRef: e.target.value })} /></Field>
          <Field label="Supplier" className="sm:col-span-4"><Input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></Field>
          <div className="sm:col-span-4">
            <LineEditor lines={lines} onChange={setLines} blank={blankLine} cols={[
              { header: 'Material', width: '240px', cell: (l, set) => <Select aria-label="Material" value={l.materialId} onChange={(e) => { const m = matById(e.target.value); set({ materialId: e.target.value, rate: l.rate || (m && D(m.standardRate).gt(0) ? m.standardRate : '') }); }}><MaterialOptions materials={materials} /></Select> },
              { header: 'Quantity', width: '130px', cell: (l, set) => { const m = matById(l.materialId); const a = altQty(m, l.quantity); return <div><Input aria-label="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => set({ quantity: e.target.value })} />{m && <div className="mt-0.5 text-right text-xs text-ink-soft">{unitLabel(m.unit)}{a && ` = ${a} ${unitLabel(m.altUnit!)}`}</div>}</div>; } },
              { header: 'Rate (₹ per unit)', width: '120px', cell: (l, set) => <Input aria-label="Rate" inputMode="decimal" value={l.rate} onChange={(e) => set({ rate: e.target.value })} /> },
              { header: 'Batch / heat no.', width: '120px', cell: (l, set) => { const m = matById(l.materialId); return <Input aria-label="Batch" value={l.batchNo} placeholder={m?.batchTracked ? 'Required' : 'Optional'} onChange={(e) => set({ batchNo: e.target.value })} />; } },
              { header: 'Amount', align: 'right', width: '110px', cell: (l) => <div className="num pt-2">{inr(amount(l).toString())}</div> },
            ]} />
            <div className="mt-1 text-right text-[13px]">Receipt value <span className="num ml-2 font-semibold">{inr(total.toString())}</span></div>
          </div>
          <Field label="Remarks (optional)" className="sm:col-span-4"><Textarea value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        </div>
      </Dialog>
    </>
  );
}
