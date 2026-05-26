import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { actionTypeOptions, validationTypeOptions, dataTypeOptions } from '@/data/mock';
import type { TestCase, TestStep, StepAction, ValidationTypeEnum, DataType, TestingType } from '@/types';
import {
  Play, SkipForward, Plus, Save, Upload, Globe, Lock,
  Check, Circle, Loader2, Trash2, Radio, Info, X, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { RecordingPanel, DEMO_INTERACTIONS } from './RecordingPanel';

const buildSeedRecordedSteps = (testCaseId: string): TestStep[] =>
  DEMO_INTERACTIONS.map((demo, idx) => ({
    id: `ts-seed-${testCaseId}-${idx}`,
    testCaseId,
    lineNumber: (idx + 1) * 10,
    stepDescription: demo.description,
    inputParameter: demo.input,
    action: demo.action,
    validationType: demo.action === 'validate_text' ? 'validation_from_application' : 'not_applicable',
    validationName: demo.action === 'validate_text' ? demo.input : 'Not Applicable',
    uniqueMandatory: 'not_applicable',
    dataType: 'not_applicable',
    testingType: demo.action === 'validate_text' ? 'positive' : 'not_applicable',
  }));

type StepStatus = 'pending' | 'running' | 'passed';
type WorkbenchMode = 'manual' | 'record';
type StepSource = 'recorded' | 'manual';

interface WorkbenchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testCase: TestCase;
  steps: TestStep[];
  onSave: (steps: TestStep[], testCase: TestCase) => void;
}

const emptyStep = (testCaseId: string, lineNumber: number): TestStep => ({
  id: `ts-new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  testCaseId,
  lineNumber,
  stepDescription: '',
  inputParameter: '',
  action: 'click_button',
  validationType: 'not_applicable',
  validationName: 'Not Applicable',
  uniqueMandatory: 'not_applicable',
  dataType: 'not_applicable',
  testingType: 'not_applicable',
});

// Action category for grouping
const actionGroup = (action: StepAction): string => {
  if (action === 'login_into_application') return 'Login';
  if (action === 'navigate_to_url' || action === 'click_link') return 'Navigation';
  if (action.startsWith('enter_value') || action === 'select_dropdown' || action === 'date_picker' || action === 'key_tab' || action === 'key_enter') return 'Form Entry';
  if (action === 'click_button' || action === 'click_icon') return 'Action';
  if (action.startsWith('validate')) return 'Validation';
  if (action === 'wait_till_load' || action === 'scroll_down') return 'Navigation';
  return 'Other';
};

// Suggested next actions based on previous step's action
const suggestNextActions = (prevAction: StepAction | null): StepAction[] => {
  if (!prevAction) return ['click_button', 'enter_value_text_field', 'navigate_to_url'];
  switch (prevAction) {
    case 'click_button':
    case 'click_icon':
      return ['enter_value_text_field', 'validate_text', 'wait_till_load'];
    case 'enter_value_text_field':
    case 'enter_value_text_field_oj':
      return ['key_tab', 'click_button', 'enter_value_text_field'];
    case 'select_dropdown':
      return ['click_button', 'validate_element', 'enter_value_text_field'];
    case 'navigate_to_url':
      return ['wait_till_load', 'click_button', 'validate_text'];
    case 'login_into_application':
      return ['click_button', 'navigate_to_url', 'wait_till_load'];
    default:
      return ['click_button', 'validate_text', 'wait_till_load'];
  }
};

// Friendly data labels
const dataSourceLabel = (dataType: DataType): string => {
  if (dataType === 'not_applicable') return '—';
  return 'Test Data';
};
const dataTypeLabel = (dataType: DataType, unique: string): string => {
  const base = {
    alpha_numeric: 'Alphanumeric',
    numeric: 'Numeric',
    date: 'Date',
    text: 'Text',
    not_applicable: '—',
  }[dataType];
  if (unique === 'mandatory' && dataType !== 'not_applicable') return `${base} (Unique / Auto Increment)`;
  return base;
};

// Confidence heuristic
const stepConfidence = (step: TestStep, source: StepSource): { level: 'High' | 'Medium' | 'Low'; dots: number } => {
  if (source === 'recorded' && step.inputParameter) return { level: 'High', dots: 3 };
  if (source === 'recorded') return { level: 'High', dots: 3 };
  if (step.stepDescription && step.inputParameter) return { level: 'Medium', dots: 2 };
  return { level: 'Low', dots: 1 };
};

export const WorkbenchDialog = ({ open, onOpenChange, testCase, steps: initialSteps, onSave }: WorkbenchDialogProps) => {
  const [mode, setMode] = useState<WorkbenchMode>('record');
  const [localSteps, setLocalSteps] = useState<TestStep[]>(initialSteps);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(initialSteps.map(() => 'pending'));
  const [insertingAtIndex, setInsertingAtIndex] = useState<number | null>(null);
  const [newStep, setNewStep] = useState<TestStep | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Recording mode state — seed with demo steps so users see capabilities immediately
  const seededSteps = buildSeedRecordedSteps(testCase.id);
  const [recordedSteps, setRecordedSteps] = useState<TestStep[]>(seededSteps);
  const [recordedIds, setRecordedIds] = useState<Set<string>>(new Set(seededSteps.map(s => s.id)));
  const [highlightStepId, setHighlightStepId] = useState<string | null>(null);

  // Step intelligence overlay
  const [showIntelligence, setShowIntelligence] = useState(false);

  // Refs for auto-scroll
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const lastStepRef = useRef<HTMLDivElement | null>(null);

  const resetOnOpen = () => {
    setLocalSteps(initialSteps);
    setCurrentStepIndex(0);
    setStepStatuses(initialSteps.map(() => 'pending'));
    setInsertingAtIndex(null);
    setNewStep(null);
    setHasChanges(false);
    setMode('record');
    const seeded = buildSeedRecordedSteps(testCase.id);
    setRecordedSteps(seeded);
    setRecordedIds(new Set(seeded.map(s => s.id)));
    setHighlightStepId(null);
    setShowIntelligence(false);
  };

  // Auto-scroll to latest captured step
  useEffect(() => {
    if (mode === 'record' && lastStepRef.current) {
      lastStepRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [recordedSteps.length, mode]);

  // Clear highlight after delay
  useEffect(() => {
    if (highlightStepId) {
      const t = setTimeout(() => setHighlightStepId(null), 1500);
      return () => clearTimeout(t);
    }
  }, [highlightStepId]);

  const runCurrentStep = () => {
    if (currentStepIndex >= localSteps.length) return;
    const next = [...stepStatuses];
    next[currentStepIndex] = 'running';
    setStepStatuses(next);
    setTimeout(() => {
      const done = [...next];
      done[currentStepIndex] = 'passed';
      setStepStatuses(done);
    }, 800);
  };

  const nextStep = () => {
    if (stepStatuses[currentStepIndex] !== 'passed') return;
    if (currentStepIndex < localSteps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    }
  };

  const startInsert = (atIndex: number) => {
    const list = mode === 'record' ? recordedSteps : localSteps;
    const prevLine = atIndex > 0 ? list[atIndex - 1].lineNumber : 0;
    const nextLine = atIndex < list.length ? list[atIndex].lineNumber : prevLine + 20;
    const newLine = Math.floor((prevLine + nextLine) / 2) || prevLine + 10;
    setInsertingAtIndex(atIndex);
    setNewStep(emptyStep(testCase.id, newLine));
  };

  const confirmInsert = () => {
    if (!newStep || insertingAtIndex === null) return;
    if (mode === 'record') {
      const updated = [...recordedSteps];
      updated.splice(insertingAtIndex, 0, newStep);
      setRecordedSteps(updated);
      // Do NOT add to recordedIds — inserted steps remain "Manual" source
    } else {
      const updated = [...localSteps];
      updated.splice(insertingAtIndex, 0, newStep);
      setLocalSteps(updated);
      const statuses = [...stepStatuses];
      statuses.splice(insertingAtIndex, 0, 'pending');
      setStepStatuses(statuses);
    }
    setInsertingAtIndex(null);
    setNewStep(null);
    setHasChanges(true);
  };

  const cancelInsert = () => {
    setInsertingAtIndex(null);
    setNewStep(null);
  };

  const removeStep = (index: number) => {
    if (mode === 'record') {
      const removed = recordedSteps[index];
      setRecordedSteps(recordedSteps.filter((_, i) => i !== index));
      if (removed) {
        setRecordedIds(prev => {
          const next = new Set(prev);
          next.delete(removed.id);
          return next;
        });
      }
    } else {
      setLocalSteps(localSteps.filter((_, i) => i !== index));
      const statuses = [...stepStatuses];
      statuses.splice(index, 1);
      setStepStatuses(statuses);
      if (currentStepIndex >= localSteps.length - 1) {
        setCurrentStepIndex(Math.max(0, localSteps.length - 2));
      }
    }
    setHasChanges(true);
  };

  const handleStepCaptured = (step: TestStep) => {
    setRecordedSteps(prev => [...prev, step]);
    setRecordedIds(prev => new Set(prev).add(step.id));
    setHighlightStepId(step.id);
    setHasChanges(true);
  };

  const handleClearRecordedSteps = () => {
    setRecordedSteps([]);
  };

  const handleApplyRecordedSteps = () => {
    setLocalSteps([...localSteps, ...recordedSteps]);
    setStepStatuses([...stepStatuses, ...recordedSteps.map(() => 'pending' as StepStatus)]);
    setRecordedSteps([]);
    setMode('manual');
    setHasChanges(true);
  };

  const handleSaveDraft = () => {
    const updatedCase: TestCase = { ...testCase, status: 'draft' };
    onSave(localSteps, updatedCase);
    onOpenChange(false);
  };

  const handlePublish = () => {
    const currentVersion = testCase.version ?? 0;
    const variantNumber = currentVersion + 1;
    const baseCaseNumber = testCase.caseNumber.split('.')[0];
    const updatedCase: TestCase = {
      ...testCase,
      id: `${testCase.id}-v${variantNumber}`,
      caseNumber: `${baseCaseNumber}.${variantNumber}`,
      parentCaseId: testCase.parentCaseId ?? testCase.id,
      version: variantNumber,
      type: 'customized',
      status: 'valid',
      updatedAt: new Date().toISOString(),
    };
    const updatedSteps = localSteps.map(s => ({ ...s, testCaseId: updatedCase.id }));
    onSave(updatedSteps, updatedCase);
    onOpenChange(false);
  };

  const stepStatusIcon = (status: StepStatus) => {
    switch (status) {
      case 'passed': return <Check className="h-3.5 w-3.5 text-[hsl(var(--status-pass))]" />;
      case 'running': return <Loader2 className="h-3.5 w-3.5 text-[hsl(var(--status-running))] animate-spin" />;
      default: return <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />;
    }
  };

  const currentStep = localSteps[currentStepIndex];
  const actionLabel = (action: string) => actionTypeOptions.find(o => o.value === action)?.label ?? action;

  const activeSteps = mode === 'record' ? recordedSteps : localSteps;
  const stepSource = (stepId: string): StepSource => recordedIds.has(stepId) ? 'recorded' : 'manual';

  const prevActionForInsert = insertingAtIndex !== null && insertingAtIndex > 0
    ? activeSteps[insertingAtIndex - 1]?.action ?? null
    : null;
  const suggestedActions = suggestNextActions(prevActionForInsert);

  const insertForm = newStep && (
    <div className="border rounded-md p-3 bg-accent/30 space-y-2 animate-fade-in">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-medium text-muted-foreground">New Step</div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Sparkles className="h-2.5 w-2.5" /> Suggested
        </div>
      </div>
      {/* Suggested action chips */}
      <div className="flex flex-wrap gap-1">
        {suggestedActions.map(action => (
          <button
            key={action}
            type="button"
            onClick={() => setNewStep({ ...newStep, action })}
            className={cn(
              'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
              newStep.action === action
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:bg-muted'
            )}
          >
            {actionLabel(action)}
          </button>
        ))}
      </div>
      <Input
        placeholder="Step description"
        value={newStep.stepDescription}
        onChange={(e) => setNewStep({ ...newStep, stepDescription: e.target.value })}
        className="h-7 text-xs"
      />
      <div className="grid grid-cols-2 gap-2">
        <Select value={newStep.action} onValueChange={(v) => setNewStep({ ...newStep, action: v as StepAction })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {actionTypeOptions.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          placeholder="Input parameter"
          value={newStep.inputParameter}
          onChange={(e) => setNewStep({ ...newStep, inputParameter: e.target.value })}
          className="h-7 text-xs"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Select value={newStep.validationType} onValueChange={(v) => setNewStep({ ...newStep, validationType: v as ValidationTypeEnum })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {validationTypeOptions.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={newStep.dataType} onValueChange={(v) => setNewStep({ ...newStep, dataType: v as DataType })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {dataTypeOptions.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={newStep.testingType} onValueChange={(v) => setNewStep({ ...newStep, testingType: v as TestingType })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="not_applicable" className="text-xs">Not Applicable</SelectItem>
            <SelectItem value="positive" className="text-xs">Positive</SelectItem>
            <SelectItem value="negative" className="text-xs">Negative</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelInsert}>Cancel</Button>
        <Button size="sm" className="h-7 text-xs" onClick={confirmInsert}>Add</Button>
      </div>
    </div>
  );

  // Build groups for visual separation (manual mode)
  const renderGroupSeparator = (i: number) => {
    if (mode !== 'manual') return null;
    if (i === 0) {
      const group = activeSteps[0] ? actionGroup(activeSteps[0].action) : null;
      return group ? (
        <div className="px-3 pt-1 pb-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{group}</span>
        </div>
      ) : null;
    }
    const prev = actionGroup(activeSteps[i - 1].action);
    const curr = actionGroup(activeSteps[i].action);
    if (prev !== curr) {
      return (
        <div className="px-3 pt-2 pb-0.5 border-t border-border/40 mt-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{curr}</span>
        </div>
      );
    }
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetOnOpen(); onOpenChange(v); }}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <DialogHeader className="space-y-0">
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              Workbench
              <span className="text-xs font-mono text-muted-foreground">— {testCase.caseNumber}</span>
              <span className="text-xs text-muted-foreground">{testCase.testCaseName}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-3">
            {/* Promoted Mode toggle */}
            <div className="flex flex-col items-end gap-0.5">
              <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
                <button
                  onClick={() => setMode('record')}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-7 px-3 rounded text-xs font-medium transition-colors',
                    mode === 'record'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Radio className={cn('h-3 w-3', mode === 'record' && 'fill-current')} />
                  Record from Application
                </button>
                <button
                  onClick={() => setMode('manual')}
                  className={cn(
                    'inline-flex items-center h-7 px-3 rounded text-xs font-medium transition-colors',
                    mode === 'manual'
                      ? 'bg-background text-foreground border'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Build Manually
                </button>
              </div>
              <span className="text-[10px] text-muted-foreground italic">
                Recording is the fastest way to build flows
              </span>
            </div>

            {mode === 'record' && recordedSteps.length > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleApplyRecordedSteps}>
                Apply {recordedSteps.length} Steps
              </Button>
            )}

            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleSaveDraft} disabled={!hasChanges}>
              <Save className="h-3 w-3 mr-1" /> Save as Draft
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" className="h-7 text-xs" disabled={!hasChanges}>
                  <Upload className="h-3 w-3 mr-1" /> Publish
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Publish customized test case?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will create a new variant ({testCase.caseNumber.split('.')[0]}.{(testCase.version ?? 0) + 1}) marked as "Customized" and replace the current version in this module.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handlePublish}>Publish</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Split Layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel — Steps */}
          <div className="w-[40%] border-r flex flex-col">
            <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {mode === 'record' ? `${recordedSteps.length} Captured` : `${localSteps.length} Steps`}
              </span>
              {mode === 'record' && recordedSteps.length > 0 && (
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={handleClearRecordedSteps}>
                  Clear All
                </Button>
              )}
            </div>
            <ScrollArea className="flex-1" ref={scrollAreaRef}>
              <div className="p-2 space-y-0.5">
                {activeSteps.map((step, i) => {
                  const isLast = i === activeSteps.length - 1;
                  const isHighlighted = highlightStepId === step.id;
                  const source = stepSource(step.id);
                  return (
                    <div key={step.id} ref={isLast ? lastStepRef : undefined}>
                      {/* Group separator (manual only) */}
                      {renderGroupSeparator(i)}

                      {/* Insert button — available in both modes */}
                      {insertingAtIndex === i ? insertForm : (
                        <button
                          className="w-full flex items-center justify-center py-0.5 opacity-0 hover:opacity-100 transition-opacity"
                          onClick={() => startInsert(i)}
                        >
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1 hover:text-primary">
                            <Plus className="h-2.5 w-2.5" /> Insert step
                          </span>
                        </button>
                      )}

                      {/* Step row */}
                      <div
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-xs group transition-all',
                          mode === 'manual' && i === currentStepIndex ? 'bg-accent border border-border' : 'hover:bg-muted/50',
                          isHighlighted && 'ring-2 ring-primary/40 animate-fade-in'
                        )}
                        onClick={() => mode === 'manual' && setCurrentStepIndex(i)}
                      >
                        {mode === 'manual' ? stepStatusIcon(stepStatuses[i]) : (
                          <Check className="h-3.5 w-3.5 text-[hsl(var(--status-pass))]" />
                        )}
                        {/* Sequential number badge */}
                        <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-muted text-foreground text-[10px] font-medium shrink-0">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium">{step.stepDescription || 'Untitled step'}</div>
                          <div className="text-muted-foreground truncate flex items-center gap-1.5">
                            <span>{actionLabel(step.action)}</span>
                            {source === 'recorded' && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] text-primary">
                                <Radio className="h-2 w-2" /> rec
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost" size="icon"
                          className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                          onClick={(e) => { e.stopPropagation(); removeStep(i); }}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {/* Insert at end — available in both modes */}
                {insertingAtIndex === activeSteps.length ? insertForm : (
                  <button
                    className="w-full flex items-center justify-center py-2 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                    onClick={() => startInsert(activeSteps.length)}
                  >
                    <Plus className="h-2.5 w-2.5 mr-1" /> Add step at end
                  </button>
                )}

                {mode === 'record' && recordedSteps.length === 0 && insertingAtIndex === null && (
                  <div className="text-center py-8 text-xs text-muted-foreground">
                    Steps will appear here as you interact with the application
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Right Panel */}
          {mode === 'manual' ? (
            <div className="flex-1 flex flex-col bg-muted/20 relative">
              {/* Mock browser chrome with details toggle */}
              <div className="flex items-center gap-2 px-4 py-2 border-b bg-background">
                <div className="flex gap-1">
                  <div className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--status-skipped))]/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--status-pass))]/60" />
                </div>
                <div className="flex-1 flex items-center gap-2 bg-muted/50 rounded-md px-3 py-1 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  <Globe className="h-3 w-3" />
                  <span className="truncate">https://app.example.com/module/page</span>
                </div>
                {currentStep && (
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 text-[11px] px-2"
                    onClick={() => setShowIntelligence(s => !s)}
                  >
                    <Info className="h-3 w-3 mr-1" />
                    {showIntelligence ? 'Hide' : 'Details'}
                  </Button>
                )}
              </div>

              {/* Step execution area */}
              <div className="flex-1 flex flex-col items-center justify-center p-8">
                {currentStep ? (
                  <div className="max-w-md w-full space-y-6 text-center">
                    <div>
                      <Badge variant="outline" className="mb-3 text-[10px]">
                        Step {currentStepIndex + 1} of {localSteps.length}
                      </Badge>
                      <h3 className="text-sm font-semibold">{currentStep.stepDescription || 'Untitled step'}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{actionLabel(currentStep.action)}</p>
                      {currentStep.inputParameter && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Input: <span className="font-mono">{currentStep.inputParameter}</span>
                        </p>
                      )}
                    </div>

                    {/* Data visibility sub-card */}
                    {currentStep.inputParameter && currentStep.dataType !== 'not_applicable' && (
                      <div className="bg-muted/40 rounded p-2.5 text-[11px] text-left max-w-[260px] mx-auto space-y-1">
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Input</span>
                          <span className="font-mono truncate">{currentStep.inputParameter}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Source</span>
                          <span>{dataSourceLabel(currentStep.dataType)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Type</span>
                          <span>{dataTypeLabel(currentStep.dataType, currentStep.uniqueMandatory)}</span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-center gap-3">
                      <Button
                        size="sm"
                        onClick={runCurrentStep}
                        disabled={stepStatuses[currentStepIndex] !== 'pending'}
                      >
                        <Play className="h-3.5 w-3.5 mr-1" />
                        {stepStatuses[currentStepIndex] === 'running' ? 'Running…' : 'Run Step'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={nextStep}
                        disabled={stepStatuses[currentStepIndex] !== 'passed' || currentStepIndex >= localSteps.length - 1}
                      >
                        Next <SkipForward className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </div>

                    {stepStatuses[currentStepIndex] === 'passed' && (
                      <div className="flex items-center justify-center gap-1.5 text-xs text-[hsl(var(--status-pass))]">
                        <Check className="h-3.5 w-3.5" /> Step passed
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No steps to execute</p>
                )}
              </div>

              {/* Step Intelligence overlay */}
              {showIntelligence && currentStep && (
                <div className="absolute bottom-14 right-4 w-[280px] bg-background border rounded-lg shadow-lg p-3 animate-fade-in">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold flex items-center gap-1.5">
                      <Info className="h-3 w-3" /> Step Details
                    </span>
                    <button onClick={() => setShowIntelligence(false)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="space-y-1.5 text-[11px]">
                    {(() => {
                      const src = stepSource(currentStep.id);
                      const conf = stepConfidence(currentStep, src);
                      return (
                        <>
                          <div className="flex justify-between gap-3">
                            <span className="text-muted-foreground">Action</span>
                            <span className="font-medium">{actionLabel(currentStep.action)}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-muted-foreground">Element</span>
                            <span className="truncate">{currentStep.stepDescription || '—'}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-muted-foreground">Confidence</span>
                            <span className="flex items-center gap-1">
                              <span className="flex gap-0.5">
                                {[1, 2, 3].map(d => (
                                  <span key={d} className={cn(
                                    'h-1.5 w-1.5 rounded-full',
                                    d <= conf.dots ? 'bg-primary' : 'bg-muted'
                                  )} />
                                ))}
                              </span>
                              {conf.level}
                            </span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-muted-foreground">Source</span>
                            <span className="capitalize">{src}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-muted-foreground">Input</span>
                            <span className="font-mono truncate">{currentStep.inputParameter || '—'}</span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Step progress bar */}
              <div className="border-t px-4 py-2 bg-background flex items-center gap-1">
                {localSteps.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-1.5 flex-1 rounded-full transition-colors',
                      stepStatuses[i] === 'passed' ? 'bg-[hsl(var(--status-pass))]' :
                      stepStatuses[i] === 'running' ? 'bg-[hsl(var(--status-running))]' :
                      'bg-muted'
                    )}
                  />
                ))}
              </div>
            </div>
          ) : (
            <RecordingPanel
              testCaseId={testCase.id}
              onStepCaptured={handleStepCaptured}
              onClearAll={handleClearRecordedSteps}
              capturedSteps={recordedSteps}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
