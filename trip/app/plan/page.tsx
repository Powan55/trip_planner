import dynamic from 'next/dynamic';
import PageHero from '@/components/page-hero';
import SectionSkeleton from '@/components/section-skeleton';

// PLAN: the calendar/itinerary planner. Its author-filter control
// mounts inside CalendarPlanner (unchanged); the activity feed stays inside
// TripTimeline on Home — both wherever they currently mount.
// SectionSkeleton reserves space while the island loads (anti-CLS).
const CalendarPlanner = dynamic(() => import('@/components/calendar-planner'), {
  ssr: false,
  loading: () => <SectionSkeleton height="44rem" count={4} />,
});

// The trip Budget panel, mounted between the planner and Backup & Restore.
// Lazy + ssr:false — it reads/writes the budget model via the typed storage gateway
// (localStorage, key 10), so it has no meaningful server render; lazy-loading keeps its
// weight off /plan's initial shell (matches CalendarPlanner / BackupRestore).
const BudgetPanel = dynamic(() => import('@/components/budget-panel'), {
  ssr: false,
  loading: () => <SectionSkeleton height="28rem" count={2} />,
});

// Whole-trip export/import panel, mounted below the planner. Lazy +
// ssr:false — it reads/writes the Vault via browser APIs (Blob, FileReader,
// localStorage), so it has no meaningful server render, and lazy-loading keeps its
// weight off /plan's initial shell.
const BackupRestore = dynamic(() => import('@/components/backup-restore'), {
  ssr: false,
  loading: () => <SectionSkeleton height="14rem" count={1} />,
});

export const metadata = {
  title: 'Plan · Nepal × Japan Journey',
  description: 'Day-by-day itinerary planner for the Nepal and Japan trip — add, edit, and reorder activities across all 32 days.',
};

export default function PlanPage() {
  return (
    <main className="min-h-screen bg-navy-900">
      {/* PageHero supplies the page's <h1> (pages previously shipped
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
