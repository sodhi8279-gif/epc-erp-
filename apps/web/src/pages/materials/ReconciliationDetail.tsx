import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { date, dateTime, humanize, inr } from '../../lib/format';
import { Button, Dialog, Facts, Field, Notice, PageHeader, Sheet, Status, Textarea } from '../../components/ui';
import { PrintArea, PrintButton, SignatureBlock, useMaterialData } from '../../components/materials/common';
import { ReconStatement, type ReconLine } from '../../components/materials/ReconStatement';

export function ReconciliationDetail() {
  const { projectId, companyId, project } = useProject();
  const { id } = useParams();
  const { can, me } = useAuth();
  const md = useMaterialData(projectId, companyId);
  const { data: r } = useApi<any>(`/reconciliations/${id}`);
  const [action, setAction] = useState<'submit' | 'approve' | 'reject' | null>(null);
  const [comment, setComment] = useState('');
  const act = useAction((a: string) => api.post(`/reconciliations/${id}/${a}`, { comment: comment || undefined }), { onSuccess: () => setAction(null) });
  if (!r) return null;
  const wo = r.workOrderId ? md.wos?.find((w) => w.id === r.workOrderId) : null;
  const canPrepare = can('reconciliation.prepare', { projectId });
  const canApprove = can('reconciliation.approve', { projectId });
  const isPreparer = me?.user.id === r.createdById && !me?.user.isSuperAdmin;
  const open = (a: typeof action) => { act.reset(); setComment(''); setAction(a); };
  const labels = { submit: 'Submit for approval', approve: 'Approve statement', reject: 'Reject statement' };

  return (
    <PrintArea>
      <div className="no-print">
        <PageHeader back={<Link to={`/p/${projectId}/materials/reconciliation`} className="hover:underline">Material reconciliation</Link>}
          title={<>{r.reconNo} <Status value={r.status} /></>}
          description={`${r.subcontractor?.name ?? ''} · ${wo ? wo.woNo : r.workOrderId ? '…' : 'all work orders'} · ${date(r.periodFrom)} to ${date(r.periodTo)}${r.isFinal ? ' · final reconciliation' : ''}`}
          actions={<>
            <PrintButton label="Print statement" />
            {r.status === 'DRAFT' && canPrepare && <Button variant="primary" onClick={() => open('submit')}>Submit for approval</Button>}
            {r.status === 'SUBMITTED' && canApprove && <Button variant="danger" onClick={() => open('reject')}>Reject</Button>}
            {r.status === 'SUBMITTED' && canApprove && <Button variant="primary" disabled={isPreparer} title={isPreparer ? 'The preparer cannot approve' : undefined} onClick={() => open('approve')}>Approve statement</Button>}
          </>} />
      </div>
      {act.error && !action ? <div className="no-print mb-3"><Notice error={act.error} /></div> : null}

      <div className="mb-4 hidden border-b border-ink pb-2 print:block">
        <div className="text-xs">{project?.company?.name} · {project?.name}</div>
        <h1 className="text-[19px] font-bold">Material reconciliation statement {r.reconNo}</h1>
      </div>

      <Sheet className="mb-4">
        <Facts items={[
          ['Subcontractor', `${r.subcontractor?.name ?? ''}${r.subcontractor?.code ? ` (${r.subcontractor.code})` : ''}`],
          ['Work order', wo ? `${wo.woNo} · ${wo.title}` : r.workOrderId ? '…' : 'All work orders'],
          ['Period', `${date(r.periodFrom)} to ${date(r.periodTo)}`],
          ['Type', r.isFinal ? 'Final reconciliation' : 'Running reconciliation'],
          ['Status', humanize(r.status)],
          ['Prepared', dateTime(r.createdAt)],
          ['Approved', r.approvedAt ? dateTime(r.approvedAt) : '—'],
          ['Total recoverable now', <span className="text-[16px]">{inr(r.totalRecoverable)}</span>],
        ]} />
      </Sheet>
      {r.status === 'APPROVED' && !r.isFinal && <div className="no-print mb-4"><Notice tone="success" title="Approved">The closing balances (J) become the opening balances (A) of this subcontractor's next reconciliation.</Notice></div>}

      <ReconStatement lines={r.lines as ReconLine[]} isFinal={r.isFinal} />

      <Sheet title="History" className="mt-4" flush>
        <ul className="divide-y divide-rule-soft text-[13px]">
          {(r.history as any[]).map((h) => (
            <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
              <span><span className="font-medium">{humanize(h.action)}</span>{h.toStatus && <> · <Status value={h.toStatus} /></>}{h.comment && <span className="text-ink-soft"> · {h.comment}</span>}</span>
              <span className="text-ink-soft">{h.userName} {dateTime(h.at)}</span>
            </li>
          ))}
        </ul>
      </Sheet>

      <div className="mt-6 hidden grid-cols-3 gap-8 print:grid">
        <SignatureBlock label="Prepared by (billing / QS)" />
        <SignatureBlock label="Checked by (project manager)" />
        <SignatureBlock label="Accepted by (subcontractor)" name={r.subcontractor?.name} />
      </div>

      <Dialog open={!!action} onClose={() => setAction(null)} title={action ? `${labels[action]} · ${r.reconNo}` : ''}
        footer={<><Button onClick={() => setAction(null)}>Cancel</Button><Button variant={action === 'reject' ? 'danger' : 'primary'} busy={act.isPending} onClick={() => action && act.mutate(action)}>{action ? labels[action] : ''}</Button></>}>
        <div className="grid gap-3">
          {act.error ? <Notice error={act.error} /> : null}
          {action === 'approve' && <p className="text-[13px] text-ink-soft">Approving fixes the recoverable amount of {inr(r.totalRecoverable)} for deduction from the subcontractor's bill, and the closing balances carry forward.</p>}
          <Field label={action === 'reject' ? 'Reason for rejection' : 'Comment (optional)'}><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        </div>
      </Dialog>
    </PrintArea>
  );
}
