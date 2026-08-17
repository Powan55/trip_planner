// SETTINGS: a grouped, progressively-disclosed settings page — identity/sign-out,
// currency + rate overrides (relocated from budget-panel), and data management (export/import +
// per-domain clears). The island is lazy + ssr:false, mirroring app/journal/sections.tsx; Next 15
// the ssr:false dynamic import lives in./sections (a client module); this Server
// Component page exports metadata. Reached via the companion nav (mobile hamburger + command
// palette, split) or a direct URL.
import PageHeader from '@/components/page-header';
import { Settings } from './sections';

export const metadata = {
  title: 'Settings · Nepal × Japan Journey',
  description:
    'Manage your traveler identity, display currency and exchange rates, and back up, restore, or clear your on-device trip data.',
};

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-surface">
      {/* `titleId` is the target of settings-panel.tsx's `aria-labelledby="settings-title"`,
          which pointed at nothing — that <section> had no accessible name at all. Deleting
          this prop silently breaks that section's name again. */}
      <PageHeader
        eyebrow="Your trip, your way"
        title="Settings"
        titleId="settings-title"
        description="Manage who your edits are attributed to, choose your display currency and exchange rates, and back up, restore, or clear your on-device trip data."
      />
      <Settings />
    </main>
  );
}
