import { AuditTimeline } from '@/components/audit/AuditTimeline';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

const AuditLog = () => {
  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Track all changes across your workspace</p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search activity..." className="pl-8 h-8 text-xs" />
        </div>
        <Select defaultValue="all">
          <SelectTrigger className="w-[130px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Actions</SelectItem>
            <SelectItem value="created" className="text-xs">Created</SelectItem>
            <SelectItem value="updated" className="text-xs">Updated</SelectItem>
            <SelectItem value="deleted" className="text-xs">Deleted</SelectItem>
            <SelectItem value="executed" className="text-xs">Executed</SelectItem>
          </SelectContent>
        </Select>
        <Select defaultValue="all">
          <SelectTrigger className="w-[130px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Entities</SelectItem>
            <SelectItem value="TestCase" className="text-xs">Test Cases</SelectItem>
            <SelectItem value="TestStep" className="text-xs">Test Steps</SelectItem>
            <SelectItem value="TestRun" className="text-xs">Test Runs</SelectItem>
            <SelectItem value="Application" className="text-xs">Applications</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <AuditTimeline />
    </div>
  );
};

export default AuditLog;
