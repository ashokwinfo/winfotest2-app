import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { modules as allModules, features as allFeatures } from '@/data/mock';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  appId: string;
  initialModuleId?: string;
  initialFeatureId?: string;
  onApply: (moduleId: string, featureId: string) => void;
}

export function MoveCaseDialog({ open, onOpenChange, appId, initialModuleId, initialFeatureId, onApply }: Props) {
  const appModules = useMemo(() => {
    const seen = new Set<string>();
    return allModules.filter(m => m.applicationId === appId && !m.deletedAt && (seen.has(m.name) ? false : (seen.add(m.name), true)));
  }, [appId]);

  const [moduleId, setModuleId] = useState(initialModuleId ?? appModules[0]?.id ?? '');
  const moduleFeatures = useMemo(() => {
    const target = allModules.find(m => m.id === moduleId);
    if (!target) return [];
    const sameNameIds = allModules
      .filter(m => m.name === target.name && (!target.applicationId || m.applicationId === target.applicationId))
      .map(m => m.id);
    return allFeatures.filter(f => sameNameIds.includes(f.moduleId) && !f.deletedAt);
  }, [moduleId]);

  const [featureId, setFeatureId] = useState(initialFeatureId ?? '');

  useEffect(() => {
    if (!open) return;
    setModuleId(initialModuleId ?? appModules[0]?.id ?? '');
    setFeatureId(initialFeatureId ?? '');
  }, [open, initialModuleId, initialFeatureId, appModules]);

  useEffect(() => {
    if (moduleFeatures.length === 0) setFeatureId('');
    else if (!moduleFeatures.find(f => f.id === featureId)) setFeatureId(moduleFeatures[0].id);
  }, [moduleFeatures, featureId]);

  const apply = () => {
    if (!moduleId || !featureId) return;
    onApply(moduleId, featureId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Move test case</DialogTitle>
          <DialogDescription className="text-xs">Reassign this case to a different module and feature.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Module</Label>
            <Select value={moduleId} onValueChange={(v) => { setModuleId(v); setFeatureId(''); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select module" /></SelectTrigger>
              <SelectContent>
                {appModules.map(m => <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Feature</Label>
            <Select value={featureId} onValueChange={setFeatureId} disabled={!moduleId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={moduleId ? 'Select feature' : 'Pick module first'} /></SelectTrigger>
              <SelectContent>
                {moduleFeatures.map(f => <SelectItem key={f.id} value={f.id} className="text-xs">{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!moduleId || !featureId} onClick={apply}>Move</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
