// POST-TRIP STORY RECAP: a read-only, scroll-storytelling TEXT recap of the whole
// trip — weaves plan-vs-actual (`core/recap/model.ts`'s `summarizePlan`), journal reflections
//, and spend into a chronological day-by-day narrative. Only unlocks once
// `isPostTrip()` is true; before that it shows a tasteful "unlocks after the trip" state
// (`components/trip-story-recap.tsx`). Localstorage-only — the island is lazy +
// ssr:false, mirroring app/journal/. Next 15: the ssr:false dynamic import
// lives in./sections (a client module); this Server Component page exports metadata.
// Reached via a direct URL only this slice — deliberately NOT wired into `lib/nav-items.ts` /
// the navbar / tab bar / command palette (those files are fenced — a follow-up rider, same
// deferral as `/journal` and `/safety`).
import { TripStoryRecap, WrappedStory } from './sections';

export const metadata = {
  title: 'Trip Story · Nepal × Japan Journey',
  description: 'The whole trip, day by day — plan vs. actual, journal reflections, and spend, woven into one story.',
};

export default function RecapPage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* Local page header — reuses the PageHero design tokens (glass-panel / text-display-lg /
          text-gradient-gold / animate-reveal-up) directly rather than extending PageHero's
          closed `HeroVariant` union (fenced per the brief, mirroring app/journal/page.tsx
          and app/safety/page.tsx). Supplies the page's <h1>; the island's own headings (trip
          summary / per-day) nest under it as h2/h3. */}
      <header className="px-gutter pt-24 pb-8 sm:pt-28 sm:pb-10">
        <div className="glass-panel animate-reveal-up relative mx-auto max-w-[1200px] overflow-hidden px-6 py-8 sm:px-10 sm:py-12">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(120% 140% at 0% 0%, rgba(240,199,96,0.12) 0%, transparent 55%)',
            }}
          />
          <div className="relative">
            <p className="text-eyebrow mb-3 uppercase" style={{ color: 'hsl(var(--accent-scroll))' }}>
              The whole journey
            </p>
            <h1 className="font-display text-display-lg text-gradient-gold">Trip Story</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              A day-by-day narrative of Nepal and Japan — what was planned, what actually happened,
              what you wrote, and what you spent. Unlocks once the trip wraps.
            </p>
          </div>
        </div>
      </header>
      <TripStoryRecap />
      {/* — the "Trip Wrapped" capstone: an entry card + headline-stat panels, composed BELOW
          the day-by-day story (additive, does not touch TripStoryRecap's own markup/behavior). */}
      <WrappedStory />
    </main>
  );
}
