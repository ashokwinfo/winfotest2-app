import { createContext, useContext } from 'react';

/**
 * Shared context between CompareLayout (chrome) and CompareView (page body).
 * Lets the page trigger Exit and read which client is being compared.
 */
export interface CompareModeValue {
  exit: () => void;
  compareRepoId: string;
}

export const CompareModeContext = createContext<CompareModeValue | null>(null);

export function useCompareMode(): CompareModeValue | null {
  return useContext(CompareModeContext);
}
