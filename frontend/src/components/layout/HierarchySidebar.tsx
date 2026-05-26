import { useLocation, useNavigate } from 'react-router-dom';
import { AppWindow, Library } from 'lucide-react';
import { cn } from '@/lib/utils';
import { applications } from '@/data/mock';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarHeader, useSidebar,
} from '@/components/ui/sidebar';
import { RepositoryHeader } from './RepositoryHeader';
import { useWorkspace } from '@/contexts/WorkspaceContext';

/**
 * Navigation-only sidebar.
 *
 * Header is always the RepositoryHeader — same component, same position on
 * every screen — so users always see "which repo am I in?" the same way.
 *
 * Product links route to:
 *  - Master  → /library (test-case grid).
 *  - Client  → /client-overview (pending updates, customizations, last-publish).
 */
export function HierarchySidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const navigate = useNavigate();
  const location = useLocation();
  const { isMasterRepo } = useWorkspace();

  const isLibraryRoot = location.pathname === '/applications';
  const isAppActive = (id: string) =>
    location.pathname === `/applications/${id}` ||
    location.pathname.startsWith(`/applications/${id}/`);

  const productHref = (appId: string) =>
    isMasterRepo ? `/applications/${appId}/library` : `/applications/${appId}/client-overview`;

  return (
    <Sidebar collapsible="icon">
      {!collapsed && (
        <SidebarHeader className="px-3 pt-3 pb-1">
          <RepositoryHeader />
        </SidebarHeader>
      )}
      <SidebarContent className="pt-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
            Test Library
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className={cn('h-8 text-xs gap-2 px-3', isLibraryRoot && 'bg-sidebar-accent font-medium')}
                  onClick={() => navigate('/applications')}
                  tooltip="All products"
                >
                  <Library className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">All products</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {applications.map((app) => (
                <SidebarMenuItem key={app.id}>
                  <SidebarMenuButton
                    className={cn(
                      'h-8 text-xs gap-2 pl-6 pr-3',
                      isAppActive(app.id) && 'bg-sidebar-accent font-medium',
                    )}
                    onClick={() => navigate(productHref(app.id))}
                    tooltip={app.name}
                  >
                    <AppWindow className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{app.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Repo switching + "Manage clients…" live in the RepositoryHeader
            dropdown — no duplicate sidebar entry. */}
      </SidebarContent>
    </Sidebar>
  );
}
