// PROFILE: the traveller's own record, as opposed to the trip's (issue #4). Today it holds one
// thing — the countries and cities visited BEFORE this trip — because that is the half the app
// could not otherwise know: the trip contributes its own places automatically
// (`lib/visit-autocount.ts`), and everything earlier in a life has to be typed in once.
//
// Route is `/profile` and NOT `/passport`: the passport page (issue #5) is the display surface for
// the same store, a stamp per country. This is where the data is entered and corrected. Two
// surfaces, one store (`core/places/visited.ts`, gateway key 32, D-314), and it is deliberately not
// part of `/settings` — a lifetime travel record is not a device setting, and it survives the
// teardowns that page offers.
//
// The display NAME is not edited here, deliberately: it is an attribute of the account with a
// remote reconciler behind it (D-277), and it already has exactly one write path, in Settings.
// A second name field on this page would be a second writer for a remote-wins document.
//
// The island is lazy + ssr:false (app/settings/sections.tsx's shape); this Server Component page
// exports the metadata and owns the <h1>.
import { VisitedPlaces } from './sections';

export const metadata = {
  title: 'Profile · Nepal × Japan Journey',
  description:
    'The countries and cities you had already been to before this trip, so your travel totals count a lifetime rather than one holiday. Stored on this device.',
};

export default function ProfilePage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* Local page header — reuses the PageHero design tokens directly rather than extending
          page-hero.tsx's closed variant union (mirrors app/settings/page.tsx). Supplies the <h1>. */}
      <header className="px-gutter pt-24 pb-8 sm:pt-28 sm:pb-10">
        <div className="glass-panel relative mx-auto max-w-[1200px] overflow-hidden px-6 py-8 sm:px-10 sm:py-12">
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
              Where you have been
            </p>
            <h1 className="font-display text-display-lg text-display-emphasis">Profile</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Add the countries and cities you had already been to before this trip, so your totals
              count a lifetime of travel and not just this one journey. Everything here is kept on
              this device and survives clearing a trip or signing out.
            </p>
          </div>
        </div>
      </header>
      <VisitedPlaces />
    </main>
  );
}
