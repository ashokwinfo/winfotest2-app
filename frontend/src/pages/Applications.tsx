import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { applications, releases, modules, features, testCases, testRuns } from '@/data/mock';
import { Plus, AppWindow, ArrowRight, ShieldCheck, AlertTriangle } from 'lucide-react';
import { StatusBadge } from '@/components/shared/StatusBadge';

const Applications = () => {
  const navigate = useNavigate();

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Quality and release readiness across your portfolio</p>
        </div>
        <Button size="sm"><Plus className="h-3.5 w-3.5 mr-1" /> Onboard a product</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {applications.map((app) => {
          const appReleases = releases.filter(r => r.applicationId === app.id);
          const appModuleIds = modules.filter(m => appReleases.some(r => r.id === m.releaseId)).map(m => m.id);
          const appModuleNames = Array.from(new Set(modules.filter(m => appModuleIds.includes(m.id)).map(m => m.name))).slice(0, 4);
          const appFeatureIds = features.filter(f => appModuleIds.includes(f.moduleId)).map(f => f.id);
          const appCases = testCases.filter(tc => appFeatureIds.includes(tc.featureId));
          const appRuns = testRuns.filter(r => appReleases.some(rel => rel.id === r.releaseId));
          const lastRun = appRuns[0];

          return (
            <Card
              key={app.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate(`/applications/${app.id}`)}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <AppWindow className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium">{app.name}</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {appModuleNames.join(', ') || app.description}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>

                <div className="mt-4 border-t pt-3 space-y-2">
                  {appReleases.slice(0, 3).map((rel) => {
                    const relRuns = appRuns.filter(r => r.releaseId === rel.id);
                    const latest = relRuns[0];
                    const confidence = latest && latest.totalCases > 0
                      ? Math.round((latest.passedCases / latest.totalCases) * 100)
                      : null;
                    const risks = relRuns.reduce((sum, r) => sum + (r.failedCases || 0), 0);
                    let variant: 'ready' | 'review' | 'blocked' | 'validating' = 'review';
                    let outcome = 'awaiting validation';
                    if (latest?.status === 'running') { variant = 'validating'; outcome = 'in validation'; }
                    else if (risks > 0) { variant = 'blocked'; outcome = `${risks} open risk${risks === 1 ? '' : 's'}`; }
                    else if (confidence !== null && confidence >= 90) { variant = 'ready'; outcome = `${confidence}% confidence · ready to ship`; }
                    else if (confidence !== null) { variant = 'review'; outcome = `${confidence}% confidence · needs review`; }

                    return (
                      <div key={rel.id} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{rel.version}</span>
                          <span className="text-muted-foreground truncate">— {outcome}</span>
                        </div>
                        <StatusBadge variant={variant} className="shrink-0" />
                      </div>
                    );
                  })}
                  {appReleases.length === 0 && (
                    <div className="text-xs text-muted-foreground">No releases yet — start by onboarding your first version.</div>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> {appCases.length} covered scenarios</span>
                  {lastRun && (
                    <>
                      <span>·</span>
                      <span>Last validation {new Date(lastRun.startedAt || app.createdAt).toLocaleDateString()}</span>
                    </>
                  )}
                  {appRuns.some(r => (r.failedCases || 0) > 0) && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 text-status-fail">
                        <AlertTriangle className="h-3 w-3" /> open risks
                      </span>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default Applications;
