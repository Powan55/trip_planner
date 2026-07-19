// PACKING CHECKLIST: a country-specific packing checklist (Nepal-leg / Japan-leg /
// universal items, `core/packing/model.ts`), persisted via the gateway (key 21) so check-off
// state survives reload. NOT the same thing as the-candidate critical-docs checklist
// (passport/visa/insurance) — this is packing ITEMS (clothing/gear/toiletries). The island is
// lazy + ssr:false, mirroring app/journal/sections.tsx; Next 15: the ssr:false
// dynamic import lives in./sections (a client module); this Server Component page exports
// metadata. Reached via a direct URL or the command palette's "Packing" entry —
// deliberately NOT wired into `lib/nav-items.ts` / the navbar / tab bar in this slice (those
// files are fenced — a follow-up rider, same historical pattern as).
import { PackingChecklist } from './sections';

export const metadata = {
  title: 'Packing Checklist · Nepal × Japan Journey',
  description: 'Country-specific packing checklist for the Nepal and Japan legs — check off items as you pack, saved on this device.',
};

export default function PackingPage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* Local page header — reuses the PageHero design tokens (glass-panel / text-display-lg /
          text-gradient-gold / animate-reveal-up) directly rather than extending PageHero's
          closed `HeroVariant` union (fenced per the precedent: "do not extend
          page-hero.tsx"). Supplies the page's <h1> (mirrors app/journal/page.tsx). */}
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
              Two legs, one bag
            </p>
            <h1 className="font-display text-display-lg text-gradient-gold">Packing Checklist</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Nepal-leg, Japan-leg, and universal items — check them off as you pack. Saved on
              this device only.
            </p>
          </div>
        </div>
      </header>
      <PackingChecklist />
    </main>
  );
}
