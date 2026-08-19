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
