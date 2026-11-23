import { useMemo, useState } from 'react';
import { D, type Decimal } from '@epc/shared';
import { useApi, useProject } from '../../lib/hooks';
import { date, inr } from '../../lib/format';
import { Empty, Field, PageHeader, Select, Sheet, Table, Tag } from '../../components/ui';
import { signedInr, basisLabel, conditionLabel, MaterialOptions, Qty, useMaterialData } from '../../components/materials/common';

const TYPE: Record<string, [string, 'blue' | 'teal' | 'amber']> = { ISSUE: ['Issue', 'blue'], RETURN: ['Return', 'teal'], TRANSFER_OUT: ['Transfer out', 'amber'] };

export function ContractorLedger() {
  const { projectId, companyId } = useProject();
  const md = useMaterialData(projectId, companyId);
  const [subId, setSubId] = useState('');
  const [woId, setWoId] = useState('');
  const [matId, setMatId] = useState('');
  const qs = new URLSearchParams({ subcontractorId: subId, ...(woId ? { workOrderId: woId } : {}), ...(matId ? { materialId: matId } : {}) });
  const { data } = useApi<any[]>(subId ? `/projects/${projectId}/contractor-ledger?${qs}` : null);
  const wos = (md.wos ?? []).filter((w) => w.subcontractorId === subId);

  const summary = useMemo(() => {
    const m = new Map<string, { materialId: string; material: any; issued: Decimal; returned: Decimal; value: Decimal; recoverable: Decimal; balance: string }>();
    for (const e of data ?? []) {
      const s = m.get(e.materialId) ?? { materialId: e.materialId, material: e.material, issued: D(0), returned: D(0), value: D(0), recoverable: D(0), balance: '0' };
      s.issued = s.issued.plus(e.qtyIn); s.returned = s.returned.plus(e.qtyOut); s.value = s.value.plus(e.value); s.recoverable = s.recoverable.plus(e.recoverableValue); s.balance = e.balance;
      m.set(e.materialId, s);
    }
    return [...m.values()];
  }, [data]);

  return (
    <>
      <PageHeader title="Contractor material ledger" description="Every issue, return and transfer of material for one subcontractor, in date order, with the running balance the subcontractor holds of each material." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Subcontractor"><Select value={subId} onChange={(e) => { setSubId(e.target.value); setWoId(''); }}><option value="">Select subcontractor</option>{md.subs?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Work order"><Select value={woId} disabled={!subId} onChange={(e) => setWoId(e.target.value)}><option value="">All work orders</option>{wos.map((w) => <option key={w.id} value={w.id}>{w.woNo} · {w.title}</option>)}</Select></Field>
        <Field label="Material"><Select value={matId} onChange={(e) => setMatId(e.target.value)}><MaterialOptions materials={md.materials} emptyLabel="All materials" /></Select></Field>
      </div>
      {!subId ? (
        <Empty title="Select a subcontractor">The ledger shows material issued to and returned by the subcontractor on this project.</Empty>
      ) : (
        <>
          <Sheet title="Balance by material" flush className="mb-4">
            <Table rows={data ? summary : undefined} rowKey={(s) => s.materialId} empty="No material issued to this subcontractor." cols={[
              { key: 'm', header: 'Material', cell: (s) => <div><div className="font-medium">{s.material.code}</div><div className="text-xs text-ink-soft">{s.material.name}</div></div> },
              { key: 'i', header: 'Issued', align: 'right', cell: (s) => <Qty m={md.matById(s.materialId)} q={s.issued.toString()} /> },
              { key: 'r', header: 'Returned / transferred out', align: 'right', cell: (s) => <Qty m={md.matById(s.materialId)} q={s.returned.toString()} /> },
              { key: 'b', header: 'Balance held', align: 'right', cell: (s) => <span className="font-semibold"><Qty m={md.matById(s.materialId)} q={s.balance} /></span> },
              { key: 'v', header: 'Net value', align: 'right', cell: (s) => signedInr(s.value.toDecimalPlaces(2).toString()) },
              { key: 'rv', header: 'Recoverable value issued', align: 'right', cell: (s) => inr(s.recoverable.toDecimalPlaces(2).toString()) },
            ]} />
            <p className="border-t border-rule-soft px-4 py-2 text-xs text-ink-soft">The balance held is material issued less returned. How much of it was consumed on approved work, and how much is excess, is settled in the material reconciliation.</p>
          </Sheet>
          <Sheet title="Ledger" flush>
            <Table rows={data} rowKey={(e, i) => `${e.voucherNo}-${e.materialId}-${i}`} empty="No movements." cols={[
              { key: 'd', header: 'Date', cell: (e) => date(e.date) },
              { key: 'v', header: 'Voucher', cell: (e) => <div><div className="font-medium">{e.voucherNo}</div>{e.workOrder && <div className="text-xs text-ink-soft">{e.workOrder}</div>}</div> },
              { key: 't', header: 'Type', cell: (e) => <div className="flex flex-wrap gap-1"><Tag tone={TYPE[e.type]?.[1] ?? 'grey'}>{TYPE[e.type]?.[0] ?? e.type}</Tag>{e.condition && e.condition !== 'GOOD' && <Tag tone="amber">{conditionLabel(e.condition)}</Tag>}{e.type === 'ISSUE' && e.status === 'ISSUED' && <Tag>Not acknowledged</Tag>}</div> },
              { key: 'm', header: 'Material', cell: (e) => <span title={e.material.name}>{e.material.code}</span> },
              { key: 'in', header: 'In', align: 'right', cell: (e) => (D(e.qtyIn).gt(0) ? <Qty m={md.matById(e.materialId)} q={e.qtyIn} /> : '') },
              { key: 'out', header: 'Out', align: 'right', cell: (e) => (D(e.qtyOut).gt(0) ? <Qty m={md.matById(e.materialId)} q={e.qtyOut} /> : '') },
              { key: 'bal', header: 'Balance', align: 'right', cell: (e) => <span className="font-medium"><Qty m={md.matById(e.materialId)} q={e.balance} /></span> },
              { key: 'r', header: 'Rate', align: 'right', cell: (e) => inr(e.rate) },
              { key: 'val', header: 'Value', align: 'right', cell: (e) => signedInr(e.value) },
              { key: 'b', header: 'Basis', cell: (e) => (e.basis ? basisLabel(e.basis) : <span className="text-ink-soft">—</span>) },
              { key: 'rv', header: 'Recoverable value', align: 'right', cell: (e) => (D(e.recoverableValue).gt(0) ? <span>{inr(e.recoverableValue)}<span className="block text-xs text-ink-soft">@ {inr(e.recoveryRate)}</span></span> : <span className="text-ink-soft">—</span>) },
            ]} />
          </Sheet>
        </>
      )}
    </>
  );
}
