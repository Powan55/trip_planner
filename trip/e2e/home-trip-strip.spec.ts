import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S240 — Home "Your trips" chip strip E2E pack (D-172, S238 registry, S239 hub).
 *
 * Proves, on the served static `out/` build:
 *   1. A signed-in traveler with 2 registry entries sees both chips (default pack first,
 *      current one highlighted via `aria-current`) plus the always-present `+ New` chip
 *      linking to the `/trips/` hub.
 *   2. Tapping the non-current chip is the D-172 switch primitive: `joinTrip(id)` + full
 *      reload, with the `tripPlannerActiveTrip` pointer flipped and the highlight moved.
 *   3. axe: zero serious/critical violations on Home with the strip mounted.
 */

const ACTIVE_TRIP_KEY = 'tripPlannerActiveTrip';
const KNOWN_TRIPS_KEY = 'tripPlannerKnownTrips';
const A_UUID = '11111111-2222-4333-8444-555566667777';

/** Navigate and ride out the SW-controller settle (mirrors trips-hub.spec). */
async function goto(page: Page, path = '/') {
  await page.goto(path, { waitUntil: 'load' });
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {});
}

/**
 * Seed: browser is ON the shared trip A_UUID, which is registered in the known list.
 * ONCE-guarded (mirrors trips-hub.spec): addInitScript re-runs on EVERY navigation, and the
 * switch test's whole point is that the app flips the pointer — an unguarded seed would
 * silently reset it on the post-switch reload and assert against its own fixture.
 */
function seedTwoTrips(page: Page) {
  return page.addInitScript(
    ({ pointerKey, knownKey, id }: { pointerKey: string; knownKey: string; id: string }) => {
      if (window.localStorage.getItem('__s240Seeded')) return;
      window.localStorage.setItem('__s240Seeded', '1');
      window.localStorage.setItem(pointerKey, id);
      window.localStorage.setItem(
        knownKey,
        JSON.stringify([{ id, name: 'Trek crew', joinedAt: 1750000000000 }]),
      );
    },
    { pointerKey: ACTIVE_TRIP_KEY, knownKey: KNOWN_TRIPS_KEY, id: A_UUID },
  );
}

const readActiveTrip = (page: Page) =>
  page.evaluate((k) => window.localStorage.getItem(k), ACTIVE_TRIP_KEY);

test.describe('S240 — Home trip strip', () => {
  test('signed-in with 2 registry entries sees both chips (default first, current highlighted) + New', async ({
    page,
  }) => {
    await seedTwoTrips(page);
    await goto(page);

    const strip = page.getByTestId('home-trip-strip');
    await expect(strip).toBeVisible({ timeout: 15_000 });
    await expect(strip).toContainText('Your trips');

    // Chip 0 = default pack (always first, NOT current here) — an interactive switch button.
    const chip0 = page.getByTestId('home-trip-chip-0');
    await expect(chip0).toContainText('Nepal × Japan');
    await expect(chip0).not.toHaveAttribute('aria-current', 'true');

    // Chip 1 = the active shared trip — highlighted, non-interactive (a span, not a button).
    const chip1 = page.getByTestId('home-trip-chip-1');
    await expect(chip1).toContainText('Trek crew');
    await expect(chip1).toHaveAttribute('aria-current', 'true');
    expect(await chip1.evaluate((el) => el.tagName)).not.toBe('BUTTON');

    // `+ New` is always present and links to the /trips/ hub.
    const newChip = page.getByTestId('home-trip-new');
    await expect(newChip).toBeVisible();
    await expect(newChip).toHaveAttribute('href', /\/trips\/?$/);
  });

  test('tapping the non-current chip switches: pointer flipped + full reload (D-172)', async ({
    page,
  }) => {
    await seedTwoTrips(page);
    await goto(page);

    const chip0 = page.getByTestId('home-trip-chip-0');
    await expect(chip0).toBeVisible({ timeout: 15_000 });
    expect(await readActiveTrip(page)).toBe(A_UUID); // pre-condition: on the shared trip

    await chip0.click();

    // Full reload lands back on Home with the DEFAULT pack active: the highlight moved to
    // chip 0, and the pointer holds the default pack's literal id (D-172 grandfather).
    await expect(page.getByTestId('home-trip-chip-0')).toHaveAttribute('aria-current', 'true', {
      timeout: 15_000,
    });
    expect(await readActiveTrip(page)).toBe('nepal-japan-2026');
    // The switched-away trip stays registered (chip 1 still rendered, now interactive).
    await expect(page.getByTestId('home-trip-chip-1')).toContainText('Trek crew');
  });

  test('axe: zero serious/critical violations on Home with the strip mounted', async ({ page }) => {
    await goto(page);
    await expect(page.getByTestId('home-trip-strip')).toBeVisible({ timeout: 15_000 });
    // Single-trip shape: just [current chip] + [+ New].
    await expect(page.getByTestId('home-trip-chip-0')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('home-trip-chip-1')).toHaveCount(0);

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')).toEqual([]);
  });
});
