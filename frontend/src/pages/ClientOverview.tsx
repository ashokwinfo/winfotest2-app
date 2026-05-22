import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Building2, Send, GitCompare, ArrowRight, CheckCircle2, AlertTriangle, Clock,
  Pencil, Archive, ListChecks, Sparkles, ShieldCheck, Database,
} from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  applications, clientOverrides, clientTombstones, resolveCases, modules as allModules,
} from '@/data/mock';
import { previewPublish, getClientHealth, listPublishHistory, type ClientHealth } from '@/lib/customizationApi';
import { PublishToClientsDialog } from '@/components/library/PublishToClientsDialog';
import type { PublishPreview, PublishRecord } from '@/types';

/**
 * Per-product landing page when a CLIENT repo is active.
 *
 * Surfaces the support engineer's daily question first — "are there master
 * updates I need to publish?" — then a quick library summary, then a list of
 * the most recent customizations. From here they drill into the test-case
 * grid via "Open test cases".
 *
 * Master repo doesn't render this page (the App router redirects to
 * /library directly when on master).
 */
export default function ClientOverview() {
  const { appId } = useParams<{ appId: string }>();
  const navigate = useNavigate();
  const { activeClient, currentRepo, isMasterRepo, repoVersion } = useWorkspace();

  const app = applications.find(a => a.id === appId);

  // Redirect master users straight to the test-case grid — overview is client-only.
  useEffect(() => {
    if (isMasterRepo && appId) navigate(`/applications/${appId}/library`, { replace: true });
  }, [isMasterRepo, appId, navigate]);

  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [health, setHealth] = useState<ClientHealth | null>(null);
  const [history, setHistory] = useState<PublishRecord[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);

  useEffect(() => {
    if (isMasterRepo || !activeClient) return;
    let cancelled = false;
    (async () => {
      const [p, h, hist] = await Promise.all([
        previewPublish(activeClient.id),
        getClientHealth(activeClient.id),
        listPublishHistory(activeClient.id),
      ]);
      if (cancelled) return;
      setPreview(p); setHealth(h); setHistory(hist);
    })();
    return () => { cancelled = true; };
  }, [activeClient, isMasterRepo, repoVersion]);

  // App-scoped numbers
  const appCases = useMemo(() => {
    const moduleIds = new Set(allModules.filter(m => m.applicationId === appId).map(m => m.id));
    return resolveCases(currentRepo).filter(tc => moduleIds.has(tc.moduleId));
  }, [appId, currentRepo, repoVersion]);

  const appOverrides = useMemo(() => {
    if (!activeClient) return [];
    const moduleIds = new Set(allModules.filter(m => m.applicationId === appId).map(m => m.id));
    return (clientOverrides[activeClient.id] ?? []).filter(o => moduleIds.has(o.testCase.moduleId));
  }, [activeClient, appId, repoVersion]);

  const appTombstones = useMemo(() => {
    if (!activeClient) return [];
    return clientTombstones[activeClient.id] ?? [];
  }, [activeClient, repoVersion]);

  if (!app || !activeClient) return null;

  const added = preview?.added.length ?? 0;
  const removed = preview?.removed.length ?? 0;
  const protectedCount = preview?.protected.length ?? 0;
  const pending = added + removed;
  const upToDate = pending === 0;
  const lastPublishAt = history[0]?.at ?? null;
  const lastBaseline = history[0]?.toBaselineVersion ?? activeClient.baselineVersion;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Test Library — {app.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            <span className="text-amber-700 dark:text-amber-400 font-medium">{activeClient.name}</span>
            <span>· client repository overview</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => {
            const from = encodeURIComponent(`/applications/${app.id}/client-overview`);
            navigate(`/applications/${app.id}/compare?from=${from}`);
          }}>
            <GitCompare className="h-3.5 w-3.5 mr-1" /> Compare to master
          </Button>
          <Button size="sm" className="text-xs h-8" onClick={() => navigate(`/applications/${app.id}/library`)}>
            <ListChecks className="h-3.5 w-3.5 mr-1" /> Open test cases <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </div>

      {/* PRIMARY ZONE — Pending updates from master */}
      <Card className={upToDate ? 'border-emerald-500/30 bg-emerald-500/[0.03]' : 'border-amber-500/40 bg-amber-500/[0.05]'}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className={`h-9 w-9 rounded-md inline-flex items-center justify-center shrink-0 ${
                upToDate
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
              }`}>
                {upToDate ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">
                    {upToDate ? 'Up to date with master' : 'Updates available from master'}
                  </span>
                  {!upToDate && (
                    <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400">
                      {pending} pending
                    </Badge>
                  )}
                </div>
                <div className="text-[12px] text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                    <Sparkles className="h-3 w-3" /> +{added} new test case{added === 1 ? '' : 's'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
                    <Archive className="h-3 w-3" /> −{removed} removed
                  </span>
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                    <ShieldCheck className="h-3 w-3" /> {protectedCount} protected
                    <span className="text-muted-foreground/80">(your customizations — won't change)</span>
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                variant={upToDate ? 'outline' : 'default'}
                className="text-xs h-8"
                onClick={() => setPublishOpen(true)}
                disabled={upToDate}
                title={upToDate ? 'Nothing to publish — client matches master' : undefined}
              >
                <Send className="h-3.5 w-3.5 mr-1" /> {upToDate ? 'Nothing to publish' : 'Review & publish'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SECONDARY ZONE — Library at a glance + recent customizations */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Database className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Your client library at a glance</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label="Test cases"
                value={appCases.length.toLocaleString()}
                hint={`in ${app.name}`}
              />
              <Stat
                label="Customizations"
                value={appOverrides.length.toString()}
                hint={appOverrides.length === 0 ? 'none yet' : 'forked from master'}
                tone={appOverrides.length > 0 ? 'info' : 'muted'}
                icon={Pencil}
              />
              <Stat
                label="Deletions"
                value={appTombstones.length.toString()}
                hint={appTombstones.length === 0 ? 'none' : 'master cases hidden'}
                tone={appTombstones.length > 0 ? 'warn' : 'muted'}
                icon={Archive}
              />
            </div>
            <div className="mt-3 pt-3 border-t flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last published {lastPublishAt ? formatRelative(lastPublishAt) : 'never'} · baseline v{lastBaseline}
              </span>
              <button
                className="text-primary hover:underline inline-flex items-center gap-0.5"
                onClick={() => navigate(`/applications/${app.id}/library`)}
              >
                Open test cases <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Pencil className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Recent customizations</span>
                <Badge variant="outline" className="text-[10px]">{appOverrides.length}</Badge>
              </div>
              {appOverrides.length > 5 && (
                <button
                  className="text-[11px] text-primary hover:underline"
                  onClick={() => navigate(`/applications/${app.id}/library?status=valid`)}
                >
                  View all
                </button>
              )}
            </div>
            {appOverrides.length === 0 ? (
              <div className="text-[12px] text-muted-foreground py-6 text-center">
                No client-specific changes yet.<br/>
                Open a test case and click "Customize" to fork it for {activeClient.name}.
              </div>
            ) : (
              <ul className="divide-y -mx-4">
                {appOverrides.slice(0, 5).map(ovr => (
                  <li
                    key={ovr.id}
                    className="px-4 py-2 flex items-center gap-2 text-[12px] hover:bg-secondary/40 cursor-pointer"
                    onClick={() => navigate(`/test-case/${ovr.testCase.id}`)}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      ovr.originCaseId ? 'bg-blue-500' : 'bg-amber-500'
                    }`} />
                    <span className="font-mono text-[11px] text-muted-foreground shrink-0">{ovr.testCase.caseNumber}</span>
                    <span className="truncate flex-1">{ovr.testCase.testCaseName}</span>
                    <Badge variant="outline" className={`text-[9px] h-4 px-1 shrink-0 ${
                      ovr.originCaseId
                        ? 'border-blue-500/50 text-blue-600 dark:text-blue-400'
                        : 'border-amber-500/50 text-amber-700 dark:text-amber-400'
                    }`}>
                      {ovr.originCaseId ? 'Modified' : 'Client-only'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <PublishToClientsDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        onlyClientId={activeClient.id}
      />
    </div>
  );
}

function Stat({
  label, value, hint, tone = 'muted', icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'muted' | 'info' | 'warn';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const valueCls =
    tone === 'info' ? 'text-blue-700 dark:text-blue-400' :
    tone === 'warn' ? 'text-amber-700 dark:text-amber-400' :
    'text-foreground';
  return (
    <div className="rounded-md border bg-card/50 p-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <div className={`text-lg font-semibold mt-0.5 ${valueCls}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
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
