import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { Building2, ClipboardList, FileSpreadsheet, Gauge, HardHat, Layers, LogOut, Package, Ruler, ScrollText, Shield, Users, Warehouse, Boxes, Scale, ArrowLeftRight, BookOpen, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { useCompany } from '../lib/company';
import { cx } from './ui';

function Item({ to, icon, children, end }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cx('flex items-center gap-2.5 rounded-[3px] px-2.5 py-1.5 text-[13px]', isActive ? 'bg-white/12 text-white font-medium' : 'text-white/70 hover:bg-white/6 hover:text-white')}>
      <span className="[&>svg]:size-4 opacity-80">{icon}</span>{children}
    </NavLink>
  );
}
const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="mt-5"><div className="mb-1 px-2.5 text-xs text-white/45">{title}</div><div className="space-y-0.5">{children}</div></div>
);

export function Layout() {
  const { me, logout, can } = useAuth();
  const { projectId } = useParams();
  const nav = useNavigate();
  const { companies, companyId, setCompanyId } = useCompany();
  const { data: projects = [] } = useApi<any[]>('/projects');
  const p = `/p/${projectId}`;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto bg-ink px-3 py-4 text-white md:flex">
        <div className="px-2.5">
          <div className="font-display text-[17px] font-bold leading-tight">EPC Contracts<br />&amp; Billing</div>
          {companies.length > 1 ? (
            <select aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="mt-2 w-full rounded-[3px] border border-white/20 bg-transparent px-1.5 py-1 text-xs text-white/80">
              {companies.map((c) => <option key={c.id} value={c.id} className="text-ink">{c.name}</option>)}
            </select>
          ) : <div className="mt-1 text-xs text-white/55">{companies[0]?.name}</div>}
        </div>
        <Group title="Headquarters">
          <Item to="/" end icon={<Gauge />}>Portfolio</Item>
          <Item to="/projects" icon={<Building2 />}>Projects</Item>
          <Item to="/subcontractors" icon={<HardHat />}>Subcontractors</Item>
          <Item to="/materials" icon={<Package />}>Material master</Item>
          {can('admin.users') && <Item to="/admin/users" icon={<Users />}>Users &amp; roles</Item>}
          {can('audit.view') && <Item to="/audit" icon={<Shield />}>Audit log</Item>}
        </Group>
        <div className="mt-5 px-2.5">
          <div className="mb-1 text-xs text-white/45">Project</div>
          <select aria-label="Project" value={projectId ?? ''} onChange={(e) => e.target.value && nav(`/p/${e.target.value}`)} className="w-full rounded-[3px] border border-white/20 bg-transparent px-1.5 py-1.5 text-[13px] text-white">
            <option value="" className="text-ink">Select a project…</option>
            {projects.map((x) => <option key={x.id} value={x.id} className="text-ink">{x.code} · {x.name}</option>)}
          </select>
        </div>
        {projectId && (
          <>
            <div className="mt-2 space-y-0.5">
              <Item to={p} end icon={<Gauge />}>Overview</Item>
              <Item to={`${p}/contracts`} icon={<FileSpreadsheet />}>Contracts &amp; BOQ</Item>
              <Item to={`${p}/work-orders`} icon={<ClipboardList />}>Work orders</Item>
              <Item to={`${p}/allocation`} icon={<Layers />}>Work allocation</Item>
              <Item to={`${p}/measurements`} icon={<Ruler />}>Measurement book</Item>
            </div>
            <Group title="Materials">
              <Item to={`${p}/materials/stock`} icon={<Warehouse />}>Stock</Item>
              <Item to={`${p}/materials/receipts`} icon={<Truck />}>Receipts</Item>
              <Item to={`${p}/materials/issues`} icon={<Boxes />}>Issues &amp; requisitions</Item>
              <Item to={`${p}/materials/returns`} icon={<ArrowLeftRight />}>Returns &amp; transfers</Item>
              <Item to={`${p}/materials/ledger`} icon={<BookOpen />}>Contractor ledger</Item>
              <Item to={`${p}/materials/norms`} icon={<ScrollText />}>Consumption norms</Item>
              <Item to={`${p}/materials/reconciliation`} icon={<Scale />}>Reconciliation</Item>
            </Group>
          </>
        )}
        <div className="mt-auto border-t border-white/10 px-2.5 pt-3 text-xs text-white/70">
          <div className="font-medium text-white">{me?.user.name}</div>
          <div className="truncate">{me?.assignments.map((a) => a.role).filter((v, i, s) => s.indexOf(v) === i).join(', ') || (me?.user.isSuperAdmin ? 'Super administrator' : '')}</div>
          <button onClick={logout} className="mt-2 inline-flex items-center gap-1.5 text-white/70 hover:text-white"><LogOut className="size-3.5" /> Sign out</button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-rule bg-ink px-4 py-2 text-white md:hidden">
          <span className="font-display font-bold">EPC Billing</span>
          <select aria-label="Project" value={projectId ?? ''} onChange={(e) => nav(e.target.value ? `/p/${e.target.value}` : '/')} className="max-w-[55%] rounded border border-white/20 bg-transparent px-1 py-1 text-xs">
            <option value="" className="text-ink">Portfolio</option>
            {projects.map((x) => <option key={x.id} value={x.id} className="text-ink">{x.code}</option>)}
          </select>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-5 md:px-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
