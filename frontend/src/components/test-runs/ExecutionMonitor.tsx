import { useState, useMemo, useRef, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Progress } from '@/components/ui/progress';
import { ChevronDown, ChevronRight, Search, AlertTriangle, RotateCcw, ArrowDown, ChevronsDown, Download, Image as ImageIcon, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ScreenshotGallery } from '@/components/reports/ScreenshotGallery';
import type { TestRun, RunStatus } from '@/types';
import { testCases, testSteps, releases, modules, testRunCaseResults, runScreenshots } from '@/data/mock';

interface ExecutionMonitorProps {
  run: TestRun;
}

function formatDuration(ms: number): string {
  if (ms === 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function useElapsedTime(startedAt: string, isRunning: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning) {
      setElapsed(Date.now() - new Date(startedAt).getTime());
      return;
    }
    const interval = setInterval(() => setElapsed(Date.now() - new Date(startedAt).getTime()), 1000);
    return () => clearInterval(interval);
  }, [startedAt, isRunning]);
  return elapsed;
}

const statusTabs: { label: string; value: string }[] = [
  { label: 'All', value: 'all' },
  { label: 'Passed', value: 'passed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Running', value: 'running' },
  { label: 'Pending', value: 'pending' },
  { label: 'Skipped', value: 'skipped' },
];

export function ExecutionMonitor({ run }: ExecutionMonitorProps) {
  const navigate = useNavigate();
  const [expandedCases, setExpandedCases] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const failedRef = useRef<HTMLDivElement>(null);

  const cases = testCases.filter(tc => tc.moduleId === run.moduleId);
  const caseResults = testRunCaseResults[run.id] || [];
  const release = releases.find(r => r.id === run.releaseId);
  const mod = modules.find(m => m.id === run.moduleId);
  const elapsed = useElapsedTime(run.startedAt, run.status === 'running');

  const caseStatusMap = useMemo(() => {
    const map: Record<string, { status: RunStatus; duration: number; error?: string }> = {};
    caseResults.forEach(cr => {
      map[cr.testCaseId] = { status: cr.status, duration: cr.duration, error: cr.error };
    });
    return map;
  }, [caseResults]);

  const filteredCases = useMemo(() => {
    let result = cases;
    if (filterStatus !== 'all') {
      result = result.filter(tc => (caseStatusMap[tc.id]?.status || 'pending') === filterStatus);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(tc =>
        tc.caseNumber.toLowerCase().includes(q) || tc.testCaseName.toLowerCase().includes(q)
      );
    }
    return result;
  }, [cases, filterStatus, searchQuery, caseStatusMap]);

  const toggleCase = (id: string) => {
    setExpandedCases(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const expandAllFailed = () => {
    const failedIds = cases.filter(tc => caseStatusMap[tc.id]?.status === 'failed').map(tc => tc.id);
    setExpandedCases(new Set(failedIds));
    setFilterStatus('failed');
  };

  const jumpToFailed = () => {
    setFilterStatus('failed');
    setTimeout(() => failedRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const runningCount = caseResults.filter(cr => cr.status === 'running').length;
  const skippedCount = run.totalCases - run.passedCases - run.failedCases - runningCount;

  const statusCounts: Record<string, number> = {
    all: cases.length,
    passed: run.passedCases,
    failed: run.failedCases,
    running: runningCount,
    pending: cases.filter(tc => !caseStatusMap[tc.id]).length,
    skipped: skippedCount > 0 ? skippedCount : 0,
  };

  return (
    <div className="space-y-4">
      {/* Summary Panel */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-medium">{run.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {release?.name} · {mod?.name} · {run.environment.toUpperCase()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => navigate(`/reports/${run.id}`)}>
                <BarChart3 className="h-3 w-3 mr-1" /> View Report
              </Button>
              <StatusBadge status={run.status} />
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mb-3">
            Started {new Date(run.startedAt).toLocaleString()} by {run.createdBy}
            {run.completedAt && ` · Completed ${new Date(run.completedAt).toLocaleString()}`}
            <span className="ml-2">· Elapsed: {formatDuration(elapsed)}</span>
          </div>
          <div className="space-y-1 mb-4">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Overall Progress</span>
              <span>{run.progress}%</span>
            </div>
            <Progress value={run.progress} className="h-2" />
          </div>
          <div className="grid grid-cols-5 gap-2 text-center">
            <div><div className="text-lg font-semibold">{run.totalCases}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</div></div>
            <div><div className="text-lg font-semibold text-status-pass">{run.passedCases}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Passed</div></div>
            <div><div className="text-lg font-semibold text-status-fail">{run.failedCases}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Failed</div></div>
            <div><div className="text-lg font-semibold text-status-running">{runningCount}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Running</div></div>
            <div><div className="text-lg font-semibold text-muted-foreground">{skippedCount > 0 ? skippedCount : 0}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Remaining</div></div>
          </div>
        </CardContent>
      </Card>

      {/* Action Bar */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {statusTabs.map(tab => (
            <Button
              key={tab.value}
              size="sm"
              variant={filterStatus === tab.value ? 'default' : 'outline'}
              className="text-xs h-7"
              onClick={() => setFilterStatus(tab.value)}
            >
              {tab.label} ({statusCounts[tab.value] || 0})
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search cases..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-xs"
            />
          </div>
          {run.failedCases > 0 && (
            <>
              <Button size="sm" variant="outline" className="text-xs h-8" onClick={jumpToFailed}>
                <ArrowDown className="h-3 w-3 mr-1" /> Jump to Failed
              </Button>
              <Button size="sm" variant="outline" className="text-xs h-8" onClick={expandAllFailed}>
                <ChevronsDown className="h-3 w-3 mr-1" /> Expand Failed
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" className="text-xs h-8">
            <Download className="h-3 w-3 mr-1" /> Export
          </Button>
        </div>
      </div>

      {/* Test Case List */}
      <div className="space-y-2" ref={failedRef}>
        {filteredCases.map((tc) => {
          const isExpanded = expandedCases.has(tc.id);
          const steps = testSteps.filter(s => s.testCaseId === tc.id);
          const result = caseStatusMap[tc.id];
          const caseStatus = result?.status || 'pending';
          const caseResult = caseResults.find(cr => cr.testCaseId === tc.id);
          const stepResults = caseResult?.stepResults || [];
          const stepResultMap = Object.fromEntries(stepResults.map(sr => [sr.stepId, sr]));

          return (
            <Card key={tc.id} className="overflow-hidden">
              <div
                className="p-3 flex items-center justify-between cursor-pointer hover:bg-secondary/30 transition-colors"
                onClick={() => toggleCase(tc.id)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <span className="text-xs font-mono text-primary shrink-0">{tc.caseNumber}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{tc.testCaseName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {steps.length} steps · {tc.role}
                      {result?.duration ? ` · ${formatDuration(result.duration)}` : ''}
                      {stepResults.length > 0 && ` · ${stepResults.filter(sr => sr.status === 'passed').length}/${steps.length} steps done`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Screenshot thumbnails */}
                  {(() => {
                    const caseScreenshots = runScreenshots.filter(s => s.runId === run.id && s.testCaseId === tc.id);
                    if (caseScreenshots.length === 0) return null;
                    return (
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <ScreenshotGallery screenshots={caseScreenshots} compact />
                      </div>
                    );
                  })()}
                  {caseStatus === 'failed' && (
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={(e) => { e.stopPropagation(); }}>
                      <RotateCcw className="h-3 w-3 mr-1" /> Re-run
                    </Button>
                  )}
                  <StatusBadge status={caseStatus} />
                </div>
              </div>

              {isExpanded && (
                <div className="border-t bg-secondary/20">
                  {result?.error && (
                    <div className="px-4 py-2 bg-destructive/5 border-b border-destructive/20 flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-status-fail shrink-0 mt-0.5" />
                      <span className="text-xs text-status-fail">{result.error}</span>
                    </div>
                  )}
                  {steps.length > 0 ? (
                    <div className="px-4 py-2 space-y-0">
                      <div className="grid grid-cols-[40px_1fr_80px_80px_60px] gap-2 text-[10px] text-muted-foreground uppercase tracking-wider py-1 border-b">
                        <span>Line</span><span>Description</span><span>Duration</span><span>Status</span><span></span>
                      </div>
                      {steps.map((step) => {
                        const sr = stepResultMap[step.id];
                        const stepStatus = sr?.status || 'pending';
                        return (
                          <div key={step.id} className="grid grid-cols-[40px_1fr_80px_80px_60px] gap-2 py-1.5 text-xs items-center border-b border-border/50 last:border-0">
                            <span className="font-mono text-muted-foreground">{step.lineNumber}</span>
                            <div className="min-w-0">
                              <span className="font-medium truncate block">{step.stepDescription}</span>
                              {sr?.error && <span className="text-[11px] text-status-fail block mt-0.5">{sr.error}</span>}
                            </div>
                            <span className="text-muted-foreground">{sr ? formatDuration(sr.duration) : '—'}</span>
                            <StatusBadge status={stepStatus} />
                            <div>
                              {sr?.screenshotUrl && (
                                <Button size="sm" variant="ghost" className="h-5 w-5 p-0">
                                  <ImageIcon className="h-3 w-3 text-muted-foreground" />
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-4 py-4 text-xs text-muted-foreground text-center">No step data available</div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
        {filteredCases.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">No test cases match the current filter</div>
        )}
      </div>
    </div>
  );
}
