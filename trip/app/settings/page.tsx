// SETTINGS: a grouped, progressively-disclosed settings page — identity/sign-out,
// currency + rate overrides (relocated from budget-panel), and data management (export/import +
// per-domain clears). The island is lazy + ssr:false, mirroring app/journal/sections.tsx; Next 15
// the ssr:false dynamic import lives in./sections (a client module); this Server
// Component page exports metadata. Reached via the companion nav (mobile hamburger + command
// palette, split) or a direct URL.
import { Settings } from './sections';

export const metadata = {
  title: 'Settings · Nepal × Japan Journey',
  description:
    'Manage your traveler identity, display currency and exchange rates, and back up, restore, or clear your on-device trip data.',
};

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* Local page header — reuses the PageHero design tokens (glass-panel / text-display-lg /
          text-display-emphasis / animate-reveal-up) directly rather than extending PageHero's closed
          `HeroVariant` union. Supplies the page's <h1>. */}
      <header className="px-gutter pt-24 pb-8 sm:pt-28 sm:pb-10">
        <div className="glass-panel animate-reveal-up relative mx-auto max-w-[1200px] overflow-hidden px-6 py-8 sm:px-10 sm:py-12">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'var(--hero-wash)',
            }}
          />
          <div className="relative">
            <p className="text-eyebrow mb-3 uppercase" style={{ color: 'hsl(var(--accent-scroll))' }}>
              Your trip, your way
            </p>
            {/* `id` is the target of settings-panel.tsx's `aria-labelledby="settings-title"`,
                which pointed at nothing — that <section> had no accessible name at all. */}
            <h1 id="settings-title" className="font-display text-display-lg text-display-emphasis">
              Settings
            </h1>
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
