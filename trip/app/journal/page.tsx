// JOURNAL BROWSE: the journal is localStorage-only — the island is lazy +
// ssr:false, mirroring BudgetPanel/BackupRestore on `/plan`. Next 15: the
// ssr:false dynamic import lives in./sections (a client module); this Server Component page
// exports metadata. Reached as a companion in `lib/nav-items.ts` (the `/more/` page + the desktop
// "More" menu, plus a tab-bar seat on a custom trip — it is the one `customPrimary`), the command
// palette, the "View all entries" link on `journal-card.tsx`, or a direct URL.
import PageHero from '@/components/page-hero';
import { JournalBrowse } from './sections';

export const metadata = {
  title: 'Journal · Nepal × Japan Journey',
  description: 'Every trip day, in your own words — browse and edit your private, on-device journal entries.',
};

export default function JournalPage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* The hand-rolled copy of the old glass masthead is GONE, and that is the point:
          it existed only because `HeroVariant` was fenced to four routes at the time.
          /journal is a Tier-2 route, it gets the photographic band like its five
          siblings, and one header implementation is what stops the next design change
          having to be made twice. Same <h1>, eyebrow and subtitle text as before. */}
      <PageHero
        variant="journal"
        title="Journal"
        eyebrow="Every day, in your words"
        subtitle="Browse and edit every trip-day entry you've written — private, on this device only."
        bandClassName="max-w-3xl"
      />
      <JournalBrowse />
    </main>
  );
}
