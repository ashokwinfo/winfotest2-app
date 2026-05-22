import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { applications, modules, features, releases, processes } from '@/data/mock';

/**
 * Redirect legacy URLs into the unified Library page (`/applications/:appId/library`)
 * with the correct scope or facet preselected.
 */
type RedirectKind = 'feature' | 'module' | 'release' | 'process' | 'label';

interface Props { kind: RedirectKind }

export default function LibraryRedirect({ kind }: Props) {
  const params = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    let appId: string | undefined;
    let qs = '';

    if (kind === 'feature') {
      const featureId = params.featureId!;
      const feat = features.find(f => f.id === featureId);
      const mod = feat ? modules.find(m => m.id === feat.moduleId) : undefined;
      appId = mod?.applicationId ?? applications[0]?.id;
      qs = `groupBy=module&scopeKind=feature&scopeId=${featureId}`;
    } else if (kind === 'module') {
      const moduleId = params.id!;
      const mod = modules.find(m => m.id === moduleId);
      appId = mod?.applicationId ?? applications[0]?.id;
      qs = `groupBy=module&scopeKind=module&scopeId=${moduleId}`;
    } else if (kind === 'release') {
      const releaseId = params.id!;
      const rel = releases.find(r => r.id === releaseId);
      appId = rel?.applicationId ?? applications[0]?.id;
      qs = `release=${releaseId}`;
    } else if (kind === 'process') {
      const processId = params.id!;
      const proc = processes.find(p => p.id === processId);
      appId = proc?.applicationId ?? applications[0]?.id;
      qs = `process=${processId}`;
    } else if (kind === 'label') {
      const label = decodeURIComponent(params.slug!);
      appId = applications[0]?.id;
      qs = `label=${encodeURIComponent(label)}`;
    }

    if (appId) {
      navigate(`/applications/${appId}/library?${qs}`, { replace: true });
    } else {
      navigate('/applications', { replace: true });
    }
  }, [kind, params, navigate]);

  return null;
}
