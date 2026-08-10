import { test, expect } from './fixtures';
import type { Page, ConsoleMessage } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Travel Mode route SHELL E2E pack (slice S184, D-164 / D-170).
 *
 * Rides the shared `./fixtures` DEFAULT identity (a SIGNED-IN traveler) — with no guest mode
 * (D-241), that is the only identity that ever reaches `/travel`; there is no separate
 * unauthenticated case to assert. Proves, on the served static `out/` build (D-093):
 *
 *   1. `/travel` serves the TM root shell (h1 "Travel Mode") — chrome-FREE: the persistent
 *      navbar, footer, mobile tab bar, and quick-add FAB are all ABSENT (rendered null via the
 *      `isTravelRoute` pathname conditional in the six chrome-islands, D-164).
 *   2. That chrome is RESTORED on navigating away (Home renders navbar + footer + tab bar + FAB).
 *   3. Zero serious/critical axe violations on `/travel` (run twice for determinism).
 *   4. No console errors / page errors on load.
 *
 * The mobile-only chrome (tab bar + FAB are `md:hidden`) is only meaningfully assertable at a
 * mobile viewport — at desktop width those nodes exist in the DOM but sit `display:none`, so an
 * "absent" check couldn't distinguish suppression from the breakpoint. This pack runs at a
 * mobile viewport so all four chrome pieces are genuinely visible on a normal route and
 * genuinely gone on `/travel`.
 */

test.use({ viewport: { width: 390, height: 844 } });

/** Navigate and wait for a real render + the SW to settle (mirrors the safety pack). */
async function goto(page: Page, path: string) {
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
  await expect(page.locator('h1').first()).toBeVisible();
}

/** The four suppressible chrome pieces, by their stable selectors. */
const navbar = (page: Page) => page.getByTestId('navbar');
const tabBar = (page: Page) => page.getByTestId('tab-bar');
const fab = (page: Page) => page.getByTestId('quick-add-fab');
const footer = (page: Page) => page.locator('footer');

test.describe('S184 · /travel serves the chrome-free shell', () => {
  test('the TM root + h1 render and all four chrome pieces are absent', async ({ page }) => {
    await goto(page, '/travel/');

    // The shell is up: TM root container + the "Travel Mode" h1.
    await expect(page.getByTestId('travel-mode-root')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Travel Mode' })).toBeVisible();

    // Chrome-free (D-164): each island renders null under /travel → absent from the DOM.
    await expect(navbar(page)).toHaveCount(0);
    await expect(footer(page)).toHaveCount(0);
    await expect(tabBar(page)).toHaveCount(0);
    await expect(fab(page)).toHaveCount(0);
  });
});

test.describe('S184 · chrome is restored on navigating away', () => {
  test('Home (after /travel) shows navbar, footer, tab bar, and FAB again', async ({ page }) => {
    // Prove the pathname conditional both suppresses AND restores: /travel first (gone), then Home.
    await goto(page, '/travel/');
    await expect(navbar(page)).toHaveCount(0);

    await goto(page, '/');
    // At the mobile viewport, all four are genuinely present/visible on Home.
    await expect(navbar(page)).toBeVisible();
    await expect(footer(page)).toBeVisible();
    await expect(tabBar(page)).toBeVisible();
    await expect(fab(page)).toBeVisible();
  });
});

test.describe('S184 axe — /travel (run twice for determinism)', () => {
  for (const run of [1, 2] as const) {
    test(`axe run ${run}: /travel has zero serious/critical violations`, async ({ page }, testInfo) => {
      await goto(page, '/travel/');
      await expect(page.getByTestId('travel-mode-root')).toBeVisible();

      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      for (const v of results.violations) {
        const line = `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`;
        testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: line });
        console.log(`  axe /travel (run ${run}) ${line}`);
      }
      expect(
        blocking,
        `serious/critical a11y violations on /travel: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`,
      ).toEqual([]);
    });
  }
});

test.describe('S184 · /travel loads with no console errors', () => {
  test('no console.error / pageerror while loading the shell', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    await goto(page, '/travel/');
    await expect(page.getByTestId('travel-mode-root')).toBeVisible();

    expect(errors, `console errors on /travel: ${errors.join(' | ')}`).toEqual([]);
  });
});
