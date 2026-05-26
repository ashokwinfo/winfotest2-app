import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { testCases } from '@/data/mock';
import { ChevronRight, GitBranch, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TreeNode {
  id: string;
  caseNumber: string;
  name: string;
  children: TreeNode[];
}

interface DependencyGraphDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseIds: string[];
}

function buildDependencyTrees(caseIds: string[]) {
  const relevantCases = testCases.filter(tc => caseIds.includes(tc.id));
  const allCasesByNumber = new Map(testCases.map(tc => [tc.caseNumber, tc]));
  const allCasesById = new Map(testCases.map(tc => [tc.id, tc]));

  // Collect all cases in chains (walk upstream and downstream from each relevant case)
  const visited = new Set<string>();
  const chainCaseIds = new Set<string>();

  function walkUp(caseNumber: string): string | undefined {
    const tc = allCasesByNumber.get(caseNumber);
    if (!tc || visited.has(tc.id)) return tc?.id;
    visited.add(tc.id);
    if (tc.dependency) {
      walkUp(tc.dependency);
    }
    return tc.id;
  }

  function walkDown(caseNumber: string) {
    const dependents = testCases.filter(tc => tc.dependency === caseNumber);
    for (const dep of dependents) {
      if (!visited.has(dep.id)) {
        visited.add(dep.id);
        walkDown(dep.caseNumber);
      }
    }
  }

  // Find all roots and build trees
  for (const tc of relevantCases) {
    visited.clear();
    // Walk up to find root
    let current = tc;
    while (current.dependency) {
      const parent = allCasesByNumber.get(current.dependency);
      if (!parent) break;
      current = parent;
    }
    chainCaseIds.add(current.id);
    // Walk down from root to collect all chain members
    const collectChain = (cn: string) => {
      const c = allCasesByNumber.get(cn);
      if (c) chainCaseIds.add(c.id);
      testCases.filter(t => t.dependency === cn).forEach(t => {
        chainCaseIds.add(t.id);
        collectChain(t.caseNumber);
      });
    };
    collectChain(current.caseNumber);
  }

  // Find all root nodes (cases that have no dependency or whose dependency is outside the chain)
  const chainCases = testCases.filter(tc => chainCaseIds.has(tc.id));
  const roots = chainCases.filter(tc => {
    if (!tc.dependency) return true;
    const parent = allCasesByNumber.get(tc.dependency);
    return !parent || !chainCaseIds.has(parent.id);
  });

  // Build tree from roots
  function buildNode(tc: typeof testCases[0]): TreeNode {
    const children = chainCases
      .filter(c => c.dependency === tc.caseNumber)
      .sort((a, b) => a.caseNumber.localeCompare(b.caseNumber))
      .map(c => buildNode(c));
    return { id: tc.id, caseNumber: tc.caseNumber, name: tc.testCaseName, children };
  }

  const trees = roots
    .sort((a, b) => a.caseNumber.localeCompare(b.caseNumber))
    .map(r => buildNode(r));

  // Standalone: relevant cases that ended up with no chain connections
  const standalone = relevantCases.filter(tc => !chainCaseIds.has(tc.id) || (
    !tc.dependency && testCases.filter(t => t.dependency === tc.caseNumber && caseIds.includes(t.id)).length === 0
    && trees.find(t => t.id === tc.id && t.children.length === 0)
  ));

  // Filter trees to only include those with actual chains (more than just a root with no children)
  const chainTrees = trees.filter(t => t.children.length > 0 || relevantCases.some(rc => rc.dependency === allCasesById.get(t.id)?.caseNumber));
  
  // Standalone = relevant cases not part of any multi-node chain
  const chainNodeIds = new Set<string>();
  function collectIds(node: TreeNode) {
    chainNodeIds.add(node.id);
    node.children.forEach(collectIds);
  }
  chainTrees.forEach(collectIds);

  const standaloneList = relevantCases.filter(tc => !chainNodeIds.has(tc.id));

  return { chains: chainTrees, standalone: standaloneList };
}

function TreeNodeView({ node, highlightIds, depth = 0 }: { node: TreeNode; highlightIds: Set<string>; depth?: number }) {
  const isHighlighted = highlightIds.has(node.id);
  return (
    <div>
      <div className={cn(
        "flex items-center gap-2 py-1 px-2 rounded text-xs",
        isHighlighted ? "bg-primary/10 text-foreground font-medium" : "text-muted-foreground"
      )} style={{ paddingLeft: `${depth * 20 + 8}px` }}>
        {depth > 0 && (
          <span className="text-muted-foreground/40">└──</span>
        )}
        <Circle className={cn("h-2.5 w-2.5 shrink-0", isHighlighted ? "fill-primary text-primary" : "text-muted-foreground/50")} />
        <span className="font-mono text-[11px]">{node.caseNumber}</span>
        <span className="truncate">{node.name}</span>
      </div>
      {node.children.map(child => (
        <TreeNodeView key={child.id} node={child} highlightIds={highlightIds} depth={depth + 1} />
      ))}
    </div>
  );
}

export function DependencyGraphDialog({ open, onOpenChange, caseIds }: DependencyGraphDialogProps) {
  const [standaloneOpen, setStandaloneOpen] = useState(false);
  const highlightIds = useMemo(() => new Set(caseIds), [caseIds]);

  const { chains, standalone } = useMemo(() => buildDependencyTrees(caseIds), [caseIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <GitBranch className="h-4 w-4" />
            Dependency Graph
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 space-y-3 pr-1">
          {chains.length === 0 && standalone.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">No test cases to display.</p>
          )}

          {chains.map(tree => (
            <div key={tree.id} className="border rounded-md p-2">
              <TreeNodeView node={tree} highlightIds={highlightIds} />
            </div>
          ))}

          {standalone.length > 0 && (
            <Collapsible open={standaloneOpen} onOpenChange={setStandaloneOpen}>
              <CollapsibleTrigger className="flex items-center gap-2 w-full px-2 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted/50">
                <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", standaloneOpen && "rotate-90")} />
                Standalone Cases ({standalone.length})
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border rounded-md p-2 mt-1 space-y-0.5">
                  {standalone.map(tc => (
                    <div key={tc.id} className="flex items-center gap-2 py-1 px-2 text-xs text-muted-foreground">
                      <Circle className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />
                      <span className="font-mono text-[11px]">{tc.caseNumber}</span>
                      <span className="truncate">{tc.testCaseName}</span>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
