import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Environment } from '@/types';

const envLabels: Record<Environment, string> = {
  dev: 'Development',
  qa: 'QA',
  uat: 'UAT',
};

const envColors: Record<Environment, string> = {
  dev: 'bg-status-running',
  qa: 'bg-status-pass',
  uat: 'bg-status-skipped',
};

export function EnvironmentBadge() {
  const { environment, setEnvironment } = useWorkspace();

  return (
    <Select value={environment} onValueChange={(v) => setEnvironment(v as Environment)}>
      <SelectTrigger className="w-[130px] h-8 text-xs border-none bg-secondary/50">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${envColors[environment]}`} />
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(envLabels) as Environment[]).map(env => (
          <SelectItem key={env} value={env} className="text-xs">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${envColors[env]}`} />
              {envLabels[env]}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
