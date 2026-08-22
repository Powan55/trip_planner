'use client';

// this page is a CLIENT component. Every Home section is already
// `dynamic({ssr:false})`, so the page rendered ~no server HTML
// regardless; making it a client component is what lets it hand COMPONENT REFERENCES
// (the deferred sections) to the client <LazyVisible> island. A server component cannot
// pass a function/component reference across the server→client boundary (it is not
// serializable) — that is the boundary this directive resolves. No server-only API is
// used here, so there is no behavioral change beyond where the render boundary sits.

import dynamic from 'next/dynamic';
import LazyVisible from '@/components/lazy-visible';
import SectionSkeleton from '@/components/section-skeleton';
import DefaultTripOnly from '@/components/default-trip-only';

// HOME: hero · stat row · today/recap content · bento · travel-inspiration,
// plus the legacy v1 hash redirect. Navbar/Footer live in the root layout now.
// The calendar/destination/map/flights sections moved to their own routes
//.
// the 32-day trip-timeline moved off Home to /plan/; the page is now content-first.
//
// the BELOW-THE-FOLD sections
// (TravelInspiration, HomeBento) stay
// `dynamic({ssr:false})` at module scope (SSG-safe), but are rendered THROUGH
// <LazyVisible>, which passes each as a COMPONENT REFERENCE and only instantiates
// `<Component/>` once the section nears the viewport (or a post-hydration idle beat).
// Because the section's element is absent from the INITIAL render tree, Next no longer
// preloads its chunk → it drops out of Home's First Load JS and streams in on demand.
// (Passing the reference — not JSX children — is load-bearing: JSX children would be
// evaluated in the page's render and re-add the section to the initial tree.)
//
// KEPT EAGER (rendered directly): HeroSection (above the fold / LCP), TodayPanel +
// TripRecap (near-top, render null pre-trip so ~free today), and LegacyHashRedirect
// (a behavioral hash→route effect with no visible box — it must run regardless of
// scroll, so it is NEVER gated on visibility). The section components themselves are
// unchanged; only WHEN their elements enter the tree changed.
const HeroSection = dynamic(() => import('@/components/hero-section'), { ssr: false });
// the in-trip "Today" agenda island. Renders null outside the trip
// window (via getTodayInTrip()), so the pre-/post-trip home layout is unchanged.
const TodayPanel = dynamic(() => import('@/components/today-panel'), { ssr: false });
// the read-only plan-vs-actual day-recap island. Renders null PRE-trip
// (Home unchanged before Dec 9), in-trip AND post-trip via getNow()/`?today=`.
const TripRecap = dynamic(() => import('@/components/trip-recap'), { ssr: false });
const LegacyHashRedirect = dynamic(() => import('@/components/legacy-hash-redirect'), { ssr: false });
// — the sticky section nav rides the SAME lazy-island pattern as the deferred sections
// below: Home's First Load JS has ~zero headroom left (it sits within a couple of
// bytes of the 106 kB rounding boundary), so even this small component must stay OUT of the
// initial required-chunk set. `LazyVisible`'s idle-callback fallback still mounts it within
// ~200ms of hydration regardless of scroll (same guarantee as every other deferred section),
// so it is present effectively immediately in practice.
// The `loading:` slot is NOT optional here (issue #54 D): LazyVisible flips from its
// placeholder to `<Component/>` at the idle beat, but the dynamic chunk lands later — with
// no loading slot that gap renders NOTHING, so the reserved box collapses to 0 and then
// re-expands when the chunk arrives. For an ABOVE-THE-FOLD island that is two shifts of the
// whole page. Keep each of these two heights identical to its LazyVisible `minHeight`.
const HomeSectionNav = dynamic(() => import('@/components/home-section-nav'), {
  ssr: false,
  loading: () => <SectionSkeleton height="56px" />,
});
// — the compact "Your trips" chip strip (multi-trip on first paint; null when signed out).
// Same lazy-island recipe as HomeSectionNav above: Home's First Load JS has ~zero
// headroom, so even this small component must stay OUT of the initial required-chunk set.
/** Measured height of the rendered strip (44px chip + `py-2`). Declared in ONE place so the
 *  LazyVisible reservation and the chunk-gap loading slot can never drift apart. */
const TRIP_STRIP_H = '61px';
const HomeTripStrip = dynamic(() => import('@/components/home-trip-strip'), {
  ssr: false,
  loading: () => <SectionSkeleton height={TRIP_STRIP_H} />,
});
/** Measured height of the stat row at its TALLER layout — the 2-up mobile grid. Declared once
 *  so the LazyVisible reservation and the chunk-gap loading slot can never drift apart, the
 *  same rule as TRIP_STRIP_H. The 4-up layout at >=640px is shorter, so the placeholder
 *  OVER-reserves there for the ~200ms before the island's idle beat fires; that is the safe
 *  direction (the box collapses upward rather than the page jumping down onto content) and the
 *  band sits below the fold either way.
 *
 *  Issue #31 grew the band, and the arithmetic is written out because it is the only thing
 *  keeping this literal honest:
 *    6 cells in 2 columns = 3 rows × 78px          = 234
 *    + the 2 × 1px grid gaps showing the divider   =   2
 *    + the section's `py-4`                        =  32
 *    + the milestone line (`h-[44px]` + `mt-[12px]`) = 56   → 324
 *  The milestone box uses arbitrary pixel classes rather than `h-11`/`mt-3` precisely so this
 *  sum stays exact: the app's root font is 17px, at which the rem-based scale would not land
 *  on 44 and 12. At >=640px the grid is 2 rows, so the real height there is 245px. */
const STAT_ROW_H = '324px';
// — the stat band directly under the hero (issue #26): trip days, countries, cities and the
// one live figure. Same lazy-island recipe as every other Home section, so its chunk stays
// out of Home's First Load JS; it is deliberately NOT inside <HeroSection>, whose height is
// a fold budget (D-311, and `e2e/countdown.spec.ts`'s CTA clearance assertion).
const HomeStatRow = dynamic(() => import('@/components/home-stat-row'), {
  ssr: false,
  loading: () => <SectionSkeleton height={STAT_ROW_H} />,
});
/** Reserved height of the journey bar (issue #92). Same rule as its three neighbours: the
 *  `loading:` slot and the `<LazyVisible minHeight>` at the call site read this one literal,
 *  or the chunk-fetch gap resizes the box the placeholder reserved.
 *
 *  Measured on the built export, signed in, at both clock states: 583.1 at every width below
 *  640 — the leg cards stack there, which is the tall case — then 457.8 at 640-1023 and 425.9
 *  above. Height does not vary with viewport height.
 *  640 keeps ~57px of headroom over that for a longer leg label or a third chip row, and
 *  over-reserving is the safe direction the neighbours below already take: the box collapses
 *  upward at the island's idle beat rather than the page jumping down onto content. A pack
 *  with more than two legs stacks taller on mobile and would move this number. */
const JOURNEY_H = '640px';
const HomeJourneyBar = dynamic(() => import('@/components/home-journey-bar'), {
  ssr: false,
  loading: () => <SectionSkeleton height={JOURNEY_H} />,
});
// — the "at a glance" bento grid (read-only composition of existing hooks: next-up,
// budget spent, cached weather, packing/docs %, map link, Travel Mode entry). Same
// dynamic(ssr:false) + LazyVisible island pattern as every other below-fold Home section
// — its chunk stays out of Home's First Load JS.
/** Reserved height of the bento section. Declared ONCE — the same rule as TRIP_STRIP_H and
 *  STAT_ROW_H above: the `loading:` slot below and the `<LazyVisible minHeight>` at the call
 *  site must never drift apart, or the chunk-fetch gap resizes the box the placeholder
 *  reserved.
 *
 *  Issue #106 grew the section: it took the `#dashboard` anchor from the deleted
 *  trip-dashboard, so it now carries a VISIBLE "At a glance" heading (plus the
 *  `h2[id$="-heading"]` underline) and `py-10 sm:py-14` where it had an `sr-only` title and
 *  `py-4 sm:py-6`. It also wraps rather than gridding, so its height is a step function of
 *  WIDTH, and issue #92's Connection tile added one more narrow tile. Re-measured on the
 *  BUILT export, signed in, every tile mounted, pre-trip / in-trip (the two states no longer
 *  agree — in-trip carries the extra tile past a row boundary at 640 and at 1280):
 *      320 → 727.3 / 816.5    360 → 727.3 / 816.5    390 → 727.3 / 816.5
 *      414 → 725.3 / 814.5    640 → 763.5 / 874.0    768 → 653.0 / 653.0
 *     1024 → 542.5 / 542.5   1280 → 432.0 / 542.5
 *  640 is the tall one, not mobile: the `sm:` bases take effect there and the 26rem wide
 *  basis fits fewer tiles per row than the width would otherwise allow.
 *
 *  A PLAIN px VALUE, NOT A `clamp(_, vh, _)` — the idiom the neighbours use does not fit this
 *  section and would be decoration. Height here runs INVERSELY to width (702 at 390, 424 at
 *  1280) while `vh` runs WITH it, so no vh expression can both cover mobile and stay near the
 *  desktop number; every candidate over-reserved desktop by ~300px anyway. So this is
 *  STAT_ROW_H's treatment instead: one measured literal at the tallest layout that matters,
 *  over-reserving the shorter ones for the ~200ms before the island's idle beat fires, which
 *  is the safe direction (the box collapses upward rather than the page jumping down onto
 *  content). 880 covers every supported width, 320 included — the tile basis is sized so the
 *  narrow tiles still pair at 320 (see `BentoTile` in components/home-bento.tsx), which is
 *  what keeps the mobile end flat at ~727 instead of running away to 912. The 866 this
 *  replaces was derived rather than measured and came in 8px under the 640 in-trip case. */
const BENTO_H = '880px';
const HomeBento = dynamic(() => import('@/components/home-bento'), {
  ssr: false,
  loading: () => <SectionSkeleton height={BENTO_H} />,
});
/** Reserved height of the chapter bands (issue #92). Two `.photo-header` bands, whose height
 *  is a `clamp(300px, 40svh, 380px)` in globals.css — so unlike the bento above, this section
 *  runs WITH viewport height, and its ceiling is where that clamp tops out. Measured on the
 *  built export at 390 wide: 912.9 at 844 tall, 954.5 at 896, and 997.8 once the viewport is
 *  tall enough (>=950) to pin both bands at the 380 ceiling. The masthead + `py-10` account
 *  for 236.8 of that at every width from 320 to 414 — the subtitle wraps to two lines there,
 *  which the first estimate (110.5, one line) missed, and is why 960 came in ~38px short.
 *  Mobile is the tall case: the two bands stack below 640px and sit side by side above it,
 *  and the >=900px clamp (max 460) is a single row. 1000 covers the ceiling; every shorter
 *  viewport over-reserves, which is the safe direction. */
const CHAPTERS_H = '1000px';
const HomeChapters = dynamic(() => import('@/components/home-chapters'), {
  ssr: false,
  loading: () => <SectionSkeleton height={CHAPTERS_H} />,
});

// deferred sections — each keeps a sized `loading:` skeleton so the chunk-fetch gap
// (once its LazyVisible trigger fires) shows a placeholder of the same reserved height,
// preventing any layout jump.
// the `#inspiration` slot is the photo gallery again (issue #21) — it was standing in as a
// two-card weather panel. Same lazy island, same section id; taller reservation because the
// gallery is eight image cards rather than two text cards.
const TravelInspiration = dynamic(() => import('@/components/travel-inspiration'), {
  ssr: false,
  loading: () => <SectionSkeleton height="clamp(40rem, 130vh, 80rem)" />,
});

// — the user's imported "My places" for a CUSTOM trip's home (custom trips have no guide pages;
// the default pack shows My Places on /nepal/ + /japan/ instead). Rendered through LazyVisible as a
// COMPONENT REFERENCE (like every other deferred section) so the gate + section chunk stay OUT of
// Home's First Load JS; the island itself returns null on the default pack.
const CustomTripMyPlaces = dynamic(() => import('@/components/custom-trip-my-places'), { ssr: false });

// (Plan D10): the inspiration gallery is N×J-specific — gated behind DefaultTripOnly.
// LazyVisible takes its section as a COMPONENT REFERENCE (never JSX, see lazy-visible.tsx), so
// the gate is wrapped into its own small reference component rather than JSX children at the
// call site.
function GatedTravelInspiration() {
  return (
    <DefaultTripOnly>
      <TravelInspiration />
    </DefaultTripOnly>
  );
}

// Same gate, same reason: the two chapter bands are N×J photography and copy, so a custom
// trip gets the honest empty state rather than someone else's country.
function GatedHomeChapters() {
  return (
    <DefaultTripOnly>
      <HomeChapters />
    </DefaultTripOnly>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* — content-first order. The real content (TodayPanel/TripRecap, in-trip
          agenda + plan-vs-actual, null pre-trip per) sits directly under the hero,
          ABOVE the interface-heavy stat dashboard and the "at a glance" bento, which are
          now demoted below it. Every section keeps its dynamic(ssr:false)+LazyVisible
          reference island so nothing re-enters Home's First Load JS. */}
      {/* ABOVE THE FOLD (issue #54 E2) — the trip strip and the hero share ONE viewport
          column instead of the hero claiming `min-h-[100svh]` on its own beneath a strip
          that also takes height. `pt-16` (fixed navbar clearance) lives HERE, on an
          element that is always in the tree, not inside the lazily-mounted strip island
          which returns null when signed out — that is what let the hero paint under the
          navbar mid-load. The hero is `flex-1 min-h-0` and fills whatever is left, so its
          vertically-centred content is centred in the space it actually occupies and its
          CTA clears the fold at every width down to 320. */}
      <div className="flex min-h-[100svh] flex-col pt-16">
        {/* The strip's box is reserved HERE, on the always-present parent, not inside the
            island. The island passes through three states on a cold load — LazyVisible
            placeholder, chunk-gap loading slot, then the strip itself — and its very first
            real render returns `null` (its `trips` state is null until the mount effect
            reads storage). Reserving on the parent makes all four states the same height,
            so nothing below can move. */}
        <div style={{ height: TRIP_STRIP_H }} className="overflow-hidden">
          <LazyVisible component={HomeTripStrip} minHeight={TRIP_STRIP_H} />
        </div>
        <HeroSection />
      </div>
      {/* The stat band reads as part of the hero and is the first thing under the fold
          line — so it goes here, OUTSIDE the 100svh column. Inside it, it would have eaten
          the hero's flex-1 space and pushed the hero's own CTA down (D-311). */}
      <LazyVisible component={HomeStatRow} minHeight={STAT_ROW_H} />
      <LazyVisible component={HomeSectionNav} minHeight="56px" />
      {/* The journey bar and the chapter bands are both SIBLINGS of the hero, never children
          of it, for the same reason the stat band above is: inside the 100svh column they
          would eat the hero's flex-1 and push its CTA down (D-311). Below it they cost the
          fold budget nothing. */}
      <LazyVisible component={HomeJourneyBar} minHeight={JOURNEY_H} />
      <TodayPanel />
      <TripRecap />
      <LazyVisible component={HomeBento} minHeight={BENTO_H} />
      <LazyVisible component={GatedHomeChapters} minHeight={CHAPTERS_H} />
      <LazyVisible component={GatedTravelInspiration} minHeight="clamp(40rem, 130vh, 80rem)" />
      {/* Custom-trip-only "My places" (renders null on the default pack). minHeight 0 so the
          default pack reserves no visible box while the gate resolves. */}
      <LazyVisible component={CustomTripMyPlaces} minHeight="0px" />
      <LegacyHashRedirect />
    </main>
  );
}
