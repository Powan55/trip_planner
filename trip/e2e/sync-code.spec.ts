import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * D-660 — accounts are a username + password, so the account id on disk (`tripPlannerSyncCode`,
 * key 28) is internal: nothing in Settings or on /trips reveals it, mints it, or asks the traveller
 * to save it. Run against the served static `out/` build WITHOUT live Firebase (the dormant build).
 *
 *   1. Settings has no key card, and the retired credential names stay out of its copy.
 *   2. Sign-out is one confirm (no show-once step), clears key 28, and returns to the door, whose
 *      log-in form asks for a username and password.
 *   3. /trips has no pointer to a key.
 */

const SYNC_KEY = 'tripPlannerSyncCode';
const TOUR_SEEN = 'nepal_japan_first_run_tour_seen';
const ACCOUNT_ID = '11111111-2222-3333-4444-555555555555';

async function gotoSettings(page: Page) {
  await page.addInitScript(
    ({ tour, key, id }: { tour: string; key: string; id: string }) => {
      // Seeded ONLY on the first navigation (sessionStorage-guarded — see settings.spec.ts's
      // gotoSettings): sign-out reloads, and an unconditional reseed would resurrect the identity
      // it just cleared.
      const FIRST_NAV = '__e2e_settings_identity_seeded__';
      if (window.sessionStorage.getItem(FIRST_NAV) === null) {
        window.sessionStorage.setItem(FIRST_NAV, '1');
        window.localStorage.setItem('tripPlannerToken', 'Powan');
        window.localStorage.setItem('tripPlannerUserName', 'Powan');
        window.localStorage.setItem(key, id);
      }
      window.localStorage.setItem(tour, '1');
    },
    { tour: TOUR_SEEN, key: SYNC_KEY, id: ACCOUNT_ID },
  );
  await page.goto('/settings/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
}

const readCode = (page: Page) => page.evaluate((k) => window.localStorage.getItem(k), SYNC_KEY);

test.describe('D-660 — no key surfaces', () => {
  test('Settings has no key card, and the retired credential names stay out of its copy', async ({
    page,
  }) => {
    await gotoSettings(page);
    await expect(page.getByTestId('settings-group-sync')).toHaveCount(0);
    await page.getByTestId('settings-group-trip-toggle').click();
    // The default pack renders a note in place of a Trip Token value.
    await expect(page.getByTestId('settings-trip-key-default')).toBeVisible();
    await expect(page.getByTestId('settings-trip-key')).toHaveCount(0);

    const panel = page.getByTestId('settings-panel');
    await expect(panel).toContainText('Trip Token');
    await expect(panel).not.toContainText('Your key');
    await expect(panel).not.toContainText('User Token');
    await expect(panel).not.toContainText('Trip Key');
    await expect(panel).not.toContainText('Trip key');
    await expect(panel).not.toContainText('sync code');
    await expect(panel).not.toContainText('Sync code');
    // Settings never leaks the account id.
    await expect(panel).not.toContainText(ACCOUNT_ID);
  });

  test('sign out is one confirm, clears the account id, and the door asks for a username and password', async ({
    page,
  }) => {
    await gotoSettings(page);
    expect(await readCode(page)).toBe(ACCOUNT_ID);

    await page.getByTestId('settings-sign-out').click();
    await expect(page.getByTestId('settings-sign-out-confirm')).toHaveText('Sign out');
    await page.getByTestId('settings-sign-out-confirm').click();

    await expect(page.locator('[role="dialog"]')).toHaveCount(1, { timeout: 15_000 });
    await page.getByTestId('landing-cta-login').click();
    await expect(page.getByTestId('token-gate-username')).toBeVisible();
    await expect(page.getByTestId('token-gate-password')).toHaveAttribute('type', 'password');
    expect(await page.evaluate(() => window.localStorage.getItem('tripPlannerToken'))).toBeNull();
    expect(await readCode(page)).toBeNull();
  });

  test('/trips has no pointer to a key', async ({ page }) => {
    await page.addInitScript((tour: string) => {
      window.localStorage.setItem('tripPlannerToken', 'Powan');
      window.localStorage.setItem('tripPlannerUserName', 'Powan');
      window.localStorage.setItem(tour, '1');
    }, TOUR_SEEN);
    await page.goto('/trips/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('trips-hub')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('trips-hub-sync-link')).toHaveCount(0);
    await expect(page.getByTestId('trips-hub')).not.toContainText('your key');
  });
});
