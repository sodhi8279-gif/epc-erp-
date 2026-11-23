import { useState } from 'react';
import { Plus } from 'lucide-react';
import { D, standardConversion, UNIT_CODES, UNITS, type UnitCode } from '@epc/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { num, unitLabel } from '../../lib/format';
import { Button, Dialog, Field, Input, Notice, PageHeader, Select, Sheet, Status, Table, Textarea } from '../../components/ui';
import { MaterialOptions, useMaterialData, useProjectActivities, type Material } from '../../components/materials/common';

/** Norm converted into the material's stock unit (null when no conversion exists). */
function toStock(m: Pick<Material, 'unit' | 'altUnit' | 'altFactor'> | undefined, normUnit: string, v: string) {
  if (!m || !v) return null;
  try {
    if (normUnit === m.unit) return D(v);
    if (m.altUnit && normUnit === m.altUnit && m.altFactor) return D(v).div(m.altFactor);
    const s = standardConversion(normUnit as UnitCode, m.unit as UnitCode);
    return s ? D(v).times(s) : null;
  } catch { return null; }
}

/** "380 Kg of OPC 53 grade cement per Cum of RCC M30 placing, 2% wastage" */
function normWords(n: { normQty: string; normUnit: string; wastagePercent: string }, material: { name: string }, activity: { name: string; unit: string }) {
  return `${num(n.normQty, 6)} ${unitLabel(n.normUnit)} of ${material.name} per ${unitLabel(activity.unit)} of ${activity.name}, ${D(n.wastagePercent).isZero() ? 'no wastage allowed' : `${num(n.wastagePercent)}% wastage`}`;
}

type Form = { activityId: string; materialId: string; normQty: string; normUnit: string; wastagePercent: string; basis: string };
const blank: Form = { activityId: '', materialId: '', normQty: '', normUnit: '', wastagePercent: '0', basis: '' };

export function Norms() {
  const { projectId, companyId } = useProject();
  const { can } = useAuth();
  const md = useMaterialData(projectId, companyId);
  const activities = useProjectActivities(projectId);
  const { data } = useApi<any[]>(`/projects/${projectId}/norms`);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Form>(blank);
  const save = useAction((b: Form) => api.post(`/projects/${projectId}/norms`, b), { onSuccess: () => setOpen(false) });
  const approve = useAction((id: string) => api.post(`/norms/${id}/approve`));
  const canEdit = can('material.norms', { projectId });
  const canApprove = can('reconciliation.approve', { projectId });
  const m = md.matById(f.materialId);
  const act = activities?.find((a) => a.id === f.activityId);
  const stockEq = toStock(m, f.normUnit, f.normQty);
  const existing = data?.find((n) => n.activityId === f.activityId && n.materialId === f.materialId);
  const unitChoices = m ? [m.unit, ...(m.altUnit ? [m.altUnit] : []), ...UNIT_CODES.filter((u) => u !== m.unit && u !== m.altUnit && standardConversion(u, m.unit as UnitCode))] : [];

  const openForm = (n?: any) => {
    save.reset();
    setF(n ? { activityId: n.activityId, materialId: n.materialId, normQty: n.normQty, normUnit: n.normUnit, wastagePercent: n.wastagePercent, basis: n.basis } : blank);
    setOpen(true);
  };
  const contracts = [...new Set((activities ?? []).map((a) => a.contractNo))];

  return (
    <>
      <PageHeader title="Consumption norms" description="Approved quantity of material per unit of work for each activity, with permissible wastage. Reconciliation multiplies approved measured work by these norms to get theoretical consumption."
        actions={canEdit && <Button variant="primary" onClick={() => openForm()}><Plus className="size-4" /> New norm</Button>} />
      {approve.error ? <div className="mb-3"><Notice error={approve.error} onClose={() => approve.reset()} /></div> : null}
      <Sheet flush>
        <Table rows={data} rowKey={(n) => n.id} onRowClick={canEdit ? openForm : undefined} empty="No norms yet. Without an approved norm, theoretical consumption is zero and all consumption shows as excess." cols={[
          { key: 'a', header: 'Activity', cell: (n) => <div><div className="font-medium">{n.activity.code}</div><div className="text-xs text-ink-soft">{n.activity.name} · per {unitLabel(n.activity.unit)}</div></div> },
          { key: 'm', header: 'Material', cell: (n) => <div><div className="font-medium">{n.material.code}</div><div className="text-xs text-ink-soft">{n.material.name}</div></div> },
          { key: 'w', header: 'Norm', cell: (n) => { const s = toStock(n.material, n.normUnit, n.normQty); return <div><div>{normWords(n, n.material, n.activity)}</div>{s && n.normUnit !== n.material.unit && <div className="text-xs text-ink-soft">= {num(s.toString(), 4)} {unitLabel(n.material.unit)} per {unitLabel(n.activity.unit)}</div>}</div>; } },
          { key: 'b', header: 'Basis', cell: (n) => <span className="line-clamp-2 max-w-[36ch] text-ink-soft" title={n.basis}>{n.basis}</span> },
          { key: 's', header: 'Status', cell: (n) => <Status value={n.status} /> },
          { key: 'x', header: '', align: 'right', cell: (n) => (n.status !== 'APPROVED' && canApprove ? <Button size="sm" variant="primary" busy={approve.isPending && approve.variables === n.id} onClick={(e) => { e.stopPropagation(); approve.mutate(n.id); }}>Approve norm</Button> : null) },
        ]} />
      </Sheet>

      <Dialog open={open} onClose={() => setOpen(false)} title={existing ? 'Revise norm' : 'New norm'}
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate(f)}>{existing ? 'Save revised norm' : 'Save norm'}</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {save.error ? <div className="sm:col-span-2"><Notice error={save.error} /></div> : null}
          <Field label="Activity" className="sm:col-span-2">
            <Select value={f.activityId} onChange={(e) => setF({ ...f, activityId: e.target.value })}>
              <option value="">Select activity</option>
              {contracts.map((c) => <optgroup key={c} label={c}>{activities!.filter((a) => a.contractNo === c).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name} (per {unitLabel(a.unit)}){a.boqItem ? ` · item ${a.boqItem.itemNo}` : ''}</option>)}</optgroup>)}
            </Select>
          </Field>
          <Field label="Material" className="sm:col-span-2"><Select value={f.materialId} onChange={(e) => { const mm = md.matById(e.target.value); setF({ ...f, materialId: e.target.value, normUnit: mm?.altUnit ?? mm?.unit ?? '' }); }}><MaterialOptions materials={md.materials} /></Select></Field>
          <Field label={act ? `Quantity per ${unitLabel(act.unit)} of work` : 'Quantity per activity unit'}><Input inputMode="decimal" value={f.normQty} onChange={(e) => setF({ ...f, normQty: e.target.value })} /></Field>
          <Field label="Norm unit" hint={m && stockEq && f.normUnit !== m.unit ? `= ${num(stockEq.toString(), 4)} ${unitLabel(m.unit)} (stock unit)` : undefined}>
            <Select value={f.normUnit} disabled={!m} onChange={(e) => setF({ ...f, normUnit: e.target.value })}>{unitChoices.map((u) => <option key={u} value={u}>{UNITS[u as UnitCode]?.label ?? u}</option>)}</Select>
          </Field>
          <Field label="Permissible wastage (%)"><Input inputMode="decimal" value={f.wastagePercent} onChange={(e) => setF({ ...f, wastagePercent: e.target.value })} /></Field>
          <div />
          <Field label="Basis" className="sm:col-span-2" hint="Source of the norm: mix design, contract clause, CPWD analysis of rates, drawing schedule"><Textarea value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} placeholder="e.g. Approved mix design M30 dated 12 Apr 2025, cement content 380 kg/cum" /></Field>
          {m && act && f.normQty && (
            <div className="sm:col-span-2"><Notice tone="info" title="In plain words">{normWords(f, m, act)}.</Notice></div>
          )}
          {existing && <p className="text-[13px] text-ink-soft sm:col-span-2">A norm for this activity and material already exists ({existing.status.toLowerCase()}). Saving replaces it and sends it back for approval.</p>}
        </div>
      </Dialog>
    </>
  );
}
