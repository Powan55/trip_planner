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
      className="!pt-0 !pb-1 sm:!pt-[calc(5rem+var(--safe-top))] sm:!pb-4 max-sm:[@media(max-height:699px)]:sr-only"
      panelClassName="max-sm:!border-0 max-sm:!bg-transparent max-sm:!px-0 max-sm:!py-1 sm:px-6 sm:py-4"
    />
  );
}
