import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface SelectionContextType {
  selected: Set<string>;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  toggleSelect: (id: string) => void;
  toggleAll: (ids: string[]) => void;
  removeCase: (id: string) => void;
  removeGroup: (caseIds: string[]) => void;
  clearAll: () => void;
  navigateToRun: () => void;
}

const SelectionContext = createContext<SelectionContextType | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const navigate = useNavigate();

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      if (next.size > 0) setPanelOpen(true);
      return next;
    });
  }, []);

  const toggleAll = useCallback((ids: string[]) => {
    setSelected(prev => {
      const allSelected = ids.every(id => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        if (next.size === 0) setPanelOpen(false);
        return next;
      } else {
        const next = new Set(prev);
        ids.forEach(id => next.add(id));
        setPanelOpen(true);
        return next;
      }
    });
  }, []);

  const removeCase = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.delete(id);
      if (next.size === 0) setPanelOpen(false);
      return next;
    });
  }, []);

  const removeGroup = useCallback((caseIds: string[]) => {
    setSelected(prev => {
      const next = new Set(prev);
      caseIds.forEach(id => next.delete(id));
      if (next.size === 0) setPanelOpen(false);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setSelected(new Set());
    setPanelOpen(false);
  }, []);

  const navigateToRun = useCallback(() => {
    if (selected.size === 0) return;
    const params = new URLSearchParams();
    params.set('cases', Array.from(selected).join(','));
    navigate(`/runs/new?${params.toString()}`);
  }, [selected, navigate]);

  return (
    <SelectionContext.Provider value={{
      selected, panelOpen, setPanelOpen,
      toggleSelect, toggleAll, removeCase, removeGroup, clearAll, navigateToRun
    }}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection() {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error('useSelection must be used within SelectionProvider');
  return ctx;
}
