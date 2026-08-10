import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S206 — the packing checklist (`/packing`, `components/packing-checklist.tsx`) E2E pack.
 *
 * Signs in with a real Trip Token EXPLICITLY (mirrors `e2e/journal-browse.spec.ts`) rather than
 * riding any pack default — every route, `/packing` included, sits behind the single front-door
 * wall (D-241) — the signed-in token passes it.
 *
 * Proves, on real rendered output against the served static `out/` build (never `next dev`):
 *   1. The built-in template renders (no empty state) — Nepal / Japan / Universal groups, 28
 *      items, progress starts at 0/28.
 *   2. Checking an item updates the progress indicator live.
 *   3. Check -> reload -> persists: the S206 hard guarantee (same bar as itinerary CRUD).
 *   4. Unchecking an item persists too (the full toggle round trip).
 */

async function gotoAsTraveler(page: Page, path: string, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('tripPlannerUserName', t);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1'); // S155: keep dormant
    window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss app-wide install toast (duration:Infinity poisons axe scans)
  }, token);
  await page.goto(path, { waitUntil: 'load' });
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {
      /* no SW / already stable — proceed */
    });
}

test.describe('S206 packing checklist — the built-in template renders, no empty state', () => {
  test('Nepal / Japan / Universal groups render with 28 items total, progress starts 0/28', async ({ page }) => {
    await gotoAsTraveler(page, '/packing/');
    await expect(page.getByTestId('packing-checklist')).toBeVisible();
    await expect(page.getByTestId('packing-progress')).toHaveText('0/28 packed');

    await expect(page.getByTestId('packing-group-nepal')).toBeVisible();
    await expect(page.getByTestId('packing-group-japan')).toBeVisible();
    await expect(page.getByTestId('packing-group-universal')).toBeVisible();

    const checkboxes = page.locator('[data-testid^="packing-item-"]');
    await expect(checkboxes).toHaveCount(28);
    // A representative item from each category is present and unchecked.
    await expect(page.getByTestId('packing-item-nepal-trekking-boots')).not.toBeChecked();
    await expect(page.getByTestId('packing-item-japan-winter-coat')).not.toBeChecked();
    await expect(page.getByTestId('packing-item-universal-passport-copies')).not.toBeChecked();
  });
});

test.describe('S206 packing checklist — check/uncheck updates progress live', () => {
  test('checking an item flips it and increments the progress count', async ({ page }) => {
    await gotoAsTraveler(page, '/packing/');
    await expect(page.getByTestId('packing-checklist')).toBeVisible();

    await page.getByTestId('packing-item-nepal-trekking-boots').check();
    await expect(page.getByTestId('packing-item-nepal-trekking-boots')).toBeChecked();
    await expect(page.getByTestId('packing-progress')).toHaveText('1/28 packed');

    await page.getByTestId('packing-item-japan-winter-coat').check();
    await expect(page.getByTestId('packing-progress')).toHaveText('2/28 packed');

    await page.getByTestId('packing-item-nepal-trekking-boots').uncheck();
    await expect(page.getByTestId('packing-progress')).toHaveText('1/28 packed');
  });
});

test.describe('S206 packing checklist — check -> reload -> persists (the hard guarantee)', () => {
  test('a checked item survives a full page reload', async ({ page }) => {
    await gotoAsTraveler(page, '/packing/');
    await expect(page.getByTestId('packing-checklist')).toBeVisible();

    await page.getByTestId('packing-item-universal-passport-copies').check();
    await page.getByTestId('packing-item-japan-ic-card').check();
    await expect(page.getByTestId('packing-progress')).toHaveText('2/28 packed');

    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('packing-checklist')).toBeVisible();
    await expect(page.getByTestId('packing-progress')).toHaveText('2/28 packed');
    await expect(page.getByTestId('packing-item-universal-passport-copies')).toBeChecked();
    await expect(page.getByTestId('packing-item-japan-ic-card')).toBeChecked();
    // An untouched item stays unchecked (the write didn't clobber other items).
    await expect(page.getByTestId('packing-item-nepal-trekking-boots')).not.toBeChecked();
  });

  test('an unchecked item (after a check/uncheck round trip) also survives a reload', async ({ page }) => {
    await gotoAsTraveler(page, '/packing/');
    await expect(page.getByTestId('packing-checklist')).toBeVisible();

    await page.getByTestId('packing-item-nepal-sunscreen').check();
    await page.getByTestId('packing-item-nepal-sunscreen').uncheck();
    await expect(page.getByTestId('packing-progress')).toHaveText('0/28 packed');

    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('packing-progress')).toHaveText('0/28 packed');
    await expect(page.getByTestId('packing-item-nepal-sunscreen')).not.toBeChecked();
  });
});
