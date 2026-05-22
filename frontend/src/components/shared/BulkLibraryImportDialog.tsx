import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface BulkLibraryImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: {
    type: 'feature' | 'module' | 'release' | 'application';
    id: string;
    name: string;
  };
}

interface ParsedRow {
  caseNumber: string;
  testCaseName: string;
  feature?: string;
  module?: string;
  role: string;
  type: string;
  status: string;
}

const MOCK_PARSED_ROWS: ParsedRow[] = [
  { caseNumber: 'TC-NEW-001', testCaseName: 'Verify login with valid credentials', feature: 'Authentication', module: 'User Management', role: 'Admin', type: 'functional', status: 'new' },
  { caseNumber: 'TC-NEW-002', testCaseName: 'Validate password reset flow', feature: 'Authentication', module: 'User Management', role: 'End User', type: 'functional', status: 'new' },
  { caseNumber: 'TC-NEW-003', testCaseName: 'Check session timeout handling', feature: 'Session Mgmt', module: 'User Management', role: 'Admin', type: 'security', status: 'new' },
  { caseNumber: 'TC-NEW-004', testCaseName: 'Verify multi-factor authentication', feature: 'Authentication', module: 'User Management', role: 'End User', type: 'functional', status: 'new' },
  { caseNumber: 'TC-NEW-005', testCaseName: 'Validate role-based access control', feature: 'Permissions', module: 'User Management', role: 'Admin', type: 'security', status: 'new' },
];

const BulkLibraryImportDialog = ({ open, onOpenChange, scope }: BulkLibraryImportDialogProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);

  const showFeatureCol = scope.type !== 'feature';
  const showModuleCol = scope.type === 'release' || scope.type === 'application';

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setParsing(true);
    setParsed(false);
    // Simulate parsing delay
    setTimeout(() => {
      setRows(MOCK_PARSED_ROWS);
      setParsing(false);
      setParsed(true);
    }, 800);
  };

  const handleApply = () => {
    toast({
      title: 'Test Cases Imported',
      description: `${rows.length} test case(s) imported into ${scope.name}.`,
    });
    handleClose();
  };

  const handleClose = () => {
    setFile(null);
    setParsing(false);
    setParsed(false);
    setRows([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Import Test Cases — {scope.name}
            <Badge variant="outline" className="text-[10px] capitalize">{scope.type}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* Upload area */}
          {!parsed && !parsing && (
            <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg p-8 cursor-pointer hover:bg-muted/30 transition-colors">
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Drop your file here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">Accepts .xlsx or .csv files</p>
              </div>
              <input
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={handleFileSelect}
              />
            </label>
          )}

          {/* Parsing state */}
          {parsing && (
            <div className="flex flex-col items-center justify-center gap-3 py-8">
              <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Parsing {file?.name}...</p>
            </div>
          )}

          {/* Preview table */}
          {parsed && rows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-status-pass" />
                  <span className="text-sm font-medium">{rows.length} test cases found</span>
                </div>
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setFile(null); setParsed(false); setRows([]); }}>
                  Choose different file
                </Button>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-xs w-28">Case #</TableHead>
                      <TableHead className="text-xs">Test Case Name</TableHead>
                      {showModuleCol && <TableHead className="text-xs w-32">Module</TableHead>}
                      {showFeatureCol && <TableHead className="text-xs w-32">Feature</TableHead>}
                      <TableHead className="text-xs w-20">Role</TableHead>
                      <TableHead className="text-xs w-20">Type</TableHead>
                      <TableHead className="text-xs w-16">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium text-primary">{row.caseNumber}</TableCell>
                        <TableCell className="text-xs">{row.testCaseName}</TableCell>
                        {showModuleCol && <TableCell className="text-xs text-muted-foreground">{row.module}</TableCell>}
                        {showFeatureCol && <TableCell className="text-xs text-muted-foreground">{row.feature}</TableCell>}
                        <TableCell className="text-xs">{row.role}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] capitalize">{row.type}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px]">
                            <AlertCircle className="h-2.5 w-2.5 mr-0.5" /> New
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
          <Button size="sm" onClick={handleApply} disabled={!parsed || rows.length === 0}>
            <Upload className="h-3.5 w-3.5 mr-1" /> Import {rows.length} Test Cases
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkLibraryImportDialog;
