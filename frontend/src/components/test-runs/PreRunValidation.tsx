import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface ValidationItem {
  label: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

interface PreRunValidationProps {
  selectedCount?: number;
  totalCount?: number;
}

export function PreRunValidation({ selectedCount, totalCount }: PreRunValidationProps) {
  const validationChecks: ValidationItem[] = [
    {
      label: 'Test Case Selection',
      status: selectedCount && selectedCount > 0 ? 'pass' : 'fail',
      message: selectedCount
        ? `${selectedCount} of ${totalCount} test cases selected`
        : 'No test cases selected',
    },
    { label: 'Structure Integrity', status: 'pass', message: 'All test cases have valid steps defined' },
    { label: 'Data Completeness', status: 'pass', message: 'All required input data is provided' },
    { label: 'Dependency Chain', status: 'pass', message: 'No circular dependencies detected' },
    { label: 'Environment Config', status: 'warn', message: 'UAT environment credentials expire in 3 days' },
    { label: 'Access Permissions', status: 'pass', message: 'Current user has execute permissions' },
  ];

  const hasBlocker = validationChecks.some(c => c.status === 'fail');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Pre-Run Validation</h3>
        {hasBlocker ? (
          <span className="text-xs text-status-fail font-medium">Execution Blocked</span>
        ) : (
          <span className="text-xs text-status-pass font-medium">Ready to Execute</span>
        )}
      </div>
      {validationChecks.map((check) => (
        <Card key={check.label} className="p-3 flex items-center gap-3">
          {check.status === 'pass' && <CheckCircle2 className="h-4 w-4 text-status-pass" />}
          {check.status === 'fail' && <XCircle className="h-4 w-4 text-status-fail" />}
          {check.status === 'warn' && <AlertTriangle className="h-4 w-4 text-status-skipped" />}
          <div className="flex-1">
            <div className="text-sm">{check.label}</div>
            <div className="text-[11px] text-muted-foreground">{check.message}</div>
          </div>
        </Card>
      ))}
    </div>
  );
}
