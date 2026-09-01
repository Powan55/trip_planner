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
/** Measured height of the rendered strip (44px chip + `py-2`, which is 2 x 8.5 at the 17px
 *  root). Declared in ONE place so the LazyVisible reservation and the chunk-gap loading slot
 *  can never drift apart.
 *  RE-MEASURED on the built export against the settled tree: 61.0 at every width from 320 to
 *  1920, at both viewport-height ends and both clock states. Flat, and unchanged.
 *  `e2e/polish-bundle.spec.ts` hard-codes this 61 as `HOME_FIRST_RESERVATION_PX` (it is Home's
 *  first skeleton in DOM order, above the fold), so moving it means moving that spec too. */
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
 *  MEASURED off the built export, signed in — the old written-out arithmetic (6 cells x 78px +
 *  gaps + `py-4` + the milestone line) no longer describes this band, so it is gone rather than
 *  left to read as current. RE-MEASURED against the settled tree, unchanged:
 *      304.5 at 390 — flat at 304.5 across 320-639, the stacked case
 *      233.7 at 1280 — flat from 640 up
 *  Independent of viewport HEIGHT and identical pre-trip and in-trip. 305 is the mobile
 *  number, so >=640 over-reserves by ~71. */
const STAT_ROW_H = '305px';
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
 *  RE-MEASURED on the built export against the SETTLED tree, signed in, both clock states
 *  (identical), independent of viewport height. The previous figures were taken while
 *  globals.css was still in flight and every one of them read ~15.7 high:
 *      320 -> 517.2   360 -> 399.6   390/414 -> 380.5   430/480/560 -> 353
 *      600/639 -> 325.5   >=640 -> 359.5
 *  518 is the 320 number. 320 is a supported width (same rule BENTO_H already applies), so it
 *  is the one that must not under-reserve; 390 over-reserves by ~137 and that is the safe
 *  direction — the box collapses upward at the island's idle beat rather than the page jumping
 *  down onto content. A pack with more than two legs stacks taller and would move this. */
const JOURNEY_H = '518px';
const HomeJourneyBar = dynamic(() => import('@/components/home-journey-bar'), {
  ssr: false,
  loading: () => <SectionSkeleton height={JOURNEY_H} />,
});
// — the readiness roll-up: what is done and what is not, across the four subjects that have
// a completion state (day plans, docs, packing, budget). Read-only composition of hooks the
// bento already calls, so it adds no new data source. Same dynamic(ssr:false) + LazyVisible
// island pattern as every other below-fold section — its chunk stays out of First Load JS.
/** Reserved height of the readiness section. Declared ONCE — the same rule as JOURNEY_H and
 *  STAT_ROW_H: the `loading:` slot here and the `<LazyVisible minHeight>` at the call site
 *  must never drift apart, or the chunk-fetch gap resizes the box the placeholder reserved.
 *  RE-MEASURED off the built export against the SETTLED tree, not derived. Both clock states
 *  agree and viewport height does not move it. The previous figures were taken while
 *  globals.css was still in flight and read ~15.8 high:
 *      320 -> 422.9   360-430 -> 402.2   480-639 -> 381.5   640-900 -> 308   >=1024 -> 287.3
 *  So 402.2 at 390 and 287.3 at 1280. 423 is the 320 number — the tall case, and the one that
 *  must not under-reserve; 1280 over-reserves by ~136, the safe direction (the box collapses
 *  upward at the island's idle beat rather than the page jumping down onto content).
 *  Re-measure if a fifth check is added or a row grows a second line of detail. */
const READINESS_H = '423px';
const HomeReadiness = dynamic(() => import('@/components/home-readiness'), {
  ssr: false,
  loading: () => <SectionSkeleton height={READINESS_H} />,
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
 *  It wraps rather than gridding, so its height is a step function of WIDTH. RE-MEASURED on the
 *  BUILT export against the SETTLED tree, signed in, every tile mounted, pre-trip / in-trip (the
 *  two states still disagree — in-trip carries an extra tile). The previous figures were taken
 *  while globals.css was still in flight and read ~29 high:
 *      320 -> 637.6 / 699.3    360 -> 620.1 / 681.8    390 -> 602.6 / 664.3
 *      414 -> 585 / 664.3    430 -> 585 / 646.7    480 -> 568.3 / 630
 *      560 -> 500.5 / 562.2    600 -> 503.1 / 564.8    639 -> 504.6 / 566.3
 *      640-900 -> 538.6 / 600.3   >=1024 -> 521 / 582.7
 *  Mobile is the tall one again (the redesign flattened the old 640 bump), and viewport height
 *  does not move it. This is the one section where the two clock states differ at all — every
 *  other constant here measured identically under `?today=off` and `?today=` in-trip.
 *
 *  A PLAIN px VALUE, NOT A `clamp(_, vh, _)` — the idiom the neighbours use does not fit this
 *  section and would be decoration. Height here runs INVERSELY to width while `vh` runs WITH
 *  it, so no vh expression can both cover mobile and stay near the desktop number. So this is
 *  STAT_ROW_H's treatment instead: one measured literal at the tallest layout that matters,
 *  over-reserving the shorter ones for the ~200ms before the island's idle beat fires, which
 *  is the safe direction (the box collapses upward rather than the page jumping down onto
 *  content). 700 covers every supported width, 320 included, in BOTH clock states. */
const BENTO_H = '700px';
const HomeBento = dynamic(() => import('@/components/home-bento'), {
  ssr: false,
  loading: () => <SectionSkeleton height={BENTO_H} />,
});
/** Reserved height of the chapter bands (issue #92). Two plates whose frame is a
 *  `clamp(300px, 40svh, 380px)` (and `clamp(360px, 46svh, 460px)` from 900px up) — so unlike
 *  the bento above, this section runs WITH viewport height, and its ceiling is where that
 *  clamp tops out. RE-MEASURED on the built export against the SETTLED tree, both clock states
 *  identical. The previous figures were taken while globals.css was still in flight and read
 *  ~15.7 high:
 *      390 wide -> 907.4 at 844 tall, 992.2 at 1200 (both frames pinned at the 380 ceiling)
 *     1280 wide -> 574.9 at 844 tall, 646.7 at 1200
 *      320 wide -> 968.4 at 844 tall, 1053.2 at 1200  <- the tall case
 *  320 is taller than 390 because the capline wraps to two lines there and the masthead
 *  subtitle wraps as well. Mobile is the tall end either way: the two plates stack below 640
 *  and sit side by side above it.
 *  1054 covers the 320 ceiling; every shorter viewport over-reserves, the safe direction.
 *  The band's frame no longer takes its WIDTH from the plate recipe's aspect-ratio (it clears
 *  it with `plate--band`), so it is full-bleed at last — that changed the band's width, not
 *  its height, and this figure is measured after it. */
const CHAPTERS_H = '1054px';
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
//
// RE-MEASURED on the built export against the SETTLED tree, signed in, both clock states
// identical, after the plate frame took a 400px cap in components/travel-inspiration.tsx and
// stopped switching to the recipe's landscape frame at 700:
//     320 -> 3768.1   360/390 -> 3832.5  <- peak
//     414-639 -> 3813.4   640 -> 1985.3   660-900 -> 1998.7   >=1024 -> 1545
// The grid is ONE column below 640 (`sm:grid-cols-2`), two to 1023 and three above, and the
// plate frame is portrait, so the height used to run WITH WIDTH — eight plates deep, 7146 at
// 639, and the 415-639 band under-reserved by up to ~2640. Capping the frame flattens that
// run into a plateau, so 3833 is BOTH the 390 figure the neighbours' convention asks for and
// the peak across every supported width: no width under-reserves now. Wider viewports
// over-reserve, the safe direction — the box collapses upward at the island's idle beat
// rather than the page jumping down onto content.
// The 700-1023 band used to measure 960-1121 because the landscape frame collapsed each plate
// to a 136-181px letterbox; that is the frame the caption overflowed, and it is gone. This
// literal did not move — the peak is at 360/390, which never took that frame.
// A plain px value, not a `clamp(_, vh, _)`: the driver is width, and no vh expression can
// track that or survive the cliff at the breakpoint.
// Both copies of this value — here and the `<LazyVisible minHeight>` at the call site — must
// move together, the same rule the named constants above carry.
const TravelInspiration = dynamic(() => import('@/components/travel-inspiration'), {
  ssr: false,
  loading: () => <SectionSkeleton height="3833px" />,
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
      {/* The readiness roll-up sits AFTER the bento deliberately: "at a glance" is the
          current state, this is what is left before departure, and that is the order you
          want to read them in. It takes no `#` anchor — home-section-nav.tsx lists five
          landmarks and a sixth would change a shipped control. */}
      <LazyVisible component={HomeReadiness} minHeight={READINESS_H} />
      <LazyVisible component={GatedHomeChapters} minHeight={CHAPTERS_H} />
      <LazyVisible component={GatedTravelInspiration} minHeight="3833px" />
      {/* Custom-trip-only "My places" (renders null on the default pack). minHeight 0 so the
          default pack reserves no visible box while the gate resolves. */}
      <LazyVisible component={CustomTripMyPlaces} minHeight="0px" />
      <LegacyHashRedirect />
    </main>
  );
}
