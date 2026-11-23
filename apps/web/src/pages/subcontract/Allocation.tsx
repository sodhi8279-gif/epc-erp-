import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { D } from '@epc/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { date, dateTime, inr, num, unitLabel } from '../../lib/format';
import { Button, Dialog, Empty, Field, Notice, PageHeader, Select, Sheet, Status, Table, Textarea, cx } from '../../components/ui';
import { QuantityChain } from '../../components/QuantityChain';
import { AllocateDialog, ProgressDialog } from '../../components/subcontract/AllocationDialogs';

const LATER = 'Billing and payments are a later module; billed and paid quantities will appear here once it is in use.';
const Later = () => <span title={LATER} className="cursor-help text-ink-soft underline decoration-dotted underline-offset-2">—</span>;
const ch = (a: any) => (a.chainageFrom != null && a.chainageTo != null ? `Ch ${num(a.chainageFrom)}–${num(a.chainageTo)}` : null);
const neg = (v: string | null) => v != null && D(v).lt(0);

type Decide = { alloc: any; action: 'approve-exception' | 'reject-exception' | 'cancel' };

export function Allocation() {
  const { projectId } = useProject();
  const { can } = useAuth();
  const [contractId, setContractId] = useState('');
  const { data: contracts } = useApi<any[]>(`/projects/${projectId}/contracts`);
  const { data: rows, error } = useApi<any[]>(`/projects/${projectId}/allocation-matrix${contractId ? `?contractId=${contractId}` : ''}`);
  const { data: pending } = useApi<any[]>(`/projects/${projectId}/allocations?status=PENDING_EXCEPTION`);
  const { data: progress } = useApi<any[]>(`/projects/${projectId}/progress`);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [allocFor, setAllocFor] = useState<{ activityId?: string } | null>(null);
  const [progFor, setProgFor] = useState<any | null>(null);
  const [decide, setDecide] = useState<Decide | null>(null);
  const [comment, setComment] = useState('');
  const [view, setView] = useState<'all' | 'unallocated' | 'allocated'>('all');
  const act = useAction((d: Decide) => api.post(`/allocations/${d.alloc.id}/${d.action}`, { comment: comment || undefined }), { onSuccess: () => { setDecide(null); setComment(''); } });

  const canAlloc = can('allocation.edit', { projectId });
  const canOverride = can('allocation.override', { projectId });
  const canProgress = can('measurement.create', { projectId });

  const filtered = (rows ?? []).filter((r) => view === 'all' || (view === 'unallocated' ? D(r.unallocated).gt(0) : D(r.allocated).gt(0)));
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; contractNo: string; itemNo: string; description: string; unit: string; rows: any[] }>();
    for (const r of filtered) {
      const k = `${r.contractId}:${r.itemKey}`;
      if (!m.has(k)) m.set(k, { key: k, contractNo: r.contractNo, itemNo: r.itemNo, description: r.itemDescription, unit: r.itemUnit, rows: [] });
      m.get(k)!.rows.push(r);
    }
    return [...m.values()];
  }, [filtered]);
  const multiContract = (contracts?.length ?? 0) > 1;
  const startDecide = (d: Decide) => { act.reset(); setComment(''); setDecide(d); };
  const NUMS: { key: string; label: string; title?: string }[] = [
    { key: 'contractQty', label: 'Contract', title: 'Original contract quantity in activity units' },
    { key: 'revisedQty', label: 'Revised', title: 'Current approved BOQ quantity in activity units (the scope)' },
    { key: 'allocated', label: 'Allocated' }, { key: 'unallocated', label: 'Unallocated' },
    { key: 'executed', label: 'Executed', title: 'Daily site progress' }, { key: 'measured', label: 'Measured', title: 'Measurement book entries submitted' },
    { key: 'approved', label: 'Approved' }, { key: 'certified', label: 'Certified' },
  ];

  return (
    <>
      <PageHeader title="Work allocation" description="Every BOQ activity with its quantity chain kept separate: contract, revised scope, allocated to subcontractors, executed at site, measured, approved and certified."
        actions={canAlloc && <Button variant="primary" onClick={() => setAllocFor({})}><Plus className="size-4" /> Allocate work</Button>} />

      {pending && pending.length > 0 && (
        <Sheet className="mb-4 border-amber/40" title={`Allocation exceptions awaiting approval (${pending.length})`} flush>
          <Table rows={pending} rowKey={(r: any) => r.id} cols={[
            { key: 'a', header: 'Activity', cell: (r: any) => <span>{r.activity.code} {r.activity.name}</span> },
            { key: 's', header: 'Subcontractor / WO', cell: (r: any) => <div><div>{r.subcontractor.name}</div><div className="text-xs text-ink-soft">{r.workOrder.woNo}</div></div> },
            { key: 'q', header: 'Quantity', align: 'right', cell: (r: any) => `${num(r.quantity)} ${unitLabel(r.activity.unit)}` },
            { key: 'z', header: 'Zone / chainage', cell: (r: any) => [r.zone, ch(r)].filter(Boolean).join(' · ') || '—' },
            { key: 'e', header: 'Exceptions and reason', cell: (r: any) => <div className="max-w-[48ch]"><ul className="list-disc pl-4 text-amber">{r.exceptions.map((e: string) => <li key={e}>{e.replace(/^[A-Z_]+: /, '')}</li>)}</ul><div className="mt-1 text-ink-soft">Reason: {r.exceptionReason}</div></div> },
            { key: 'd', header: 'Requested', cell: (r: any) => dateTime(r.createdAt) },
            { key: 'x', header: '', align: 'right', cell: (r: any) => (
              <div className="flex justify-end gap-1.5">
                {canOverride && <><Button size="sm" variant="danger" onClick={() => startDecide({ alloc: r, action: 'reject-exception' })}>Reject</Button><Button size="sm" variant="primary" onClick={() => startDecide({ alloc: r, action: 'approve-exception' })}>Approve exception</Button></>}
                {!canOverride && canAlloc && <Button size="sm" onClick={() => startDecide({ alloc: r, action: 'cancel' })}>Cancel allocation</Button>}
              </div>
            ) },
          ]} />
        </Sheet>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {multiContract && (
          <Select aria-label="Contract" value={contractId} onChange={(e) => setContractId(e.target.value)} className="w-full sm:w-64">
            <option value="">All contracts</option>
            {contracts!.map((c) => <option key={c.id} value={c.id}>{c.contractNo}</option>)}
          </Select>
        )}
        <Select aria-label="Show" value={view} onChange={(e) => setView(e.target.value as typeof view)} className="w-full sm:w-56">
          <option value="all">All activities</option>
          <option value="unallocated">With unallocated scope</option>
          <option value="allocated">With allocations</option>
        </Select>
        <span className="text-xs text-ink-soft">Quantities are in each activity's own unit.</span>
      </div>
      {error ? <Notice error={error} /> : null}
      {rows && rows.length === 0 ? (
        <Empty title="Nothing to allocate yet">Allocation works on approved BOQ breakups. Approve the BOQ and break items into execution activities under <Link className="text-teal underline" to={`/p/${projectId}/contracts`}>Contracts &amp; BOQ</Link>.</Empty>
      ) : (
        <Sheet flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-rule bg-paper text-left text-ink-soft">
                  <th className="w-8" />
                  <th className="min-w-[190px] px-2 py-2 font-medium">Activity</th>
                  <th className="px-2 py-2 font-medium">Unit</th>
                  {NUMS.map((n) => <th key={n.key} title={n.title} className="px-1 py-2 text-right font-medium">{n.label}</th>)}
                  <th className="px-1 py-2 text-right font-medium"><span title={LATER} className="cursor-help">Billed</span></th>
                  <th className="px-1 py-2 text-right font-medium"><span title={LATER} className="cursor-help">Paid</span></th>
                  <th className="px-1 py-2 text-right font-medium" title="Revised scope less measured">Remaining</th>
                  <th className="w-28 px-2 py-2 font-medium">Chain</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {!rows && <tr><td colSpan={16} className="px-3 py-8 text-center text-ink-soft">Loading</td></tr>}
                {rows && filtered.length === 0 && <tr><td colSpan={16} className="px-3 py-8 text-center text-ink-soft">No activities match.</td></tr>}
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    <tr className="border-b border-rule bg-paper">
                      <td colSpan={16} className="px-3 py-1.5">
                        <span className="font-semibold">Item {g.itemNo}</span>{multiContract && <span className="text-ink-soft"> · {g.contractNo}</span>}
                        <span className="ml-2 text-ink-soft" title={g.description}>{g.description.length > 110 ? g.description.slice(0, 110) + '…' : g.description}</span>
                        <span className="ml-2 text-xs text-ink-soft">BOQ unit {unitLabel(g.unit)}</span>
                      </td>
                    </tr>
                    {g.rows.map((r) => {
                      const isOpen = !!open[r.activityId];
                      const pendingHere = r.subcontractors.some((s: any) => s.allocations.some((a: any) => a.status === 'PENDING_EXCEPTION'));
                      return (
                        <Fragment key={r.activityId}>
                          <tr className={cx('border-b border-rule-soft align-middle hover:bg-teal-wash/40', isOpen && 'bg-teal-wash/30')}>
                            <td className="pl-2">
                              <button aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${r.activityCode}`} onClick={() => setOpen({ ...open, [r.activityId]: !isOpen })} className="p-1 text-ink-soft hover:text-ink">
                                {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                              </button>
                            </td>
                            <td className="px-2 py-2">
                              <button className="text-left" onClick={() => setOpen({ ...open, [r.activityId]: !isOpen })}>
                                <span className="font-medium">{r.activityCode}</span> {r.activityName}
                                <span className="block max-w-[190px] truncate text-xs text-ink-soft" title={r.subcontractors.map((s: any) => s.subcontractor.name).join(', ')}>{r.subcontractors.length ? r.subcontractors.map((s: any) => s.subcontractor.name).join(', ') : 'Not allocated'}{pendingHere && <span className="text-amber"> · exception pending</span>}</span>
                              </button>
                            </td>
                            <td className="px-2 py-2">{unitLabel(r.unit)}</td>
                            {NUMS.map((n) => <td key={n.key} className={cx('num px-1 py-2', n.key === 'unallocated' && (neg(r[n.key]) ? 'font-semibold text-red' : D(r[n.key]).gt(0) ? 'text-amber' : 'text-ink-soft'), n.key === 'revisedQty' && 'font-medium')}>{num(r[n.key])}</td>)}
                            <td className="num px-1 py-2"><Later /></td>
                            <td className="num px-1 py-2"><Later /></td>
                            <td className={cx('num px-1 py-2', neg(r.remaining) && 'text-red')}>{num(r.remaining)}</td>
                            <td className="w-24 px-1 py-2 [&>div]:min-w-[86px]!"><QuantityChain compact scope={r.revisedQty} unit={unitLabel(r.unit)} values={{ allocated: r.allocated, executed: r.executed, measured: r.measured, approved: r.approved, certified: r.certified }} /></td>
                            <td className="px-2 py-2 text-right">{canAlloc && <Button size="sm" variant="ghost" title={`Allocate ${r.activityCode}`} aria-label={`Allocate ${r.activityCode}`} onClick={() => setAllocFor({ activityId: r.activityId })}><Plus className="size-4" /></Button>}</td>
                          </tr>
                          {isOpen && (
                            <tr className="border-b border-rule">
                              <td />
                              <td colSpan={15} className="px-2 pb-4 pt-2">
                                <div className="grid gap-3">
                                  <div className="flex flex-wrap items-start gap-x-8 gap-y-3 rounded-[3px] border border-rule-soft bg-sheet p-3"><div className="w-full max-w-[520px]">
                                    <div className="mb-2 text-xs font-medium text-ink-soft">Quantity chain · {r.activityCode} {r.activityName}</div>
                                    <QuantityChain scope={r.revisedQty} unit={unitLabel(r.unit)} values={{ allocated: r.allocated, executed: r.executed, measured: r.measured, approved: r.approved, certified: r.certified }} />
                                    {r.contractQty && r.contractQty !== r.revisedQty && <p className="mt-2 text-xs text-ink-soft">Contract quantity {num(r.contractQty)}, revised to {num(r.revisedQty)} {unitLabel(r.unit)}.</p>}
                                    <p className="mt-2 text-xs text-ink-soft">Billed and paid: <Later /></p>
                                  </div>
                                  {canAlloc && <Button size="sm" onClick={() => setAllocFor({ activityId: r.activityId })}><Plus className="size-3.5" /> Allocate {r.activityCode}</Button>}</div>
                                  <SubTable r={r} canAlloc={canAlloc} canProgress={canProgress} onProgress={setProgFor} onCancel={(a) => startDecide({ alloc: a, action: 'cancel' })} />
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Sheet>
      )}

      <Sheet className="mt-4" title="Recent site progress" flush>
        <Table rows={progress?.slice(0, 50)} rowKey={(r: any) => r.id} empty="No progress recorded yet. Use Record progress on an active allocation." cols={[
          { key: 'd', header: 'Date', cell: (r: any) => date(r.date), width: '110px' },
          { key: 'a', header: 'Activity', cell: (r: any) => `${r.activity.code} ${r.activity.name}` },
          { key: 's', header: 'Subcontractor', cell: (r: any) => r.allocation?.subcontractor?.name ?? '—' },
          { key: 'l', header: 'Location / chainage', cell: (r: any) => [r.location, ch(r)].filter(Boolean).join(' · ') || '—' },
          { key: 'q', header: 'Quantity', align: 'right', cell: (r: any) => `${num(r.quantity)} ${unitLabel(r.activity.unit)}` },
          { key: 'm', header: 'Manpower', align: 'right', cell: (r: any) => r.manpower ?? '—' },
          { key: 'r', header: 'Remarks', cell: (r: any) => r.remarks ?? '' },
        ]} />
      </Sheet>

      <AllocateDialog projectId={projectId} rows={rows ?? []} activityId={allocFor?.activityId} open={!!allocFor} onClose={() => setAllocFor(null)} />
      <ProgressDialog projectId={projectId} alloc={progFor} onClose={() => setProgFor(null)} />
      <Dialog open={!!decide} onClose={() => setDecide(null)}
        title={decide?.action === 'approve-exception' ? 'Approve allocation exception' : decide?.action === 'reject-exception' ? 'Reject allocation exception' : 'Cancel allocation'}
        footer={<><Button onClick={() => setDecide(null)}>Back</Button><Button variant={decide?.action === 'approve-exception' ? 'primary' : 'danger'} busy={act.isPending} disabled={decide?.action !== 'approve-exception' && !comment.trim()} onClick={() => decide && act.mutate(decide)}>
          {decide?.action === 'approve-exception' ? 'Approve exception' : decide?.action === 'reject-exception' ? 'Reject exception' : 'Cancel allocation'}</Button></>}>
        {decide && (
          <div className="space-y-3">
            {act.error ? <Notice error={act.error} /> : null}
            <p className="text-[13px]">{decide.alloc.subName ?? decide.alloc.subcontractor?.name} · {decide.alloc.woNo ?? decide.alloc.workOrder?.woNo} · {num(decide.alloc.quantity)} {[decide.alloc.zone, ch(decide.alloc)].filter(Boolean).join(' · ')}</p>
            {decide.action === 'approve-exception' && <p className="text-[13px] text-ink-soft">The allocation becomes active and counts against scope. The requester cannot approve their own exception.</p>}
            {decide.action === 'cancel' && <p className="text-[13px] text-ink-soft">The quantity is released back to unallocated scope. Allocations with measurements cannot be cancelled.</p>}
            <Field label={decide.action === 'approve-exception' ? 'Comment (optional)' : 'Reason'}><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          </div>
        )}
      </Dialog>
    </>
  );
}

function SubTable({ r, canAlloc, canProgress, onProgress, onCancel }: { r: any; canAlloc: boolean; canProgress: boolean; onProgress: (a: any) => void; onCancel: (a: any) => void }) {
  if (!r.subcontractors.length) return <div className="flex items-center rounded-[3px] border border-dashed border-rule p-4 text-ink-soft">No subcontractor has been allocated this activity. Unallocated scope {num(r.unallocated)} {unitLabel(r.unit)}.</div>;
  const u = unitLabel(r.unit);
  return (
    <div className="overflow-x-auto rounded-[3px] border border-rule-soft bg-sheet">
      <table className="w-full min-w-[820px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-rule-soft text-left text-xs text-ink-soft">
            <th className="px-2 py-1.5 font-medium">Subcontractor / WO</th><th className="px-2 py-1.5 font-medium">Zone / chainage</th>
            <th className="px-2 py-1.5 text-right font-medium">Qty</th><th className="px-2 py-1.5 text-right font-medium">Rate</th><th className="px-2 py-1.5 text-right font-medium">Value</th>
            <th className="px-2 py-1.5 text-right font-medium">Executed</th><th className="px-2 py-1.5 text-right font-medium">Measured</th><th className="px-2 py-1.5 text-right font-medium">Balance</th>
            <th className="px-2 py-1.5 font-medium">Status</th><th />
          </tr>
        </thead>
        <tbody>
          {r.subcontractors.map((s: any) => (
            <Fragment key={s.subcontractor.id}>
              <tr className="border-b border-rule-soft bg-paper/70 font-medium">
                <td className="px-2 py-1.5" colSpan={2}>{s.subcontractor.name} <span className="text-xs font-normal text-ink-soft">{s.subcontractor.code}</span></td>
                <td className="num px-2 py-1.5">{num(s.allocated)}</td><td />
                <td className="num px-2 py-1.5">{inr(s.value)}</td>
                <td className="num px-2 py-1.5">{num(s.executed)}</td>
                <td className="num px-2 py-1.5" title={`Approved ${num(s.approved)} · certified ${num(s.certified)}`}>{num(s.measured)}</td>
                <td className={cx('num px-2 py-1.5', neg(s.balance) && 'text-red')}>{num(s.balance)}</td>
                <td colSpan={2} />
              </tr>
              {s.allocations.map((a: any) => {
                const info = { ...a, subName: s.subcontractor.name, unit: r.unit, activityLabel: `${r.activityCode} ${r.activityName}` };
                return (
                  <tr key={a.id} className="border-b border-rule-soft">
                    <td className="px-2 py-1.5 pl-5 text-ink-soft">{a.woNo}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{[a.zone, ch(a)].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="num px-2 py-1.5">{num(a.quantity)} <span className="text-xs text-ink-soft">{u}</span></td>
                    <td className="num px-2 py-1.5">{inr(a.rate)}</td>
                    <td className="num px-2 py-1.5">{inr(D(a.quantity).times(a.rate).toDecimalPlaces(2).toString())}</td>
                    <td colSpan={3} />
                    <td className="px-2 py-1.5"><Status value={a.status} /></td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex justify-end gap-1">
                        {canProgress && a.status === 'ACTIVE' && <Button size="sm" onClick={() => onProgress(info)}>Record progress</Button>}
                        {canAlloc && <Button size="sm" variant="ghost" aria-label={`Cancel allocation ${a.woNo} ${[a.zone, ch(a)].filter(Boolean).join(" ")}`} onClick={() => onCancel(info)}>Cancel</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
