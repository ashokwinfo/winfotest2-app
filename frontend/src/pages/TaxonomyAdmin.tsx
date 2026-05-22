import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Pencil, Trash2, RotateCcw, GitMerge, Layers, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCapabilities } from '@/lib/permissions';
import {
  applications, modules, features, releases, processes, labelVocabulary,
  renameEntity, softDeleteEntity, restoreEntity, mergeEntity, getEntityUsage,
  renameLabel, softDeleteLabel, restoreLabel, getLabelUsage, deletedLabels,
  type TaxonomyKind,
} from '@/data/mock';

type AnyEntity = { id: string; name: string; deletedAt?: string };

interface DangerState {
  kind: TaxonomyKind;
  entity: AnyEntity;
  active: number;
  reassignTo?: string;
}

export default function TaxonomyAdmin() {
  const navigate = useNavigate();
  const { bumpRepoVersion, isMasterRepo } = useWorkspace();
  const caps = useCapabilities();
  const [tab, setTab] = useState<'modules' | 'features' | 'releases' | 'processes' | 'labels'>('modules');
  const [appId, setAppId] = useState(applications[0]?.id ?? '');
  const [showDeleted, setShowDeleted] = useState(false);
  const [renaming, setRenaming] = useState<{ kind: TaxonomyKind; id: string; current: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [merging, setMerging] = useState<{ kind: TaxonomyKind; from: AnyEntity } | null>(null);
  const [mergeInto, setMergeInto] = useState('');
  const [danger, setDanger] = useState<DangerState | null>(null);

  if (!isMasterRepo) {
    return (
      <div className="text-sm text-muted-foreground p-6">
        Taxonomy is managed in the Master Library only.
      </div>
    );
  }

  if (!caps.canManageTaxonomy) {
    return (
      <div className="flex items-start gap-3 p-6 border rounded-md max-w-xl">
        <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5" />
        <div className="text-sm">
          <div className="font-medium">You don't have permission to manage taxonomy.</div>
          <div className="text-muted-foreground text-xs mt-1">
            Owners and Contributors can rename, merge, or retire modules, features, releases, processes, and labels.
          </div>
        </div>
      </div>
    );
  }

  const appModules = useMemo(
    () => modules.filter(m => m.applicationId === appId && (showDeleted || !m.deletedAt)),
    [appId, showDeleted],
  );
  const appFeatures = useMemo(() => {
    const ids = new Set(modules.filter(m => m.applicationId === appId).map(m => m.id));
    return features.filter(f => ids.has(f.moduleId) && (showDeleted || !f.deletedAt));
  }, [appId, showDeleted]);
  const appReleases = useMemo(
    () => releases.filter(r => r.applicationId === appId && (showDeleted || !r.deletedAt)),
    [appId, showDeleted],
  );
  const appProcesses = useMemo(
    () => processes.filter(p => (!p.applicationId || p.applicationId === appId) && (showDeleted || !p.deletedAt)),
    [appId, showDeleted],
  );

  const startRename = (kind: TaxonomyKind, e: AnyEntity) => {
    setRenaming({ kind, id: e.id, current: e.name });
    setRenameValue(e.name);
  };
  const commitRename = () => {
    if (!renaming) return;
    const v = renameValue.trim();
    if (!v || v === renaming.current) { setRenaming(null); return; }
    if (renameEntity(renaming.kind, renaming.id, v)) {
      bumpRepoVersion();
      toast.success(`Renamed to "${v}"`);
    }
    setRenaming(null);
  };

  const startMerge = (kind: TaxonomyKind, from: AnyEntity) => {
    setMerging({ kind, from });
    setMergeInto('');
  };
  const commitMerge = () => {
    if (!merging || !mergeInto) return;
    const { reassigned } = mergeEntity(merging.kind, merging.from.id, mergeInto);
    bumpRepoVersion();
    toast.success(`Merged "${merging.from.name}" → reassigned ${reassigned} test case${reassigned === 1 ? '' : 's'}`);
    setMerging(null);
  };

  const startDelete = (kind: TaxonomyKind, entity: AnyEntity) => {
    const usage = getEntityUsage(kind, entity.id);
    setDanger({ kind, entity, active: usage.active });
  };
  const commitDelete = () => {
    if (!danger) return;
    const ok = softDeleteEntity(danger.kind, danger.entity.id, danger.reassignTo);
    if (!ok) {
      toast.error('Pick a target to reassign active test cases.');
      return;
    }
    bumpRepoVersion();
    toast.success(`Retired "${danger.entity.name}"`);
    setDanger(null);
  };
  const restoreEnt = (kind: TaxonomyKind, e: AnyEntity) => {
    if (restoreEntity(kind, e.id)) { bumpRepoVersion(); toast.success(`Restored "${e.name}"`); }
  };

  const renderRow = (kind: TaxonomyKind, e: AnyEntity, mergeOptions: AnyEntity[], extra?: React.ReactNode) => {
    const usage = getEntityUsage(kind, e.id);
    return (
      <div key={e.id} className={`flex items-center gap-2 px-3 py-2 border rounded ${e.deletedAt ? 'opacity-60' : ''}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{e.name}</span>
            {e.deletedAt && <Badge variant="outline" className="text-[9px] h-4 px-1 border-rose-500/50 text-rose-700 dark:text-rose-400">Retired</Badge>}
            <Badge variant="outline" className="text-[10px] h-5 font-mono">{e.id}</Badge>
            {extra}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {usage.active} active · {usage.deleted} deleted test case{usage.active + usage.deleted === 1 ? '' : 's'}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!e.deletedAt && (
            <>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => startRename(kind, e)}>
                <Pencil className="h-3 w-3 mr-1" /> Rename
              </Button>
              <Button
                variant="ghost" size="sm" className="h-7 text-xs"
                disabled={mergeOptions.filter(o => o.id !== e.id && !o.deletedAt).length === 0}
                onClick={() => startMerge(kind, e)}
              >
                <GitMerge className="h-3 w-3 mr-1" /> Merge
              </Button>
              {caps.canDeleteCase && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-rose-600 hover:text-rose-700" onClick={() => startDelete(kind, e)}>
                  <Trash2 className="h-3 w-3 mr-1" /> Retire
                </Button>
              )}
            </>
          )}
          {e.deletedAt && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => restoreEnt(kind, e)}>
              <RotateCcw className="h-3 w-3 mr-1" /> Restore
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Layers className="h-5 w-5 text-muted-foreground" />
            Taxonomy
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Rename, merge, or retire modules, features, releases, processes, and labels. All deletions are soft.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={appId} onValueChange={setAppId}>
            <SelectTrigger className="w-[200px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {applications.map(a => <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setShowDeleted(v => !v)}>
            {showDeleted ? 'Hide retired' : 'Show retired'}
          </Button>
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => navigate('/settings')}>
            Back to Settings
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="h-8">
          <TabsTrigger value="modules" className="text-xs h-7">Modules ({appModules.length})</TabsTrigger>
          <TabsTrigger value="features" className="text-xs h-7">Features ({appFeatures.length})</TabsTrigger>
          <TabsTrigger value="releases" className="text-xs h-7">Releases ({appReleases.length})</TabsTrigger>
          <TabsTrigger value="processes" className="text-xs h-7">Processes ({appProcesses.length})</TabsTrigger>
          <TabsTrigger value="labels" className="text-xs h-7">Labels ({labelVocabulary.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="modules" className="mt-4">
          <Card><CardContent className="p-3 space-y-2">
            {appModules.length === 0 && <EmptyHint />}
            {appModules.map(m => renderRow('module', m, appModules))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="features" className="mt-4">
          <Card><CardContent className="p-3 space-y-2">
            {appFeatures.length === 0 && <EmptyHint />}
            {appFeatures.map(f => {
              const mod = modules.find(m => m.id === f.moduleId);
              const sameModule = appFeatures.filter(o => o.moduleId === f.moduleId);
              return renderRow('feature', f, sameModule, (
                <Badge variant="secondary" className="text-[10px] h-4 px-1">in {mod?.name ?? 'unknown'}</Badge>
              ));
            })}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="releases" className="mt-4">
          <Card><CardContent className="p-3 space-y-2">
            {appReleases.length === 0 && <EmptyHint />}
            {appReleases.map(r => renderRow('release', r, appReleases))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="processes" className="mt-4">
          <Card><CardContent className="p-3 space-y-2">
            {appProcesses.length === 0 && <EmptyHint />}
            {appProcesses.map(p => renderRow('process', p, appProcesses))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="labels" className="mt-4">
          <Card><CardContent className="p-3 space-y-2">
            {labelVocabulary
              .filter(l => showDeleted || !deletedLabels.has(l))
              .map(label => {
                const u = getLabelUsage(label);
                const isDeleted = deletedLabels.has(label);
                return (
                  <div key={label} className={`flex items-center gap-2 px-3 py-2 border rounded ${isDeleted ? 'opacity-60' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">#{label}</span>
                        {isDeleted && <Badge variant="outline" className="text-[9px] h-4 px-1 border-rose-500/50 text-rose-700 dark:text-rose-400">Retired</Badge>}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{u.active} active · {u.deleted} deleted</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {!isDeleted && (
                        <>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                            const next = window.prompt('Rename label', label)?.trim();
                            if (next && next !== label) {
                              const n = renameLabel(label, next);
                              bumpRepoVersion();
                              toast.success(`Renamed on ${n} test case${n === 1 ? '' : 's'}`);
                            }
                          }}>
                            <Pencil className="h-3 w-3 mr-1" /> Rename
                          </Button>
                          {caps.canDeleteCase && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-rose-600 hover:text-rose-700" onClick={() => {
                              softDeleteLabel(label); bumpRepoVersion(); toast.success(`Retired "#${label}"`);
                            }}>
                              <Trash2 className="h-3 w-3 mr-1" /> Retire
                            </Button>
                          )}
                        </>
                      )}
                      {isDeleted && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                          restoreLabel(label); bumpRepoVersion(); toast.success(`Restored "#${label}"`);
                        }}>
                          <RotateCcw className="h-3 w-3 mr-1" /> Restore
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Rename dialog */}
      <Dialog open={!!renaming} onOpenChange={(v) => !v && setRenaming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Rename {renaming?.kind}</DialogTitle>
            <DialogDescription className="text-xs">All test cases tagged with this {renaming?.kind} will display the new name.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-8 text-xs"
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); }} />
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button size="sm" onClick={commitRename} disabled={!renameValue.trim() || renameValue.trim() === renaming?.current}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge dialog */}
      <Dialog open={!!merging} onOpenChange={(v) => !v && setMerging(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Merge {merging?.kind}</DialogTitle>
            <DialogDescription className="text-xs">
              All test cases tagged with <strong>{merging?.from.name}</strong> will be reassigned to the target. The source will be retired.
            </DialogDescription>
          </DialogHeader>
          <Select value={mergeInto} onValueChange={setMergeInto}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick target" /></SelectTrigger>
            <SelectContent>
              {merging && (
                merging.kind === 'feature'
                  ? appFeatures.filter(o => o.id !== merging.from.id && !o.deletedAt && (o as unknown as { moduleId: string }).moduleId === (merging.from as unknown as { moduleId: string }).moduleId)
                  : merging.kind === 'module' ? appModules.filter(o => o.id !== merging.from.id && !o.deletedAt)
                  : merging.kind === 'release' ? appReleases.filter(o => o.id !== merging.from.id && !o.deletedAt)
                  : appProcesses.filter(o => o.id !== merging.from.id && !o.deletedAt)
              ).map(o => <SelectItem key={o.id} value={o.id} className="text-xs">{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setMerging(null)}>Cancel</Button>
            <Button size="sm" onClick={commitMerge} disabled={!mergeInto}>Merge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Retire confirm (with reassign if active usage > 0) */}
      <Dialog open={!!danger} onOpenChange={(v) => !v && setDanger(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Retire {danger?.kind}</DialogTitle>
            <DialogDescription className="text-xs">
              {danger && danger.active > 0
                ? `"${danger.entity.name}" is used by ${danger.active} active test case${danger.active === 1 ? '' : 's'}. Pick a replacement to reassign them, or cancel.`
                : `Retire "${danger?.entity.name}"? It can be restored later.`}
            </DialogDescription>
          </DialogHeader>
          {danger && danger.active > 0 && (
            <Select value={danger.reassignTo ?? ''} onValueChange={(v) => setDanger({ ...danger, reassignTo: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Reassign to…" /></SelectTrigger>
              <SelectContent>
                {(danger.kind === 'feature'
                  ? appFeatures.filter(o => o.id !== danger.entity.id && !o.deletedAt && (o as unknown as { moduleId: string }).moduleId === (danger.entity as unknown as { moduleId: string }).moduleId)
                  : danger.kind === 'module' ? appModules.filter(o => o.id !== danger.entity.id && !o.deletedAt)
                  : danger.kind === 'release' ? appReleases.filter(o => o.id !== danger.entity.id && !o.deletedAt)
                  : appProcesses.filter(o => o.id !== danger.entity.id && !o.deletedAt)
                ).map(o => <SelectItem key={o.id} value={o.id} className="text-xs">{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setDanger(null)}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={commitDelete}
              disabled={!!danger && danger.active > 0 && !danger.reassignTo}>
              Retire
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyHint() {
  return <div className="text-xs text-muted-foreground py-6 text-center">Nothing here.</div>;
}
