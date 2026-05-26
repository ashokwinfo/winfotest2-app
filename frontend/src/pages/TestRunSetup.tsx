import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { PreRunValidation } from '@/components/test-runs/PreRunValidation';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { releases, modules, testCases, testRuns, features as allFeatures, testSteps } from '@/data/mock';
import type { Environment } from '@/types';
import { Play, ArrowRight, ArrowLeft, Download, Upload, Search, CheckSquare, Square, Copy, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, Archive, Link, Save, GitBranch } from 'lucide-react';
import { DependencyGraphDialog } from '@/components/shared/DependencyGraphDialog';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { toast } from '@/hooks/use-toast';

const ITEMS_PER_PAGE = 25;

const TestRunSetup = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const cloneId = searchParams.get('clone');
  const cloneEnv = searchParams.get('env') as Environment | null;
  const cloneRun = cloneId ? testRuns.find(r => r.id === cloneId) : null;
  const { currentTeam, templates: contextTemplates, addTemplate } = useWorkspace();
  const templateId = searchParams.get('template');
  const template = templateId ? contextTemplates.find(t => t.id === templateId) : null;

  // Context params from Library pages
  const paramApp = searchParams.get('app');
  const paramRelease = searchParams.get('release');
  const paramModule = searchParams.get('module');
  const paramCases = searchParams.get('cases');
  const preSelectedCaseIds = paramCases ? paramCases.split(',').filter(Boolean) : [];

  // Auto-infer release and module from pre-selected cases
  const inferredFromCases = useMemo(() => {
    if (preSelectedCaseIds.length === 0) return { releaseId: '', moduleId: '' };
    const selectedModuleIds = new Set(
      preSelectedCaseIds.map(id => testCases.find(tc => tc.id === id)?.moduleId).filter(Boolean)
    );
    const firstModuleId = [...selectedModuleIds][0] || '';
    const firstModule = modules.find(m => m.id === firstModuleId);
    return {
      releaseId: firstModule?.releaseId || '',
      moduleId: selectedModuleIds.size === 1 ? firstModuleId : '',
    };
  }, [preSelectedCaseIds]);

  // Determine initial values from clone or context params
  const initReleaseId = template?.releaseId || cloneRun?.releaseId || paramRelease || inferredFromCases.releaseId || '';
  const initModuleId = template?.moduleId || cloneRun?.moduleId || paramModule || inferredFromCases.moduleId || '';

  // If app param provided, filter releases to that application
  const appFilteredReleases = paramApp
    ? releases.filter(r => r.applicationId === paramApp)
    : releases;

  // Auto-pick release if app has exactly one
  const autoReleaseId = paramApp && !initReleaseId && appFilteredReleases.length === 1
    ? appFilteredReleases[0].id
    : initReleaseId;

  const [step, setStep] = useState(1);
  const [runName, setRunName] = useState(template ? template.name : cloneRun ? `Clone of ${cloneRun.name}` : '');
  const [releaseId, setReleaseId] = useState(autoReleaseId);
  const [moduleId, setModuleId] = useState(initModuleId);
  const [env, setEnv] = useState<Environment>(template?.environment || cloneEnv || cloneRun?.environment || 'qa');

  // Auto-select: URL cases param > template > clone > context module
  const contextModuleCases = initModuleId
    ? testCases.filter(tc => tc.moduleId === initModuleId && tc.status === 'valid')
    : [];
  const templateCaseIds = template?.selectedCaseIds || [];
  const initialCaseIds = preSelectedCaseIds.length > 0
    ? preSelectedCaseIds
    : templateCaseIds.length > 0
      ? templateCaseIds
      : (cloneRun?.selectedCaseIds || contextModuleCases.map(tc => tc.id));
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set(initialCaseIds));
  const [iterationCounts, setIterationCounts] = useState<Record<string, number>>({});
  const casesFromLibrary = preSelectedCaseIds.length > 0;
  const [caseSearch, setCaseSearch] = useState('');
  const [casePage, setCasePage] = useState(1);
const [statusFilter, setStatusFilter] = useState<string>('all');
  const [templateSaved, setTemplateSaved] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [depsOpen, setDepsOpen] = useState(false);

  const openTemplateDialog = () => {
    if (templateSaved) return;
    setTemplateName(runName);
    setTemplateDialogOpen(true);
  };

  const handleConfirmSaveTemplate = () => {
    const finalName = `${templateName.trim()} [Template]`;
    const newTemplate: import('@/types').RunTemplate = {
      id: `tpl-${Date.now()}`,
      name: finalName,
      releaseId: releaseId,
      moduleId: moduleId,
      environment: env,
      selectedCaseIds: [...selectedCaseIds],
      teamId: currentTeam?.id,
      createdBy: 'current-user',
      createdAt: new Date().toISOString(),
    };
    addTemplate(newTemplate);
    toast({ title: 'Template Saved', description: `"${finalName}" saved for ${currentTeam?.name || 'shared use'}.` });
    setTemplateSaved(true);
    setTemplateDialogOpen(false);
  };

  const filteredModules = modules.filter(m => m.releaseId === releaseId);
  const moduleCases = casesFromLibrary
    ? testCases.filter(tc => selectedCaseIds.has(tc.id))
    : testCases.filter(tc => tc.moduleId === moduleId && tc.status === 'valid');

  const filteredCases = useMemo(() => {
    let cases = moduleCases;
    if (caseSearch) {
      const q = caseSearch.toLowerCase();
      cases = cases.filter(tc =>
        tc.caseNumber.toLowerCase().includes(q) ||
        tc.testCaseName.toLowerCase().includes(q) ||
        tc.role.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') {
      cases = cases.filter(tc => tc.status === statusFilter);
    }
    return cases;
  }, [moduleCases, caseSearch, statusFilter]);

  const totalPages = Math.ceil(filteredCases.length / ITEMS_PER_PAGE);
  const paginatedCases = filteredCases.slice((casePage - 1) * ITEMS_PER_PAGE, casePage * ITEMS_PER_PAGE);

  const toggleCase = (id: string) => {
    setSelectedCaseIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedCaseIds(new Set(moduleCases.map(tc => tc.id)));
  };

  const deselectAll = () => {
    setSelectedCaseIds(new Set());
  };

  const stepLabels = ['Configure', 'Select Cases', 'Data Prep', 'Validate', 'Execute'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">
          {template ? `From Template: ${template.name}` : cloneRun ? 'Clone Test Run' : 'New Test Run'}
        </h1>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {stepLabels.map((label, i) => {
          const s = i + 1;
          const isCompleted = step > s;
          const isActive = step === s;
          return (
            <div key={s} className="flex items-center gap-1">
              <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium ${
                isCompleted || isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}>
                {isCompleted && !isActive ? <CircleCheck className="h-4 w-4" /> : s}
              </div>
              <span className={`text-xs hidden sm:inline ${isCompleted || isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                {label}
              </span>
              {s < 5 && <ArrowRight className="h-3 w-3 text-muted-foreground mx-1" />}
            </div>
          );
        })}
      </div>

      {/* Step 1: Configure */}
      {step === 1 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Configure Test Run</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!cloneRun && (
              <div className="p-3 rounded-md bg-muted/50 border border-dashed">
                <label className="text-xs font-medium mb-1.5 block text-muted-foreground">Clone from existing run (optional)</label>
                <Select onValueChange={(v) => {
                  const run = testRuns.find(r => r.id === v);
                  if (run) {
                    setRunName(`Clone of ${run.name}`);
                    setReleaseId(run.releaseId);
                    setModuleId(run.moduleId);
                    setEnv(run.environment);
                    setSelectedCaseIds(new Set(run.selectedCaseIds || []));
                  }
                }}>
                  <SelectTrigger><SelectValue placeholder="Select a run to clone" /></SelectTrigger>
                  <SelectContent>
                    {testRuns.map(r => <SelectItem key={r.id} value={r.id}><Copy className="h-3 w-3 inline mr-1" />{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label className="text-xs font-medium mb-1.5 block">Run Name *</label>
              <Input value={runName} onChange={e => setRunName(e.target.value)} placeholder="e.g. HCM Admin Regression — R13 26A" />
            </div>
            {casesFromLibrary ? (
              <div className="p-3 rounded-md bg-primary/5 border border-primary/20 space-y-2">
                <div className="flex items-center gap-2 text-xs text-primary font-medium">
                  <CircleCheck className="h-3.5 w-3.5" />
                  {selectedCaseIds.size} test case{selectedCaseIds.size !== 1 ? 's' : ''} pre-selected from Library
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] text-muted-foreground">Release</span>
                    <div className="text-xs font-medium">{releases.find(r => r.id === releaseId)?.name || 'Multiple'}</div>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground">Module</span>
                    <div className="text-xs font-medium">{moduleId ? modules.find(m => m.id === moduleId)?.name : 'Multiple modules'}</div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-xs font-medium mb-1.5 block">Release</label>
                  <Select value={releaseId} onValueChange={(v) => { setReleaseId(v); setModuleId(''); }}>
                    <SelectTrigger><SelectValue placeholder="Select release" /></SelectTrigger>
                    <SelectContent>
                      {appFilteredReleases.map(r => <SelectItem key={r.id} value={r.id}>{r.name} ({r.version})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1.5 block">Module</label>
                  <Select value={moduleId} onValueChange={setModuleId} disabled={!releaseId}>
                    <SelectTrigger><SelectValue placeholder="Select module" /></SelectTrigger>
                    <SelectContent>
                      {filteredModules.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div>
              <label className="text-xs font-medium mb-1.5 block">Environment</label>
              <Select value={env} onValueChange={(v) => setEnv(v as Environment)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dev">Development</SelectItem>
                  <SelectItem value="qa">QA</SelectItem>
                  <SelectItem value="uat">UAT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => setStep(2)} disabled={!runName.trim() || (!casesFromLibrary && (!releaseId || !moduleId))} className="w-full">
              Continue <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Select Test Cases */}
      {step === 2 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Select Test Cases</CardTitle>
                <span className="text-xs font-medium text-primary">
                  {selectedCaseIds.size} selected out of {moduleCases.length}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {casesFromLibrary && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/20 text-xs text-primary">
                  <CircleCheck className="h-3.5 w-3.5 shrink-0" />
                  {selectedCaseIds.size} case{selectedCaseIds.size !== 1 ? 's' : ''} pre-selected from Library — set iteration counts below
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by case number, name, or role..."
                    value={caseSearch}
                    onChange={e => { setCaseSearch(e.target.value); setCasePage(1); }}
                    className="pl-9 h-9"
                  />
                </div>
                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCasePage(1); }}>
                  <SelectTrigger className="w-[120px] h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="valid">Valid</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!casesFromLibrary && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={selectAll} className="text-xs h-7">
                    <CheckSquare className="h-3 w-3 mr-1" /> Select All
                  </Button>
                  <Button size="sm" variant="outline" onClick={deselectAll} className="text-xs h-7">
                    <Square className="h-3 w-3 mr-1" /> Deselect All
                  </Button>
                </div>
              )}
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      {!casesFromLibrary && (
                        <TableHead className="w-10 px-3">
                          <Checkbox
                            checked={selectedCaseIds.size === moduleCases.length && moduleCases.length > 0}
                            onCheckedChange={() => selectedCaseIds.size === moduleCases.length ? deselectAll() : selectAll()}
                          />
                        </TableHead>
                      )}
                      <TableHead className="text-xs w-28">Case #</TableHead>
                      <TableHead className="text-xs">Test Case Name</TableHead>
                      <TableHead className="text-xs w-24">Dependency</TableHead>
                      <TableHead className="text-xs w-24">Role</TableHead>
                      <TableHead className="text-xs w-24">Type</TableHead>
                      <TableHead className="text-xs w-20">Iterations</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedCases.length === 0 ? (
                      <TableRow><TableCell colSpan={casesFromLibrary ? 6 : 7} className="text-center text-muted-foreground text-xs py-8">No test cases found</TableCell></TableRow>
                    ) : paginatedCases.map(tc => (
                      <TableRow key={tc.id} className={`${casesFromLibrary ? '' : 'cursor-pointer'} hover:bg-secondary/50`} onClick={() => !casesFromLibrary && toggleCase(tc.id)}>
                        {!casesFromLibrary && (
                          <TableCell className="px-3" onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={selectedCaseIds.has(tc.id)} onCheckedChange={() => toggleCase(tc.id)} />
                          </TableCell>
                        )}
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
                        <TableCell className="text-xs font-medium">{tc.testCaseName}</TableCell>
                        <TableCell>
                          {tc.dependency ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-primary">
                              <Link className="h-2.5 w-2.5" /> {tc.dependency}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">{tc.role}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {tc.type.charAt(0).toUpperCase() + tc.type.slice(1)}
                          </Badge>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {selectedCaseIds.has(tc.id) ? (
                            <Input
                              type="number"
                              min={1}
                              max={100}
                              value={iterationCounts[tc.id] || 1}
                              onChange={(e) => {
                                const val = Math.max(1, Math.min(100, parseInt(e.target.value) || 1));
                                setIterationCounts(prev => ({ ...prev, [tc.id]: val }));
                              }}
                              className="h-7 w-16 text-xs text-center"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="border-t px-4 py-2 text-xs text-muted-foreground bg-muted/30 flex items-center justify-between">
                  <span>{selectedCaseIds.size > 0 ? `${selectedCaseIds.size} selected · ` : ''}Showing {filteredCases.length === 0 ? 0 : (casePage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(casePage * ITEMS_PER_PAGE, filteredCases.length)} of {filteredCases.length}</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={casePage <= 1} onClick={() => setCasePage(p => p - 1)}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-xs text-muted-foreground px-2">Page {casePage} of {totalPages}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={casePage >= totalPages} onClick={() => setCasePage(p => p + 1)}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)} className="flex-1"><ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back</Button>
            <Button onClick={() => setStep(3)} disabled={selectedCaseIds.size === 0} className="flex-1">Continue <ArrowRight className="h-3.5 w-3.5 ml-1" /></Button>
          </div>
        </div>
      )}

      {/* Step 3: Data Preparation */}
      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Data Preparation</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">Export selected test cases to Excel, modify test data offline, then import back.</p>
              <div className="grid grid-cols-2 gap-3">
                <Card className="p-4 text-center cursor-pointer hover:shadow-md transition-shadow border-dashed">
                  <Download className="h-8 w-8 mx-auto mb-2 text-primary" />
                  <div className="text-sm font-medium">Export to Excel</div>
                  <div className="text-[11px] text-muted-foreground mt-1">{selectedCaseIds.size} cases with steps & data</div>
                </Card>
                <Card className="p-4 text-center cursor-pointer hover:shadow-md transition-shadow border-dashed">
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <div className="text-sm font-medium">Import from Excel</div>
                  <div className="text-[11px] text-muted-foreground mt-1">Upload modified data file</div>
                </Card>
              </div>
              <p className="text-[11px] text-muted-foreground italic">This step is optional. Skip if no data changes are needed.</p>
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)} className="flex-1"><ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back</Button>
            <Button onClick={() => setStep(4)} className="flex-1">Continue <ArrowRight className="h-3.5 w-3.5 ml-1" /></Button>
          </div>
        </div>
      )}

      {/* Step 4: Pre-Run Validation */}
      {step === 4 && (
        <div className="space-y-4">
          <PreRunValidation selectedCount={selectedCaseIds.size} totalCount={moduleCases.length} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(3)} className="flex-1"><ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back</Button>
            <Button onClick={() => setStep(5)} className="flex-1">Continue <ArrowRight className="h-3.5 w-3.5 ml-1" /></Button>
          </div>
        </div>
      )}

      {/* Step 5: Confirm & Execute */}
      {step === 5 && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="text-sm font-medium">Review & Execute</h3>
            <div className="flex justify-end">
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setDepsOpen(true)}>
                <GitBranch className="h-3 w-3 mr-1" /> Dependency Graph
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground text-xs">Run Name</span><div className="font-medium">{runName}</div></div>
              <div><span className="text-muted-foreground text-xs">Environment</span><div className="font-medium uppercase">{env}</div></div>
              <div><span className="text-muted-foreground text-xs">Release</span><div className="font-medium">{releases.find(r => r.id === releaseId)?.name}</div></div>
              <div><span className="text-muted-foreground text-xs">Module</span><div className="font-medium">{modules.find(m => m.id === moduleId)?.name}</div></div>
              <div><span className="text-muted-foreground text-xs">Test Cases</span><div className="font-medium">{selectedCaseIds.size} selected</div></div>
              <div><span className="text-muted-foreground text-xs">Total Iterations</span><div className="font-medium">{[...selectedCaseIds].reduce((sum, id) => sum + (iterationCounts[id] || 1), 0)} executions</div></div>
            </div>

            {/* Iteration & Auto-Increment Preview */}
            {(() => {
              const casesWithIterations = [...selectedCaseIds]
                .map(id => ({ tc: testCases.find(tc => tc.id === id), count: iterationCounts[id] || 1 }))
                .filter(({ count }) => count > 1);
              if (casesWithIterations.length === 0) return null;
              return (
                <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
                  <h4 className="text-xs font-medium">Iteration Preview</h4>
                  {casesWithIterations.map(({ tc, count }) => {
                    if (!tc) return null;
                    const mandatorySteps = testSteps.filter(
                      s => s.testCaseId === tc.id && s.uniqueMandatory === 'mandatory'
                    );
                    return (
                      <div key={tc.id} className="space-y-1">
                        <div className="text-xs font-medium">
                          {tc.caseNumber} — {tc.testCaseName} <Badge variant="secondary" className="text-[10px] ml-1">{count}×</Badge>
                        </div>
                        {mandatorySteps.length > 0 && (
                          <div className="ml-4 space-y-0.5">
                            <span className="text-[10px] text-muted-foreground">Auto-increment fields:</span>
                            {mandatorySteps.map(s => {
                              const hasPlaceholder = s.inputParameter.includes('{N}');
                              const example1 = hasPlaceholder
                                ? s.inputParameter.replace('{N}', '001')
                                : `${s.inputParameter}-001`;
                              const example2 = hasPlaceholder
                                ? s.inputParameter.replace('{N}', String(count).padStart(3, '0'))
                                : `${s.inputParameter}-${String(count).padStart(3, '0')}`;
                              return (
                                <div key={s.id} className="text-[10px] text-muted-foreground ml-2">
                                  Step {s.lineNumber}: <span className="font-mono text-foreground">{s.inputParameter}</span> → <span className="font-mono text-primary">{example1}</span> ... <span className="font-mono text-primary">{example2}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {mandatorySteps.length === 0 && (
                          <div className="ml-4 text-[10px] text-muted-foreground italic">No unique/mandatory fields — iterations will use identical data</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <div className="border rounded-lg p-4 bg-muted/30 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Save this configuration as a reusable template?</p>
                <p className="text-xs text-muted-foreground mt-0.5">Captures run name, release, module, environment & selected test cases for one-click future runs.</p>
              </div>
              <Button
                variant={templateSaved ? "ghost" : "secondary"}
                size="sm"
                disabled={templateSaved}
                onClick={openTemplateDialog}
                className="ml-4 shrink-0"
              >
                {templateSaved ? (
                  <><CircleCheck className="h-3.5 w-3.5 mr-1 text-status-pass" /> Template Saved</>
                ) : (
                  <><Save className="h-3.5 w-3.5 mr-1" /> Save as Template</>
                )}
              </Button>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(4)} className="flex-1"><ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back</Button>
              <Button onClick={() => navigate('/runs/run-3')} className="flex-1">
                <Play className="h-3.5 w-3.5 mr-1" /> Start Run
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save as Template Dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
            <DialogDescription>
              Give this template a name. It will appear in your sidebar for one-click future runs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium mb-1.5 block">Template Name *</label>
              <Input
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                placeholder="e.g. HCM Regression Suite"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Will be saved as: <span className="font-medium text-foreground">{templateName.trim() || '...'} [Template]</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirmSaveTemplate} disabled={!templateName.trim()}>
              <Save className="h-3.5 w-3.5 mr-1" /> Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DependencyGraphDialog
        open={depsOpen}
        onOpenChange={setDepsOpen}
        caseIds={[...selectedCaseIds]}
      />
    </div>
  );
};

export default TestRunSetup;
