import { useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ChevronRight, Plus, Pencil, Trash2,
  Equal, Building2, Database, AlertTriangle, Send, Sparkles, Filter,
} from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  applications, modules, features, processes, labelVocabulary, diffRepo,
} from '@/data/mock';
import type { CaseDiffEntry, DiffStatus, RepoId, TestCase } from '@/types';
import { cn } from '@/lib/utils';
import { CaseDiffDrawer } from '@/components/library/CaseDiffDrawer';
import { PublishToClientsDialog } from '@/components/library/PublishToClientsDialog';

type FilterTab = 'all' | DiffStatus;

const STATUS_META: Record<DiffStatus, {
  label: string;
  short: string;
  tone: string;
  icon: React.ComponentType<{ className?: string }>;
  centerTone: string;
}> = {
  new:       {
    label: 'Added in master', short: '+ Add',
    tone: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    centerTone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    icon: Plus,
  },
  modified:  {
    label: 'Modified by client', short: '✎ Modified',
    tone: 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30',
    centerTone: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    icon: Pencil,
  },
  deleted:   {
    label: 'Deleted in client', short: '− Removed',
    tone: 'text-rose-700 dark:text-rose-400 bg-rose-500/10 border-rose-500/30',
    centerTone: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
    icon: Trash2,
  },
  unchanged: {
    label: 'Same', short: '= Same',
    tone: 'text-muted-foreground bg-secondary/60 border-border',
    centerTone: 'bg-secondary/60 text-muted-foreground',
    icon: Equal,
  },
};

export default function CompareView() {
  const { appId } = useParams<{ appId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentRepo, clientRepos, isMasterRepo, repoVersion } = useWorkspace();

  const app = applications.find(a => a.id === appId);

  // Effective compare target.
  const againstParam = searchParams.get('against') as RepoId | null;
  const compareRepoId: RepoId = !isMasterRepo
    ? currentRepo
    : (againstParam && clientRepos.some(c => c.id === againstParam))
      ? againstParam
      : (clientRepos[0]?.id ?? 'master');
  const compareRepo = clientRepos.find(c => c.id === compareRepoId);

  // Scope filters
  const moduleId = searchParams.get('moduleId') || '';
  const featureId = searchParams.get('featureId') || '';
  const processId = searchParams.get('processId') || '';
  const label = searchParams.get('label') || '';

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key); else next.set(key, value);
    if (key === 'moduleId') next.delete('featureId');
    setSearchParams(next, { replace: true });
  };

  // Build scope predicate (always limit to this application).
  const appModuleIds = useMemo(
    () => new Set(modules.filter(m => m.applicationId === appId).map(m => m.id)),
    [appId],
  );
  const appFeatureIds = useMemo(
    () => new Set(features.filter(f => appModuleIds.has(f.moduleId)).map(f => f.id)),
    [appModuleIds],
  );

  const scopePredicate = useMemo(() => {
    return (tc: TestCase) => {
      if (!appFeatureIds.has(tc.featureId)) return false;
      if (moduleId && tc.moduleId !== moduleId) return false;
      if (featureId && tc.featureId !== featureId) return false;
      if (processId && !(tc.processIds ?? []).includes(processId)) return false;
      if (label && !(tc.labels ?? []).includes(label)) return false;
      return true;
    };
  }, [appFeatureIds, moduleId, featureId, processId, label]);

  const entries = useMemo<CaseDiffEntry[]>(() => {
    if (compareRepoId === 'master') return [];
    return diffRepo(compareRepoId, scopePredicate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareRepoId, scopePredicate, repoVersion]);

  const counts = useMemo(() => {
    const c: Record<DiffStatus, number> = { new: 0, modified: 0, deleted: 0, unchanged: 0 };
    for (const e of entries) c[e.status]++;
    return c;
  }, [entries]);

  const [tab, setTab] = useState<FilterTab>('all');
  const [hideUnchanged, setHideUnchanged] = useState(true);
  const filtered = useMemo(() => {
    let f = entries;
    if (tab !== 'all') f = f.filter(e => e.status === tab);
    if (tab === 'all' && hideUnchanged) f = f.filter(e => e.status !== 'unchanged');
    return f;
  }, [entries, tab, hideUnchanged]);

  const [openEntry, setOpenEntry] = useState<CaseDiffEntry | null>(null);
  const [drawerFocus, setDrawerFocus] = useState<'meta' | 'steps'>('meta');
  const openDrawer = (entry: CaseDiffEntry, focus: 'meta' | 'steps' = 'meta') => {
    setDrawerFocus(focus);
    setOpenEntry(entry);
  };
  const [publishOpen, setPublishOpen] = useState(false);

  if (!app) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Application not found. <Link to="/applications" className="underline">Back to applications</Link>.
      </div>
    );
  }

  const moduleName = moduleId ? modules.find(m => m.id === moduleId)?.name : null;
  const featureName = featureId ? features.find(f => f.id === featureId)?.name : null;
  const processName = processId ? processes.find(p => p.id === processId)?.name : null;
  const hasScopeFilter = !!(moduleId || featureId || processId || label);

  const appModulesDeduped = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const m of modules.filter(m => m.applicationId === appId)) {
      if (!seen.has(m.name)) { seen.add(m.name); out.push({ id: m.id, name: m.name }); }
    }
    return out;
  }, [appId]);

  const moduleFeatures = useMemo(() => {
    if (!moduleId) return [];
    return features.filter(f => f.moduleId === moduleId);
  }, [moduleId]);

  const appProcesses = useMemo(
    () => processes.filter(p => !p.applicationId || p.applicationId === appId),
    [appId],
  );

  return (
    <div className="space-y-3">
      {/* Page-level header removed — CompareLayout's top bar shows mode, identity, exit, and Publish.
          One-line subtitle keeps lightweight context inside the canvas. */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          Reviewing differences between Master and{' '}
          <span className="text-foreground font-medium">{compareRepo?.name ?? '—'}</span>
          {compareRepo && <> · baseline v{compareRepo.baselineVersion}</>}
        </div>
        <Button size="sm" className="text-xs h-8" onClick={() => setPublishOpen(true)}>
          <Send className="h-3.5 w-3.5 mr-1" /> Publish to {compareRepo?.name ?? 'client'}
        </Button>
      </div>

      {/* Summary chips — also act as filter tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <SummaryChip
          label="All"
          value={entries.length}
          active={tab === 'all'}
          onClick={() => setTab('all')}
          tone="bg-card border-border text-foreground"
          icon={Sparkles}
        />
        {(['new', 'modified', 'deleted', 'unchanged'] as DiffStatus[]).map(s => {
          const meta = STATUS_META[s];
          return (
            <SummaryChip
              key={s}
              label={meta.label}
              value={counts[s]}
              active={tab === s}
              onClick={() => setTab(tab === s ? 'all' : s)}
              tone={meta.tone}
              icon={meta.icon}
            />
          );
        })}
      </div>

      {/* Scope picker */}
      <div className="rounded-md border bg-card p-2.5 flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Scope</span>
        <Badge variant="secondary" className="text-[11px]">{app.name}</Badge>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <ScopeSelect
          placeholder="All modules" value={moduleId}
          onChange={(v) => setParam('moduleId', v)}
          options={appModulesDeduped.map(m => ({ value: m.id, label: m.name }))}
        />
        {moduleId && (
          <>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <ScopeSelect
              placeholder="All features" value={featureId}
              onChange={(v) => setParam('featureId', v)}
              options={moduleFeatures.map(f => ({ value: f.id, label: f.name }))}
            />
          </>
        )}
        <span className="mx-1 h-4 w-px bg-border" />
        <ScopeSelect
          placeholder="Any process" value={processId}
          onChange={(v) => setParam('processId', v)}
          options={appProcesses.map(p => ({ value: p.id, label: p.name }))}
        />
        <ScopeSelect
          placeholder="Any label" value={label}
          onChange={(v) => setParam('label', v)}
          options={labelVocabulary.map(l => ({ value: l, label: l }))}
        />
        {hasScopeFilter && (
          <Button
            variant="ghost" size="sm" className="h-7 text-[11px]"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              ['moduleId', 'featureId', 'processId', 'label'].forEach(k => next.delete(k));
              setSearchParams(next, { replace: true });
            }}
          >
            Reset
          </Button>
        )}
        <div className="flex-1" />
        {tab === 'all' && (
          <label className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={hideUnchanged}
              onChange={(e) => setHideUnchanged(e.target.checked)}
              className="h-3 w-3"
            />
            Hide unchanged
          </label>
        )}
      </div>

      {(moduleName || featureName || processName || label) && (
        <div className="text-[11px] text-muted-foreground -mt-1 flex items-center gap-2 flex-wrap">
          <span>
            Showing differences in: {[app.name, moduleName, featureName, processName && `process: ${processName}`, label && `label: ${label}`].filter(Boolean).join(' › ')}
          </span>
          <span className="tabular-nums">
            · <span className="font-medium text-foreground">{filtered.length.toLocaleString()}</span>
            <span className="text-muted-foreground"> / {entries.length.toLocaleString()} cases in scope</span>
          </span>
        </div>
      )}

      {/* Side-by-side grid */}
      <div className="rounded-md border bg-card overflow-hidden">
        {/* Column headers */}
        <div className="grid grid-cols-[1fr_140px_1fr] bg-muted/50 border-b text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
          <div className="px-3 py-2 flex items-center gap-1.5 border-r">
            <Database className="h-3 w-3 text-primary" /> Master
          </div>
          <div className="px-2 py-2 text-center border-r">Status</div>
          <div className="px-3 py-2 flex items-center gap-1.5">
            <Building2 className="h-3 w-3 text-amber-700 dark:text-amber-400" />
            Client: {compareRepo?.name ?? '—'}
          </div>
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            {entries.length === 0
              ? 'No test cases match this scope.'
              : 'No differences in this view. Try toggling “Hide unchanged” or switching status filter.'}
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map(e => (
              <DiffRowSplit
                key={e.rowId}
                entry={e}
                onOpen={() => openDrawer(e, 'meta')}
                onOpenSteps={() => openDrawer(e, 'steps')}
              />
            ))}
          </div>
        )}
      </div>

      <CaseDiffDrawer
        open={!!openEntry}
        onOpenChange={(v) => !v && setOpenEntry(null)}
        entry={openEntry}
        focus={drawerFocus}
        compareRepoId={compareRepoId}
      />
      <PublishToClientsDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        onlyClientId={compareRepoId}
      />
    </div>
  );
}

function SummaryChip({
  label, value, active, onClick, tone, icon: Icon,
}: {
  label: string; value: number; active: boolean; onClick: () => void; tone: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-md border p-2.5 text-left transition-colors',
        active ? tone : 'bg-card hover:bg-secondary/40 border-border',
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-medium">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-0.5">{value}</div>
    </button>
  );
}

function ScopeSelect({
  value, onChange, options, placeholder,
}: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string }) {
  return (
    <Select value={value || '__all__'} onValueChange={(v) => onChange(v === '__all__' ? '' : v)}>
      <SelectTrigger className="h-7 text-xs w-[170px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__" className="text-xs">{placeholder}</SelectItem>
        {options.map(o => (
          <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DiffRowSplit({
  entry, onOpen, onOpenSteps,
}: { entry: CaseDiffEntry; onOpen: () => void; onOpenSteps: () => void }) {
  const meta = STATUS_META[entry.status];
  const Icon = meta.icon;

  // Side display logic — empty side renders a dash placeholder.
  const masterCase = entry.masterCase;
  const clientCase = entry.clientCase;

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const idLink = (label: string) => (
    <button
      type="button"
      onClick={(e) => { stop(e); onOpenSteps(); }}
      className="font-mono text-[11px] w-24 shrink-0 truncate text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid focus:outline-none focus:ring-1 focus:ring-primary/50 rounded text-left"
      aria-label={`Open step diff for ${label}`}
      title="View test step differences"
    >
      {label}
    </button>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="grid grid-cols-[1fr_140px_1fr] w-full text-left hover:bg-secondary/30 transition-colors cursor-pointer"
    >
      {/* Master side */}
      <div className={cn('px-3 py-2 border-r flex items-center gap-2 min-w-0', !masterCase && 'bg-muted/20')}>
        {masterCase ? (
          <>
            {idLink(masterCase.caseNumber)}
            <span className="text-xs truncate">{masterCase.testCaseName}</span>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground italic">— not in master —</span>
        )}
      </div>

      {/* Center status pill */}
      <div className="px-2 py-2 border-r flex items-center justify-center">
        <span className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider',
          meta.centerTone,
        )}>
          <Icon className="h-3 w-3" />
          {meta.short}
        </span>
        {entry.driftFromMaster && (
          <AlertTriangle className="h-3 w-3 text-amber-600 ml-1" aria-label="Master has advanced" />
        )}
      </div>

      {/* Client side */}
      <div className={cn('px-3 py-2 flex items-center gap-2 min-w-0', !clientCase && 'bg-muted/20')}>
        {clientCase ? (
          <>
            {idLink(clientCase.caseNumber)}
            <span className="text-xs truncate">{clientCase.testCaseName}</span>
            {entry.status === 'modified' && (
              <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-500/50 text-amber-700 dark:text-amber-400 ml-1">
                customized
              </Badge>
            )}
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground italic">
            {entry.status === 'deleted' ? '— deleted by client —' : '— not in client —'}
          </span>
        )}
      </div>
    </div>
  );
}

