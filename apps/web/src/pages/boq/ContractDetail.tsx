import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Upload, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { date, humanize, inr, num, unitLabel } from '../../lib/format';
import { Button, Dialog, Facts, Field, Input, Notice, PageHeader, Select, Sheet, Status, Table, Tag } from '../../components/ui';

export function ContractDetail() {
  const { projectId } = useProject();
  const { contractId } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const { data: c } = useApi<any>(`/contracts/${contractId}`);
  const { data: status } = useApi<any>(`/contracts/${contractId}/boq-status`);
  const [open, setOpen] = useState(false);
  const approved = c?.revisions.find((r: any) => r.status === 'APPROVED');
  const pending = c?.revisions.find((r: any) => ['DRAFT', 'SUBMITTED'].includes(r.status));
  const [f, setF] = useState({ type: 'REVISED', title: '', authorityRef: '' });
  const create = useAction((b: typeof f) => api.post(`/contracts/${contractId}/revisions`, { ...b, type: approved ? b.type : 'ORIGINAL', title: b.title || (approved ? 'Revised BOQ' : 'Original BOQ'), authorityRef: b.authorityRef || undefined }), { onSuccess: (r: any) => nav(`revisions/${r.id}`) });
  if (!c) return null;
  const canEdit = can('boq.edit', { projectId });
  return (
    <>
      <PageHeader back={<Link to={`/p/${projectId}/contracts`} className="hover:underline">Contracts</Link>} title={`${c.contractNo} · ${c.title}`} description={`${c.client} · ${humanize(c.type)}`}
        actions={canEdit && !pending && <>
          <Button onClick={() => nav('import')}><Upload className="size-4" /> Import BOQ from Excel</Button>
          <Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" /> {approved ? 'New revision' : 'Enter BOQ manually'}</Button>
        </>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Sheet title="Contract">
          <Facts items={[['Contract value', inr(c.contractValue)], ['Agreement date', date(c.agreementDate)], ['LOA', c.loaRef], ['Start', date(c.startDate)], ['Completion', date(c.completionDate)], ['Current BOQ', approved ? `R${approved.revisionNo} · ${approved.title}` : 'Not approved yet']]} cols={3} />
        </Sheet>
        <Sheet title="BOQ revisions" flush>
          <ul className="divide-y divide-rule-soft">
            {c.revisions.length === 0 && <li className="px-4 py-3 text-ink-soft">No BOQ yet.</li>}
            {c.revisions.map((r: any) => (
              <li key={r.id}><Link to={`revisions/${r.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-teal-wash/50"><span><span className="font-medium">R{r.revisionNo}</span> {r.title}<span className="block text-xs text-ink-soft">{humanize(r.type)}{r.effectiveDate ? ` · effective ${date(r.effectiveDate)}` : ''}</span></span><Status value={r.status} /></Link></li>
            ))}
          </ul>
        </Sheet>
      </div>
      {pending && <div className="mt-4"><Notice tone="info" title={`Revision R${pending.revisionNo} is ${humanize(pending.status).toLowerCase()}`}><Link className="text-teal underline" to={`revisions/${pending.id}`}>Open it</Link> to review, submit or approve.</Notice></div>}
      <Sheet className="mt-4" title={status?.revision ? `Approved BOQ · R${status.revision.revisionNo}` : 'Approved BOQ'} flush>
        <Table rows={status?.items} rowKey={(r: any) => r.id} empty="The BOQ appears here once a revision is approved." rowClassName={(r: any) => (r.isHeader ? 'bg-paper' : undefined)}
          onRowClick={(r: any) => !r.isHeader && nav(`items/${r.itemKey}`)}
          cols={[
            { key: 'no', header: 'Item', cell: (r: any) => <span className="font-medium">{r.itemNo}</span>, width: '80px' },
            { key: 'd', header: 'Description', cell: (r: any) => <div className={r.isHeader ? 'font-semibold' : 'line-clamp-2 max-w-[60ch]'} title={r.description}>{r.description}{r.kind !== 'ORIGINAL' && !r.isHeader && <> <Tag tone="amber">{humanize(r.kind)}</Tag></>}</div> },
            { key: 'u', header: 'Unit', cell: (r: any) => (r.isHeader ? '' : unitLabel(r.unit)) },
            { key: 'oq', header: 'Original qty', align: 'right', cell: (r: any) => (r.isHeader ? '' : num(r.originalQuantity)) },
            { key: 'q', header: 'Current qty', align: 'right', cell: (r: any) => (r.isHeader ? '' : num(r.quantity)) },
            { key: 'r', header: 'Rate', align: 'right', cell: (r: any) => (r.isHeader ? '' : inr(r.rate)) },
            { key: 'a', header: 'Amount', align: 'right', cell: (r: any) => (r.isHeader ? '' : inr(r.amount)) },
            { key: 'b', header: 'Breakup', cell: (r: any) => (r.isHeader ? '' : r.activityCount === 0 ? <Tag>Not broken down</Tag> : r.breakupApproved ? <Status value="APPROVED" label={`${r.activityCount} activities`} /> : <Status value="DRAFT" label={`${r.activityCount} draft`} />) },
          ]} />
      </Sheet>
      <Dialog open={open} onClose={() => setOpen(false)} title={approved ? 'New BOQ revision' : 'Original BOQ'} footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={create.isPending} onClick={() => create.mutate(f)}>Create draft</Button></>}>
        <div className="grid gap-3">
          {create.error ? <Notice error={create.error} /> : null}
          {approved && <Field label="Revision type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="REVISED">Revised BOQ (quantity / rate revision)</option><option value="VARIATION">Variation order (extra / substituted items)</option></Select></Field>}
          <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={approved ? 'e.g. Revised BOQ as per RE approval' : 'Original BOQ'} /></Field>
          {approved && <Field label="Authority reference" hint="Client letter / approval under which the revision is made"><Input value={f.authorityRef} onChange={(e) => setF({ ...f, authorityRef: e.target.value })} /></Field>}
          <p className="text-[13px] text-ink-soft">{approved ? `The draft starts as a copy of R${approved.revisionNo}. R${approved.revisionNo} stays unchanged and in force until the new revision is approved.` : 'Add sections and items to the draft, then submit it for approval.'}</p>
        </div>
      </Dialog>
    </>
  );
}
