'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { TRIP_DATES } from '@/lib/trip-data';
import { getTodayInTrip } from '@/lib/trip-now';
import { getSelectedDay } from '@/lib/selected-day';

/**
 * Quick-add FAB.
 *
 * A phone-only floating "add to plan" button that opens the custom-add dialog for a sensible
 * preset date. Shown only `<md`; parked at the bottom-right, above the tab bar and clear of the
 * home indicator.
 *
 * How it connects to the dialog (two decoupled hooks):
 * - EMIT: on click we `window.dispatchEvent(new CustomEvent('quickadd:open', { detail:
 *   { date } }))`. The listener (`quick-add-host.tsx`) opens the dialog on that date. If no
 *   listener is mounted the click is a harmless no-op (we do NOT build a fallback dialog). The
 *   preset `date` is `getTodayInTrip()?.date ?? getSelectedDay() ?? TRIP_DATES[0]` — i.e. today
 *   if we're mid-trip, else the day the calendar has focused, else the first trip day.
 * - HIDE ON DIALOG: the dialog sets `document.body.dataset.dialogOpen = '1'` while open. We
 *   observe that attribute with a MutationObserver and hide the FAB while it is present (so the
 *   FAB never floats over an open dialog).
 *
 * Z-LADDER: the FAB is `z-40` (presence/panel tier), deliberately BELOW the dialog tier
 * (z-50) and the token gate (z-70), so it can never sit over an open dialog's scrim — the
 * hide-on-dialog observer is a belt-and-braces reinforcement of the same guarantee.
 *
 * POSITION: `bottom = var(--tab-bar-h, 64px) + env(safe-area-inset-bottom) + 1rem`, so it always
 * floats one comfortable gap above the tab bar regardless of safe-area inset. `right-4`.
 *
 * A11y / motion: 56px round target (well over the 44px min), `aria-label="Add to plan"`, visible
 * focus ring, and a reduced-motion-safe hover (`motion-reduce:` drops the scale + transition).
 * SSR-guarded throughout.
 */
export default function QuickAddFab() {
  // Hidden while any dialog is open (body[data-dialog-open]).
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    const sync = () => setDialogOpen(body.dataset.dialogOpen === '1');
    sync(); // initial state (in case a dialog is already open on mount)
    const observer = new MutationObserver(sync);
    observer.observe(body, { attributes: true, attributeFilter: ['data-dialog-open'] });
    return () => observer.disconnect();
  }, []);

  // Resolve the preset date and emit the open event; quick-add-host.tsx listens.
  const handleClick = () => {
    if (typeof window === 'undefined') return;
    const date = getTodayInTrip()?.date ?? getSelectedDay() ?? TRIP_DATES[0];
    window.dispatchEvent(new CustomEvent('quickadd:open', { detail: { date } }));
  };

  if (dialogOpen) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Add to plan"
      className="md:hidden fixed right-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-gold-400 text-navy-900 shadow-lg shadow-black/30 outline-none transition-transform duration-200 hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 focus-visible:ring-gold-400 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100"
      // Float one gap above the tab bar; both offsets scale with the device safe-area.
      style={{ bottom: 'calc(var(--tab-bar-h, 64px) + env(safe-area-inset-bottom) + 1rem)' }}
    >
      <Plus className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}
