import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S217 â€” the documents & readiness checklist (`/checklist`, `components/docs-checklist.tsx`) E2E pack.
 *
 * Signs in with a real Trip Token EXPLICITLY (mirrors e2e/packing.spec.ts) â€” `/checklist` is a
 * non-Home route, so an unidentified visitor would hit the front-door wall (no guest mode, D-241);
 * the signed-in token passes it.
 *
 * Proves, on real rendered output against the served static `out/` build (never `next dev`):
 *   1. The built-in template renders (no empty state) â€” Critical (10) + Day-zero (8) = 18 items,
 *      progress 0/18, per-section counts 0/10 & 0/8.
 *   2. Checking an item updates the progress indicator live.
 *   3. Check -> reload -> persists (the hard guarantee).
 *   4. A per-item note -> reload -> persists.
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
      /* no SW / already stable â€” proceed */
    });
}

test.describe('S217 docs checklist â€” the built-in template renders, no empty state', () => {
  test('Critical + Day-zero sections render 18 items, progress 0/18, per-section 0/10 & 0/8', async ({ page }) => {
    await gotoAsTraveler(page, '/checklist/');
    await expect(page.getByTestId('docs-checklist')).toBeVisible();
    await expect(page.getByTestId('docs-progress')).toHaveText('0/18 ready');

    await expect(page.getByTestId('docs-section-critical')).toBeVisible();
    await expect(page.getByTestId('docs-section-dayzero')).toBeVisible();
    await expect(page.getByTestId('docs-section-progress-critical')).toHaveText('0/10');
    await expect(page.getByTestId('docs-section-progress-dayzero')).toHaveText('0/8');

    const checkboxes = page.locator('[data-testid^="docs-item-"]');
    await expect(checkboxes).toHaveCount(18);
    await expect(page.getByTestId('docs-item-passport-validity')).not.toBeChecked();
    await expect(page.getByTestId('docs-item-online-checkin')).not.toBeChecked();
  });
});

test.describe('S217 docs checklist â€” check/uncheck updates progress live', () => {
  test('checking items flips them and increments the progress counts', async ({ page }) => {
    await gotoAsTraveler(page, '/checklist/');
    await expect(page.getByTestId('docs-checklist')).toBeVisible();

    await page.getByTestId('docs-item-passport-validity').check();
    await expect(page.getByTestId('docs-item-passport-validity')).toBeChecked();
    await expect(page.getByTestId('docs-progress')).toHaveText('1/18 ready');
    await expect(page.getByTestId('docs-section-progress-critical')).toHaveText('1/10');

    await page.getByTestId('docs-item-online-checkin').check();
    await expect(page.getByTestId('docs-progress')).toHaveText('2/18 ready');
    await expect(page.getByTestId('docs-section-progress-dayzero')).toHaveText('1/8');

    await page.getByTestId('docs-item-passport-validity').uncheck();
    await expect(page.getByTestId('docs-progress')).toHaveText('1/18 ready');
  });
});

test.describe('S217 docs checklist â€” check -> reload -> persists (the hard guarantee)', () => {
  test('a checked item survives a full page reload; untouched items stay unchecked', async ({ page }) => {
    await gotoAsTraveler(page, '/checklist/');
    await expect(page.getByTestId('docs-checklist')).toBeVisible();

    await page.getByTestId('docs-item-travel-insurance').check();
    await page.getByTestId('docs-item-esim-data').check();
    await expect(page.getByTestId('docs-progress')).toHaveText('2/18 ready');

    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('docs-checklist')).toBeVisible();
    await expect(page.getByTestId('docs-progress')).toHaveText('2/18 ready');
    await expect(page.getByTestId('docs-item-travel-insurance')).toBeChecked();
    await expect(page.getByTestId('docs-item-esim-data')).toBeChecked();
    await expect(page.getByTestId('docs-item-passport-validity')).not.toBeChecked();
  });

  test('a per-item note survives a full page reload', async ({ page }) => {
    await gotoAsTraveler(page, '/checklist/');
    await expect(page.getByTestId('docs-checklist')).toBeVisible();

    const note = page.getByTestId('docs-note-passport-validity');
    await note.fill('Expires 14 Mar 2029');
    await note.blur(); // commit-on-blur (one write, not per keystroke)
    await expect(note).toHaveValue('Expires 14 Mar 2029');

    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('docs-checklist')).toBeVisible();
    await expect(page.getByTestId('docs-note-passport-validity')).toHaveValue('Expires 14 Mar 2029');
  });
});
