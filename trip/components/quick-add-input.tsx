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
 * Deliberately minimal: native `<input>` + `onKeyDown` Enter — NOT a `<form>` (no implicit
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
        // An unwritten line on a ruled form: the rule is drawn, the line is empty.
        className="min-h-tap flex-1 min-w-0 rounded-r1 border border-[color:var(--border-ui)] bg-[rgb(var(--surface-low))] px-3 py-2.5 text-t-body text-[color:var(--text-hi)] placeholder:text-[color:var(--text-lo)] focus:outline-none focus:ring-2 focus:ring-ring focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!title.trim()}
        aria-label="Add plan"
        data-testid={`${testId}-submit`}
        // Disabled recedes by TIER, never by opacity: dimming multiplies the alpha of the
        // glyph inside it and drops the control straight through the contrast floor.
        className="shrink-0 inline-flex h-tap w-tap items-center justify-center rounded-r1 border-b-[3px] border-b-[color:var(--lip-volt)] bg-[color:var(--accent)] text-[color:var(--on-accent)] outline-none transition-all [transition-duration:var(--duration-press)] hover:brightness-110 active:translate-y-[3px] active:border-b-0 active:mb-[3px] disabled:cursor-not-allowed disabled:border-b-0 disabled:bg-[rgb(var(--surface-overlay))] disabled:text-[color:var(--text-lo)] focus-visible:ring-2 focus-visible:ring-[color:var(--text-hi)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
      >
        <Plus className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
