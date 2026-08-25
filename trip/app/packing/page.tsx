// PACKING CHECKLIST: a country-specific packing checklist (Nepal-leg / Japan-leg /
// universal items, `core/packing/model.ts`; universal items only on a custom trip, see
// `core/packing/storage.ts`), persisted via the gateway (key 21) so check-off
// state survives reload. NOT the same thing as the critical-docs checklist on /checklist
// (passport/visa/insurance) — this is packing ITEMS (clothing/gear/toiletries). The island is
// lazy + ssr:false, mirroring app/journal/sections.tsx; Next 15: the ssr:false
// dynamic import lives in./sections (a client module); this Server Component page exports
// metadata. Reached as a companion in `lib/nav-items.ts` (the `/more/` page + the desktop "More"
// menu), the command palette's "Packing" entry, or a direct URL. The masthead is a client
// component because its copy is trip-aware (#240) and this page is statically exported.
import PackingHeader from '@/components/packing-header';
import { PackingChecklist } from './sections';

export const metadata = {
  title: 'Packing Checklist · Nepal × Japan Journey',
  description: 'Country-specific packing checklist for the Nepal and Japan legs — check off items as you pack, saved on this device.',
};

export default function PackingPage() {
  return (
    <main className="min-h-screen bg-surface">
      <PackingHeader />
      <PackingChecklist />
    </main>
  );
}
