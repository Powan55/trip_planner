import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S217 — axe accessibility scan for the new `/checklist` route (mirrors e2e/packing-a11y.spec.ts's
 * serious/critical-only hard gate + advisory logging). Signs in with a real Trip Token. Scanned in
 * BOTH states: the freshly-seeded template (all unchecked) and a partially-checked-with-note state
 * (proves the line-through/checked styling and the note input introduce no new violation).
 */

async function gotoAsTraveler(page: Page, path: string, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('tripPlannerUserName', t);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1');
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

async function assertNoSeriousCritical(page: Page, label: string, testInfo: import('@playwright/test').TestInfo) {
  const results = await new AxeBuilder({ page }).analyze();
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

test.describe('S217 axe — /checklist template state (run twice for determinism)', () => {
  for (const run of [1, 2] as const) {
    test(`axe run ${run}: /checklist template state has zero serious/critical`, async ({ page }, testInfo) => {
      await gotoAsTraveler(page, '/checklist/');
      await expect(page.getByTestId('docs-checklist')).toBeVisible();
      await assertNoSeriousCritical(page, `/checklist template (run ${run})`, testInfo);
    });
  }
});

test.describe('S217 axe — /checklist partially checked with a note', () => {
  test('checked items + a filled note introduce zero serious/critical', async ({ page }, testInfo) => {
    await gotoAsTraveler(page, '/checklist/');
    await expect(page.getByTestId('docs-checklist')).toBeVisible();

    await page.getByTestId('docs-item-passport-validity').check();
    await page.getByTestId('docs-item-online-checkin').check();
    const note = page.getByTestId('docs-note-travel-insurance');
    await note.fill('Policy #A-4471');
    await note.blur();

    await assertNoSeriousCritical(page, '/checklist partially checked + note', testInfo);
  });
});
