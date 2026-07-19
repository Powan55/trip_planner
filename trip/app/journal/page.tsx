// JOURNAL BROWSE: the journal is localStorage-only — the island is lazy +
// ssr:false, mirroring BudgetPanel/BackupRestore on `/plan`. Next 15: the
// ssr:false dynamic import lives in./sections (a client module); this Server Component page
// exports metadata. Reached via a direct URL or the "View all entries" link on
// `journal-card.tsx`; deliberately NOT wired into `lib/nav-items.ts` / the navbar / tab bar /
// command palette in this slice (those files are fenced — a follow-up rider, per the brief).
import { JournalBrowse } from './sections';

export const metadata = {
  title: 'Journal · Nepal × Japan Journey',
  description: 'Every trip day, in your own words — browse and edit your private, on-device journal entries.',
};

export default function JournalPage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* Local page header — reuses the PageHero design tokens (glass-panel / text-display-lg /
          text-gradient-gold / animate-reveal-up) directly rather than extending PageHero's
          closed `HeroVariant` union (`app/plan/`, `/nepal/`, `/japan/`, `/map/` only — fenced
          per the brief: "do not extend page-hero.tsx"). Supplies the page's <h1> (mirrors
}          the PageHero convention — a route without its own <h1> gets one here). */
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
              Every day, in your words
            </p>
            <h1 className="font-display text-display-lg text-gradient-gold">Journal</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Browse and edit every trip-day entry you've written — private, on this device only.
            </p>
          </div>
        </div>
      </header>
      <JournalBrowse />
    </main>
  );
}
