import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Circle, Pause, Square, Play, Lock, Globe, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TestStep, StepAction } from '@/types';

type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';
type MockElementKey = 'nav' | 'createBtn' | 'invoiceField' | 'supplierDropdown' | 'amountField' | 'currencyDropdown' | 'submitBtn' | 'successBanner';

interface RecordingPanelProps {
  testCaseId: string;
  onStepCaptured: (step: TestStep) => void;
  onClearAll: () => void;
  capturedSteps: TestStep[];
}

export const DEMO_INTERACTIONS: { description: string; action: StepAction; input: string; target: MockElementKey; label: string }[] = [
  { description: 'Navigate to Invoices module', action: 'click_button', input: '', target: 'nav', label: 'Invoices Nav' },
  { description: 'Click "Create New" button', action: 'click_button', input: '', target: 'createBtn', label: 'Create New Button' },
  { description: 'Enter "INV-{N}" in Invoice Number field', action: 'enter_value_text_field', input: 'INV-{N}', target: 'invoiceField', label: 'Invoice Number Field' },
  { description: 'Select "Vendor A" from Supplier dropdown', action: 'select_dropdown', input: 'Vendor A', target: 'supplierDropdown', label: 'Supplier Dropdown' },
  { description: 'Enter "10000.00" in Amount field', action: 'enter_value_text_field', input: '10000.00', target: 'amountField', label: 'Amount Field' },
  { description: 'Select "USD" from Currency dropdown', action: 'select_dropdown', input: 'USD', target: 'currencyDropdown', label: 'Currency Dropdown' },
  { description: 'Click "Submit" button', action: 'click_button', input: '', target: 'submitBtn', label: 'Submit Button' },
  { description: 'Validate text "Invoice Created Successfully" is displayed', action: 'validate_text', input: 'Invoice Created Successfully', target: 'successBanner', label: 'Success Banner' },
];

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export const RecordingPanel = ({ testCaseId, onStepCaptured, onClearAll, capturedSteps }: RecordingPanelProps) => {
  const [state, setState] = useState<RecordingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [glowTarget, setGlowTarget] = useState<MockElementKey | null>(null);
  const [captureToast, setCaptureToast] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const demoIndexRef = useRef(0);
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state === 'recording') {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state]);

  useEffect(() => {
    return () => {
      if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
      if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const pushDemoStep = useCallback(() => {
    if (demoIndexRef.current >= DEMO_INTERACTIONS.length) return;
    const demo = DEMO_INTERACTIONS[demoIndexRef.current];

    // Trigger glow + toast first
    setGlowTarget(demo.target);
    setCaptureToast(`Captured: ${demo.label}`);
    if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    glowTimerRef.current = setTimeout(() => setGlowTarget(null), 800);
    toastTimerRef.current = setTimeout(() => setCaptureToast(null), 1400);

    const step: TestStep = {
      id: `ts-rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      testCaseId,
      lineNumber: (capturedSteps.length + demoIndexRef.current + 1) * 10,
      stepDescription: demo.description,
      inputParameter: demo.input,
      action: demo.action,
      validationType: demo.action === 'validate_text' ? 'validation_from_application' : 'not_applicable',
      validationName: demo.action === 'validate_text' ? demo.input : 'Not Applicable',
      uniqueMandatory: 'not_applicable',
      dataType: 'not_applicable',
      testingType: 'positive',
    };
    onStepCaptured(step);
    demoIndexRef.current += 1;
    if (demoIndexRef.current < DEMO_INTERACTIONS.length) {
      demoTimerRef.current = setTimeout(pushDemoStep, 1200 + Math.random() * 600);
    }
  }, [testCaseId, capturedSteps.length, onStepCaptured]);

  const handleStart = () => {
    setState('recording');
    setElapsed(0);
  };

  const handlePause = () => setState('paused');
  const handleResume = () => setState('recording');
  const handleStop = () => {
    setState('stopped');
    if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
  };

  const handleSimulateDemo = () => {
    onClearAll();
    demoIndexRef.current = 0;
    setState('recording');
    setElapsed(0);
    setTimeout(pushDemoStep, 600);
  };

  const handleNewRecording = () => {
    setState('idle');
    setElapsed(0);
    demoIndexRef.current = 0;
  };

  const isRecording = state === 'recording';
  const isPaused = state === 'paused';

  const glowClass = (key: MockElementKey) =>
    glowTarget === key ? 'ring-2 ring-primary ring-offset-2 ring-offset-background animate-pulse' : '';

  return (
    <div className="flex-1 flex flex-col bg-muted/20 relative">
      {/* Sticky Recording Banner */}
      {(isRecording || isPaused) && (
        <div
          className={cn(
            'flex items-center gap-3 px-4 py-2 border-b animate-fade-in',
            isRecording ? 'bg-destructive/10 border-destructive/30' : 'bg-muted border-border'
          )}
        >
          <div className="flex items-center gap-2">
            <span className={cn('relative flex h-2.5 w-2.5')}>
              {isRecording && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
              )}
              <span className={cn(
                'relative inline-flex rounded-full h-2.5 w-2.5',
                isRecording ? 'bg-destructive' : 'bg-muted-foreground'
              )} />
            </span>
            <span className="text-xs font-medium">
              {isRecording ? 'Recording Active' : 'Recording Paused'}
            </span>
            <span className="text-xs text-muted-foreground">— Your actions are being captured</span>
          </div>
          <span className="ml-auto text-xs font-mono text-muted-foreground">{formatTime(elapsed)}</span>
          {isRecording ? (
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={handlePause}>
              <Pause className="h-3 w-3 mr-1" /> Pause
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={handleResume}>
              <Play className="h-3 w-3 mr-1" /> Resume
            </Button>
          )}
          <Button size="sm" variant="destructive" className="h-6 text-[11px] px-2" onClick={handleStop}>
            <Square className="h-3 w-3 mr-1" /> Stop
          </Button>
        </div>
      )}

      {/* Mock browser chrome */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-background">
        <div className="flex gap-1">
          <div className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--status-skipped))]/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--status-pass))]/60" />
        </div>
        <div className="flex-1 flex items-center gap-2 bg-muted/50 rounded-md px-3 py-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" />
          <Globe className="h-3 w-3" />
          <span className="truncate">https://app.example.com/invoices</span>
        </div>
      </div>

      {/* Simulated app surface */}
      <div className="flex-1 overflow-auto p-6">
        {state === 'idle' ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="max-w-sm space-y-4">
              <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                <Circle className="h-6 w-6 fill-destructive text-destructive" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Start recording to capture your business flow</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Interact with your application and we'll automatically generate plain-English test steps as you go.
                </p>
              </div>
              <div className="flex flex-col items-center gap-2 pt-2">
                <Button size="sm" onClick={handleStart}>
                  <Circle className="h-3.5 w-3.5 mr-1.5 fill-current" /> Start Recording
                </Button>
                <button
                  onClick={handleSimulateDemo}
                  className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1 transition-colors"
                >
                  <Sparkles className="h-3 w-3" /> Simulate demo flow
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {/* Mock app header / nav */}
            <div className="flex items-center gap-3 pb-3 border-b">
              <div className="h-6 w-24 rounded bg-muted" />
              <nav className="flex gap-1 text-xs">
                <span className="px-2 py-1 rounded text-muted-foreground">Dashboard</span>
                <span className={cn('px-2 py-1 rounded bg-primary/10 text-primary font-medium transition-all', glowClass('nav'))}>
                  Invoices
                </span>
                <span className="px-2 py-1 rounded text-muted-foreground">Reports</span>
              </nav>
            </div>

            {/* Mock page header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Invoices</h2>
                <p className="text-[11px] text-muted-foreground">Create and manage supplier invoices</p>
              </div>
              <button
                className={cn(
                  'h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium transition-all',
                  glowClass('createBtn')
                )}
              >
                + Create New
              </button>
            </div>

            {/* Mock form */}
            <div className="border rounded-lg bg-background p-4 space-y-3">
              <div className="text-xs font-medium">New Invoice</div>

              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Invoice Number</label>
                <div className={cn(
                  'h-8 rounded border bg-muted/30 px-2 flex items-center text-xs text-muted-foreground transition-all',
                  glowClass('invoiceField')
                )}>
                  INV-001
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Supplier</label>
                  <div className={cn(
                    'h-8 rounded border bg-muted/30 px-2 flex items-center justify-between text-xs text-muted-foreground transition-all',
                    glowClass('supplierDropdown')
                  )}>
                    <span>Vendor A</span>
                    <span className="text-[10px]">▾</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Currency</label>
                  <div className={cn(
                    'h-8 rounded border bg-muted/30 px-2 flex items-center justify-between text-xs text-muted-foreground transition-all',
                    glowClass('currencyDropdown')
                  )}>
                    <span>USD</span>
                    <span className="text-[10px]">▾</span>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Amount</label>
                <div className={cn(
                  'h-8 rounded border bg-muted/30 px-2 flex items-center text-xs text-muted-foreground transition-all',
                  glowClass('amountField')
                )}>
                  10000.00
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  className={cn(
                    'h-7 px-4 rounded-md bg-primary text-primary-foreground text-xs font-medium transition-all',
                    glowClass('submitBtn')
                  )}
                >
                  Submit
                </button>
              </div>
            </div>

            {/* Mock success */}
            <div className={cn(
              'rounded-md border border-[hsl(var(--status-pass))]/30 bg-[hsl(var(--status-pass))]/10 px-3 py-2 text-xs text-[hsl(var(--status-pass))] transition-all',
              glowClass('successBanner')
            )}>
              ✓ Invoice Created Successfully
            </div>

            {state === 'stopped' && (
              <div className="flex justify-center pt-4">
                <Button size="sm" variant="outline" onClick={handleNewRecording}>
                  New Recording
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Capture toast chip */}
      {captureToast && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 animate-fade-in pointer-events-none">
          <Badge className="bg-foreground text-background gap-1.5 shadow-lg">
            <Sparkles className="h-3 w-3" />
            {captureToast}
          </Badge>
        </div>
      )}

      {/* Step progress bar */}
      <div className="border-t px-4 py-2 bg-background flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">{capturedSteps.length} steps captured</span>
        <div className="flex-1 flex items-center gap-0.5">
          {capturedSteps.map((_, i) => (
            <div key={i} className="h-1.5 flex-1 rounded-full bg-[hsl(var(--status-pass))]" />
          ))}
          {capturedSteps.length === 0 && <div className="h-1.5 flex-1 rounded-full bg-muted" />}
        </div>
      </div>
    </div>
  );
};
