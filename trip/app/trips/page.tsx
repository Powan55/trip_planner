// TRIPS HUB: the first-class create / join / manage surface for the known-trips
// registry — fixes "cannot see create trip button or page". Per the /settings split pattern
// the `ssr:false` dynamic island lives in./sections (a client module) so this
// Server Component page can export per-route metadata; the static header below reuses the /settings
// header tokens verbatim (glass-panel / text-display-lg / text-display-emphasis) and supplies the
// page's <h1>. Nobody without an active traveler reaches this page: TokenGate is the
// unconditional, pathname-free wall — it covers /trips like every route, zero per-route work here.
import { TripsHub } from './sections';

export const metadata = {
  title: 'Trips · Nepal × Japan Journey',
  description:
    'Switch between the trips this browser knows, start a brand-new one with its own shareable key, or join a trip someone shared with you.',
};

export default function TripsPage() {
  return (
    <main className="min-h-screen bg-surface">
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
              Plan together
            </p>
            <h1 className="font-display text-display-lg text-display-emphasis">Trips</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Switch between the trips this browser knows, start a brand-new one with its own
              shareable key, or join a trip someone shared with you.
            </p>
          </div>
        </div>
      </header>
      <TripsHub />
    </main>
  );
}
