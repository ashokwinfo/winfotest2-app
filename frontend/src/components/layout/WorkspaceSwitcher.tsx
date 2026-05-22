import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function WorkspaceSwitcher() {
  const { currentWorkspace, setCurrentWorkspace, allWorkspaces } = useWorkspace();

  return (
    <Select
      value={currentWorkspace.id}
      onValueChange={(id) => {
        const ws = allWorkspaces.find(w => w.id === id);
        if (ws) setCurrentWorkspace(ws);
      }}
    >
      <SelectTrigger className="w-[180px] h-8 text-xs border-none bg-secondary/50">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allWorkspaces.map(ws => (
          <SelectItem key={ws.id} value={ws.id} className="text-xs">{ws.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
