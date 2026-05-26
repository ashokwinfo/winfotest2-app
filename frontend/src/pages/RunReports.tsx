import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BarChart3, ArrowLeft, FileDown, Search } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { EmptyState } from '@/components/shared/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ScreenshotGallery } from '@/components/reports/ScreenshotGallery';
import { testRuns, releases, modules, testCases, runScreenshots } from '@/data/mock';
import { useWorkspace } from '@/contexts/WorkspaceContext';

const CHART_COLORS = {
  passed: 'hsl(142, 71%, 45%)',
  failed: 'hsl(0, 72%, 51%)',
  remaining: 'hsl(220, 14%, 80%)',
};

export default function RunReports() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [caseFilter, setCaseFilter] = useState('');
  const { currentTeam } = useWorkspace();

  const run = id ? testRuns.find(r => r.id === id) : null;
  const release = run ? releases.find(r => r.id === run.releaseId) : null;
  const mod = run ? modules.find(m => m.id === run.moduleId) : null;
  const remaining = run ? run.totalCases - run.passedCases - run.failedCases : 0;
  const screenshots = run ? runScreenshots.filter(s => s.runId === run.id) : [];
  const runCaseIds = run ? (run.selectedCaseIds ?? testCases.filter(tc => tc.moduleId === run.moduleId).map(tc => tc.id)) : [];
  const casesInRun = useMemo(() => testCases.filter(tc => runCaseIds.includes(tc.id)), [runCaseIds.join(',')]);

  const caseStatuses = useMemo(() => {
    const statuses: ('passed' | 'failed' | 'pending')[] = ['passed', 'failed', 'pending'];
    const map: Record<string, 'passed' | 'failed' | 'pending'> = {};
    casesInRun.forEach(tc => {
      map[tc.id] = statuses[Math.abs(tc.id.charCodeAt(tc.id.length - 1)) % 3];
    });
    return map;
  }, [casesInRun]);

  const filteredCases = useMemo(() => {
    if (!caseFilter) return casesInRun;
    const q = caseFilter.toLowerCase();
    return casesInRun.filter(tc =>
      tc.caseNumber.toLowerCase().includes(q) || tc.testCaseName.toLowerCase().includes(q)
    );
  }, [casesInRun, caseFilter]);

  if (!id) {
    return (
      <div className="space-y-6 max-w-4xl">
        <h1 className="text-xl font-semibold">Run Reports</h1>
        {(() => {
          const teamFilteredRuns = currentTeam
            ? testRuns.filter(r => r.teamId === currentTeam.id || !r.teamId)
            : testRuns.filter(r => !r.teamId);
          return teamFilteredRuns.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No Reports"
            description="Reports will appear here once test runs are executed."
          />
        ) : (
          <div className="space-y-2">
            {teamFilteredRuns.map(run => {
              const release = releases.find(r => r.id === run.releaseId);
              return (
                <Card key={run.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/reports/${run.id}`)}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{run.name}</div>
                      <div className="text-[11px] text-muted-foreground">{release?.name} · {run.environment.toUpperCase()}</div>
                    </div>
                    <StatusBadge status={run.status} />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        );
        })()}
      </div>
    );
  }

  if (!run) return <div className="text-sm text-muted-foreground">Run not found</div>;

  // Chart data
  const pieData = [
    { name: 'Passed', value: run.passedCases, color: CHART_COLORS.passed },
    { name: 'Failed', value: run.failedCases, color: CHART_COLORS.failed },
    { name: 'Remaining', value: remaining, color: CHART_COLORS.remaining },
  ].filter(d => d.value > 0);

  const barData = casesInRun.slice(0, 10).map(tc => ({
    name: tc.caseNumber,
    status: caseStatuses[tc.id] === 'passed' ? 1 : caseStatuses[tc.id] === 'failed' ? -1 : 0,
    fill: caseStatuses[tc.id] === 'passed' ? CHART_COLORS.passed : caseStatuses[tc.id] === 'failed' ? CHART_COLORS.failed : CHART_COLORS.remaining,
  }));

  const handleExportPdf = () => window.print();

  return (
    <div className="space-y-4 max-w-4xl print-report">
      <div className="flex items-center justify-between no-print">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Run Report</h1>
            <p className="text-xs text-muted-foreground">{run.name}</p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="text-xs" onClick={handleExportPdf}>
          <FileDown className="h-3.5 w-3.5 mr-1" /> Export PDF
        </Button>
      </div>

      {/* Summary + Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Summary card */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{run.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {release?.name} · {mod?.name} · {run.environment.toUpperCase()}
                </div>
              </div>
              <StatusBadge status={run.status} />
            </div>

            <div className="text-[11px] text-muted-foreground">
              Started {new Date(run.startedAt).toLocaleString()}
              {run.completedAt && ` · Completed ${new Date(run.completedAt).toLocaleString()}`}
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progress</span>
                <span>{run.progress}%</span>
              </div>
              <Progress value={run.progress} className="h-2" />
            </div>

            <div className="grid grid-cols-4 gap-2 text-center pt-2">
              <div><div className="text-lg font-semibold">{run.totalCases}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</div></div>
              <div><div className="text-lg font-semibold text-status-pass">{run.passedCases}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Passed</div></div>
              <div><div className="text-lg font-semibold text-status-fail">{run.failedCases}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Failed</div></div>
              <div><div className="text-lg font-semibold text-muted-foreground">{remaining}</div><div className="text-[10px] text-muted-foreground uppercase tracking-wider">Remaining</div></div>
            </div>
          </CardContent>
        </Card>

        {/* Pie chart */}
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium mb-2">Result Distribution</div>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2}>
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Legend verticalAlign="bottom" height={30} formatter={(value: string) => <span className="text-xs text-foreground">{value}</span>} />
                <RechartsTooltip contentStyle={{ fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Bar chart — per case results */}
      {barData.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium mb-2">Per Test Case Results</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData} layout="vertical" margin={{ left: 60, right: 20 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={55} />
                <RechartsTooltip
                  contentStyle={{ fontSize: '12px' }}
                  formatter={(value: number) => value === 1 ? 'Passed' : value === -1 ? 'Failed' : 'Pending'}
                />
                <Bar dataKey="status" radius={[0, 4, 4, 0]}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Test Case Gallery with filter */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Test Case Screenshots</div>
          <div className="relative w-64 no-print">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter by case number or name..."
              value={caseFilter}
              onChange={e => setCaseFilter(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>

        {filteredCases.map(tc => {
          const caseScreenshots = screenshots.filter(s => s.testCaseId === tc.id);
          const status = caseStatuses[tc.id];

          return (
            <Card key={tc.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-mono text-muted-foreground mr-2">{tc.caseNumber}</span>
                    <span className="text-sm font-medium">{tc.testCaseName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {caseScreenshots.length > 0 && (
                      <ScreenshotGallery screenshots={caseScreenshots} compact />
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] no-print"
                      onClick={() => window.print()}
                    >
                      <FileDown className="h-3 w-3 mr-1" /> PDF
                    </Button>
                    <StatusBadge status={status} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {filteredCases.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">No test cases match the filter</div>
        )}
      </div>

      <div className="flex justify-end pt-2 no-print">
        <Button size="sm" variant="outline" className="text-xs" onClick={() => navigate(`/runs/${run.id}`)}>
          View Execution Detail
        </Button>
      </div>
    </div>
  );
}
