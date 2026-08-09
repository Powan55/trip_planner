import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S218 polish bundle — targeted coverage for the three small items:
 *   1. Skeleton loading slots (`SectionSkeleton`, S67) are wired for the named lazy
 *      islands (map, journal) — verified against the served static export's raw HTML,
 *      i.e. what actually reaches the client BEFORE hydration replaces it (the real "does the
 *      loading slot exist" question, not a hydration-timing race on a fast local server).
 *   2. The last-packing-item-checked micro-celebration fires (visible burst) on a real check
 *      action.
 *   3. That same celebration is ABSENT under `prefers-reduced-motion` emulation (D-056b hard
 *      guard) even though the completing check still happens.
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

// The full 28-item built-in template (core/packing/model.ts DEFAULT_TEMPLATE ids) with every
// item EXCEPT the last one pre-checked, so a single UI check completes the list. Seeded straight
// into the gateway's localStorage slot (`nepal_japan_packing`, key 21) — the same shape
// `core/packing/storage.ts` sanitizes, so this is a realistic persisted state, not a shortcut.
const PACKING_IDS = [
  'universal-passport-copies', 'universal-travel-insurance', 'universal-phone-charger',
  'universal-power-adapter', 'universal-water-bottle', 'universal-first-aid',
  'universal-sunglasses', 'universal-daypack', 'universal-toiletries', 'universal-power-bank',
  'nepal-trekking-boots', 'nepal-base-layers', 'nepal-down-jacket', 'nepal-sleeping-bag-liner',
  'nepal-water-purification', 'nepal-trekking-poles', 'nepal-sun-hat', 'nepal-sunscreen',
  'nepal-cash-npr',
  'japan-winter-coat', 'japan-thermal-layers', 'japan-walking-shoes', 'japan-pocket-wifi',
  'japan-ic-card', 'japan-umbrella', 'japan-gloves-scarf', 'japan-cash-jpy',
  'japan-slip-on-shoes',
];
const LAST_ITEM_ID = PACKING_IDS[PACKING_IDS.length - 1];

/** Seed the packing slot with the full template, leaving the LAST `uncheckedCount` items unchecked. */
async function seedPacking(page: Page, uncheckedCount: 0 | 1) {
  await page.addInitScript(
    ({ ids, unchecked }: { ids: string[]; unchecked: number }) => {
      const items = ids.map((id, i) => ({
        id,
        label: id,
        category: id.startsWith('nepal') ? 'nepal' : id.startsWith('japan') ? 'japan' : 'universal',
        checked: i < ids.length - unchecked,
      }));
      window.localStorage.setItem('nepal_japan_packing', JSON.stringify(items));
    },
    { ids: PACKING_IDS, unchecked: uncheckedCount },
  );
}

test.describe('S218 — skeleton loading slots wired for lazy islands', () => {
  test('/map serves the SectionSkeleton loading fallback in the raw static HTML', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/map/`);
    const html = await res.text();
    expect(html).toContain('data-loading="Loading section"');
  });

  test('/journal serves the SectionSkeleton loading fallback in the raw static HTML', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/journal/`);
    const html = await res.text();
    expect(html).toContain('data-loading="Loading section"');
  });
});

test.describe('S218 — last-packing-item-checked micro-celebration', () => {
  test('checking the final item shows the celebration burst', async ({ page }) => {
    await gotoAsTraveler(page, '/packing/');
    await seedPacking(page, 1);
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('packing-checklist')).toBeVisible();
    await expect(page.getByTestId('packing-progress')).toHaveText('27/28 packed');

    await expect(page.getByTestId('packing-celebration')).toHaveCount(0);
    await page.getByTestId(`packing-item-${LAST_ITEM_ID}`).check();
    await expect(page.getByTestId('packing-progress')).toHaveText('28/28 packed');
    await expect(page.getByTestId('packing-celebration')).toBeVisible();
  });

  test('is ABSENT under prefers-reduced-motion even though the list still completes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoAsTraveler(page, '/packing/');
    await seedPacking(page, 1);
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('packing-checklist')).toBeVisible();
    await expect(page.getByTestId('packing-progress')).toHaveText('27/28 packed');

    await page.getByTestId(`packing-item-${LAST_ITEM_ID}`).check();
    await expect(page.getByTestId('packing-progress')).toHaveText('28/28 packed');
    // Wait past the ~650ms window the burst would otherwise occupy, to prove it never appeared
    // at all (not just that we checked too early).
    await page.waitForTimeout(800);
    await expect(page.getByTestId('packing-celebration')).toHaveCount(0);
  });

  test('REGRESSION (S218 review): an already-complete list does NOT celebrate on load, but a live re-completion does', async ({ page }) => {
    // Seed all 28 checked in storage, then load: the null-baseline seed means no burst on load.
    await gotoAsTraveler(page, '/packing/');
    await seedPacking(page, 0);
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('packing-checklist')).toBeVisible();
    await expect(page.getByTestId('packing-progress')).toHaveText('28/28 packed');
    // Wait past the burst window to prove it never appeared at all.
    await page.waitForTimeout(800);
    await expect(page.getByTestId('packing-celebration')).toHaveCount(0);

    // A live uncheck → recheck IS an observed false→true edge, so it DOES fire.
    await page.getByTestId(`packing-item-${LAST_ITEM_ID}`).uncheck();
    await expect(page.getByTestId('packing-progress')).toHaveText('27/28 packed');
    await page.getByTestId(`packing-item-${LAST_ITEM_ID}`).check();
    await expect(page.getByTestId('packing-progress')).toHaveText('28/28 packed');
    await expect(page.getByTestId('packing-celebration')).toBeVisible();
  });
});
