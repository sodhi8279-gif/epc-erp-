import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { UNIT_CODES, UNITS } from '@epc/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCompany } from '../../lib/company';
import { useAction, useApi } from '../../lib/hooks';
import { humanize, inr, num, unitLabel } from '../../lib/format';
import { Button, Dialog, Empty, Field, Input, Notice, PageHeader, Select, Sheet, Status, Table, Tag } from '../../components/ui';
import { BASES, basisLabel, CATEGORIES, type Material } from '../../components/materials/common';

type Form = { code: string; name: string; category: string; unit: string; altUnit: string; altFactor: string; defaultBasis: string; standardRate: string; batchTracked: boolean; active: boolean };
const blank: Form = { code: '', name: '', category: 'CEMENT', unit: 'BAG', altUnit: '', altFactor: '', defaultBasis: 'RECOVERABLE', standardRate: '0', batchTracked: false, active: true };

export function MaterialMaster() {
  const { companyId, company } = useCompany();
  const { can } = useAuth();
  const { data } = useApi<Material[]>(companyId ? `/companies/${companyId}/materials` : null);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [edit, setEdit] = useState<Material | 'new' | null>(null);
  const [f, setF] = useState<Form>(blank);
  const canEdit = can('material.master', { companyId });

  const open = (m: Material | 'new') => {
    setEdit(m);
    save.reset();
    setF(m === 'new' ? blank : { code: m.code, name: m.name, category: m.category, unit: m.unit, altUnit: m.altUnit ?? '', altFactor: m.altFactor ?? '', defaultBasis: m.defaultBasis, standardRate: m.standardRate, batchTracked: m.batchTracked, active: m.active });
  };
  const save = useAction(async (b: Form) => {
    const body: Record<string, unknown> = { name: b.name, category: b.category, altUnit: b.altUnit || null, altFactor: b.altUnit ? b.altFactor || null : null, defaultBasis: b.defaultBasis, standardRate: b.standardRate || '0', batchTracked: b.batchTracked, active: b.active };
    if (edit === 'new') return api.post(`/companies/${companyId}/materials`, { ...body, code: b.code, unit: b.unit });
    return api.patch(`/materials/${(edit as Material).id}`, body);
  }, { onSuccess: () => setEdit(null) });

  const rows = useMemo(() => (data ?? []).filter((m) => (showInactive || m.active) && (!q || `${m.code} ${m.name}`.toLowerCase().includes(q.toLowerCase()))), [data, q, showInactive]);
  const cats = CATEGORIES.filter((c) => rows.some((m) => m.category === c));

  return (
    <>
      <PageHeader title="Material master" description={`Materials of ${company?.name ?? 'the company'}, shared by all its projects. Stock is kept in the stock unit; the secondary unit is shown alongside (for example cement in bags and kilograms).`}
        actions={canEdit && <Button variant="primary" onClick={() => open('new')}><Plus className="size-4" /> New material</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Search code or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search materials" />
        <label className="flex items-center gap-2 text-[13px] text-ink-soft"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label>
      </div>
      {data && !data.length ? (
        <Empty title="No materials yet" action={canEdit && <Button variant="primary" onClick={() => open('new')}>New material</Button>}>Add the materials your sites receive and issue to subcontractors: cement, steel, pipes, electrodes and so on.</Empty>
      ) : data === undefined ? (
        <Sheet flush><Table rows={undefined} rowKey={() => ''} cols={[{ key: 'x', header: 'Material', cell: () => null }]} /></Sheet>
      ) : (
        <div className="space-y-4">
          {cats.length === 0 && <p className="text-ink-soft">No material matches the search.</p>}
          {cats.map((c) => (
            <Sheet key={c} title={humanize(c)} flush>
              <Table rows={rows.filter((m) => m.category === c)} rowKey={(m) => m.id} onRowClick={canEdit ? open : undefined} cols={[
                { key: 'code', header: 'Code', width: '140px', cell: (m) => <span className="font-medium">{m.code}</span> },
                { key: 'name', header: 'Name', cell: (m) => <div>{m.name}{!m.active && <> <Status value="INACTIVE" /></>}</div> },
                { key: 'unit', header: 'Stock unit', cell: (m) => unitLabel(m.unit) },
                { key: 'alt', header: 'Secondary unit', cell: (m) => (m.altUnit ? <span>{unitLabel(m.altUnit)} <span className="text-ink-soft">({num(m.altFactor)} {unitLabel(m.altUnit)} per {unitLabel(m.unit)})</span></span> : <span className="text-ink-soft">—</span>) },
                { key: 'basis', header: 'Default supply basis', cell: (m) => basisLabel(m.defaultBasis) },
                { key: 'batch', header: 'Tracking', cell: (m) => (m.batchTracked ? <Tag tone="blue">Batch / heat no.</Tag> : <span className="text-ink-soft">—</span>) },
                { key: 'rate', header: 'Standard rate', align: 'right', cell: (m) => <span>{inr(m.standardRate)} <span className="text-ink-soft">/ {unitLabel(m.unit)}</span></span> },
              ]} />
            </Sheet>
          ))}
        </div>
      )}

      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New material' : `Edit ${f.code}`}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate(f)}>{edit === 'new' ? 'Create material' : 'Save changes'}</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {save.error ? <div className="sm:col-span-2"><Notice error={save.error} /></div> : null}
          <Field label="Code" hint={edit === 'new' ? 'Short unique code, e.g. CEM-OPC53' : 'The code cannot change'}><Input value={f.code} disabled={edit !== 'new'} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select></Field>
          <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. OPC 53 grade cement" /></Field>
          <Field label="Stock unit" hint={edit === 'new' ? 'Unit in which stock is kept and issued' : 'The stock unit cannot change'}>
            <Select value={f.unit} disabled={edit !== 'new'} onChange={(e) => setF({ ...f, unit: e.target.value })}>{UNIT_CODES.map((u) => <option key={u} value={u}>{UNITS[u].label} · {UNITS[u].name}</option>)}</Select>
          </Field>
          <Field label="Standard rate (₹ per stock unit)" hint="Used when the store has no weighted average yet"><Input inputMode="decimal" value={f.standardRate} onChange={(e) => setF({ ...f, standardRate: e.target.value })} /></Field>
          <Field label="Secondary unit (optional)">
            <Select value={f.altUnit} onChange={(e) => setF({ ...f, altUnit: e.target.value })}><option value="">None</option>{UNIT_CODES.filter((u) => u !== f.unit).map((u) => <option key={u} value={u}>{UNITS[u].label} · {UNITS[u].name}</option>)}</Select>
          </Field>
          <Field label={f.altUnit ? `${unitLabel(f.altUnit)} per ${unitLabel(f.unit)}` : 'Conversion factor'} hint={f.altUnit && f.altFactor ? `1 ${unitLabel(f.unit)} = ${f.altFactor} ${unitLabel(f.altUnit)}` : 'e.g. 50 Kg per bag of cement'}>
            <Input inputMode="decimal" disabled={!f.altUnit} value={f.altFactor} onChange={(e) => setF({ ...f, altFactor: e.target.value })} />
          </Field>
          <Field label="Default supply basis" hint="Applied on issue vouchers unless the work order or the line says otherwise">
            <Select value={f.defaultBasis} onChange={(e) => setF({ ...f, defaultBasis: e.target.value })}>{BASES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          </Field>
          <div className="flex flex-col justify-end gap-2 pb-1 text-[13px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.batchTracked} onChange={(e) => setF({ ...f, batchTracked: e.target.checked })} /> Track batch / heat number</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
          </div>
        </div>
      </Dialog>
    </>
  );
}
