import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { testRuns, applications, testCases, auditEntries, releases, modules, features } from '@/data/mock';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  Play, Plus, ArrowRight, AlertTriangle, CheckCircle2,
  ShieldCheck, Rocket, FileSearch, Layers, Sparkles
} from 'lucide-react';

const Dashboard = () => {
  const navigate = useNavigate();
  const { currentWorkspace, environment } = useWorkspace();
  const recentRuns = testRuns.slice(0, 3);

  // Outcome metrics
  const totalRuns = testRuns.length || 1;
  const releaseConfidence = Math.round((testRuns.filter(r => r.status === 'passed').length / totalRuns) * 100);
  const openRisks = testRuns.filter(r => r.status === 'failed').length
    + testRuns.reduce((sum, r) => sum + (r.failedCases || 0), 0);
  const featuresWithCoverage = new Set(testCases.filter(tc => tc.status === 'valid').map(tc => tc.featureId)).size;
  const coverageHealth = Math.round((featuresWithCoverage / Math.max(features.length, 1)) * 100);
  const validationsInFlight = testRuns.filter(r => r.status === 'running').length;

  // Sparkline (mocked trend)
  const sparkPoints = [82, 85, 81, 88, 90, 87, 92, releaseConfidence];
  const sparkPath = sparkPoints
    .map((v, i) => `${(i / (sparkPoints.length - 1)) * 100},${30 - (v - 75) * 1.2}`)
    .join(' ');

  const readyCount = testRuns.filter(r => r.status === 'passed').length;
  const needsAttention = testRuns.filter(r => r.status === 'failed').length;

  // Next-best-action (contextual)
  const featuresWithoutCoverage = features.length - featuresWithCoverage;

  return (
    <div className="space-y-8 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Release Readiness</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {readyCount} releases ready · {needsAttention} need attention · {currentWorkspace.name} · {environment.toUpperCase()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate('/applications')}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Onboard a product
          </Button>
          <Button size="sm" onClick={() => navigate('/runs/new')}>
            <Play className="h-3.5 w-3.5 mr-1" /> Run regression
          </Button>
        </div>
      </div>

      {/* Outcome KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Release Confidence</div>
                <div className="text-2xl font-semibold mt-1">{releaseConfidence}<span className="text-base text-muted-foreground">%</span></div>
                <div className="text-[11px] text-muted-foreground mt-0.5">across last {totalRuns} validations</div>
              </div>
              <ShieldCheck className="h-4 w-4 text-status-pass" />
            </div>
            <svg viewBox="0 0 100 30" className="w-full h-6 mt-2" preserveAspectRatio="none">
              <polyline
                fill="none"
                stroke="hsl(var(--status-pass))"
                strokeWidth="1.5"
                points={sparkPath}
              />
            </svg>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Open Risks</div>
                <div className="text-2xl font-semibold mt-1 text-status-fail">{openRisks}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">blockers awaiting resolution</div>
              </div>
              <AlertTriangle className="h-4 w-4 text-status-fail" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Coverage Health</div>
                <div className="text-2xl font-semibold mt-1">{coverageHealth}<span className="text-base text-muted-foreground">%</span></div>
                <div className="text-[11px] text-muted-foreground mt-0.5">of features protected</div>
              </div>
              <CheckCircle2 className="h-4 w-4 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Validations in Flight</div>
                <div className="text-2xl font-semibold mt-1">{validationsInFlight}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">running right now</div>
              </div>
              <Rocket className="h-4 w-4 text-status-running" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Contextual next-best-action */}
      {featuresWithoutCoverage > 0 && (
        <Card className="border-status-pending/40 bg-status-pending/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-status-pending/15 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-status-pending" />
              </div>
              <div>
                <div className="text-sm font-medium">You have {featuresWithoutCoverage} feature{featuresWithoutCoverage === 1 ? '' : 's'} without coverage</div>
                <div className="text-[11px] text-muted-foreground">Close the gap before your next release.</div>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate('/applications')}>Fix gaps <ArrowRight className="h-3 w-3 ml-1" /></Button>
          </CardContent>
        </Card>
      )}

      {/* Workflow band — Cover → Validate → Ship */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Your workflow</h2>
        <div className="grid grid-cols-3 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-shadow group" onClick={() => navigate('/applications')}>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">1</div>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Cover</span>
              </div>
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-sm font-medium mb-1">Build coverage</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Capture the scenarios that prove every feature works.
              </p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow group" onClick={() => navigate('/runs/new')}>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-6 w-6 rounded-full bg-status-running/10 flex items-center justify-center text-[10px] font-bold text-status-running">2</div>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Validate</span>
              </div>
              <div className="h-10 w-10 rounded-lg bg-status-running/10 flex items-center justify-center mb-3 group-hover:bg-status-running/20 transition-colors">
                <FileSearch className="h-5 w-5 text-status-running" />
              </div>
              <h3 className="text-sm font-medium mb-1">Validate readiness</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Run validations and surface risks before they reach customers.
              </p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow group" onClick={() => navigate('/runs')}>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-6 w-6 rounded-full bg-status-pass/10 flex items-center justify-center text-[10px] font-bold text-status-pass">3</div>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Ship</span>
              </div>
              <div className="h-10 w-10 rounded-lg bg-status-pass/10 flex items-center justify-center mb-3 group-hover:bg-status-pass/20 transition-colors">
                <Rocket className="h-5 w-5 text-status-pass" />
              </div>
              <h3 className="text-sm font-medium mb-1">Ship with confidence</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Release to production with a clear, evidence-backed signal.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Latest validation results */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Latest validation results</CardTitle>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/runs')}>
              View all <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentRuns.map((run) => {
              const release = releases.find(r => r.id === run.releaseId);
              const mod = modules.find(m => m.id === run.moduleId);
              const confidence = run.totalCases > 0 ? Math.round((run.passedCases / run.totalCases) * 100) : 0;
              const outcome =
                run.status === 'passed' ? `${confidence}% confidence · ready to ship` :
                run.status === 'failed' ? `${run.failedCases} blockers · review needed` :
                run.status === 'running' ? `${confidence}% so far · validation in progress` :
                'awaiting validation';
              return (
                <div
                  key={run.id}
                  className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-secondary/50 transition-colors"
                  onClick={() => navigate(`/runs/${run.id}`)}
                >
                  <div>
                    <div className="text-sm font-medium">{release?.name ?? run.name} — {outcome}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {run.name} · {mod?.name} · {run.environment.toUpperCase()} · {run.createdBy}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={run.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Recent activity (demoted) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Activity log</CardTitle>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/audit')}>
              View all <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {auditEntries.slice(0, 3).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <div className="text-xs">
                  <span className="font-medium">{entry.userName}</span>
                  <span className="text-muted-foreground"> {entry.action} </span>
                  <span>{entry.entityName}</span>
                </div>
                <span className="text-[11px] text-muted-foreground">{new Date(entry.timestamp).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
