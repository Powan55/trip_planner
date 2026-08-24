// POST-TRIP STORY RECAP: a read-only, scroll-storytelling TEXT recap of the whole
// trip — weaves plan-vs-actual (`core/recap/model.ts`'s `summarizePlan`), journal reflections
//, and spend into a chronological day-by-day narrative. Only unlocks once
// `isPostTrip()` is true; before that it shows a tasteful "unlocks after the trip" state
// (`components/trip-story-recap.tsx`). Localstorage-only — the island is lazy +
// ssr:false, mirroring app/journal/. Next 15: the ssr:false dynamic import
// lives in./sections (a client module); this Server Component page exports metadata.
// Reached as a companion in `lib/nav-items.ts` (the `/more/` page + the desktop "More" menu), the
// command palette, or a direct URL.
import PageHeader from '@/components/page-header';
import { TripStoryRecap, WrappedStory } from './sections';

export const metadata = {
  title: 'Trip Story · Nepal × Japan Journey',
  description: 'The whole trip, day by day — plan vs. actual, journal reflections, and spend, woven into one story.',
};

export default function RecapPage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* Supplies the page's <h1>; the islands' own headings (trip summary / per-day) nest
          under it as h2/h3. */}
      <PageHeader
        eyebrow="The whole journey"
        title="Trip Story"
        description="A day-by-day narrative of Nepal and Japan — what was planned, what actually happened, what you wrote, and what you spent. Unlocks once the trip wraps."
      />
      <TripStoryRecap />
      {/* — the "Trip Wrapped" capstone: an entry card + headline-stat panels, composed BELOW
          the day-by-day story (additive, does not touch TripStoryRecap's own markup/behavior). */}
      <WrappedStory />
    </main>
  );
}
