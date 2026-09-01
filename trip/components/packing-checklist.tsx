'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Mountain, Compass, Globe2, Plus, Trash2 } from 'lucide-react';
import { usePacking } from '@/hooks/use-packing';
import { DEFAULT_TEMPLATE, type PackingCategory, type PackingItem } from '@/core/packing/model';
import { haptic } from '@/lib/haptics';
import { showUndoToast } from '@/lib/undo-toast';
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

/** The first rows the restore button would actually write, read from the template itself rather
 *  than retyped — the empty state draws the real shape at full size and cannot drift from it.
 *  Sliced from the universal head of the list, which a custom trip keeps too. */
const EMPTY_SLOTS = DEFAULT_TEMPLATE.slice(0, 8);

export default function PackingChecklist() {
  const { items, hydrated, progress, toggleItem, addItem, removeItem, restoreItem, restoreTemplate } = usePacking();
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
    }
    wasCompleteRef.current = complete;
  }, [hydrated, progress.checked, progress.total]);

  // The burst window lives in its own effect keyed on `celebrate`, deliberately: folded into the
  // edge effect above, any re-run of that effect (unchecking a row inside the window) clears the
  // timer without re-arming it, leaving the burst on screen forever.
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(false), 650);
    return () => clearTimeout(t);
  }, [celebrate]);

  if (!hydrated) {
    return (
      <section aria-labelledby="packing-heading" data-testid="packing-checklist" className="mx-auto w-full max-w-3xl px-gut pb-16">
        <h2 id="packing-heading" className="sr-only">
          Packing checklist
        </h2>
        <p className="empty">Loading your checklist…</p>
      </section>
    );
  }

  const byCategory: Record<PackingCategory, PackingItem[]> = { nepal: [], japan: [], universal: [] };
  for (const item of items) byCategory[item.category].push(item);

  return (
    <section aria-labelledby="packing-heading" data-testid="packing-checklist" className="relative mx-auto w-full max-w-3xl pb-16">
      <CelebrationBurst active={celebrate} testId="packing-celebration" celebrationId="packing-complete" />
      <header className="mb-6 px-gut">
        {/* #218: the eyebrow and title used to be printed here a second time, ~40px under the
            page masthead that already carries both. The heading stays as the section's
            accessible name (`aria-labelledby` above) and the h2 the group h3s nest under —
            sr-only, the same shape as the pre-hydration branch. */}
        <h2 id="packing-heading" className="sr-only">
          Packing checklist
        </h2>
        {/* e2e/packing.spec.ts asserts this node reads exactly "0/28 packed" — the count and the
            word are the contract, so nothing else may join this text node. */}
        <p data-testid="packing-progress" className="num text-n-sm text-ink-hi">
          {progress.checked}/{progress.total} packed
        </p>
        {/* An emptied list (#328) leaves total at 0, and a progressbar whose max equals its min is
            a degenerate one to announce — drop the bar and let the text node carry the state.
            The track is capped at 260px so the unfilled remainder is always visible. */}
        {progress.total > 0 && (
          <div
            role="progressbar"
            aria-valuenow={progress.checked}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label={`${progress.checked} of ${progress.total} items packed`}
            className="fill"
            style={{ '--w': `${(progress.checked / progress.total) * 100}%` } as React.CSSProperties}
          >
            <i />
          </div>
        )}
      </header>

      <form onSubmit={handleAddSubmit} data-testid="packing-add-form" className="mb-6 flex gap-2 px-gut">
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
            className="min-h-tap w-full rounded-r1 border-hair border-border bg-surface-raised px-3 py-2 text-t-body text-ink-hi placeholder:text-ink-lo outline-none transition-colors focus-visible:border-ring/60 focus-visible:ring-1 focus-visible:ring-ring/60"
          />
        </div>
        <button
          type="submit"
          data-testid="packing-add-submit"
          aria-label="Add item"
          disabled={draft.trim() === ''}
          className="btn min-w-tap shrink-0 px-4"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>

      {items.length === 0 && (
        // The empty state renders the SHAPE of the missing list at the size it will be —
        // eight hollow slots and the condition that fills them, not a grey sentence. Empty copy
        // sits at --t-body / --text-mid, never --t-micro.
        <div data-testid="packing-empty" className="px-gut">
          <p className="empty max-w-2xl">
            Nothing on your list yet. The built-in checklist is 28 items across the two legs and
            the universal kit — restore it, or add your own above.
          </p>
          <ul aria-hidden="true" className="empty-frame mt-4 list">
            {EMPTY_SLOTS.map((slot) => (
              <li key={slot.id} className="r" data-mark="hollow">
                <span className="tm flex items-center justify-center">
                  <span className="mk mk--hollow" />
                </span>
                <span className="min-w-0">
                  <h3>{slot.label}</h3>
                </span>
                <span className="hollow-tag">not yet</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              restoreTemplate();
              haptic();
            }}
            data-testid="packing-restore-template"
            className="btn btn--2 mt-4 px-4"
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
          const packed = groupItems.filter((i) => i.checked).length;
          return (
            <div key={category} data-testid={`packing-group-${category}`}>
              {/* The running-head field strip, deliberately NOT sticky: the app ships a fixed
                  navbar at top:0, and a second sticky bar per group would stack under it. */}
              <div className="head static flex-wrap">
                <span className="f">
                  <span className="k">Leg</span>
                  <h3 id={headingId} className="v !flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 text-ink-lo" aria-hidden="true" />
                    {meta.label}
                  </h3>
                </span>
                <span className="f">
                  <span className="k">Packed</span>
                  <span className="v">
                    {packed}/{groupItems.length}
                  </span>
                </span>
              </div>
              <ul aria-labelledby={headingId} className="list">
                {groupItems.map((item) => (
                  <li key={item.id} className="border-b-hair border-border last:border-b-0">
                    <div className="flex items-stretch">
                      <label
                        htmlFor={`packing-item-${item.id}`}
                        data-mark={item.checked ? undefined : 'hollow'}
                        className="r flex-1 cursor-pointer !border-b-0 outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring"
                      >
                        <span className="tm flex items-center justify-center">
                          <input
                            id={`packing-item-${item.id}`}
                            data-testid={`packing-item-${item.id}`}
                            type="checkbox"
                            checked={item.checked}
                            onChange={() => {
                              toggleItem(item.id);
                              haptic();
                            }}
                            className="h-5 w-5 flex-shrink-0 rounded-r1 border-[color:var(--border-ui)] bg-transparent text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        </span>
                        <span className="min-w-0">
                          {/* role=presentation keeps the row-title recipe without adding one
                              heading per checkbox to the page outline — the label already names
                              the input. */}
                          <h3 role="presentation" className={item.checked ? 'line-through' : undefined}>
                            {item.label}
                          </h3>
                        </span>
                        <span className={item.checked ? 'chip chip--struck' : 'hollow-tag'}>
                          {item.checked ? 'packed' : 'not yet'}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const index = items.findIndex((i) => i.id === item.id);
                          removeItem(item.id);
                          haptic();
                          showUndoToast(`Removed “${item.label}”`, () => restoreItem(item, index));
                        }}
                        data-testid={`packing-remove-${item.id}`}
                        aria-label={`Remove ${item.label}`}
                        className="inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center rounded-r1 text-ink-mid transition-colors hover:bg-[hsl(var(--destructive)/0.08)] hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
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
