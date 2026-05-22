import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { HierarchySidebar } from './HierarchySidebar';
import { AppBreadcrumbs } from './AppBreadcrumbs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Settings, Play, PanelRightOpen, PanelRightClose, X, Building2, GitCompare } from 'lucide-react';
import { GlobalSearch } from './GlobalSearch';
import { SelectionProvider, useSelection } from '@/contexts/SelectionContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { applications } from '@/data/mock';

function HeaderSelectionActions() {
  const { selected, panelOpen, setPanelOpen, clearAll, navigateToRun } = useSelection();

  if (selected.size === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary" className="text-xs font-medium">
        {selected.size} case{selected.size !== 1 ? 's' : ''}
      </Badge>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={() => setPanelOpen(!panelOpen)}
      >
        {panelOpen ? <PanelRightClose className="h-3.5 w-3.5 mr-1" /> : <PanelRightOpen className="h-3.5 w-3.5 mr-1" />}
        {panelOpen ? 'Hide' : 'Show'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={clearAll}
      >
        <X className="h-3.5 w-3.5 mr-1" /> Clear
      </Button>
      <Button size="sm" className="h-7 text-xs" onClick={navigateToRun}>
        <Play className="h-3 w-3 mr-1" /> Run Selected
      </Button>
    </div>
  );
}

function ClientRepoBanner() {
  const { isMasterRepo, activeClient } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  if (isMasterRepo || !activeClient) return null;

  const appId = (params as { appId?: string; id?: string }).appId
    ?? (params as { appId?: string; id?: string }).id
    ?? applications[0]?.id;

  // Hide where the surrounding page already explains the relationship.
  const path = location.pathname;
  const hidden = path.includes('/compare') || path.includes('/client-overview');
  if (hidden) return null;

  return (
    <div className="flex items-center justify-between border-b border-amber-500/40 bg-amber-500/10 px-4 py-1 text-[11px]">
      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
        <Building2 className="h-3 w-3" />
        <span>Editing per-client customizations for {activeClient.name}. Publish updates separately to this client.</span>
      </div>
      {appId && (
        <Button
          size="sm" variant="ghost"
          className="h-6 px-2 text-[11px] text-amber-800 dark:text-amber-300 hover:bg-amber-500/20"
          onClick={() => {
            const from = encodeURIComponent(location.pathname + location.search);
            navigate(`/applications/${appId}/compare?from=${from}`);
          }}
        >
          <GitCompare className="h-3 w-3 mr-1" /> Compare to Master
        </Button>
      )}
    </div>
  );
}

export function AppLayout() {
  return (
    <SidebarProvider>
      <SelectionProvider>
        <div className="min-h-screen flex w-full">
          <HierarchySidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <header className="h-12 flex items-center justify-between border-b px-4 bg-background shrink-0">
              <div className="flex items-center gap-3">
                <SidebarTrigger />
                <GlobalSearch />
              </div>
              <div className="flex items-center gap-2">
                <HeaderSelectionActions />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link to="/settings" className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                      <Settings className="h-4 w-4" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>Settings</TooltipContent>
                </Tooltip>
              </div>
            </header>
            <ClientRepoBanner />
            <nav className="h-10 flex items-center px-4 border-b bg-background shrink-0">
              <AppBreadcrumbs />
            </nav>
            <main className="flex-1 overflow-auto p-6">
              <Outlet />
            </main>
          </div>
        </div>
      </SelectionProvider>
    </SidebarProvider>
  );
}
