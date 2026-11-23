import { useQueries } from '@tanstack/react-query';
import { D } from '@epc/shared';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { dateTime, humanize } from '../../lib/format';
import { Notice, Sheet } from '../ui';

/** Maps API validation details (Fastify/zod `instancePath` or zod `path`) to { 'field' | 'items.0.rate': message }. */
export function fieldErrors(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return out;
  for (const d of err.details as any[]) {
    const parts: string[] = Array.isArray(d?.path) ? d.path.map(String) : typeof d?.instancePath === 'string' ? d.instancePath.split('/').filter(Boolean) : [];
    if (!parts.length) continue;
    const key = parts.join('.');
    if (!out[key]) out[key] = d.message;
  }
  return out;
}

/** Errors that the user can act on: financial limit and segregation-of-duty rules are spelled out. */
export function ActionError({ error, onClose }: { error: unknown; onClose?: () => void }) {
  if (!error) return null;
  if (error instanceof ApiError && error.code === 'FINANCIAL_LIMIT') return <Notice tone="error" title="Above your approval limit" onClose={onClose}>{error.message}. Ask an approver with a higher financial limit to approve it.</Notice>;
  if (error instanceof ApiError && /cannot approve/i.test(error.message)) return <Notice tone="error" title="Segregation of duties" onClose={onClose}>{error.message}. A different approver must approve it.</Notice>;
  return <Notice error={error} onClose={onClose} />;
}

/** Internal budget rate per activity unit from the approved breakup (client rate apportionment, not the subcontract rate). */
export function budgetRate(a: any): string | null {
  if (!a?.boqItem) return null;
  const f = D(a.conversionFactor ?? 1);
  if (f.lte(0)) return null;
  const perParent = a.method === 'FIXED_RATE' ? D(a.fixedRate ?? 0) : D(a.boqItem.rate).times(D(a.percentage ?? 0)).div(100);
  return perParent.div(f).toDecimalPlaces(2).toString();
}

/** All active execution activities of every contract in the project (from GET /contracts/:id/activities). */
export function useProjectActivities(projectId: string) {
  const { data: contracts } = useApi<any[]>(`/projects/${projectId}/contracts`);
  const qs = useQueries({ queries: (contracts ?? []).map((c) => ({ queryKey: [`/contracts/${c.id}/activities`], queryFn: () => api.get<any[]>(`/contracts/${c.id}/activities`) })) });
  if (!contracts) return { activities: undefined, contracts: undefined };
  if (qs.some((q) => q.isLoading)) return { activities: undefined, contracts };
  const activities = qs.flatMap((q, i) => (q.data ?? []).map((a) => ({ ...a, contractNo: contracts[i].contractNo })));
  return { activities, contracts };
}

export const activityLabel = (a: any) => `${a.contractNo ? a.contractNo + ' · ' : ''}Item ${a.boqItem?.itemNo ?? '?'} · ${a.code} ${a.name}`;

/** Workflow history from GET /workflow/:entityType/:id. */
export function WorkflowHistory({ entityType, id }: { entityType: string; id: string }) {
  const { data } = useApi<any[]>(`/workflow/${entityType}/${id}`);
  return (
    <Sheet title="Approval history" flush>
      <ul className="divide-y divide-rule-soft text-[13px]">
        {data?.length === 0 && <li className="px-4 py-3 text-ink-soft">No actions yet.</li>}
        {data?.map((h: any) => (
          <li key={h.id} className="px-4 py-2">
            <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{humanize(h.action)}{h.toStatus ? ` · ${humanize(h.toStatus)}` : ''}</span><span className="text-ink-soft">{dateTime(h.createdAt ?? h.at)}</span></div>
            <div className="text-ink-soft">{h.user?.name ?? h.userName ?? ''}{h.comment ? ` — ${h.comment}` : ''}</div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export const MATERIAL_RESP: Record<string, string> = {
  COMPANY_RECOVERABLE: 'Company supplied, recoverable',
  COMPANY_FREE_ISSUE: 'Company supplied, free issue',
  SUBCONTRACTOR: 'Subcontractor supplies',
  MIXED: 'Mixed (per item)',
};
