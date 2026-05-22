import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ExecutionMonitor } from '@/components/test-runs/ExecutionMonitor';
import { testRuns, testCases, testRunCaseResults } from '@/data/mock';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Ban, RotateCcw, ArrowLeft, Copy, Globe, BarChart3, GitBranch } from 'lucide-react';
import { DependencyGraphDialog } from '@/components/shared/DependencyGraphDialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const TestRunDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const run = testRuns.find(r => r.id === id);
  const [activeTab, setActiveTab] = useState<'monitor' | 'results'>('monitor');
  const [depsOpen, setDepsOpen] = useState(false);

  if (!run) return <div className="text-sm text-muted-foreground">Test run not found</div>;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate('/runs')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Execution Detail</h1>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setDepsOpen(true)}>
            <GitBranch className="h-3 w-3 mr-1" /> Dependencies
          </Button>
          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => navigate(`/reports/${run.id}`)}>
            <BarChart3 className="h-3 w-3 mr-1" /> View Report
          </Button>
          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => navigate(`/runs/new?clone=${run.id}`)}>
            <Copy className="h-3 w-3 mr-1" /> Clone Run
          </Button>
          <Select onValueChange={(env) => navigate(`/runs/new?clone=${run.id}&env=${env}`)}>
            <SelectTrigger className="h-7 w-auto text-xs gap-1">
              <Globe className="h-3 w-3" />
              <SelectValue placeholder="Re-run in..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dev">Development</SelectItem>
              <SelectItem value="qa">QA</SelectItem>
              <SelectItem value="uat">UAT</SelectItem>
            </SelectContent>
          </Select>
          {run.status === 'running' && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" className="text-xs h-7">
                  <Ban className="h-3 w-3 mr-1" /> Cancel Run
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel Test Run?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Completed cases will keep their results. The currently running case will be stopped. All pending cases will be marked as skipped.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep Running</AlertDialogCancel>
                  <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Cancel Run
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {(run.status === 'failed' || run.status === 'passed') && (
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => navigate(`/runs/new?clone=${run.id}`)}>
              <RotateCcw className="h-3 w-3 mr-1" /> Re-run
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${activeTab === 'monitor' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => setActiveTab('monitor')}
        >
          Live Monitor
        </button>
        <button
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${activeTab === 'results' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => setActiveTab('results')}
        >
          Results
        </button>
      </div>

      {activeTab === 'monitor' && <ExecutionMonitor run={run} />}
      {activeTab === 'results' && (() => {
        const iterCounts = run.iterationCounts || {};
        const caseResults = testRunCaseResults[run.id] || [];
        // Build flat rows: each case × iterations
        const flatRows = (run.selectedCaseIds || []).flatMap(caseId => {
          const tc = testCases.find(c => c.id === caseId);
          const count = iterCounts[caseId] || 1;
          return Array.from({ length: count }, (_, i) => {
            const result = caseResults.find(r => r.testCaseId === caseId && (r.iteration || 1) === i + 1)
              || (i === 0 ? caseResults.find(r => r.testCaseId === caseId) : undefined);
            return {
              caseId,
              caseNumber: tc?.caseNumber || caseId,
              caseName: tc?.testCaseName || 'Unknown',
              iteration: i + 1,
              totalIterations: count,
              status: result?.status || 'pending',
              duration: result?.duration || 0,
              error: result?.error,
            };
          });
        });
        return (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs w-28">Case #</TableHead>
                  <TableHead className="text-xs">Test Case</TableHead>
                  <TableHead className="text-xs w-20">Iteration</TableHead>
                  <TableHead className="text-xs w-20">Status</TableHead>
                  <TableHead className="text-xs w-24">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flatRows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-8">No results yet</TableCell></TableRow>
                ) : flatRows.map((row, idx) => (
                  <TableRow key={`${row.caseId}-${row.iteration}`}>
                    <TableCell className="text-xs font-medium text-primary">{row.caseNumber}</TableCell>
                    <TableCell className="text-xs">
                      {row.caseName}
                      {row.totalIterations > 1 && <span className="text-muted-foreground ml-1">#{row.iteration}</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.totalIterations > 1 ? (
                        <Badge variant="outline" className="text-[10px]">{row.iteration}/{row.totalIterations}</Badge>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'passed' ? 'default' : row.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.duration > 0 ? `${(row.duration / 1000).toFixed(1)}s` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })()}
      <DependencyGraphDialog
        open={depsOpen}
        onOpenChange={setDepsOpen}
        caseIds={run.selectedCaseIds || []}
      />
    </div>
  );
};

export default TestRunDetail;
