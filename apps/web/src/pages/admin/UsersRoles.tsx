import { Fragment, useMemo, useState } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCompany } from '../../lib/company';
import { useAction, useApi } from '../../lib/hooks';
import { humanize, inr } from '../../lib/format';
import { Button, Dialog, Empty, Field, Input, Notice, PageHeader, Select, Sheet, Status, Table, Tabs, Tag, cx } from '../../components/ui';

const MODULE_LABEL: Record<string, string> = {
  admin: 'Administration', audit: 'Audit', org: 'Organisation', project: 'Projects', contract: 'Contracts', document: 'Documents', boq: 'BOQ',
  activity: 'Activity breakup', subcontractor: 'Subcontractors', workorder: 'Work orders', allocation: 'Work allocation', measurement: 'Measurement book',
  material: 'Materials', reconciliation: 'Material reconciliation', report: 'Reports',
};
type PermGroup = { module: string; label: string; perms: { key: string; label: string }[] };
const groupPermissions = (perms: Record<string, string>): PermGroup[] => {
  const m = new Map<string, PermGroup>();
  for (const [key, label] of Object.entries(perms)) {
    const mod = key.split('.')[0];
    if (!m.has(mod)) m.set(mod, { module: mod, label: MODULE_LABEL[mod] ?? humanize(mod), perms: [] });
    m.get(mod)!.perms.push({ key, label });
  }
  return [...m.values()];
};

function useOrgData(companyId: string | undefined) {
  const meta = useApi<any>('/meta/permissions');
  const roles = useApi<any[]>(companyId ? `/companies/${companyId}/roles` : null);
  const projects = useApi<any[]>('/projects');
  return { meta: meta.data, roles: roles.data, projects: (projects.data ?? []).filter((p) => p.companyId === companyId) };
}

export function UsersRoles() {
  const { companyId, company } = useCompany();
  const { can } = useAuth();
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const canUsers = !!companyId && can('admin.users', { companyId });
  const canRoles = !!companyId && can('admin.roles', { companyId });
  const org = useOrgData(companyId);
  if (!companyId) return <PageHeader title="Users & roles" />;
  return (
    <>
      <PageHeader title="Users & roles" description={`Who can do what in ${company?.name ?? 'this company'}. A role is a set of permissions; it is assigned to a user for all projects or one project, with an optional financial limit for approvals.`} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'users', label: 'Users' }, { value: 'roles', label: `Roles and permissions${org.roles ? ` (${org.roles.length})` : ''}` }]} />
      {tab === 'users' && (canUsers ? <UsersTab companyId={companyId} org={org} /> : <Notice tone="warning" title="You do not have permission to manage users in this company" />)}
      {tab === 'roles' && <RolesTab companyId={companyId} org={org} canEdit={canRoles} />}
    </>
  );
}

type Org = ReturnType<typeof useOrgData>;
const blankAssign = { roleId: '', projectId: '', financialLimit: '' };

function AssignmentFields({ org, v, set }: { org: Org; v: typeof blankAssign; set: (v: typeof blankAssign) => void }) {
  const { me } = useAuth();
  return (
    <>
      <Field label="Role">
        <Select value={v.roleId} onChange={(e) => set({ ...v, roleId: e.target.value })}>
          <option value="">Select a role…</option>
          {org.roles?.filter((r) => r.code !== 'SUPER_ADMIN' || me?.user.isSuperAdmin).map((r) => <option key={r.id} value={r.id}>{r.name} · {humanize(r.department)}</option>)}
        </Select>
      </Field>
      <Field label="Project scope">
        <Select value={v.projectId} onChange={(e) => set({ ...v, projectId: e.target.value })}>
          <option value="">All projects</option>
          {org.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </Select>
      </Field>
      <Field label="Financial limit (₹)" hint="Highest value this user may approve under this role. Leave empty for no limit.">
        <Input inputMode="decimal" value={v.financialLimit} onChange={(e) => set({ ...v, financialLimit: e.target.value })} placeholder="No limit" />
      </Field>
    </>
  );
}
const assignBody = (v: typeof blankAssign) => ({ roleId: v.roleId, projectId: v.projectId || null, financialLimit: v.financialLimit.trim() ? v.financialLimit.replace(/,/g, '').trim() : null });

function UsersTab({ companyId, org }: { companyId: string; org: Org }) {
  const { me } = useAuth();
  const { data: users } = useApi<any[]>(`/companies/${companyId}/users`);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [addUser, setAddUser] = useState(false);
  const [nu, setNu] = useState({ name: '', email: '', password: '', ...blankAssign });
  const [assignFor, setAssignFor] = useState<any | null>(null);
  const [na, setNa] = useState(blankAssign);
  const [rowErr, setRowErr] = useState<unknown>(null);

  const create = useAction(() => api.post(`/companies/${companyId}/users`, { name: nu.name.trim(), email: nu.email.trim(), password: nu.password, ...assignBody(nu) }), { onSuccess: () => { setAddUser(false); setNu({ name: '', email: '', password: '', ...blankAssign }); } });
  const assign = useAction(() => api.post(`/users/${assignFor.id}/assignments`, { companyId, ...assignBody(na) }), { onSuccess: () => { setAssignFor(null); setNa(blankAssign); } });
  const revoke = useAction((id: string) => api.del(`/assignments/${id}`), { onSuccess: () => setRowErr(null) });
  const setActive = useAction((v: { id: string; active: boolean }) => api.patch(`/users/${v.id}`, { companyId, active: v.active }), { onSuccess: () => setRowErr(null) });

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return users?.filter((u) => (showInactive || u.active) && (!n || `${u.name} ${u.email} ${u.assignments.map((a: any) => a.role.name).join(' ')}`.toLowerCase().includes(n)));
  }, [users, q, showInactive]);
  const existing = users?.find((u) => u.email.toLowerCase() === nu.email.trim().toLowerCase());

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input aria-label="Search users" placeholder="Search name, email or role" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 w-full sm:w-[300px]" />
        <label className="flex items-center gap-1.5 text-[13px] text-ink-soft"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive users</label>
        <div className="ml-auto"><Button variant="primary" onClick={() => { create.reset(); setAddUser(true); }}><Plus className="size-4" /> Add user</Button></div>
      </div>
      {rowErr ? <div className="mb-3"><Notice error={rowErr} onClose={() => setRowErr(null)} /></div> : null}
      <Sheet flush>
        <Table rows={rows} rowKey={(u: any) => u.id} empty="No users match." rowClassName={(u: any) => (u.active ? undefined : 'bg-paper text-ink-soft')}
          cols={[
            { key: 'n', header: 'User', cell: (u: any) => <div><div className="font-medium text-ink">{u.name}{u.isSuperAdmin && <> <Tag tone="teal">Super admin</Tag></>}{u.id === me?.user.id && <span className="text-xs text-ink-soft"> (you)</span>}</div><div className="text-xs text-ink-soft">{u.email}</div></div> },
            { key: 's', header: 'Status', cell: (u: any) => <Status value={u.active ? 'ACTIVE' : 'INACTIVE'} /> },
            {
              key: 'a', header: 'Role assignments', cell: (u: any) => (
                <ul className="space-y-1">
                  {u.assignments.map((a: any) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium text-ink">{a.role.name}</span>
                      <span className="text-ink-soft">{a.project ? `${a.project.code} · ${a.project.name}` : 'All projects'}</span>
                      {a.financialLimit && <Tag>Limit {inr(a.financialLimit, 0)}</Tag>}
                      <button type="button" className="text-ink-soft hover:text-red" aria-label={`Revoke ${a.role.name}`} title="Revoke this assignment"
                        onClick={() => confirm(`Revoke ${a.role.name} (${a.project ? a.project.code : 'all projects'}) from ${u.name}?`) && revoke.mutate(a.id, { onError: setRowErr })}><X className="size-3.5" /></button>
                    </li>
                  ))}
                  {u.assignments.length === 0 && <li className="text-ink-soft">No roles in this company</li>}
                </ul>
              ),
            },
            {
              key: 'x', header: '', align: 'right', cell: (u: any) => (
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" onClick={() => { assign.reset(); setNa(blankAssign); setAssignFor(u); }}>Add role</Button>
                  {u.id !== me?.user.id && (u.active
                    ? <Button size="sm" variant="danger" busy={setActive.isPending && setActive.variables?.id === u.id} onClick={() => confirm(`Deactivate ${u.name}? They will no longer be able to sign in.`) && setActive.mutate({ id: u.id, active: false }, { onError: setRowErr })}>Deactivate</Button>
                    : <Button size="sm" busy={setActive.isPending && setActive.variables?.id === u.id} onClick={() => setActive.mutate({ id: u.id, active: true }, { onError: setRowErr })}>Activate</Button>)}
                </div>
              ),
            },
          ]} />
      </Sheet>

      <Dialog open={addUser} onClose={() => setAddUser(false)} title="Add user" footer={<><Button onClick={() => setAddUser(false)}>Cancel</Button><Button variant="primary" busy={create.isPending} disabled={!nu.roleId} onClick={() => create.mutate(undefined)}>{existing ? 'Add role to existing user' : 'Create user'}</Button></>}>
        <div className="grid gap-3">
          {create.error ? <Notice error={create.error} /> : null}
          <Field label="Email"><Input type="email" autoComplete="off" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} /></Field>
          {existing && <Notice tone="info" title={`${existing.name} already has an account`}>The role below is added to the existing user; name and password are not changed.</Notice>}
          <Field label="Full name"><Input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} /></Field>
          <Field label="Initial password" hint="At least 10 characters. Share it securely; the user should change it after signing in."><Input type="password" autoComplete="new-password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /></Field>
          <AssignmentFields org={org} v={nu} set={(v) => setNu({ ...nu, ...v })} />
        </div>
      </Dialog>

      <Dialog open={!!assignFor} onClose={() => setAssignFor(null)} title={`Add role for ${assignFor?.name ?? ''}`} footer={<><Button onClick={() => setAssignFor(null)}>Cancel</Button><Button variant="primary" busy={assign.isPending} disabled={!na.roleId} onClick={() => assign.mutate(undefined)}>Add role</Button></>}>
        <div className="grid gap-3">
          {assign.error ? <Notice error={assign.error} /> : null}
          <AssignmentFields org={org} v={na} set={setNa} />
        </div>
      </Dialog>
    </>
  );
}

function RolesTab({ companyId, org, canEdit }: { companyId: string; org: Org; canEdit: boolean }) {
  const { me } = useAuth();
  const groups = useMemo(() => (org.meta ? groupPermissions(org.meta.permissions) : []), [org.meta]);
  const [edit, setEdit] = useState<{ id?: string; code: string; name: string; department: string; permissions: Set<string> } | null>(null);
  const save = useAction(() => {
    const body = { name: edit!.name.trim(), department: edit!.department, permissions: [...edit!.permissions] };
    return edit!.id ? api.put(`/roles/${edit!.id}`, body) : api.post(`/companies/${companyId}/roles`, { ...body, code: edit!.code.trim().toUpperCase().replace(/\s+/g, '_') });
  }, { onSuccess: () => setEdit(null) });
  const roles = org.roles;
  if (!roles || !org.meta) return <p className="text-ink-soft">Loading…</p>;
  if (roles.length === 0) return <Empty title="No roles in this company" />;
  const togglePerm = (k: string) => setEdit((e) => { if (!e) return e; const p = new Set(e.permissions); if (p.has(k)) p.delete(k); else p.add(k); return { ...e, permissions: p }; });
  const toggleGroup = (g: PermGroup, on: boolean) => setEdit((e) => { if (!e) return e; const p = new Set(e.permissions); g.perms.forEach((x) => (on ? p.add(x.key) : p.delete(x.key))); return { ...e, permissions: p }; });
  const editable = (r: any) => canEdit && (r.code !== 'SUPER_ADMIN' || me?.user.isSuperAdmin);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-ink-soft">Each column is a role; a tick means the role has that permission. {canEdit ? 'Use Edit to change a role.' : 'You can view roles but not change them.'}</p>
        {canEdit && <Button variant="primary" onClick={() => { save.reset(); setEdit({ code: '', name: '', department: 'PROJECT', permissions: new Set(['project.view']) }); }}><Plus className="size-4" /> New role</Button>}
      </div>
      <div className="overflow-auto rounded-[4px] border border-rule bg-sheet" style={{ maxHeight: '75vh' }}>
        <table className="border-collapse text-[13px]">
          <thead className="sticky top-0 z-20">
            <tr className="bg-paper">
              <th className="sticky left-0 z-30 min-w-[260px] border-b border-r border-rule bg-paper px-3 py-2 text-left font-medium text-ink-soft">Permission</th>
              {roles.map((r) => (
                <th key={r.id} className="w-[92px] min-w-[92px] border-b border-r border-rule-soft bg-paper px-1.5 py-2 align-bottom font-medium">
                  <div className="text-[12px] leading-tight" title={`${r.name} (${r.code})`}>{r.name}</div>
                  <div className="mt-0.5 text-[11px] font-normal text-ink-soft">{r._count.assignments} assigned</div>
                  {editable(r) && <button type="button" className="mt-1 inline-flex items-center gap-1 text-[12px] font-normal text-teal hover:underline" onClick={() => { save.reset(); setEdit({ id: r.id, code: r.code, name: r.name, department: r.department, permissions: new Set(r.permissions) }); }}><Pencil className="size-3" />Edit</button>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.module}>
                <tr className="bg-paper">
                  <td className="sticky left-0 z-10 border-b border-r border-rule bg-paper px-3 py-1.5 text-[12px] font-semibold">{g.label}</td>
                  <td colSpan={roles.length} className="border-b border-rule bg-paper" />
                </tr>
                {g.perms.map((p) => (
                  <tr key={p.key} className="hover:bg-teal-wash/40">
                    <td className="sticky left-0 z-10 border-b border-r border-rule-soft bg-sheet px-3 py-1.5"><div>{p.label}</div><div className="font-mono text-[11px] text-ink-soft">{p.key}</div></td>
                    {roles.map((r) => (
                      <td key={r.id} className="border-b border-r border-rule-soft text-center">{r.permissions.includes(p.key) ? <Check className="mx-auto size-4 text-teal" aria-label="Yes" /> : <span className="sr-only">No</span>}</td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog wide open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit role: ${edit.name}` : 'New role'}
        footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate(undefined)}>{edit?.id ? 'Save role' : 'Create role'}</Button></>}>
        {edit && (
          <div className="grid gap-4">
            {save.error ? <Notice error={save.error} /> : null}
            {edit.id && (roles.find((r) => r.id === edit.id)?._count.assignments ?? 0) > 0 && <Notice tone="warning" title={`This role is assigned to ${roles.find((r) => r.id === edit.id)._count.assignments} user(s)`}>Changes take effect for all of them immediately.</Notice>}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Code" hint={edit.id ? 'Cannot be changed' : 'e.g. SITE_INCHARGE'}><Input value={edit.code} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} /></Field>
              <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Department">
                <Select value={edit.department} onChange={(e) => setEdit({ ...edit, department: e.target.value })}>
                  {(org.meta.departments as string[]).map((d) => <option key={d} value={d}>{humanize(d)}</option>)}
                </Select>
              </Field>
            </div>
            <div className="text-[13px] text-ink-soft">{edit.permissions.size} of {Object.keys(org.meta.permissions).length} permissions selected</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {groups.map((g) => {
                const n = g.perms.filter((p) => edit.permissions.has(p.key)).length;
                return (
                  <fieldset key={g.module} className="rounded-[3px] border border-rule-soft px-3 py-2">
                    <legend className="flex items-center gap-2 px-1 text-[13px] font-semibold">
                      {g.label}
                      <button type="button" className="text-[12px] font-normal text-teal hover:underline" onClick={() => toggleGroup(g, n < g.perms.length)}>{n < g.perms.length ? 'Select all' : 'Clear'}</button>
                    </legend>
                    {g.perms.map((p) => (
                      <label key={p.key} className={cx('flex items-start gap-2 py-0.5 text-[13px]', !edit.permissions.has(p.key) && 'text-ink-soft')}>
                        <input type="checkbox" className="mt-0.5" checked={edit.permissions.has(p.key)} onChange={() => togglePerm(p.key)} />
                        <span>{p.label}</span>
                      </label>
                    ))}
                  </fieldset>
                );
              })}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
