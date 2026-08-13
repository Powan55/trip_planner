import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S218 polish bundle — targeted coverage for the three small items:
 *   1. Skeleton loading slots (`SectionSkeleton`, S67) are wired for the named lazy
 *      islands (map, journal) — verified in a signed-in browser with every chunk response
 *      held back, so the loading slot is on screen long enough to assert deterministically.
 *      This USED to read the served static export's raw HTML. #10 ended that: the provider
 *      withholds `{children}` until an identified traveler, so the prerendered HTML of every
 *      route is now content-free BY DESIGN (that is the fix for the logged-out DOM leak) and
 *      no page's raw HTML can ever contain a skeleton again. The contract under test is
 *      unchanged — a lazy island must not flash empty — only the vantage point moved.
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
  /**
   * Hold every JS chunk for `delayMs` before letting it through. The lazy island's chunk is
   * requested only AFTER hydration, so its skeleton is guaranteed to be on screen for at least
   * that long — no race with a fast local server. Boot chunks are delayed too, which merely
   * makes the page load later; `gotoAsTraveler` already waits for `load`.
   */
  async function throttleChunks(page: Page, delayMs = 1000) {
    await page.route('**/_next/static/chunks/**', async (route) => {
      await new Promise((r) => setTimeout(r, delayMs));
      await route.continue();
    });
  }

  for (const route of ['/map/', '/journal/'] as const) {
    test(`${route} renders the SectionSkeleton loading fallback while its island loads`, async ({ page }) => {
      await throttleChunks(page);
      await gotoAsTraveler(page, route);
      await expect(page.locator('[data-loading="Loading section"]').first()).toBeVisible({
        timeout: 15_000,
      });
    });
  }

  /**
   * Issue #54 D — a placeholder must never reserve MORE than it declares.
   *
   * `SectionSkeleton` used to apply its height as `minHeight`, so its intrinsic content
   * (which stacks into one column below `sm`) rendered ~826.5px at 360px wide regardless
   * of the declaration — including Home's first slot, which asks for a strip-sized box.
   * The island then swapped in at a fraction of that height and yanked everything above it
   * upward: cold CLS on Home measured 0.175–1.001 (Google calls 0.25 "poor"), and the hero
   * briefly painted UNDER the fixed navbar on the way.
   *
   * Chunk throttling (above) is what makes this deterministic: it holds the island's chunk
   * so the placeholder is guaranteed on screen, no race, nothing to retry.
   */
  // app/page.tsx `TRIP_STRIP_H` — Home's FIRST skeleton in DOM order is the trip strip's,
  // above the fold, and it is the one that used to render 826.5px against this declaration.
  const HOME_FIRST_RESERVATION_PX = 61;

  test('Home\'s first skeleton reserves no more height than it declares', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await throttleChunks(page);
    await gotoAsTraveler(page, '/');

    // The strip's chunk is requested only after hydration and then held for a second, so its
    // `loading:` skeleton is guaranteed on screen — no race, nothing to retry.
    const skeleton = page.locator('[data-loading="Loading section"]').first();
    await expect(skeleton).toBeAttached({ timeout: 15_000 });
    const box = await skeleton.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(HOME_FIRST_RESERVATION_PX);
  });

  /**
   * The outcome the box-height check above is a proxy for: a cold Home must not shift.
   * Native `PerformanceObserver({type:'layout-shift'})` — no dependency, no polyfill.
   *
   * A THRESHOLD, never an equality: the value depends on which chunk wins the race, and on
   * the broken build the same artifact produced 0.1752 and 1.0009 on different runs. 0.1 is
   * Google's "good" ceiling; six cold runs of the fixed build measured 0.0004–0.001, so the
   * margin here is two orders of magnitude, not a hair.
   */
  test('cold Home at 360×740 stays under the 0.1 CLS ceiling', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await gotoAsTraveler(page, '/');

    // Let every island finish arriving — the shifts this guards against happen exactly when
    // a placeholder is replaced, so measuring before that would measure nothing.
    await expect(page.locator('#hero')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-lazy-visible="pending"]')).toHaveCount(0);
    await expect(page.locator('[data-loading="Loading section"]')).toHaveCount(0);
    await page.waitForTimeout(1500);

    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.1);
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
