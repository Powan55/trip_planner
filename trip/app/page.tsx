'use client';

// This page is a client component. Every Home section is already
// `dynamic({ssr:false})` (client-only), so the page rendered ~no server HTML
// regardless; making it a client component is what lets it hand component references
// (the deferred sections) to the client <LazyVisible> island. A server component cannot
// pass a function/component reference across the server→client boundary (it is not
// serializable) — that is the boundary this directive resolves. No server-only API is
// used here, so there is no behavioral change beyond where the render boundary sits.

import dynamic from 'next/dynamic';
import LazyVisible from '@/components/lazy-visible';
import SectionSkeleton from '@/components/section-skeleton';

// HOME: hero · trip-dashboard · trip-timeline · travel-essentials,
// plus the legacy v1 hash redirect. Navbar/Footer live in the root layout now.
// The calendar/destination/map/flights sections moved to their own routes
// (/plan/, /nepal/, /japan/, /map/, /flights/ — flights split off Home separately).
//
// JS diet via lazy islands: the below-the-fold sections
// (TripDashboard, TripTimeline, TravelEssentials) stay
// `dynamic({ssr:false})` at module scope (SSG-safe), but are rendered through
// <LazyVisible>, which passes each as a component reference and only instantiates
// `<Component/>` once the section nears the viewport (or a post-hydration idle beat).
// Because the section's element is absent from the initial render tree, Next no longer
// preloads its chunk, so it drops out of Home's First Load JS and streams in on demand.
// (Passing the reference — not JSX children — is load-bearing: JSX children would be
// evaluated in the page's render and re-add the section to the initial tree.)
//
// Kept eager (rendered directly): HeroSection (above the fold / LCP), TodayPanel +
// TripRecap (near-top, render null pre-trip so ~free today), and LegacyHashRedirect
// (a behavioral hash→route effect with no visible box — it must run regardless of
// scroll, so it is never gated on visibility). The section components themselves are
// unchanged; only when their elements enter the tree changed.
const HeroSection = dynamic(() => import('@/components/hero-section'), { ssr: false });
// The in-trip "Today" agenda island. Renders null outside the trip
// window (via getTodayInTrip()), so the pre-/post-trip home layout is unchanged.
const TodayPanel = dynamic(() => import('@/components/today-panel'), { ssr: false });
// The read-only plan-vs-actual day-recap island. Renders null pre-trip
// (Home unchanged before Dec 9), in-trip and post-trip via getNow()/`?today=`.
const TripRecap = dynamic(() => import('@/components/trip-recap'), { ssr: false });
const LegacyHashRedirect = dynamic(() => import('@/components/legacy-hash-redirect'), { ssr: false });
// The sticky section nav rides the same lazy-island pattern as the deferred sections
// below: Home's First Load JS has ~zero headroom left (it sits within a couple of
// bytes of the 106 kB rounding boundary), so even this small component must stay out of the
// initial required-chunk set. `LazyVisible`'s idle-callback fallback still mounts it within
// ~200ms of hydration regardless of scroll (same guarantee as every other deferred section),
// so it is present effectively immediately in practice.
const HomeSectionNav = dynamic(() => import('@/components/home-section-nav'), { ssr: false });

// Deferred sections — each keeps a sized `loading:` skeleton so the chunk-fetch gap
// (once its LazyVisible trigger fires) shows a placeholder of the same reserved height,
// preventing any layout jump.
const TripDashboard = dynamic(() => import('@/components/trip-dashboard'), {
  ssr: false,
  loading: () => <SectionSkeleton height="clamp(34rem, 90vh, 52rem)" />,
});
const TripTimeline = dynamic(() => import('@/components/trip-timeline'), {
  ssr: false,
  loading: () => <SectionSkeleton height="clamp(34rem, 90vh, 54rem)" />,
});
const TravelEssentials = dynamic(() => import('@/components/travel-essentials'), {
  ssr: false,
  loading: () => <SectionSkeleton height="clamp(34rem, 90vh, 54rem)" />,
});

export default function HomePage() {
  return (
    <main className="min-h-screen bg-navy-900">
      <HeroSection />
      <LazyVisible component={HomeSectionNav} minHeight="56px" />
      <TodayPanel />
      <TripRecap />
      <LazyVisible component={TripDashboard} minHeight="clamp(34rem, 90vh, 52rem)" />
      <LazyVisible component={TripTimeline} minHeight="clamp(34rem, 90vh, 54rem)" />
      <LazyVisible component={TravelEssentials} minHeight="clamp(34rem, 90vh, 54rem)" />
      <LegacyHashRedirect />
    </main>
  );
}
