'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { TRIP_DATES } from '@/lib/trip-data';
import { getTodayInTrip } from '@/lib/trip-now';
import { getSelectedDay } from '@/lib/selected-day';
import { isTravelRoute } from '@/lib/travel-route';

/**
 * `/plan` owns its own always-visible sticky composer as the primary add
 * affordance, so the FAB would be a SECOND, redundant add button on that one route.
 * Suppressed there.
 *
 * Boundary-checked (`/plan/` prefix, not a bare `startsWith('/plan')`) exactly like
 * `isTravelRoute`, so a hypothetical sibling like `/planner` never matches; `/plan` is
 * currently a flat route with no children. Deliberately LOCAL rather than a
 * `lib/plan-route.ts`: `isTravelRoute` is a shared module because SIX chrome islands must
 * agree on that match rule, whereas this one has exactly one consumer — and importing
 * `lib/nav-items.ts`'s `isRouteActive` would pull 13 lucide icons into this
 * `dynamic(ssr:false)` chunk to compute one boolean.
 */
function isPlannerRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === '/plan' || pathname.startsWith('/plan/');
}

/**
 * Quick-add FAB.
 *
 * A phone-only floating "add to plan" button that opens the custom-add dialog for a sensible
 * preset date. Shown only `<md`, and only on routes that do not already carry their own add
 * affordance — suppressed under `/travel` and, since under `/plan` (which has the
 * sticky composer). Parked at the bottom-right, above the tab bar and clear of the home
 * indicator.
 *
 * SEAMS (build against the contract; graceful no-op until the sibling lane merges):
 * - SEAM 1 — emit: on click we `window.dispatchEvent(new CustomEvent('quickadd:open', { detail:
 * { date } }))`. ships the listener (`quick-add-host.tsx`) that opens the dialog on that
 * date. Until merged there is no listener → the click is a harmless no-op (we do NOT build a
 * fallback dialog). The preset `date` is `getTodayInTrip()?.date ?? getSelectedDay() ??
 * TRIP_DATES[0]` — i.e. today if we're mid-trip, else the day the calendar has focused, else
 * the first trip day.
 * - SEAM 2 — hide on dialog:'s dialog sets `document.body.dataset.dialogOpen = '1'` while
 * open. We observe that attribute with a MutationObserver and hide the FAB while it is present
 * (so the FAB never floats over an open dialog). Until merged the attribute never appears, so
 * the FAB simply never hides — acceptable in-lane.
 *
 * Z-LADDER: the FAB is `z-40` (presence/panel tier), deliberately BELOW the dialog tier
 * (z-50) and the token gate (z-70), so it can never sit over an open dialog's scrim — seam 2 is a
 * belt-and-braces reinforcement of the same guarantee.
 *
 * POSITION: `bottom = var(--tab-bar-h, 64px) + env(safe-area-inset-bottom) + 1rem`, so it always
 * floats one comfortable gap above the tab bar regardless of safe-area inset. `right-4`.
 *
 * A11y / motion: 56px round target (well over the 44px min), `aria-label="Add to plan"`, visible
 * focus ring, and a reduced-motion-safe hover (`motion-reduce:` drops the scale + transition per
 *). SSR-guarded throughout.
 */
export default function QuickAddFab() {
  // chrome-free Travel Mode — suppressed under `/travel`; adds `/plan`
  // (declared with the other hooks; the actual early return is below, after all hooks,
  // unconditional order).
  const pathname = usePathname();
  // Seam 2: hidden while any dialog is open (body[data-dialog-open]).
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

  // Seam 1: resolve the preset date and emit the open event. listens; no-op until then.
  const handleClick = () => {
    if (typeof window === 'undefined') return;
    const date = getTodayInTrip()?.date ?? getSelectedDay() ?? TRIP_DATES[0];
    window.dispatchEvent(new CustomEvent('quickadd:open', { detail: { date } }));
  };

  if (dialogOpen || isTravelRoute(pathname) || isPlannerRoute(pathname)) return null;

  return (
    <button
      type="button"
      data-testid="quick-add-fab"
      onClick={handleClick}
      aria-label="Add to plan"
      className="md:hidden fixed right-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/30 outline-none transition-transform duration-200 hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100"
      // Float one gap above the tab bar; both offsets scale with the device safe-area.
      style={{ bottom: 'calc(var(--tab-bar-h, 64px) + env(safe-area-inset-bottom) + 1rem)' }}
    >
      <Plus className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}
