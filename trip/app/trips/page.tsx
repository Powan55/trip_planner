// TRIPS HUB: the first-class create / join / manage surface for the known-trips
// registry — fixes "cannot see create trip button or page". Per the /settings split pattern
// the `ssr:false` dynamic island lives in./sections (a client module) so this
// Server Component page can export per-route metadata; the masthead is the shared
// `components/page-header.tsx` and supplies the page's <h1>. Nobody without an active traveler
// reaches this page: TokenGate is the unconditional, pathname-free wall — it covers /trips like
// every route, zero per-route work here.
import PageHeader from '@/components/page-header';
import { TripsHub } from './sections';

export const metadata = {
  title: 'Trips · Nepal × Japan Journey',
  description:
    'Switch between the trips this browser knows, start a brand-new one with its own shareable key, or join a trip someone shared with you.',
};

export default function TripsPage() {
  return (
    <main className="min-h-screen bg-surface">
      <PageHeader
        eyebrow="Plan together"
        title="Trips"
        description="Switch between the trips this browser knows, start a brand-new one with its own shareable key, or join a trip someone shared with you."
      />
      <TripsHub />
    </main>
  );
}
