// PASSPORT (issue #5): the lifetime country count as a document rather than a number — one
// pressed stamp per country in `core/places/visited.ts`'s lifetime set (key 32, D-314), with the
// stamp landing on the visit that first counts a country.
//
// THE SHEET IS PARCHMENT, and that is a ruled, single-surface exception to dark-only (D-294), not
// a light theme and not the start of one: `forcedTheme="dark"` stays, no toggle exists, and the
// tokens live in one block in app/globals.css beside the recipes that paint them. Every pairing on
// this page is measured in scripts/contrast-tokens.mjs — a light material dropped into a dark app
// takes the chrome's contrast assumptions with it, so the focus ring on the sheet is INK, not the
// app-wide marigold (the harness carries that as a guard that must keep failing).
//
// This Server Component owns the sheet, the <h1> and the empty-state copy so they are all in the
// prerendered HTML; the device-dependent half is the ssr:false island in ./sections.
//
// Reached as a companion in `lib/nav-items.ts` (the `/more/` page + the desktop "More" menu), the
// command palette, or a direct URL. That catalog is pinned by `lib/__tests__/nav-items.test.ts`
// down to the exact label list, so moving this entry fails there.
import { Reveal } from '@/components/reveal';
import { PassportStamps } from './sections';

export const metadata = {
  title: 'Passport · Nepal × Japan Journey',
  description:
    'Every country you have been to, stamped into one page — a lifetime record kept on this device.',
};

export default function PassportPage() {
  return (
    <main className="min-h-screen bg-surface">
      <div className="px-gutter pb-16 pt-24 sm:pt-28">
        {/* The one entrance on this surface. `<Reveal>` is the canonical one and asks
            `entranceFor()` for the decision, so the tier gate, the once-per-session ledger
            and prefers-reduced-motion are all honoured without a second opinion here. */}
        <Reveal className="mx-auto max-w-[880px]">
          <section className="passport-page" aria-labelledby="passport-title">
            <div className="passport-page__body">
              <p
                className="text-eyebrow uppercase"
                style={{ color: 'var(--paper-lo)' }}
              >
                Lifetime record
              </p>
              <h1
                id="passport-title"
                className="font-display text-editorial-lg mt-2"
              >
                Passport
              </h1>
              <p
                className="mt-3 max-w-lg text-sm leading-relaxed sm:text-base"
                style={{ color: 'var(--paper-lo)' }}
              >
                One stamp for every country you have set foot in. Trip days stamp themselves as
                they arrive, and the record stays on this device.
              </p>
              <PassportStamps />
            </div>
          </section>
        </Reveal>
      </div>
    </main>
  );
}
