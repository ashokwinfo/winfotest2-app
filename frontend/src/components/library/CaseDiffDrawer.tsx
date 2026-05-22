import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowRight, AlertTriangle, GitFork, Wrench, X, Lock, Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TestCase, TestStep, CaseDiffEntry } from '@/types';
import { resolveSteps, testSteps } from '@/data/mock';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { pushCustomization } from '@/lib/customizationApi';
import { useCompareMode } from '@/components/layout/compare-mode-context';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entry: CaseDiffEntry | null;
  /** Section to scroll to on open. Defaults to 'meta'. */
  focus?: 'meta' | 'steps';
  /** Client repo being compared against. Required for Open-in-Workbench actions. */
  compareRepoId?: string;
}

/** Fields we display + diff on. Anything else is ignored visually. */
const META_FIELDS: Array<{ key: keyof TestCase; label: string }> = [
  { key: 'testCaseName', label: 'Name' },
  { key: 'caseNumber', label: 'Case #' },
  { key: 'role', label: 'Role' },
  { key: 'description', label: 'Description' },
  { key: 'expectedResult', label: 'Expected result' },
  { key: 'status', label: 'Status' },
  { key: 'type', label: 'Type' },
];

function renderVal(v: unknown): string {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

interface AlignedStep {
  kind: 'same' | 'add' | 'remove' | 'change';
  master?: TestStep;
  client?: TestStep;
}

const STEP_TUPLE_KEYS: Array<keyof TestStep> = [
  'stepDescription', 'action', 'inputParameter', 'validationType',
  'validationName', 'dataType', 'testingType', 'uniqueMandatory',
];

function stepKey(s: TestStep): string {
  return STEP_TUPLE_KEYS.map(k => String(s[k] ?? '')).join('||');
}

function stepEqual(a: TestStep, b: TestStep): boolean {
  return STEP_TUPLE_KEYS.every(k => a[k] === b[k]);
}

/** LCS over step content; produces an aligned diff sequence. */
function alignSteps(master: TestStep[], client: TestStep[]): AlignedStep[] {
  const m = master.length, n = client.length;
  // dp[i][j] = LCS length using master[0..i-1] and client[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = stepKey(master[i - 1]) === stepKey(client[j - 1])
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const out: AlignedStep[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (stepKey(master[i - 1]) === stepKey(client[j - 1])) {
      out.push({ kind: 'same', master: master[i - 1], client: client[j - 1] });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      out.push({ kind: 'remove', master: master[i - 1] });
      i--;
    } else {
      out.push({ kind: 'add', client: client[j - 1] });
      j--;
    }
  }
  while (i > 0) { out.push({ kind: 'remove', master: master[i - 1] }); i--; }
  while (j > 0) { out.push({ kind: 'add', client: client[j - 1] }); j--; }
  out.reverse();

  // Coalesce adjacent remove+add into a single 'change' row for readability.
  const merged: AlignedStep[] = [];
  for (let k = 0; k < out.length; k++) {
    const cur = out[k], next = out[k + 1];
    if (cur.kind === 'remove' && next?.kind === 'add') {
      merged.push({ kind: 'change', master: cur.master, client: next.client });
      k++;
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

export function CaseDiffDrawer({ open, onOpenChange, entry, focus = 'meta', compareRepoId }: Props) {
  const { currentRepo, setCurrentRepo, bumpRepoVersion, isMasterRepo, activeClient, clientRepos } = useWorkspace();
  const compareMode = useCompareMode();
  const navigate = useNavigate();
  const stepsRef = useRef<HTMLDivElement | null>(null);

  // The repo whose customizations we're inspecting/editing on the client side.
  const targetClientId = compareRepoId ?? compareMode?.compareRepoId ?? (!isMasterRepo ? currentRepo : undefined);
  const targetClientName = targetClientId
    ? (clientRepos.find(c => c.id === targetClientId)?.name ?? 'client')
    : (activeClient?.name ?? 'client');

  const { alignedSteps, changedFields } = useMemo(() => {
    if (!entry) return { alignedSteps: [], changedFields: new Set<string>() };
    const ms = entry.masterCase ? testSteps.filter(s => s.testCaseId === entry.masterCase!.id) : [];
    const cs = entry.clientCase && targetClientId
      ? resolveSteps(targetClientId, entry.clientCase.id)
      : entry.clientCase
        ? resolveSteps(currentRepo, entry.clientCase.id)
        : [];
    const aligned = alignSteps(ms, cs);
    const changed = new Set<string>();
    if (entry.masterCase && entry.clientCase) {
      for (const f of META_FIELDS) {
        const a = renderVal(entry.masterCase[f.key]);
        const b = renderVal(entry.clientCase[f.key]);
        if (a !== b) changed.add(f.key as string);
      }
    }
    return { alignedSteps: aligned, changedFields: changed };
  }, [entry, currentRepo, targetClientId]);

  // Scroll to steps section when opened with focus='steps' (case-id click).
  useEffect(() => {
    if (!open || !entry) return;
    if (focus !== 'steps') return;
    // Defer until content has rendered.
    const t = window.setTimeout(() => {
      stepsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [open, entry, focus]);

  if (!entry) return null;

  const statusTone =
    entry.status === 'new' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' :
    entry.status === 'modified' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30' :
    entry.status === 'deleted' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30' :
    'bg-secondary/60 text-muted-foreground border-border';

  const reFork = async () => {
    if (!entry.masterCase || !targetClientId) return;
    await pushCustomization(targetClientId, { kind: 'revert', caseId: entry.masterCase.id });
    await pushCustomization(targetClientId, { kind: 'customize', masterCaseId: entry.masterCase.id });
    bumpRepoVersion();
    toast.success('Re-forked from latest master', {
      description: 'Your customization was rebased on the current master baseline. Re-apply changes as needed.',
    });
    onOpenChange(false);
  };

  // ---- Open-in-Workbench actions (client side only) ----
  const goToClientCase = (caseId: string, openWorkbench: boolean) => {
    if (targetClientId) setCurrentRepo(targetClientId);
    onOpenChange(false);
    // Exit Compare mode (if active) BEFORE navigating, so we land in the standard editor shell.
    compareMode?.exit();
    // Navigate after a tick so route changes apply cleanly.
    window.setTimeout(() => {
      navigate(`/test-case/${caseId}${openWorkbench ? '?wb=1' : ''}`);
    }, 0);
  };

  const handleOpenClientWorkbench = async () => {
    if (!targetClientId) {
      toast.error('No client repository selected');
      return;
    }
    if (entry.clientCase) {
      goToClientCase(entry.clientCase.id, true);
      return;
    }
    // Inherited / new — fork first, then open.
    if (!entry.masterCase) return;
    const ovr = await pushCustomization(targetClientId, {
      kind: 'customize', masterCaseId: entry.masterCase.id,
    });
    bumpRepoVersion();
    if (ovr?.testCase?.id) {
      toast.success(`Customized for ${targetClientName}`, {
        description: 'Opened in Workbench so you can edit the client copy.',
      });
      goToClientCase(ovr.testCase.id, true);
    }
  };

  const handleRestoreAndOpen = async () => {
    if (!targetClientId || !entry.masterCase) return;
    await pushCustomization(targetClientId, { kind: 'revert', caseId: entry.masterCase.id });
    bumpRepoVersion();
    // After revert the client now inherits master; customize so they can edit.
    const ovr = await pushCustomization(targetClientId, {
      kind: 'customize', masterCaseId: entry.masterCase.id,
    });
    bumpRepoVersion();
    if (ovr?.testCase?.id) {
      toast.success(`Restored from master for ${targetClientName}`);
      goToClientCase(ovr.testCase.id, true);
    }
  };

  // Decide which client-side action button to show.
  let clientAction: React.ReactNode = null;
  if (entry.status === 'modified' || entry.status === 'unchanged' || entry.status === 'new') {
    const isCustomized = !!entry.clientCase && entry.status === 'modified';
    clientAction = (
      <Button size="sm" className="text-xs h-8" onClick={handleOpenClientWorkbench}>
        <Wrench className="h-3.5 w-3.5 mr-1" />
        {isCustomized ? `Open in Workbench` : `Customize & open`}
      </Button>
    );
  } else if (entry.status === 'deleted') {
    clientAction = (
      <Button size="sm" variant="outline" className="text-xs h-8" onClick={handleRestoreAndOpen}>
        <Undo2 className="h-3.5 w-3.5 mr-1" />
        Restore & open
      </Button>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-none sm:w-[min(1100px,95vw)] overflow-y-auto p-0"
      >
        <div className="p-5 border-b sticky top-0 bg-background z-10">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-sm">
              <Badge variant="outline" className={cn('text-[10px] uppercase tracking-wider', statusTone)}>
                {entry.status}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">{entry.caseNumber}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium">{entry.testCaseName}</span>
            </SheetTitle>
            <SheetDescription className="text-xs">
              Master ↔ {targetClientName} comparison · {alignedSteps.length} step row{alignedSteps.length === 1 ? '' : 's'}
            </SheetDescription>
          </SheetHeader>
        </div>

        {/* Metadata diff */}
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Master {entry.masterCase?.version ? `· v${entry.masterCase.version}` : ''}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              {targetClientName}
            </div>
          </div>

          {META_FIELDS.map(f => {
            const isChanged = changedFields.has(f.key as string);
            const m = entry.masterCase ? renderVal(entry.masterCase[f.key]) : '—';
            const c = entry.clientCase ? renderVal(entry.clientCase[f.key]) : '—';
            return (
              <div key={String(f.key)} className="grid grid-cols-2 gap-3">
                <FieldCell label={f.label} value={m} highlighted={isChanged && !!entry.masterCase} side="left" />
                <FieldCell label={f.label} value={c} highlighted={isChanged && !!entry.clientCase} side="right" />
              </div>
            );
          })}
        </div>

        {/* Steps diff */}
        <div className="px-5 pb-5" id="steps-diff" ref={stepsRef}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
            Test steps
          </div>
          {alignedSteps.length === 0 ? (
            <div className="text-xs text-muted-foreground italic py-4">
              No steps recorded on either side.
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden divide-y">
              {alignedSteps.map((row, idx) => (
                <StepDiffRow key={idx} row={row} />
              ))}
            </div>
          )}
        </div>

        {/* Drift banner (in-flow, above the action footer) */}
        {entry.driftFromMaster && entry.masterCase && entry.clientCase && (
          <div className="border-t bg-amber-500/5 px-5 py-3 flex items-center justify-between">
            <div className="flex items-start gap-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5" />
              <div>
                <div className="font-medium text-amber-700 dark:text-amber-400">
                  Master has advanced past this customization
                </div>
                <div className="text-muted-foreground">
                  Current master v{entry.masterCase.version ?? 1}
                </div>
              </div>
            </div>
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={reFork}>
              <GitFork className="h-3 w-3 mr-1" /> Re-fork from latest
            </Button>
          </div>
        )}

        {/* Action footer — per-side actions reinforce the rule:
            master cases are read-only inside Compare, client cases can be opened in Workbench. */}
        <div className="border-t bg-muted/30 px-5 py-3 sticky bottom-0 grid grid-cols-2 gap-4">
          {/* Master side */}
          <div className="flex items-start gap-2 text-xs">
            <Lock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium text-foreground">Master is read-only here</div>
              <div className="text-muted-foreground">
                Exit Compare and switch to Master to edit master cases in the Workbench.
              </div>
              {compareMode && (
                <Button
                  size="sm" variant="ghost" className="text-xs h-7 px-2 mt-1 -ml-2"
                  onClick={() => { onOpenChange(false); compareMode.exit(); }}
                >
                  <X className="h-3 w-3 mr-1" /> Exit Compare
                </Button>
              )}
            </div>
          </div>

          {/* Client side */}
          <div className="flex items-start gap-2 text-xs justify-end">
            <div className="text-right">
              <div className="font-medium text-foreground">{targetClientName} customization</div>
              <div className="text-muted-foreground mb-1.5">
                {entry.status === 'modified'  && 'Edit this client-only fork.'}
                {entry.status === 'unchanged' && `Inherited from master — fork to edit for ${targetClientName}.`}
                {entry.status === 'new'       && `Not yet in ${targetClientName} — fork to create a client copy.`}
                {entry.status === 'deleted'   && `Removed from ${targetClientName} — restore to edit.`}
              </div>
              <div className="flex justify-end">{clientAction}</div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FieldCell({
  label, value, highlighted, side,
}: { label: string; value: string; highlighted: boolean; side: 'left' | 'right' }) {
  return (
    <div
      className={cn(
        'rounded border p-2 text-xs',
        highlighted
          ? side === 'left'
            ? 'bg-rose-500/5 border-rose-500/30'
            : 'bg-emerald-500/5 border-emerald-500/30'
          : 'bg-secondary/30 border-border',
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</div>
      <div className="whitespace-pre-wrap break-words">{value}</div>
    </div>
  );
}

function StepDiffRow({ row }: { row: AlignedStep }) {
  const tone =
    row.kind === 'add' ? 'border-l-emerald-500 bg-emerald-500/5' :
    row.kind === 'remove' ? 'border-l-rose-500 bg-rose-500/5' :
    row.kind === 'change' ? 'border-l-amber-500 bg-amber-500/5' :
    'border-l-transparent';

  const sym =
    row.kind === 'add' ? '+' :
    row.kind === 'remove' ? '−' :
    row.kind === 'change' ? '~' : '=';

  return (
    <div className={cn('grid grid-cols-[24px_1fr_1fr] gap-2 px-2 py-1.5 border-l-4 text-xs', tone)}>
      <div className="text-center font-mono text-muted-foreground">{sym}</div>
      <div className={cn(row.kind === 'remove' && 'line-through opacity-70')}>
        {row.master ? <StepCell s={row.master} /> : <span className="text-muted-foreground italic">—</span>}
      </div>
      <div>
        {row.client ? <StepCell s={row.client} /> : <span className="text-muted-foreground italic">—</span>}
      </div>
    </div>
  );
}

function StepCell({ s }: { s: TestStep }) {
  return (
    <div>
      <div className="font-medium">
        <span className="text-muted-foreground font-mono mr-1">{s.lineNumber}.</span>
        {s.stepDescription}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">
        {s.action}{s.inputParameter ? ` · "${s.inputParameter}"` : ''}
      </div>
    </div>
  );
}
