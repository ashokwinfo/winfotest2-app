import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, AppWindow, Tag, Layers, Box, FlaskConical, Play, ScrollText, Workflow, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { applications, releases, modules, features, testCases, testRuns, auditEntries, processes, labelCounts } from '@/data/mock';
import { Input } from '@/components/ui/input';

interface SearchResult {
  id: string;
  name: string;
  category: string;
  description?: string;
  route: string;
  icon: React.ElementType;
}

function buildSearchIndex(): SearchResult[] {
  const results: SearchResult[] = [];

  applications.forEach(app => {
    results.push({ id: app.id, name: app.name, category: 'Applications', description: app.description, route: `/applications/${app.id}`, icon: AppWindow });
  });

  releases.forEach(rel => {
    const app = applications.find(a => a.id === rel.applicationId);
    results.push({ id: rel.id, name: rel.name, category: 'Releases', description: app?.name, route: `/releases/${rel.id}`, icon: Tag });
  });

  modules.forEach(mod => {
    const rel = releases.find(r => r.id === mod.releaseId);
    results.push({ id: mod.id, name: mod.name, category: 'Modules', description: rel?.name, route: `/modules/${mod.id}`, icon: Layers });
  });

  features.forEach(feat => {
    const mod = modules.find(m => m.id === feat.moduleId);
    results.push({ id: feat.id, name: feat.name, category: 'Features', description: mod?.name, route: `/test-cases/${feat.id}`, icon: Box });
  });

  testCases.forEach(tc => {
    const tagSummary = [
      ...(tc.processIds ?? []).map(pid => processes.find(p => p.id === pid)?.name).filter(Boolean) as string[],
      ...(tc.labels ?? []),
    ].join(', ');
    results.push({
      id: tc.id,
      name: `${tc.caseNumber} — ${tc.testCaseName}`,
      category: 'Test Cases',
      description: tagSummary || tc.type,
      route: `/test-case/${tc.id}`,
      icon: FlaskConical,
    });
  });

  processes.forEach(p => {
    results.push({ id: p.id, name: p.name, category: 'Processes', description: p.description, route: `/processes/${p.id}`, icon: Workflow });
  });

  labelCounts.forEach(l => {
    results.push({ id: l.label, name: l.label, category: 'Labels', description: `${l.count} test case${l.count === 1 ? '' : 's'}`, route: `/labels/${encodeURIComponent(l.label)}`, icon: Hash });
  });

  testRuns.forEach(run => {
    results.push({ id: run.id, name: run.name, category: 'Test Runs', description: run.status, route: `/runs/${run.id}`, icon: Play });
  });

  auditEntries.slice(0, 20).forEach(entry => {
    results.push({ id: entry.id, name: `${entry.userName} ${entry.action} ${entry.entityName}`, category: 'Audit Log', route: '/audit', icon: ScrollText });
  });

  return results;
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const searchIndex = useMemo(() => buildSearchIndex(), []);

  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return searchIndex.filter(r => r.name.toLowerCase().includes(q) || (r.description?.toLowerCase().includes(q)));
  }, [query, searchIndex]);

  const grouped = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    filtered.forEach(r => {
      if (!groups[r.category]) groups[r.category] = [];
      groups[r.category].push(r);
    });
    return groups;
  }, [filtered]);

  const flatResults = useMemo(() => {
    const flat: SearchResult[] = [];
    Object.values(grouped).forEach(items => flat.push(...items.slice(0, 5)));
    return flat;
  }, [grouped]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flatResults[selectedIndex]) {
      e.preventDefault();
      navigate(flatResults[selectedIndex].route);
      setOpen(false);
      setQuery('');
    }
  };

  useEffect(() => {
    const el = resultsRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleSelect = (result: SearchResult) => {
    navigate(result.route);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="relative flex-1 max-w-2xl" ref={containerRef}>
      {/* Search trigger */}
      <div
        className={cn(
          'flex items-center gap-2 h-8 rounded-md border border-input bg-muted/40 px-3 cursor-text transition-colors hover:bg-muted/60',
          open && 'ring-2 ring-ring bg-background'
        )}
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
      >
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {open ? (
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search everything..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
          />
        ) : (
          <span className="flex-1 text-xs text-muted-foreground">Search...</span>
        )}
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-mono text-muted-foreground">
          ⌘K
        </kbd>
        {open && query && (
          <button onClick={() => setQuery('')} className="p-0.5 rounded hover:bg-accent">
            <X className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Results dropdown */}
      {open && query.trim() && (
        <div
          ref={resultsRef}
          className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg max-h-[420px] overflow-y-auto z-50"
        >
          {flatResults.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results for "{query}"
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest font-semibold text-muted-foreground bg-muted/30 sticky top-0">
                  {category}
                </div>
                {items.slice(0, 5).map((result) => {
                  const globalIdx = flatResults.indexOf(result);
                  const Icon = result.icon;
                  return (
                    <div
                      key={result.id}
                      data-index={globalIdx}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
                        globalIdx === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'
                      )}
                      onClick={() => handleSelect(result)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">{result.name}</div>
                        {result.description && (
                          <div className="text-[11px] text-muted-foreground truncate">{result.description}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
