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

// — the 32-day TripTimeline moved here from Home. It keeps its lazy-island
// recipe: a `dynamic(ssr:false)` module reference rendered THROUGH LazyVisible (a component
// reference, never JSX children — see lazy-visible.tsx) so its chunk streams in on demand
// rather than joining /plan's initial required set. Wrapped in a client component here so
// the Server Component page.tsx can mount it without passing a reference across the boundary.
const TripTimeline = dynamic(() => import('@/components/trip-timeline'), {
  ssr: false,
  loading: () => <SectionSkeleton height="clamp(34rem, 90vh, 54rem)" />,
});
export function PlanTimeline() {
  return <LazyVisible component={TripTimeline} minHeight="clamp(34rem, 90vh, 54rem)" />;
}
export const BudgetPanel = dynamic(() => import('@/components/budget-panel'), {
  ssr: false,
  loading: () => <SectionSkeleton height="28rem" count={2} />,
});
