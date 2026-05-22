import { Copy } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';

export default function CloneRuns() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Clone Runs</h1>
      <EmptyState
        icon={Copy}
        title="Clone Runs"
        description="Clone and duplicate test runs across environments. Coming soon."
      />
    </div>
  );
}
