import { test, expect } from '@playwright/test';

/**
 * #674 — Trip access is gated on `isRemoteConfigured()` (a build-time read of
 * `NEXT_PUBLIC_FIREBASE_*`), so `e2e/settings.spec.ts` can only prove the group is ABSENT on
 * the dormant build every other spec runs against. This spec runs only against the SECOND,
 * Firebase-configured build the `e2e` CI job produces (see `.github/workflows/ci.yml`,
 * D-652) and self-skips everywhere else.
 *
 * No emulator: every request that would leave the runner is aborted below, so this proves the
 * client-side gate flips and the group renders, not that any Firebase call succeeds.
 */
test.describe('#674 settings — Trip access on a Firebase-configured build', { tag: '@firebase' }, () => {
  test.skip(!process.env.E2E_FIREBASE, 'needs the Firebase-configured CI build');

  test('renders and opens; shows the sync toggle and the Google link', async ({ page }) => {
    await page.route(
      /googleapis\.com|firebaseapp\.com|gstatic\.com\/firebasejs/,
      (route) => route.abort(),
    );
    await page.addInitScript(() => {
      window.localStorage.setItem('tripPlannerToken', 'Powan');
      window.localStorage.setItem('tripPlannerUserName', 'Powan');
      window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1');
      window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1');
    });
    await page.goto('/settings/', { waitUntil: 'load' });
    await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });

    const group = page.getByTestId('settings-group-access');
    await expect(group).toBeVisible();
    await group.getByTestId('settings-group-access-toggle').click();

    await expect(page.getByTestId('settings-sync-toggle')).toBeVisible();
    await expect(page.getByTestId('settings-identity-google')).toBeVisible();
  });
});
