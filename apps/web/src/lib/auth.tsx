import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@epc/shared';
import { api, auth } from './api';

export interface Me {
  user: { id: string; name: string; email: string; isSuperAdmin: boolean };
  assignments: { id: string; role: string; roleCode: string; company: string; companyId: string; projectId: string | null; project: string | null; financialLimit: string | null }[];
  scopes: Record<string, string[]>;
}
interface Ctx { me: Me | null; loading: boolean; can: (p: Permission, scope?: { projectId?: string; companyId?: string }) => boolean; logout: () => Promise<void>; refresh: () => void }
const AuthCtx = createContext<Ctx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), enabled: !!auth.get(), retry: false, staleTime: 60_000 });
  const me = q.data ?? null;
  const can: Ctx['can'] = (p, scope) => {
    if (!me) return false;
    if (me.user.isSuperAdmin) return true;
    if (scope?.projectId && me.scopes[`project:${scope.projectId}`]?.includes(p)) return true;
    if (scope?.companyId && me.scopes[`company:${scope.companyId}`]?.includes(p)) return true;
    if (!scope) return Object.values(me.scopes).some((s) => s.includes(p));
    return false;
  };
  const logout = async () => { await api.post('/auth/logout').catch(() => undefined); auth.set(null); qc.clear(); window.location.assign('/login'); };
  return <AuthCtx.Provider value={{ me, loading: q.isLoading, can, logout, refresh: () => q.refetch() }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
