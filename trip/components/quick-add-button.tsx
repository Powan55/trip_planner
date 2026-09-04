'use client';

import { Plus } from 'lucide-react';
import { TRIP_DATES } from '@/lib/trip-data';
import { getTodayInTrip } from '@/lib/trip-now';
import { getSelectedDay } from '@/lib/selected-day';

/**
 * In-page "Add to plan" — what `/guides` and `/checklist` carry instead of the floating FAB
 * (#381, #391).
 *
 * SAME EVENT, SAME HOST. It dispatches the identical `quickadd:open` CustomEvent that
 * `components/quick-add-fab.tsx` dispatches, with the identical preset-date resolution, and
 * `QuickAddHost` (mounted once in `app/layout.tsx`) turns it into `AddToItineraryDialog
 * mode="custom"`. No new state, no new listener, no second contract — the FAB moved off those
 * two routes and this is where the intent went. Named for that family (`quick-add-fab` /
 * `quick-add-host`), which is also why it is NOT `add-to-plan-button.tsx`: that name is taken
 * by the source-linked place-card control, which needs an `AddToPlanSource` and the itinerary
 * context and adds a KNOWN place. This one adds a custom one and needs neither.
 *
 * The event name is a literal rather than `QUICKADD_OPEN_EVENT` from `quick-add-host.tsx` for
 * the same reason the FAB spells it out: importing that constant drags the host, framer-motion
 * and the dialog into both routes' First Load.
 *
 * ITS OWN CLIENT MODULE because both call sites are Server Components that export `metadata`;
 * a `'use client'` at the top of either page would move that boundary.
 *
 * NOT `md:hidden`. The FAB was phone-only because it was chrome floating over the page; this is
 * page content and belongs at every width.
 *
 * A11y / motion come from `.btn` (globals.css, block 9.7) rather than from anything re-declared
 * here: `min-height: var(--tap)` is the 44px floor (52px outdoors), the visible label is the
 * accessible name, the outward focus ring is `.btn.btn:focus-visible` at (0,3,0), and the
 * reduced-motion block already sets `.btn { transition: none }` — so there is no transition
 * here to fork.
 */
export default function QuickAddButton() {
  const handleClick = () => {
    if (typeof window === 'undefined') return;
    const date = getTodayInTrip()?.date ?? getSelectedDay() ?? TRIP_DATES[0];
    window.dispatchEvent(new CustomEvent('quickadd:open', { detail: { date } }));
  };

  return (
    <button type="button" data-testid="quick-add-button" onClick={handleClick} className="btn px-4">
      <Plus className="h-4 w-4" aria-hidden="true" />
      Add to plan
    </button>
  );
}
