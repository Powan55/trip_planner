import Link from 'next/link';
import { Camera, Wine, BookOpen, ArrowRight } from 'lucide-react';
import PageHero from '@/components/page-hero';
import DefaultTripOnly from '@/components/default-trip-only';
import OptimizedImage from '@/components/optimized-image';

// GUIDES: the mobile "Guides" tab and desktop primary both point here.
// A static chooser landing that fronts the two country guides (Nepal/Japan — their pages
// and routes stay,) as cards, each surfacing the shared photography/nightlife/
// essentials entry points (section anchors that exist on both country pages). Fully static
// (output:'export') — a Server Component with metadata; the only client pieces are
// DefaultTripOnly (an N×J gate that shows an honest empty-state on a custom trip) and
// OptimizedImage.
export const metadata = {
  title: 'Guides · Nepal × Japan Journey',
  description:
    'Choose a destination guide — the Kathmandu Valley (Nepal) or Japan — for photography spots, nightlife, local foods, and cultural essentials.',
};

// Section anchors that BOTH country pages own (see photography-guide.tsx #photography,
// nightlife-section.tsx #nightlife, country-essentials.tsx #essentials). Rendered as
// per-country quick links so each entry point is unambiguous.
const ENTRY_POINTS = [
  { label: 'Photography', hash: '#photography', icon: Camera },
  { label: 'Nightlife', hash: '#nightlife', icon: Wine },
  { label: 'Essentials', hash: '#essentials', icon: BookOpen },
] as const;

// Country identity is the `--now` leg channel resolved from `data-leg` and screened at the
// --now-screen ceiling, so a ramp or channel change reaches this page on its own.
//
// Both photographs already ship and are already precached; neither is added here.
// Every printed figure is a real fact: the day counts are the inclusive spans of the
// dates beside them, and the plate captions name places the trip actually visits.
const COUNTRIES = [
  {
    href: '/nepal/',
    leg: 'nepal',
    name: 'Nepal',
    dates: 'Dec 9 – 18',
    days: 10,
    blurb: 'Kathmandu Valley — temples, markets, mountain light, and momo-fueled nights.',
    image: '/images/featured/boudhanath.jpg',
    alt: 'The whitewashed dome and gilded spire of Boudhanath Stupa under an overcast Kathmandu sky.',
    plate: 'Plate I',
    subject: 'Boudhanath Stupa',
    region: 'Kathmandu Valley',
  },
  {
    href: '/japan/',
    leg: 'japan',
    name: 'Japan',
    dates: 'Dec 19 – Jan 9',
    days: 22,
    blurb: 'Neon cities to snow country — shrines, izakayas, ramen, and winter calm.',
    image: '/images/featured/arashiyama.jpg',
    alt: 'Tall bamboo stems crowding a narrow walking path through the Arashiyama grove, Kyoto.',
    plate: 'Plate II',
    subject: 'Arashiyama Grove',
    region: 'Kyoto',
  },
] as const;

// The screened country field. Declared as a `background` shorthand so an engine without
// color-mix drops it whole and inherits the flat `bg-surface-raised` underneath — which is
// the same fallback order globals.css uses for `.dens`.
const SCREEN = {
  background: 'color-mix(in srgb, var(--now) var(--now-screen), rgb(var(--surface-raised)))',
} as const;

export default function GuidesPage() {
  return (
    <main className="min-h-screen bg-surface">
      <PageHero
        variant="guides"
        title="Guides"
        eyebrow="Two countries, one trip"
        subtitle="Pick a destination for photography spots, nightlife, local foods, and the on-the-ground essentials."
      />

      <DefaultTripOnly>
        <div className="mx-auto max-w-[1200px] px-4 pb-20 sm:px-6">
          <div className="grid gap-6 sm:grid-cols-2">
            {COUNTRIES.map((c, i) => (
              <section
                key={c.href}
                data-leg={c.leg}
                data-testid={`guides-country-${c.name.toLowerCase()}`}
                className="plate plate--wide overflow-hidden rounded-r1 border-hair border-[color:hsl(var(--border))]"
              >
                {/* The plate recipe is 3/4 below 700px, which on a phone puts the second
                    country entirely below the fold. This screen is a two-option choice, so
                    the frame is landscape at every width and both options stay comparable;
                    the row split switches at 700 with it. `plate--wide` on the section is
                    what carries that — the `aspect-[16/10] min-[700px]:aspect-[21/9]` that
                    used to sit here was (0,1,0) under a (0,2,0) recipe and never painted. */}
                <div className="frame">
                  <div className="fig">
                    <OptimizedImage
                      src={c.image}
                      alt={c.alt}
                      fill
                      sizes="(min-width: 640px) 50vw, 100vw"
                      fallback={
                        <div className="h-full w-full bg-surface-raised" style={SCREEN} />
                      }
                    />
                  </div>
                  <div className="ramp" />
                  <div className="lay">
                    <span className="pr text-now">
                      Leg {i + 1} · {c.dates}
                    </span>
                    {/* min-h-tap, not a hand-rolled height: the 44px floor used to ride on an
                        h-11 icon box that v7 dropped with the icon, leaving a 29.8px target on
                        the only route into the country guides from this screen (#363). */}
                    <Link
                      href={c.href}
                      className="group mt-1 inline-flex min-h-tap items-center gap-2 rounded-r1 outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="font-machine text-n-md font-semibold leading-none tracking-tight text-ink-hi">
                        {c.name}
                      </span>
                      <ArrowRight
                        className="h-4 w-4 text-ink-lo transition-transform group-hover:translate-x-0.5 group-hover:text-ink-mid"
                        aria-hidden="true"
                      />
                    </Link>
                  </div>
                </div>

                {/* The caption is a ruled line BENEATH the plate, never over it. */}
                <div className="capline">
                  <span className="pr pr--lo">{c.plate}</span>
                  <span className="pr">{c.subject}</span>
                  <span className="pr pr--lo">{c.region}</span>
                  <span className="pr pr--lo">
                    <span className="num">{c.days}</span> days
                  </span>
                </div>

                {/* The screened country field. No second wash sits on top of it: at the
                    14% ceiling `--text-lo` measures 4.60 post-grain on the Japan channel,
                    which is the tightest passing pair in the system. */}
                <div className="p-gut pb-4" style={SCREEN}>
                  <p className="max-w-md text-t-body leading-relaxed text-ink-mid">{c.blurb}</p>

                  {/* Shared entry points → the section anchors on this country's page. */}
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {ENTRY_POINTS.map((e) => {
                      const EIcon = e.icon;
                      return (
                        <li key={e.label}>
                          <Link
                            href={`${c.href}${e.hash}`}
                            data-testid={`guides-${c.name.toLowerCase()}-${e.label.toLowerCase()}`}
                            className="chip min-h-tap px-2.5 text-ink-mid outline-none transition-colors hover:border-[color:var(--text-hi)] hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <EIcon className="h-3.5 w-3.5" aria-hidden="true" />
                            {e.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>
            ))}
          </div>
        </div>
      </DefaultTripOnly>
    </main>
  );
}
