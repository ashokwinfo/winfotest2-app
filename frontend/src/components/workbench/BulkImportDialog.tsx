import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Upload, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import type { TestStep, StepAction } from '@/types';
import { toast } from 'sonner';

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testCaseId: string;
  onImport: (steps: TestStep[]) => void;
}

// Simulated parsed rows from an uploaded Excel file
const MOCK_PARSED_ROWS: Omit<TestStep, 'id' | 'testCaseId'>[] = [
  { lineNumber: 10, stepDescription: 'Login to application', inputParameter: 'admin@acme.com', action: 'enter_value_text_field', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'positive' },
  { lineNumber: 20, stepDescription: 'Navigate to Invoice module', inputParameter: '', action: 'click_button', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'positive' },
  { lineNumber: 30, stepDescription: 'Click "Create New Invoice"', inputParameter: '', action: 'click_button', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'positive' },
  { lineNumber: 40, stepDescription: 'Enter Invoice Number', inputParameter: 'INV-001', action: 'enter_value_text_field', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'mandatory', dataType: 'alpha_numeric', testingType: 'positive' },
  { lineNumber: 50, stepDescription: 'Select Supplier from dropdown', inputParameter: 'Vendor A', action: 'select_dropdown', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'positive' },
  { lineNumber: 60, stepDescription: 'Click Submit', inputParameter: '', action: 'click_button', validationType: 'not_applicable', validationName: 'Not Applicable', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'positive' },
  { lineNumber: 70, stepDescription: 'Validate success message', inputParameter: 'Invoice Created', action: 'validate_text', validationType: 'validation_from_application', validationName: 'Invoice Created', uniqueMandatory: 'not_applicable', dataType: 'not_applicable', testingType: 'positive' },
];

export const BulkImportDialog = ({ open, onOpenChange, testCaseId, onImport }: BulkImportDialogProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<typeof MOCK_PARSED_ROWS | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.endsWith('.xlsx') && !f.name.endsWith('.csv')) {
      toast.error('Please upload an .xlsx or .csv file');
      return;
    }
    setFile(f);
    // Simulate parsing delay
    setTimeout(() => setPreviewRows(MOCK_PARSED_ROWS), 500);
  };

  const handleApply = () => {
    if (!previewRows) return;
    const steps: TestStep[] = previewRows.map((row, i) => ({
      ...row,
      id: `ts-import-${Date.now()}-${i}`,
      testCaseId,
    }));
    onImport(steps);
    toast.success(`${steps.length} steps imported successfully`);
    setFile(null);
    setPreviewRows(null);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setFile(null);
    setPreviewRows(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <Upload className="h-4 w-4" /> Upload Test Steps
          </DialogTitle>
        </DialogHeader>

        {!previewRows ? (
          <div className="flex-1 flex flex-col items-center justify-center py-8">
            <div className="border-2 border-dashed rounded-lg p-8 text-center w-full max-w-md">
              <FileSpreadsheet className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-1">
                {file ? `Parsing ${file.name}...` : 'Upload your .xlsx file with test steps'}
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Columns: Line No., Step Description, Input Parameter, Action, Validation Type, etc.
              </p>
              <label>
                <Button size="sm" variant="outline" asChild>
                  <span><Upload className="h-3.5 w-3.5 mr-1" /> Browse Files</span>
                </Button>
                <input type="file" accept=".xlsx,.csv" className="hidden" onChange={handleFileSelect} />
              </label>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className="text-[10px]">
                <FileSpreadsheet className="h-3 w-3 mr-1" /> {file?.name}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">{previewRows.length} rows parsed</Badge>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs w-16">Line</TableHead>
                    <TableHead className="text-xs">Step Description</TableHead>
                    <TableHead className="text-xs">Input</TableHead>
                    <TableHead className="text-xs">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{row.lineNumber}</TableCell>
                      <TableCell className="text-xs">{row.stepDescription}</TableCell>
                      <TableCell className="text-xs font-mono">{row.inputParameter || '—'}</TableCell>
                      <TableCell className="text-xs">{row.action}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              Applying will replace all existing steps in this test case.
            </div>
          </div>
        )}

        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
          <Button size="sm" onClick={handleApply} disabled={!previewRows}>
            Apply {previewRows ? `${previewRows.length} Steps` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
