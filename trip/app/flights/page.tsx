import PageHero from '@/components/page-hero';

// FLIGHTS: a dedicated page for the
// flights/hotels booking overview, previously mounted on Home. `flights-section.tsx`
// itself is untouched — only WHERE it's mounted changed.
// (Next 15): the ssr:false FlightsSection island lives in./sections (client
// module); this Server Component page exports metadata./ skeleton kept.
import { FlightsSection } from './sections';

export const metadata = {
  title: 'Flights · Nepal × Japan Journey',
  description: 'Flights and hotel bookings for the Nepal and Japan legs — journeys, booked stays, and what still needs booking.',
};

export default function FlightsPage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* PageHero supplies the page's <h1> ( pages shipped
          without one — a11y win). Section components keep their own <h2>s. */}
      <PageHero
        variant="flights"
        title="Flights"
        eyebrow="Bookings"
        subtitle="Every leg of the journey — flights, layovers, and hotel stays across Nepal and Japan."
      />
      <FlightsSection />
    </main>
  );
}
