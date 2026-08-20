// PROFILE: the traveller's own record, as opposed to the trip's (issue #4). Today it holds one
// thing — the countries and cities visited BEFORE this trip — because that is the half the app
// could not otherwise know: the trip contributes its own places automatically
// (`lib/visit-autocount.ts`), and everything earlier in a life has to be typed in once.
//
// Route is `/profile` and NOT `/passport`: the passport page (issue #5) is the display surface for
// the same store, a stamp per country. This is where the data is entered and corrected. Two
// surfaces, one store (`core/places/visited.ts`, gateway key 32, D-314), and it is deliberately not
// part of `/settings` — a lifetime travel record is not a device setting, and it survives the
// teardowns that page offers.
//
// The display NAME is not edited here, deliberately: it is an attribute of the account with a
// remote reconciler behind it (D-277), and it already has exactly one write path, in Settings.
// A second name field on this page would be a second writer for a remote-wins document.
//
// The island is lazy + ssr:false (app/settings/sections.tsx's shape); this Server Component page
// exports the metadata and owns the <h1>.
import PageHeader from '@/components/page-header';
import { VisitedPlaces } from './sections';

export const metadata = {
  title: 'Profile · Nepal × Japan Journey',
  description:
    'The countries and cities you had already been to before this trip, so your travel totals count a lifetime rather than one holiday. Stored on this device.',
};

export default function ProfilePage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* `reveal={false}` preserves what this route actually ships: it is the ONE of the eight
          that never carried `animate-reveal-up`, dropped when the page was written (ac66787)
          even though its own comment claimed to mirror /settings. Restoring the entrance is a
          visual change and therefore not this refactor's call — it is a one-prop deletion when
          someone decides to make it. */}
      <PageHeader
        eyebrow="Where you have been"
        title="Profile"
        description="Add the countries and cities you had already been to before this trip, so your totals count a lifetime of travel and not just this one journey. Everything here is kept on this device and survives clearing a trip or signing out."
        reveal={false}
      />
      <VisitedPlaces />
    </main>
  );
}
