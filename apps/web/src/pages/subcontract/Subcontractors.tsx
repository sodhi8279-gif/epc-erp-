import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCompany } from '../../lib/company';
import { useAction, useApi } from '../../lib/hooks';
import { humanize } from '../../lib/format';
import { Button, Dialog, Input, Notice, PageHeader, Select, Sheet, Status, Table, Tag } from '../../components/ui';
import { fieldErrors } from '../../components/subcontract/common';
import { blankSc, scToBody, SubcontractorFields, type ScForm } from '../../components/subcontract/SubcontractorForm';

const STATUSES = ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'BLACKLISTED', 'INACTIVE'];

export function Subcontractors() {
  const { companyId, company } = useCompany();
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const qs = new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(status ? { status } : {}) }).toString();
  const { data, error } = useApi<any[]>(companyId ? `/companies/${companyId}/subcontractors${qs ? `?${qs}` : ''}` : null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<ScForm>(blankSc);
  const create = useAction((b: ScForm) => api.post(`/companies/${companyId}/subcontractors`, scToBody(b)), { onSuccess: (s: any) => { setOpen(false); setF(blankSc); nav(`/subcontractors/${s.id}`); } });
  const errs = fieldErrors(create.error);
  return (
    <>
      <PageHeader title="Subcontractors" description={`Subcontractor master of ${company?.name ?? 'the company'}. New subcontractors start in onboarding and need approval before a work order can be approved.`}
        actions={companyId && can('subcontractor.manage', { companyId }) && <Button variant="primary" onClick={() => { create.reset(); setOpen(true); }}><Plus className="size-4" /> New subcontractor</Button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-soft" aria-hidden />
          <Input aria-label="Search" placeholder="Search name or code" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-48">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </Select>
      </div>
      {error ? <div className="mb-3"><Notice error={error} /></div> : null}
      <Sheet flush>
        <Table rows={companyId ? data : []} rowKey={(r: any) => r.id} onRowClick={(r: any) => nav(`/subcontractors/${r.id}`)} empty={q || status ? 'No subcontractors match.' : 'No subcontractors yet.'} cols={[
          { key: 'code', header: 'Code', cell: (r: any) => <span className="whitespace-nowrap font-medium">{r.code}</span>, width: '120px' },
          { key: 'name', header: 'Name', cell: (r: any) => <div><div>{r.name}</div>{r.firmName && <div className="text-xs text-ink-soft">{r.firmName}</div>}</div> },
          { key: 'cat', header: 'Work categories', cell: (r: any) => <div className="flex flex-wrap gap-1">{r.workCategories.map((c: string) => <Tag key={c}>{c}</Tag>)}</div> },
          { key: 'tax', header: 'PAN / GSTIN', cell: (r: any) => <div className="tabular-nums"><div>{r.pan ?? '—'}</div><div className="text-xs text-ink-soft">{r.gstRegistered ? r.gstin ?? 'GSTIN missing' : 'Not GST registered'}</div></div> },
          { key: 'contact', header: 'Contact', cell: (r: any) => <div><div>{r.contactPerson ?? '—'}</div><div className="text-xs text-ink-soft">{r.phone ?? ''}</div></div> },
          { key: 'wo', header: 'Work orders', align: 'right', cell: (r: any) => r._count?.workOrders ?? 0 },
          { key: 'st', header: 'Status', cell: (r: any) => <Status value={r.status} /> },
        ]} />
      </Sheet>
      <Dialog wide open={open} onClose={() => setOpen(false)} title="New subcontractor" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={create.isPending} onClick={() => create.mutate(f)}>Create subcontractor</Button></>}>
        {create.error ? <div className="mb-3"><Notice error={create.error} /></div> : null}
        <SubcontractorFields f={f} set={setF} errors={errs} />
      </Dialog>
    </>
  );
}
