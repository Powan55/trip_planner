'use client';

// TRAVEL MODE — client island module. Next 15 forbids `dynamic({ssr:false})` in a
// Server Component, so the `/travel` page mounts its client
// islands through this sibling `'use client'` module — the same pattern as app/recap/sections.tsx.
//
// the hero + agenda are now mounted TOGETHER inside `TravelDatePicker`, which
// owns the `?date=` selection layer (strip/banner/empty-state) above them and passes each its
// resolved day via the existing `date` seam. One island, one ssr:false boundary — this is also
// how `useSearchParams` avoids needing a separate Suspense wrapper in the static export (the same
// non-SSR sidestep `calendar-planner.tsx` relies on).
import dynamic from 'next/dynamic';

export const TravelDatePicker = dynamic(() => import('@/components/travel-date-picker'), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden="true"
      className="mx-auto mt-6 min-h-[220px] max-w-2xl rounded-2xl glass-card"
    />
  ),
});

// — outdoor high-legibility toggle. Tiny, but kept off the initial /travel chunk the same
// way as the date picker to hold the route under its First Load JS budget.
export const TravelLegibilityToggle = dynamic(() => import('@/components/travel-legibility-toggle'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="h-11 w-11 shrink-0 rounded-lg" />,
});

// — the exit X (hard DoD). Same lazy ssr:false island pattern as the legibility toggle so it
// stays off the initial /travel required chunk; a same-size placeholder holds its slot (no shift),
// and it hydrates in-place within ~a beat — the escape hatch is present effectively immediately.
export const TravelExitButton = dynamic(() => import('@/components/travel-exit-button'), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="h-11 w-11 shrink-0 rounded-lg" />,
});

// two small night-out affordances (TravelLastTrainChip, TravelTonightCard) are NOT
// re-exported here: they need the SAME resolved `?date=`/today-in-trip state that only
// `components/travel-date-picker.tsx` computes, and that module is itself dynamically
// imported from THIS file (`TravelDatePicker` above) — a static import back from
// `travel-date-picker.tsx` to this module would be a module cycle. Instead they're defined as
// their OWN nested `dynamic(ssr:false)` islands directly inside `travel-date-picker.tsx`,
// exactly like `TravelEssentialsCard` — same lazy-split pattern,
// no cycle.
