'use client';

import { useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Plus, Check, CalendarDays } from 'lucide-react';
import { formatDate } from '@/lib/trip-data';
import { useItineraryContext } from '@/components/itinerary-provider';
import { toItineraryDraft, type SourceType, type AddToPlanSource } from '@/lib/itinerary-adapter';
import AddToItineraryDialog from '@/components/add-to-itinerary-dialog';

/**
 * Shared, state-aware "Add to plan" control dropped into every place card.
 *
 * It is additive to a card's existing markup: it builds the prefilled draft via the
 * adapter, queries `findPlacements(sourceId)` from the store, owns the dialog `open`
 * state + the `triggerRef`, and renders ONE `AddToItineraryDialog`.
 *
 * State (reactive via `findPlacements`):
 *  - 0 placements -> "Add to plan" pill (Plus).
 *  - >=1 placement -> "added" badge + a compact where-it's-planned summary
 *    ("On Dec 12" / "On 2 days"); clicking opens the dialog in modify/remove mode.
 *
 * Cross-surface integrity: because the calendar and this control are two views of
 * one store, removing from the calendar flips this back to "Add to plan"
 * automatically — `findPlacements` is re-read on the store's CustomEvent fan-out.
 *
 * `source` is a union (`Recommendation | PhotoSpot | MapMarker | FeaturedDestination`)
 * so the Photography, Map-popup, and Featured surfaces all reuse this control
 * unchanged. The `sourceId` and `title` are read from the adapter-built `draft`, NOT
 * `source.id`/`source.name`, because `FeaturedDestination` has no `id` (its id is
 * derived from the name).
 */

interface AddToPlanButtonProps {
  source: AddToPlanSource;
  sourceType: SourceType;
  /** Tailwind text-color literal for the accent (e.g. "text-himalaya-400"). */
  accentColor?: string;
}

export default function AddToPlanButton({ source, sourceType, accentColor }: AddToPlanButtonProps) {
  const { findPlacements } = useItineraryContext();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // The prefilled candidate. Memoized on the record identity so it isn't rebuilt
  // every render; the adapter is pure.
  const draft = useMemo(() => toItineraryDraft(source, sourceType), [source, sourceType]);

  // Reactive "already added" lookup. Empty => not yet planned.
  // Use the draft's sourceId (the adapter derives it; Featured has no own id).
  const placements = findPlacements(draft.sourceId);
  const isAdded = placements.length > 0;

  // Compact where-it's-planned summary: "On Dec 12" for one day, "On N days" for more.
  const summary = useMemo(() => {
    if (placements.length === 0) return '';
    if (placements.length === 1) {
      // formatDate -> "Tue, Dec 12"; drop the weekday for a tight pill.
      const label = formatDate(placements[0].date).replace(/^[A-Za-z]+,\s*/, '');
      return `On ${label}`;
    }
    return `On ${placements.length} days`;
  }, [placements]);

  const handleOpen = () => {
    // Capture the trigger BEFORE the dialog mounts/autofocuses, so focus
    // returns here on AnimatePresence onExitComplete — not in the dialog cleanup.
    triggerRef.current = (document.activeElement as HTMLButtonElement) ?? null;
    setOpen(true);
  };

  return (
    <>
      {isAdded ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={handleOpen}
          aria-haspopup="dialog"
          aria-label={`${draft.title} is planned ${summary.toLowerCase()}. Modify or remove.`}
          className="w-full mt-3 flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gold-500/15 border border-gold-400/40 text-gold-300 text-xs font-medium hover:bg-gold-500/25 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
        >
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span>Added</span>
          <span className="text-gold-400/60" aria-hidden="true">·</span>
          <span className="flex items-center gap-1 text-gold-300/80">
            <CalendarDays className="w-3 h-3 shrink-0" />
            {summary}
          </span>
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={handleOpen}
          aria-haspopup="dialog"
          aria-label={`Add ${draft.title} to your trip plan`}
          className={`w-full mt-3 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none hover:bg-white/10 ${accentColor ?? 'text-white/70'}`}
        >
          <Plus className="w-3.5 h-3.5 shrink-0" />
          Add to plan
        </button>
      )}

      {/* One dialog instance per card; only one is open at a time in practice.
          Focus returns to the trigger on exit-complete (parent-owned). */}
      <AnimatePresence
        onExitComplete={() => {
          triggerRef.current?.focus?.();
        }}
      >
        {open && (
          <AddToItineraryDialog
            open={open}
            draft={draft}
            existingPlacements={placements}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
