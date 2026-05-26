import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { CompareLayout } from "@/components/layout/CompareLayout";
import Index from "./pages/Index";
import Applications from "./pages/Applications";
import ApplicationDetail from "./pages/ApplicationDetail";
import TestCaseEditor from "./pages/TestCaseEditor";
import TestRuns from "./pages/TestRuns";
import TestRunDetail from "./pages/TestRunDetail";
import TestRunSetup from "./pages/TestRunSetup";
import Settings from "./pages/Settings";
import AuditLog from "./pages/AuditLog";
import ImportExport from "./pages/ImportExport";
import CloneRuns from "./pages/CloneRuns";
import RunReports from "./pages/RunReports";
import Evidence from "./pages/Evidence";
import Library from "./pages/Library";
import LibraryRedirect from "./pages/LibraryRedirect";
import CompareView from "./pages/CompareView";
import Clients from "./pages/Clients";
import ClientOverview from "./pages/ClientOverview";
import TaxonomyAdmin from "./pages/TaxonomyAdmin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <WorkspaceProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Index />} />
              <Route path="/applications" element={<Applications />} />
              <Route path="/applications/:id" element={<ApplicationDetail />} />
              <Route path="/applications/:appId/library" element={<Library />} />
              <Route path="/applications/:appId/client-overview" element={<ClientOverview />} />
              
              <Route path="/releases/:id" element={<LibraryRedirect kind="release" />} />
              <Route path="/modules/:id" element={<LibraryRedirect kind="module" />} />
              <Route path="/test-cases/:featureId" element={<LibraryRedirect kind="feature" />} />
              <Route path="/test-case/:id" element={<TestCaseEditor />} />
              <Route path="/runs" element={<TestRuns />} />
              <Route path="/runs/new" element={<TestRunSetup />} />
              <Route path="/runs/:id" element={<TestRunDetail />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/taxonomy" element={<TaxonomyAdmin />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/import-export" element={<ImportExport />} />
              <Route path="/execute/clone" element={<CloneRuns />} />
              <Route path="/reports" element={<RunReports />} />
              <Route path="/reports/:id" element={<RunReports />} />
              <Route path="/evidence" element={<Evidence />} />
              <Route path="/processes/:id" element={<LibraryRedirect kind="process" />} />
              <Route path="/labels/:slug" element={<LibraryRedirect kind="label" />} />
            </Route>
            <Route element={<CompareLayout />}>
              <Route path="/applications/:appId/compare" element={<CompareView />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </WorkspaceProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
