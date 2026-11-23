import { useState } from 'react';
import { Plus } from 'lucide-react';
import { D } from '@epc/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { date, humanize, inr, num, unitLabel } from '../../lib/format';
import { Button, Dialog, Field, Input, Notice, PageHeader, Select, Sheet, Table, Tag } from '../../components/ui';
import { signedInr, altQty, matLabel, Qty, useMaterialData } from '../../components/materials/common';

const TXN_TONE: Record<string, 'green' | 'grey' | 'amber' | 'red' | 'teal' | 'blue'> = { RECEIPT: 'green', ISSUE: 'blue', RETURN: 'teal', TRANSFER_IN: 'teal', TRANSFER_OUT: 'blue', ADJUSTMENT: 'amber', SCRAP_OUT: 'red' };
const TXN_LABEL: Record<string, string> = { RECEIPT: 'Receipt', ISSUE: 'Issue', RETURN: 'Return', TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out', ADJUSTMENT: 'Adjustment', SCRAP_OUT: 'Not restocked' };

export function Stock() {
  const { projectId, companyId } = useProject();
  const { can } = useAuth();
  const { stores } = useMaterialData(projectId, companyId);
  const [storeId, setStoreId] = useState('');
  const { data: stock } = useApi<any[]>(`/projects/${projectId}/stock${storeId ? `?storeId=${storeId}` : ''}`);
  const [sel, setSel] = useState<{ storeId: string; materialId: string } | null>(null);
  const { data: ledger } = useApi<any[]>(sel ? `/projects/${projectId}/stock-ledger?storeId=${sel.storeId}&materialId=${sel.materialId}` : null);
  const selRow = stock?.find((r) => sel && r.storeId === sel.storeId && r.material.id === sel.materialId);

  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', name: '', location: '' });
  const create = useAction((b: typeof f) => api.post(`/projects/${projectId}/stores`, { code: b.code, name: b.name, location: b.location || undefined }), { onSuccess: (s: any) => { setOpen(false); setStoreId(s.id); setF({ code: '', name: '', location: '' }); } });

  const total = (stock ?? []).reduce((s, r) => s.plus(r.value), D(0));
  return (
    <>
      <PageHeader title="Stock" description="On-hand quantity and weighted-average value of each material by store. Select a row to see its stock ledger."
        actions={can('material.master', { projectId }) && <Button onClick={() => { create.reset(); setOpen(true); }}><Plus className="size-4" /> New store</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Store" className="w-full max-w-xs">
          <Select value={storeId} onChange={(e) => { setStoreId(e.target.value); setSel(null); }}>
            <option value="">All stores</option>
            {stores?.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </Select>
        </Field>
        {stores && !stores.length && <Notice tone="warning" title="No store yet">Create a store before recording receipts.</Notice>}
      </div>
      <Sheet flush>
        <Table rows={stock} rowKey={(r) => r.storeId + r.material.id} onRowClick={(r) => setSel({ storeId: r.storeId, materialId: r.material.id })}
          rowClassName={(r) => (sel && r.storeId === sel.storeId && r.material.id === sel.materialId ? 'bg-teal-wash' : undefined)}
          empty="No stock movements yet. Record a receipt to bring material into a store."
          cols={[
            { key: 'm', header: 'Material', cell: (r) => <div><div className="font-medium">{r.material.code}</div><div className="text-xs text-ink-soft">{r.material.name}</div></div> },
            { key: 's', header: 'Store', cell: (r) => r.store },
            { key: 'q', header: 'On hand', align: 'right', cell: (r) => <span className={D(r.quantity).lt(0) ? 'text-red' : ''}>{num(r.quantity)} <span className="text-ink-soft">{unitLabel(r.material.unit)}</span></span> },
            { key: 'a', header: 'In secondary unit', align: 'right', cell: (r) => (r.altQuantity !== null ? <span>{num(r.altQuantity)} <span className="text-ink-soft">{unitLabel(r.material.altUnit)}</span></span> : <span className="text-ink-soft">—</span>) },
            { key: 'r', header: 'Avg rate', align: 'right', cell: (r) => <span>{inr(r.avgRate)} <span className="text-ink-soft">/ {unitLabel(r.material.unit)}</span></span> },
            { key: 'v', header: 'Value', align: 'right', cell: (r) => inr(r.value) },
          ]}
          footer={stock && stock.length > 0 ? <tr><td className="px-3 py-2" colSpan={5}>Total stock value</td><td className="num px-3 py-2">{inr(total.toString())}</td></tr> : undefined} />
      </Sheet>

      {sel && (
        <Sheet className="mt-4" flush title={selRow ? <>Stock ledger · {matLabel(selRow.material)} <span className="font-normal text-ink-soft">at {selRow.store}</span></> : 'Stock ledger'}
          actions={<Button size="sm" variant="ghost" onClick={() => setSel(null)}>Close ledger</Button>}>
          <Table rows={ledger} rowKey={(t) => t.id} empty="No movements." cols={[
            { key: 'd', header: 'Date', cell: (t) => date(t.date) },
            { key: 'ty', header: 'Type', cell: (t) => <Tag tone={TXN_TONE[t.type] ?? 'grey'}>{TXN_LABEL[t.type] ?? humanize(t.type)}</Tag> },
            { key: 'ref', header: 'Reference', cell: (t) => <span className="font-medium">{t.refNo}</span> },
            { key: 'b', header: 'Batch', cell: (t) => t.batchNo ?? <span className="text-ink-soft">—</span> },
            { key: 'in', header: 'In', align: 'right', cell: (t) => (D(t.quantity).gt(0) ? <Qty m={selRow?.material} q={t.quantity} /> : '') },
            { key: 'out', header: 'Out', align: 'right', cell: (t) => (D(t.quantity).lt(0) ? <Qty m={selRow?.material} q={D(t.quantity).negated().toString()} /> : '') },
            { key: 'rate', header: 'Rate', align: 'right', cell: (t) => inr(t.rate) },
            { key: 'val', header: 'Value', align: 'right', cell: (t) => signedInr(t.value) },
            { key: 'bal', header: 'Balance', align: 'right', cell: (t) => <span className="font-medium"><Qty m={selRow?.material} q={t.balance} alt={altQty(selRow?.material, t.balance)} /></span> },
            { key: 'bv', header: 'Balance value', align: 'right', cell: (t) => inr(t.balanceValue) },
          ]} />
        </Sheet>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="New store" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={create.isPending} onClick={() => create.mutate(f)}>Create store</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {create.error ? <div className="sm:col-span-2"><Notice error={create.error} /></div> : null}
          <Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="e.g. PS-1" /></Field>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Pumping station store" /></Field>
          <Field label="Location (optional)" className="sm:col-span-2"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        </div>
      </Dialog>
    </>
  );
}
