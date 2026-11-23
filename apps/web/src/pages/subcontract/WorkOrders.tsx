import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { sum } from '@epc/shared';
import { useAuth } from '../../lib/auth';
import { useApi, useProject } from '../../lib/hooks';
import { date, humanize, inr } from '../../lib/format';
import { Button, Notice, PageHeader, Select, Sheet, Status, Table } from '../../components/ui';

const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'CLOSED'];

export function WorkOrders() {
  const { projectId, project } = useProject();
  const { can } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [sub, setSub] = useState('');
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(sub ? { subcontractorId: sub } : {}) }).toString();
  const { data, error } = useApi<any[]>(`/projects/${projectId}/work-orders${qs ? `?${qs}` : ''}`);
  const { data: all } = useApi<any[]>(`/projects/${projectId}/work-orders`);
  const subs = [...new Map((all ?? []).map((w) => [w.subcontractor.id, w.subcontractor])).values()];
  const total = sum((data ?? []).filter((w) => w.status === 'APPROVED').map((w) => w.value)).toString();
  return (
    <>
      <PageHeader title="Work orders" description={`Subcontract work orders of ${project?.name ?? 'this project'}. Every line is tied to an approved BOQ execution activity.`}
        actions={can('workorder.edit', { projectId }) && <Button variant="primary" onClick={() => nav('new')}><Plus className="size-4" /> New work order</Button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-48">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </Select>
        <Select aria-label="Subcontractor" value={sub} onChange={(e) => setSub(e.target.value)} className="w-full sm:w-64">
          <option value="">All subcontractors</option>
          {subs.map((s: any) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
        </Select>
      </div>
      {error ? <div className="mb-3"><Notice error={error} /></div> : null}
      <Sheet flush>
        <Table rows={data} rowKey={(r: any) => r.id} onRowClick={(r: any) => nav(r.id)} empty="No work orders yet." cols={[
          { key: 'no', header: 'WO no.', cell: (r: any) => <span className="font-medium">{r.woNo}</span>, width: '110px' },
          { key: 't', header: 'Title', cell: (r: any) => <div><div>{r.title}</div><div className="text-xs text-ink-soft">{r._count.items} lines</div></div> },
          { key: 's', header: 'Subcontractor', cell: (r: any) => <div><div>{r.subcontractor.name}</div><div className="text-xs text-ink-soft">{r.subcontractor.code}</div></div> },
          { key: 'd', header: 'Period', cell: (r: any) => <span className="whitespace-nowrap">{date(r.startDate)} – {date(r.completionDate)}</span> },
          { key: 'v', header: 'Value', align: 'right', cell: (r: any) => inr(r.value) },
          { key: 'st', header: 'Status', cell: (r: any) => <Status value={r.status} /> },
        ]} footer={data && data.length > 0 ? <tr><td colSpan={4} className="px-3 py-2">Approved work orders in view</td><td className="num px-3 py-2">{inr(total)}</td><td /></tr> : undefined} />
      </Sheet>
    </>
  );
}
