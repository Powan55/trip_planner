// TRAVEL SAFETY KIT: an offline, static travel-safety reference — emergency/embassy
// numbers, a romanized phrasebook, and a document checklist (`core/content/safety.ts`,
// static-only). The island is lazy + ssr:false, mirroring app/journal/sections.tsx; Next 15
// the ssr:false dynamic import lives in./sections (a client module); this
// Server Component page exports metadata. It is wired into `lib/nav-items.ts` (a companion, not
// a primary) and the command palette; on a custom trip the nav flag hides it and the
// DefaultTripOnly wrapper below covers the typed-URL path.
import PageHeader from '@/components/page-header';
import DefaultTripOnly from '@/components/default-trip-only';
import PrintButton from '@/components/print-button';
import { SafetyKit } from './sections';

export const metadata = {
  title: 'Travel Safety Kit · Nepal × Japan Journey',
  description: 'Emergency and embassy numbers, a Nepali/Japanese phrasebook, and a document checklist — available offline.',
};

export default function SafetyPage() {
  return (
    <main className="min-h-screen bg-surface">
      <PageHeader
        eyebrow="In case you need it"
        title="Travel Safety Kit"
        description="Emergency and embassy numbers, a Nepali/Japanese phrasebook, and a document checklist — works offline once loaded."
      />
      {/* The kit is N×J content (emergency numbers per country + a Nepali/Japanese phrasebook),
          presented as the ACTIVE trip's safety kit — so a custom trip gets the same honest empty
          state /nepal, /japan, /guides and /flights already give, not another country's 999. */}
      <DefaultTripOnly>
        {/* #223 — this route needs NO print-only twin. Unlike /plan (whose planner shows one day
            at a time), the kit is static, semantic, already-validated content: three sections, a
            real <h2> each, tables with <th scope>, and `lang="ne"`/`lang="ja"` on every native
            script cell. The @media print block in app/globals.css turns it into ink on paper as
            it stands, so what is added here is the way to ASK for it — a phone has no print
            shortcut. Inside DefaultTripOnly on purpose: on a custom trip there is no kit below,
            so there must be no button offering to print one. */}
        <div className="mx-auto flex w-full max-w-4xl justify-end px-gut pb-4 print:hidden">
          <PrintButton label="Print safety sheet" />
        </div>
        <SafetyKit />
      </DefaultTripOnly>
    </main>
  );
}
