'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import AddToItineraryDialog from '@/components/add-to-itinerary-dialog';
import type { ItineraryDraft } from '@/lib/itinerary-adapter';

/**
 * Global, invisible host for the custom "add your own plan" flow.
 *
 * Mounted ONCE in the root layout (this component does NOT mount
 * itself). It renders nothing until an event arrives; it listens on `window` for the
 * CustomEvent `quickadd:open` — emitted by the quick-add FAB and by the calendar
 * FAB — and opens `AddToItineraryDialog` in CUSTOM mode preset to the requested day:
 *
 *   window.dispatchEvent(new CustomEvent('quickadd:open', { detail: { date: '2026-12-22' } }))
 *
 * `detail.date` is optional; when absent (or not a valid trip date) the dialog falls
 * back to the first trip date (the dialog validates `presetDate` against TRIP_DATES).
 *
 * The dialog itself owns the full modal contract it inherits: document-level
 * Esc, Tab-trap, first-field autofocus, parent-owned focus-return on
 * `AnimatePresence onExitComplete`, a pinned action footer, a portal to
 * `document.body`, and the `body[data-dialog-open]` flag. Focus-return here is
 * parent-owned: we capture `document.activeElement` when the event fires and
 * refocus it once the exit animation completes.
 *
 * Custom items are plain ItineraryItems with NO sourceId/sourceType, so the
 * `draft` we pass is a minimal empty candidate: the dialog's custom mode reads the
 * editable Title/Location inputs, not the draft's title/location. `existingPlacements`
 * is always `[]` — a custom item can never match `findPlacements` (no sourceId).
 */

// A minimal empty draft for custom mode. sourceId/sourceType are placeholders the
// custom path never persists (handleConfirm in custom mode omits them entirely).
const EMPTY_CUSTOM_DRAFT: ItineraryDraft = {
  title: '',
  location: undefined,
  notes: undefined,
  category: 'sightseeing',
  duration: undefined,
  time: undefined,
  sourceId: '',
  sourceType: 'recommendation',
};

interface QuickAddDetail {
  date?: string;
}

export const QUICKADD_OPEN_EVENT = 'quickadd:open';

export default function QuickAddHost() {
  const [open, setOpen] = useState(false);
  const [presetDate, setPresetDate] = useState<string | undefined>(undefined);
  // Parent-owned focus-return target: captured when the event fires (the FAB or
  // trigger that had focus), refocused on exit-complete.
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onQuickAddOpen = (e: Event) => {
      const detail = (e as CustomEvent<QuickAddDetail>).detail;
      triggerRef.current = (document.activeElement as HTMLElement) ?? null;
      setPresetDate(detail?.date);
      setOpen(true);
    };
    window.addEventListener(QUICKADD_OPEN_EVENT, onQuickAddOpen);
    return () => window.removeEventListener(QUICKADD_OPEN_EVENT, onQuickAddOpen);
  }, []);

  return (
    <AnimatePresence
      onExitComplete={() => {
        triggerRef.current?.focus?.();
      }}
    >
      {open && (
        <AddToItineraryDialog
          open={open}
          mode="custom"
          presetDate={presetDate}
          draft={EMPTY_CUSTOM_DRAFT}
          existingPlacements={[]}
          onClose={() => setOpen(false)}
        />
      )}
    </AnimatePresence>
  );
}
