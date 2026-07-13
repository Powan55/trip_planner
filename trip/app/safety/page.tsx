// TRAVEL SAFETY KIT: an offline, static travel-safety reference — emergency/embassy
// numbers, a romanized phrasebook, and a document checklist (`core/content/safety.ts`,
// static-only, no persistence needed). The island is lazy + ssr:false, mirroring
// app/journal/sections.tsx; the ssr:false dynamic import lives in ./sections (a client
// module); this Server Component page exports metadata. Reached via a direct URL only
// for now — deliberately not wired into `lib/nav-items.ts` / the navbar / tab bar /
// command palette, left as a deliberate follow-up, same deferral as `/journal`.
import { SafetyKit } from './sections';

export const metadata = {
  title: 'Travel Safety Kit · Nepal × Japan Journey',
  description: 'Emergency and embassy numbers, a Nepali/Japanese phrasebook, and a document checklist — available offline.',
};

export default function SafetyPage() {
  return (
    <main className="min-h-screen bg-navy-900">
      {/* Local page header — reuses the PageHero design tokens (glass-panel / text-display-lg /
          text-gradient-gold / animate-reveal-up) directly rather than extending PageHero's
          closed `HeroVariant` union (page-hero.tsx is deliberately not extended).
          Supplies the page's <h1> (mirrors the PageHero convention / app/journal/page.tsx). */}
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
              In case you need it
            </p>
            <h1 className="font-display text-display-lg text-gradient-gold">Travel Safety Kit</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Emergency and embassy numbers, a Nepali/Japanese phrasebook, and a document
              checklist — works offline once loaded.
            </p>
          </div>
        </div>
      </header>
      <SafetyKit />
    </main>
  );
}
