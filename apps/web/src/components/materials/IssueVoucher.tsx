import { D } from '@epc/shared';
import { date, dateTime, inr } from '../../lib/format';
import { Button, Status } from '../ui';
import { basisLabel, type Material, PrintArea, PrintButton, Qty, SignatureBlock } from './common';

/** Printable material issue voucher (MIV) with signature blocks for the issuing authority and the receiver. */
export function IssueVoucher({ issue, project, store, activity, requisition, matById, onBack }: { issue: any; project: any; store?: any; activity?: any; requisition?: any; matById: (id: string) => Material | undefined; onBack: () => void }) {
  const total = (issue.lines as any[]).reduce((s, l) => s.plus(l.issueValue), D(0));
  const recov = (issue.lines as any[]).reduce((s, l) => s.plus(D(l.quantity).times(l.recoveryRate)), D(0));
  return (
    <PrintArea>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button onClick={onBack}>Back to vouchers</Button>
        <PrintButton label="Print voucher" />
      </div>
      <section className="mx-auto max-w-[900px] rounded-[4px] border border-rule bg-sheet p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink pb-3">
          <div>
            <div className="text-xs text-ink-soft">{project?.company?.name ?? ''}</div>
            <div className="font-display text-[15px] font-semibold">{project?.name}</div>
            <div className="text-xs text-ink-soft">{project?.code}{project?.location ? ` · ${project.location}` : ''}</div>
          </div>
          <div className="text-right">
            <h1 className="text-[19px] font-bold">Material issue voucher</h1>
            <div className="text-[15px] font-semibold">{issue.voucherNo}</div>
            <div className="mt-1"><Status value={issue.status} /></div>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
          {([
            ['Date of issue', date(issue.date)],
            ['Store', store ? `${store.code} · ${store.name}` : '—'],
            ['Subcontractor', `${issue.subcontractor?.name ?? ''}${issue.subcontractor?.code ? ` (${issue.subcontractor.code})` : ''}`],
            ['Work order', issue.workOrder?.woNo],
            ['Activity', activity ? `${activity.code} · ${activity.name}` : '—'],
            ['Requisition', requisition?.reqNo ?? '—'],
          ] as [string, string][]).map(([k, v]) => <div key={k}><dt className="text-xs text-ink-soft">{k}</dt><dd className="font-medium">{v || '—'}</dd></div>)}
        </dl>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-y border-ink text-left">
                <th className="px-2 py-1.5 font-medium">#</th>
                <th className="px-2 py-1.5 font-medium">Material</th>
                <th className="px-2 py-1.5 text-right font-medium">Quantity</th>
                <th className="px-2 py-1.5 font-medium">Supply basis</th>
                <th className="px-2 py-1.5 text-right font-medium">Issue rate</th>
                <th className="px-2 py-1.5 text-right font-medium">Value</th>
                <th className="px-2 py-1.5 text-right font-medium">Recovery rate</th>
              </tr>
            </thead>
            <tbody>
              {(issue.lines as any[]).map((l, i) => {
                const m = matById(l.materialId);
                return (
                  <tr key={l.id} className="border-b border-rule align-top">
                    <td className="px-2 py-1.5">{i + 1}</td>
                    <td className="px-2 py-1.5"><div className="font-medium">{m?.code}</div><div className="text-xs">{m?.name}</div>{l.batchNo && <div className="text-xs text-ink-soft">Batch / heat {l.batchNo}</div>}{l.recoveryTerms && <div className="text-xs text-ink-soft">Terms: {l.recoveryTerms}</div>}</td>
                    <td className="px-2 py-1.5 text-right"><Qty m={m} q={l.quantity} /></td>
                    <td className="px-2 py-1.5">{basisLabel(l.basis)}</td>
                    <td className="num px-2 py-1.5">{inr(l.issueRate)}</td>
                    <td className="num px-2 py-1.5">{inr(l.issueValue)}</td>
                    <td className="num px-2 py-1.5">{D(l.recoveryRate).gt(0) ? inr(l.recoveryRate) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-b border-ink font-semibold">
                <td className="px-2 py-1.5" colSpan={5}>Total issue value</td>
                <td className="num px-2 py-1.5">{inr(total.toString())}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        {recov.gt(0) && <p className="mt-2 text-[13px]">Recoverable from the subcontractor at the recovery rate, if not consumed against approved work within permissible wastage or returned: <span className="font-semibold">{inr(recov.toString())}</span></p>}
        {issue.remarks && <p className="mt-2 text-[13px]"><span className="text-ink-soft">Remarks:</span> {issue.remarks}</p>}
        <p className="mt-3 text-xs text-ink-soft">Received the above material in good condition for use only on the work order stated. Material not consumed shall be returned to the store; excess consumption beyond the approved norm and wastage is recoverable from the running bills.</p>
        <div className="mt-2 grid grid-cols-2 gap-10">
          <SignatureBlock label="Issued by (storekeeper / issuing authority)" name={issue.issuedByName} />
          <SignatureBlock label="Received by (for the subcontractor)" name={issue.receivedByName} sub={issue.acknowledgedAt ? `Acknowledged ${dateTime(issue.acknowledgedAt)}` : undefined} />
        </div>
      </section>
    </PrintArea>
  );
}
