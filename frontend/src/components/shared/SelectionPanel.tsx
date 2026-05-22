import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Search, X, ChevronDown, ChevronRight, Trash2, FolderInput } from 'lucide-react';
import type { TestCase } from '@/types';

interface GroupInfo {
  id: string;
  name: string;
}

interface SelectionPanelProps {
  selected: Set<string>;
  allCases: TestCase[];
  groups: GroupInfo[];
  getGroupId: (tc: TestCase) => string;
  onRemove: (id: string) => void;
  onRemoveGroup: (groupId: string) => void;
  onClearAll: () => void;
  /** Optional: shows a "Move / Tag…" button in the panel header. */
  onBulkMove?: () => void;
}

const SelectionPanel = ({
  selected,
  allCases,
  groups,
  getGroupId,
  onRemove,
  onRemoveGroup,
  onClearAll,
  onBulkMove,
}: SelectionPanelProps) => {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const selectedCases = useMemo(() => {
    return Array.from(selected)
      .map(id => allCases.find(c => c.id === id))
      .filter(Boolean) as TestCase[];
  }, [selected, allCases]);

  const filteredCases = useMemo(() => {
    if (!search) return selectedCases;
    const q = search.toLowerCase();
    return selectedCases.filter(
      tc => tc.caseNumber.toLowerCase().includes(q) || tc.testCaseName.toLowerCase().includes(q)
    );
  }, [selectedCases, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, TestCase[]>();
    for (const tc of filteredCases) {
      const gId = getGroupId(tc);
      if (!map.has(gId)) map.set(gId, []);
      map.get(gId)!.push(tc);
    }
    return map;
  }, [filteredCases, getGroupId]);

  const toggleCollapse = (groupId: string) => {
    const next = new Set(collapsed);
    next.has(groupId) ? next.delete(groupId) : next.add(groupId);
    setCollapsed(next);
  };

  return (
    <div className="border rounded-lg bg-background flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2.5 border-b flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold">
          Selected ({selected.size})
          {search && filteredCases.length !== selectedCases.length && (
            <span className="text-muted-foreground font-normal ml-1">
              · {filteredCases.length} matching
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {onBulkMove && selected.size > 0 && (
            <button
              className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
              onClick={onBulkMove}
            >
              <FolderInput className="h-3 w-3" /> Move / Tag…
            </button>
          )}
          <button
            className="text-[10px] text-muted-foreground hover:text-destructive underline"
            onClick={onClearAll}
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1.5 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Filter selection..."
            className="pl-7 h-6 text-[11px]"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Grouped list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {groups.filter(g => grouped.has(g.id)).map(group => {
            const items = grouped.get(group.id) || [];
            const isCollapsed = collapsed.has(group.id);
            const allInGroup = selectedCases.filter(tc => getGroupId(tc) === group.id);

            return (
              <div key={group.id} className="rounded-md border border-border/50 overflow-hidden">
                {/* Group header */}
                <div className="flex items-center justify-between px-2 py-1.5 bg-muted/40 hover:bg-muted/60 transition-colors">
                  <button
                    className="flex items-center gap-1.5 text-[11px] font-medium flex-1 text-left"
                    onClick={() => toggleCollapse(group.id)}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    <span className="truncate">{group.name}</span>
                    <span className="text-muted-foreground font-normal">({allInGroup.length})</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
                    onClick={() => onRemoveGroup(group.id)}
                  >
                    <Trash2 className="h-2.5 w-2.5 mr-0.5" /> Remove
                  </Button>
                </div>

                {/* Group items */}
                {!isCollapsed && (
                  <div className="divide-y divide-border/30">
                    {items.map(tc => (
                      <div
                        key={tc.id}
                        className="flex items-center justify-between px-2.5 py-1 hover:bg-muted/30 group"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[10px] font-medium text-primary shrink-0">
                            {tc.caseNumber}
                          </span>
                          <span className="text-[10px] truncate text-muted-foreground">
                            {tc.testCaseName}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={() => onRemove(tc.id)}
                        >
                          <X className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {filteredCases.length === 0 && selected.size > 0 && (
            <p className="text-[11px] text-muted-foreground text-center py-4">
              No matches in selection
            </p>
          )}

          {selected.size === 0 && (
            <p className="text-[11px] text-muted-foreground text-center py-8">
              Select test cases from the table
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default SelectionPanel;
