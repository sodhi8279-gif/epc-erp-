import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Check, Circle, CornerUpLeft, Pencil, Trash2, Undo2 } from 'lucide-react';
import { D, APPROVED_MEASUREMENT, EDITABLE_MEASUREMENT, type MeasurementStatus, type MeasurementType } from '@epc/shared';
import { api } from '../../lib/api';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { date, dateTime, humanize, inr, num, unitLabel } from '../../lib/format';
import { Button, Dialog, Facts, Field, Notice, PageHeader, Sheet, Status, Tabs, Tag, Textarea, cx } from '../../components/ui';
import { ACTION_LABEL, STEPS, TYPE_LABEL, allowedTransitions, chainage, useMbPermissions } from '../../components/mb/common';
import { FIELDS } from '../../components/mb/LineGrid';

const ATTR_LABEL: Record<string, string> = { pipelineId: 'Pipeline id', diameterMm: 'Diameter (mm)', material: 'Pipe material', jointIds: 'Joint ids', testing: 'Testing', trenchWidth: 'Trench width', trenchDepth: 'Trench depth', strata: 'Strata', concreteGrade: 'Concrete grade', pourRef: 'Pour ref.', bbsRef: 'BBS ref.', steelGrade: 'Steel grade' };

export function MeasurementDetail() {
  const { projectId } = useProject();
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const { canP, me } = useMbPermissions(projectId);
  const { data: m, error: loadErr } = useApi<any>(`/measurements/${id}`);
  const [tab, setTab] = useState<'lines' | 'history' | 'revisions'>('lines');
  const [dlg, setDlg] = useState<null | { action: string; label: string; requiresComment?: boolean }>(null);
  const [comment, setComment] = useState('');
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [delOpen, setDelOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>((loc.state as any)?.error ?? null);

  const act = useAction((v: { action: string; comment?: string }) => api.post(`/measurements/${id}/transition`, v), { onSuccess: () => { setDlg(null); setComment(''); setFlash(null); } });
  const reverse = useAction((r: string) => api.post(`/measurements/${id}/reverse`, { reason: r }), { onSuccess: (r: any) => { setReverseOpen(false); setReason(''); nav(`/p/${projectId}/measurements/${r.id}`); } });
  const del = useAction(() => api.del(`/measurements/${id}`), { onSuccess: () => nav(`/p/${projectId}/measurements`) });

  if (loadErr) return <Notice error={loadErr} />;
  if (!m) return null;
  const status = m.status as MeasurementStatus;
  const type = m.type as MeasurementType;
  const transitions = allowedTransitions(m, canP);
  const editable = (EDITABLE_MEASUREMENT as string[]).includes(status) && !m.reversalOfId && canP('measurement.create');
  const deletable = status === 'DRAFT' && m.revision <= 1 && (m.snapshots ?? []).length === 0 && !m.reversalOfId && canP('measurement.create');
  const reversible = (APPROVED_MEASUREMENT as string[]).includes(status) && !m.reversedById && !m.reversalOfId && canP('measurement.reverse');
  const isMine = m.createdById === me?.user.id;
  const value = m.rate != null ? D(m.quantity).times(m.rate).toDecimalPlaces(2).toString() : null;
  const recorder = m.history?.find((h: any) => h.action === 'create' || h.action === 'create-reversal');
  const lastReturn = [...(m.history ?? [])].reverse().find((h: any) => h.action === 'return');
  const original = m.related?.find((r: any) => r.id === m.reversalOfId);
  const reversal = m.related?.find((r: any) => r.id === m.reversedById);
  const cols = FIELDS[type];

  return (
    <>
      <PageHeader back={<Link to={`/p/${projectId}/measurements`} className="hover:underline">Measurement book</Link>}
        title={<span className="inline-flex flex-wrap items-center gap-2">{m.measurementNo} <Status value={status} />{m.reversalOfId && <Tag tone="red">Reversal entry</Tag>}{m.reversedById && <Tag tone="amber">Reversed</Tag>}</span>}
        description={`${m.workOrder.subcontractor.name} · ${m.workOrder.woNo} · ${m.activity.code} ${m.activity.name} · revision R${m.revision}`}
        actions={<>
          {editable && <Button onClick={() => nav('edit')}><Pencil className="size-4" /> Edit measurement</Button>}
          {deletable && <Button variant="danger" onClick={() => setDelOpen(true)}><Trash2 className="size-4" /> Delete draft</Button>}
          {reversible && <Button variant="danger" onClick={() => setReverseOpen(true)}><Undo2 className="size-4" /> Reverse measurement</Button>}
          {transitions.map((t) => (
            <Button key={t.action} variant={t.action === 'return' ? 'secondary' : 'primary'} onClick={() => { act.reset(); setComment(''); setDlg({ action: t.action, label: ACTION_LABEL[t.action] ?? t.label, requiresComment: t.requiresComment }); }}>
              {t.action === 'return' && <CornerUpLeft className="size-4" />}{ACTION_LABEL[t.action] ?? t.label}
            </Button>
          ))}
        </>} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {flash && <Notice tone="error" title={flash} onClose={() => setFlash(null)} />}
        {status === 'RETURNED' && lastReturn && <Notice tone="warning" title={`Returned by ${lastReturn.userName} on ${dateTime(lastReturn.at)}`}>{lastReturn.comment} {editable && <>— <Link className="text-teal underline" to="edit">correct the measurement</Link> and submit it again.</>}</Notice>}
        {m.reversalOfId && <Notice tone="warning" title={`This is a reversal entry of ${original?.measurementNo ?? 'another measurement'}`}>It carries the negative quantity ({num(m.quantity)} {unitLabel(m.unit)}) and the same approval standing as the original, so approved and certified totals drop by that amount. The original stays on record. {original && <Link className="text-teal underline" to={`/p/${projectId}/measurements/${original.id}`}>Open {original.measurementNo}</Link>}</Notice>}
        {m.reversedById && <Notice tone="info" title={`Reversed by ${reversal?.measurementNo ?? 'a reversal entry'}`}>This measurement is kept as history. Its quantity is cancelled by the negative entry{reversal ? <> <Link className="text-teal underline" to={`/p/${projectId}/measurements/${reversal.id}`}>{reversal.measurementNo}</Link></> : null}.</Notice>}
        {transitions.some((t) => ['approve', 'certify'].includes(t.action)) && isMine && !me?.user.isSuperAdmin && <Notice tone="warning" title="You recorded this measurement">Segregation of duties: another person has to approve or certify it.</Notice>}

        {!m.reversalOfId && <Stepper m={m} />}

        <Sheet title="Measurement book page">
          <Facts items={[
            ['MB no. / page', `${m.mbNo ?? '—'} / ${m.mbPage ?? '—'}`], ['Date of measurement', date(m.date)], ['Type', TYPE_LABEL[type]], ['Recorded by', recorder ? `${recorder.userName}, ${date(recorder.at)}` : '—'],
            ['Subcontractor', m.workOrder.subcontractor.name], ['Work order', <Link key="wo" className="text-teal hover:underline" to={`/p/${projectId}/work-orders/${m.workOrder.id}`}>{m.workOrder.woNo}</Link>], ['BOQ item', `${m.boqItem.itemNo}`], ['Activity', `${m.activity.code} · ${m.activity.name}`],
            ['Location', m.location], ['Zone / reach', m.zone], ['Structure', m.structure], ['Drawing ref.', m.drawingRef],
            ['Chainage', m.chainageFrom != null && m.chainageTo != null ? `${chainage(m.chainageFrom)} – ${chainage(m.chainageTo)}` : null],
            ['Allocation', m.allocation ? `${num(m.allocation.quantity)} ${unitLabel(m.unit)}${m.allocation.zone ? ` · ${m.allocation.zone}` : ''}${m.allocation.chainageFrom != null && m.allocation.chainageTo != null ? ` · ${chainage(m.allocation.chainageFrom)}–${chainage(m.allocation.chainageTo)}` : ''}` : 'None'],
            ['Measurement rule', m.measurementRule],
            ...Object.entries(m.attributes ?? {}).map(([k, v]) => [ATTR_LABEL[k] ?? humanize(k), String(v)] as [string, string]),
          ]} />
          <p className="mt-3 border-t border-rule-soft pt-2 text-xs text-ink-soft">BOQ item: {m.boqItem.description}</p>
          {m.remarks && <p className="mt-2 text-[13px]"><span className="text-ink-soft">Remarks: </span>{m.remarks}</p>}
        </Sheet>

        <div className="grid gap-4 md:grid-cols-3">
          <Sheet><div className="text-xs text-ink-soft">Measured quantity</div><div className={cx('mt-1 tabular-nums text-[22px] font-semibold', D(m.quantity).isNegative() && 'text-red')}>{num(m.quantity)} <span className="text-[15px] font-normal text-ink-soft">{unitLabel(m.unit)}</span></div></Sheet>
          <Sheet><div className="text-xs text-ink-soft">Rate (snapshotted at PM approval)</div><div className="mt-1 tabular-nums text-[22px] font-semibold">{m.rate != null ? inr(m.rate) : <span className="text-[15px] font-normal text-ink-soft">Fixed when the PM approves</span>}</div>{m.rate != null && <div className="text-xs text-ink-soft">per {unitLabel(m.unit)}, rate in force on {date(m.date)}</div>}</Sheet>
          <Sheet><div className="text-xs text-ink-soft">Value (quantity × rate)</div><div className={cx('mt-1 tabular-nums text-[22px] font-semibold', value && D(value).isNegative() && 'text-red')}>{value ? inr(value) : <span className="text-[15px] font-normal text-ink-soft">—</span>}</div></Sheet>
        </div>

        <div>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'lines', label: `Lines (${m.lines.length})` }, { value: 'history', label: 'Workflow history' }, { value: 'revisions', label: `Revisions (${(m.snapshots ?? []).length})` }]} />
          {tab === 'lines' && (
            <Sheet flush>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead><tr className="border-b border-rule bg-paper text-left text-ink-soft">
                    <th className="px-3 py-2 font-medium">#</th><th className="px-3 py-2 font-medium">Description</th>
                    {!m.reversalOfId && cols.map((c) => <th key={c.k} className="px-3 py-2 text-right font-medium">{c.label}</th>)}
                    <th className="px-3 py-2 font-medium">Formula</th><th className="px-3 py-2 text-right font-medium">Quantity</th>
                  </tr></thead>
                  <tbody>
                    {m.lines.map((l: any) => (
                      <tr key={l.id} className={cx('border-b border-rule-soft', l.isDeduction && 'bg-amber-wash/40')}>
                        <td className="px-3 py-2 text-ink-soft tabular-nums">{l.lineNo}</td>
                        <td className="px-3 py-2">{l.description ?? '—'}{l.isDeduction && <> <Tag tone="amber">Deduction</Tag></>}{l.directQty != null && !m.reversalOfId && <> <Tag>Direct qty</Tag></>}</td>
                        {!m.reversalOfId && cols.map((c) => <td key={c.k} className="num px-3 py-2">{l[c.k] != null ? (c.k === 'chainageFrom' || c.k === 'chainageTo' ? chainage(l[c.k]) : num(l[c.k], 4)) : ''}</td>)}
                        <td className="px-3 py-2 font-mono text-[12px] text-ink-soft">{l.formula}</td>
                        <td className={cx('num px-3 py-2 font-medium', D(l.quantity).isNegative() && 'text-red')}>{num(l.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-rule bg-paper font-semibold"><tr>
                    <td className="px-3 py-2" colSpan={(m.reversalOfId ? 0 : cols.length) + 3}>Total</td>
                    <td className={cx('num px-3 py-2', D(m.quantity).isNegative() && 'text-red')}>{num(m.quantity)} {unitLabel(m.unit)}</td>
                  </tr></tfoot>
                </table>
              </div>
            </Sheet>
          )}
          {tab === 'history' && <History rows={m.history} />}
          {tab === 'revisions' && <Revisions m={m} />}
        </div>
      </div>

      <Dialog open={!!dlg} onClose={() => setDlg(null)} title={`${dlg?.label ?? ''} · ${m.measurementNo}`}
        footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant={dlg?.action === 'return' ? 'danger' : 'primary'} busy={act.isPending} disabled={!!dlg?.requiresComment && !comment.trim()} onClick={() => dlg && act.mutate({ action: dlg.action, comment: comment.trim() || undefined })}>{dlg?.label}</Button></>}>
        <div className="grid gap-3">
          {act.error ? <Notice error={act.error} /> : null}
          <p className="text-[13px]">{num(m.quantity)} {unitLabel(m.unit)} of {m.activity.code} · {m.activity.name}, {m.workOrder.subcontractor.name} ({m.workOrder.woNo}).</p>
          {dlg?.action === 'submit' && <p className="text-[13px] text-ink-soft">All safeguards are re-checked on submission. The submitted lines are kept as revision R{status === 'RETURNED' ? m.revision + 1 : m.revision}.</p>}
          {dlg?.action === 'approve' && <p className="text-[13px] text-ink-soft">Approval fixes the work order rate in force on {date(m.date)} against this measurement, and the quantity starts counting against the allocation.</p>}
          {dlg?.action === 'return' && <p className="text-[13px] text-ink-soft">The measurement goes back to the recorder for correction. Say what has to change.</p>}
          <Field label={dlg?.requiresComment ? 'Comments (required)' : 'Comments (optional)'}><Textarea value={comment} onChange={(e) => setComment(e.target.value)} autoFocus /></Field>
        </div>
      </Dialog>

      <Dialog open={reverseOpen} onClose={() => setReverseOpen(false)} title={`Reverse ${m.measurementNo}`}
        footer={<><Button onClick={() => setReverseOpen(false)}>Cancel</Button><Button variant="danger" busy={reverse.isPending} disabled={reason.trim().length < 5} onClick={() => reverse.mutate(reason.trim())}>Create reversal entry</Button></>}>
        <div className="grid gap-3">
          {reverse.error ? <Notice error={reverse.error} /> : null}
          <p className="text-[13px]">An approved measurement is never edited or deleted. Reversing creates a new entry of <span className="font-semibold text-red">−{num(m.quantity)} {unitLabel(m.unit)}</span> with the same {humanize(status).toLowerCase()} standing and rate, so approved and certified totals drop by that amount. {m.measurementNo} stays on record, marked as reversed.</p>
          <p className="text-[13px] text-ink-soft">If the work was partly right, record a fresh measurement for the correct quantity after reversing.</p>
          <Field label="Reason for reversal (required)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="e.g. Chainage 120–180 measured twice; duplicate of MS-00012" /></Field>
        </div>
      </Dialog>

      <Dialog open={delOpen} onClose={() => setDelOpen(false)} title={`Delete ${m.measurementNo}`}
        footer={<><Button onClick={() => setDelOpen(false)}>Cancel</Button><Button variant="danger" busy={del.isPending} onClick={() => del.mutate(undefined)}>Delete draft</Button></>}>
        {del.error ? <div className="mb-3"><Notice error={del.error} /></div> : null}
        <p className="text-[13px]">This draft has never been submitted, so it can be deleted outright. The measurement number is not reused.</p>
      </Dialog>
    </>
  );
}

/** Draft → Submitted → SE verified → Billing scrutinised → PM approved → (Commercial review) → Certified, with who/when from the history. */
function Stepper({ m }: { m: any }) {
  const history: any[] = m.history ?? [];
  const status = m.status as MeasurementStatus;
  const order = STEPS.map((s) => s.status);
  // Only the actions since the last return (or since creation) describe the current pass.
  const lastReturnIdx = history.map((h) => h.action).lastIndexOf('return');
  const pass = lastReturnIdx >= 0 ? history.slice(lastReturnIdx + 1) : history;
  const curIdx = status === 'RETURNED' ? 0 : order.indexOf(status);
  const reviewed = pass.some((h) => h.toStatus === 'COMMERCIAL_REVIEWED');
  return (
    <Sheet>
      <ol className="grid gap-y-3 sm:grid-cols-7">
        {STEPS.map((s, i) => {
          const entry = s.status === 'DRAFT' ? (lastReturnIdx >= 0 ? history[lastReturnIdx] : history.find((h) => h.action === 'create')) : [...pass].reverse().find((h) => h.toStatus === s.status);
          const skipped = s.optional && status === 'CERTIFIED' && !reviewed;
          const done = i <= curIdx;
          const current = i === curIdx + 1 && !skipped && status !== 'CERTIFIED' && status !== 'REVERSED';
          return (
            <li key={s.status} className="relative flex gap-2 sm:flex-col sm:gap-1.5 sm:pr-3">
              <div className="flex items-center gap-2">
                <span className={cx('grid size-6 shrink-0 place-items-center rounded-full border text-[11px]', done && !skipped ? 'border-teal bg-teal text-white' : current ? 'border-teal bg-teal-wash text-teal-deep' : 'border-rule bg-sheet text-ink-soft')}>
                  {done && !skipped ? <Check className="size-3.5" /> : <Circle className={cx('size-2', current ? 'fill-teal text-teal' : 'fill-rule text-rule')} />}
                </span>
                <span className="hidden h-px flex-1 bg-rule sm:block" />
              </div>
              <div className="min-w-0 text-[13px]">
                <div className={cx('font-medium', !done && !current && 'text-ink-soft')}>{s.label}{s.optional && <span className="font-normal text-ink-soft"> (optional)</span>}</div>
                {skipped ? <div className="text-xs text-ink-soft">Skipped</div>
                  : s.status === 'DRAFT' && status === 'RETURNED' && entry ? <div className="text-xs text-amber">Returned by {entry.userName}<br />{dateTime(entry.at)}</div>
                  : done && entry ? <div className="text-xs text-ink-soft">{entry.userName}<br />{dateTime(entry.at)}</div>
                  : current ? <div className="text-xs text-teal-deep">Waiting</div> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Sheet>
  );
}

function History({ rows }: { rows: any[] }) {
  if (!rows?.length) return <Sheet><p className="text-ink-soft">No workflow actions yet.</p></Sheet>;
  return (
    <Sheet flush>
      <ul className="divide-y divide-rule-soft">
        {[...rows].reverse().map((h) => (
          <li key={h.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 text-[13px]">
            <div className="min-w-0">
              <div><span className="font-medium">{humanize(h.action.replace('-', '_'))}</span> by {h.userName}{h.fromStatus && h.fromStatus !== h.toStatus && <span className="text-ink-soft"> · {humanize(h.fromStatus)} to {humanize(h.toStatus)}</span>}</div>
              {h.comment && <div className="mt-0.5 text-ink-soft">“{h.comment}”</div>}
            </div>
            <span className="text-xs whitespace-nowrap text-ink-soft">{dateTime(h.at)}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

const HEAD_FIELDS: [string, string][] = [['date', 'Date'], ['mbNo', 'MB no.'], ['mbPage', 'Page'], ['type', 'Type'], ['location', 'Location'], ['zone', 'Zone'], ['structure', 'Structure'], ['drawingRef', 'Drawing ref.'], ['allocationId', 'Allocation'], ['workOrderItemId', 'Work order line'], ['remarks', 'Remarks']];

/** Submitted revisions (immutable snapshots) and what changed between them, including unsubmitted edits. */
function Revisions({ m }: { m: any }) {
  const snaps: any[] = m.snapshots ?? [];
  const editedSinceSubmit = (EDITABLE_MEASUREMENT as string[]).includes(m.status) && snaps.length > 0;
  const versions = [...snaps.map((s) => ({ key: s.id, label: `R${s.revision}`, at: s.createdAt, data: s.data })), ...(editedSinceSubmit ? [{ key: 'current', label: 'Current (not yet resubmitted)', at: m.updatedAt, data: m }] : [])];
  const [sel, setSel] = useState(versions.length - 1);
  if (!snaps.length) return <Sheet><p className="text-ink-soft">No revisions yet. A revision is frozen each time the measurement is submitted.</p></Sheet>;
  const cur = versions[sel];
  const prev = sel > 0 ? versions[sel - 1] : null;
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Sheet flush>
        <ul className="divide-y divide-rule-soft">
          {versions.map((v, i) => (
            <li key={v.key}><button onClick={() => setSel(i)} className={cx('flex w-full items-center justify-between px-4 py-2 text-left text-[13px] hover:bg-teal-wash/50', i === sel && 'bg-teal-wash')}>
              <span><span className="font-medium">{v.label}</span><span className="block text-xs text-ink-soft">{dateTime(v.at)}</span></span>
              <span className="num">{num(v.data.quantity)}</span>
            </button></li>
          ))}
        </ul>
      </Sheet>
      <Sheet title={prev ? `${cur.label} compared with ${prev.label}` : `${cur.label} (first submission)`}>
        {prev ? <Diff a={prev.data} b={cur.data} unit={m.unit} /> : <LinesTable lines={cur.data.lines ?? []} />}
      </Sheet>
    </div>
  );
}

function Diff({ a, b, unit }: { a: any; b: any; unit: string }) {
  const dq = D(b.quantity).minus(a.quantity);
  const s = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? date(v) : String(v));
  const head: [string, string, string][] = HEAD_FIELDS.filter(([k]) => s(a[k]) !== s(b[k])).map(([k, l]) => [l, s(a[k]), s(b[k])]);
  const aa = a.attributes ?? {}, ba = b.attributes ?? {};
  for (const k of new Set([...Object.keys(aa), ...Object.keys(ba)])) if (s(aa[k]) !== s(ba[k])) head.push([ATTR_LABEL[k] ?? humanize(k), s(aa[k]), s(ba[k])]);
  const al: any[] = a.lines ?? [], bl: any[] = b.lines ?? [];
  const n = Math.max(al.length, bl.length);
  const rows = Array.from({ length: n }, (_, i) => ({ i, x: al[i], y: bl[i] }));
  const sameLine = (x: any, y: any) => x && y && x.formula === y.formula && (x.description ?? '') === (y.description ?? '') && D(x.quantity).eq(y.quantity);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap gap-x-8 gap-y-1 text-[13px]">
        <span>Quantity <span className="num">{num(a.quantity)}</span> to <span className="num font-semibold">{num(b.quantity)}</span> {unitLabel(unit)}</span>
        <span className={cx('num font-semibold', dq.isNegative() ? 'text-red' : dq.isZero() ? 'text-ink-soft' : 'text-green')}>{dq.isZero() ? 'No change in quantity' : `${dq.isPositive() ? '+' : ''}${num(dq.toString())} ${unitLabel(unit)}`}</span>
      </div>
      {head.length > 0 && (
        <table className="w-full text-[13px]"><thead><tr className="border-b border-rule text-left text-ink-soft"><th className="py-1 pr-3 font-medium">Field</th><th className="py-1 pr-3 font-medium">Before</th><th className="py-1 font-medium">After</th></tr></thead>
          <tbody>{head.map(([l, x, y]) => <tr key={l} className="border-b border-rule-soft"><td className="py-1 pr-3 text-ink-soft">{l}</td><td className="py-1 pr-3 text-red line-through">{x}</td><td className="py-1 text-green">{y}</td></tr>)}</tbody></table>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead><tr className="border-b border-rule bg-paper text-left text-ink-soft"><th className="px-2 py-1.5 font-medium">#</th><th className="px-2 py-1.5 font-medium">Before</th><th className="px-2 py-1.5 text-right font-medium">Qty</th><th className="px-2 py-1.5 font-medium">After</th><th className="px-2 py-1.5 text-right font-medium">Qty</th><th className="px-2 py-1.5 font-medium" /></tr></thead>
          <tbody>
            {rows.map(({ i, x, y }) => {
              const same = sameLine(x, y);
              return (
                <tr key={i} className={cx('border-b border-rule-soft align-top', !same && 'bg-amber-wash/40')}>
                  <td className="px-2 py-1.5 text-ink-soft">{i + 1}</td>
                  <td className="px-2 py-1.5">{x ? <><div>{x.description ?? '—'}</div><div className="font-mono text-[12px] text-ink-soft">{x.formula}</div></> : <span className="text-ink-soft">—</span>}</td>
                  <td className="num px-2 py-1.5">{x ? num(x.quantity) : ''}</td>
                  <td className="px-2 py-1.5">{y ? <><div>{y.description ?? '—'}</div><div className="font-mono text-[12px] text-ink-soft">{y.formula}</div></> : <span className="text-ink-soft">—</span>}</td>
                  <td className="num px-2 py-1.5">{y ? num(y.quantity) : ''}</td>
                  <td className="px-2 py-1.5">{!x ? <Tag tone="green">Added</Tag> : !y ? <Tag tone="red">Removed</Tag> : same ? '' : <Tag tone="amber">Changed</Tag>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinesTable({ lines }: { lines: any[] }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead><tr className="border-b border-rule text-left text-ink-soft"><th className="py-1.5 pr-2 font-medium">#</th><th className="py-1.5 pr-2 font-medium">Description</th><th className="py-1.5 pr-2 font-medium">Formula</th><th className="py-1.5 text-right font-medium">Qty</th></tr></thead>
      <tbody>{lines.map((l, i) => <tr key={i} className="border-b border-rule-soft"><td className="py-1.5 pr-2 text-ink-soft">{l.lineNo ?? i + 1}</td><td className="py-1.5 pr-2">{l.description ?? '—'}</td><td className="py-1.5 pr-2 font-mono text-[12px] text-ink-soft">{l.formula}</td><td className="num py-1.5">{num(l.quantity)}</td></tr>)}</tbody>
    </table>
  );
}
