import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Undo2 } from 'lucide-react';
import { D, MEASUREMENT_STATUSES } from '@epc/shared';
import { useApi, useProject } from '../../lib/hooks';
import { date, num, unitLabel } from '../../lib/format';
import { Button, Field, Input, PageHeader, Select, Sheet, Status, Table, Tag, cx } from '../../components/ui';
import { TYPE_SHORT, chainage, useMbPermissions, useWorkOrderLines } from '../../components/mb/common';

const STATUS_CHIPS: { value: string; label: string }[] = [
  { value: 'DRAFT', label: 'Draft' }, { value: 'RETURNED', label: 'Returned' }, { value: 'SUBMITTED', label: 'Submitted' }, { value: 'SE_VERIFIED', label: 'SE verified' },
  { value: 'BILLING_SCRUTINIZED', label: 'Billing scrutinised' }, { value: 'PM_APPROVED', label: 'PM approved' }, { value: 'COMMERCIAL_REVIEWED', label: 'Commercial reviewed' }, { value: 'CERTIFIED', label: 'Certified' }, { value: 'REVERSED', label: 'Reversed' },
];

export function Measurements() {
  const { projectId } = useProject();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { canP, actionable } = useMbPermissions(projectId);
  const { activities, subcontractors } = useWorkOrderLines(projectId);

  const statuses = (sp.get('status') ?? '').split(',').filter((s) => (MEASUREMENT_STATUSES as readonly string[]).includes(s));
  const queue = sp.get('queue') === '1';
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const toggleStatus = (s: string) => set('status', (statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]).join(',') || null);

  const qs = new URLSearchParams();
  if (statuses.length) qs.set('status', statuses.join(','));
  for (const k of ['subcontractorId', 'activityId', 'workOrderId', 'from', 'to']) { const v = sp.get(k); if (v) qs.set(k, v); }
  const { data, error } = useApi<any[]>(`/projects/${projectId}/measurements${qs.toString() ? `?${qs}` : ''}`);
  const rows = useMemo(() => (data ? (queue ? data.filter(actionable) : data) : undefined), [data, queue, actionable]);
  const filtered = statuses.length > 0 || ['subcontractorId', 'activityId', 'workOrderId', 'from', 'to', 'queue'].some((k) => sp.get(k));

  return (
    <>
      <PageHeader title="Measurement book" description="Measurements recorded against approved work orders. Each moves through site verification, billing scrutiny and PM approval before certification."
        actions={canP('measurement.create') && <Button variant="primary" onClick={() => nav('new')}><Plus className="size-4" /> Record measurement</Button>} />

      <Sheet className="mb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => set('queue', queue ? null : '1')} aria-pressed={queue}
            className={cx('mr-2 rounded-[3px] border px-2.5 py-1 text-[13px] font-medium', queue ? 'border-teal bg-teal text-white' : 'border-rule bg-sheet text-ink hover:border-ink-soft')}>
            My queue{queue && rows ? ` · ${rows.length}` : ''}
          </button>
          {STATUS_CHIPS.map((c) => (
            <button key={c.value} onClick={() => toggleStatus(c.value)} aria-pressed={statuses.includes(c.value)}
              className={cx('rounded-[3px] border px-2 py-0.5 text-[13px]', statuses.includes(c.value) ? 'border-teal bg-teal-wash text-teal-deep font-medium' : 'border-rule text-ink-soft hover:text-ink')}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_160px_160px_auto]">
          <Field label="Subcontractor">
            <Select value={sp.get('subcontractorId') ?? ''} onChange={(e) => set('subcontractorId', e.target.value || null)}>
              <option value="">All subcontractors</option>
              {subcontractors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Activity">
            <Select value={sp.get('activityId') ?? ''} onChange={(e) => set('activityId', e.target.value || null)}>
              <option value="">All activities</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={sp.get('from') ?? ''} onChange={(e) => set('from', e.target.value || null)} /></Field>
          <Field label="To"><Input type="date" value={sp.get('to') ?? ''} onChange={(e) => set('to', e.target.value || null)} /></Field>
          <div className="flex items-end">{filtered && <Button variant="ghost" onClick={() => setSp(new URLSearchParams(), { replace: true })}>Clear filters</Button>}</div>
        </div>
        {queue && <p className="mt-2 text-[13px] text-ink-soft">Showing measurements waiting on an action you are permitted to take (submit, verify, scrutinise, approve, review or certify).</p>}
      </Sheet>

      <Sheet flush>
        {error ? <div className="p-4 text-red">{String((error as Error).message)}</div> : null}
        <Table rows={rows} rowKey={(r: any) => r.id} onRowClick={(r: any) => nav(r.id)}
          rowClassName={(r: any) => (r.reversalOfId ? 'bg-red-wash/40' : r.reversedById ? 'text-ink-soft' : undefined)}
          empty={filtered ? 'No measurements match these filters.' : 'No measurements yet. Record the first one against an approved work order.'}
          footer={rows && rows.length > 0 && new Set(rows.map((r: any) => r.unit)).size === 1 ? (
            <tr><td className="px-3 py-2" colSpan={7}>Total of {rows.length} entries</td><td className="num px-3 py-2">{num(rows.reduce((s: any, r: any) => s.plus(r.quantity), D(0)).toString())} {unitLabel(rows[0].unit)}</td><td colSpan={2} /></tr>
          ) : undefined}
          cols={[
            { key: 'no', header: 'Measurement', cell: (r: any) => <div><Link to={r.id} onClick={(e) => e.stopPropagation()} className="font-medium text-ink hover:underline">{r.measurementNo}</Link><div className="text-xs text-ink-soft">{TYPE_SHORT[r.type as keyof typeof TYPE_SHORT]}</div></div> },
            { key: 'mb', header: 'MB / page', cell: (r: any) => (r.mbNo || r.mbPage ? `${r.mbNo ?? '—'} / ${r.mbPage ?? '—'}` : <span className="text-ink-soft">—</span>) },
            { key: 'd', header: 'Date', cell: (r: any) => <span className="whitespace-nowrap">{date(r.date)}</span> },
            { key: 's', header: 'Subcontractor', cell: (r: any) => r.workOrder?.subcontractor?.name },
            { key: 'wo', header: 'Work order', cell: (r: any) => r.workOrder?.woNo },
            { key: 'it', header: 'BOQ item · activity', cell: (r: any) => <div className="max-w-[28ch]"><span className="font-medium">{r.boqItem?.itemNo}</span> · {r.activity?.code}<div className="truncate text-xs text-ink-soft" title={r.activity?.name}>{r.activity?.name}</div></div> },
            { key: 'loc', header: 'Location / chainage', cell: (r: any) => <div className="max-w-[24ch]">{r.chainageFrom != null && r.chainageTo != null ? <span className="num whitespace-nowrap">{chainage(r.chainageFrom)} – {chainage(r.chainageTo)}</span> : null}<div className="truncate text-xs text-ink-soft">{[r.zone, r.location, r.structure].filter(Boolean).join(' · ') || (r.chainageFrom == null ? '—' : '')}</div></div> },
            { key: 'q', header: 'Quantity', align: 'right', cell: (r: any) => <span className={cx('whitespace-nowrap', D(r.quantity).isNegative() && 'text-red font-medium')}>{num(r.quantity)} {unitLabel(r.unit)}</span> },
            { key: 'st', header: 'Status', cell: (r: any) => <div className="flex flex-col items-start gap-1"><Status value={r.status} />{r.reversalOfId && <Tag tone="red"><Undo2 className="mr-1 size-3" />Reversal entry</Tag>}{r.reversedById && <Tag tone="amber">Reversed</Tag>}</div> },
            { key: 'rv', header: 'Rev.', align: 'right', cell: (r: any) => `R${r.revision}` },
          ]} />
      </Sheet>
    </>
  );
}
