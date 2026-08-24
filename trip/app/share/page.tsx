// SHARE-TARGET INBOX: the installed PWA registers as an OS `share_target` (GET,
// `scripts/gen-sw.mjs::buildManifest()`); the Share sheet navigates here with `?title/?text/?url`,
// which the island captures, persists (gateway key 23), and strips. The page then renders the
// triage inbox — assign each shared link to a trip day or delete it. The island is lazy + ssr:false
//, mirroring
// app/packing/sections.tsx. Reached as a companion in `lib/nav-items.ts` (the `/more/` page + the
// desktop "More" menu), the command palette's "Shared Links" entry, the OS Share sheet, or a
// direct URL.
import PageHeader from '@/components/page-header';
import { ShareInbox } from './sections';

export const metadata = {
  title: 'Shared Links · Nepal × Japan Journey',
  description: 'Links and notes shared to the trip planner from your phone, ready to slot into your itinerary — saved on this device.',
};

export default function SharePage() {
  return (
    <main className="min-h-screen bg-surface">
      <PageHeader
        eyebrow="Shared to your trip"
        title="Shared Links"
        description="Links and notes you share from your phone land here. Assign each to a trip day or clear it out. Saved on this device only."
      />
      <ShareInbox />
    </main>
  );
}
