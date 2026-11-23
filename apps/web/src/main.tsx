import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth';
import { CompanyProvider } from './lib/company';
import { auth } from './lib/api';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Portfolio } from './pages/Portfolio';
import { Projects } from './pages/Projects';
import { ProjectOverview } from './pages/ProjectOverview';
import { Contracts } from './pages/boq/Contracts';
import { ContractDetail } from './pages/boq/ContractDetail';
import { RevisionView } from './pages/boq/RevisionView';
import { ImportWizard } from './pages/boq/ImportWizard';
import { BreakupEditor } from './pages/boq/BreakupEditor';
import { Subcontractors } from './pages/subcontract/Subcontractors';
import { SubcontractorDetail } from './pages/subcontract/SubcontractorDetail';
import { WorkOrders } from './pages/subcontract/WorkOrders';
import { WorkOrderForm } from './pages/subcontract/WorkOrderForm';
import { WorkOrderDetail } from './pages/subcontract/WorkOrderDetail';
import { Allocation } from './pages/subcontract/Allocation';
import { Measurements } from './pages/mb/Measurements';
import { MeasurementForm } from './pages/mb/MeasurementForm';
import { MeasurementDetail } from './pages/mb/MeasurementDetail';
import { MaterialMaster } from './pages/materials/MaterialMaster';
import { Stock } from './pages/materials/Stock';
import { Receipts } from './pages/materials/Receipts';
import { Issues } from './pages/materials/Issues';
import { Returns } from './pages/materials/Returns';
import { ContractorLedger } from './pages/materials/ContractorLedger';
import { Norms } from './pages/materials/Norms';
import { Reconciliation } from './pages/materials/Reconciliation';
import { ReconciliationDetail } from './pages/materials/ReconciliationDetail';
import { UsersRoles } from './pages/admin/UsersRoles';
import { AuditLog } from './pages/admin/AuditLog';

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });

function Protected() {
  const { me, loading } = useAuth();
  if (!auth.get()) return <Navigate to="/login" replace />;
  if (loading || !me) return <div className="p-10 text-ink-soft">Loading…</div>;
  return <CompanyProvider><Layout /></CompanyProvider>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Protected />}>
              <Route path="/" element={<Portfolio />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/subcontractors" element={<Subcontractors />} />
              <Route path="/subcontractors/:id" element={<SubcontractorDetail />} />
              <Route path="/materials" element={<MaterialMaster />} />
              <Route path="/admin/users" element={<UsersRoles />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/p/:projectId">
                <Route index element={<ProjectOverview />} />
                <Route path="contracts" element={<Contracts />} />
                <Route path="contracts/:contractId" element={<ContractDetail />} />
                <Route path="contracts/:contractId/revisions/:revisionId" element={<RevisionView />} />
                <Route path="contracts/:contractId/import" element={<ImportWizard />} />
                <Route path="contracts/:contractId/import/:importId" element={<ImportWizard />} />
                <Route path="contracts/:contractId/items/:itemKey" element={<BreakupEditor />} />
                <Route path="work-orders" element={<WorkOrders />} />
                <Route path="work-orders/new" element={<WorkOrderForm />} />
                <Route path="work-orders/:id" element={<WorkOrderDetail />} />
                <Route path="work-orders/:id/edit" element={<WorkOrderForm />} />
                <Route path="allocation" element={<Allocation />} />
                <Route path="measurements" element={<Measurements />} />
                <Route path="measurements/new" element={<MeasurementForm />} />
                <Route path="measurements/:id" element={<MeasurementDetail />} />
                <Route path="measurements/:id/edit" element={<MeasurementForm />} />
                <Route path="materials/stock" element={<Stock />} />
                <Route path="materials/receipts" element={<Receipts />} />
                <Route path="materials/issues" element={<Issues />} />
                <Route path="materials/returns" element={<Returns />} />
                <Route path="materials/ledger" element={<ContractorLedger />} />
                <Route path="materials/norms" element={<Norms />} />
                <Route path="materials/reconciliation" element={<Reconciliation />} />
                <Route path="materials/reconciliation/:id" element={<ReconciliationDetail />} />
              </Route>
              <Route path="*" element={<div className="p-10">Page not found.</div>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
