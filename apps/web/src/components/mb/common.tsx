import { useQueries } from '@tanstack/react-query';
import { MEASUREMENT_TRANSITIONS, RETURN_PERMISSION_BY_STAGE, type MeasurementStatus, type MeasurementType, type Permission, type Transition } from '@epc/shared';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';

export const TYPE_LABEL: Record<MeasurementType, string> = { GENERIC: 'Generic (L × B × D)', PIPELINE: 'Pipeline (chainage)', EXCAVATION: 'Excavation', RCC: 'RCC / concrete', REBAR: 'Reinforcement (BBS)' };
export const TYPE_SHORT: Record<MeasurementType, string> = { GENERIC: 'Generic', PIPELINE: 'Pipeline', EXCAVATION: 'Excavation', RCC: 'RCC', REBAR: 'Rebar' };

/** The measurement book path, in order. Commercial review is optional (PM approved can go straight to certified). */
export const STEPS: { status: MeasurementStatus; label: string; optional?: boolean }[] = [
  { status: 'DRAFT', label: 'Draft' },
  { status: 'SUBMITTED', label: 'Submitted' },
  { status: 'SE_VERIFIED', label: 'SE verified' },
  { status: 'BILLING_SCRUTINIZED', label: 'Billing scrutinised' },
  { status: 'PM_APPROVED', label: 'PM approved' },
  { status: 'COMMERCIAL_REVIEWED', label: 'Commercial review', optional: true },
  { status: 'CERTIFIED', label: 'Certified' },
];

/** Button labels for each workflow action (sentence case, says what it does). */
export const ACTION_LABEL: Record<string, string> = {
  submit: 'Submit for verification', verify: 'Verify measurement', scrutinize: 'Scrutinise measurement', approve: 'Approve measurement',
  review: 'Record commercial review', certify: 'Certify for billing', return: 'Return with comments',
};

/** Transitions the current user may perform on a measurement in its present status. */
export function allowedTransitions(m: { status: string; createdById?: string }, can: (p: Permission) => boolean): (Transition & { perm: Permission })[] {
  return MEASUREMENT_TRANSITIONS.filter((t) => t.from.includes(m.status as MeasurementStatus)).map((t) => {
    const perm = t.action === 'return' ? RETURN_PERMISSION_BY_STAGE[m.status as MeasurementStatus]! : t.permission;
    return { ...t, perm };
  }).filter((t) => can(t.perm));
}

/** Hook: can(perm) bound to the project, plus the "can act on this" test used by the queue. */
export function useMbPermissions(projectId: string) {
  const { can, me } = useAuth();
  const canP = (p: Permission) => can(p, { projectId });
  const actionable = (m: { status: string; createdById?: string }) =>
    allowedTransitions(m, canP).some((t) => !(['approve', 'certify'].includes(t.action) && m.createdById === me?.user.id && !me?.user.isSuperAdmin));
  return { canP, actionable, me };
}

/** Approved work orders of the project with their lines (activity, unit, quantity). */
export function useWorkOrderLines(projectId: string) {
  const { data: wos } = useApi<any[]>(`/projects/${projectId}/work-orders`);
  const details = useQueries({ queries: (wos ?? []).map((w) => ({ queryKey: [`/work-orders/${w.id}`], queryFn: () => api.get<any>(`/work-orders/${w.id}`) })) });
  const full = details.map((d) => d.data).filter(Boolean) as any[];
  const activities = new Map<string, { id: string; code: string; name: string; unit: string }>();
  for (const w of full) for (const i of w.items ?? []) if (i.activity) activities.set(i.activity.id, { id: i.activity.id, code: i.activity.code, name: i.activity.name, unit: i.activity.unit });
  const subs = new Map<string, { id: string; name: string; code: string }>();
  for (const w of wos ?? []) if (w.subcontractor) subs.set(w.subcontractor.id, w.subcontractor);
  return { workOrders: wos, details: full, activities: [...activities.values()].sort((a, b) => a.code.localeCompare(b.code)), subcontractors: [...subs.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Chainage like 1+250.000 is how site people read it; keep the raw metre value too. */
export const chainage = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const km = Math.floor(Math.abs(n) / 1000);
  const m = (Math.abs(n) - km * 1000).toFixed(3).padStart(7, '0');
  return `${n < 0 ? '−' : ''}${km}+${m}`;
};
