import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Database, Building2, Send, GitCompare, ChevronUp, ChevronDown,
  CircleCheck, CircleDashed, Archive, Pencil, Sparkles, X, Filter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  resolveCases, modules as allModules, clientOverrides, clientTombstones,
} from '@/data/mock';
import { previewPublish, listPublishHistory } from '@/lib/customizationApi';
import type { PublishPreview, PublishRecord, Application, TestCase } from '@/types';

const STORAGE_KEY = 'lovable.libraryBanner.collapsed';

interface Props {
  app: Application;
  /** Full filtered case list for the current view (drives the live stat tiles). */
  filteredCases: TestCase[];
  hasActiveFilter: boolean;
  /** Human-readable chips describing the active filters (e.g. ["Login", "v2.4.1"]). */
  activeFilterChips?: string[];
  onClearFilters: () => void;
  onPublish: () => void;
}

/**
 * Live "what am I looking at?" banner that sits directly above the test-case
 * grid. Every stat tile shows {filtered}/{total} so the impact of the active
 * filters is always visible at a glance. Master = neutral; Client = amber.
 */
export function RepositorySummaryBanner({
  app, filteredCases, hasActiveFilter, activeFilterChips = [],
  onClearFilters, onPublish,
}: Props) {
  const navigate = useNavigate();
  const { currentRepo, isMasterRepo, activeClient, repoVersion } = useWorkspace();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  });
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  // ---------- App-scoped repo cases (the "total" denominator) ----------
  const appModuleIds = useMemo(
    () => new Set(allModules.filter(m => m.applicationId === app.id).map(m => m.id)),
    [app.id],
  );
  const repoCases = useMemo(
    () => resolveCases(currentRepo).filter(tc => appModuleIds.has(tc.moduleId)),
    [currentRepo, repoVersion, appModuleIds],
  );

  // ---------- Master stats (filtered + total) ----------
  const masterStats = useMemo(() => {
    if (!isMasterRepo) return null;
    return {
      total:    { all: repoCases.length,                                            cur: filteredCases.length },
      valid:    { all: repoCases.filter(c => c.status === 'valid').length,          cur: filteredCases.filter(c => c.status === 'valid').length },
      draft:    { all: repoCases.filter(c => c.status === 'draft').length,          cur: filteredCases.filter(c => c.status === 'draft').length },
      archived: { all: repoCases.filter(c => c.status === 'archived').length,       cur: filteredCases.filter(c => c.status === 'archived').length },
    };
  }, [isMasterRepo, repoCases, filteredCases]);

  // ---------- Client publish preview / history ----------
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [history, setHistory] = useState<PublishRecord[]>([]);
  useEffect(() => {
    if (isMasterRepo || !activeClient) { setPreview(null); setHistory([]); return; }
    let cancelled = false;
    (async () => {
      const [p, h] = await Promise.all([
        previewPublish(activeClient.id),
        listPublishHistory(activeClient.id),
      ]);
      if (!cancelled) { setPreview(p); setHistory(h); }
    })();
    return () => { cancelled = true; };
  }, [isMasterRepo, activeClient, repoVersion]);

  // ---------- Client stats (filtered + total) ----------
  const clientStats = useMemo(() => {
    if (isMasterRepo || !activeClient) return null;
    const overrides = (clientOverrides[activeClient.id] ?? []).filter(o => appModuleIds.has(o.testCase.moduleId));
    const tombstones = clientTombstones[activeClient.id] ?? [];
    const overrideIds = new Set(overrides.map(o => o.testCase.id));

    // Heuristics for "is this case currently visible after filters" by category.
    const filteredIds = new Set(filteredCases.map(c => c.id));
    const customizationsCur = overrides.filter(o => filteredIds.has(o.testCase.id)).length;
    // Tombstones are deletions — they aren't in resolveCases, so "filtered" means
    // the user hasn't narrowed in a way that hides everything: keep showing total
    // when no filter is set, otherwise show the tombstones whose case still exists
    // in master with a matching module filter (best-effort proxy: when filters
    // active but no module filter, show all; when module-filtered, intersect).
    const totalPending = (preview?.added.length ?? 0) + (preview?.removed.length ?? 0);

    return {
      total:          { all: repoCases.length, cur: filteredCases.length },
      customizations: { all: overrides.length, cur: customizationsCur },
      deletions:      { all: tombstones.length, cur: tombstones.length /* not filterable client-side here */ },
      pending:        { all: totalPending, cur: totalPending },
      hasOverrideInFilter: filteredCases.some(c => overrideIds.has(c.id)),
    };
  }, [isMasterRepo, activeClient, appModuleIds, repoCases, filteredCases, preview]);

  const lastPublishAt = history[0]?.at ?? null;

  // ---------- Render helpers ----------
  const tone = isMasterRepo
    ? 'border-primary/25 bg-primary/[0.04]'
    : 'border-amber-500/40 bg-amber-500/[0.06]';
  const Icon = isMasterRepo ? Database : Building2;
  const labelText = isMasterRepo
    ? 'Master Library'
    : `${activeClient?.name ?? '—'} customizations`;
  const labelTone = isMasterRepo ? 'text-primary' : 'text-amber-700 dark:text-amber-400';

  const liveCountLabel = isMasterRepo ? masterStats : clientStats;
  const headlineCount = liveCountLabel
    ? hasActiveFilter
      ? `${liveCountLabel.total.cur.toLocaleString()} / ${liveCountLabel.total.all.toLocaleString()} cases`
      : `${liveCountLabel.total.all.toLocaleString()} cases`
    : '';

  const sentence = isMasterRepo
    ? `Authoritative test scripts for ${app.name}. Changes here flow to clients via Publish.`
    : `Per-client overrides for ${app.name}. Baseline v${activeClient?.baselineVersion ?? '—'} · last published ${lastPublishAt ? formatRelative(lastPublishAt) : 'never'}.`;

  const PrimaryAction = isMasterRepo ? (
    <Button size="sm" className="text-xs h-8" onClick={onPublish}>
      <Send className="h-3.5 w-3.5 mr-1" /> Publish to clients
    </Button>
  ) : (
    <Button
      size="sm"
      className="text-xs h-8"
      variant={clientStats && clientStats.pending.all > 0 ? 'default' : 'outline'}
      onClick={() => {
        const from = encodeURIComponent(window.location.pathname + window.location.search);
        navigate(`/applications/${app.id}/compare?from=${from}`);
      }}
    >
      <GitCompare className="h-3.5 w-3.5 mr-1" /> Compare to Master
    </Button>
  );

  return (
    <section className={cn('rounded-lg border', tone)}>
      {/* Top row — identity + live count + collapse + primary action */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Icon className={cn('h-4 w-4 shrink-0', labelTone)} />
        <div className="flex items-baseline gap-2 min-w-0 flex-1 flex-wrap">
          <span className={cn('text-sm font-semibold', labelTone)}>{labelText}</span>
          <span className="text-muted-foreground text-xs">·</span>
          <span className="text-sm font-medium truncate">{app.name}</span>
          <span className="text-muted-foreground text-xs">·</span>
          <span className="text-sm tabular-nums">
            {hasActiveFilter && liveCountLabel ? (
              <>
                <span className="font-semibold text-foreground">{liveCountLabel.total.cur.toLocaleString()}</span>
                <span className="text-muted-foreground"> / {liveCountLabel.total.all.toLocaleString()} cases</span>
              </>
            ) : (
              <span className="font-medium text-foreground">{headlineCount}</span>
            )}
          </span>
          {hasActiveFilter && (
            <Badge variant="outline" className="text-[10px] h-4 px-1 border-primary/40 text-primary">
              <Filter className="h-2.5 w-2.5 mr-0.5" /> filtered
            </Badge>
          )}
          {!isMasterRepo && clientStats && clientStats.pending.all > 0 && (
            <Badge variant="outline" className="text-[10px] h-4 px-1 border-amber-500/50 text-amber-700 dark:text-amber-400">
              {clientStats.pending.all} pending
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {PrimaryAction}
          <Button
            size="sm" variant="ghost"
            className="h-8 w-8 p-0 text-muted-foreground"
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand summary' : 'Collapse summary'}
          >
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="px-4 pb-2 -mt-1 text-[12px] text-muted-foreground">
            {sentence}
          </div>

          {/* Stats row — every tile shows filtered / total when a filter is active */}
          <div className="px-4 pb-3">
            {isMasterRepo && masterStats && (
              <div className="grid grid-cols-4 gap-2">
                <FilterAwareStat label="Total cases"  cur={masterStats.total.cur}    all={masterStats.total.all}    active={hasActiveFilter} tone="default" />
                <FilterAwareStat label="Valid"        cur={masterStats.valid.cur}    all={masterStats.valid.all}    active={hasActiveFilter} tone="success" icon={CircleCheck} />
                <FilterAwareStat label="Draft"        cur={masterStats.draft.cur}    all={masterStats.draft.all}    active={hasActiveFilter} tone="muted"   icon={CircleDashed} />
                <FilterAwareStat label="Archived"     cur={masterStats.archived.cur} all={masterStats.archived.all} active={hasActiveFilter} tone="muted"   icon={Archive} />
              </div>
            )}
            {!isMasterRepo && clientStats && (
              <div className="grid grid-cols-4 gap-2">
                <FilterAwareStat label="Total cases"        cur={clientStats.total.cur}          all={clientStats.total.all}          active={hasActiveFilter} tone="default" />
                <FilterAwareStat label="Customizations"     cur={clientStats.customizations.cur} all={clientStats.customizations.all} active={hasActiveFilter} tone={clientStats.customizations.all > 0 ? 'info' : 'muted'} icon={Pencil} />
                <FilterAwareStat label="Deletions"          cur={clientStats.deletions.cur}      all={clientStats.deletions.all}      active={false}           tone={clientStats.deletions.all > 0 ? 'warn' : 'muted'} icon={Archive} />
                <FilterAwareStat label="Pending from master" cur={clientStats.pending.cur}       all={clientStats.pending.all}        active={false}           tone={clientStats.pending.all > 0 ? 'warn' : 'muted'}   icon={Sparkles}
                  hint={lastPublishAt ? `last published ${formatRelative(lastPublishAt)}` : 'never published'} />
              </div>
            )}
          </div>
        </>
      )}

      {/* Active filters strip — visible whether expanded or collapsed */}
      {hasActiveFilter && (
        <div className="border-t border-current/10 px-4 py-1.5 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1 shrink-0">
            <Filter className="h-3 w-3" /> Filtered by
          </span>
          {activeFilterChips.length > 0 ? (
            activeFilterChips.map((chip, i) => (
              <span
                key={`${chip}-${i}`}
                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] bg-secondary text-secondary-foreground border"
              >
                {chip}
              </span>
            ))
          ) : (
            <span className="italic">active filters</span>
          )}
          <button
            className="ml-auto inline-flex items-center gap-1 text-primary hover:underline shrink-0"
            onClick={onClearFilters}
          >
            <X className="h-3 w-3" /> Clear all
          </button>
        </div>
      )}
    </section>
  );
}

function FilterAwareStat({
  label, cur, all, active, hint, tone = 'default', icon: Icon,
}: {
  label: string;
  cur: number;
  all: number;
  active: boolean;
  hint?: string;
  tone?: 'default' | 'success' | 'info' | 'warn' | 'muted';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const valueCls =
    tone === 'success' ? 'text-status-pass' :
    tone === 'info'    ? 'text-blue-700 dark:text-blue-400' :
    tone === 'warn'    ? 'text-amber-700 dark:text-amber-400' :
    tone === 'muted'   ? 'text-muted-foreground' :
    'text-foreground';
  // Highlight tile when filter visibly reduced the value below the total.
  const reduced = active && cur !== all;
  return (
    <div className={cn(
      'rounded-md border bg-card/60 px-2.5 py-1.5 transition-colors',
      reduced && 'border-primary/40 bg-primary/[0.04]',
    )}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className={cn('text-base font-semibold leading-tight tabular-nums', valueCls)}>
          {cur.toLocaleString()}
        </span>
        {active && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            / {all.toLocaleString()}
          </span>
        )}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
    </div>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
