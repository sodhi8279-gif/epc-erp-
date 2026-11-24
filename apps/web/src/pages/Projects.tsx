import { useNavigate } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useCompany } from '../lib/company';
import { date, humanize } from '../lib/format';
import { Button, Notice, PageHeader, Sheet, Status, Table } from '../components/ui';

export const PROJECT_TYPES = ['WTP', 'STP', 'WATER_SUPPLY', 'PIPELINE', 'PUMPING_STATION', 'SEWERAGE', 'CIVIL', 'RCC_BUILDING', 'MECH_ELEC', 'INDUSTRIAL_EPC', 'HYDRO_MECHANICAL', 'OTHER'];
export const PROJECT_TYPE_LABEL: Record<string, string> = { WTP: 'Water treatment plant', STP: 'Sewage treatment plant', WATER_SUPPLY: 'Water supply scheme', PIPELINE: 'Transmission / distribution pipeline', PUMPING_STATION: 'Pumping station', SEWERAGE: 'Underground sewerage', CIVIL: 'Civil construction', RCC_BUILDING: 'RCC structures & buildings', MECH_ELEC: 'Mechanical & electrical', INDUSTRIAL_EPC: 'Industrial EPC', HYDRO_MECHANICAL: 'Hydro-mechanical', OTHER: 'Other BOQ contract' };

export function Projects() {
  const { data } = useApi<any[]>('/projects');
  const { can, me } = useAuth();
  const { companyId, companies } = useCompany();
  const nav = useNavigate();
  const canCreate = can('org.manage', { companyId }) || me?.user.isSuperAdmin;
  return (
    <>
      <PageHeader title="Projects" description="Sites under each company. Creating a project also creates its main site store." actions={canCreate && <Button variant="primary" onClick={() => nav('/projects/new')}>New project</Button>} />
      {companies.length === 0 && me?.user.isSuperAdmin && <div className="mb-4"><Notice tone="info" title="No company yet">Create the first company from the API or the seed script before adding projects.</Notice></div>}
      <Sheet flush>
        <Table rows={data} rowKey={(r: any) => r.id} onRowClick={(r: any) => nav(`/p/${r.id}`)} empty="No projects yet." cols={[
          { key: 'code', header: 'Code', cell: (r: any) => <span className="font-medium">{r.code}</span> },
          { key: 'name', header: 'Name', cell: (r: any) => r.name },
          { key: 'type', header: 'Type', cell: (r: any) => PROJECT_TYPE_LABEL[r.type] ?? humanize(r.type) },
          { key: 'client', header: 'Client', cell: (r: any) => r.client ?? '—' },
          { key: 'loc', header: 'Location', cell: (r: any) => [r.location, r.state].filter(Boolean).join(', ') || '—' },
          { key: 'start', header: 'Start', cell: (r: any) => date(r.startDate) },
          { key: 'status', header: 'Status', cell: (r: any) => <Status value={r.status} /> },
          { key: 'n', header: 'Contracts / WOs / MB', align: 'right', cell: (r: any) => `${r._count.contracts} / ${r._count.workOrders} / ${r._count.measurements}` },
        ]} />
      </Sheet>
    </>
  );
}
