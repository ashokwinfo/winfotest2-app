import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Send, Building2, AlertTriangle, Plus, Trash2, ShieldCheck, ChevronDown, ChevronRight,
  CheckCircle2, ArrowLeft, ArrowRight,
} from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { previewPublish, publishMasterToClient } from '@/lib/customizationApi';
import type { PublishPreview, PublishRecord } from '@/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When set, the targets step is skipped and only this client is published. */
  onlyClientId?: string | null;
}

type Step = 'targets' | 'preview' | 'result';

/**
 * 3-step publish wizard: pick targets → preview per-client changes → confirm/result.
 *
 * Big shift from the previous single-screen version: the admin sees exactly
 * what will be added, removed, and protected (skipped because customized) for
 * each selected client BEFORE publishing.
 */
export function PublishToClientsDialog({ open, onOpenChange, onlyClientId = null }: Props) {
  const { clientRepos, bumpRepoVersion } = useWorkspace();
  const [step, setStep] = useState<Step>(onlyClientId ? 'preview' : 'targets');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<Record<string, PublishPreview>>({});
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [results, setResults] = useState<PublishRecord[]>([]);
  const [busy, setBusy] = useState(false);

  // Reset on open / when scope changes.
  useEffect(() => {
    if (!open) return;
    setResults([]);
    if (onlyClientId) {
      setSelected(new Set([onlyClientId]));
      setStep('preview');
    } else {
      setSelected(new Set(clientRepos.map(c => c.id)));
      setStep('targets');
    }
  }, [open, onlyClientId, clientRepos]);

  // Load previews when entering the preview step.
  useEffect(() => {
    if (step !== 'preview' || !open) return;
    let cancelled = false;
    setLoadingPreview(true);
    Promise.all(Array.from(selected).map(id => previewPublish(id)))
      .then(arr => {
        if (cancelled) return;
        setPreviews(Object.fromEntries(arr.map(p => [p.clientRepoId, p])));
      })
      .finally(() => !cancelled && setLoadingPreview(false));
    return () => { cancelled = true; };
  }, [step, open, selected]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const totals = useMemo(() => {
    let added = 0, removed = 0, protectedCount = 0;
    for (const id of selected) {
      const p = previews[id];
      if (!p) continue;
      added += p.added.length;
      removed += p.removed.length;
      protectedCount += p.protected.length;
    }
    return { added, removed, protectedCount };
  }, [previews, selected]);

  const noChanges = step === 'preview' && !loadingPreview &&
    Object.values(previews).every(p => p.added.length === 0 && p.removed.length === 0);

  const onConfirm = async () => {
    setBusy(true);
    try {
      const recs = await Promise.all(
        Array.from(selected).map(id => publishMasterToClient(id).then(r => r.record)),
      );
      setResults(recs);
      bumpRepoVersion();
      setStep('result');
      toast.success(`Published to ${recs.length} client${recs.length === 1 ? '' : 's'}`, {
        description: `${recs.reduce((s, r) => s + r.added, 0)} added · ${recs.reduce((s, r) => s + r.removed, 0)} removed · ${recs.reduce((s, r) => s + r.protectedCount, 0)} preserved`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base flex items-center gap-2">
            <Send className="h-4 w-4" /> Publish master to clients
          </DialogTitle>
          <DialogDescription className="text-xs">
            Master is the source of truth. New cases will be added to clients, deleted cases will be
            removed. Customized cases are <strong>never overwritten</strong> — they're flagged so the
            client can re-fork when ready.
          </DialogDescription>
          <Stepper step={step} />
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 'targets' && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                Select target clients
              </div>
              {clientRepos.map(c => (
                <label
                  key={c.id}
                  className="flex items-center gap-3 rounded-md border p-3 hover:bg-secondary/40 cursor-pointer"
                >
                  <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <div className="flex-1 text-sm">{c.name}</div>
                  <div className="text-[11px] text-muted-foreground">Baseline v{c.baselineVersion}</div>
                </label>
              ))}
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-3">
              {loadingPreview ? (
                <div className="text-xs text-muted-foreground py-8 text-center">Computing changes…</div>
              ) : noChanges ? (
                <div className="rounded-md border bg-emerald-500/5 border-emerald-500/30 p-4 text-xs flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium text-emerald-700 dark:text-emerald-400">All selected clients are up to date</div>
                    <div className="text-muted-foreground mt-0.5">
                      Master has no pending additions or removals to publish. You can still re-publish
                      to bump the baseline.
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <SummaryBar added={totals.added} removed={totals.removed} protectedCount={totals.protectedCount} />
                  {Array.from(selected).map(id => {
                    const p = previews[id];
                    if (!p) return null;
                    return <ClientPreviewCard key={id} preview={p} />;
                  })}
                </>
              )}
            </div>
          )}

          {step === 'result' && (
            <div className="space-y-2">
              <div className="rounded-md border bg-emerald-500/5 border-emerald-500/30 p-3 text-xs flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium text-emerald-700 dark:text-emerald-400">Publish complete</div>
                  <div className="text-muted-foreground">A receipt was added to <em>Clients › Publish history</em>.</div>
                </div>
              </div>
              {results.map(r => (
                <div key={r.id} className="rounded-md border p-3 text-xs flex items-center justify-between">
                  <div>
                    <div className="font-medium">{r.clientName}</div>
                    <div className="text-[11px] text-muted-foreground">Baseline → v{r.toBaselineVersion}</div>
                  </div>
                  <div className="text-[11px]">
                    <span className="text-emerald-700 dark:text-emerald-400">+{r.added}</span>
                    {' · '}
                    <span className="text-rose-700 dark:text-rose-400">−{r.removed}</span>
                    {' · '}
                    <span className="text-amber-700 dark:text-amber-400">{r.protectedCount} kept</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t">
          {step === 'targets' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button size="sm" disabled={selected.size === 0} onClick={() => setStep('preview')}>
                Next: preview <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              {!onlyClientId && (
                <Button variant="ghost" size="sm" onClick={() => setStep('targets')}>
                  <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
                </Button>
              )}
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button size="sm" onClick={onConfirm} disabled={busy || loadingPreview}>
                <Send className="h-3.5 w-3.5 mr-1" />
                {busy ? 'Publishing…' : `Publish to ${selected.size} client${selected.size === 1 ? '' : 's'}`}
              </Button>
            </>
          )}
          {step === 'result' && (
            <Button size="sm" onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ step }: { step: Step }) {
  const order: Step[] = ['targets', 'preview', 'result'];
  const labels: Record<Step, string> = { targets: 'Targets', preview: 'Preview', result: 'Result' };
  return (
    <div className="flex items-center gap-1 mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
      {order.map((s, i) => {
        const active = s === step;
        const done = order.indexOf(step) > i;
        return (
          <div key={s} className="flex items-center gap-1">
            <span className={cn(
              'h-1.5 w-1.5 rounded-full',
              active ? 'bg-primary' : done ? 'bg-emerald-500' : 'bg-muted-foreground/30',
            )} />
            <span className={cn(active && 'text-foreground font-medium')}>{labels[s]}</span>
            {i < order.length - 1 && <span className="mx-1">·</span>}
          </div>
        );
      })}
    </div>
  );
}

function SummaryBar({ added, removed, protectedCount }: { added: number; removed: number; protectedCount: number }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <SummaryStat icon={Plus} tone="emerald" label="To add" value={added} />
      <SummaryStat icon={Trash2} tone="rose" label="To remove" value={removed} />
      <SummaryStat icon={ShieldCheck} tone="amber" label="Protected (kept)" value={protectedCount} />
    </div>
  );
}

function SummaryStat({
  icon: Icon, tone, label, value,
}: { icon: React.ComponentType<{ className?: string }>; tone: 'emerald' | 'rose' | 'amber'; label: string; value: number }) {
  const cls =
    tone === 'emerald' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400' :
    tone === 'rose'    ? 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400' :
                         'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400';
  return (
    <div className={cn('rounded-md border p-2', cls)}>
      <div className="text-[10px] uppercase tracking-wider font-medium flex items-center gap-1">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function ClientPreviewCard({ preview }: { preview: PublishPreview }) {
  const empty = preview.added.length === 0 && preview.removed.length === 0;
  const [expanded, setExpanded] = useState<{ added: boolean; removed: boolean; protected: boolean }>({
    added: false, removed: false, protected: false,
  });
  return (
    <div className="rounded-md border">
      <div className="px-3 py-2 border-b bg-secondary/30 flex items-center gap-2">
        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">{preview.clientName}</span>
        {empty && (
          <span className="ml-auto text-[11px] text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Already up to date
          </span>
        )}
      </div>
      {!empty && (
        <div className="p-2 space-y-1">
          <PreviewSection
            tone="emerald" icon={Plus} label="Added" entries={preview.added}
            open={expanded.added} onToggle={() => setExpanded(e => ({ ...e, added: !e.added }))}
          />
          <PreviewSection
            tone="rose" icon={Trash2} label="Removed" entries={preview.removed}
            open={expanded.removed} onToggle={() => setExpanded(e => ({ ...e, removed: !e.removed }))}
          />
        </div>
      )}
      {preview.protected.length > 0 && (
        <div className="p-2 border-t">
          <PreviewSection
            tone="amber" icon={ShieldCheck}
            label={`Protected — kept as customized (${preview.protected.length})`}
            entries={preview.protected}
            open={expanded.protected} onToggle={() => setExpanded(e => ({ ...e, protected: !e.protected }))}
            note="These cases are customized in this client. They will not be overwritten and will be flagged as drifting from master."
          />
        </div>
      )}
    </div>
  );
}

function PreviewSection({
  tone, icon: Icon, label, entries, open, onToggle, note,
}: {
  tone: 'emerald' | 'rose' | 'amber';
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  entries: { caseNumber: string; testCaseName: string; rowId: string }[];
  open: boolean; onToggle: () => void;
  note?: string;
}) {
  if (entries.length === 0 && !label.startsWith('Protected')) {
    return (
      <div className="px-2 py-1 text-[11px] text-muted-foreground inline-flex items-center gap-1">
        <Icon className="h-3 w-3" /> {label}: 0
      </div>
    );
  }
  const toneCls =
    tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' :
    tone === 'rose'    ? 'text-rose-700 dark:text-rose-400' :
                         'text-amber-700 dark:text-amber-400';
  return (
    <div>
      <button
        onClick={onToggle}
        className={cn('w-full px-2 py-1 inline-flex items-center gap-1 text-[11px] hover:bg-secondary/40 rounded', toneCls)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Icon className="h-3 w-3" /> {label} ({entries.length})
      </button>
      {open && (
        <div className="mt-1 ml-5 space-y-0.5">
          {note && <div className="text-[11px] text-muted-foreground italic mb-1">{note}</div>}
          {entries.slice(0, 50).map(e => (
            <div key={e.rowId} className="text-[11px] flex items-center gap-2">
              <span className="font-mono text-muted-foreground w-28 shrink-0 truncate">{e.caseNumber}</span>
              <span className="truncate">{e.testCaseName}</span>
            </div>
          ))}
          {entries.length > 50 && (
            <div className="text-[11px] text-muted-foreground italic">…and {entries.length - 50} more</div>
          )}
        </div>
      )}
    </div>
  );
}
