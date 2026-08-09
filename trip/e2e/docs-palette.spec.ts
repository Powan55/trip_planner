import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S217 — command-palette discoverability for `/checklist`. The route is deliberately off the navbar/
 * tab bar (FU-33 pattern, same as packing), so the palette is its desktop discovery path. Proves the
 * "Documents" entry in the "More" group navigates to /checklist on a real run.
 */

async function gotoAsTraveler(page: Page, path: string, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('tripPlannerUserName', t);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1');
    window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss app-wide install toast (duration:Infinity poisons axe scans)
  }, token);
  await page.goto(path, { waitUntil: 'load' });
  await expect(page.locator('h1').first()).toBeVisible();
}

test.describe('S217 command palette — the Documents entry navigates to /checklist', () => {
  test('open ⌘K, type "documents", select, land on /checklist', async ({ page }) => {
    await gotoAsTraveler(page, '/');
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette-dialog')).toBeVisible();

    const input = page.getByPlaceholder('Jump to a section…');
    await input.fill('documents');
    // The "Documents" command item is now the match; select it.
    const item = page.getByRole('option', { name: /Documents/ });
    await expect(item.first()).toBeVisible();
    await item.first().click();

    await expect(page).toHaveURL(/\/checklist\/?$/);
    await expect(page.getByTestId('docs-checklist')).toBeVisible();
    await expect(page.getByTestId('docs-progress')).toHaveText('0/18 ready');
  });

  test('the "passport" keyword alias also surfaces the Documents entry', async ({ page }) => {
    await gotoAsTraveler(page, '/');
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette-dialog')).toBeVisible();
    await page.getByPlaceholder('Jump to a section…').fill('passport');
    await expect(page.getByRole('option', { name: /Documents/ }).first()).toBeVisible();
  });
});
