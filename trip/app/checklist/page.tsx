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
import QuickAddButton from '@/components/quick-add-button';
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

      {/* #381/#391 — the quick-add FAB is route-suppressed here now (it was measured covering
          "Add photo"), so adding lives in the page instead of floating over it. Last, because
          the two lists above are what this route is for; same max-w-3xl/px-gut column they use
          so the left edge lines up. */}
      <section
        aria-labelledby="checklist-add-heading"
        className="mx-auto w-full max-w-3xl px-gut pb-20"
      >
        <div className="border-t border-[color:hsl(var(--border))] pt-8">
          <h2 id="checklist-add-heading" className="font-machine text-n-sm font-semibold uppercase tracking-[0.06em] text-[color:var(--text-hi)]">
            Something else to handle?
          </h2>
          <p className="mt-2 max-w-md text-t-body leading-relaxed text-ink-mid">
            Put an errand or an appointment on the itinerary — it lands on today if you&apos;re
            mid-trip, and on the day you last had open otherwise.
          </p>
          <div className="mt-4">
            <QuickAddButton />
          </div>
        </div>
      </section>
    </main>
  );
}
