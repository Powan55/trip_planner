import PageHero from '@/components/page-hero';

// PLAN: the calendar/itinerary planner. Its author-filter control
// mounts inside CalendarPlanner (unchanged); the activity feed stays inside
// TripTimeline on Home — both "wherever they currently mount" per the brief.
// (Next 15): the ssr:false planner/budget/backup islands (
//) live in./sections (client module); this Server Component page exports
// metadata. Same/ sized skeletons keep the initial shell light.
import { CalendarPlanner, BudgetPanel, BackupRestore } from './sections';

export const metadata = {
  title: 'Plan · Nepal × Japan Journey',
  description: 'Day-by-day itinerary planner for the Nepal and Japan trip — add, edit, and reorder activities across all 32 days.',
};

export default function PlanPage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* PageHero supplies the page's <h1> ( pages shipped
          without one — a11y win). Section components keep their own <h2>s. */}
      <PageHero
        variant="plan"
        title="Trip Planner"
        eyebrow="Day by day"
        subtitle="All 32 days across Nepal and Japan — add, edit, and reorder every stop of the journey."
      />
      <CalendarPlanner />
      <BudgetPanel />
      <BackupRestore />
    </main>
  );
}
