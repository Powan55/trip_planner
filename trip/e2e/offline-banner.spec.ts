import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S154 — app-wide offline banner E2E pack.
 *
 * Proves `components/offline-banner.tsx` (mounted once in `app/layout.tsx`) against
 * REAL browser connectivity via `context.setOffline(true/false)` — mirrors
 * `e2e/pwa.spec.ts:223,238`'s use of the same Playwright API. Unlike the PWA pack,
 * this banner needs no service-worker precache warm-up: it is keyed purely on the
 * browser `online`/`offline` events, which `context.setOffline` fires regardless of
 * SW state.
 *
 * IDENTITY: `test`/`expect` from `./fixtures` (signed-in default, D-241) —
 * the banner is global and renders on every route with no additional identity
 * gate; the default fixture is used deliberately.
 *
 * Harness note: `waitUntil: 'load'` (never `networkidle` — D-093) + a ride-through
 * wait for the one-off first-load SW `controllerchange` reload (D-073), mirroring
 * `e2e/favorites.spec.ts`'s `goto` helper.
 */

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
}

test.describe('S154 · offline banner (navigator.onLine)', () => {
  test('absent while online, appears the instant the network drops, disappears when it returns', async ({
    page,
    context,
  }) => {
    await goto(page, '/');

    // 1) Online (default): the banner must not be in the DOM at all.
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);

    // 2) Cut the network — the browser fires a real 'offline' event.
    await context.setOffline(true);
    const banner = page.getByTestId('offline-banner');
    await expect(banner).toBeVisible();

    // A11y: real live region, informational (not alert) semantics. These live on the WRAPPER
    // now, not on the pill — the region is mounted always and empty while online, because a
    // region inserted in the same commit as its text is not reliably announced.
    const region = page.getByTestId('offline-banner-region');
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toHaveAttribute('aria-label', 'You are offline');
    await expect(banner.locator('.sr-only')).toContainText('lost its network connection');

    // 3) Restore the network — the banner clears itself, no dismiss needed. The empty region
    // stays, and drops its label with the pill: while online it claims nothing.
    await context.setOffline(false);
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);
    expect(await region.getAttribute('aria-label')).toBeNull();
  });

  test('renders on a second route too (mounted once at the root layout)', async ({
    page,
    context,
  }) => {
    await goto(page, '/plan/');
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);

    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible();

    // Restore for context teardown hygiene (mirrors pwa.spec.ts:238).
    await context.setOffline(false);
  });
});
