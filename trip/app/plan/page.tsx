import PageHero from '@/components/page-hero';

// PLAN: the calendar/itinerary planner. Its author-filter control
// mounts inside CalendarPlanner (unchanged); the activity feed stays inside
// TripTimeline on Home — each stays wherever it currently mounts.
// The ssr:false planner/budget/backup islands
// live in ./sections (client module); this Server Component page exports
// metadata. Same sized skeletons keep the initial shell light.
import { CalendarPlanner, BudgetPanel, BackupRestore } from './sections';

export const metadata = {
  title: 'Plan · Nepal × Japan Journey',
  description: 'Day-by-day itinerary planner for the Nepal and Japan trip — add, edit, and reorder activities across all 32 days.',
};

export default function PlanPage() {
  return (
    <main className="min-h-screen bg-navy-900">
      {/* PageHero supplies the page's <h1> (earlier pages shipped
          without one — an accessibility fix). Section components keep their own <h2>s. */}
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
