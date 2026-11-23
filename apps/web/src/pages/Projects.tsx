import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, useAction } from '../lib/hooks';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCompany } from '../lib/company';
import { date, humanize } from '../lib/format';
import { Button, Dialog, Field, Input, Notice, PageHeader, Select, Sheet, Status, Table } from '../components/ui';

const TYPES = ['WTP', 'STP', 'WATER_SUPPLY', 'PIPELINE', 'PUMPING_STATION', 'SEWERAGE', 'CIVIL', 'RCC_BUILDING', 'MECH_ELEC', 'INDUSTRIAL_EPC', 'HYDRO_MECHANICAL', 'OTHER'];
const LABEL: Record<string, string> = { WTP: 'Water treatment plant', STP: 'Sewage treatment plant', WATER_SUPPLY: 'Water supply scheme', PIPELINE: 'Transmission / distribution pipeline', PUMPING_STATION: 'Pumping station', SEWERAGE: 'Underground sewerage', CIVIL: 'Civil construction', RCC_BUILDING: 'RCC structures & buildings', MECH_ELEC: 'Mechanical & electrical', INDUSTRIAL_EPC: 'Industrial EPC', HYDRO_MECHANICAL: 'Hydro-mechanical', OTHER: 'Other BOQ contract' };

export function Projects() {
  const { data } = useApi<any[]>('/projects');
  const { can, me } = useAuth();
  const { companyId, companies } = useCompany();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', name: '', type: 'PIPELINE', client: '', location: '', state: '', startDate: '', endDate: '', companyId: '' });
  const create = useAction((b: typeof f) => api.post('/projects', { ...b, companyId: b.companyId || companyId, startDate: b.startDate || undefined, endDate: b.endDate || undefined }), { onSuccess: (p: any) => nav(`/p/${p.id}`) });
  const canCreate = can('org.manage', { companyId }) || me?.user.isSuperAdmin;
  return (
    <>
      <PageHeader title="Projects" description="Sites under each company. Creating a project also creates its main site store." actions={canCreate && <Button variant="primary" onClick={() => setOpen(true)}>New project</Button>} />
      {companies.length === 0 && me?.user.isSuperAdmin && <div className="mb-4"><Notice tone="info" title="No company yet">Create the first company from the API or the seed script before adding projects.</Notice></div>}
      <Sheet flush>
        <Table rows={data} rowKey={(r: any) => r.id} onRowClick={(r: any) => nav(`/p/${r.id}`)} empty="No projects yet." cols={[
          { key: 'code', header: 'Code', cell: (r: any) => <span className="font-medium">{r.code}</span> },
          { key: 'name', header: 'Name', cell: (r: any) => r.name },
          { key: 'type', header: 'Type', cell: (r: any) => LABEL[r.type] ?? humanize(r.type) },
          { key: 'client', header: 'Client', cell: (r: any) => r.client ?? '—' },
          { key: 'loc', header: 'Location', cell: (r: any) => [r.location, r.state].filter(Boolean).join(', ') || '—' },
          { key: 'start', header: 'Start', cell: (r: any) => date(r.startDate) },
          { key: 'status', header: 'Status', cell: (r: any) => <Status value={r.status} /> },
          { key: 'n', header: 'Contracts / WOs / MB', align: 'right', cell: (r: any) => `${r._count.contracts} / ${r._count.workOrders} / ${r._count.measurements}` },
        ]} />
      </Sheet>
      <Dialog open={open} onClose={() => setOpen(false)} title="New project" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={create.isPending} onClick={() => create.mutate(f)}>Create project</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {create.error ? <div className="sm:col-span-2"><Notice error={create.error} /></div> : null}
          {companies.length > 1 && <Field label="Company" className="sm:col-span-2"><Select value={f.companyId || companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
          <Field label="Project code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="e.g. UNA-WSS" /></Field>
          <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}</Select></Field>
          <Field label="Project name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Client"><Input value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} /></Field>
          <Field label="Location"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="State"><Input value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} /></Field>
          <div />
          <Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Completion date"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        </div>
      </Dialog>
    </>
  );
}
