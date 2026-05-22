import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlineEdit } from '@/components/shared/InlineEdit';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { WorkbenchDialog } from '@/components/workbench/WorkbenchDialog';
import { BulkImportDialog } from '@/components/workbench/BulkImportDialog';
import {
  modules, features, releases, processes, applications,
  actionTypeOptions, validationTypeOptions, dataTypeOptions,
  resolveCase, resolveSteps, getCaseOrigin, customizeCase, revertCase, deleteInheritedCase,
  testCases as masterCases, labelVocabulary,
  updateCase, softDeleteCase, restoreCase, duplicateCase,
  createRelease, createProcess, addLabelToVocabulary,
} from '@/data/mock';
import type { TestStep, TestCase } from '@/types';
import {
  ArrowLeft, Download, Upload, Wrench, GitBranch, Tag as TagIcon, Workflow, Hash,
  Lock, GitFork, Undo2, Trash2, AlertTriangle, Sparkles, MoreHorizontal, Copy, Archive, FolderInput, RotateCcw,
} from 'lucide-react';
import { DependencyGraphDialog } from '@/components/shared/DependencyGraphDialog';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { toast } from 'sonner';
import { statusLabel, cn } from '@/lib/utils';
import { useCapabilities } from '@/lib/permissions';
import { CaseTagEditPopover } from '@/components/library/CaseTagEditPopover';
import { MoveCaseDialog } from '@/components/library/MoveCaseDialog';

const actionLabel = (v: string) => actionTypeOptions.find(o => o.value === v)?.label ?? v;
const validationLabel = (v: string) => validationTypeOptions.find(o => o.value === v)?.label ?? v;
const dataTypeLabel = (v: string) => dataTypeOptions.find(o => o.value === v)?.label ?? v;
const umLabel = (v: string) => v === 'mandatory' ? 'Mandatory' : 'Not Applicable';
const ttLabel = (v: string) => v === 'positive' ? 'Positive' : v === 'negative' ? 'Negative' : 'Not Applicable';

const TestCaseEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentRepo, isMasterRepo, activeClient, repoVersion, bumpRepoVersion } = useWorkspace();
  const caps = useCapabilities();

  // Repo-aware case + steps. Re-resolve when repo or repoVersion changes.
  const resolved = useMemo(
    () => (id ? resolveCase(currentRepo, id) : undefined),
    [id, currentRepo, repoVersion],
  );
  const resolvedSteps = useMemo(
    () => (id ? resolveSteps(currentRepo, id) : []),
    [id, currentRepo, repoVersion],
  );

  const [caseData, setCaseData] = useState<TestCase | undefined>(resolved);
  const [steps, setSteps] = useState<TestStep[]>(resolvedSteps);

  useEffect(() => { setCaseData(resolved); }, [resolved]);
  useEffect(() => { setSteps(resolvedSteps); }, [resolvedSteps]);

  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [depsOpen, setDepsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  // Auto-open Workbench when ?wb=1 (used by "New test case" flow).
  useEffect(() => {
    if (searchParams.get('wb') === '1' && caseData) {
      setWorkbenchOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('wb');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, caseData, setSearchParams]);

  if (!caseData || !id) return <div className="text-sm text-muted-foreground">Test case not found</div>;

  const origin = getCaseOrigin(currentRepo, id);
  const isReadOnly = !isMasterRepo && origin === 'inherited';
  const isDeleted = !!caseData.deletedAt;
  const canEdit = caps.canEditCase && !isReadOnly && !isDeleted;
  const masterForDrift = origin === 'modified'
    ? masterCases.find(tc => tc.id === id || tc.id === id.split('__')[0])
    : undefined;
  const driftFromMaster = !!(masterForDrift && (masterForDrift.version ?? 1) > 1 && origin === 'modified');

  // ---- mutation helpers (master-only persistence; client-overrides go via existing flow) ----
  const persistPatch = (patch: Parameters<typeof updateCase>[1]) => {
    const next = updateCase(id, patch);
    if (next) { setCaseData(next); bumpRepoVersion(); }
  };

  const handleSaveName = (v: string) => persistPatch({ testCaseName: v });
  const handleSaveRole = (v: string) => persistPatch({ role: v });
  const handleSaveDescription = (v: string) => persistPatch({ description: v });
  const handleSaveDependency = (v: string) => persistPatch({ dependency: v.trim() || null });
  const handleSetStatus = (v: TestCase['status']) => {
    persistPatch({ status: v });
    toast.success(`Status: ${statusLabel(v)}`);
  };

  const handleCustomize = () => {
    const ovr = customizeCase(currentRepo, id);
    bumpRepoVersion();
    if (ovr) {
      toast.success('Customization created', { description: `You can now edit this test case for ${activeClient?.name}.` });
      navigate(`/test-case/${ovr.testCase.id}`, { replace: true });
    }
  };
  const handleRevert = () => {
    if (!confirm('Revert this customization to the master version? Your client-side changes will be lost.')) return;
    const masterId = id.split('__')[0];
    revertCase(currentRepo, id);
    bumpRepoVersion();
    toast.success('Reverted to master version');
    navigate(`/test-case/${masterId}`, { replace: true });
  };
  const handleRemoveInherited = () => {
    if (!confirm('Remove this inherited master case from your repository? It will appear as "Deleted" in the diff.')) return;
    deleteInheritedCase(currentRepo, id);
    bumpRepoVersion();
    toast.success('Removed from this client repo');
    navigate(-1);
  };

  const handleDuplicate = () => {
    const copy = duplicateCase(id);
    if (!copy) return;
    bumpRepoVersion();
    toast.success('Duplicated', { description: copy.caseNumber });
    navigate(`/test-case/${copy.id}?wb=1`);
  };
  const handleSoftDelete = () => {
    if (!confirm('Delete this test case? It will be soft-deleted and recoverable from the Library "Show deleted" view.')) return;
    if (softDeleteCase(id)) {
      bumpRepoVersion();
      toast.success('Test case deleted', {
        description: caseData.caseNumber,
        action: { label: 'Undo', onClick: () => { restoreCase(id); bumpRepoVersion(); toast.success('Restored'); } },
        duration: 8000,
      });
      navigate(-1);
    }
  };
  const handleRestore = () => {
    if (restoreCase(id)) {
      bumpRepoVersion();
      toast.success('Test case restored');
    }
  };

  const handleMove = (moduleId: string, featureId: string) => {
    persistPatch({ moduleId, featureId });
    toast.success('Moved', { description: `${modules.find(m => m.id === moduleId)?.name} → ${features.find(f => f.id === featureId)?.name}` });
  };

  const mod = modules.find(m => m.id === caseData.moduleId);
  const feat = features.find(f => f.id === caseData.featureId);
  const app = applications.find(a => a.id === mod?.applicationId);

  const taggedReleaseIds = caseData.releaseIds && caseData.releaseIds.length > 0
    ? caseData.releaseIds
    : [caseData.releaseId];
  const taggedReleases = releases.filter(r => taggedReleaseIds.includes(r.id));
  const taggedProcesses = processes.filter(p => caseData.processIds?.includes(p.id));
  const taggedLabels = caseData.labels ?? [];

  const appReleases = releases.filter(r => !r.deletedAt && (!app || r.applicationId === app.id));
  const appProcesses = processes.filter(p => !p.deletedAt && (!p.applicationId || p.applicationId === app?.id));
  const labelOptions = labelVocabulary.map(l => ({ id: l, label: l }));

  const handleEditReleases = (next: string[]) => persistPatch({ releaseIds: next });
  const handleEditProcesses = (next: string[]) => persistPatch({ processIds: next });
  const handleEditLabels = (next: string[]) => persistPatch({ labels: next });

  const handleWorkbenchSave = (updatedSteps: TestStep[], updatedCase: TestCase) => {
    setSteps(updatedSteps);
    setCaseData(updatedCase);
  };

  const handleBulkImport = (importedSteps: TestStep[]) => {
    setSteps(importedSteps);
  };

  const handleExport = () => {
    const headers = ['Line No.', 'Step Description', 'Input Parameter', 'Action', 'Validation Type', 'Validation Name', 'Unique/Mandatory', 'Data Type', 'Testing Type'];
    const rows = steps.map(s => [
      s.lineNumber, s.stepDescription, s.inputParameter, s.action,
      s.validationType, s.validationName, s.uniqueMandatory, s.dataType, s.testingType,
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${caseData.caseNumber}_steps.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Steps exported');
  };

  return (
    <div className="space-y-4">
      {/* Soft-delete banner */}
      {isDeleted && (
        <div className="flex items-center justify-between rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
            <Trash2 className="h-3.5 w-3.5" />
            <span><strong>Deleted.</strong> This test case is soft-deleted and hidden from default views.</span>
          </div>
          {caps.canDeleteCase && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleRestore}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
            </Button>
          )}
        </div>
      )}

      {/* Repo origin banner — only shown inside a client repo */}
      {!isMasterRepo && !isDeleted && (
        <div className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${
          origin === 'inherited' ? 'border-muted-foreground/30 bg-muted/30' :
          origin === 'modified'   ? 'border-blue-500/40 bg-blue-500/5' :
          'border-amber-500/40 bg-amber-500/5'
        }`}>
          <div className="flex items-center gap-2">
            {origin === 'inherited' && <><Lock className="h-3.5 w-3.5 text-muted-foreground" /><span><strong>Inherited from Master</strong> — read-only in {activeClient?.name}. Click <em>Customize</em> to fork.</span></>}
            {origin === 'modified'   && <><GitFork className="h-3.5 w-3.5 text-blue-600" /><span><strong>Modified for {activeClient?.name}</strong>{driftFromMaster && <> · <span className="text-amber-700 dark:text-amber-400 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Master has changed since this fork</span></>}</span></>}
            {origin === 'client-only' && <><Sparkles className="h-3.5 w-3.5 text-amber-600" /><span><strong>Client-only</strong> — exists only in {activeClient?.name}, not in Master.</span></>}
          </div>
          <div className="flex items-center gap-1.5">
            {origin === 'inherited' && (
              <>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleCustomize}>
                  <GitFork className="h-3.5 w-3.5 mr-1" /> Customize
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={handleRemoveInherited}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                </Button>
              </>
            )}
            {origin === 'modified' && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleRevert}>
                <Undo2 className="h-3.5 w-3.5 mr-1" /> Revert to Master
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="icon" className="h-7 w-7 mt-0.5" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-muted-foreground">{caseData.caseNumber}</span>
              {canEdit
                ? <InlineEdit value={caseData.testCaseName} onSave={handleSaveName} className="text-sm font-semibold" />
                : <span className="text-sm font-semibold">{caseData.testCaseName}</span>}
              <Badge variant="outline" className="text-[10px]">{caseData.type === 'customized' ? 'Customized' : 'Standard'}</Badge>
              {/* Status: editable Select when permitted, read-only badge otherwise */}
              {canEdit && isMasterRepo ? (
                <Select value={caseData.status} onValueChange={(v) => handleSetStatus(v as TestCase['status'])}>
                  <SelectTrigger className="h-6 text-[10px] px-2 w-auto gap-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft" className="text-xs">Draft</SelectItem>
                    <SelectItem value="valid" className="text-xs">Published</SelectItem>
                    <SelectItem value="archived" className="text-xs">Retired</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant={caseData.status === 'valid' ? 'default' : 'secondary'} className="text-[10px]">
                  {statusLabel(caseData.status)}
                </Badge>
              )}
            </div>

            {/* Home: Application › Module › Feature */}
            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground flex-wrap">
              <span className="text-[10px] uppercase tracking-wider">Home:</span>
              {app && <span className="font-medium text-foreground">{app.name}</span>}
              <span>›</span>
              <span>{mod?.name}</span>
              <span>›</span>
              <span>{feat?.name}</span>
              <span>·</span>
              <span className="flex items-center gap-1">
                Role:{' '}
                {canEdit
                  ? <InlineEdit value={caseData.role} onSave={handleSaveRole} className="text-xs" />
                  : <span>{caseData.role}</span>}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                Dep:{' '}
                {canEdit
                  ? <InlineEdit value={caseData.dependency ?? '—'} onSave={handleSaveDependency} className="text-xs" />
                  : <span>{caseData.dependency ?? '—'}</span>}
              </span>
            </div>

            {/* Tag chips: releases, processes, labels — each row gets an inline editor */}
            <div className="flex items-start gap-4 mt-2 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <TagIcon className="h-2.5 w-2.5" /> Releases
                </span>
                {taggedReleases.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground italic">none</span>
                ) : taggedReleases.map(r => (
                  <button
                    key={r.id}
                    onClick={() => navigate(`/releases/${r.id}`)}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    {r.version}
                  </button>
                ))}
                {canEdit && isMasterRepo && (
                  <CaseTagEditPopover
                    title="Releases"
                    options={appReleases.map(r => ({ id: r.id, label: r.name }))}
                    selected={taggedReleaseIds}
                    onChange={handleEditReleases}
                    onCreate={app ? (name) => {
                      const r = createRelease({ name, version: name, applicationId: app.id });
                      bumpRepoVersion();
                      return r.id;
                    } : undefined}
                  />
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Workflow className="h-2.5 w-2.5" /> Processes
                </span>
                {taggedProcesses.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground italic">none</span>
                ) : taggedProcesses.map(p => (
                  <button
                    key={p.id}
                    onClick={() => navigate(`/processes/${p.id}`)}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent text-accent-foreground hover:opacity-80 transition-opacity"
                  >
                    {p.name}
                  </button>
                ))}
                {canEdit && isMasterRepo && (
                  <CaseTagEditPopover
                    title="Processes"
                    options={appProcesses.map(p => ({ id: p.id, label: p.name }))}
                    selected={caseData.processIds ?? []}
                    onChange={handleEditProcesses}
                    onCreate={app ? (name) => {
                      const p = createProcess({ name, applicationId: app.id });
                      bumpRepoVersion();
                      return p.id;
                    } : undefined}
                  />
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Hash className="h-2.5 w-2.5" /> Labels
                </span>
                {taggedLabels.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground italic">none</span>
                ) : taggedLabels.map(l => (
                  <button
                    key={l}
                    onClick={() => navigate(`/labels/${encodeURIComponent(l)}`)}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground hover:bg-muted/70 transition-colors"
                  >
                    {l}
                  </button>
                ))}
                {canEdit && isMasterRepo && (
                  <CaseTagEditPopover
                    title="Labels"
                    options={labelOptions}
                    selected={taggedLabels}
                    onChange={handleEditLabels}
                    onCreate={(name) => {
                      addLabelToVocabulary(name);
                      return name;
                    }}
                  />
                )}
              </div>
            </div>

            <div className="text-xs text-muted-foreground mt-2 max-w-2xl">
              {canEdit
                ? <InlineEdit value={caseData.description || 'Add a description…'} onSave={handleSaveDescription} className="text-xs" />
                : (caseData.description && <span>{caseData.description}</span>)}
            </div>
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => setDepsOpen(true)}>
            <GitBranch className="h-3.5 w-3.5 mr-1" /> Dependencies
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport}>
            <Download className="h-3.5 w-3.5 mr-1" /> Export
          </Button>
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} disabled={!canEdit}>
            <Upload className="h-3.5 w-3.5 mr-1" /> Import
          </Button>
          <Button size="sm" onClick={() => setWorkbenchOpen(true)} disabled={!canEdit}
            title={!canEdit ? 'You don’t have permission to edit this case here.' : undefined}>
            <Wrench className="h-3.5 w-3.5 mr-1" /> Open in Workbench
          </Button>

          {/* Per-case action menu */}
          {isMasterRepo && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-9 w-9 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={handleDuplicate} disabled={!caps.canEditCase}>
                  <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMoveOpen(true)} disabled={!canEdit}>
                  <FolderInput className="h-3.5 w-3.5 mr-2" /> Move to…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSetStatus('archived')} disabled={!canEdit || caseData.status === 'archived'}>
                  <Archive className="h-3.5 w-3.5 mr-2" /> Retire
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {isDeleted ? (
                  <DropdownMenuItem onClick={handleRestore} disabled={!caps.canDeleteCase}>
                    <RotateCcw className="h-3.5 w-3.5 mr-2" /> Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={handleSoftDelete} disabled={!caps.canDeleteCase}
                    className="text-destructive focus:text-destructive">
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Read-only step grid */}
      <div className={cn('space-y-2', isDeleted && 'opacity-60')}>
        <div className="text-xs text-muted-foreground">{steps.length} steps</div>
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-20 text-xs">Line No.</TableHead>
                  <TableHead className="min-w-[200px] text-xs">Step Description</TableHead>
                  <TableHead className="min-w-[160px] text-xs">Input Parameter</TableHead>
                  <TableHead className="min-w-[180px] text-xs">Action</TableHead>
                  <TableHead className="min-w-[180px] text-xs">Validation Type</TableHead>
                  <TableHead className="min-w-[140px] text-xs">Validation Name</TableHead>
                  <TableHead className="min-w-[130px] text-xs">Unique/Mandatory</TableHead>
                  <TableHead className="min-w-[130px] text-xs">Data Types</TableHead>
                  <TableHead className="min-w-[130px] text-xs">Testing Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {steps.map((step) => (
                  <TableRow key={step.id}>
                    <TableCell className="text-xs font-mono">{step.lineNumber}</TableCell>
                    <TableCell className="text-xs">{step.stepDescription}</TableCell>
                    <TableCell className="text-xs">{step.inputParameter}</TableCell>
                    <TableCell className="text-xs">{actionLabel(step.action)}</TableCell>
                    <TableCell className="text-xs">{validationLabel(step.validationType)}</TableCell>
                    <TableCell className="text-xs">{step.validationName}</TableCell>
                    <TableCell className="text-xs">{umLabel(step.uniqueMandatory)}</TableCell>
                    <TableCell className="text-xs">{dataTypeLabel(step.dataType)}</TableCell>
                    <TableCell className="text-xs">{ttLabel(step.testingType)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground bg-muted/30">
            {steps.length} steps total
          </div>
        </div>
      </div>

      <WorkbenchDialog
        open={workbenchOpen}
        onOpenChange={setWorkbenchOpen}
        testCase={caseData}
        steps={steps}
        onSave={handleWorkbenchSave}
      />
      <DependencyGraphDialog
        open={depsOpen}
        onOpenChange={setDepsOpen}
        caseIds={caseData ? [caseData.id] : []}
      />
      <BulkImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        testCaseId={caseData.id}
        onImport={handleBulkImport}
      />
      {app && (
        <MoveCaseDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          appId={app.id}
          initialModuleId={caseData.moduleId}
          initialFeatureId={caseData.featureId}
          onApply={handleMove}
        />
      )}
    </div>
  );
};

export default TestCaseEditor;
