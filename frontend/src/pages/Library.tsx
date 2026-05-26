import { useMemo, useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  applications, releases, processes, modules, features, testCases as allCases,
  filterCases, resolveCases, type LibraryFilter,
  duplicateCase, softDeleteCase, restoreCase, snapshotCases, restoreSnapshot, bulkSoftDelete,
} from '@/data/mock';
import {
  Download, Upload, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, Archive,
  Link as LinkIcon, Play, PanelRightOpen, PanelRightClose, GitBranch, Tag as TagIcon, Workflow, Hash, Plus,
  GitCompare, Send, MoreHorizontal, Copy, Trash2, RotateCcw, FolderInput, Eye, EyeOff,
} from 'lucide-react';
import { DependencyGraphDialog } from '@/components/shared/DependencyGraphDialog';
import { toast } from '@/hooks/use-toast';
import SelectionPanel from '@/components/shared/SelectionPanel';
import { useSelection } from '@/contexts/SelectionContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import BulkLibraryImportDialog from '@/components/shared/BulkLibraryImportDialog';
import { LibraryFilterBar, type LibraryFilterValue, type FacetKey } from '@/components/library/LibraryFilterBar';
import { NewTestCaseDialog } from '@/components/library/NewTestCaseDialog';
import { PublishToClientsDialog } from '@/components/library/PublishToClientsDialog';
import { RepositorySummaryBanner } from '@/components/library/RepositorySummaryBanner';
import { BulkMoveDialog } from '@/components/library/BulkMoveDialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useCapabilities } from '@/lib/permissions';

const PAGE_SIZE = 25;


function parseList(v: string | null): string[] {
  if (!v) return [];
  return v.split(',').filter(Boolean);
}

const Library = () => {
  const { appId } = useParams<{ appId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selected, panelOpen, setPanelOpen, toggleSelect, toggleAll, removeCase, removeGroup, clearAll, navigateToRun } = useSelection();
  const { currentRepo, isMasterRepo, activeClient, repoVersion, bumpRepoVersion } = useWorkspace();
  const caps = useCapabilities();
  const [page, setPage] = useState(1);
  const [depsOpen, setDepsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);

  const app = applications.find(a => a.id === appId);

  // ---------- Legacy URL rewrite ----------
  // Old Library URLs used groupBy/scopeKind/scopeId. Map them onto the new
  // module=/feature= filter params so deep-links keep working.
  useEffect(() => {
    const groupBy = searchParams.get('groupBy');
    const scopeKind = searchParams.get('scopeKind');
    const scopeId = searchParams.get('scopeId');
    if (!groupBy && !scopeKind && !scopeId) return;
    const next = new URLSearchParams(searchParams);
    next.delete('groupBy'); next.delete('scopeKind'); next.delete('scopeId');
    if (scopeId) {
      if (scopeKind === 'feature')      next.set('feature', scopeId);
      else if (scopeKind === 'module')  next.set('module', scopeId);
      else if (scopeKind === 'process') next.set('process', scopeId);
      else if (scopeKind === 'release') next.set('release', scopeId);
      else if (scopeKind === 'label')   next.set('label', scopeId);
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // ---------- URL → state ----------
  const filter: LibraryFilterValue = useMemo(() => ({
    q: searchParams.get('q') ?? '',
    moduleIds: parseList(searchParams.get('module')),
    featureIds: parseList(searchParams.get('feature')),
    releaseIds: parseList(searchParams.get('release')),
    processIds: parseList(searchParams.get('process')),
    labels: parseList(searchParams.get('label')),
    status: parseList(searchParams.get('status')),
  }), [searchParams]);

  const updateParams = useCallback((patch: Record<string, string | string[] | undefined>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      const str = Array.isArray(v) ? v.join(',') : v;
      if (!str) next.delete(k);
      else next.set(k, str);
    }
    setSearchParams(next, { replace: true });
    setPage(1);
  }, [searchParams, setSearchParams]);

  const onFilterChange = (v: LibraryFilterValue) => {
    updateParams({
      q: v.q || undefined,
      module: v.moduleIds.length ? v.moduleIds : undefined,
      feature: v.featureIds.length ? v.featureIds : undefined,
      release: v.releaseIds.length ? v.releaseIds : undefined,
      process: v.processIds.length ? v.processIds : undefined,
      label: v.labels.length ? v.labels : undefined,
      status: v.status.length ? v.status : undefined,
    });
  };

  // ---------- Filtered data ----------
  const libFilter: LibraryFilter = useMemo(() => ({
    appId,
    q: filter.q,
    moduleIds: filter.moduleIds.length ? filter.moduleIds : undefined,
    featureIds: filter.featureIds.length ? filter.featureIds : undefined,
    releaseIds: filter.releaseIds.length ? filter.releaseIds : undefined,
    processIds: filter.processIds.length ? filter.processIds : undefined,
    labels: filter.labels.length ? filter.labels : undefined,
    status: filter.status.length ? filter.status as LibraryFilter['status'] : undefined,
    includeDeleted: showDeleted,
  }), [appId, filter, showDeleted]);

  const repoCases = useMemo(() => resolveCases(currentRepo), [currentRepo, repoVersion]);
  const filtered = useMemo(() => filterCases(repoCases, libFilter), [repoCases, libFilter]);

  // App-restricted release/process options for the filter bar
  const appReleaseIds = useMemo(() => releases.filter(r => r.applicationId === appId).map(r => r.id), [appId]);
  const appProcessIds = useMemo(() => processes.filter(p => !p.applicationId || p.applicationId === appId).map(p => p.id), [appId]);

  // Faceted-search counts: how many cases would match if THIS option were the
  // sole value of its facet, combined with all OTHER active facets.
  const getFacetCount = useCallback((facet: FacetKey, id: string): number => {
    const trial: LibraryFilter = { ...libFilter };
    switch (facet) {
      case 'moduleIds':  trial.moduleIds = [id]; trial.featureIds = undefined; break;
      case 'featureIds': trial.featureIds = [id]; break;
      case 'releaseIds': trial.releaseIds = [id]; break;
      case 'processIds': trial.processIds = [id]; break;
      case 'labels':     trial.labels = [id]; break;
      case 'status':     trial.status = [id] as LibraryFilter['status']; break;
    }
    return filterCases(repoCases, trial).length;
  }, [repoCases, libFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ---------- Selection helpers ----------
  const handleToggleAll = () => toggleAll(filtered.map(tc => tc.id));
  const allFilteredSelected = filtered.length > 0 && filtered.every(tc => selected.has(tc.id));
  const selectionGroups = useMemo(() => {
    const ids = new Set(Array.from(selected).map(id => allCases.find(c => c.id === id)?.featureId).filter(Boolean));
    return features.filter(f => ids.has(f.id)).map(f => ({ id: f.id, name: f.name }));
  }, [selected]);
  const getGroupId = useCallback((tc: { featureId: string }) => tc.featureId, []);
  const handleRemoveGroup = useCallback((featureId: string) => {
    removeGroup(allCases.filter(tc => tc.featureId === featureId).map(tc => tc.id));
  }, [removeGroup]);

  // Compact summary of all active facets (single source of truth = filter bar).
  const summaryParts = useMemo(() => {
    const parts: string[] = [];
    if (filter.moduleIds.length === 1)
      parts.push(modules.find(m => m.id === filter.moduleIds[0])?.name ?? '1 module');
    else if (filter.moduleIds.length > 1) parts.push(`${filter.moduleIds.length} modules`);

    if (filter.featureIds.length === 1)
      parts.push(features.find(f => f.id === filter.featureIds[0])?.name ?? '1 feature');
    else if (filter.featureIds.length > 1) parts.push(`${filter.featureIds.length} features`);

    if (filter.releaseIds.length === 1)
      parts.push(releases.find(r => r.id === filter.releaseIds[0])?.name ?? '1 release');
    else if (filter.releaseIds.length > 1) parts.push(`${filter.releaseIds.length} releases`);

    if (filter.processIds.length === 1)
      parts.push(processes.find(p => p.id === filter.processIds[0])?.name ?? '1 process');
    else if (filter.processIds.length > 1) parts.push(`${filter.processIds.length} processes`);

    if (filter.labels.length === 1) parts.push(`#${filter.labels[0]}`);
    else if (filter.labels.length > 1) parts.push(`${filter.labels.length} labels`);

    if (filter.status.length) parts.push(`${filter.status.length} status`);
    if (filter.q.trim()) parts.push(`“${filter.q.trim()}”`);
    return parts;
  }, [filter]);

  const handleExport = () => {
    const headers = ['Case #', 'Test Case Name', 'Role', 'Type', 'Status'];
    const rows = filtered.map(tc => [tc.caseNumber, tc.testCaseName, tc.role, tc.type, tc.status]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${app?.name ?? 'library'}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Exported', description: `${filtered.length} test cases exported.` });
  };

  // ---------- Row-level + bulk mutations (Master only) ----------
  const handleDuplicate = (id: string) => {
    const copy = duplicateCase(id);
    if (!copy) return;
    bumpRepoVersion();
    toast({ title: 'Duplicated', description: copy.caseNumber });
  };
  const handleSoftDelete = (id: string) => {
    const token = snapshotCases([id]);
    if (!softDeleteCase(id)) return;
    bumpRepoVersion();
    toast({
      title: 'Test case deleted',
      description: 'It is hidden but recoverable.',
      action: (
        <button
          onClick={() => { restoreSnapshot(token); restoreCase(id); bumpRepoVersion(); toast({ title: 'Restored' }); }}
          className="text-xs underline hover:no-underline"
        >Undo</button>
      ),
    });
  };
  const handleRestore = (id: string) => {
    if (!restoreCase(id)) return;
    bumpRepoVersion();
    toast({ title: 'Restored' });
  };
  const handleBulkDelete = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const token = snapshotCases(ids);
    const n = bulkSoftDelete(ids);
    bumpRepoVersion();
    clearAll();
    toast({
      title: `${n} test case${n === 1 ? '' : 's'} deleted`,
      description: 'They are hidden but recoverable.',
      action: (
        <button
          onClick={() => { restoreSnapshot(token); ids.forEach(restoreCase); bumpRepoVersion(); toast({ title: 'Restored' }); }}
          className="text-xs underline hover:no-underline"
        >Undo</button>
      ),
    });
  };

  if (!app) return <div className="text-sm text-muted-foreground">Product not found</div>;

  const hasActiveFilter =
    !!filter.q.trim() || filter.moduleIds.length > 0 || filter.featureIds.length > 0 ||
    filter.releaseIds.length > 0 || filter.processIds.length > 0 ||
    filter.labels.length > 0 || filter.status.length > 0;
  const clearAllFilters = () => onFilterChange({
    q: '', moduleIds: [], featureIds: [], releaseIds: [], processIds: [], labels: [], status: [],
  });

  return (
    <div className="space-y-3">
      {/* Header — title + page-level actions only. The live "what am I looking at"
          summary lives in the banner directly above the table, where it sits
          right next to the filter controls that drive it. */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Test Library — {app.name}</h1>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setDepsOpen(true)}>
            <GitBranch className="h-3.5 w-3.5 mr-1" /> Dependencies
          </Button>
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={navigateToRun}>
            <Play className="h-3.5 w-3.5 mr-1" /> {selected.size > 0 ? `Run Selected (${selected.size})` : 'Run Tests'}
          </Button>
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={handleExport}>
            <Download className="h-3.5 w-3.5 mr-1" /> Export
          </Button>
          {isMasterRepo ? (
            <>
              {selected.size > 0 && caps.canEditCase && (
                <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setBulkMoveOpen(true)}>
                  <FolderInput className="h-3.5 w-3.5 mr-1" /> Move / Tag ({selected.size})
                </Button>
              )}
              {selected.size > 0 && caps.canDeleteCase && (
                <Button size="sm" variant="outline" className="text-xs h-8 text-rose-600 hover:text-rose-700" onClick={handleBulkDelete}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete ({selected.size})
                </Button>
              )}
              <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setShowDeleted(v => !v)} title={showDeleted ? 'Hide deleted' : 'Show deleted'}>
                {showDeleted ? <EyeOff className="h-3.5 w-3.5 mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                {showDeleted ? 'Hide deleted' : 'Show deleted'}
              </Button>
              {caps.canEditCase && (
                <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setImportOpen(true)}>
                  <Upload className="h-3.5 w-3.5 mr-1" /> Import
                </Button>
              )}
              {caps.canPublish && (
                <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setPublishOpen(true)}>
                  <Send className="h-3.5 w-3.5 mr-1" /> Publish to clients
                </Button>
              )}
              {caps.canEditCase && (
                <Button size="sm" className="text-xs h-8" onClick={() => setNewCaseOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> New test case
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => {
              const from = encodeURIComponent(window.location.pathname + window.location.search);
              navigate(`/applications/${app.id}/compare?from=${from}`);
            }}>
              <GitCompare className="h-3.5 w-3.5 mr-1" /> Compare to Master
            </Button>
          )}
        </div>
      </div>

      {/* Filter bar — single source of truth for narrowing the library. */}
      <LibraryFilterBar
        value={filter}
        onChange={onFilterChange}
        appId={app.id}
        appReleaseIds={appReleaseIds}
        appProcessIds={appProcessIds}
        getFacetCount={getFacetCount}
        rightSlot={selected.size > 0 ? (
          <Button variant="outline" size="sm" className="text-xs h-8" onClick={() => setPanelOpen(!panelOpen)}>
            {panelOpen ? <PanelRightClose className="h-3.5 w-3.5 mr-1" /> : <PanelRightOpen className="h-3.5 w-3.5 mr-1" />}
            {panelOpen ? 'Hide selection' : `Show selection (${selected.size})`}
          </Button>
        ) : undefined}
      />

      {/* Live "what am I looking at" — sits directly above the table so the
          filtered/total counts respond as the user adjusts the filter bar. */}
      <RepositorySummaryBanner
        app={app}
        filteredCases={filtered}
        hasActiveFilter={hasActiveFilter}
        activeFilterChips={summaryParts}
        onClearFilters={clearAllFilters}
        onPublish={() => setPublishOpen(true)}
      />

      {/* Results */}
      <div className={`grid gap-3 ${panelOpen && selected.size > 0 ? 'grid-cols-[1fr_340px]' : 'grid-cols-[1fr]'}`}>

        <div className="border rounded-lg overflow-hidden min-w-0 bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-10 px-3">
                  <Checkbox checked={allFilteredSelected} onCheckedChange={handleToggleAll} />
                </TableHead>
                <TableHead className="text-xs w-28">Case #</TableHead>
                <TableHead className="text-xs">Test Case Name</TableHead>
                <TableHead className="text-xs w-24">Dependency</TableHead>
                <TableHead className="text-xs w-24">Role</TableHead>
                <TableHead className="text-xs w-24">Type</TableHead>
                <TableHead className="text-xs min-w-[180px]">Tags</TableHead>
                <TableHead className="w-10 px-1" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((tc) => (
                <TableRow
                  key={tc.id}
                  className={`cursor-pointer hover:bg-secondary/50 ${tc.deletedAt ? 'opacity-60' : ''}`}
                  onClick={() => navigate(`/test-case/${tc.id}`)}
                >
                  <TableCell className="px-3" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected.has(tc.id)} onCheckedChange={() => toggleSelect(tc.id)} />
                  </TableCell>
                  <TableCell className="text-xs font-medium text-primary">
                    <div className="flex items-center gap-1.5">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex-shrink-0">
                              {tc.status === 'valid' ? <CircleCheck className="h-3.5 w-3.5 text-status-pass" /> :
                               tc.status === 'draft' ? <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" /> :
                               <Archive className="h-3.5 w-3.5 text-muted-foreground/60" />}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent><p className="text-xs">{tc.status.charAt(0).toUpperCase() + tc.status.slice(1)}</p></TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {tc.caseNumber}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs font-medium">
                    <div className="flex items-center gap-1.5">
                      <span className={tc.deletedAt ? 'line-through text-muted-foreground' : ''}>{tc.testCaseName}</span>
                      {tc.deletedAt && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1 border-rose-500/50 text-rose-700 dark:text-rose-400">Deleted</Badge>
                      )}
                      {!isMasterRepo && !tc.deletedAt && (() => {
                        const isClientOnly = tc.id.startsWith('tc-globex-new-') || (tc.id.includes('__') === false && !allCases.some(c => c.id === tc.id));
                        const isModified = tc.id.includes('__') && tc.id.endsWith(currentRepo);
                        if (isClientOnly) return <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-500/50 text-amber-700 dark:text-amber-400">Client-only</Badge>;
                        if (isModified) return <Badge variant="outline" className="text-[9px] h-4 px-1 border-blue-500/50 text-blue-600 dark:text-blue-400">Modified</Badge>;
                        return null;
                      })()}
                    </div>
                  </TableCell>
                  <TableCell>
                    {tc.dependency ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/test-case/${allCases.find(c => c.caseNumber === tc.dependency)?.id || ''}`); }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted hover:bg-muted/80 text-primary transition-colors"
                      >
                        <LinkIcon className="h-2.5 w-2.5" /> {tc.dependency}
                      </button>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs">{tc.role}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {tc.type.charAt(0).toUpperCase() + tc.type.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap items-center gap-1">
                      {(tc.releaseIds ?? [tc.releaseId]).map(rid => {
                        const r = releases.find(rel => rel.id === rid);
                        if (!r) return null;
                        const active = filter.releaseIds.includes(rid);
                        return (
                          <button
                            key={`r-${rid}`}
                            onClick={() => onFilterChange({
                              ...filter,
                              releaseIds: active ? filter.releaseIds.filter(x => x !== rid) : [...filter.releaseIds, rid],
                            })}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary hover:bg-primary/20"
                            title={`Filter by release: ${r.name}`}
                          >
                            <TagIcon className="h-2.5 w-2.5" />{r.version}
                          </button>
                        );
                      })}
                      {tc.processIds?.map(pid => {
                        const p = processes.find(pr => pr.id === pid);
                        if (!p) return null;
                        const active = filter.processIds.includes(pid);
                        return (
                          <button
                            key={`p-${pid}`}
                            onClick={() => onFilterChange({
                              ...filter,
                              processIds: active ? filter.processIds.filter(x => x !== pid) : [...filter.processIds, pid],
                            })}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-accent text-accent-foreground hover:opacity-80"
                            title={`Filter by process: ${p.name}`}
                          >
                            <Workflow className="h-2.5 w-2.5" />{p.name}
                          </button>
                        );
                      })}
                      {tc.labels?.map(l => {
                        const active = filter.labels.includes(l);
                        return (
                          <button
                            key={`l-${l}`}
                            onClick={() => onFilterChange({
                              ...filter,
                              labels: active ? filter.labels.filter(x => x !== l) : [...filter.labels, l],
                            })}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground hover:bg-muted/70"
                            title={`Filter by label: ${l}`}
                          >
                            <Hash className="h-2.5 w-2.5" />{l}
                          </button>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell className="px-1" onClick={(e) => e.stopPropagation()}>
                    {isMasterRepo && (caps.canEditCase || caps.canDeleteCase) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="text-xs">
                          <DropdownMenuItem onClick={() => navigate(`/test-case/${tc.id}`)}>Open</DropdownMenuItem>
                          {caps.canEditCase && !tc.deletedAt && (
                            <DropdownMenuItem onClick={() => handleDuplicate(tc.id)}>
                              <Copy className="h-3 w-3 mr-2" /> Duplicate
                            </DropdownMenuItem>
                          )}
                          {caps.canDeleteCase && !tc.deletedAt && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={() => handleSoftDelete(tc.id)}>
                                <Trash2 className="h-3 w-3 mr-2" /> Delete
                              </DropdownMenuItem>
                            </>
                          )}
                          {caps.canDeleteCase && tc.deletedAt && (
                            <DropdownMenuItem onClick={() => handleRestore(tc.id)}>
                              <RotateCcw className="h-3 w-3 mr-2" /> Restore
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-12">
                    No test cases match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground bg-muted/30 flex items-center justify-between">
            <span>{selected.size > 0 ? `${selected.size} selected · ` : ''}Showing {filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={safePage <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground px-2">Page {safePage} of {totalPages}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={safePage >= totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {panelOpen && selected.size > 0 && (
          <div className="h-[calc(100vh-260px)] sticky top-4">
            <SelectionPanel
              selected={selected}
              allCases={allCases}
              groups={selectionGroups}
              getGroupId={getGroupId}
              onRemove={removeCase}
              onRemoveGroup={handleRemoveGroup}
              onClearAll={clearAll}
              onBulkMove={isMasterRepo ? () => setBulkMoveOpen(true) : undefined}
            />
          </div>
        )}
      </div>

      <DependencyGraphDialog
        open={depsOpen}
        onOpenChange={setDepsOpen}
        caseIds={selected.size > 0 ? Array.from(selected) : filtered.map(c => c.id)}
      />
      <BulkLibraryImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        scope={{ type: 'application', id: app.id, name: app.name }}
      />
      <NewTestCaseDialog
        open={newCaseOpen}
        onOpenChange={setNewCaseOpen}
        appId={app.id}
        prefill={{
          moduleId: filter.moduleIds.length === 1 ? filter.moduleIds[0] : undefined,
          featureId: filter.featureIds.length === 1 ? filter.featureIds[0] : undefined,
          releaseIds: filter.releaseIds.length ? filter.releaseIds : undefined,
          processIds: filter.processIds.length ? filter.processIds : undefined,
          labels: filter.labels.length ? filter.labels : undefined,
        }}
      />
      <PublishToClientsDialog open={publishOpen} onOpenChange={setPublishOpen} />
      <BulkMoveDialog
        open={bulkMoveOpen}
        onOpenChange={setBulkMoveOpen}
        appId={app.id}
        caseIds={Array.from(selected)}
      />
    </div>
  );
};

export default Library;
