import PlanHero from '@/components/plan-hero';

// PLAN: the calendar/itinerary planner. Its author-filter control
// mounts inside CalendarPlanner (unchanged).: the 32-day TripTimeline (+ its
// activity feed) moved here from Home, sitting under the planner as the whole-trip
// read overview of the same itinerary.
// (Next 15): the ssr:false planner/timeline/budget islands live in./sections
// (client module); this Server Component page exports metadata. Same/ sized skeletons
// keep the initial shell light. (A4): Backup & Restore moved OFF /plan into Settings
// (components/settings-panel.tsx Data group — where it was already mounted), so /plan stays
// calendar-first; it is no longer imported/rendered here.
import { CalendarPlanner, PlanTimeline, BudgetPanel } from './sections';

export const metadata = {
  title: 'Plan · Nepal × Japan Journey',
  description: 'Day-by-day itinerary planner for the Nepal and Japan trip — add, edit, and reorder activities across all 32 days.',
};

export default function PlanPage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* PlanHero supplies the page's <h1> ( pages shipped
          without one — a11y win). Section components keep their own <h2>s. */}
      <PlanHero />
      <CalendarPlanner />
      <PlanTimeline />
      <BudgetPanel />
    </main>
  );
}
