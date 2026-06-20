import dynamic from 'next/dynamic';

const Navbar = dynamic(() => import('@/components/navbar'), { ssr: false });
const HeroSection = dynamic(() => import('@/components/hero-section'), { ssr: false });
const TripDashboard = dynamic(() => import('@/components/trip-dashboard'), { ssr: false });
const TripTimeline = dynamic(() => import('@/components/trip-timeline'), { ssr: false });
const CalendarPlanner = dynamic(() => import('@/components/calendar-planner'), { ssr: false });
const NepalSection = dynamic(() => import('@/components/nepal-section'), { ssr: false });
const JapanSection = dynamic(() => import('@/components/japan-section'), { ssr: false });
const PhotographyGuide = dynamic(() => import('@/components/photography-guide'), { ssr: false });
const NightlifeSection = dynamic(() => import('@/components/nightlife-section'), { ssr: false });
const MapSection = dynamic(() => import('@/components/map-section'), { ssr: false });
const TravelInspiration = dynamic(() => import('@/components/travel-inspiration'), { ssr: false });
const Footer = dynamic(() => import('@/components/footer'), { ssr: false });

export default function HomePage() {
  return (
    <main className="min-h-screen bg-navy-900">
      <Navbar />
      <HeroSection />
      <TripDashboard />
      <TripTimeline />
      <CalendarPlanner />
      <NepalSection />
      <JapanSection />
      <PhotographyGuide />
      <NightlifeSection />
      <MapSection />
      <TravelInspiration />
      <Footer />
    </main>
  );
}
