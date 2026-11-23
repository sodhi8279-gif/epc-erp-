/** Permission catalogue. Roles are configurable sets of these, scoped by company/project/department with optional financial limits. */
export const PERMISSIONS = {
  'admin.users': 'Manage users and role assignments',
  'admin.roles': 'Manage roles and permissions',
  'audit.view': 'View audit log',
  'org.manage': 'Manage companies and projects',
  'project.view': 'View project data',
  'contract.manage': 'Create and edit contracts',
  'document.upload': 'Upload documents',
  'boq.edit': 'Create / edit draft BOQ revisions and imports',
  'boq.approve': 'Approve BOQ revisions',
  'activity.edit': 'Edit BOQ activity breakup',
  'activity.approve': 'Approve activity breakup and unit conversions',
  'subcontractor.manage': 'Create and edit subcontractors',
  'subcontractor.approve': 'Approve / verify subcontractors',
  'workorder.edit': 'Draft work orders and amendments',
  'workorder.approve': 'Approve work orders and rate changes (financial limit applies)',
  'allocation.edit': 'Allocate work to subcontractors',
  'allocation.override': 'Approve allocation exceptions',
  'measurement.create': 'Enter measurements',
  'measurement.verify': 'Site engineer verification',
  'measurement.scrutinize': 'Billing engineer scrutiny',
  'measurement.approve': 'Project manager approval',
  'measurement.review': 'Commercial review',
  'measurement.certify': 'Certify measurements for billing',
  'measurement.reverse': 'Reverse approved measurements',
  'material.master': 'Manage material master and stores',
  'material.receive': 'Record material receipts',
  'material.requisition': 'Raise material requisitions',
  'material.approve': 'Approve requisitions',
  'material.issue': 'Issue / return / transfer material',
  'material.norms': 'Manage consumption norms',
  'reconciliation.prepare': 'Prepare material reconciliation',
  'reconciliation.approve': 'Approve material reconciliation',
  'report.view': 'View reports',
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const P = (...p: Permission[]) => p;
const VIEW = P('project.view', 'report.view');

/** Default role templates seeded per company. Administrators can edit them. */
export const DEFAULT_ROLES: Record<string, { name: string; department: string; permissions: Permission[] }> = {
  SUPER_ADMIN: { name: 'Super Administrator', department: 'MANAGEMENT', permissions: ALL_PERMISSIONS },
  DIRECTOR: { name: 'Company Director', department: 'MANAGEMENT', permissions: P(...VIEW, 'audit.view', 'boq.approve', 'workorder.approve', 'subcontractor.approve', 'allocation.override', 'reconciliation.approve', 'activity.approve') },
  HEAD_COMMERCIAL: { name: 'Head of Commercial', department: 'COMMERCIAL', permissions: P(...VIEW, 'contract.manage', 'document.upload', 'boq.edit', 'boq.approve', 'activity.edit', 'activity.approve', 'subcontractor.manage', 'subcontractor.approve', 'workorder.edit', 'workorder.approve', 'allocation.override', 'measurement.review', 'measurement.certify', 'measurement.reverse', 'reconciliation.approve') },
  FINANCE_HEAD: { name: 'Finance Head', department: 'ACCOUNTS', permissions: P(...VIEW, 'audit.view', 'subcontractor.approve', 'workorder.approve', 'reconciliation.approve') },
  ACCOUNTS_MANAGER: { name: 'Accounts Manager', department: 'ACCOUNTS', permissions: P(...VIEW, 'subcontractor.manage') },
  CONTRACT_MANAGER: { name: 'Contract Manager', department: 'COMMERCIAL', permissions: P(...VIEW, 'contract.manage', 'document.upload', 'boq.edit', 'activity.edit', 'subcontractor.manage', 'workorder.edit', 'allocation.edit', 'measurement.review') },
  PROJECT_MANAGER: { name: 'Project Manager', department: 'PROJECT', permissions: P(...VIEW, 'document.upload', 'allocation.edit', 'measurement.create', 'measurement.verify', 'measurement.approve', 'material.approve', 'material.requisition', 'reconciliation.prepare', 'workorder.edit') },
  SITE_ENGINEER: { name: 'Site Engineer', department: 'PROJECT', permissions: P('project.view', 'measurement.create', 'measurement.verify', 'material.requisition', 'document.upload') },
  BILLING_ENGINEER: { name: 'Billing Engineer', department: 'BILLING', permissions: P(...VIEW, 'measurement.create', 'measurement.scrutinize', 'reconciliation.prepare', 'document.upload', 'allocation.edit') },
  STOREKEEPER: { name: 'Storekeeper', department: 'STORES', permissions: P('project.view', 'material.receive', 'material.issue', 'material.requisition', 'material.master') },
  QUANTITY_SURVEYOR: { name: 'Quantity Surveyor', department: 'TECHNICAL', permissions: P(...VIEW, 'boq.edit', 'activity.edit', 'measurement.scrutinize', 'material.norms', 'reconciliation.prepare') },
  INTERNAL_AUDITOR: { name: 'Internal Auditor', department: 'AUDIT', permissions: P(...VIEW, 'audit.view') },
  VIEWER: { name: 'Read-only Viewer', department: 'MANAGEMENT', permissions: VIEW },
  SUBCONTRACTOR_PORTAL: { name: 'Subcontractor Portal User', department: 'EXTERNAL', permissions: P('project.view') },
};

export const DEPARTMENTS = ['MANAGEMENT', 'COMMERCIAL', 'ACCOUNTS', 'BILLING', 'PROCUREMENT', 'TECHNICAL', 'AUDIT', 'PROJECT', 'STORES', 'EXTERNAL'] as const;
