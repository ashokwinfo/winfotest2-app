import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Check, Pencil, PlusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TagOption { id: string; label: string }

interface Props {
  /** Visible affordance */
  trigger?: React.ReactNode;
  /** Title shown at top of popover */
  title: string;
  options: TagOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Optional inline-create. Returns the new id (selected automatically). */
  onCreate?: (name: string) => string | null;
  searchPlaceholder?: string;
  align?: 'start' | 'center' | 'end';
}

export function CaseTagEditPopover({
  trigger, title, options, selected, onChange, onCreate, searchPlaceholder, align = 'end',
}: Props) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  const submitNew = () => {
    if (!onCreate) return;
    const v = draft.trim();
    if (!v) return;
    const id = onCreate(v);
    if (id && !selected.includes(id)) onChange([...selected, id]);
    setDraft(''); setCreating(false);
  };

  return (
    <Popover onOpenChange={(o) => { if (!o) { setCreating(false); setDraft(''); } }}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`Edit ${title}`}
          >
            <Pencil className="h-2.5 w-2.5" /> edit
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align={align}>
        <div className="px-3 py-2 border-b text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        <Command>
          <CommandInput placeholder={searchPlaceholder ?? `Search ${title.toLowerCase()}…`} className="text-xs" />
          <CommandList>
            <CommandEmpty className="text-xs px-3 py-4 text-muted-foreground">No matches</CommandEmpty>
            <CommandGroup>
              {options.map(opt => {
                const checked = selected.includes(opt.id);
                return (
                  <CommandItem key={opt.id} value={opt.label} onSelect={() => toggle(opt.id)} className="text-xs cursor-pointer">
                    <div className={cn(
                      'mr-2 h-3.5 w-3.5 rounded-sm border flex items-center justify-center',
                      checked ? 'bg-primary border-primary' : 'border-input',
                    )}>
                      {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <span className="flex-1 truncate">{opt.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {onCreate && (
          <div className="border-t p-2 bg-muted/30">
            {!creating ? (
              <Button variant="ghost" size="sm" className="w-full h-7 text-xs justify-start text-primary"
                onClick={() => setCreating(true)}>
                <PlusCircle className="h-3 w-3 mr-1" /> Add new…
              </Button>
            ) : (
              <div className="flex gap-1">
                <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); submitNew(); }
                    if (e.key === 'Escape') { setCreating(false); setDraft(''); }
                  }}
                  placeholder="Name…" className="h-7 text-xs" />
                <Button size="sm" className="h-7 px-2" onClick={submitNew} disabled={!draft.trim()}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
