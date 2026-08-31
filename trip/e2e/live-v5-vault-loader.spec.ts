import { test, expect } from '@playwright/test';
import path from 'node:path';
import { seedLiveVault, PLACEHOLDER_DUMP_PATH } from './fixtures/live-v5-vault/loader';

/**
 * Loader smoke spec (slice S172) — proves the live-v5-vault fixture harness
 * itself, on the NOT-ACCEPTANCE synthetic placeholder dump (never real
 * migration evidence — see fixtures/live-v5-vault/README.md).
 *
 * Uses the raw `@playwright/test` `test` (not `./fixtures`'s default-traveler
 * fixture) so the ONLY seeded storage in this context comes from the loader
 * itself — an unambiguous proof that `seedLiveVault` is what did the work.
 */
test.describe('live-v5-vault loader', () => {
  test('seeds the placeholder dump before app boot, the app reads it through the real gate, and it survives a reload', async ({
    page,
  }) => {
    await seedLiveVault(page, PLACEHOLDER_DUMP_PATH);
    await page.goto('/');

    // The seeded token from the dump is what the app's
    // Trip Token wall gate reads via `identityStore.getToken()` (the gateway,
    // D-097). If the loader's addInitScript seed did NOT run before the
    // wall's first-paint check, the wall would be open (role="dialog").
    // Its absence is proof the seeded value was visible to the app, not just
    // present in storage.
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page.locator('h1').first()).toBeVisible();

    // Raw-storage check (both stores, both a local and a session key) — the
    // exact bytes the loader wrote are still there after the app booted.
    const seededName = await page.evaluate(() => window.localStorage.getItem('tripPlannerUserName'));
    expect(seededName).toBe('S172-Placeholder-Traveler');
    const seededToday = await page.evaluate(() =>
      window.sessionStorage.getItem('tripPlannerTodayOverride'),
    );
    expect(seededToday).toBe('2026-12-10');

    // Reload: the gate/loader idiom re-runs `addInitScript` on every
    // navigation in this context, so the seed — and the app's reaction to it
    // (no wall) — must survive a reload exactly like real localStorage would.
    await page.reload();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page.locator('h1').first()).toBeVisible();
    const nameAfterReload = await page.evaluate(() =>
      window.localStorage.getItem('tripPlannerUserName'),
    );
    expect(nameAfterReload).toBe('S172-Placeholder-Traveler');
  });

  test('throws a clear error for a missing dump file', async ({ page }) => {
    const missingPath = path.join(__dirname, 'fixtures', 'live-v5-vault', 'does-not-exist.json');
    await expect(seedLiveVault(page, missingPath)).rejects.toThrow(/dump file not found/);
  });

  test('throws a clear error for a malformed dump file', async ({ page }) => {
    const malformedPath = path.join(__dirname, 'fixtures', 'live-v5-vault', 'PLACEHOLDER-synthetic-dump.json');
    // Sanity-invert: a well-formed file must NOT throw (guards the negative
    // test above actually being meaningful) — then prove a bad shape does.
    await expect(seedLiveVault(page, malformedPath)).resolves.toBeUndefined();

    // A JSON file that parses but isn't the { localStorage, sessionStorage } shape.
    const notVaultShapePath = path.join(__dirname, '..', 'package.json');
    await expect(seedLiveVault(page, notVaultShapePath)).rejects.toThrow(/malformed/);
  });
});
