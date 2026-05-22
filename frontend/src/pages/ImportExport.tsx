import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Upload, FileSpreadsheet, ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react';

const ImportExport = () => {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Import / Export</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage test data via Excel spreadsheets</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Download className="h-4 w-4 text-muted-foreground" /> Export
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">Download test cases and steps in a structured Excel format for offline review or editing.</p>
            <div className="space-y-2">
              {['AP Regression — Sprint 42', 'GL Smoke Test', 'All Test Cases'].map((name) => (
                <div key={name} className="flex items-center justify-between p-2 border rounded text-sm">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs">{name}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 text-[11px]">
                    <Download className="h-3 w-3 mr-1" /> .xlsx
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Upload className="h-4 w-4 text-muted-foreground" /> Import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">Upload a modified spreadsheet to update test cases. Changes are previewed before applying.</p>
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground mb-2">Drag and drop your .xlsx file here</p>
              <Button size="sm" variant="outline" className="text-xs">Browse Files</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Diff preview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Last Import Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2 p-2 rounded bg-status-pass/5">
              <CheckCircle2 className="h-3.5 w-3.5 text-status-pass" />
              <span>2 test cases updated successfully</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded bg-status-skipped/5">
              <AlertTriangle className="h-3.5 w-3.5 text-status-skipped" />
              <span>1 test case skipped — validation rule mismatch</span>
            </div>
            <div className="border rounded p-3 mt-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Changes Applied</div>
              <div className="space-y-1">
                <div className="flex gap-4">
                  <span className="text-muted-foreground w-32">Invoice Amount</span>
                  <span className="line-through text-status-fail">10,000.00</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground mt-0.5" />
                  <span className="text-status-pass">15,000.00</span>
                </div>
                <div className="flex gap-4">
                  <span className="text-muted-foreground w-32">Test Case Title</span>
                  <span className="line-through text-status-fail">Create Invoice</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground mt-0.5" />
                  <span className="text-status-pass">Create Standard Invoice</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ImportExport;
