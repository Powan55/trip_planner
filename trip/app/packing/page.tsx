// PACKING CHECKLIST: a country-specific packing checklist (Nepal-leg / Japan-leg /
// universal items, `core/packing/model.ts`), persisted via the gateway (key 21) so check-off
// state survives reload. NOT the same thing as the-candidate critical-docs checklist
// (passport/visa/insurance) — this is packing ITEMS (clothing/gear/toiletries). The island is
// lazy + ssr:false, mirroring app/journal/sections.tsx; Next 15: the ssr:false
// dynamic import lives in./sections (a client module); this Server Component page exports
// metadata. Reached via a direct URL or the command palette's "Packing" entry —
// deliberately NOT wired into `lib/nav-items.ts` / the navbar / tab bar in this change (those
// files are fenced — a follow-up rider, same historical pattern as).
import PageHeader from '@/components/page-header';
import { PackingChecklist } from './sections';

export const metadata = {
  title: 'Packing Checklist · Nepal × Japan Journey',
  description: 'Country-specific packing checklist for the Nepal and Japan legs — check off items as you pack, saved on this device.',
};

export default function PackingPage() {
  return (
    <main className="min-h-screen bg-surface">
      <PageHeader
        eyebrow="Two legs, one bag"
        title="Packing Checklist"
        description="Nepal-leg, Japan-leg, and universal items — check them off as you pack. Saved on this device only."
      />
      <PackingChecklist />
    </main>
  );
}
