import { useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { GitCompare, X, Database, Building2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { applications } from '@/data/mock';
import { CompareModeContext } from './compare-mode-context';

/**
 * Dedicated shell for Compare. Replaces AppLayout entirely so the user
 * feels they've entered a distinct "mode" — no sidebar, no breadcrumbs,
 * one prominent Exit, Esc shortcut, amber-tinted chrome.
 */
export function CompareLayout() {
  const navigate = useNavigate();
  const { appId } = useParams<{ appId: string }>();
  const [searchParams] = useSearchParams();
  const { currentRepo, clientRepos, isMasterRepo } = useWorkspace();

  const app = applications.find(a => a.id === appId);

  const againstParam = searchParams.get('against');
  const compareRepoId = !isMasterRepo
    ? currentRepo
    : (againstParam && clientRepos.some(c => c.id === againstParam))
      ? againstParam
      : (clientRepos[0]?.id ?? 'master');
  const compareRepo = clientRepos.find(c => c.id === compareRepoId);

  // Exit destination — prefer ?from=, else fall back contextually.
  const fromParam = searchParams.get('from');
  const exit = useMemo(() => () => {
    if (fromParam) {
      try { navigate(decodeURIComponent(fromParam)); return; } catch { /* fallthrough */ }
    }
    if (!appId) { navigate('/applications'); return; }
    navigate(isMasterRepo ? `/applications/${appId}/library` : `/applications/${appId}/client-overview`);
  }, [fromParam, appId, isMasterRepo, navigate]);

  // Esc to exit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Don't hijack escape if a dialog/drawer/select is open (Radix uses [data-state="open"]).
        const hasOpenOverlay = document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]'
        );
        if (hasOpenOverlay) return;
        e.preventDefault();
        exit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exit]);

  // Tab title
  useEffect(() => {
    const prev = document.title;
    document.title = `Compare — Master ↔ ${compareRepo?.name ?? 'Client'}`;
    return () => { document.title = prev; };
  }, [compareRepo?.name]);

  // Client picker (admin/master only) — updates URL in place.
  const onChangeAgainst = (v: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('against', v);
    navigate({ search: next.toString() }, { replace: true });
  };

  return (
    <CompareModeContext.Provider value={{ exit, compareRepoId }}>
      <div className="min-h-screen flex flex-col bg-amber-50/40 dark:bg-amber-950/10">
        {/* Compare top bar — the unmistakable "you are in compare mode" chrome */}
        <header className="sticky top-0 z-30 border-b border-amber-500/40 bg-amber-500/15 backdrop-blur supports-[backdrop-filter]:bg-amber-500/15">
          <div className="h-12 flex items-center justify-between px-4 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center gap-1.5 shrink-0">
                <GitCompare className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-300">
                  Compare Mode
                </span>
              </div>
              <span className="h-4 w-px bg-amber-500/40" />
              <div className="flex items-center gap-1.5 text-xs min-w-0">
                <Badge variant="outline" className="text-[10px] gap-1 border-primary/30 bg-background/60 text-primary">
                  <Database className="h-3 w-3" /> Master
                </Badge>
                <span className="text-amber-800 dark:text-amber-300 font-medium">↔</span>
                {isMasterRepo ? (
                  <Select value={compareRepoId} onValueChange={onChangeAgainst}>
                    <SelectTrigger className="h-7 text-xs w-[200px] bg-background/70 border-amber-500/40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {clientRepos.map(c => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 bg-background/60 text-amber-800 dark:text-amber-300">
                    <Building2 className="h-3 w-3" /> {compareRepo?.name ?? '—'}
                  </Badge>
                )}
                {compareRepo && (
                  <span className="text-[10px] text-muted-foreground hidden sm:inline">
                    baseline v{compareRepo.baselineVersion}
                  </span>
                )}
                {app && (
                  <>
                    <span className="text-muted-foreground/60 mx-1">·</span>
                    <span className="text-[11px] text-muted-foreground truncate">{app.name}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="hidden md:inline text-[10px] text-amber-800/70 dark:text-amber-300/70">
                Press <kbd className="px-1 py-0.5 rounded border border-amber-500/40 bg-background/60 font-mono text-[9px]">Esc</kbd> to exit
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-amber-700/40 text-amber-900 dark:text-amber-100 hover:bg-amber-500/20"
                onClick={exit}
              >
                <X className="h-3.5 w-3.5 mr-1" /> Exit Compare
              </Button>
            </div>
          </div>
        </header>

        {/* Canvas — subtle inset ring reinforces "different territory" */}
        <main className="flex-1 overflow-auto">
          <div className="m-3 rounded-lg ring-1 ring-inset ring-amber-500/20 bg-background p-4 shadow-sm">
            <Outlet />
          </div>
        </main>
      </div>
    </CompareModeContext.Provider>
  );
}
