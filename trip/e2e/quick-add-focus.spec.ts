import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Issue #594 — FAB focus return after dialog close.
 *
 * quick-add-host.tsx refocuses `document.activeElement` captured at open time once the
 * dialog's exit animation completes. The FAB used to fully unmount (`return null`) while
 * a dialog was open, so that captured element was disconnected from the DOM and its
 * `.focus()` call silently no-op'd, dropping focus to `<body>`. The FAB now stays mounted
 * (`opacity-0 pointer-events-none`) while the dialog is up — no `aria-hidden`, since the
 * refocus fires before the exiting dialog unmounts and an aria-hidden target would receive
 * focus while still hidden from assistive tech.
 */

const PHONE = { width: 360, height: 800 } as const;

async function gotoSettled(page: Page, path: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(PHONE);
  await page.goto(path, { waitUntil: 'load' });
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {});
  await expect(page.getByTestId('quick-add-fab')).toBeVisible();
}

for (const path of ['/', '/checklist/']) {
  test.describe(`quick-add FAB focus return on ${path}`, () => {
    test('Escape returns focus to the FAB', async ({ page }) => {
      await gotoSettled(page, path);

      const fab = page.getByTestId('quick-add-fab');
      await fab.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('add-item-dialog')).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(page.getByTestId('add-item-dialog')).toHaveCount(0);
      await expect(fab).toBeFocused();
      await expect(fab).not.toHaveAttribute('aria-hidden');
    });

    test('the dialog close button returns focus to the FAB', async ({ page }) => {
      await gotoSettled(page, path);

      const fab = page.getByTestId('quick-add-fab');
      await fab.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByTestId('add-item-dialog');
      await expect(dialog).toBeVisible();

      await page.getByTestId('add-item-cancel').click();
      await expect(dialog).toHaveCount(0);
      await expect(fab).toBeFocused();
      await expect(fab).not.toHaveAttribute('aria-hidden');
    });
  });
}
