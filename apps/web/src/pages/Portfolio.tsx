import { useNavigate } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { inr, humanize } from '../lib/format';
import { PageHeader, Sheet, Status, Table, Empty, Button } from '../components/ui';
import { D } from '@epc/shared';

export function Portfolio() {
  const { data } = useApi<any[]>('/reports/portfolio');
  const nav = useNavigate();
  const total = (k: string) => (data ?? []).reduce((s, r) => s.plus(r[k] ?? 0), D(0)).toString();
  return (
    <>
      <PageHeader title="Portfolio" description="Every project you can access, with contract value against what has been subcontracted and what is waiting in the measurement workflow." />
      {data && data.length === 0 ? (
        <Empty title="No projects yet" action={<Button variant="primary" onClick={() => nav('/projects')}>Create a project</Button>}>Create a project, then add its contract and BOQ.</Empty>
      ) : (
        <Sheet flush>
          <Table
            rows={data}
            rowKey={(r: any) => r.id}
            onRowClick={(r: any) => nav(`/p/${r.id}`)}
            cols={[
              { key: 'code', header: 'Code', cell: (r: any) => <span className="font-medium">{r.code}</span> },
              { key: 'name', header: 'Project', cell: (r: any) => <div><div>{r.name}</div><div className="text-xs text-ink-soft">{r.company} · {humanize(r.type)}</div></div> },
              { key: 'status', header: 'Status', cell: (r: any) => <Status value={r.status} /> },
              { key: 'cv', header: 'Contract value', align: 'right', cell: (r: any) => inr(r.contractValue, 0) },
              { key: 'sv', header: 'Subcontracted', align: 'right', cell: (r: any) => inr(r.subcontractedValue, 0) },
              { key: 'mp', header: 'Measurements in workflow', align: 'right', cell: (r: any) => r.measurementsPending },
            ]}
            footer={data && data.length > 1 ? <tr><td className="px-3 py-2" colSpan={3}>Total</td><td className="num px-3">{inr(total('contractValue'), 0)}</td><td className="num px-3">{inr(total('subcontractedValue'), 0)}</td><td /></tr> : undefined}
          />
        </Sheet>
      )}
    </>
  );
}
