/* workspace context */
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import type { Workspace, Environment, Team, RunTemplate, ClientRepo, RepoId } from '@/types';
import { workspaces, teams as mockTeams, runTemplates as mockTemplates, clientRepos as seedClients } from '@/data/mock';

const REPO_STORAGE_KEY = 'lovable.activeRepo';

interface WorkspaceContextType {
  currentWorkspace: Workspace;
  setCurrentWorkspace: (ws: Workspace) => void;
  environment: Environment;
  setEnvironment: (env: Environment) => void;
  allWorkspaces: Workspace[];
  currentTeam: Team | null;
  setCurrentTeam: (team: Team | null) => void;
  teams: Team[];
  templates: RunTemplate[];
  addTemplate: (t: RunTemplate) => void;

  // --- Multi-tenant repo selection ---
  currentRepo: RepoId;
  setCurrentRepo: (id: RepoId) => void;
  clientRepos: ClientRepo[];
  isMasterRepo: boolean;
  /** Convenience: the active client repo, or null when on master. */
  activeClient: ClientRepo | null;
  /** Bumps after override mutations so consumers can re-resolve cases. */
  repoVersion: number;
  bumpRepoVersion: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace>(workspaces[0]);
  const [environment, setEnvironment] = useState<Environment>('qa');
  const [currentTeam, setCurrentTeam] = useState<Team | null>(mockTeams[0]);
  const [templates, setTemplates] = useState<RunTemplate[]>(mockTemplates);
  const [clients] = useState<ClientRepo[]>(seedClients);

  const [currentRepo, setCurrentRepoState] = useState<RepoId>(() => {
    if (typeof window === 'undefined') return 'master';
    const url = new URLSearchParams(window.location.search).get('repo');
    if (url && (url === 'master' || seedClients.some(c => c.id === url))) return url;
    const stored = window.localStorage.getItem(REPO_STORAGE_KEY);
    if (stored && (stored === 'master' || seedClients.some(c => c.id === stored))) return stored;
    return 'master';
  });
  const [repoVersion, setRepoVersion] = useState(0);

  const setCurrentRepo = useCallback((id: RepoId) => {
    setCurrentRepoState(id);
    try { window.localStorage.setItem(REPO_STORAGE_KEY, id); } catch { /* ignore */ }
  }, []);

  // Keep ?repo= in URL for shareable deep-links — without changing route.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (currentRepo === 'master') url.searchParams.delete('repo');
    else url.searchParams.set('repo', currentRepo);
    window.history.replaceState({}, '', url.toString());
  }, [currentRepo]);

  const addTemplate = (t: RunTemplate) => setTemplates(prev => [...prev, t]);
  const bumpRepoVersion = useCallback(() => setRepoVersion(v => v + 1), []);

  const activeClient = useMemo(
    () => (currentRepo === 'master' ? null : clients.find(c => c.id === currentRepo) ?? null),
    [currentRepo, clients],
  );

  return (
    <WorkspaceContext.Provider value={{
      currentWorkspace, setCurrentWorkspace,
      environment, setEnvironment,
      allWorkspaces: workspaces,
      currentTeam, setCurrentTeam,
      teams: mockTeams,
      templates, addTemplate,
      currentRepo, setCurrentRepo,
      clientRepos: clients,
      isMasterRepo: currentRepo === 'master',
      activeClient,
      repoVersion, bumpRepoVersion,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
