import dynamic from 'next/dynamic';

// HOME: hero · trip-dashboard · flights · trip-timeline · travel-essentials,
// plus the legacy hash redirect. Navbar/Footer live in the root layout now. The
// calendar/destination/map sections moved to their own routes (/plan/, /nepal/,
// /japan/, /map/).
const HeroSection = dynamic(() => import('@/components/hero-section'), { ssr: false });
const TripDashboard = dynamic(() => import('@/components/trip-dashboard'), { ssr: false });
const FlightsSection = dynamic(() => import('@/components/flights-section'), { ssr: false });
const TripTimeline = dynamic(() => import('@/components/trip-timeline'), { ssr: false });
const TravelEssentials = dynamic(() => import('@/components/travel-essentials'), { ssr: false });
const LegacyHashRedirect = dynamic(() => import('@/components/legacy-hash-redirect'), { ssr: false });

export default function HomePage() {
  return (
    <main className="min-h-screen bg-navy-900">
      <HeroSection />
      <TripDashboard />
      <FlightsSection />
      <TripTimeline />
      <TravelEssentials />
      <LegacyHashRedirect />
    </main>
  );
}
