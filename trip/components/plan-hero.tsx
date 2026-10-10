import PageHero from '@/components/page-hero';

/**
 * PlanHero — compact masthead so the selected day's composer lands in the first screen (#920).
 * No subtitle: the planner heading below carries the same line, and it was the repeated intro
 * that pushed the day workspace under the fold. The `!` classes beat PageHero's tier-3 padding,
 * which is concatenated rather than merged.
 */
export default function PlanHero() {
  return (
    <PageHero
      variant="plan"
      title="Trip Planner"
      className="!pt-[calc(4.5rem+var(--safe-top))] !pb-3 sm:!pt-[calc(5rem+var(--safe-top))] sm:!pb-4"
      panelClassName="px-4 py-3 sm:px-6 sm:py-4"
    />
  );
}
