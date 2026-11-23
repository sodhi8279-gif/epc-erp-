import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { MEASUREMENT_TYPES, type MeasurementType } from '@epc/shared';
import { api } from '../../lib/api';
import { useApi, useProject } from '../../lib/hooks';
import { isoDate, num, unitLabel } from '../../lib/format';
import { Button, Field, Input, Notice, PageHeader, Select, Sheet, Textarea } from '../../components/ui';
import { TYPE_LABEL, chainage, useMbPermissions, useWorkOrderLines } from '../../components/mb/common';
import { LineGrid, blankLine, lineFromApi, lineToApi, type LineDraft } from '../../components/mb/LineGrid';

/** Type-specific header attributes, stored in `attributes`. */
const ATTRS: Record<MeasurementType, { k: string; label: string; hint?: string; wide?: boolean }[]> = {
  PIPELINE: [{ k: 'pipelineId', label: 'Pipeline / line id' }, { k: 'diameterMm', label: 'Diameter (mm)' }, { k: 'material', label: 'Pipe material', hint: 'e.g. DI K9, MS, HDPE PE100' }, { k: 'jointIds', label: 'Joint ids', hint: 'e.g. J-101 to J-118' }, { k: 'testing', label: 'Testing details', hint: 'Hydro test pressure, date, report no.', wide: true }],
  EXCAVATION: [{ k: 'trenchWidth', label: 'Trench width notes' }, { k: 'trenchDepth', label: 'Trench depth notes' }, { k: 'strata', label: 'Strata / soil class', hint: 'e.g. ordinary soil, hard rock' }],
  RCC: [{ k: 'concreteGrade', label: 'Concrete grade', hint: 'e.g. M30' }, { k: 'pourRef', label: 'Pour / cube register ref' }],
  REBAR: [{ k: 'bbsRef', label: 'BBS reference' }, { k: 'steelGrade', label: 'Steel grade', hint: 'e.g. Fe 500D' }],
  GENERIC: [],
};
const suggestType = (unit?: string): MeasurementType => (unit === 'RM' || unit === 'M' || unit === 'KM' ? 'PIPELINE' : unit === 'KG' || unit === 'MT' || unit === 'QTL' ? 'REBAR' : 'GENERIC');

interface Head { workOrderId: string; workOrderItemId: string; allocationId: string; date: string; mbNo: string; mbPage: string; type: MeasurementType; location: string; structure: string; drawingRef: string; zone: string; measurementRule: string; remarks: string; attributes: Record<string, string> }
const blankHead = (): Head => ({ workOrderId: '', workOrderItemId: '', allocationId: '', date: isoDate(), mbNo: '', mbPage: '', type: 'GENERIC', location: '', structure: '', drawingRef: '', zone: '', measurementRule: '', remarks: '', attributes: {} });

export function MeasurementForm() {
  const { projectId } = useProject();
  const { id } = useParams();
  const nav = useNavigate();
  const { canP } = useMbPermissions(projectId);
  const { data: existing } = useApi<any>(id ? `/measurements/${id}` : null);
  const { details } = useWorkOrderLines(projectId);
  const [h, setH] = useState<Head>(blankHead);
  const [lines, setLines] = useState<LineDraft[]>(() => [blankLine()]);
  const [typeTouched, setTypeTouched] = useState(false);
  const [loaded, setLoaded] = useState(!id);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'submit'>('');

  useEffect(() => {
    if (!existing || loaded) return;
    const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
    setH({ workOrderId: existing.workOrderId, workOrderItemId: existing.workOrderItemId, allocationId: s(existing.allocationId), date: s(existing.date).slice(0, 10), mbNo: s(existing.mbNo), mbPage: s(existing.mbPage), type: existing.type, location: s(existing.location), structure: s(existing.structure), drawingRef: s(existing.drawingRef), zone: s(existing.zone), measurementRule: s(existing.measurementRule), remarks: s(existing.remarks), attributes: Object.fromEntries(Object.entries(existing.attributes ?? {}).map(([k, v]) => [k, s(v)])) });
    setLines(existing.lines.length ? existing.lines.map(lineFromApi) : [blankLine()]);
    setTypeTouched(true);
    setLoaded(true);
  }, [existing, loaded]);

  const approved = details.filter((w) => w.status === 'APPROVED');
  const wo = approved.find((w) => w.id === h.workOrderId) ?? details.find((w) => w.id === h.workOrderId);
  const woi = wo?.items?.find((i: any) => i.id === h.workOrderItemId);
  const { data: allocs } = useApi<any[]>(woi ? `/projects/${projectId}/allocations?activityId=${woi.activityId}` : null);
  const lineAllocs = (allocs ?? []).filter((a) => a.workOrderItemId === h.workOrderItemId && (a.status === 'ACTIVE' || a.id === h.allocationId));
  const alloc = lineAllocs.find((a) => a.id === h.allocationId);

  const set = <K extends keyof Head>(k: K, v: Head[K]) => setH((p) => ({ ...p, [k]: v }));
  const setAttr = (k: string, v: string) => setH((p) => ({ ...p, attributes: { ...p.attributes, [k]: v } }));

  const body = useMemo(() => {
    const t = (v: string) => (v.trim() === '' ? null : v.trim());
    const attrs = Object.fromEntries(ATTRS[h.type].map((a) => [a.k, h.attributes[a.k]?.trim()]).filter(([, v]) => v));
    return {
      workOrderItemId: h.workOrderItemId, allocationId: h.allocationId || null, date: h.date, type: h.type, mbNo: t(h.mbNo), mbPage: t(h.mbPage), location: t(h.location), structure: t(h.structure), drawingRef: t(h.drawingRef), zone: t(h.zone),
      measurementRule: t(h.measurementRule), remarks: t(h.remarks), attributes: Object.keys(attrs).length ? attrs : null,
      lines: lines.filter((l) => Object.entries(lineToApi(h.type, l)).some(([k, v]) => k !== 'isDeduction' && v !== null)).map((l) => lineToApi(h.type, l)),
    };
  }, [h, lines]);

  // Debounced server preview: same safeguards the save runs (chainage overlap, allocation / WO / BOQ ceilings).
  const [preview, setPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);
  const reqNo = useRef(0);
  const bodyKey = JSON.stringify(body);
  useEffect(() => {
    if (!body.workOrderItemId || !body.lines.length || !body.date) { setPreview(null); return; }
    const n = ++reqNo.current;
    setPreviewing(true);
    const t = setTimeout(() => {
      api.post(`/projects/${projectId}/measurements/preview`, { ...body, ...(id ? { excludeId: id } : {}) })
        .then((r) => { if (n === reqNo.current) setPreview(r); })
        .catch((e) => { if (n === reqNo.current) setPreview({ ok: false, errors: [(e as Error).message], invalid: true }); })
        .finally(() => { if (n === reqNo.current) setPreviewing(false); });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey, projectId, id]);

  if (id && !existing) return null;
  if (existing && !['DRAFT', 'RETURNED'].includes(existing.status)) {
    return <><PageHeader title={`${existing.measurementNo} cannot be edited`} back={<Link to={`/p/${projectId}/measurements/${id}`} className="hover:underline">Back to measurement</Link>} /><Notice tone="warning" title={`This measurement is ${existing.status.toLowerCase().replace(/_/g, ' ')}.`}>Only drafts and returned measurements can be edited. Approved quantities are corrected by a reversal entry.</Notice></>;
  }
  if (!canP('measurement.create')) return <><PageHeader title="Record measurement" /><Notice tone="warning" title="You do not have permission to enter measurements on this project." /></>;

  const save = async (submit: boolean) => {
    setErr(null); setBusy(submit ? 'submit' : 'save');
    let saved: any;
    try {
      saved = id ? await api.put(`/measurements/${id}`, body) : await api.post(`/projects/${projectId}/measurements`, body);
    } catch (e) { setErr(e); setBusy(''); return; }
    if (submit) {
      try { await api.post(`/measurements/${saved.id}/transition`, { action: 'submit' }); }
      catch (e) { setBusy(''); nav(`/p/${projectId}/measurements/${saved.id}`, { state: { error: `Saved as draft, but submission failed: ${(e as Error).message}` } }); return; }
    }
    setBusy('');
    nav(`/p/${projectId}/measurements/${saved.id}`);
  };

  const unit = woi?.unit as string | undefined;
  const ready = !!h.workOrderItemId && body.lines.length > 0;
  return (
    <>
      <PageHeader back={<Link to={id ? `/p/${projectId}/measurements/${id}` : `/p/${projectId}/measurements`} className="hover:underline">{id ? existing?.measurementNo : 'Measurement book'}</Link>}
        title={id ? `Edit ${existing?.measurementNo}` : 'Record measurement'}
        description={id && existing?.status === 'RETURNED' ? 'Returned for correction. Resubmitting creates the next revision; the earlier revision stays in the history.' : 'Pick the work order line, enter the measurement book lines, check the safeguard results, then save or submit.'} />

      {existing?.status === 'RETURNED' && <ReturnNote m={existing} />}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <Sheet title="Work order line">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Work order" hint={approved.length === 0 && details.length > 0 ? 'No approved work orders yet' : undefined}>
              <Select value={h.workOrderId} onChange={(e) => setH((p) => ({ ...p, workOrderId: e.target.value, workOrderItemId: '', allocationId: '' }))}>
                <option value="">Select an approved work order</option>
                {approved.map((w) => <option key={w.id} value={w.id}>{w.woNo} · {w.subcontractor?.name}</option>)}
              </Select>
            </Field>
            <Field label="Work order line">
              <Select value={h.workOrderItemId} disabled={!wo} onChange={(e) => {
                const it = wo?.items.find((i: any) => i.id === e.target.value);
                setH((p) => ({ ...p, workOrderItemId: e.target.value, allocationId: '', type: typeTouched || !it ? p.type : suggestType(it.unit) }));
              }}>
                <option value="">{wo ? 'Select a line' : 'Choose a work order first'}</option>
                {wo?.items.map((i: any) => <option key={i.id} value={i.id}>{i.lineNo}. {i.activity?.code} · {i.activity?.name} ({num(i.quantity)} {unitLabel(i.unit)})</option>)}
              </Select>
            </Field>
            <Field label="Allocation" hint={woi && lineAllocs.length === 0 ? 'No active allocation on this line; ceilings still apply at WO and BOQ level' : 'Optional; limits the cumulative quantity'}>
              <Select value={h.allocationId} disabled={!woi} onChange={(e) => {
                const a = lineAllocs.find((x) => x.id === e.target.value);
                setH((p) => ({ ...p, allocationId: e.target.value, zone: p.zone || a?.zone || '' }));
              }}>
                <option value="">No allocation</option>
                {lineAllocs.map((a) => <option key={a.id} value={a.id}>{num(a.quantity)} {unitLabel(a.workOrderItem?.unit ?? '')}{a.zone ? ` · ${a.zone}` : ''}{a.chainageFrom != null && a.chainageTo != null ? ` · Ch ${chainage(a.chainageFrom)}–${chainage(a.chainageTo)}` : ''}</option>)}
              </Select>
            </Field>
          </div>
          {woi && (
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-rule-soft pt-3 text-[13px] sm:grid-cols-5">
              <div><dt className="text-xs text-ink-soft">Activity</dt><dd className="font-medium">{woi.activity?.code} · {woi.activity?.name}</dd></div>
              <div><dt className="text-xs text-ink-soft">Unit</dt><dd className="font-medium">{unitLabel(woi.unit)}</dd></div>
              <div><dt className="text-xs text-ink-soft">WO quantity</dt><dd className="font-medium tabular-nums">{num(woi.quantity)}</dd></div>
              <div><dt className="text-xs text-ink-soft">Approved so far</dt><dd className="font-medium tabular-nums">{num(woi.approvedQty)}</dd></div>
              {alloc && <div><dt className="text-xs text-ink-soft">Allocation</dt><dd className="font-medium">{num(alloc.quantity)} {alloc.zone ? `· ${alloc.zone}` : ''}{alloc.chainageFrom != null && alloc.chainageTo != null ? ` · ${chainage(alloc.chainageFrom)}–${chainage(alloc.chainageTo)}` : ''}</dd></div>}
            </dl>
          )}
        </Sheet>

        <Sheet title="Measurement book entry">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Date of measurement"><Input type="date" max={isoDate()} value={h.date} onChange={(e) => set('date', e.target.value)} /></Field>
            <Field label="MB no."><Input value={h.mbNo} onChange={(e) => set('mbNo', e.target.value)} placeholder="e.g. MB-07" /></Field>
            <Field label="Page"><Input value={h.mbPage} onChange={(e) => set('mbPage', e.target.value)} placeholder="e.g. 41–42" /></Field>
            <Field label="Measurement type">
              <Select value={h.type} onChange={(e) => { set('type', e.target.value as MeasurementType); setTypeTouched(true); }}>
                {MEASUREMENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </Select>
            </Field>
            <Field label="Location"><Input value={h.location} onChange={(e) => set('location', e.target.value)} placeholder="Village / road / site" /></Field>
            <Field label="Zone / reach"><Input value={h.zone} onChange={(e) => set('zone', e.target.value)} /></Field>
            <Field label="Structure"><Input value={h.structure} onChange={(e) => set('structure', e.target.value)} placeholder="e.g. Valve chamber VC-3" /></Field>
            <Field label="Drawing ref."><Input value={h.drawingRef} onChange={(e) => set('drawingRef', e.target.value)} /></Field>
            {ATTRS[h.type].map((a) => (
              <Field key={a.k} label={a.label} hint={a.hint} className={a.wide ? 'sm:col-span-2' : undefined}>
                <Input value={h.attributes[a.k] ?? ''} onChange={(e) => setAttr(a.k, e.target.value)} inputMode={a.k === 'diameterMm' ? 'decimal' : undefined} />
              </Field>
            ))}
            <Field label="Measurement rule" hint="Mode of measurement, e.g. IS 1200 Part 1" className="sm:col-span-2"><Input value={h.measurementRule} onChange={(e) => set('measurementRule', e.target.value)} /></Field>
            <Field label="Remarks" className="sm:col-span-2 lg:col-span-4"><Textarea value={h.remarks} onChange={(e) => set('remarks', e.target.value)} className="min-h-[56px]" /></Field>
          </div>
        </Sheet>

        <Sheet title="Measurement lines" flush>
          <div className="p-3"><LineGrid type={h.type} unit={unit} lines={lines} onChange={setLines} /></div>
        </Sheet>

        <Sheet title={<span className="inline-flex items-center gap-2">Safeguard check {previewing && <Loader2 className="size-3.5 animate-spin text-ink-soft" />}</span>}>
          {!ready ? <p className="text-ink-soft">Select a work order line and enter at least one line to run the checks for chainage overlap and allocation, work order and BOQ ceilings.</p>
            : !preview ? <p className="text-ink-soft">Checking…</p>
            : preview.ok ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                <span className="inline-flex items-center gap-1.5 font-medium text-green"><CheckCircle2 className="size-4" /> All safeguards pass</span>
                <span>Quantity <span className="num font-semibold">{num(preview.quantity)} {unitLabel(preview.unit)}</span></span>
                <span className="text-ink-soft">BOQ item in force on {h.date}: <span className="font-medium text-ink">{preview.boqItem?.itemNo}</span></span>
              </div>
            ) : (
              <Notice tone="error" title={preview.errors.length > 1 ? `${preview.errors.length} problems would block this measurement` : 'This measurement would be blocked'}>
                <ul className="list-disc pl-4">{preview.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
              </Notice>
            )}
        </Sheet>

        {err ? <Notice error={err} /> : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-rule pt-4">
          <Button onClick={() => nav(-1)}>Cancel</Button>
          <Button busy={busy === 'save'} disabled={!ready || !!busy} onClick={() => save(false)}>Save draft</Button>
          <Button variant="primary" busy={busy === 'submit'} disabled={!ready || !!busy || (preview && !preview.ok)} onClick={() => save(true)}>Save and submit</Button>
        </div>
      </div>
    </>
  );
}

function ReturnNote({ m }: { m: any }) {
  const last = [...(m.history ?? [])].reverse().find((x: any) => x.action === 'return');
  if (!last) return null;
  return <div className="mb-4"><Notice tone="warning" title={`Returned by ${last.userName}`}>{last.comment}</Notice></div>;
}
