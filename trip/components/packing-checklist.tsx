'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Mountain, Compass, Globe2, Plus, Trash2 } from 'lucide-react';
import { usePacking } from '@/hooks/use-packing';
import type { PackingCategory, PackingItem } from '@/core/packing/model';
import { haptic } from '@/lib/haptics';
import { crossedIntoComplete } from '@/lib/celebration';
import CelebrationBurst from '@/components/celebration-burst';

/**
 * PackingChecklist — the `/packing` route's checklist: a fixed built-in template
 * (`core/packing/model.ts`'s `DEFAULT_TEMPLATE`, 28 items) grouped Nepal / Japan / Universal,
 * each a checkbox toggle persisted via the gateway (`hooks/use-packing.ts`, key 21), plus
 * traveler-added custom items (#227) — a text input appends a new `universal`-category item, and
 * every row (template or custom) gets a remove button. The template seeds a slot that was never
 * written; after that the traveler owns the list, so removing the last row leaves a real, PERSISTED
 * empty state (#328) with a restore button as the way back — it does not silently re-seed.
 *
 * A11y: a section `h2` (sr-only — `app/packing/page.tsx`'s masthead carries the visible
 * title), one `h3` per category group, real `<input
 * type="checkbox">`/`<label>` pairs (native semantics, no ARIA re-implementation), ≥44px targets,
 * visible focus rings, static markup with no motion-only affordance (reduced-motion-safe by
 * construction). The progress indicator is a plain text node (not color-only).
 */

const CATEGORY_META: Record<PackingCategory, { label: string; icon: typeof Mountain }> = {
  nepal: { label: 'Nepal', icon: Mountain },
  japan: { label: 'Japan', icon: Compass },
  universal: { label: 'Universal', icon: Globe2 },
};

const CATEGORY_ORDER: PackingCategory[] = ['nepal', 'japan', 'universal'];

export default function PackingChecklist() {
  const { items, hydrated, progress, toggleItem, addItem, removeItem, restoreTemplate } = usePacking();
  const [draft, setDraft] = useState('');

  const handleAddSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const label = draft.trim();
    if (label === '') return;
    addItem(label);
    setDraft('');
  };

  // — last-item-checked micro-celebration: fires only on an OBSERVED not-complete→complete
  // edge. The ref starts null and the effect skips until hydration, so the first REAL state —
  // even "already complete in storage" — only seeds the baseline (no celebration on load), and
  // a re-render while the list stays fully checked never re-fires (lib/celebration.ts).
  const wasCompleteRef = useRef<boolean | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!hydrated) return;
    const complete = progress.total > 0 && progress.checked === progress.total;
    if (crossedIntoComplete(wasCompleteRef.current, complete)) {
      setCelebrate(true);
      haptic();
      const t = setTimeout(() => setCelebrate(false), 650);
      wasCompleteRef.current = complete;
      return () => clearTimeout(t);
    }
    wasCompleteRef.current = complete;
  }, [hydrated, progress.checked, progress.total]);

  if (!hydrated) {
    return (
      <section aria-labelledby="packing-heading" data-testid="packing-checklist" className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
        <h2 id="packing-heading" className="sr-only">
          Packing checklist
        </h2>
        <p className="text-sm text-ink-mid">Loading your checklist…</p>
      </section>
    );
  }

  const byCategory: Record<PackingCategory, PackingItem[]> = { nepal: [], japan: [], universal: [] };
  for (const item of items) byCategory[item.category].push(item);

  return (
    <section aria-labelledby="packing-heading" data-testid="packing-checklist" className="relative mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
      <CelebrationBurst active={celebrate} testId="packing-celebration" celebrationId="packing-complete" />
      <header className="mb-6">
        {/* #218: the eyebrow and title used to be printed here a second time, ~40px under the
            page masthead that already carries both. The heading stays as the section's
            accessible name (`aria-labelledby` above) and the h2 the group h3s nest under —
            sr-only, the same shape as the pre-hydration branch. */}
        <h2 id="packing-heading" className="sr-only">
          Packing checklist
        </h2>
        <p data-testid="packing-progress" className="text-sm font-medium text-ink-mid">
          {progress.checked}/{progress.total} packed
        </p>
        {/* An emptied list (#328) leaves total at 0, and a progressbar whose max equals its min is
            a degenerate one to announce — drop the bar and let the text node carry the state. */}
        {progress.total > 0 && (
          <div
            role="progressbar"
            aria-valuenow={progress.checked}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label={`${progress.checked} of ${progress.total} items packed`}
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${(progress.checked / progress.total) * 100}%` }}
            />
          </div>
        )}
      </header>

      <form onSubmit={handleAddSubmit} data-testid="packing-add-form" className="mb-6 flex gap-2">
        <div className="flex-1">
          <label htmlFor="packing-add-input" className="sr-only">
            Add a packing item
          </label>
          <input
            id="packing-add-input"
            data-testid="packing-add-input"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add an item…"
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-ink-hi placeholder:text-ink-lo outline-none transition-colors focus-visible:border-ring/60 focus-visible:ring-1 focus-visible:ring-ring/60"
          />
        </div>
        <button
          type="submit"
          data-testid="packing-add-submit"
          aria-label="Add item"
          disabled={draft.trim() === ''}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>

      {items.length === 0 && (
        <div data-testid="packing-empty" className="glass-subtle rounded-2xl p-6 text-center">
          <p className="text-sm text-ink-mid">Your packing list is empty. Add an item above, or start over from the built-in checklist.</p>
          <button
            type="button"
            onClick={() => {
              restoreTemplate();
              haptic();
            }}
            data-testid="packing-restore-template"
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] px-4 text-sm font-medium text-ink-hi transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Restore the default checklist
          </button>
        </div>
      )}

      <div className="flex flex-col gap-8">
        {CATEGORY_ORDER.map((category) => {
          const groupItems = byCategory[category];
          if (groupItems.length === 0) return null;
          const meta = CATEGORY_META[category];
          const Icon = meta.icon;
          const headingId = `packing-group-${category}-heading`;
          return (
            <div key={category} data-testid={`packing-group-${category}`} className="glass-subtle rounded-2xl p-5">
              <h3 id={headingId} className="flex items-center gap-2 font-display text-lg font-bold text-white">
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {meta.label}
              </h3>
              <ul aria-labelledby={headingId} className="mt-3 flex flex-col gap-1">
                {groupItems.map((item) => (
                  <li key={item.id} className="flex items-center gap-1">
                    <label
                      htmlFor={`packing-item-${item.id}`}
                      className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-hi outline-none transition-colors duration-200 hover:bg-white/[0.06] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface"
                    >
                      <input
                        id={`packing-item-${item.id}`}
                        data-testid={`packing-item-${item.id}`}
                        type="checkbox"
                        checked={item.checked}
                        onChange={() => {
                          toggleItem(item.id);
                          haptic();
                        }}
                        className="h-5 w-5 flex-shrink-0 rounded border-white/30 bg-transparent text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <span className={item.checked ? 'text-ink-lo line-through' : undefined}>{item.label}</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        removeItem(item.id);
                        haptic();
                      }}
                      data-testid={`packing-remove-${item.id}`}
                      aria-label={`Remove ${item.label}`}
                      className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-ink-mid transition-colors hover:bg-red-500/20 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
