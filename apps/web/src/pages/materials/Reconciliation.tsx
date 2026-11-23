import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { date, inr, isoDate } from '../../lib/format';
import { Button, Field, Input, Notice, PageHeader, Select, Sheet, Status, Table, Tag } from '../../components/ui';
import { useMaterialData } from '../../components/materials/common';
import { ReconStatement, type ReconLine } from '../../components/materials/ReconStatement';

type Form = { subcontractorId: string; workOrderId: string; periodFrom: string; periodTo: string; isFinal: boolean };
const monthStart = () => { const d = new Date(); return isoDate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1))); };

export function Reconciliation() {
  const { projectId, companyId } = useProject();
  const { can } = useAuth();
  const nav = useNavigate();
  const md = useMaterialData(projectId, companyId);
  const { data: saved } = useApi<any[]>(`/projects/${projectId}/reconciliations`);
  const [f, setF] = useState<Form>({ subcontractorId: '', workOrderId: '', periodFrom: monthStart(), periodTo: isoDate(), isFinal: false });
  const [closing, setClosing] = useState<Record<string, string>>({});
  const [penal, setPenal] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ lines: ReconLine[]; totalRecoverable: string; for: string } | null>(null);
  const wos = (md.wos ?? []).filter((w) => w.subcontractorId === f.subcontractorId);
  const key = JSON.stringify([f, closing, penal]);
  const stale = result && result.for !== key;

  const body = () => ({
    subcontractorId: f.subcontractorId, workOrderId: f.workOrderId || null, periodFrom: f.periodFrom, periodTo: f.periodTo, isFinal: f.isFinal,
    closingStock: Object.fromEntries(Object.entries(closing).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()])),
    penalRates: Object.fromEntries(Object.entries(penal).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()])),
  });
  const compute = useAction(() => api.post(`/projects/${projectId}/reconciliations/compute`, body()), { onSuccess: (r: any) => setResult({ ...r, for: key }) });
  const save = useAction(() => api.post(`/projects/${projectId}/reconciliations`, body()), { onSuccess: (r: any) => nav(r.id) });
  const subName = (id: string) => md.subs?.find((s) => s.id === id)?.name ?? '…';
  const woNo = (id?: string | null) => (id ? md.wos?.find((w) => w.id === id)?.woNo ?? '…' : 'All work orders');
  const set = (k: keyof Form, v: string | boolean) => setF({ ...f, [k]: v, ...(k === 'subcontractorId' ? { workOrderId: '' } : {}) });

  return (
    <>
      <PageHeader title="Material reconciliation" description="Compare material issued to a subcontractor with what its approved work should have consumed. Excess consumption is recovered; material still held is carried forward." />
      <Sheet title="Prepare a statement">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Subcontractor"><Select value={f.subcontractorId} onChange={(e) => set('subcontractorId', e.target.value)}><option value="">Select subcontractor</option>{md.subs?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Work order"><Select value={f.workOrderId} disabled={!f.subcontractorId} onChange={(e) => set('workOrderId', e.target.value)}><option value="">All work orders</option>{wos.map((w) => <option key={w.id} value={w.id}>{w.woNo} · {w.title}</option>)}</Select></Field>
          <Field label="Period from"><Input type="date" value={f.periodFrom} onChange={(e) => set('periodFrom', e.target.value)} /></Field>
          <Field label="Period to"><Input type="date" value={f.periodTo} onChange={(e) => set('periodTo', e.target.value)} /></Field>
          <div className="flex items-end gap-2">
            <Button variant="primary" className="w-full" disabled={!f.subcontractorId} busy={compute.isPending} onClick={() => compute.mutate(undefined)}>{result ? 'Recalculate' : 'Calculate'}</Button>
          </div>
          <label className="flex items-start gap-2 text-[13px] sm:col-span-2 lg:col-span-5">
            <input type="checkbox" className="mt-0.5" checked={f.isFinal} onChange={(e) => set('isFinal', e.target.checked)} />
            <span><span className="font-medium">Final reconciliation</span><span className="block text-ink-soft">Tick when the subcontractor's work is complete. Any balance still held and not returned is then recovered at the issue rate, instead of being carried forward.</span></span>
          </label>
        </div>
        {compute.error ? <div className="mt-3"><Notice error={compute.error} /></div> : null}
      </Sheet>

      {result && (
        <div className="mt-4">
          {stale && <div className="mb-3"><Notice tone="warning" title="Inputs changed since the last calculation">Recalculate to update the statement before saving it.</Notice></div>}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-rule bg-sheet px-4 py-3">
            <div>
              <div className="text-xs text-ink-soft">{subName(f.subcontractorId)} · {woNo(f.workOrderId)} · {date(f.periodFrom)} to {date(f.periodTo)}{f.isFinal && ' · final'}</div>
              <div className="text-[17px] font-semibold">Total recoverable now <span className="num">{inr(result.totalRecoverable)}</span></div>
            </div>
            <div className="flex gap-2">
              <Button busy={compute.isPending} onClick={() => compute.mutate(undefined)}>Recalculate with stock counts</Button>
              {can('reconciliation.prepare', { projectId }) && <Button variant="primary" disabled={!!stale} busy={save.isPending} onClick={() => save.mutate(undefined)}>Save statement</Button>}
            </div>
          </div>
          {save.error ? <div className="mb-3"><Notice error={save.error} /></div> : null}
          <p className="mb-3 text-[13px] text-ink-soft">Enter the physically verified stock still held by the subcontractor (J) and, if the contract provides for it, a penal recovery rate. Then recalculate.</p>
          <ReconStatement lines={result.lines} isFinal={f.isFinal} inputs={(id) => ({ closing: closing[id] ?? '', penal: penal[id] ?? '', setClosing: (v) => setClosing((c) => ({ ...c, [id]: v })), setPenal: (v) => setPenal((p) => ({ ...p, [id]: v })) })} />
        </div>
      )}

      <Sheet title="Saved statements" flush className="mt-6">
        <Table rows={saved} rowKey={(r) => r.id} onRowClick={(r) => nav(r.id)} empty="No reconciliation statements saved yet." cols={[
          { key: 'no', header: 'Statement', cell: (r) => <div className="font-medium">{r.reconNo}{r.isFinal && <> <Tag tone="amber">Final</Tag></>}</div> },
          { key: 's', header: 'Subcontractor / work order', cell: (r) => <div><div>{subName(r.subcontractorId)}</div><div className="text-xs text-ink-soft">{woNo(r.workOrderId)}</div></div> },
          { key: 'p', header: 'Period', cell: (r) => `${date(r.periodFrom)} to ${date(r.periodTo)}` },
          { key: 'm', header: 'Materials', align: 'right', cell: (r) => (r.lines as any[]).length },
          { key: 't', header: 'Recoverable', align: 'right', cell: (r) => inr(r.totalRecoverable) },
          { key: 'st', header: 'Status', cell: (r) => <Status value={r.status} /> },
        ]} />
      </Sheet>
    </>
  );
}
