import { useLocation, Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { applications, releases, modules, features, testCases } from '@/data/mock';

type Crumb = { label: string; path: string };

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return [];

  // /applications
  if (segments[0] === 'applications' && segments.length === 1) {
    return [{ label: 'Applications', path: '/applications' }];
  }

  // /applications/:id
  if (segments[0] === 'applications' && segments.length === 2) {
    const app = applications.find(a => a.id === segments[1]);
    return [
      { label: 'Applications', path: '/applications' },
      { label: app?.name || segments[1], path: `/applications/${segments[1]}` },
    ];
  }

  // /releases/:id
  if (segments[0] === 'releases' && segments.length === 2) {
    const rel = releases.find(r => r.id === segments[1]);
    const app = rel ? applications.find(a => a.id === rel.applicationId) : undefined;
    return [
      ...(app ? [{ label: app.name, path: `/applications/${app.id}` }] : []),
      { label: rel?.name || segments[1], path: `/releases/${segments[1]}` },
    ];
  }

  // /modules/:id
  if (segments[0] === 'modules' && segments.length === 2) {
    const mod = modules.find(m => m.id === segments[1]);
    const rel = mod ? releases.find(r => r.id === mod.releaseId) : undefined;
    const app = rel ? applications.find(a => a.id === rel.applicationId) : undefined;
    return [
      ...(app ? [{ label: app.name, path: `/applications/${app.id}` }] : []),
      ...(rel ? [{ label: rel.name, path: `/releases/${rel.id}` }] : []),
      { label: mod?.name || segments[1], path: `/modules/${segments[1]}` },
    ];
  }

  // /test-cases/:featureId
  if (segments[0] === 'test-cases' && segments.length === 2) {
    const feat = features.find(f => f.id === segments[1]);
    const mod = feat ? modules.find(m => m.id === feat.moduleId) : undefined;
    const rel = mod ? releases.find(r => r.id === mod.releaseId) : undefined;
    const app = rel ? applications.find(a => a.id === rel.applicationId) : undefined;
    return [
      ...(app ? [{ label: app.name, path: `/applications/${app.id}` }] : []),
      ...(rel ? [{ label: rel.name, path: `/releases/${rel.id}` }] : []),
      ...(mod ? [{ label: mod.name, path: `/modules/${mod.id}` }] : []),
      { label: feat?.name || segments[1], path: `/test-cases/${segments[1]}` },
    ];
  }

  // /test-case/:id
  if (segments[0] === 'test-case' && segments.length === 2) {
    const tc = testCases.find(t => t.id === segments[1]);
    const feat = tc ? features.find(f => f.id === tc.featureId) : undefined;
    const mod = feat ? modules.find(m => m.id === feat.moduleId) : undefined;
    const rel = mod ? releases.find(r => r.id === mod.releaseId) : undefined;
    const app = rel ? applications.find(a => a.id === rel.applicationId) : undefined;
    return [
      ...(app ? [{ label: app.name, path: `/applications/${app.id}` }] : []),
      ...(rel ? [{ label: rel.name, path: `/releases/${rel.id}` }] : []),
      ...(mod ? [{ label: mod.name, path: `/modules/${mod.id}` }] : []),
      ...(feat ? [{ label: feat.name, path: `/test-cases/${feat.id}` }] : []),
      { label: tc?.caseNumber || segments[1], path: `/test-case/${segments[1]}` },
    ];
  }

  // Fallback: static route labels
  const routeLabels: Record<string, string> = {
    runs: 'Test Runs',
    settings: 'Settings',
    audit: 'Audit Log',
    'import-export': 'Import / Export',
  };

  return segments.map((seg, i) => ({
    label: routeLabels[seg] || seg,
    path: '/' + segments.slice(0, i + 1).join('/'),
  }));
}

export function AppBreadcrumbs() {
  const location = useLocation();
  const crumbs = buildCrumbs(location.pathname);

  if (crumbs.length === 0) {
    return (
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Dashboard</span>
      </nav>
    );
  }

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground">
      <Link to="/" className="hover:text-foreground transition-colors">Dashboard</Link>
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.path} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            {isLast ? (
              <span className="font-medium text-foreground">{crumb.label}</span>
            ) : (
              <Link to={crumb.path} className="hover:text-foreground transition-colors">{crumb.label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
