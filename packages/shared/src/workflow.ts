import type { Permission } from './permissions';

export const MEASUREMENT_STATUSES = ['DRAFT', 'SUBMITTED', 'SE_VERIFIED', 'BILLING_SCRUTINIZED', 'PM_APPROVED', 'COMMERCIAL_REVIEWED', 'CERTIFIED', 'RETURNED', 'REVERSED'] as const;
export type MeasurementStatus = (typeof MEASUREMENT_STATUSES)[number];

export interface Transition { action: string; from: MeasurementStatus[]; to: MeasurementStatus; permission: Permission; requiresComment?: boolean; label: string }

/** Draft → SE verification → Billing scrutiny → PM approval → (Commercial review) → Certification. */
export const MEASUREMENT_TRANSITIONS: Transition[] = [
  { action: 'submit', from: ['DRAFT', 'RETURNED'], to: 'SUBMITTED', permission: 'measurement.create', label: 'Submit' },
  { action: 'verify', from: ['SUBMITTED'], to: 'SE_VERIFIED', permission: 'measurement.verify', label: 'Verify (Site Engineer)' },
  { action: 'scrutinize', from: ['SE_VERIFIED'], to: 'BILLING_SCRUTINIZED', permission: 'measurement.scrutinize', label: 'Scrutinise (Billing)' },
  { action: 'approve', from: ['BILLING_SCRUTINIZED'], to: 'PM_APPROVED', permission: 'measurement.approve', label: 'Approve (PM)' },
  { action: 'review', from: ['PM_APPROVED'], to: 'COMMERCIAL_REVIEWED', permission: 'measurement.review', label: 'Commercial review' },
  { action: 'certify', from: ['PM_APPROVED', 'COMMERCIAL_REVIEWED'], to: 'CERTIFIED', permission: 'measurement.certify', label: 'Certify for billing' },
  { action: 'return', from: ['SUBMITTED', 'SE_VERIFIED', 'BILLING_SCRUTINIZED', 'PM_APPROVED', 'COMMERCIAL_REVIEWED'], to: 'RETURNED', permission: 'measurement.verify', requiresComment: true, label: 'Return with comments' },
];
/** Returning from later stages needs the permission of that stage's reviewer. */
export const RETURN_PERMISSION_BY_STAGE: Partial<Record<MeasurementStatus, Permission>> = {
  SUBMITTED: 'measurement.verify', SE_VERIFIED: 'measurement.scrutinize', BILLING_SCRUTINIZED: 'measurement.approve',
  PM_APPROVED: 'measurement.review', COMMERCIAL_REVIEWED: 'measurement.certify',
};
export const EDITABLE_MEASUREMENT: MeasurementStatus[] = ['DRAFT', 'RETURNED'];
/** Statuses that count as "approved quantity" (consumes allocation, feeds reconciliation). */
export const APPROVED_MEASUREMENT: MeasurementStatus[] = ['PM_APPROVED', 'COMMERCIAL_REVIEWED', 'CERTIFIED'];
/** Statuses that hold quantity against allocation/chainage (everything except draft-less dead states). */
export const LIVE_MEASUREMENT: MeasurementStatus[] = ['DRAFT', 'SUBMITTED', 'SE_VERIFIED', 'BILLING_SCRUTINIZED', 'PM_APPROVED', 'COMMERCIAL_REVIEWED', 'CERTIFIED', 'RETURNED'];
