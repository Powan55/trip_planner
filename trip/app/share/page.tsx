// SHARE-TARGET INBOX: the installed PWA registers as an OS `share_target` (GET,
// `scripts/gen-sw.mjs::buildManifest()`); the Share sheet navigates here with `?title/?text/?url`,
// which the island captures, persists (gateway key 23), and strips. The page then renders the
// triage inbox — assign each shared link to a trip day or delete it. The island is lazy + ssr:false
//, mirroring
// app/packing/sections.tsx. Reached via a direct URL / the OS Share sheet / the command palette's
// "Shared Links" entry — deliberately NOT wired into `lib/nav-items.ts` / the navbar / tab bar in
// this slice.
import { ShareInbox } from './sections';

export const metadata = {
  title: 'Shared Links · Nepal × Japan Journey',
  description: 'Links and notes shared to the trip planner from your phone, ready to slot into your itinerary — saved on this device.',
};

export default function SharePage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* Local page header — reuses the PageHero design tokens directly (glass-panel /
          text-display-lg / text-gradient-gold / animate-reveal-up) rather than extending
          PageHero's closed `HeroVariant` union. Supplies
          the page's <h1> (mirrors app/packing/page.tsx). */}
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
              Shared to your trip
            </p>
            <h1 className="font-display text-display-lg text-gradient-gold">Shared Links</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Links and notes you share from your phone land here. Assign each to a trip day or
              clear it out. Saved on this device only.
            </p>
          </div>
        </div>
      </header>
      <ShareInbox />
    </main>
  );
}
