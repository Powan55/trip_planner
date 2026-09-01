import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S220 — the share-target inbox (`/share`, `components/share-inbox.tsx`) E2E pack.
 *
 * Signs in with a real Trip Token EXPLICITLY (mirrors e2e/packing.spec.ts) — every route,
 * `/share` included, sits behind the single front-door wall (D-241); a signed-in traveler
 * passes it. Proves, on real rendered output against the served static `out/` build:
 *   (a) visiting /share/?title&text&url lands an item that survives reload with the params stripped;
 *   (b) a reload after the strip does NOT duplicate the item;
 *   (c) a day assignment persists across reload;
 *   (d) delete works and the designed empty state returns;
 *   (e) axe /share serious/critical = 0.
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

const rows = (page: Page) => page.locator('li[data-testid^="share-item-"]');

test.describe('S220 share inbox — receiver captures a shared item, strips params, survives reload', () => {
  test('visiting /share/?title&text&url lands ONE item, strips the query, and persists across reload', async ({
    page,
  }) => {
    await gotoAsTraveler(
      page,
      '/share/?title=Great%20ryokan&text=Book%20this%20one&url=https://example.com/ryokan',
    );
    await expect(page.getByTestId('share-inbox')).toBeVisible();

    // The item lands.
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('Great ryokan')).toBeVisible();
    // The url is linkified with the safe-target attributes.
    const link = page.locator('[data-testid^="share-item-link-"]');
    await expect(link).toHaveAttribute('href', 'https://example.com/ryokan');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    // The receiver stripped the query so a reload cannot re-add (URL has no ?...).
    expect(new URL(page.url()).search).toBe('');

    // Reload — the item survives AND is not duplicated (the strip guarantee).
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('share-inbox')).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('Great ryokan')).toBeVisible();
  });

  test('a second reload after the strip still does NOT duplicate the item', async ({ page }) => {
    await gotoAsTraveler(page, '/share/?text=One%20shared%20note&url=https://example.com/a');
    await expect(page.getByTestId('share-inbox')).toBeVisible();
    await expect(rows(page)).toHaveCount(1);

    await page.reload({ waitUntil: 'load' });
    await expect(rows(page)).toHaveCount(1);
    await page.reload({ waitUntil: 'load' });
    await expect(rows(page)).toHaveCount(1);
  });
});

test.describe('S220 share inbox — day assignment persists across reload', () => {
  test('assigning a trip day to a shared item survives a full reload', async ({ page }) => {
    await gotoAsTraveler(page, '/share/?title=Assign%20me&url=https://example.com/x');
    await expect(page.getByTestId('share-inbox')).toBeVisible();
    await expect(rows(page)).toHaveCount(1);

    const select = page.locator('[data-testid^="share-item-day-"]');
    // Pick a real trip day (Dec 10 2026 — a bounded option the model accepts).
    await select.selectOption('2026-12-10');
    await expect(select).toHaveValue('2026-12-10');

    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('share-inbox')).toBeVisible();
    await expect(page.locator('[data-testid^="share-item-day-"]')).toHaveValue('2026-12-10');
  });
});

test.describe('S220 share inbox — delete returns to the designed empty state', () => {
  test('deleting the only item removes it and shows the empty state', async ({ page }) => {
    await gotoAsTraveler(page, '/share/?title=Delete%20me&url=https://example.com/y');
    await expect(page.getByTestId('share-inbox')).toBeVisible();
    await expect(rows(page)).toHaveCount(1);

    await page.locator('[data-testid^="share-item-delete-"]').click();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByTestId('share-empty')).toBeVisible();
    // #218 moved the inbox title into the section's sr-only accessible name, so the empty
    // state's own words are the header paragraph rather than a visible "Nothing shared yet".
    await expect(page.getByRole('heading', { name: 'Shared links inbox' })).toBeAttached();
    await expect(page.getByTestId('share-inbox')).toContainText('Anything you share');

    // The empty state persists across a reload (the delete was really written).
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('share-empty')).toBeVisible();
  });
});

test.describe('S220 share inbox — axe (serious/critical = 0)', () => {
  test('empty state and a populated inbox both pass axe with zero serious/critical', async ({ page }, testInfo) => {
    // Empty state.
    await gotoAsTraveler(page, '/share/');
    await expect(page.getByTestId('share-empty')).toBeVisible();
    await runAxe(page, 'empty', testInfo);

    // Populated + a day assigned (proves the select/link markup adds no violation).
    await gotoAsTraveler(page, '/share/?title=Axe%20check&url=https://example.com/z');
    await expect(page.getByTestId('share-inbox')).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await page.locator('[data-testid^="share-item-day-"]').selectOption('2026-12-11');
    await runAxe(page, 'populated', testInfo);
  });
});

async function runAxe(page: Page, label: string, testInfo: import('@playwright/test').TestInfo) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of results.violations) {
    const line = `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`;
    testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: line });
    console.log(`  axe ${label} ${line}`);
  }
  expect(
    blocking,
    `serious/critical a11y on /share ${label}: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`,
  ).toEqual([]);
}
