import PageHero from '@/components/page-hero';
import MoreList from './more-list';

// MORE: the mobile tab bar's synthetic 5th tab points here. A dedicated
// route (NOT a bottom sheet —: back-button + deep-link + precache + no modal/z-ladder
// cost) that re-homes the long-tail companion routes the 5-tab IA can't fit, grouped, plus the
// mobile home for sign-out. Static (output:'export'): a Server Component with metadata; the
// trip-dependent list is the client `MoreList` island (mount-gated → no hydration mismatch).
export const metadata = {
  title: 'More · Nepal × Japan Journey',
  description: 'Everything else — flights, packing, documents, safety, journal, trips, settings, and sign out.',
};

export default function MorePage() {
  return (
    <main className="min-h-screen bg-surface">
      <PageHero
        variant="plan"
        title="More"
        eyebrow="Everything else"
        subtitle="The rest of your trip tools — flights, packing, documents, journal, and account."
        panelClassName="max-w-[680px]"
      />
      <MoreList />
    </main>
  );
}
