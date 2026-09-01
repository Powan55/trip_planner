// DOCUMENTS & READINESS CHECKLIST: a critical-documents checklist (passport / visa /
// insurance / tickets / vaccination / cards …) plus a day-zero readiness section (pre-departure),
// `core/docs/model.ts`, persisted via the gateway (key 25) AND synced across travelers (
// `lib/docs-remote.ts`). Route is `/checklist` (NOT `/docs` — that collides conceptually with the
// repo's `docs/` folder and reads like developer docs; `/checklist` is unambiguous and the page IS a
// checklist). NOT the same as the PACKING checklist (`/packing`, clothing/gear) — this is
// DOCUMENTS + departure readiness. The island is lazy + ssr:false, mirroring app/packing/sections.tsx;
// this Server Component page exports metadata. Reached via a direct URL or the command palette's
// "Documents" entry.
import PageHeader from '@/components/page-header';
import { DocsChecklist, PreflightChecks } from './sections';

export const metadata = {
  title: 'Documents & Readiness · Nepal × Japan Journey',
  description:
    'Critical travel documents and a day-zero readiness checklist for the Nepal and Japan trip — check off as you go, saved on this device and synced across your travelers.',
};

export default function ChecklistPage() {
  return (
    <main className="min-h-screen bg-surface">
      <PageHeader
        eyebrow="Before you fly"
        title="Documents & Readiness"
        description="Your critical travel documents and day-zero departure checklist — tick each one off as it's handled. Saved on this device and synced across your travelers."
        className="max-w-3xl"
      />
      <DocsChecklist />
      {/* #20 — the machine-checked half of "am I ready?", below the human-attested list it
          complements (same page, same moment: the evening before flying). */}
      <PreflightChecks />
    </main>
  );
}
