// TRAVEL MODE — route SHELL. The chrome-free `/travel` surface every
// later Phase-2 slice mounts into: hero card, agenda, `?date=` picking,
// essentials, legibility toggle, enter/exit affordances. This slice is the SHELL
// ONLY — a TM root container, an <h1>, and an honest placeholder line. No hero card, no
// agenda, no entry button, no exit X, no `?date=` logic.
//
// Chrome-free: the six chrome-islands (navbar/footer/tab-bar/FAB + the two invisible
// event-hosts) each render null under `/travel` via `lib/travel-route.ts` `isTravelRoute()`,
// so this page renders WITHOUT app chrome. It stays a plain static Server Component (no
// client island needed yet — nothing here reads state); later slices add a sibling
// `sections.tsx` client module and mount their ssr:false islands INSIDE `.travel-mode-root`.
//
// Safe-area + iPhone-15-Pro hardening live in the `.travel-mode-root` / `.tm-thumb-zone`
// CSS contracts in app/globals.css.
//
// the Now/Next hero, agenda, and `?date=` picker mount as ONE client island via
// the sibling `sections.tsx`; this page stays a static Server Component.
import { TravelDatePicker, TravelLegibilityToggle, TravelExitButton } from './sections';

export const metadata = {
  title: 'Travel Mode · Nepal × Japan Journey',
  description: 'A focused, chrome-free companion for the day you are travelling.',
};

export default function TravelPage() {
  return (
    <main
      data-testid="travel-mode-root"
      className="travel-mode-root min-h-[100dvh] bg-surface px-gutter"
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
        <h1 className="font-display text-display-lg text-gradient-gold">Travel Mode</h1>
        <div className="flex shrink-0 items-center gap-1">
          {}/* outdoor high-legibility toggle — TM-local, chrome-free header row. */
          <TravelLegibilityToggle />
          {}/* exit X — restores the prior route, no history trap. */
          <TravelExitButton />
        </div>
      </div>
      {}/* date picker (day-strip + preview/pre-trip banners) → hero → agenda. */
      <TravelDatePicker />
      {/* thumb-zone contract: TM primary actions ( enter/exit, later
          quick actions) pin to this fixed bottom band — ≥44×44px targets clear of the
          home indicator via env(safe-area-inset-bottom). Empty this slice (no actions yet);
}          the class exists so later slices drop controls in without re-deriving the offset. */
      <div className="tm-thumb-zone" aria-hidden="true" />
    </main>
  );
}
