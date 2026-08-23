'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { formatDateLong } from '@/core/dates';
import { getUserName } from '@/lib/identity';
import { stampDone } from '@/lib/attribution';
import { generateItemId } from '@/lib/item-id';
import type { ItineraryCategory, ItineraryItem } from '@/lib/trip-data';
import { ALL_CATEGORIES } from '@/lib/itinerary-category';
import { useItineraryContext } from '@/components/itinerary-provider';
import QuickAddInput from '@/components/quick-add-input';

/**
 * — "Log something different" inline quick-add (Lane T, T3). Fills the slot
 * (`data-testid="travel-quick-add-slot"`) directly under the /travel checklist.
 *
 * The capture for "we skipped the museum and found a market": a minimal ≤2-field inline add
 * (title required + optional category) that lands an item on the VIEWED day (`selectedDate`)
 * ALREADY checked `done`, so it shows in the checklist complete with the "✓ Completed ·
 * <name>" footer immediately. Reuses `QuickAddInput` (the light title-only path), `addItem`
 *, and `stampDone`.
 *
 * Attribution: `addItem`'s stamper applies `stampCreated` only — wired `stampDone` into
 * `updateItem` ONLY, not `addItem`. So we construct the item `done:true` and apply
 * `stampDone(item, { done: true }, getUserName)` in THIS handler BEFORE `addItem`, so
 * `doneBy`/`doneAt` land name-gated (no double-stamp of `done`). With no display name set the
 * stamp is a no-op: the item is done but nameless ("✓ Completed").
 *
 * / TM-9: INLINE only — no modal, no portal. The affordance lives inside the Travel Mode
 * root (rendered by `travel-date-picker.tsx`), so the `QuickAddHost` /travel suppression guard
 * (quick-add-host.tsx:78) is untouched and zero app chrome leaks. Collapsed by default so it
 * never competes with the checklist for primary attention.
 *
 * a11y: labelled title input (day-specific), labelled category `<select>`, ≥44px targets,
 * visible focus rings. No motion — reveal is a plain conditional render (reduced-motion-safe).
 */

// The category `<select>` renders `ALL_CATEGORIES` (lib/itinerary-category.ts) in its declared
// order. A native `<select>` keeps the whole form to ≤2 fields with no new dependency and full
// keyboard support.

export default function TravelLogDifferent({ date }: { date: string }) {
  const { addItem } = useItineraryContext();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ItineraryCategory>('sightseeing');

  const dayLabel = formatDateLong(date);

  const handleAdd = (title: string) => {
    // Mirror the custom-mode item shape (add-to-itinerary-dialog handleConfirm,: no
    // sourceId/sourceType for a self-authored item). Constructed `done:true`, then stamp
    // completion attribution (name-gated) BEFORE the add so doneBy/doneAt land atomically.
    const base: ItineraryItem = {
      id: generateItemId(),
      title,
      category,
      done: true,
    };
    const stamped = stampDone(base, { done: true }, getUserName);
    addItem(date, stamped);
    // Stay expanded (QuickAddInput clears its own title) so several quick things can be logged.
  };

  return (
    <div data-testid="travel-quick-add-slot" data-s318-slot="ready" className="mx-auto mt-4 max-w-2xl">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="travel-log-different-trigger"
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[color:var(--border-ui)] bg-white/[0.03] px-4 py-3 text-sm font-medium text-ink-mid outline-none transition-colors duration-200 hover:bg-white/[0.06] hover:text-ink-hi focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Log something different
        </button>
      ) : (
        <div className="rounded-2xl glass-card p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-mid">
              Log something you already did
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Collapse log something different"
              data-testid="travel-log-different-collapse"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-mid outline-none transition-colors hover:bg-white/10 hover:text-ink-hi focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ItineraryCategory)}
              aria-label={`Category for what you logged on ${dayLabel}`}
              data-testid="travel-log-different-category"
              className="min-h-[44px] shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm capitalize text-white outline-none focus:ring-1 focus:ring-ring focus-visible:ring-2 focus-visible:ring-ring sm:w-40"
            >
              {ALL_CATEGORIES.map((c) => (
                <option key={c} value={c} className="bg-surface capitalize text-white">
                  {c}
                </option>
              ))}
            </select>

            <QuickAddInput
              label={`Log something you already did on ${dayLabel} — type a title, press Enter`}
              placeholder="e.g. Found a street market"
              testId="travel-log-different-input"
              onAdd={handleAdd}
              className="flex-1"
            />
          </div>
        </div>
      )}
    </div>
  );
}
