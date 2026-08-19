import PlanHero from '@/components/plan-hero';

// PLAN: the calendar/itinerary planner. Its author-filter control
// mounts inside CalendarPlanner (unchanged).
// (#94): the route no longer renders the itinerary TWICE. The 32-day TripTimeline island
// that used to sit under the planner is deleted — it held its OWN `selectedDate` (and
// LazyVisible mounts islands prop-less, so its `onDateSelect` never fired), which put two
// 32-day day selectors on one page with no way to sync them. The planner's own
// `lg:grid-cols-[340px_1fr]` split IS the calendar + day-detail layout, so no page-level grid
// is added here: each island already owns its `px-4 sm:px-6` + `max-w-[1200px] mx-auto`, and an
// outer rail would squeeze the day-detail column at 1280 (see e2e/plan-map-split.spec.ts).
// The one piece the timeline uniquely carried — the recent-changes ActivityFeed — survives as
// PlanActivity.
// (Next 15): the ssr:false planner/activity/budget islands live in ./sections
// (client module); this Server Component page exports metadata. Same/ sized skeletons
// keep the initial shell light. (A4): Backup & Restore moved OFF /plan into Settings
// (components/settings-panel.tsx Data group — where it was already mounted), so /plan stays
// calendar-first; it is no longer imported/rendered here.
import { CalendarPlanner, PlanActivity, BudgetPanel } from './sections';

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
      {/* The wrapper is load-bearing: ActivityFeed has no horizontal padding of its own (the
          timeline section used to supply it), so at 320px it would run edge-to-edge. A wrapper
          AROUND LazyVisible is fine — the island recipe forbids JSX children passed INTO it,
          not a padded box around it. `px-4 pb-16 sm:px-6` is BudgetPanel's own class verbatim;
          the `pb-16` is what separates the feed from BudgetPanel below, which carries no top
          padding of its own.
          Known ceiling: on the portfolio build ActivityFeed returns null (zero attribution
          across the shipped seed), and this wrapper still contributes its 64px `pb-16` — a
          phantom gap in a region that just lost a whole section, so it is left as-is. If it ever
          matters, move the padding onto a `className`-applying reference component and pass THAT
          to LazyVisible (the `GatedTravelInspiration` precedent in app/page.tsx), so it renders
          only when the feed does. */}
      <div className="px-4 pb-16 sm:px-6"><PlanActivity /></div>
      <BudgetPanel />
    </main>
  );
}
