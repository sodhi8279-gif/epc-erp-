import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { UNIT_CODES } from '@epc/shared';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi, useProject } from '../../lib/hooks';
import { dateTime, humanize, inr, num, unitLabel } from '../../lib/format';
import { Button, Dialog, Field, Input, Notice, PageHeader, Select, Sheet, Status, Table, Tabs, Tag, Textarea } from '../../components/ui';

const blank = { itemNo: '', description: '', unit: 'CUM', quantity: '', rate: '', isHeader: false, kind: '', substitutesKey: '', specRef: '', drawingRef: '' };

export function RevisionView() {
  const { projectId } = useProject();
  const { contractId, revisionId } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const { data: rev } = useApi<any>(`/revisions/${revisionId}`);
  const { data: cmp } = useApi<any[]>(rev?.basedOnId ? `/revisions/${revisionId}/compare` : null);
  const { data: val } = useApi<any>(rev && ['DRAFT', 'SUBMITTED'].includes(rev.status) ? `/revisions/${revisionId}/validate` : null);
  const { data: history } = useApi<any[]>(`/workflow/BoqRevision/${revisionId}`);
  const [tab, setTab] = useState<'items' | 'compare' | 'history'>('items');
  const [edit, setEdit] = useState<any | null>(null);
  const [comment, setComment] = useState('');
  const [actionErr, setActionErr] = useState<unknown>(null);
  const [ackWarnings, setAck] = useState(false);
  const save = useAction((it: any) => {
    const body = { ...it, kind: it.kind || undefined, substitutesKey: it.substitutesKey || undefined, quantity: it.isHeader ? '0' : it.quantity, rate: it.isHeader ? '0' : it.rate, id: undefined, itemKey: undefined };
    return it.id ? api.patch(`/boq-items/${it.id}`, { itemNo: body.itemNo, description: body.description, unit: body.unit, quantity: body.quantity, rate: body.rate, isHeader: body.isHeader, specRef: body.specRef || null, drawingRef: body.drawingRef || null }) : api.post(`/revisions/${revisionId}/items`, body);
  }, { onSuccess: () => setEdit(null) });
  const del = useAction((id: string) => api.del(`/boq-items/${id}`));
  const act = useAction((a: string) => api.post(`/revisions/${revisionId}/${a}`, { comment: comment || undefined, acknowledgeWarnings: ackWarnings }), { onSuccess: () => { setComment(''); setActionErr(null); } });
  const discard = useAction(() => api.del(`/revisions/${revisionId}`), { onSuccess: () => nav(`/p/${projectId}/contracts/${contractId}`) });
  if (!rev) return null;
  const draft = rev.status === 'DRAFT';
  const run = (a: string) => act.mutate(a, { onError: (e) => setActionErr(e) });
  const warn = actionErr instanceof ApiError && actionErr.status === 409 && Array.isArray(actionErr.details);
  return (
    <>
      <PageHeader back={<Link to={`/p/${projectId}/contracts/${contractId}`} className="hover:underline">{rev.contract.contractNo}</Link>} title={`R${rev.revisionNo} · ${rev.title}`}
        description={`${humanize(rev.type)} BOQ · ${rev.items.filter((i: any) => !i.isHeader).length} items · total ${inr(rev.total)}${rev.authorityRef ? ` · authority: ${rev.authorityRef}` : ''}`}
        actions={<>
          <Status value={rev.status} />
          {draft && can('boq.edit', { projectId }) && <Button variant="danger" onClick={() => confirm('Discard this draft revision?') && discard.mutate(undefined)}>Discard draft</Button>}
          {draft && can('boq.edit', { projectId }) && <Button variant="primary" busy={act.isPending} onClick={() => run('submit')}>Submit for approval</Button>}
          {rev.status === 'SUBMITTED' && can('boq.approve', { projectId }) && <><Button busy={act.isPending} onClick={() => run('reject')}>Return to draft</Button><Button variant="primary" busy={act.isPending} onClick={() => run('approve')}>Approve revision</Button></>}
        </>} />
      <div className="mb-4 space-y-2">
        {rev.status === 'APPROVED' && <Notice tone="success" title="Approved and locked">This revision cannot be edited. Changes need a new revision.</Notice>}
        {rev.status === 'SUPERSEDED' && <Notice tone="info" title="Superseded">Kept for history and for measurements dated while it was in force.</Notice>}
        {val?.errors?.length > 0 && <Notice tone="error" title="Fix before submitting"><ul className="list-disc pl-4">{val.errors.map((e: string) => <li key={e}>{e}</li>)}</ul></Notice>}
        {val?.warnings?.length > 0 && <Notice tone="warning" title="Check before approving"><ul className="list-disc pl-4">{val.warnings.map((e: string) => <li key={e}>{e}</li>)}</ul></Notice>}
        {actionErr && !warn ? <Notice error={actionErr} onClose={() => setActionErr(null)} /> : null}
        {warn && <Notice tone="warning" title={(actionErr as ApiError).message}><ul className="list-disc pl-4">{((actionErr as ApiError).details as string[]).map((w) => <li key={w}>{w}</li>)}</ul><label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={ackWarnings} onChange={(e) => setAck(e.target.checked)} /> I have reviewed these warnings</label></Notice>}
        {rev.status === 'SUBMITTED' && can('boq.approve', { projectId }) && <Field label="Comment (required to return)"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'items', label: 'Items' }, ...(rev.basedOnId ? [{ value: 'compare' as const, label: 'Changes from previous revision' }] : []), { value: 'history', label: 'Approval history' }]} />
      {tab === 'items' && (
        <Sheet flush actions={draft && can('boq.edit', { projectId }) && <Button size="sm" onClick={() => setEdit({ ...blank })}><Plus className="size-3.5" /> Add item</Button>} title="Bill of quantities">
          <Table rows={rev.items} rowKey={(r: any) => r.id} rowClassName={(r: any) => (r.isHeader ? 'bg-paper' : undefined)} cols={[
            { key: 'no', header: 'Item', cell: (r: any) => <span className="font-medium">{r.itemNo}</span>, width: '80px' },
            { key: 'd', header: 'Description', cell: (r: any) => <div className={r.isHeader ? 'font-semibold' : 'max-w-[70ch]'}>{r.description}{r.kind !== 'ORIGINAL' && !r.isHeader && <> <Tag tone="amber">{humanize(r.kind)}</Tag></>}</div> },
            { key: 'u', header: 'Unit', cell: (r: any) => (r.isHeader ? '' : unitLabel(r.unit)) },
            { key: 'q', header: 'Quantity', align: 'right', cell: (r: any) => (r.isHeader ? '' : num(r.quantity)) },
            { key: 'r', header: 'Rate', align: 'right', cell: (r: any) => (r.isHeader ? '' : inr(r.rate)) },
            { key: 'a', header: 'Amount', align: 'right', cell: (r: any) => (r.isHeader ? '' : inr(r.amount)) },
            ...(draft ? [{ key: 'x', header: '', cell: (r: any) => <div className="flex gap-1"><Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEdit({ ...blank, ...r, quantity: r.quantity, rate: r.rate, specRef: r.specRef ?? '', drawingRef: r.drawingRef ?? '' })}><Pencil className="size-3.5" /></Button><Button size="sm" variant="ghost" aria-label="Delete" onClick={() => confirm(`Delete item ${r.itemNo}?`) && del.mutate(r.id)}><Trash2 className="size-3.5" /></Button></div> }] : []),
          ]} footer={<tr><td colSpan={5} className="px-3 py-2">Total</td><td className="num px-3">{inr(rev.total)}</td>{draft && <td />}</tr>} />
        </Sheet>
      )}
      {tab === 'compare' && (
        <Sheet flush title="Item-by-item changes">
          <Table rows={cmp?.filter((r: any) => r.change !== 'UNCHANGED')} rowKey={(r: any) => r.itemKey} empty="No changes from the previous revision." cols={[
            { key: 'c', header: 'Change', cell: (r: any) => <Tag tone={r.change === 'ADDED' ? 'green' : r.change === 'REMOVED' ? 'red' : 'amber'}>{humanize(r.change)}</Tag> },
            { key: 'no', header: 'Item', cell: (r: any) => r.itemNo },
            { key: 'd', header: 'Description', cell: (r: any) => <span className="line-clamp-2 max-w-[50ch]">{r.description}</span> },
            { key: 'bq', header: 'Previous qty', align: 'right', cell: (r: any) => num(r.baseQuantity) },
            { key: 'q', header: 'New qty', align: 'right', cell: (r: any) => num(r.quantity) },
            { key: 'dq', header: 'Δ qty', align: 'right', cell: (r: any) => num(r.quantityDelta) },
            { key: 'br', header: 'Previous rate', align: 'right', cell: (r: any) => inr(r.baseRate) },
            { key: 'r', header: 'New rate', align: 'right', cell: (r: any) => inr(r.rate) },
            { key: 'da', header: 'Δ amount', align: 'right', cell: (r: any) => inr(r.amountDelta) },
          ]} />
        </Sheet>
      )}
      {tab === 'history' && (
        <Sheet flush title="Approval history">
          <Table rows={history} rowKey={(r: any) => r.id} cols={[
            { key: 'at', header: 'When', cell: (r: any) => dateTime(r.at) },
            { key: 'u', header: 'By', cell: (r: any) => r.userName },
            { key: 'a', header: 'Action', cell: (r: any) => humanize(r.action) },
            { key: 's', header: 'Status', cell: (r: any) => <span>{r.fromStatus ? `${humanize(r.fromStatus)} → ` : ''}{humanize(r.toStatus)}</span> },
            { key: 'c', header: 'Comment', cell: (r: any) => r.comment ?? '' },
          ]} />
        </Sheet>
      )}
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit item ${edit.itemNo}` : 'Add BOQ item'} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate(edit)}>Save item</Button></>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-3">
            {save.error ? <div className="sm:col-span-3"><Notice error={save.error} /></div> : null}
            <Field label="Item no."><Input value={edit.itemNo} onChange={(e) => setEdit({ ...edit, itemNo: e.target.value })} /></Field>
            <label className="flex items-end gap-2 pb-2 sm:col-span-2"><input type="checkbox" checked={edit.isHeader} onChange={(e) => setEdit({ ...edit, isHeader: e.target.checked })} /> Heading row (no quantity)</label>
            <Field label="Description" className="sm:col-span-3"><Textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            {!edit.isHeader && <>
              <Field label="Unit"><Select value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })}>{UNIT_CODES.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}</Select></Field>
              <Field label="Quantity"><Input inputMode="decimal" value={edit.quantity} onChange={(e) => setEdit({ ...edit, quantity: e.target.value })} /></Field>
              <Field label="Rate (₹)"><Input inputMode="decimal" value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: e.target.value })} /></Field>
              {!edit.id && rev.type !== 'ORIGINAL' && <Field label="Item type" className="sm:col-span-3"><Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}><option value="">Extra item</option><option value="SUBSTITUTED">Substituted item</option></Select></Field>}
              {edit.kind === 'SUBSTITUTED' && <Field label="Substitutes item" className="sm:col-span-3"><Select value={edit.substitutesKey} onChange={(e) => setEdit({ ...edit, substitutesKey: e.target.value })}><option value="">Select…</option>{rev.items.filter((i: any) => !i.isHeader).map((i: any) => <option key={i.itemKey} value={i.itemKey}>{i.itemNo} — {i.description.slice(0, 60)}</option>)}</Select></Field>}
              <Field label="Specification ref."><Input value={edit.specRef} onChange={(e) => setEdit({ ...edit, specRef: e.target.value })} /></Field>
              <Field label="Drawing ref."><Input value={edit.drawingRef} onChange={(e) => setEdit({ ...edit, drawingRef: e.target.value })} /></Field>
            </>}
          </div>
        )}
      </Dialog>
    </>
  );
}
