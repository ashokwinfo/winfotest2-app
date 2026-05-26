import React from 'react';
import { cn } from '@/lib/utils';
import type { RunStatus } from '@/types';
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Clock, MinusCircle } from 'lucide-react';

const statusConfig: Record<RunStatus, { label: string; className: string; dotClass: string; Icon: React.ComponentType<{ className?: string }> }> = {
  pending: { label: 'Awaiting validation', className: 'bg-status-pending/10 text-status-pending', dotClass: 'bg-status-pending', Icon: Clock },
  running: { label: 'In validation', className: 'bg-status-running/10 text-status-running', dotClass: 'bg-status-running', Icon: Loader2 },
  passed: { label: 'Ready to ship', className: 'bg-status-pass/10 text-status-pass', dotClass: 'bg-status-pass', Icon: CheckCircle2 },
  failed: { label: 'Risks found', className: 'bg-status-fail/10 text-status-fail', dotClass: 'bg-status-fail', Icon: XCircle },
  skipped: { label: 'Skipped', className: 'bg-status-skipped/10 text-status-skipped', dotClass: 'bg-status-skipped', Icon: MinusCircle },
};

export type OutcomeVariant = 'ready' | 'review' | 'blocked' | 'validating';

const outcomeConfig: Record<OutcomeVariant, { label: string; className: string; Icon: React.ComponentType<{ className?: string }>; spin?: boolean }> = {
  ready: { label: 'Ready to ship', className: 'bg-status-pass/10 text-status-pass', Icon: CheckCircle2 },
  review: { label: 'Needs review', className: 'bg-status-pending/10 text-status-pending', Icon: AlertTriangle },
  blocked: { label: 'Blocked', className: 'bg-status-fail/10 text-status-fail', Icon: XCircle },
  validating: { label: 'In validation', className: 'bg-status-running/10 text-status-running', Icon: Loader2, spin: true },
};

interface StatusBadgeProps {
  status?: RunStatus;
  variant?: OutcomeVariant;
  label?: string;
  className?: string;
}

export const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ status, variant, label, className }, ref) => {
    if (variant) {
      const cfg = outcomeConfig[variant];
      const Icon = cfg.Icon;
      return (
        <span ref={ref} className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium', cfg.className, className)}>
          <Icon className={cn('h-3 w-3', cfg.spin && 'animate-spin')} />
          {label ?? cfg.label}
        </span>
      );
    }
    const config = statusConfig[status ?? 'pending'];
    const Icon = config.Icon;
    const spin = status === 'running';
    return (
      <span ref={ref} className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium', config.className, className)}>
        <Icon className={cn('h-3 w-3', spin && 'animate-spin')} />
        {label ?? config.label}
      </span>
    );
  }
);

StatusBadge.displayName = 'StatusBadge';
