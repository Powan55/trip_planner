'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

/**
 * Inline quick-add.
 *
 * A single-line title input: type a title → Enter (or the + button) → `onAdd(trimmedTitle)`.
 * A blank / whitespace-only title is a no-op (Enter does nothing). Everything else about the
 * item (time, category, location, notes) is editable later via the full editor — this is the
 * LIGHT title-only path, so a surface has exactly one fast affordance here and one detailed
 * affordance (the "Add Activity" button / quick-add FAB → full editor), never two competing
 * quick adds.
 *
 * Ponytail: native `<input>` + `onKeyDown` Enter — deliberately NOT a `<form>` (no implicit
 * submit/navigation), no form lib, no new dep. The caller owns the item shape and the store
 * call; this component only collects a trimmed title. Writing lands through the same
 * `addItem` → `commit()` choke-point as every other add, so holds.
 *
 * A11y: the input is labelled via `aria-label` (the caller passes a day-specific label); the
 * submit button has its own action name; both are keyboard-operable with a visible focus ring.
 */
export default function QuickAddInput({
  onAdd,
  label,
  placeholder = 'Quick add — type a title, press Enter',
  testId,
  className = '',
}: {
  onAdd: (title: string) => void;
  /** Accessible name for the input (e.g. "Quick-add a plan for Dec 12, 2026"). */
  label: string;
  placeholder?: string;
  testId: string;
  className?: string;
}) {
  const [title, setTitle] = useState('');

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return; // no-op on blank (the DoD rule)
    onAdd(trimmed);
    setTitle('');
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        aria-label={label}
        placeholder={placeholder}
        data-testid={testId}
        className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2 focus-visible:ring-gold-400"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!title.trim()}
        aria-label="Add plan"
        data-testid={`${testId}-submit`}
        className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gold-500/90 text-surface hover:bg-gold-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
      >
        <Plus className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
