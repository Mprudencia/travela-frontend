'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { NATIONALITIES } from '@/lib/nationalities';

type NationalitySelectProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export default function NationalitySelect({
  value,
  onChange,
  placeholder = 'Select your nationality',
}: NationalitySelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);

  const filtered = NATIONALITIES.filter((n) =>
    n.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, open]);

  const selectNationality = (nationality: string) => {
    onChange(nationality);
    setQuery('');
    setOpen(false);
  };

  const displayValue = open ? query : value;

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          value={displayValue}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setHighlightIndex((i) =>
                filtered.length === 0 ? 0 : Math.min(i + 1, filtered.length - 1),
              );
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const pick = filtered[highlightIndex];
              if (pick) selectNationality(pick);
            } else if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
            }
          }}
          className="w-full px-4 py-3 pr-10 rounded-xl border border-slate-200 text-sm text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:border-slate-400"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Toggle nationality list"
          onClick={() => {
            setOpen((prev) => !prev);
            setQuery('');
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          <ChevronDown
            size={16}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-2.5 text-sm text-slate-400">No matches</li>
          ) : (
            filtered.map((n, index) => (
              <li key={n} role="option" aria-selected={value === n}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => selectNationality(n)}
                  className={`w-full px-4 py-2.5 text-left text-sm ${
                    index === highlightIndex
                      ? 'bg-slate-100 text-slate-900'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {n}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
