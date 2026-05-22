import { Camera } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';

export default function Evidence() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Evidence</h1>
      <EmptyState
        icon={Camera}
        title="Evidence"
        description="Screenshots, recordings, and artifacts from test runs. Coming soon."
      />
    </div>
  );
}
