import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S153 — axe accessibility scan for the new `/journal` route (mirrors `e2e/a11y.spec.ts`'s S85
 * pack exactly, incl. the serious/critical-only hard gate + advisory logging), scanned TWICE in
 * one run to prove the result is deterministic (no test-order/flake dependency), not a one-shot
 * pass. Signs in with a real Trip Token (mirrors `nightlife-gate.spec.ts`) rather than the shared
 * `./fixtures` default, deliberately (S153).
 *
 * Scanned in BOTH states:
 *   - the empty state (no journal entries persisted);
 *   - the populated state (seeded entries + one row's editor open, since the editor is the other
 *     rendered branch of `journal-browse.tsx` / the reused `JournalCard` primitive).
 */

const JOURNAL_KEY = 'nepal_japan_journal';

async function gotoAsTraveler(page: Page, path: string, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('tripPlannerUserName', t);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1'); // S155: keep dormant
    window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss app-wide install toast (duration:Infinity poisons axe scans)
  }, token);
  await page.goto(path, { waitUntil: 'load' });
  // Settle past the SW's one-off first-load reload (D-073; the a11y.spec.ts idiom) so the scan
  // and the editor interactions never race a mid-test remount.
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

async function seedEntries(page: Page) {
  await page.addInitScript(
    (key: string) => {
      window.localStorage.setItem(
        key,
        JSON.stringify([
          {
            date: '2026-12-10',
            text: 'Boudhanath at dawn, then momos in Thamel.',
            mood: 'good',
            highlight: 'Prayer flags at first light',
            createdAt: '2026-12-10T09:00:00.000Z',
            updatedAt: '2026-12-10T09:00:00.000Z',
          },
        ]),
      );
    },
    JOURNAL_KEY,
  );
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

test.describe('S153 axe — /journal empty state (run twice for determinism)', () => {
  for (const run of [1, 2] as const) {
    test(`axe run ${run}: /journal empty state has zero serious/critical`, async ({ page }, testInfo) => {
      await gotoAsTraveler(page, '/journal/');
      await expect(page.getByTestId('journal-browse-empty')).toBeVisible();
      await assertNoSeriousCritical(page, `/journal empty (run ${run})`, testInfo);
    });
  }
});

test.describe('S153 axe — /journal populated + editor open', () => {
  test('populated list + one row expanded into the JournalCard editor has zero serious/critical', async ({
    page,
  }, testInfo) => {
    await seedEntries(page);
    await gotoAsTraveler(page, '/journal/');
    await expect(page.getByTestId('journal-browse-row-2026-12-10')).toBeVisible();

    await assertNoSeriousCritical(page, '/journal populated (list)', testInfo);

    // Open the editor for the one row (the second rendered branch: JournalCard mounted in place
    // of the row) and scan again — this is where journal-card.tsx's editor markup renders.
    await page.getByTestId('journal-browse-edit-2026-12-10').click();
    await expect(page.getByTestId('journal-card')).toBeVisible();
    await page.getByTestId('journal-edit').click();
    await expect(page.getByTestId('journal-editor')).toBeVisible();

    await assertNoSeriousCritical(page, '/journal populated (editor open)', testInfo);
  });
});
