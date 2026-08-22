// TRAVEL SAFETY KIT: an offline, static travel-safety reference — emergency/embassy
// numbers, a romanized phrasebook, and a document checklist (`core/content/safety.ts`,
// static-only). The island is lazy + ssr:false, mirroring app/journal/sections.tsx; Next 15
// the ssr:false dynamic import lives in./sections (a client module); this
// Server Component page exports metadata. It is wired into `lib/nav-items.ts` (a companion, not
// a primary) and the command palette; on a custom trip the nav flag hides it and the
// DefaultTripOnly wrapper below covers the typed-URL path.
import PageHeader from '@/components/page-header';
import DefaultTripOnly from '@/components/default-trip-only';
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
        <SafetyKit />
      </DefaultTripOnly>
    </main>
  );
}
