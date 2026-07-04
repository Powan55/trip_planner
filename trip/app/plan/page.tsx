import dynamic from 'next/dynamic';
import PageHero from '@/components/page-hero';
import SectionSkeleton from '@/components/section-skeleton';

// PLAN: the calendar/itinerary planner. Its author-filter control mounts inside
// CalendarPlanner; the activity feed stays inside TripTimeline on Home.
// SectionSkeleton reserves space while the island loads (anti-CLS).
const CalendarPlanner = dynamic(() => import('@/components/calendar-planner'), {
  ssr: false,
  loading: () => <SectionSkeleton height="44rem" count={4} />,
});

export const metadata = {
  title: 'Plan · Nepal × Japan Journey',
  description: 'Day-by-day itinerary planner for the Nepal and Japan trip — add, edit, and reorder activities across all 32 days.',
};

export default function PlanPage() {
  return (
    <main className="min-h-screen bg-navy-900">
      {/* PageHero supplies the page's <h1> (the section components keep their own
          <h2>s, so every route has exactly one top-level heading — a11y win). */}
      <PageHero
        variant="plan"
        title="Trip Planner"
        eyebrow="Day by day"
        subtitle="All 32 days across Nepal and Japan — add, edit, and reorder every stop of the journey."
      />
      <CalendarPlanner />
    </main>
  );
}
