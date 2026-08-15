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

// HOME: hero · today/recap content · trip-dashboard · bento · travel-inspiration,
// plus the legacy v1 hash redirect. Navbar/Footer live in the root layout now.
// The calendar/destination/map/flights sections moved to their own routes
//.
// the 32-day trip-timeline moved off Home to /plan/; the page is now content-first.
//
// the BELOW-THE-FOLD sections
// (TripDashboard, TravelInspiration, HomeBento) stay
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
// — the "at a glance" bento grid (read-only composition of existing hooks: next-up,
// budget spent, cached weather, packing/docs %, map link, Travel Mode entry). Same
// dynamic(ssr:false) + LazyVisible island pattern as every other below-fold Home section
// — its chunk stays out of Home's First Load JS.
const HomeBento = dynamic(() => import('@/components/home-bento'), {
  ssr: false,
  loading: () => <SectionSkeleton height="clamp(16rem, 46vh, 22rem)" />,
});

// deferred sections — each keeps a sized `loading:` skeleton so the chunk-fetch gap
// (once its LazyVisible trigger fires) shows a placeholder of the same reserved height,
// preventing any layout jump.
// — the dashboard is now 3 temporal cards (was 9), so its reserved skeleton is
// shorter. The 32-day TripTimeline was MOVED off Home to /plan (app/plan/), dropping its
// chunk out of Home's First Load JS entirely.
const TripDashboard = dynamic(() => import('@/components/trip-dashboard'), {
  ssr: false,
  loading: () => <SectionSkeleton height="clamp(22rem, 60vh, 40rem)" />,
});
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
      <LazyVisible component={HomeSectionNav} minHeight="56px" />
      <TodayPanel />
      <TripRecap />
      <LazyVisible component={TripDashboard} minHeight="clamp(22rem, 60vh, 40rem)" />
      <LazyVisible component={HomeBento} minHeight="clamp(16rem, 46vh, 22rem)" />
      <LazyVisible component={GatedTravelInspiration} minHeight="clamp(40rem, 130vh, 80rem)" />
      {/* Custom-trip-only "My places" (renders null on the default pack). minHeight 0 so the
          default pack reserves no visible box while the gate resolves. */}
      <LazyVisible component={CustomTripMyPlaces} minHeight="0px" />
      <LegacyHashRedirect />
    </main>
  );
}
