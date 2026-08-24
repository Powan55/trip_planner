'use client';

// (Next 15 migration): see app/nepal/sections.tsx — same reason. The
// planner/budget islands keep their ssr:false + sized loading skeletons;
// they read/write localStorage so have no server render. (A4): the BackupRestore
// island was removed from here (and from page.tsx) — backup now lives only in Settings
// (components/settings-panel.tsx Data group, where it was already mounted).
import dynamic from 'next/dynamic';
import LazyVisible from '@/components/lazy-visible';
import SectionSkeleton from '@/components/section-skeleton';

export const CalendarPlanner = dynamic(() => import('@/components/calendar-planner'), {
  ssr: false,
  loading: () => <SectionSkeleton height="44rem" count={4} />,
});

// (#94): the 32-day TripTimeline island is GONE — it was a second, unsynced copy of the
// itinerary (its own `selectedDate`, and LazyVisible renders it prop-less so its `onDateSelect`
// was dead code), so /plan shipped two 32-day day selectors that never agreed. The planner's
// own `lg:grid-cols-[340px_1fr]` two-column layout is the day-detail surface now. What the
// timeline uniquely carried and is KEPT here is the recent-changes ActivityFeed.
//
// Same lazy-island recipe as every other section: a `dynamic(ssr:false)` module reference
// rendered THROUGH LazyVisible (a component reference, never JSX children — see
// lazy-visible.tsx) so its chunk streams in on demand rather than joining /plan's initial
// required set. Wrapped in a client component here so the Server Component page.tsx can mount
// it without passing a reference across the boundary.
//
// No `loading:` slot and `minHeight="0px"` are deliberate, and precedented by
// `CustomTripMyPlaces` on Home (app/page.tsx): ActivityFeed returns null when no item carries
// attribution (the portfolio build), so there is no box to reserve and a sized skeleton would
// invent one. Its only prop (`className`) is optional, which is what LazyVisible's prop-less
// instantiation requires.
const ActivityFeed = dynamic(() => import('@/components/activity-feed'), { ssr: false });
export function PlanActivity() {
  return <LazyVisible component={ActivityFeed} minHeight="0px" />;
}
export const BudgetPanel = dynamic(() => import('@/components/budget-panel'), {
  ssr: false,
  loading: () => <SectionSkeleton height="28rem" count={2} />,
});

// Issue #223 — the paper fallback. `ssr: false` for the same reason as the planner above: it
// reads the itinerary store, i.e. localStorage, so a server render would emit the seed pack and
// hydration would fight it. No `loading:` skeleton — a print-only surface has no box to reserve.
//
// DELIBERATELY NOT THROUGH LazyVisible. The bytes are not the reason, and an earlier version of
// this comment got that wrong twice — worth stating plainly so it does not get re-argued.
//
// MEASURED, from a real build: this island is its own chunk at 14,045 B raw / 5,047 B gzipped
// (it inlines lib/booking-data.ts, which nothing else on /plan reaches). It does NOT appear in
// out/plan/index.html, so First Load JS is unchanged either way — it is fetched after hydration
// and it is in the service-worker precache. Deferring it through LazyVisible would save nothing
// on first load.
//
// What deferring WOULD cost is smaller than it looks, and the two reasons first written here do
// not survive: `dynamic(ssr:false)` already mounts after hydration, so both the print-races-the-
// chunk-load window and the 44px layout shift apply to this form as well. With JS disabled /plan
// prints one near-empty page regardless. The window is shortened by mounting eagerly, not closed.
//
// The real cost of this choice runs the other way, and it is the thing to weigh if this is ever
// revisited: on SCREEN the hidden sheet is 1,218 of /plan's 2,119 DOM nodes. It consumes
// useItineraryContext, so every itinerary edit re-renders 32 days through groupItemsByPhase and
// reconciles those hidden nodes. That is the price of the sheet always being there, and it is
// paid on every keystroke in the planner — not in kilobytes on load.
export const PrintItinerary = dynamic(() => import('@/components/print-itinerary'), { ssr: false });
