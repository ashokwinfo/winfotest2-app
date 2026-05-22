import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Pencil, Check } from 'lucide-react';

interface InlineEditProps {
  value: string;
  onSave: (value: string) => void;
  className?: string;
}

export function InlineEdit({ value, onSave, className }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleSave = () => {
    setEditing(false);
    if (draft.trim() && draft !== value) onSave(draft.trim());
    else setDraft(value);
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={cn('group flex items-center gap-1.5 hover:text-primary transition-colors', className)}
      >
        <span>{value}</span>
        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setEditing(false); setDraft(value); } }}
        onBlur={handleSave}
        className="h-7 px-2 text-sm border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <button onClick={handleSave} className="p-1 rounded hover:bg-secondary"><Check className="h-3.5 w-3.5" /></button>
    </div>
  );
}
