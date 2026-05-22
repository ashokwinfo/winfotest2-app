import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Canonical display label for a TestCase status. Single source of truth — the
 * underlying enum still uses 'valid' / 'archived' for back-compat, but every
 * piece of UI shows them as 'Published' / 'Retired'.
 */
export function statusLabel(s: 'valid' | 'draft' | 'archived'): string {
  return s === 'valid' ? 'Published' : s === 'archived' ? 'Retired' : 'Draft';
}

