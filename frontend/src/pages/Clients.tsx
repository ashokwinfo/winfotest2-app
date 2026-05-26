import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Building2, Database, GitCompare, Send, Plus, ExternalLink, Pencil, Archive,
  CheckCircle2, AlertTriangle, Clock, History, ArrowRight, Undo2, FileText,
} from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  applications, clientOverrides, clientTombstones, clientRepos as mockClientRepos,
} from '@/data/mock';
import { getClientHealth, listPublishHistory, rollbackPublish, type ClientHealth } from '@/lib/customizationApi';
import { PublishToClientsDialog } from '@/components/library/PublishToClientsDialog';
import type { ClientRepo, PublishRecord } from '@/types';
import { toast } from 'sonner';

/**
 * Clients hub — single home for the master ↔ client relationship.
 * Replaces the old Settings → Clients tab. Shows drift, customizations,
 * last-published, and the actions an admin actually wants: Compare + Publish.
 */
export default function Clients() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { clientRepos, setCurrentRepo, repoVersion, bumpRepoVersion } = useWorkspace();

  const tab = (searchParams.get('tab') as 'repos' | 'history') || 'repos';
  const setTab = (v: 'repos' | 'history') => {
    const next = new URLSearchParams(searchParams);
    if (v === 'repos') next.delete('tab'); else next.set('tab', v);
    setSearchParams(next, { replace: true });
  };

  // Per-client health (async via the API seam).
  const [health, setHealth] = useState<Record<string, ClientHealth>>({});
  const refreshHealth = useCallback(async () => {
    const all = await Promise.all(clientRepos.map(c => getClientHealth(c.id)));
    setHealth(Object.fromEntries(all.map(h => [h.clientRepoId, h])));
  }, [clientRepos]);
  useEffect(() => { refreshHealth(); }, [refreshHealth, repoVersion]);

  // Publish history
  const [history, setHistory] = useState<PublishRecord[]>([]);
  const refreshHistory = useCallback(async () => {
    setHistory(await listPublishHistory());
  }, []);
  useEffect(() => { refreshHistory(); }, [refreshHistory, repoVersion]);

  // Publish dialog (optionally pre-scoped to a single client)
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishOnly, setPublishOnly] = useState<string | null>(null);
  const openPublish = (clientId?: string) => {
    setPublishOnly(clientId ?? null);
    setPublishOpen(true);
  };

  // Default Compare app — pick first application.
  const defaultAppId = applications[0]?.id;
  const goCompare = (clientId: string) => {
    if (!defaultAppId) return;
    const from = encodeURIComponent('/clients');
    navigate(`/applications/${defaultAppId}/compare?against=${clientId}&from=${from}`);
  };
  const openClient = (clientId: string) => {
    setCurrentRepo(clientId);
    if (defaultAppId) navigate(`/applications/${defaultAppId}/client-overview`);
    else navigate('/applications');
  };

  // Create / rename / archive
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const create = () => {
    const name = newName.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const id = `client-${slug || `c${Date.now()}`}`;
    if (mockClientRepos.some(c => c.id === id)) {
      toast.error('A client with this id already exists');
      return;
    }
    const repo: ClientRepo = {
      id, name, workspaceId: 'ws-1', baselineVersion: 1,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    mockClientRepos.push(repo);
    clientOverrides[id] = [];
    clientTombstones[id] = [];
    setNewName(''); setCreateOpen(false);
    toast.success(`Client repo "${name}" created`);
    bumpRepoVersion();
  };
  const rename = (repo: ClientRepo) => {
    const next = window.prompt('New name', repo.name)?.trim();
    if (!next || next === repo.name) return;
    repo.name = next;
    toast.success('Renamed');
    bumpRepoVersion();
  };
  const archive = (repo: ClientRepo) => {
    if (!window.confirm(`Archive "${repo.name}"? Its overrides will be removed.`)) return;
    const idx = mockClientRepos.findIndex(c => c.id === repo.id);
    if (idx >= 0) mockClientRepos.splice(idx, 1);
    delete clientOverrides[repo.id];
    delete clientTombstones[repo.id];
    toast.success(`Archived "${repo.name}"`);
    bumpRepoVersion();
  };

  // Changelog viewer + rollback
  const [viewing, setViewing] = useState<PublishRecord | null>(null);
  const doRollback = async (rec: PublishRecord) => {
    if (!rec.prevSnapshotToken) {
      toast.error('This publish has no recoverable snapshot.');
      return;
    }
    if (!window.confirm(`Roll back publish to ${rec.clientName} (baseline v${rec.toBaselineVersion} → v${rec.fromBaselineVersion ?? '?'})?`)) return;
    const ok = await rollbackPublish(rec.id);
    if (ok) {
      toast.success('Publish rolled back');
      bumpRepoVersion();
      refreshHistory();
    } else {
      toast.error('Rollback failed — snapshot already consumed.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            Clients
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage tenant repositories, see how each one differs from master, and publish updates.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => openPublish()}>
            <Send className="h-3.5 w-3.5 mr-1" /> Publish to clients
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="text-xs h-8">
                <Plus className="h-3.5 w-3.5 mr-1" /> New client repo
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="text-sm">New client repository</DialogTitle>
                <DialogDescription className="text-xs">
                  Creates a new tenant copy of the master library. Starts with no customizations.
                </DialogDescription>
              </DialogHeader>
              <Input
                autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., Globex Corp" className="h-8 text-xs"
                onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
              />
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={create} disabled={!newName.trim()}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Master summary card */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-primary/10 text-primary inline-flex items-center justify-center">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-medium">Master Library</div>
              <div className="text-[11px] text-muted-foreground">
                Source of truth · {clientRepos.length} client{clientRepos.length === 1 ? '' : 's'} subscribed
              </div>
            </div>
          </div>
          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => {
            if (defaultAppId) navigate(`/applications/${defaultAppId}/library`);
            else navigate('/applications');
          }}>
            Open master library <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'repos' | 'history')}>
        <TabsList className="h-8">
          <TabsTrigger value="repos" className="text-xs h-7">Repositories ({clientRepos.length})</TabsTrigger>
          <TabsTrigger value="history" className="text-xs h-7">
            <History className="h-3 w-3 mr-1" /> Publish history ({history.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="repos" className="space-y-2 mt-4">
          {clientRepos.length === 0 ? (
            <Card><CardContent className="text-xs text-muted-foreground py-10 text-center">
              No client repositories yet. Create one to start tracking customizations.
            </CardContent></Card>
          ) : clientRepos.map(repo => {
            const h = health[repo.id];
            const lastAt = h?.lastPublishAt ? formatRelative(h.lastPublishAt) : 'never';
            const upToDate = (h?.behindMaster ?? 0) === 0;
            return (
              <Card key={repo.id}>
                <CardContent className="p-4 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="h-9 w-9 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 inline-flex items-center justify-center shrink-0">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{repo.name}</span>
                        <Badge variant="outline" className="text-[10px] font-mono">{repo.id}</Badge>
                        <Badge variant="outline" className="text-[10px]">Baseline v{repo.baselineVersion}</Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <StatChip
                          icon={Pencil}
                          label={`${h?.customizations ?? 0} customization${h?.customizations === 1 ? '' : 's'}`}
                          tone="neutral"
                        />
                        <StatChip
                          icon={Archive}
                          label={`${h?.deletions ?? 0} deletion${h?.deletions === 1 ? '' : 's'}`}
                          tone="neutral"
                        />
                        {upToDate ? (
                          <StatChip icon={CheckCircle2} label="Up to date" tone="ok" />
                        ) : (
                          <StatChip
                            icon={AlertTriangle}
                            label={`${h!.behindMaster} behind master`}
                            tone="warn"
                          />
                        )}
                        <StatChip icon={Clock} label={`Last published ${lastAt}`} tone="neutral" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => goCompare(repo.id)}>
                      <GitCompare className="h-3.5 w-3.5 mr-1" /> Compare
                    </Button>
                    <Button
                      variant={upToDate ? 'outline' : 'default'}
                      size="sm" className="h-8 text-xs"
                      onClick={() => openPublish(repo.id)}
                    >
                      <Send className="h-3.5 w-3.5 mr-1" /> Publish
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => openClient(repo.id)}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => rename(repo)} title="Rename">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-rose-600" onClick={() => archive(repo)} title="Archive">
                      <Archive className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardContent className="p-0 divide-y">
              {history.length === 0 ? (
                <div className="text-xs text-muted-foreground py-10 text-center">No publish events recorded yet.</div>
              ) : history.map(rec => (
                <div key={rec.id} className="p-3 flex items-center gap-3 text-xs">
                  <div className="h-7 w-7 rounded bg-primary/10 text-primary inline-flex items-center justify-center shrink-0">
                    <Send className="h-3 w-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">
                      {rec.clientName} <span className="text-muted-foreground font-normal">→ baseline v{rec.toBaselineVersion}</span>
                      {rec.fromBaselineVersion !== undefined && (
                        <span className="text-muted-foreground font-normal"> (from v{rec.fromBaselineVersion})</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      <span className="text-emerald-700 dark:text-emerald-400">+{rec.added} added</span>
                      {' · '}
                      <span className="text-rose-700 dark:text-rose-400">−{rec.removed} removed</span>
                      {' · '}
                      <span className="text-amber-700 dark:text-amber-400">{rec.protectedCount} protected</span>
                      {' · by '}{rec.by}
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground shrink-0">{formatRelative(rec.at)}</div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setViewing(rec)}>
                    <FileText className="h-3 w-3 mr-1" /> Changelog
                  </Button>
                  {rec.prevSnapshotToken && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-amber-700 hover:text-amber-800" onClick={() => doRollback(rec)}>
                      <Undo2 className="h-3 w-3 mr-1" /> Rollback
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <PublishToClientsDialog
        open={publishOpen}
        onOpenChange={(v) => { setPublishOpen(v); if (!v) setPublishOnly(null); }}
        onlyClientId={publishOnly}
      />

      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Publish changelog — {viewing?.clientName} → v{viewing?.toBaselineVersion}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {viewing && new Date(viewing.at).toLocaleString()} · by {viewing?.by}
            </DialogDescription>
          </DialogHeader>
          {viewing?.changelog ? (
            <div className="space-y-3 text-xs max-h-[60vh] overflow-y-auto">
              <ChangelogSection title="Added" tone="ok" items={viewing.changelog.added} />
              <ChangelogSection title="Removed" tone="warn" items={viewing.changelog.removed} />
              <ChangelogSection title="Protected (kept client edits)" tone="neutral" items={viewing.changelog.protected} />
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No detailed changelog captured for this entry.</div>
          )}
          <DialogFooter>
            {viewing?.prevSnapshotToken && (
              <Button size="sm" variant="outline" onClick={() => { const r = viewing; setViewing(null); if (r) doRollback(r); }}>
                <Undo2 className="h-3 w-3 mr-1" /> Rollback this publish
              </Button>
            )}
            <Button size="sm" onClick={() => setViewing(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChangelogSection({ title, tone, items }: {
  title: string;
  tone: 'ok' | 'warn' | 'neutral';
  items: { caseNumber: string; testCaseName: string }[];
}) {
  const cls = tone === 'ok' ? 'text-emerald-700 dark:text-emerald-400'
    : tone === 'warn' ? 'text-rose-700 dark:text-rose-400'
    : 'text-muted-foreground';
  return (
    <div>
      <div className={`text-[11px] uppercase tracking-wide font-medium ${cls}`}>{title} ({items.length})</div>
      {items.length === 0 ? (
        <div className="text-[11px] text-muted-foreground py-1">None.</div>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {items.slice(0, 50).map(i => (
            <li key={i.caseNumber} className="flex gap-2">
              <span className="font-mono text-primary shrink-0">{i.caseNumber}</span>
              <span className="truncate">{i.testCaseName}</span>
            </li>
          ))}
          {items.length > 50 && (
            <li className="text-[11px] text-muted-foreground">…and {items.length - 50} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

function StatChip({
  icon: Icon, label, tone,
}: { icon: React.ComponentType<{ className?: string }>; label: string; tone: 'neutral' | 'ok' | 'warn' }) {
  const cls =
    tone === 'ok' ? 'text-emerald-700 dark:text-emerald-400' :
    tone === 'warn' ? 'text-amber-700 dark:text-amber-400' :
    'text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-1 ${cls}`}>
      <Icon className="h-3 w-3" /> {label}
    </span>
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
