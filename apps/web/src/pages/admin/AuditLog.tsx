import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useCompany } from '../../lib/company';
import { useApi } from '../../lib/hooks';
import { dateTime, humanize } from '../../lib/format';
import { Input, Notice, PageHeader, Select, Sheet, Tag, cx } from '../../components/ui';

/** Entity types written by the API's audit() calls. Types seen in loaded entries are added to the list too. */
const KNOWN_TYPES = ['BoqBreakup', 'BoqImport', 'BoqItem', 'BoqRevision', 'Company', 'ConsumptionNorm', 'Contract', 'Document', 'ExecutionActivity', 'Material', 'MaterialIssue', 'MaterialReceipt',
  'MaterialReconciliation', 'MaterialRequisition', 'MaterialReturn', 'Measurement', 'ProgressEntry', 'Project', 'Role', 'Subcontractor', 'User', 'WorkAllocation', 'WorkOrder', 'WorkOrderAmendment'];
const typeLabel = (t: string) => t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^Boq/, 'BOQ').replace(/ ([A-Z])/g, (m) => m.toLowerCase()).replace(/ boq/g, ' BOQ');

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
/** Flattens nested JSON to dotted paths (arrays by index), so a diff can point at the exact field that changed. */
function flatten(v: unknown, prefix = '', depth = 0, out: Record<string, unknown> = {}) {
  if (isObj(v) && depth < 4 && Object.keys(v).length > 0) {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, depth + 1, out);
  } else out[prefix || '(value)'] = v;
  return out;
}
const show = (v: unknown) => (v === undefined ? '' : v === null ? 'null' : typeof v === 'string' ? v : JSON.stringify(v));

const primArray = (v: unknown): v is (string | number | boolean | null)[] => Array.isArray(v) && v.every((x) => !isObj(x));

/** Lists (e.g. a role's permissions) are compared as sets: what was added and what was removed. */
function ListDiff({ before, after }: { before: unknown[]; after: unknown[] }) {
  const b = new Set(before.map(show)), a = new Set(after.map(show));
  const added = [...a].filter((x) => !b.has(x)), removed = [...b].filter((x) => !a.has(x)), kept = [...a].filter((x) => b.has(x));
  return (
    <div className="grid gap-2 text-[13px]">
      <div><span className="font-medium">Added ({added.length}):</span> {added.length ? added.map((x) => <span key={x} className="mr-1 inline-block rounded-[3px] bg-green-wash px-1.5 font-mono text-[12px] text-green">{x}</span>) : <span className="text-ink-soft">none</span>}</div>
      <div><span className="font-medium">Removed ({removed.length}):</span> {removed.length ? removed.map((x) => <span key={x} className="mr-1 inline-block rounded-[3px] bg-red-wash px-1.5 font-mono text-[12px] text-red line-through">{x}</span>) : <span className="text-ink-soft">none</span>}</div>
      <div className="text-ink-soft">Unchanged: {kept.length ? kept.join(', ') : 'none'}</div>
    </div>
  );
}

function Diff({ before, after }: { before: unknown; after: unknown }) {
  const [onlyChanged, setOnlyChanged] = useState(true);
  if (primArray(before) && primArray(after)) return <ListDiff before={before} after={after} />;
  const b = before === null || before === undefined ? null : flatten(before);
  const a = after === null || after === undefined ? null : flatten(after);
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])];
  const both = !!b && !!a;
  const rows = keys.map((k) => ({ k, bv: b?.[k], av: a?.[k], changed: both && show(b?.[k]) !== show(a?.[k]) }));
  const changedCount = rows.filter((r) => r.changed).length;
  const visible = both && onlyChanged ? rows.filter((r) => r.changed) : rows;
  if (!b && !a) return <p className="text-[13px] text-ink-soft">No data recorded for this entry.</p>;
  return (
    <div>
      {both && (
        <div className="mb-2 flex flex-wrap items-center gap-3 text-[13px]">
          <span>{changedCount} of {keys.length} fields changed</span>
          <label className="flex items-center gap-1.5 text-ink-soft"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Only changed fields</label>
        </div>
      )}
      <div className="max-h-[420px] overflow-auto rounded-[3px] border border-rule-soft bg-sheet">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0">
            <tr className="bg-paper text-left text-ink-soft">
              <th className="w-[28%] px-2 py-1.5 font-medium">Field</th>
              {b && <th className="px-2 py-1.5 font-medium">Before</th>}
              {a && <th className="px-2 py-1.5 font-medium">After</th>}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={3} className="px-2 py-3 text-ink-soft">No field values differ.</td></tr>}
            {visible.map((r) => (
              <tr key={r.k} className={cx('border-t border-rule-soft align-top', r.changed && 'bg-amber-wash')}>
                <td className={cx('px-2 py-1 font-mono break-all', r.changed && 'font-semibold')}>{r.k}</td>
                {b && <td className={cx('px-2 py-1 font-mono break-all whitespace-pre-wrap', r.changed && 'text-red line-through decoration-red/40')}>{show(r.bv)}</td>}
                {a && <td className={cx('px-2 py-1 font-mono break-all whitespace-pre-wrap', r.changed && 'text-green')}>{show(r.av)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AuditLog() {
  const { companyId, company } = useCompany();
  const { can } = useAuth();
  const [entityType, setEntityType] = useState('');
  const [take, setTake] = useState(100);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const allowed = !!companyId && can('audit.view', { companyId });
  const qs = new URLSearchParams({ companyId: companyId ?? '', take: String(take), ...(entityType ? { entityType } : {}) });
  const { data, error, isFetching } = useApi<any[]>(allowed ? `/audit?${qs}` : null);
  const { data: projects } = useApi<any[]>('/projects');
  const projCode = (id: string | null) => (id ? projects?.find((p) => p.id === id)?.code ?? 'Project' : '');
  const types = useMemo(() => [...new Set([...KNOWN_TYPES, ...(data ?? []).map((e) => e.entityType)])].sort(), [data]);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return data;
    return data?.filter((e) => `${e.userName ?? ''} ${e.action} ${e.entityType} ${e.entityId} ${e.reason ?? ''} ${JSON.stringify(e.after ?? '')}`.toLowerCase().includes(n));
  }, [data, q]);
  const toggle = (id: string) => setOpen((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  return (
    <>
      <PageHeader title="Audit log" description={`Every change to contracts, BOQs, work orders, measurements, materials and access in ${company?.name ?? 'this company'}, with who made it, when, the values before and after, and the reason given.`} />
      {!allowed ? <Notice tone="warning" title="You do not have permission to view the audit log" /> : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <Select aria-label="Entity type" value={entityType} onChange={(e) => setEntityType(e.target.value)} className="sm:max-w-[240px]">
              <option value="">All record types</option>
              {types.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
            </Select>
            <Input aria-label="Filter entries" placeholder="Filter by user, action, record id or reason" value={q} onChange={(e) => setQ(e.target.value)} className="sm:max-w-[340px]" />
            <Select aria-label="Number of entries" value={take} onChange={(e) => setTake(Number(e.target.value))} className="sm:max-w-[150px]">
              {[100, 250, 500].map((n) => <option key={n} value={n}>Latest {n}</option>)}
            </Select>
            <span className="pb-2 text-[13px] text-ink-soft">{isFetching ? 'Loading…' : rows ? `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}` : ''}</span>
          </div>
          {error ? <Notice error={error} /> : null}
          <Sheet flush>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-rule bg-paper text-left text-ink-soft">
                    <th className="w-8 px-2 py-2" />
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Record</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows === undefined && <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-soft">Loading</td></tr>}
                  {rows?.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-soft">No audit entries match.</td></tr>}
                  {rows?.map((e) => {
                    const isOpen = open.has(e.id);
                    return (
                      <Fragment key={e.id}>
                        <tr onClick={() => toggle(e.id)} className={cx('cursor-pointer border-b border-rule-soft align-top hover:bg-teal-wash/50', isOpen && 'bg-teal-wash/40')}>
                          <td className="px-2 py-2 text-ink-soft">
                            <button type="button" aria-expanded={isOpen} aria-label={isOpen ? 'Hide details' : 'Show details'} onClick={(ev) => { ev.stopPropagation(); toggle(e.id); }}>
                              {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">{dateTime(e.at)}</td>
                          <td className="px-3 py-2">{e.userName ?? 'System'}</td>
                          <td className="px-3 py-2">
                            <div>{typeLabel(e.entityType)}{e.projectId && <span className="text-ink-soft"> · {projCode(e.projectId)}</span>}</div>
                            <div className="max-w-[260px] truncate font-mono text-[11px] text-ink-soft" title={e.entityId}>{e.entityId}</div>
                          </td>
                          <td className="px-3 py-2"><Tag tone={/DELETE|REVOKE|REJECT|REVERSE|CANCEL/.test(e.action) ? 'red' : /APPROVE|CERTIF|CONFIRM/.test(e.action) ? 'green' : 'grey'}>{humanize(e.action)}</Tag></td>
                          <td className="max-w-[320px] px-3 py-2 text-ink-soft"><span className="line-clamp-2">{e.reason ?? ''}</span></td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-rule bg-paper">
                            <td />
                            <td colSpan={5} className="px-3 py-3">
                              {e.reason && <p className="mb-2 text-[13px]"><span className="font-medium">Reason:</span> {e.reason}</p>}
                              <Diff before={e.before} after={e.after} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Sheet>
        </>
      )}
    </>
  );
}
