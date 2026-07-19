// DOCUMENTS & READINESS CHECKLIST: a critical-documents checklist (passport / visa /
// insurance / tickets / vaccination / cards …) plus a day-zero readiness section (pre-departure),
// `core/docs/model.ts`, persisted via the gateway (key 25) AND synced across travelers (
// `lib/docs-remote.ts`). Route is `/checklist` (NOT `/docs` — that collides conceptually with the
// repo's `docs/` folder and reads like developer docs; `/checklist` is unambiguous and the page IS a
// checklist). NOT the same as the PACKING checklist (`/packing`, clothing/gear) — this is
// DOCUMENTS + departure readiness. The island is lazy + ssr:false, mirroring app/packing/sections.tsx;
// this Server Component page exports metadata. Reached via a direct URL or the command palette's
// "Documents" entry.
import { DocsChecklist } from './sections';

export const metadata = {
  title: 'Documents & Readiness · Nepal × Japan Journey',
  description:
    'Critical travel documents and a day-zero readiness checklist for the Nepal and Japan trip — check off as you go, saved on this device and synced across your travelers.',
};

export default function ChecklistPage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* Local page header — reuses the PageHero design tokens directly rather than extending
          page-hero.tsx's closed variant union. Supplies the page's <h1>
          (mirrors app/packing/page.tsx). */}
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
              Before you fly
            </p>
            <h1 className="font-display text-display-lg text-gradient-gold">Documents &amp; Readiness</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Your critical travel documents and day-zero departure checklist — tick each one off as
              it&apos;s handled. Saved on this device and synced across your travelers.
            </p>
          </div>
        </div>
      </header>
      <DocsChecklist />
    </main>
  );
}
