import { Card } from '@/components/ui/card';
import { auditEntries } from '@/data/mock';
import { GitCommitHorizontal, Pencil, Plus, Play } from 'lucide-react';

const actionIcons = {
  created: <Plus className="h-3.5 w-3.5" />,
  updated: <Pencil className="h-3.5 w-3.5" />,
  deleted: <GitCommitHorizontal className="h-3.5 w-3.5" />,
  executed: <Play className="h-3.5 w-3.5" />,
};

const actionColors = {
  created: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  updated: 'bg-primary/10 text-primary',
  deleted: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  executed: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
};

export function AuditTimeline({ entries = auditEntries }: { entries?: typeof auditEntries }) {
  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <Card key={entry.id} className="p-4">
          <div className="flex items-start gap-3">
            <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${actionColors[entry.action]}`}>
              {actionIcons[entry.action]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm">
                  <span className="font-medium">{entry.userName}</span>
                  <span className="text-muted-foreground"> {entry.action} </span>
                  <span className="font-medium">{entry.entityName}</span>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{entry.entity}</div>
              {(entry.before || entry.after) && (
                <div className="mt-2 flex gap-3 text-xs">
                  {entry.before && (
                    <div className="flex-1 bg-red-50 dark:bg-red-950/30 rounded p-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Before</div>
                      {Object.entries(entry.before).map(([k, v]) => (
                        <div key={k}><span className="text-muted-foreground">{k}:</span> {String(v)}</div>
                      ))}
                    </div>
                  )}
                  {entry.after && (
                    <div className="flex-1 bg-emerald-50 dark:bg-emerald-950/30 rounded p-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">After</div>
                      {Object.entries(entry.after).map(([k, v]) => (
                        <div key={k}><span className="text-muted-foreground">{k}:</span> {String(v)}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
