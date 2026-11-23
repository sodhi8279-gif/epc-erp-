import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, FilePlus2, Pencil, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi } from '../../lib/hooks';
import { date, humanize, inr, isoDate, num } from '../../lib/format';
import { Button, Dialog, Facts, Field, Input, Notice, PageHeader, Select, Sheet, Status, Table, Tag, Textarea } from '../../components/ui';
import { fieldErrors, WorkflowHistory } from '../../components/subcontract/common';
import { scFromRecord, scToBody, SENSITIVE, SubcontractorFields, type ScForm } from '../../components/subcontract/SubcontractorForm';

const STATUS_ACTIONS: { to: string; label: string; from: string[]; danger?: boolean }[] = [
  { to: 'ACTIVE', label: 'Activate', from: ['ONBOARDING', 'SUSPENDED', 'INACTIVE'] },
  { to: 'SUSPENDED', label: 'Suspend', from: ['ACTIVE'] },
  { to: 'INACTIVE', label: 'Deactivate', from: ['ONBOARDING', 'ACTIVE', 'SUSPENDED'] },
  { to: 'BLACKLISTED', label: 'Blacklist', from: ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE'], danger: true },
];
const DOC_TYPES = ['Agreement', 'Workmen compensation / CAR insurance', 'Labour licence', 'EPF registration', 'ESI registration', 'Performance security / bank guarantee', 'GST registration certificate', 'PAN card', 'Cancelled cheque', 'Safety plan', 'Other'];

export function SubcontractorDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const { data: s, error } = useApi<any>(`/subcontractors/${id}`);
  const { data: docs } = useApi<any[]>(s ? `/documents?companyId=${s.companyId}&entityType=Subcontractor&entityId=${s.id}` : null);
  const [edit, setEdit] = useState<ScForm | null>(null);
  const [reason, setReason] = useState('');
  const [statusTo, setStatusTo] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [comp, setComp] = useState<{ docType: string; docNo: string; validFrom: string; validTo: string; remarks: string; file: File | null } | null>(null);
  const [dlErr, setDlErr] = useState<unknown>(null);

  const save = useAction((b: { data: ScForm; reason: string }) => { const { code: _c, ...data } = scToBody(b.data) as any; return api.patch(`/subcontractors/${id}`, { data, reason: b.reason || undefined }); }, { onSuccess: () => { setEdit(null); setReason(''); } });
  const setStatus = useAction((b: { status: string; comment: string }) => api.post(`/subcontractors/${id}/status`, { status: b.status, comment: b.comment || undefined }), { onSuccess: () => { setStatusTo(null); setComment(''); } });
  const addComp = useAction(async (c: NonNullable<typeof comp>) => {
    let documentId: string | undefined;
    if (c.file) {
      const fd = new FormData();
      fd.append('companyId', s.companyId); fd.append('entityType', 'Subcontractor'); fd.append('entityId', s.id); fd.append('category', 'COMPLIANCE');
      fd.append('file', c.file);
      documentId = (await api.upload<any>('/documents', fd)).id;
    }
    return api.post(`/subcontractors/${id}/compliance`, { docType: c.docType, docNo: c.docNo || undefined, validFrom: c.validFrom || undefined, validTo: c.validTo || undefined, remarks: c.remarks || undefined, documentId });
  }, { onSuccess: () => setComp(null) });
  const verify = useAction((cid: string) => api.post(`/compliance/${cid}/verify`));

  if (error) return <Notice error={error} />;
  if (!s) return null;
  const companyId = s.companyId;
  const canManage = can('subcontractor.manage', { companyId });
  const canApprove = can('subcontractor.approve', { companyId });
  const today = isoDate();
  const expired = (c: any) => c.validTo && c.validTo.slice(0, 10) < today;
  const expiring = (c: any) => c.validTo && !expired(c) && (new Date(c.validTo).getTime() - Date.now()) / 86400000 <= 30;
  const before = scFromRecord(s);
  const sensitiveChanged = edit ? SENSITIVE.filter((k) => (edit[k] || '').trim().toUpperCase() !== (before[k] || '').trim().toUpperCase()) : [];
  const needsReason = sensitiveChanged.length > 0 && s.status !== 'ONBOARDING';
  const docName = (docId: string) => docs?.find((d) => d.id === docId)?.originalName ?? 'document';
  const download = (docId: string) => api.download(`/documents/${docId}/download`, docName(docId)).catch(setDlErr);
  const action = STATUS_ACTIONS.find((a) => a.to === statusTo);
  const expiredDocs = s.compliance.filter(expired);

  return (
    <>
      <PageHeader back={<Link to="/subcontractors" className="hover:underline">Subcontractors</Link>} title={`${s.code} · ${s.name}`} description={[s.firmName, s.constitution, s.state].filter(Boolean).join(' · ') || undefined}
        actions={<>
          <Status value={s.status} />
          {canManage && <Button onClick={() => { save.reset(); setReason(''); setEdit(scFromRecord(s)); }}><Pencil className="size-4" /> Edit details</Button>}
          {canApprove && STATUS_ACTIONS.filter((a) => a.from.includes(s.status)).map((a) => (
            <Button key={a.to} variant={a.to === 'ACTIVE' ? 'primary' : a.danger ? 'danger' : 'secondary'} onClick={() => { setStatus.reset(); setComment(''); setStatusTo(a.to); }}>{a.label}</Button>
          ))}
        </>} />
      <div className="mb-4 space-y-2">
        {s.status === 'ONBOARDING' && <Notice tone="info" title="Onboarding">PAN, bank account and IFSC are needed, and no compliance document may be expired, before the subcontractor can be activated.</Notice>}
        {s.status === 'BLACKLISTED' && <Notice tone="error" title="Blacklisted">No new work orders can be issued to this subcontractor.</Notice>}
        {s.status === 'SUSPENDED' && <Notice tone="warning" title="Suspended">No new work orders can be issued while suspended.</Notice>}
        {expiredDocs.length > 0 && <Notice tone="warning" title="Expired compliance documents">{expiredDocs.map((c: any) => c.docType).join(', ')}. Renew them before activation or billing.</Notice>}
        {dlErr ? <Notice error={dlErr} onClose={() => setDlErr(null)} /> : null}
        {verify.error ? <Notice error={verify.error} onClose={() => verify.reset()} /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Sheet title="Contact and tax">
          <Facts cols={3} items={[
            ['Contact person', s.contactPerson], ['Phone', s.phone], ['Email', s.email],
            ['PAN', s.pan], ['GST', s.gstRegistered ? s.gstin ?? 'GSTIN missing' : 'Not registered'], ['GST rate', s.gstRegistered ? `${num(s.gstRate, 2)}%` : '—'],
            ['TDS', s.tdsSection ? `${s.tdsSection} @ ${num(s.tdsRate)}%` : 'None'], ['Address', s.address], ['State', s.state],
          ]} />
          {s.workCategories.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{s.workCategories.map((c: string) => <Tag key={c}>{c}</Tag>)}</div>}
        </Sheet>
        <Sheet title="Bank and commercial terms">
          <Facts cols={3} items={[
            ['Bank', s.bankName], ['Account no.', s.bankAccount], ['IFSC', s.ifsc],
            ['Retention', `${num(s.retentionPercent)}%`], ['Payment terms', `${s.paymentTermsDays} days`], ['Approved', s.approvedAt ? date(s.approvedAt) : 'Not yet'],
          ]} />
        </Sheet>
      </div>

      <Sheet className="mt-4" title="Compliance documents" flush actions={canManage && <Button size="sm" onClick={() => { addComp.reset(); setComp({ docType: DOC_TYPES[0], docNo: '', validFrom: '', validTo: '', remarks: '', file: null }); }}><FilePlus2 className="size-3.5" /> Add document</Button>}>
        <Table rows={s.compliance} rowKey={(r: any) => r.id} empty="No compliance documents yet." rowClassName={(r: any) => (expired(r) ? 'bg-red-wash/60' : expiring(r) ? 'bg-amber-wash/60' : undefined)} cols={[
          { key: 't', header: 'Document', cell: (r: any) => <div><div className="font-medium">{r.docType}</div>{r.remarks && <div className="text-xs text-ink-soft">{r.remarks}</div>}</div> },
          { key: 'n', header: 'Number', cell: (r: any) => r.docNo ?? '—' },
          { key: 'f', header: 'Valid from', cell: (r: any) => date(r.validFrom) },
          { key: 'to', header: 'Valid to', cell: (r: any) => <span className={expired(r) ? 'font-semibold text-red' : expiring(r) ? 'font-semibold text-amber' : ''}>{date(r.validTo)}{expired(r) ? ' · expired' : expiring(r) ? ' · expiring' : ''}</span> },
          { key: 'v', header: 'Verification', cell: (r: any) => (r.verified ? <Status value="APPROVED" label={`Verified ${date(r.verifiedAt)}`} /> : <Status value="DRAFT" label="Not verified" />) },
          { key: 'a', header: '', align: 'right', cell: (r: any) => (
            <div className="flex justify-end gap-1.5">
              {r.documentId ? <Button size="sm" variant="ghost" onClick={() => download(r.documentId)}><Download className="size-3.5" /> Download</Button> : <span className="text-xs text-ink-soft">No file</span>}
              {canApprove && !r.verified && r.documentId && <Button size="sm" busy={verify.isPending && verify.variables === r.id} onClick={() => verify.mutate(r.id)}><ShieldCheck className="size-3.5" /> Verify</Button>}
            </div>
          ) },
        ]} />
      </Sheet>

      <Sheet className="mt-4" title="Work orders across projects" flush>
        <Table rows={s.workOrders} rowKey={(r: any) => r.id} empty="No work orders yet." onRowClick={(r: any) => nav(`/p/${r.projectId}/work-orders/${r.id}`)} cols={[
          { key: 'no', header: 'WO no.', cell: (r: any) => <span className="font-medium">{r.woNo}</span> },
          { key: 'p', header: 'Project', cell: (r: any) => `${r.project.code} · ${r.project.name}` },
          { key: 't', header: 'Title', cell: (r: any) => r.title },
          { key: 'd', header: 'Period', cell: (r: any) => `${date(r.startDate)} – ${date(r.completionDate)}` },
          { key: 'v', header: 'Value', align: 'right', cell: (r: any) => inr(r.value, 0) },
          { key: 's', header: 'Status', cell: (r: any) => <Status value={r.status} /> },
        ]} />
      </Sheet>
      <div className="mt-4"><WorkflowHistory entityType="Subcontractor" id={s.id} /></div>

      <Dialog wide open={!!edit} onClose={() => setEdit(null)} title={`Edit ${s.code}`} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" busy={save.isPending} disabled={needsReason && !reason.trim()} onClick={() => edit && save.mutate({ data: edit, reason })}>Save changes</Button></>}>
        {save.error ? <div className="mb-3"><Notice error={save.error} /></div> : null}
        {edit && <SubcontractorFields f={edit} set={setEdit} errors={fieldErrors(save.error)} editing />}
        {needsReason && (
          <div className="mt-4 space-y-2">
            <Notice tone="warning" title={`Changing ${sensitiveChanged.map(humanize).join(', ')} of an approved subcontractor`}>Bank and tax identity changes need approval authority and are audited with your reason.</Notice>
            <Field label="Reason for change"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bank account changed as per subcontractor letter dated …, verified by cancelled cheque" /></Field>
          </div>
        )}
      </Dialog>

      <Dialog open={!!statusTo} onClose={() => setStatusTo(null)} title={`${action?.label} ${s.name}`} footer={<><Button onClick={() => setStatusTo(null)}>Cancel</Button><Button variant={action?.danger ? 'danger' : 'primary'} busy={setStatus.isPending} disabled={statusTo !== 'ACTIVE' && !comment.trim()} onClick={() => statusTo && setStatus.mutate({ status: statusTo, comment })}>{action?.label} subcontractor</Button></>}>
        <div className="space-y-3">
          {setStatus.error ? <Notice error={setStatus.error} /> : null}
          {statusTo === 'ACTIVE' && <p className="text-[13px] text-ink-soft">Activation approves the subcontractor for work orders. PAN, bank details and unexpired compliance documents are checked.</p>}
          <Field label={statusTo === 'ACTIVE' ? 'Comment (optional)' : 'Reason'}><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        </div>
      </Dialog>

      <Dialog open={!!comp} onClose={() => setComp(null)} title="Add compliance document" footer={<><Button onClick={() => setComp(null)}>Cancel</Button><Button variant="primary" busy={addComp.isPending} onClick={() => comp && addComp.mutate(comp)}>Add document</Button></>}>
        {comp && (
          <div className="grid gap-3 sm:grid-cols-2">
            {addComp.error ? <div className="sm:col-span-2"><Notice error={addComp.error} /></div> : null}
            <Field label="Document type" className="sm:col-span-2"><Select value={comp.docType} onChange={(e) => setComp({ ...comp, docType: e.target.value })}>{DOC_TYPES.map((d) => <option key={d}>{d}</option>)}</Select></Field>
            <Field label="Document / policy number"><Input value={comp.docNo} onChange={(e) => setComp({ ...comp, docNo: e.target.value })} /></Field>
            <span className="hidden sm:block" />
            <Field label="Valid from"><Input type="date" value={comp.validFrom} onChange={(e) => setComp({ ...comp, validFrom: e.target.value })} /></Field>
            <Field label="Valid to"><Input type="date" value={comp.validTo} onChange={(e) => setComp({ ...comp, validTo: e.target.value })} /></Field>
            <Field label="Scanned copy" hint="PDF or image. Needed before the document can be verified." className="sm:col-span-2"><input type="file" accept=".pdf,image/*" onChange={(e) => setComp({ ...comp, file: e.target.files?.[0] ?? null })} className="text-[13px]" /></Field>
            <Field label="Remarks" className="sm:col-span-2"><Input value={comp.remarks} onChange={(e) => setComp({ ...comp, remarks: e.target.value })} /></Field>
          </div>
        )}
      </Dialog>
    </>
  );
}
