'use client';

// Client component so it can pass component references to <LazyVisible>; a server
// component can't serialize them. Every section is ssr:false anyway.

import dynamic from 'next/dynamic';
import LazyVisible from '@/components/lazy-visible';
import SectionSkeleton from '@/components/section-skeleton';
import DefaultTripOnly from '@/components/default-trip-only';

// Sections below the fold go through <LazyVisible> as component references, so their
// chunks stay out of Home's first-load JS until they near the viewport or an idle beat.
// Passing JSX children instead would put them back in the initial tree.
// Hero, TodayPanel, TripRecap and LegacyHashRedirect render eagerly.
const HeroSection = dynamic(() => import('@/components/hero-section'), { ssr: false });
const TodayPanel = dynamic(() => import('@/components/today-panel'), { ssr: false });
const TripRecap = dynamic(() => import('@/components/trip-recap'), { ssr: false });
const LegacyHashRedirect = dynamic(() => import('@/components/legacy-hash-redirect'), { ssr: false });
// Each lazy section's `loading:` skeleton and its LazyVisible minHeight share one constant.
// Without the skeleton, the gap between the idle beat and the chunk landing collapses the
// box to 0 and the page shifts twice. Heights were measured on the built export at the
// tallest supported layout (320px wide); over-reserving wider screens is the safe side.
const SECTION_NAV_H = '56px';
const HomeSectionNav = dynamic(() => import('@/components/home-section-nav'), {
  ssr: false,
  loading: () => <SectionSkeleton height={SECTION_NAV_H} />,
});
// Keep in step with HOME_FIRST_RESERVATION_PX in e2e/polish-bundle.spec.ts.
const TRIP_STRIP_H = '61px';
const HomeTripStrip = dynamic(() => import('@/components/home-trip-strip'), {
  ssr: false,
  loading: () => <SectionSkeleton height={TRIP_STRIP_H} />,
});
const STAT_ROW_H = '305px';
const HomeStatRow = dynamic(() => import('@/components/home-stat-row'), {
  ssr: false,
  loading: () => <SectionSkeleton height={STAT_ROW_H} />,
});
// A pack with more than two legs stacks taller and would move this.
const JOURNEY_H = '518px';
const HomeJourneyBar = dynamic(() => import('@/components/home-journey-bar'), {
  ssr: false,
  loading: () => <SectionSkeleton height={JOURNEY_H} />,
});
// Re-measure if a fifth check is added or a row grows a second line.
const READINESS_H = '423px';
const HomeReadiness = dynamic(() => import('@/components/home-readiness'), {
  ssr: false,
  loading: () => <SectionSkeleton height={READINESS_H} />,
});
// In-trip adds a tile, so this covers the in-trip layout at 320px.
const BENTO_H = '700px';
const HomeBento = dynamic(() => import('@/components/home-bento'), {
  ssr: false,
  loading: () => <SectionSkeleton height={BENTO_H} />,
});
// The plate frames clamp on svh, so this is the 320px-wide figure at the clamp ceiling.
const CHAPTERS_H = '1054px';
const HomeChapters = dynamic(() => import('@/components/home-chapters'), {
  ssr: false,
  loading: () => <SectionSkeleton height={CHAPTERS_H} />,
});

// Peak is 360-390px wide (one column of eight plates). Depends on the 400px plate cap in
// travel-inspiration.tsx.
const INSPIRATION_H = '3833px';
const TravelInspiration = dynamic(() => import('@/components/travel-inspiration'), {
  ssr: false,
  loading: () => <SectionSkeleton height={INSPIRATION_H} />,
});

// Custom trips have no guide pages, so their imported places show here. Null on the sample pack.
const CustomTripMyPlaces = dynamic(() => import('@/components/custom-trip-my-places'), { ssr: false });

// Sample-pack-only sections. Wrapped in a component because LazyVisible takes a reference.
function GatedTravelInspiration() {
  return (
    <DefaultTripOnly quiet pending={<SectionSkeleton height={INSPIRATION_H} />}>
      <TravelInspiration />
    </DefaultTripOnly>
  );
}

function GatedHomeChapters() {
  return (
    <DefaultTripOnly quiet pending={<SectionSkeleton height={CHAPTERS_H} />}>
      <HomeChapters />
    </DefaultTripOnly>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* Content first: in-trip agenda and recap sit above the dashboard sections. */}
      {/* Strip and hero share one viewport-tall column; the hero fills what's left so its
          CTA clears the fold down to 320px. Navbar clearance lives here because the strip
          renders null when signed out. */}
      <div className="flex min-h-[calc(100svh-var(--tab-bar-h,64px)-env(safe-area-inset-bottom))] flex-col pt-[var(--nav-h)] md:min-h-[100svh]">
        {/* Reserved on the parent: the island's first real render is null, so reserving
            inside it would still shift. */}
        <div style={{ height: TRIP_STRIP_H }} className="overflow-hidden">
          <LazyVisible component={HomeTripStrip} minHeight={TRIP_STRIP_H} />
        </div>
        <HeroSection />
      </div>
      {/* Null pre-trip. */}
      <TodayPanel />
      {/* Below the hero column, never inside it: inside, it would push the hero CTA below
          the fold (D-311). Same for the journey bar and chapters. */}
      <LazyVisible component={HomeStatRow} minHeight={STAT_ROW_H} />
      <LazyVisible component={HomeSectionNav} minHeight={SECTION_NAV_H} />
      {/* Siblings of the hero, see above. */}
      <LazyVisible component={HomeJourneyBar} minHeight={JOURNEY_H} />
      <TripRecap />
      <LazyVisible component={HomeBento} minHeight={BENTO_H} />
      {/* No # anchor: home-section-nav lists five landmarks. */}
      <LazyVisible component={HomeReadiness} minHeight={READINESS_H} />
      <LazyVisible component={GatedHomeChapters} minHeight={CHAPTERS_H} />
      <LazyVisible component={GatedTravelInspiration} minHeight={INSPIRATION_H} />
      {/* minHeight 0: the sample pack reserves nothing while the gate resolves. */}
      <LazyVisible component={CustomTripMyPlaces} minHeight="0px" />
      <LegacyHashRedirect />
    </main>
  );
}
