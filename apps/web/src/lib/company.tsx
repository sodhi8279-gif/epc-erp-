import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useApi } from './hooks';

interface Ctx { companyId: string | undefined; company: any; companies: any[]; setCompanyId: (id: string) => void }
const C = createContext<Ctx>(null as never);
const KEY = 'epc_company';

/** Selected company for headquarters-level screens (subcontractors, materials, users). */
export function CompanyProvider({ children }: { children: ReactNode }) {
  const { data: companies = [] } = useApi<any[]>('/companies');
  const [companyId, setId] = useState<string | undefined>(() => { try { return localStorage.getItem(KEY) ?? undefined; } catch { return undefined; } });
  useEffect(() => { if (companies.length && !companies.find((c) => c.id === companyId)) setId(companies[0].id); }, [companies, companyId]);
  const setCompanyId = (id: string) => { setId(id); try { localStorage.setItem(KEY, id); } catch { /* ignore */ } };
  return <C.Provider value={{ companyId, company: companies.find((c) => c.id === companyId), companies, setCompanyId }}>{children}</C.Provider>;
}
export const useCompany = () => useContext(C);
