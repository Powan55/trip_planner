// SETTINGS: a grouped, progressively-disclosed settings page — identity/sign-out,
// currency + rate overrides (relocated from budget-panel), and data management (export/import +
// per-domain clears). The island is lazy + ssr:false, mirroring app/journal/sections.tsx; the
// ssr:false dynamic import lives in ./sections (a client module); this Server
// Component page exports metadata. Reached via the companion nav (mobile hamburger + command
// palette) or a direct URL.
import { Settings } from './sections';

export const metadata = {
  title: 'Settings · Nepal × Japan Journey',
  description:
    'Manage your traveler identity, display currency and exchange rates, and back up, restore, or clear your on-device trip data.',
};

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-navy-900">
      {/* Local page header — reuses the PageHero design tokens (glass-panel / text-display-lg /
          text-gradient-gold / animate-reveal-up) directly rather than extending PageHero's closed
          `HeroVariant` union, following the /journal and /safety precedent. Supplies the page's <h1>. */}
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
              Your trip, your way
            </p>
            <h1 className="font-display text-display-lg text-gradient-gold">Settings</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Manage who your edits are attributed to, choose your display currency and exchange
              rates, and back up, restore, or clear your on-device trip data.
            </p>
          </div>
        </div>
      </header>
      <Settings />
    </main>
  );
}
