import { useEffect, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { D } from '@epc/shared';
import { api, ApiError } from '../../lib/api';
import { useAction, useApi } from '../../lib/hooks';
import { inr, isoDate, num, unitLabel } from '../../lib/format';
import { Button, Dialog, Field, Input, Notice, Select, Textarea } from '../ui';

const isNum = (v: string) => v.trim() !== '' && !Number.isNaN(Number(v));
interface Check { errors: string[]; exceptions: { code: string; message: string }[] }
const EXC_LABEL: Record<string, string> = { SCOPE_EXCEEDED: 'Scope exceeded', WO_LIMIT_EXCEEDED: 'Work order quantity exceeded', CHAINAGE_OVERLAP: 'Chainage overlap', CHAINAGE_QTY_MISMATCH: 'Quantity differs from chainage', ZONE_OVERLAP: 'Zone overlap', DUPLICATE: 'Duplicate allocation', UNAPPROVED_RATE: 'Rate not approved' };

/** Approved work order lines of the project, flattened: [{ wo, item }]. */
function useApprovedWoLines(projectId: string, enabled: boolean) {
  const { data: wos } = useApi<any[]>(enabled ? `/projects/${projectId}/work-orders?status=APPROVED` : null);
  const qs = useQueries({ queries: (wos ?? []).map((w) => ({ queryKey: [`/work-orders/${w.id}`], queryFn: () => api.get<any>(`/work-orders/${w.id}`) })) });
  if (!wos || qs.some((q) => q.isLoading)) return undefined;
  return qs.flatMap((q) => (q.data ? q.data.items.map((item: any) => ({ wo: q.data, item })) : []));
}

/** Allocate scope of a BOQ activity to an approved work order line, with live exception checks. */
export function AllocateDialog({ projectId, rows, activityId: initialActivity, open, onClose }: { projectId: string; rows: any[]; activityId?: string; open: boolean; onClose: () => void }) {
  const blank = { activityId: initialActivity ?? '', workOrderItemId: '', quantity: '', zone: '', chainageFrom: '', chainageTo: '', remarks: '', exceptionReason: '' };
  const [f, setF] = useState(blank);
  const [check, setCheck] = useState<Check | null>(null);
  const [checkErr, setCheckErr] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => { if (open) { setF({ ...blank, activityId: initialActivity ?? '' }); setCheck(null); setCheckErr(null); } }, [open, initialActivity]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = useApprovedWoLines(projectId, open);
  const row = rows.find((r) => r.activityId === f.activityId);
  const options = (lines ?? []).filter((l) => l.item.activityId === f.activityId);
  const sel = options.find((l) => l.item.id === f.workOrderItemId);
  const hasCh = isNum(f.chainageFrom) && isNum(f.chainageTo);
  const body = () => ({
    activityId: f.activityId, workOrderItemId: f.workOrderItemId, quantity: f.quantity.trim(), zone: f.zone.trim() || null,
    chainageFrom: isNum(f.chainageFrom) ? f.chainageFrom.trim() : null, chainageTo: isNum(f.chainageTo) ? f.chainageTo.trim() : null,
    remarks: f.remarks.trim() || undefined, exceptionReason: f.exceptionReason.trim() || undefined,
  });

  // Live check as the fields change (debounced).
  useEffect(() => {
    if (!open || !f.activityId || !f.workOrderItemId || !isNum(f.quantity)) { setCheck(null); return; }
    let live = true;
    setChecking(true);
    const t = setTimeout(() => {
      api.post<Check>(`/projects/${projectId}/allocations/check`, body())
        .then((r) => { if (live) { setCheck(r); setCheckErr(null); } })
        .catch((e) => { if (live) { setCheck(null); setCheckErr(e); } })
        .finally(() => live && setChecking(false));
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [open, projectId, f.activityId, f.workOrderItemId, f.quantity, f.zone, f.chainageFrom, f.chainageTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useAction(() => api.post(`/projects/${projectId}/allocations`, body()), { onSuccess: () => onClose() });
  const exceptions = check?.exceptions ?? (save.error instanceof ApiError && save.error.status === 409 && Array.isArray(save.error.details) ? (save.error.details as Check['exceptions']) : []);
  const hardErrors = check?.errors ?? [];
  const needReason = exceptions.length > 0;
  const lineAllocated = sel ? D(String(sel.item.allocated ?? 0)) : null;
  const value = sel && isNum(f.quantity) ? D(f.quantity).times(String(sel.item.rate)).toDecimalPlaces(2).toString() : null;

  return (
    <Dialog wide open={open} onClose={onClose} title="Allocate work"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={save.isPending} disabled={!f.activityId || !f.workOrderItemId || !isNum(f.quantity) || hardErrors.length > 0 || (needReason && !f.exceptionReason.trim())} onClick={() => save.mutate(undefined)}>{needReason ? 'Submit for exception approval' : 'Allocate'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {save.error && !(save.error instanceof ApiError && save.error.status === 409) ? <div className="sm:col-span-2"><Notice error={save.error} /></div> : null}
        <Field label="BOQ activity" className="sm:col-span-2">
          <Select value={f.activityId} onChange={(e) => setF({ ...f, activityId: e.target.value, workOrderItemId: '' })}>
            <option value="">Select activity…</option>
            {rows.map((r) => <option key={r.activityId} value={r.activityId}>{r.contractNo} · Item {r.itemNo} · {r.activityCode} {r.activityName} — unallocated {num(r.unallocated)} {unitLabel(r.unit)}</option>)}
          </Select>
        </Field>
        {row && (
          <div className="grid grid-cols-3 gap-2 rounded-[3px] border border-rule-soft bg-paper px-3 py-2 text-[13px] sm:col-span-2">
            <div><div className="text-xs text-ink-soft">Scope</div><div className="num text-left">{num(row.revisedQty)} {unitLabel(row.unit)}</div></div>
            <div><div className="text-xs text-ink-soft">Allocated</div><div className="num text-left">{num(row.allocated)}</div></div>
            <div><div className="text-xs text-ink-soft">Unallocated</div><div className={`num text-left ${D(row.unallocated).lt(0) ? 'text-red' : ''}`}>{num(row.unallocated)}</div></div>
          </div>
        )}
        <Field label="Approved work order line" className="sm:col-span-2" hint={f.activityId && lines && options.length === 0 ? 'No approved work order has a line for this activity. Add one by amendment or a new work order.' : undefined}>
          <Select value={f.workOrderItemId} disabled={!f.activityId || !lines} onChange={(e) => setF({ ...f, workOrderItemId: e.target.value })}>
            <option value="">{lines ? 'Select work order line…' : 'Loading work orders…'}</option>
            {options.map(({ wo, item }) => <option key={item.id} value={item.id}>{wo.woNo} · {wo.subcontractor.name} · line {item.lineNo} · {num(item.quantity)} {unitLabel(item.unit)} @ {inr(item.rate)} (allocated {num(item.allocated)})</option>)}
          </Select>
        </Field>
        <Field label={`Quantity${row ? ` (${unitLabel(row.unit)})` : ''}`} hint={sel ? `Line balance ${num(D(String(sel.item.quantity)).minus(lineAllocated!).toString())}${value ? ` · value ${inr(value)}` : ''}` : undefined}>
          <Input inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
        </Field>
        <Field label="Work zone / location" hint="e.g. Reach 3, Village X, Block B"><Input value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} /></Field>
        <Field label="Chainage from (m)"><Input inputMode="decimal" value={f.chainageFrom} onChange={(e) => setF({ ...f, chainageFrom: e.target.value })} /></Field>
        <Field label="Chainage to (m)" hint={hasCh && D(f.chainageTo).gt(f.chainageFrom) ? <>Length {num(D(f.chainageTo).minus(f.chainageFrom).toString())} m{row && ['RM', 'M'].includes(row.unit) && f.quantity !== D(f.chainageTo).minus(f.chainageFrom).toString() && <> · <button type="button" className="text-teal underline" onClick={() => setF({ ...f, quantity: D(f.chainageTo).minus(f.chainageFrom).toString() })}>use as quantity</button></>}</> : undefined}>
          <Input inputMode="decimal" value={f.chainageTo} onChange={(e) => setF({ ...f, chainageTo: e.target.value })} />
        </Field>
        <Field label="Remarks" className="sm:col-span-2"><Input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>

        <div className="space-y-2 sm:col-span-2" aria-live="polite">
          {checking && <p className="text-xs text-ink-soft">Checking allocation…</p>}
          {checkErr ? <Notice error={checkErr} /> : null}
          {hardErrors.length > 0 && <Notice tone="error" title="This allocation is not allowed"><ul className="list-disc pl-4">{hardErrors.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
          {!checking && check && hardErrors.length === 0 && exceptions.length === 0 && <Notice tone="success" title="No exceptions">The allocation is within scope and work order quantity, with no zone or chainage overlap.</Notice>}
          {exceptions.length > 0 && (
            <Notice tone="warning" title={`${exceptions.length} exception${exceptions.length > 1 ? 's' : ''} need approval`}>
              <ul className="list-disc pl-4">{exceptions.map((e, i) => <li key={i}><span className="font-medium text-ink">{EXC_LABEL[e.code] ?? e.code}:</span> {e.message}</li>)}</ul>
              <p className="mt-1">You can still submit it with a reason. It is saved as pending and does not count as active work until someone with override authority approves the exception.</p>
            </Notice>
          )}
          {exceptions.length > 0 && <Field label="Exception reason"><Textarea value={f.exceptionReason} onChange={(e) => setF({ ...f, exceptionReason: e.target.value })} placeholder="Why this allocation should be allowed, e.g. Contractor B to take over 550–600 due to slow progress, per PM instruction" /></Field>}
        </div>
      </div>
    </Dialog>
  );
}

/** Record daily site progress against an active allocation. */
export function ProgressDialog({ projectId, alloc, onClose }: { projectId: string; alloc: any | null; onClose: () => void }) {
  const blank = { date: isoDate(), quantity: '', location: '', chainageFrom: '', chainageTo: '', manpower: '', remarks: '' };
  const [f, setF] = useState(blank);
  useEffect(() => { if (alloc) setF({ ...blank, location: alloc.zone ?? '' }); }, [alloc]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(() => api.post(`/projects/${projectId}/progress`, {
    allocationId: alloc.id, date: f.date, quantity: f.quantity.trim(), location: f.location.trim() || undefined,
    chainageFrom: isNum(f.chainageFrom) ? f.chainageFrom.trim() : null, chainageTo: isNum(f.chainageTo) ? f.chainageTo.trim() : null,
    manpower: f.manpower.trim() ? Number(f.manpower) : undefined, remarks: f.remarks.trim() || undefined,
  }), { onSuccess: () => onClose() });
  useEffect(() => { if (alloc) save.reset(); }, [alloc]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={!!alloc} onClose={onClose} title="Record daily progress" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={save.isPending} disabled={!isNum(f.quantity) || !f.date} onClick={() => save.mutate(undefined)}>Record progress</Button></>}>
      {alloc && (
        <div className="grid gap-3 sm:grid-cols-2">
          {save.error ? <div className="sm:col-span-2"><Notice error={save.error} /></div> : null}
          <div className="rounded-[3px] border border-rule-soft bg-paper px-3 py-2 text-[13px] sm:col-span-2">
            <div className="font-medium">{alloc.subName} · {alloc.woNo}</div>
            <div className="text-ink-soft">{alloc.activityLabel} · allocated {num(alloc.quantity)} {unitLabel(alloc.unit)}{alloc.chainageFrom != null ? ` · Ch ${num(alloc.chainageFrom)}–${num(alloc.chainageTo)}` : ''}{alloc.zone ? ` · ${alloc.zone}` : ''}</div>
          </div>
          <p className="text-xs text-ink-soft sm:col-span-2">Site progress is physical execution reported by site. It is not a measurement and is not billed; the measurement book records billable quantities.</p>
          <Field label="Date"><Input type="date" max={isoDate()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label={`Quantity executed (${unitLabel(alloc.unit)})`}><Input inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          <Field label="Chainage from (m)"><Input inputMode="decimal" value={f.chainageFrom} onChange={(e) => setF({ ...f, chainageFrom: e.target.value })} /></Field>
          <Field label="Chainage to (m)"><Input inputMode="decimal" value={f.chainageTo} onChange={(e) => setF({ ...f, chainageTo: e.target.value })} /></Field>
          <Field label="Location"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="Manpower (persons)"><Input inputMode="numeric" value={f.manpower} onChange={(e) => setF({ ...f, manpower: e.target.value })} /></Field>
          <Field label="Remarks" className="sm:col-span-2"><Input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        </div>
      )}
    </Dialog>
  );
}
