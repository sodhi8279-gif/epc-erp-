import { Link } from 'react-router-dom';
import { useApi, useProject } from '../lib/hooks';
import { inr, humanize } from '../lib/format';
import { Facts, PageHeader, Sheet, Status, Table } from '../components/ui';
import { QuantityChain } from '../components/QuantityChain';

const FLOW = ['DRAFT', 'SUBMITTED', 'SE_VERIFIED', 'BILLING_SCRUTINIZED', 'PM_APPROVED', 'COMMERCIAL_REVIEWED', 'CERTIFIED', 'RETURNED'];

export function ProjectOverview() {
  const { projectId, project } = useProject();
  const { data: s } = useApi<any>(`/projects/${projectId}/summary`);
  const { data: matrix } = useApi<any[]>(`/projects/${projectId}/allocation-matrix`);
  if (!project) return null;
  return (
    <>
      <PageHeader title={project.name} description={[project.code, humanize(project.type), project.client, project.state].filter(Boolean).join(' · ')} actions={<Status value={project.status} />} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Sheet title="Commercial position">
          <Facts items={[
            ['Contract value (approved BOQ)', inr(s?.contractValue, 0)],
            ['Approved work orders', s ? `${s.approvedWorkOrders} · ${inr(s.workOrderValue, 0)}` : '—'],
            ['Approved measured value (subcontract rates)', inr(s?.approvedMeasurementValue, 0)],
            ['Material issued (issue value)', inr(s?.materialIssuedValue, 0)],
            ['Approved material recoveries', inr(s?.approvedMaterialRecoveries, 0)],
            ['Allocation exceptions awaiting approval', s?.pendingAllocationExceptions ?? '—'],
          ]} cols={3} />
        </Sheet>
        <Sheet title="Measurement book workflow">
          <ul className="space-y-1.5">
            {FLOW.map((st) => (
              <li key={st} className="flex items-center justify-between"><Status value={st} /><Link className="num text-teal hover:underline" to={`/p/${projectId}/measurements?status=${st}`}>{s?.measurementsByStatus?.[st] ?? 0}</Link></li>
            ))}
          </ul>
        </Sheet>
      </div>
      <Sheet className="mt-4" title="Execution by activity" actions={<Link to={`/p/${projectId}/allocation`} className="text-[13px] text-teal hover:underline">Open allocation matrix</Link>} flush>
        <Table rows={matrix} rowKey={(r: any) => r.activityId} empty="Approve a BOQ and its activity breakup to see execution here." cols={[
          { key: 'item', header: 'BOQ item', cell: (r: any) => <span className="font-medium">{r.itemNo}</span>, width: '80px' },
          { key: 'act', header: 'Activity', cell: (r: any) => <div><div>{r.activityName}</div><div className="text-xs text-ink-soft">{r.contractNo} · {r.activityCode}</div></div> },
          { key: 'chain', header: 'Allocated → executed → measured → approved → certified', cell: (r: any) => <QuantityChain compact scope={r.revisedQty} unit={r.unit} values={r} />, width: '38%' },
          { key: 'scope', header: 'Scope', align: 'right', cell: (r: any) => `${r.revisedQty} ${r.unit}` },
          { key: 'cert', header: 'Certified', align: 'right', cell: (r: any) => r.certified },
        ]} />
      </Sheet>
    </>
  );
}
