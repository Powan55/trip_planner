import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S206 — axe accessibility scan for the new `/packing` route (mirrors
 * `e2e/journal-browse-a11y.spec.ts`'s S153 pack exactly, incl. the serious/critical-only hard
 * gate + advisory logging), scanned TWICE in one run to prove the result is deterministic (no
 * test-order/flake dependency), not a one-shot pass. Signs in with a real Trip Token (mirrors
 * journal-browse-a11y.spec.ts) rather than the shared `./fixtures` default.
 *
 * Scanned in BOTH states: the freshly-seeded template (all unchecked) and a partially-checked
 * state (proves the `line-through`/checked styling introduces no new violation).
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
  await expect(page.locator('h1').first()).toBeVisible();
}

function scanFor(page: Page) {
  return new AxeBuilder({ page });
}

async function assertNoSeriousCritical(page: Page, label: string, testInfo: import('@playwright/test').TestInfo) {
  const results = await scanFor(page).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of results.violations) {
    const line = `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`;
    testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: line });
    // eslint-disable-next-line no-console
    console.log(`  axe ${label} ${line}`);
  }
  expect(
    blocking,
    `serious/critical a11y violations on ${label}: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`,
  ).toEqual([]);
}

test.describe('S206 axe — /packing template state (run twice for determinism)', () => {
  for (const run of [1, 2] as const) {
    test(`axe run ${run}: /packing template state has zero serious/critical`, async ({ page }, testInfo) => {
      await gotoAsTraveler(page, '/packing/');
      await expect(page.getByTestId('packing-checklist')).toBeVisible();
      await assertNoSeriousCritical(page, `/packing template (run ${run})`, testInfo);
    });
  }
});

test.describe('S206 axe — /packing partially checked', () => {
  test('a few checked items introduces zero serious/critical', async ({ page }, testInfo) => {
    await gotoAsTraveler(page, '/packing/');
    await expect(page.getByTestId('packing-checklist')).toBeVisible();

    await page.getByTestId('packing-item-nepal-trekking-boots').check();
    await page.getByTestId('packing-item-japan-winter-coat').check();
    await page.getByTestId('packing-item-universal-passport-copies').check();

    await assertNoSeriousCritical(page, '/packing partially checked', testInfo);
  });
});
