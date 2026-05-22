import { useNavigate } from 'react-router-dom';
import { Database, Building2, ChevronDown, Check, Settings2 } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { cn } from '@/lib/utils';

/**
 * Single source of truth for "which repository am I in?".
 *
 * This product manages the **Master Library** plus per-client **customizations**
 * (the exception path: scripts a client forked, pulled back here for per-client
 * maintenance and republishing). There is no Team Space here — teams belong to
 * the execution environment.
 *
 * Always rendered in the sidebar header on every screen, identical position
 * and shape. Master = neutral; customizations = amber so the exception mode
 * is visually obvious.
 */
export function RepositoryHeader() {
  const { currentRepo, setCurrentRepo, clientRepos, isMasterRepo, activeClient } = useWorkspace();
  const navigate = useNavigate();

  const label = isMasterRepo ? 'Master Library' : `${activeClient?.name ?? '—'} customizations`;
  const Icon = isMasterRepo ? Database : Building2;

  return (
    <div className="space-y-1">
      <div className="text-[9px] uppercase tracking-[0.15em] font-semibold text-muted-foreground px-1">
        Repository
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border-2 transition-colors',
              isMasterRepo
                ? 'border-primary/30 bg-primary/5 text-primary hover:bg-primary/10'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-500/15',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate flex-1 text-left">{label}</span>
            {!isMasterRepo && activeClient && (
              <span className="text-[10px] font-normal opacity-70">v{activeClient.baselineVersion}</span>
            )}
            <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Master
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => setCurrentRepo('master')}
            className="text-xs gap-2"
          >
            <Database className="h-3.5 w-3.5" />
            <span className="flex-1">Master Library</span>
            {currentRepo === 'master' && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>

          {clientRepos.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Client customizations
              </DropdownMenuLabel>
              {clientRepos.map(c => (
                <DropdownMenuItem
                  key={c.id}
                  onClick={() => setCurrentRepo(c.id)}
                  className="text-xs gap-2"
                >
                  <Building2 className="h-3.5 w-3.5" />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-[10px] text-muted-foreground">v{c.baselineVersion}</span>
                  {currentRepo === c.id && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate('/clients')} className="text-xs gap-2">
            <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
            Manage clients…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
