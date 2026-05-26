import { useMemo } from 'react';
import { Search, X, Check, ChevronDown, Tag as TagIcon, Workflow, Hash, Activity, Layers, Box } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import {
  releases as allReleases, processes as allProcesses, labelVocabulary,
  modules as allModules, features as allFeatures,
} from '@/data/mock';

export interface LibraryFilterValue {
  q: string;
  moduleIds: string[];
  featureIds: string[];
  releaseIds: string[];
  processIds: string[];
  labels: string[];
  status: string[];
}

export type FacetKey = 'moduleIds' | 'featureIds' | 'releaseIds' | 'processIds' | 'labels' | 'status';

const STATUS_OPTIONS: { id: string; label: string }[] = [
  { id: 'valid', label: 'Published' },
  { id: 'draft', label: 'Draft' },
  { id: 'archived', label: 'Retired' },
];

interface FacetProps {
  icon: React.ElementType;
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  /** Per-option count given the rest of the filter set. */
  getCount?: (id: string) => number;
}

function FacetPopover({ icon: Icon, label, options, selected, onChange, getCount }: FacetProps) {
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };
  const count = selected.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-8 text-xs gap-1.5 px-2.5',
            count > 0 && 'border-primary/40 bg-primary/5 text-foreground',
          )}
        >
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {label}
          {count > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px] tabular-nums">{count}</Badge>
          )}
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}…`} className="text-xs" />
          <CommandList>
            <CommandEmpty>No matches</CommandEmpty>
            <CommandGroup>
              {options.map(opt => {
                const checked = selected.includes(opt.id);
                const c = getCount?.(opt.id);
                return (
                  <CommandItem
                    key={opt.id}
                    value={opt.label}
                    onSelect={() => toggle(opt.id)}
                    className="text-xs cursor-pointer"
                  >
                    <div className={cn(
                      'mr-2 h-3.5 w-3.5 rounded-sm border flex items-center justify-center',
                      checked ? 'bg-primary border-primary' : 'border-input',
                    )}>
                      {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <span className="flex-1 truncate">{opt.label}</span>
                    {typeof c === 'number' && (
                      <span className={cn(
                        'ml-2 text-[10px] tabular-nums',
                        c === 0 ? 'text-muted-foreground/50' : 'text-muted-foreground',
                      )}>
                        {c}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {count > 0 && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs justify-center text-muted-foreground"
              onClick={() => onChange([])}
            >
              Clear {label.toLowerCase()}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface LibraryFilterBarProps {
  value: LibraryFilterValue;
  onChange: (next: LibraryFilterValue) => void;
  /** App scope — used to filter the option lists. */
  appId?: string;
  appReleaseIds?: string[];
  appProcessIds?: string[];
  /** Per-facet, per-option count function (faceted-search style). */
  getFacetCount?: (facet: FacetKey, id: string) => number;
  /** Right-aligned slot for page-level extras. */
  rightSlot?: React.ReactNode;
}

export function LibraryFilterBar({
  value, onChange, appId, appReleaseIds, appProcessIds, getFacetCount, rightSlot,
}: LibraryFilterBarProps) {
  // ---- Module / Feature options (app-scoped, name-deduped for modules) ----
  const moduleOptions = useMemo(() => {
    const list = appId ? allModules.filter(m => m.applicationId === appId) : allModules;
    const seen = new Set<string>();
    const out: Array<{ id: string; label: string }> = [];
    for (const m of list) {
      if (seen.has(m.name)) continue;
      seen.add(m.name);
      out.push({ id: m.id, label: m.name });
    }
    return out;
  }, [appId]);

  const featureOptions = useMemo(() => {
    // If modules selected, restrict to features in those modules (by name dedupe).
    let modIds: string[] | null = null;
    if (value.moduleIds.length) {
      const targetNames = new Set(
        value.moduleIds.map(id => allModules.find(m => m.id === id)?.name).filter(Boolean) as string[],
      );
      modIds = allModules
        .filter(m => targetNames.has(m.name) && (!appId || m.applicationId === appId))
        .map(m => m.id);
    } else if (appId) {
      modIds = allModules.filter(m => m.applicationId === appId).map(m => m.id);
    }
    const list = modIds ? allFeatures.filter(f => modIds!.includes(f.moduleId)) : allFeatures;
    return list.map(f => ({ id: f.id, label: f.name }));
  }, [appId, value.moduleIds]);

  const releaseOptions = useMemo(() => {
    const list = appReleaseIds ? allReleases.filter(r => appReleaseIds.includes(r.id)) : allReleases;
    return list.map(r => ({ id: r.id, label: r.name }));
  }, [appReleaseIds]);

  const processOptions = useMemo(() => {
    const list = appProcessIds ? allProcesses.filter(p => appProcessIds.includes(p.id)) : allProcesses;
    return list.map(p => ({ id: p.id, label: p.name }));
  }, [appProcessIds]);

  const labelOptions = useMemo(
    () => labelVocabulary.map(l => ({ id: l, label: l })),
    [],
  );

  const update = (patch: Partial<LibraryFilterValue>) => onChange({ ...value, ...patch });

  const totalActive =
    value.moduleIds.length + value.featureIds.length +
    value.releaseIds.length + value.processIds.length + value.labels.length +
    value.status.length + (value.q.trim() ? 1 : 0);

  const labelFor = (kind: keyof LibraryFilterValue, id: string): string => {
    if (kind === 'moduleIds')  return allModules.find(m => m.id === id)?.name ?? id;
    if (kind === 'featureIds') return allFeatures.find(f => f.id === id)?.name ?? id;
    if (kind === 'releaseIds') return allReleases.find(r => r.id === id)?.name ?? id;
    if (kind === 'processIds') return allProcesses.find(p => p.id === id)?.name ?? id;
    if (kind === 'status')     return STATUS_OPTIONS.find(s => s.id === id)?.label ?? id;
    return id;
  };
  const remove = (kind: keyof LibraryFilterValue, id: string) => {
    if (kind === 'q') return update({ q: '' });
    const arr = value[kind] as string[];
    update({ [kind]: arr.filter(x => x !== id) } as Partial<LibraryFilterValue>);
  };
  const clearAll = () =>
    onChange({ q: '', moduleIds: [], featureIds: [], releaseIds: [], processIds: [], labels: [], status: [] });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={value.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Search test cases by name, ID, role, or label…"
            className="pl-8 h-8 text-xs"
          />
        </div>
        <FacetPopover icon={Layers} label="Module" options={moduleOptions} selected={value.moduleIds}
          onChange={(next) => update({ moduleIds: next, featureIds: [] })}
          getCount={getFacetCount ? (id) => getFacetCount('moduleIds', id) : undefined} />
        <FacetPopover icon={Box} label="Feature" options={featureOptions} selected={value.featureIds}
          onChange={(next) => update({ featureIds: next })}
          getCount={getFacetCount ? (id) => getFacetCount('featureIds', id) : undefined} />
        <FacetPopover icon={TagIcon} label="Release" options={releaseOptions} selected={value.releaseIds}
          onChange={(next) => update({ releaseIds: next })}
          getCount={getFacetCount ? (id) => getFacetCount('releaseIds', id) : undefined} />
        <FacetPopover icon={Workflow} label="Process" options={processOptions} selected={value.processIds}
          onChange={(next) => update({ processIds: next })}
          getCount={getFacetCount ? (id) => getFacetCount('processIds', id) : undefined} />
        <FacetPopover icon={Hash} label="Label" options={labelOptions} selected={value.labels}
          onChange={(next) => update({ labels: next })}
          getCount={getFacetCount ? (id) => getFacetCount('labels', id) : undefined} />
        <FacetPopover icon={Activity} label="Status" options={STATUS_OPTIONS} selected={value.status}
          onChange={(next) => update({ status: next })}
          getCount={getFacetCount ? (id) => getFacetCount('status', id) : undefined} />
        {totalActive > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={clearAll}>
            Clear all
          </Button>
        )}
        {rightSlot && <div className="ml-auto">{rightSlot}</div>}
      </div>

      {totalActive > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {value.q.trim() && (
            <Chip onRemove={() => remove('q', '')}>“{value.q}”</Chip>
          )}
          {value.moduleIds.map(id => (
            <Chip key={`m-${id}`} onRemove={() => remove('moduleIds', id)}>
              <Layers className="h-2.5 w-2.5" />{labelFor('moduleIds', id)}
            </Chip>
          ))}
          {value.featureIds.map(id => (
            <Chip key={`f-${id}`} onRemove={() => remove('featureIds', id)}>
              <Box className="h-2.5 w-2.5" />{labelFor('featureIds', id)}
            </Chip>
          ))}
          {value.releaseIds.map(id => (
            <Chip key={`r-${id}`} onRemove={() => remove('releaseIds', id)}>
              <TagIcon className="h-2.5 w-2.5" />{labelFor('releaseIds', id)}
            </Chip>
          ))}
          {value.processIds.map(id => (
            <Chip key={`p-${id}`} onRemove={() => remove('processIds', id)}>
              <Workflow className="h-2.5 w-2.5" />{labelFor('processIds', id)}
            </Chip>
          ))}
          {value.labels.map(id => (
            <Chip key={`l-${id}`} onRemove={() => remove('labels', id)}>
              <Hash className="h-2.5 w-2.5" />{id}
            </Chip>
          ))}
          {value.status.map(id => (
            <Chip key={`s-${id}`} onRemove={() => remove('status', id)}>
              <Activity className="h-2.5 w-2.5" />{labelFor('status', id)}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-secondary text-secondary-foreground border">
      {children}
      <button
        onClick={onRemove}
        className="ml-0.5 rounded-full hover:bg-muted p-0.5"
        aria-label="Remove filter"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}
