import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { testRuns, releases, modules } from '@/data/mock';
import { Play, Copy, Search, BarChart3 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { RunStatus } from '@/types';
import { useWorkspace } from '@/contexts/WorkspaceContext';

const statusTabs: { label: string; value: string }[] = [
  { label: 'All', value: 'all' },
  { label: 'In progress', value: 'running' },
  { label: 'Ready to ship', value: 'passed' },
  { label: 'Risks found', value: 'failed' },
  { label: 'Awaiting validation', value: 'pending' },
];

const TestRuns = () => {
  const navigate = useNavigate();
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const { currentTeam } = useWorkspace();

  const filteredRuns = useMemo(() => {
    let runs = testRuns;
    // Filter by team
    if (currentTeam) {
      runs = runs.filter(r => r.teamId === currentTeam.id || !r.teamId);
    } else {
      runs = runs.filter(r => !r.teamId);
    }
    if (filterStatus !== 'all') {
      runs = runs.filter(r => r.status === filterStatus);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      runs = runs.filter(r => r.name.toLowerCase().includes(q));
    }
    return runs;
  }, [filterStatus, searchQuery, currentTeam]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Validation Runs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Every check that protected a release</p>
        </div>
        <Button size="sm" onClick={() => navigate('/runs/new')}>
          <Play className="h-3.5 w-3.5 mr-1" /> Run regression
        </Button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {statusTabs.map(tab => (
            <Button
              key={tab.value}
              size="sm"
              variant={filterStatus === tab.value ? 'default' : 'outline'}
              className="text-xs h-7"
              onClick={() => setFilterStatus(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search runs..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-xs"
            />
          </div>
        </div>

        {filteredRuns.map((run) => {
          const release = releases.find(r => r.id === run.releaseId);
          const mod = modules.find(m => m.id === run.moduleId);
          const confidence = run.totalCases > 0 ? Math.round((run.passedCases / run.totalCases) * 100) : 0;
          const outcome =
            run.status === 'passed' ? `${confidence}% confidence · ready to ship` :
            run.status === 'failed' ? `${run.failedCases} blocker${run.failedCases === 1 ? '' : 's'} · review needed` :
            run.status === 'running' ? `${confidence}% so far · validation in progress` :
            'awaiting validation';
          return (
            <Card
              key={run.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate(`/runs/${run.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{run.name} — {outcome}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {release?.name} · {mod?.name} · {run.environment.toUpperCase()} · {run.createdBy}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={(e) => { e.stopPropagation(); navigate(`/reports/${run.id}`); }}
                      title="View report"
                    >
                      <BarChart3 className="h-3 w-3" /> Report
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={(e) => { e.stopPropagation(); navigate(`/runs/new?clone=${run.id}`); }}
                      title="Re-run"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <StatusBadge status={run.status} />
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Progress value={run.progress} className="h-1.5 flex-1" />
                  <div className="flex gap-3 text-xs text-muted-foreground shrink-0">
                    <span className="text-status-pass">{run.passedCases} validated</span>
                    <span className="text-status-fail">{run.failedCases} risks</span>
                    <span>{run.totalCases - run.passedCases - run.failedCases} pending</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filteredRuns.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">Nothing to validate yet — let's protect your first release.</div>
        )}
      </div>
    </div>
  );
};

export default TestRuns;
