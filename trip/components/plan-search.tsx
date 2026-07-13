'use client';

import { useId, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { DayPlan, formatDate } from '@/lib/trip-data';
import { searchPlanItems, type PlanSearchResult } from '@/lib/search-plan';

/**
 * Search-within-plan. A labeled, keyboard-navigable combobox over the
 * itinerary's item titles/notes/categories, mounted inside `/plan`
 * (calendar-planner.tsx). Runs the pure `searchPlanItems` matcher against the
 * LIVE `plans` passed in from the itinerary context — this component never
 * reads or writes storage itself (read-only).
 */
interface PlanSearchProps {
  plans: DayPlan[];
  onSelect: (result: PlanSearchResult) => void;
}

export default function PlanSearch({ plans, onSelect }: PlanSearchProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const inputId = useId();

  const results = useMemo(() => searchPlanItems(plans, query), [plans, query]);
  const open = query.trim().length > 0;
  const activeResult = results[activeIndex];

  const clear = () => {
    setQuery('');
    setActiveIndex(0);
  };

  const choose = (result: PlanSearchResult) => {
    onSelect(result);
    clear();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) {
      if (e.key === 'Escape' && query) {
        e.preventDefault();
        clear();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeResult) choose(activeResult);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clear();
    }
  };

  return (
    <div className="relative max-w-md mx-auto mb-6">
      <label htmlFor={inputId} className="sr-only">
        Search this plan by title, notes, or category
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" aria-hidden="true" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && activeResult ? `${listboxId}-${activeResult.item.id}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          data-testid="plan-search-input"
          placeholder="Search this plan…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          className="w-full pl-9 pr-9 py-2.5 rounded-lg bg-navy-900 border border-white/15 text-white text-sm placeholder:text-white/30 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            data-testid="plan-search-clear"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-white/30 hover:text-white/70 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Plan search results"
          data-testid="plan-search-results"
          className="absolute z-20 mt-1.5 w-full max-h-72 overflow-y-auto rounded-lg bg-navy-900 border border-white/15 shadow-xl py-1"
        >
          {results.length === 0 ? (
            <li role="presentation" className="px-3 py-2.5 text-sm text-white/40" data-testid="plan-search-empty">
              No matches
            </li>
          ) : (
            results.map((result, i) => (
              // role="presentation": the <ul> carries role="listbox" (not the implicit
              // "list"), so a plain <li> would fail axe's aria-required-parent/listitem
              // checks — the <button role="option"> below is the actual accessibility node.
              <li key={result.item.id} role="presentation">
                <button
                  type="button"
                  id={`${listboxId}-${result.item.id}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  data-testid={`plan-search-result-${result.item.id}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => choose(result)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 outline-none ${i === activeIndex ? 'bg-gold-500/20 text-white' : 'text-white/70 hover:bg-white/5'}`}
                >
                  <span className="truncate">{result.item.title}</span>
                  <span className="shrink-0 text-xs text-white/60">{formatDate(result.date)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
