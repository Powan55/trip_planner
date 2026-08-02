import Link from 'next/link';
import { Mountain, Compass, Camera, Wine, BookOpen, ArrowRight } from 'lucide-react';
import PageHero from '@/components/page-hero';
import DefaultTripOnly from '@/components/default-trip-only';

// GUIDES: the mobile "Guides" tab and desktop primary both point here.
// A static chooser landing that fronts the two country guides (Nepal/Japan — their pages
// and routes stay,) as cards, each surfacing the shared photography/nightlife/
// essentials entry points (section anchors that exist on both country pages). Fully static
// (output:'export') — a Server Component with metadata; the only client piece is
// DefaultTripOnly (an N×J gate that shows an honest empty-state on a custom trip).
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

const COUNTRIES = [
  {
    href: '/nepal/',
    name: 'Nepal',
    dates: 'Dec 9 – 18',
    blurb: 'Kathmandu Valley — temples, markets, mountain light, and momo-fueled nights.',
    icon: Mountain,
    titleGradient: 'text-gradient-himalaya',
    wash: 'radial-gradient(120% 140% at 0% 0%, rgba(255,140,66,0.16) 0%, transparent 60%)',
  },
  {
    href: '/japan/',
    name: 'Japan',
    dates: 'Dec 19 – Jan 9',
    blurb: 'Neon cities to snow country — shrines, izakayas, ramen, and winter calm.',
    icon: Compass,
    titleGradient: 'text-gradient-sakura',
    wash: 'radial-gradient(120% 140% at 0% 0%, rgba(247,160,179,0.16) 0%, transparent 60%)',
  },
] as const;

export default function GuidesPage() {
  return (
    <main className="min-h-screen bg-surface">
      <PageHero
        variant="plan"
        title="Guides"
        eyebrow="Two countries, one trip"
        subtitle="Pick a destination for photography spots, nightlife, local foods, and the on-the-ground essentials."
      />

      <DefaultTripOnly>
        <div className="mx-auto max-w-[1200px] px-4 pb-20 sm:px-6">
          <div className="grid gap-6 sm:grid-cols-2">
            {COUNTRIES.map((c) => {
              const Icon = c.icon;
              return (
                <section
                  key={c.href}
                  data-testid={`guides-country-${c.name.toLowerCase()}`}
                  className="glass-panel relative overflow-hidden rounded-2xl p-6 sm:p-8"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0"
                    style={{ background: c.wash }}
                  />
                  <div className="relative">
                    <Link
                      href={c.href}
                      className="group inline-flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                        <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                      </span>
                      <span>
                        <span className="block text-eyebrow uppercase text-white/70">{c.dates}</span>
                        <span className={`font-display text-3xl font-bold ${c.titleGradient}`}>
                          {c.name}
                        </span>
                      </span>
                      <ArrowRight
                        className="ml-1 h-5 w-5 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-white/70"
                        aria-hidden="true"
                      />
                    </Link>

                    <p className="mt-4 max-w-md text-sm leading-relaxed text-white/70">{c.blurb}</p>

                    {/* Shared entry points → the section anchors on this country's page. */}
                    <ul className="mt-6 flex flex-wrap gap-2">
                      {ENTRY_POINTS.map((e) => {
                        const EIcon = e.icon;
                        return (
                          <li key={e.label}>
                            <Link
                              href={`${c.href}${e.hash}`}
                              data-testid={`guides-${c.name.toLowerCase()}-${e.label.toLowerCase()}`}
                              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white/80 outline-none transition-colors hover:border-white/20 hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                              <EIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              {e.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </DefaultTripOnly>
    </main>
  );
}
