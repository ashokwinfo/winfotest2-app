import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronDown, X, PlusCircle, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  releases as allReleases, processes as allProcesses, modules as allModules, features as allFeatures,
  testCases as testCaseStore, labelVocabulary,
  bulkUpdateCases, createRelease, createProcess, createModule, createFeature, addLabelToVocabulary,
  type BulkUpdateMode,
} from '@/data/mock';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { toast } from '@/hooks/use-toast';

interface BulkMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId: string;
  caseIds: string[];
  /** Called after a successful apply. */
  onApplied?: () => void;
}

const NEW_SENTINEL = '__NEW__';

export function BulkMoveDialog({ open, onOpenChange, appId, caseIds, onApplied }: BulkMoveDialogProps) {
  const { isMasterRepo, bumpRepoVersion } = useWorkspace();
  const [tab, setTab] = useState<'release' | 'scope' | 'process' | 'label' | 'status'>('release');
  const [taxVersion, setTaxVersion] = useState(0);
  const refresh = () => { setTaxVersion(v => v + 1); bumpRepoVersion(); };

  // Reset on open
  useEffect(() => { if (open) setTab('release'); }, [open]);

  // Per-tab state
  const [relMode, setRelMode] = useState<BulkUpdateMode>('add');
  const [relIds, setRelIds] = useState<string[]>([]);

  const [moduleId, setModuleId] = useState<string>('');
  const [featureId, setFeatureId] = useState<string>('');
  const [newModuleDraft, setNewModuleDraft] = useState<string | null>(null);
  const [newFeatureDraft, setNewFeatureDraft] = useState<string | null>(null);

  const [procMode, setProcMode] = useState<BulkUpdateMode>('add');
  const [procIds, setProcIds] = useState<string[]>([]);

  const [labelMode, setLabelMode] = useState<BulkUpdateMode>('add');
  const [labelList, setLabelList] = useState<string[]>([]);

  const [statusVal, setStatusVal] = useState<'valid' | 'draft' | 'archived'>('valid');

  useEffect(() => {
    if (!open) {
      setRelIds([]); setRelMode('add');
      setModuleId(''); setFeatureId('');
      setNewModuleDraft(null); setNewFeatureDraft(null);
      setProcIds([]); setProcMode('add');
      setLabelList([]); setLabelMode('add');
      setStatusVal('valid');
    }
  }, [open]);

  const appReleases = useMemo(
    () => allReleases.filter(r => r.applicationId === appId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appId, taxVersion],
  );
  const appProcesses = useMemo(
    () => allProcesses.filter(p => !p.applicationId || p.applicationId === appId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appId, taxVersion],
  );
  const appModules = useMemo(() => {
    const seen = new Set<string>();
    return allModules.filter(m => m.applicationId === appId && (seen.has(m.name) ? false : (seen.add(m.name), true)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, taxVersion]);
  const moduleFeatures = useMemo(() => {
    if (!moduleId) return [];
    const target = allModules.find(m => m.id === moduleId);
    if (!target) return [];
    const sameNameIds = allModules
      .filter(m => m.name === target.name && m.applicationId === appId)
      .map(m => m.id);
    return allFeatures.filter(f => sameNameIds.includes(f.moduleId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId, appId, taxVersion]);

  // Selected cases — for the warning about cross-feature reassignment
  const selectedCases = useMemo(
    () => caseIds.map(id => testCaseStore.find(c => c.id === id)).filter(Boolean) as { featureId: string; moduleId: string }[],
    [caseIds, taxVersion, open],
  );
  const distinctFeatures = useMemo(() => new Set(selectedCases.map(c => c.featureId)).size, [selectedCases]);

  const count = caseIds.length;

  // ---- inline create handlers ----
  const handleCreateRelease = (name: string, version?: string) => {
    if (appReleases.some(r => r.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: 'Release already exists', variant: 'destructive' }); return false;
    }
    const r = createRelease({ name, version: version || name, applicationId: appId });
    refresh(); setRelIds(prev => [...prev, r.id]);
    return true;
  };
  const handleCreateProcess = (name: string) => {
    if (appProcesses.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: 'Process already exists', variant: 'destructive' }); return false;
    }
    const p = createProcess({ name, applicationId: appId });
    refresh(); setProcIds(prev => [...prev, p.id]);
    return true;
  };
  const handleCreateModule = () => {
    const v = (newModuleDraft ?? '').trim();
    if (!v) return;
    if (appModules.some(m => m.name.toLowerCase() === v.toLowerCase())) {
      toast({ title: 'Module already exists', variant: 'destructive' }); return;
    }
    const m = createModule({ name: v, applicationId: appId });
    refresh(); setModuleId(m.id); setFeatureId(''); setNewModuleDraft(null);
  };
  const handleCreateFeature = () => {
    const v = (newFeatureDraft ?? '').trim();
    if (!v || !moduleId) return;
    if (moduleFeatures.some(f => f.name.toLowerCase() === v.toLowerCase())) {
      toast({ title: 'Feature already exists', variant: 'destructive' }); return;
    }
    const f = createFeature({ name: v, moduleId });
    refresh(); setFeatureId(f.id); setNewFeatureDraft(null);
  };

  // ---- apply ----
  const apply = () => {
    let updated = 0;
    let summary = '';

    if (tab === 'release') {
      if (relIds.length === 0) return;
      updated = bulkUpdateCases(caseIds, { releaseIds: relIds }, relMode);
      const names = relIds.map(id => appReleases.find(r => r.id === id)?.name ?? id).join(', ');
      summary = `${relMode === 'add' ? 'Added to' : relMode === 'remove' ? 'Removed from' : 'Replaced with'} release(s): ${names}`;
    } else if (tab === 'scope') {
      if (!moduleId || !featureId) return;
      updated = bulkUpdateCases(caseIds, { moduleId, featureId }, 'replace');
      const m = allModules.find(x => x.id === moduleId)?.name;
      const f = allFeatures.find(x => x.id === featureId)?.name;
      summary = `Reassigned to ${m} → ${f}`;
    } else if (tab === 'process') {
      if (procIds.length === 0) return;
      updated = bulkUpdateCases(caseIds, { processIds: procIds }, procMode);
      const names = procIds.map(id => appProcesses.find(p => p.id === id)?.name ?? id).join(', ');
      summary = `${procMode === 'add' ? 'Tagged' : procMode === 'remove' ? 'Untagged' : 'Replaced'} process(es): ${names}`;
    } else if (tab === 'label') {
      if (labelList.length === 0) return;
      labelList.forEach(addLabelToVocabulary);
      updated = bulkUpdateCases(caseIds, { labels: labelList }, labelMode);
      summary = `${labelMode === 'add' ? 'Added' : labelMode === 'remove' ? 'Removed' : 'Replaced'} label(s): ${labelList.join(', ')}`;
    } else if (tab === 'status') {
      updated = bulkUpdateCases(caseIds, { status: statusVal }, 'replace');
      summary = `Status set to ${statusVal}`;
    }

    bumpRepoVersion();
    toast({ title: `${updated} test case${updated === 1 ? '' : 's'} updated`, description: summary });
    onApplied?.();
    onOpenChange(false);
  };

  const canApply = () => {
    if (count === 0) return false;
    if (tab === 'release') return relIds.length > 0;
    if (tab === 'scope') return !!moduleId && !!featureId;
    if (tab === 'process') return procIds.length > 0;
    if (tab === 'label') return labelList.length > 0;
    if (tab === 'status') return true;
    return false;
  };

  if (!isMasterRepo) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Move / Tag — {count} test case{count === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription className="text-xs">
            Apply a single change across the whole selection. Changes write to the master library.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid grid-cols-5 h-8">
            <TabsTrigger value="release" className="text-xs h-7">Release</TabsTrigger>
            <TabsTrigger value="scope" className="text-xs h-7">Module/Feature</TabsTrigger>
            <TabsTrigger value="process" className="text-xs h-7">Process</TabsTrigger>
            <TabsTrigger value="label" className="text-xs h-7">Label</TabsTrigger>
            <TabsTrigger value="status" className="text-xs h-7">Status</TabsTrigger>
          </TabsList>

          {/* RELEASE */}
          <TabsContent value="release" className="space-y-3 pt-3">
            <ModeToggle value={relMode} onChange={setRelMode} />
            <MultiSelect
              label="Releases"
              options={appReleases.map(r => ({ id: r.id, label: r.name }))}
              selected={relIds}
              onChange={setRelIds}
              createForm={{
                placeholder: 'Release name (e.g. R13 26C)',
                secondaryPlaceholder: 'Version (optional)',
                onCreate: handleCreateRelease,
              }}
            />
          </TabsContent>

          {/* SCOPE */}
          <TabsContent value="scope" className="space-y-3 pt-3">
            {distinctFeatures > 1 && (
              <div className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded p-2">
                Selection spans {distinctFeatures} features. All cases will be reassigned to the chosen module + feature.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Module</Label>
                {newModuleDraft === null ? (
                  <Select value={moduleId} onValueChange={(v) => v === NEW_SENTINEL ? setNewModuleDraft('') : (setModuleId(v), setFeatureId(''))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select module" /></SelectTrigger>
                    <SelectContent>
                      {appModules.map(m => <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>)}
                      <SelectSeparator />
                      <SelectItem value={NEW_SENTINEL} className="text-xs text-primary">
                        <span className="inline-flex items-center gap-1"><PlusCircle className="h-3 w-3" /> New module…</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <InlineCreateRow value={newModuleDraft} onChange={setNewModuleDraft} onSave={handleCreateModule} onCancel={() => setNewModuleDraft(null)} placeholder="New module name" />
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Feature</Label>
                {newFeatureDraft === null ? (
                  <Select value={featureId} onValueChange={(v) => v === NEW_SENTINEL ? setNewFeatureDraft('') : setFeatureId(v)} disabled={!moduleId}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={moduleId ? 'Select feature' : 'Pick module first'} /></SelectTrigger>
                    <SelectContent>
                      {moduleFeatures.map(f => <SelectItem key={f.id} value={f.id} className="text-xs">{f.name}</SelectItem>)}
                      {moduleId && <>
                        <SelectSeparator />
                        <SelectItem value={NEW_SENTINEL} className="text-xs text-primary">
                          <span className="inline-flex items-center gap-1"><PlusCircle className="h-3 w-3" /> New feature…</span>
                        </SelectItem>
                      </>}
                    </SelectContent>
                  </Select>
                ) : (
                  <InlineCreateRow value={newFeatureDraft} onChange={setNewFeatureDraft} onSave={handleCreateFeature} onCancel={() => setNewFeatureDraft(null)} placeholder="New feature name" />
                )}
              </div>
            </div>
          </TabsContent>

          {/* PROCESS */}
          <TabsContent value="process" className="space-y-3 pt-3">
            <ModeToggle value={procMode} onChange={setProcMode} />
            <MultiSelect
              label="Processes"
              options={appProcesses.map(p => ({ id: p.id, label: p.name }))}
              selected={procIds}
              onChange={setProcIds}
              createForm={{
                placeholder: 'Process name (e.g. Quote-to-Order)',
                onCreate: (n) => handleCreateProcess(n),
              }}
            />
          </TabsContent>

          {/* LABEL */}
          <TabsContent value="label" className="space-y-3 pt-3">
            <ModeToggle value={labelMode} onChange={setLabelMode} />
            <LabelEditor labels={labelList} onChange={setLabelList} />
          </TabsContent>

          {/* STATUS */}
          <TabsContent value="status" className="space-y-3 pt-3">
            <Label className="text-xs">Set status to</Label>
            <Select value={statusVal} onValueChange={(v) => setStatusVal(v as typeof statusVal)}>
              <SelectTrigger className="h-8 text-xs w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft" className="text-xs">Draft</SelectItem>
                <SelectItem value="valid" className="text-xs">Published</SelectItem>
                <SelectItem value="archived" className="text-xs">Retired</SelectItem>
              </SelectContent>
            </Select>
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!canApply()} onClick={apply}>
            Apply to {count} case{count === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------
function ModeToggle({ value, onChange }: { value: BulkUpdateMode; onChange: (v: BulkUpdateMode) => void }) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as BulkUpdateMode)}
      className="justify-start"
    >
      <ToggleGroupItem value="add" className="h-7 text-xs px-3">Add</ToggleGroupItem>
      <ToggleGroupItem value="remove" className="h-7 text-xs px-3">Remove</ToggleGroupItem>
      <ToggleGroupItem value="replace" className="h-7 text-xs px-3">Replace</ToggleGroupItem>
    </ToggleGroup>
  );
}

function InlineCreateRow({
  value, onChange, onSave, onCancel, placeholder,
}: {
  value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void; placeholder: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onSave(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        className="h-8 text-xs"
      />
      <Button size="sm" className="h-8 px-2" onClick={onSave} disabled={!value.trim()}><Check className="h-3.5 w-3.5" /></Button>
      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onCancel}><X className="h-3.5 w-3.5" /></Button>
    </div>
  );
}

interface CreateForm {
  placeholder: string;
  secondaryPlaceholder?: string;
  onCreate: (name: string, secondary?: string) => boolean;
}

function MultiSelect({
  label, options, selected, onChange, createForm,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  createForm?: CreateForm;
}) {
  const [creating, setCreating] = useState(false);
  const [draft1, setDraft1] = useState(''); const [draft2, setDraft2] = useState('');
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const reset = () => { setCreating(false); setDraft1(''); setDraft2(''); };
  const submit = () => {
    if (!createForm || !draft1.trim()) return;
    if (createForm.onCreate(draft1.trim(), draft2.trim() || undefined)) reset();
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Popover onOpenChange={(o) => { if (!o) reset(); }}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 w-full justify-between text-xs font-normal">
            <span className="truncate text-muted-foreground">
              {selected.length === 0 ? `Select ${label.toLowerCase()}` : `${selected.length} selected`}
            </span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}…`} className="text-xs" />
            <CommandList>
              <CommandEmpty>No matches</CommandEmpty>
              <CommandGroup>
                {options.map(opt => {
                  const checked = selected.includes(opt.id);
                  return (
                    <CommandItem key={opt.id} value={opt.label} onSelect={() => toggle(opt.id)} className="text-xs cursor-pointer">
                      <div className={cn('mr-2 h-3.5 w-3.5 rounded-sm border flex items-center justify-center',
                        checked ? 'bg-primary border-primary' : 'border-input')}>
                        {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <span className="flex-1 truncate">{opt.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
          {createForm && (
            <div className="border-t p-2 space-y-1.5 bg-muted/30">
              {!creating ? (
                <Button variant="ghost" size="sm" className="w-full h-7 text-xs justify-start text-primary" onClick={() => setCreating(true)}>
                  <PlusCircle className="h-3 w-3 mr-1" /> New {label.toLowerCase().replace(/s$/, '')}…
                </Button>
              ) : (
                <>
                  <Input autoFocus placeholder={createForm.placeholder} value={draft1}
                    onChange={(e) => setDraft1(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !createForm.secondaryPlaceholder) { e.preventDefault(); submit(); } if (e.key === 'Escape') { e.preventDefault(); reset(); } }}
                    className="h-7 text-xs" />
                  {createForm.secondaryPlaceholder && (
                    <Input placeholder={createForm.secondaryPlaceholder} value={draft2}
                      onChange={(e) => setDraft2(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') { e.preventDefault(); reset(); } }}
                      className="h-7 text-xs" />
                  )}
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={reset}>Cancel</Button>
                    <Button size="sm" className="h-6 text-[11px] px-2" disabled={!draft1.trim()} onClick={submit}>Create</Button>
                  </div>
                </>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {selected.map(id => {
            const opt = options.find(o => o.id === id);
            return (
              <Badge key={id} variant="secondary" className="text-[10px] gap-1 pr-1">
                {opt?.label ?? id}
                <button onClick={() => toggle(id)} className="hover:text-foreground" aria-label="Remove">
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LabelEditor({ labels, onChange }: { labels: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const toggle = (l: string) => onChange(labels.includes(l) ? labels.filter(x => x !== l) : [...labels, l]);
  const addNew = () => {
    const v = draft.trim();
    if (!v) return;
    if (!labels.includes(v)) onChange([...labels, v]);
    setDraft('');
  };
  const suggestions = labelVocabulary.filter(l => !labels.includes(l));
  return (
    <div className="space-y-1">
      <Label className="text-xs">Labels</Label>
      <div className="flex gap-1">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNew(); } }}
          placeholder="Add a label and press Enter" className="h-8 text-xs" />
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={addNew} disabled={!draft.trim()}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {(labels.length > 0 || suggestions.length > 0) && (
        <div className="flex flex-wrap gap-1 pt-1">
          {labels.map(l => (
            <Badge key={`sel-${l}`} variant="default" className="text-[10px] gap-1 pr-1">
              {l}
              <button onClick={() => toggle(l)} className="hover:text-foreground" aria-label="Remove">
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
          {suggestions.slice(0, 8).map(l => (
            <button key={`sug-${l}`} onClick={() => toggle(l)}
              className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-muted-foreground/40 text-muted-foreground hover:bg-secondary">
              + {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
