// TRAVEL SAFETY KIT: an offline, static travel-safety reference — emergency/embassy
// numbers, a romanized phrasebook, and a document checklist (`core/content/safety.ts`,
// static-only). The island is lazy + ssr:false, mirroring app/journal/sections.tsx; Next 15
// the ssr:false dynamic import lives in./sections (a client module); this
// Server Component page exports metadata. Reached via a direct URL only this change —
// deliberately NOT wired into `lib/nav-items.ts` / the navbar / tab bar / command palette
// (those files are fenced — deferred follow-up, by design; same deferral as `/journal`).
import PageHeader from '@/components/page-header';
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
      <SafetyKit />
    </main>
  );
}
