import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { date, humanize, inr } from '../../lib/format';
import { Button, Dialog, Field, Input, Notice, PageHeader, Select, Sheet, Status, Table } from '../../components/ui';

export function Contracts() {
  const { projectId } = useProject();
  const { can } = useAuth();
  const nav = useNavigate();
  const { data } = useApi<any[]>(`/projects/${projectId}/contracts`);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ contractNo: '', title: '', client: '', type: 'ITEM_RATE', contractValue: '0', agreementDate: '', loaRef: '', startDate: '', completionDate: '' });
  const create = useAction((b: typeof f) => api.post(`/projects/${projectId}/contracts`, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== ''))), { onSuccess: (c: any) => nav(c.id) });
  return (
    <>
      <PageHeader title="Contracts & BOQ" description="Client contracts of this project. Each holds its BOQ revisions; approved revisions are locked." actions={can('contract.manage', { projectId }) && <Button variant="primary" onClick={() => setOpen(true)}>New contract</Button>} />
      <Sheet flush>
        <Table rows={data} rowKey={(r: any) => r.id} onRowClick={(r: any) => nav(r.id)} empty="No contracts yet. Add the client contract, then import or enter its BOQ." cols={[
          { key: 'no', header: 'Contract no.', cell: (r: any) => <span className="font-medium">{r.contractNo}</span> },
          { key: 't', header: 'Title', cell: (r: any) => <div><div>{r.title}</div><div className="text-xs text-ink-soft">{r.client} · {humanize(r.type)}</div></div> },
          { key: 'ag', header: 'Agreement', cell: (r: any) => date(r.agreementDate) },
          { key: 'rev', header: 'BOQ revisions', cell: (r: any) => <div className="flex flex-wrap gap-1">{r.revisions.length ? r.revisions.map((v: any) => <Status key={v.id} value={v.status} label={`R${v.revisionNo} ${humanize(v.status)}`} />) : <span className="text-ink-soft">None</span>}</div> },
          { key: 'v', header: 'Contract value', align: 'right', cell: (r: any) => inr(r.contractValue, 0) },
        ]} />
      </Sheet>
      <Dialog open={open} onClose={() => setOpen(false)} title="New contract" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={create.isPending} onClick={() => create.mutate(f)}>Create contract</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {create.error ? <div className="sm:col-span-2"><Notice error={create.error} /></div> : null}
          <Field label="Contract / agreement no."><Input value={f.contractNo} onChange={(e) => setF({ ...f, contractNo: e.target.value })} /></Field>
          <Field label="Contract type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['ITEM_RATE', 'PERCENTAGE_RATE', 'LUMP_SUM', 'EPC', 'DESIGN_BUILD'].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
          <Field label="Name of work" className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Client / employer"><Input value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} /></Field>
          <Field label="LOA reference"><Input value={f.loaRef} onChange={(e) => setF({ ...f, loaRef: e.target.value })} /></Field>
          <Field label="Agreement date"><Input type="date" value={f.agreementDate} onChange={(e) => setF({ ...f, agreementDate: e.target.value })} /></Field>
          <Field label="Tendered value (₹)" hint="Replaced by the approved BOQ total"><Input inputMode="decimal" value={f.contractValue} onChange={(e) => setF({ ...f, contractValue: e.target.value })} /></Field>
          <Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Completion date"><Input type="date" value={f.completionDate} onChange={(e) => setF({ ...f, completionDate: e.target.value })} /></Field>
        </div>
      </Dialog>
    </>
  );
}
