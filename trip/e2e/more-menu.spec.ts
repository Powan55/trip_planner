import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Desktop "More" menu E2E pack (slice S256).
 *
 * S320 (D-231): the desktop top row consolidated to 4 primaries (Today·Plan·Map·
 * Guides); the S256 "More ▾" disclosure after them lists the companion routes
 * (navItemsForActiveTrip() minus the primary seats — now 9 on the default trip:
 * Flights/Journal/Safety/Recap/Packing/Documents/Shared Links/Trips/Settings) plus
 * a divider and a "Search ⌘K/Ctrl+K" row that opens the command palette via a
 * `palette:open` window CustomEvent.
 *
 * Harness notes mirror nav-consolidation.spec.ts (D-093): `goto` rides through
 * the one-off first-load SW reload; `waitUntil:'load'`, never networkidle.
 */

const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1280, height: 900 } as const;

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

test.describe('S256 · desktop "More" disclosure', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goto(page, '/');
  });

  test('More trigger is visible on desktop and opens the companion menu', async ({ page }) => {
    const toggle = page.getByTestId('navbar-more-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-controls', 'navbar-more-menu');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByTestId('navbar-more-menu');
    await expect(menu).toBeVisible();

    // S320 (D-231): default trip companions = NAV_ITEMS minus the 4 primary seats →
    // Flights, Journal, Safety, Recap, Packing, Documents, Shared Links, Trips, Settings.
    for (const slug of [
      'flights',
      'journal',
      'safety',
      'recap',
      'packing',
      'documents',
      'shared links',
      'trips',
      'settings',
    ]) {
      await expect(page.getByTestId(`navbar-more-link-${slug}`)).toBeVisible();
    }
    // The Search row shows the shortcut hint.
    const search = page.getByTestId('navbar-more-search');
    await expect(search).toBeVisible();
    await expect(search).toContainText('Ctrl+K');
  });

  test('Journal item navigates to /journal/', async ({ page }) => {
    await page.getByTestId('navbar-more-toggle').click();
    await page.getByTestId('navbar-more-link-journal').click();
    await expect(page).toHaveURL(/\/journal\/?$/);
    // Menu closed after navigation.
    await expect(page.getByTestId('navbar-more-menu')).toHaveCount(0);
  });

  test('Escape closes the menu and returns focus to the trigger', async ({ page }) => {
    const toggle = page.getByTestId('navbar-more-toggle');
    await toggle.click();
    await expect(page.getByTestId('navbar-more-menu')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('navbar-more-menu')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });

  test('outside click closes the menu', async ({ page }) => {
    await page.getByTestId('navbar-more-toggle').click();
    await expect(page.getByTestId('navbar-more-menu')).toBeVisible();
    await page.locator('h1').first().click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId('navbar-more-menu')).toHaveCount(0);
  });

  test('Search row opens the command palette', async ({ page }) => {
    await page.getByTestId('navbar-more-toggle').click();
    await page.getByTestId('navbar-more-search').click();
    await expect(page.getByTestId('navbar-more-menu')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  });

  test('axe: the open More menu has zero serious/critical/moderate violations', async ({ page }) => {
    await page.getByTestId('navbar-more-toggle').click();
    await expect(page.getByTestId('navbar-more-menu')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('[data-testid="navbar"]')
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate',
    );
    expect(
      blocking,
      `a11y violations on the open More menu: ${blocking
        .map((v) => `${v.id} [${v.impact}] × ${v.nodes.length}`)
        .join('; ')}`,
    ).toEqual([]);
  });
});

test.describe('S256 · mobile — More is hidden (D-071 mobile chrome untouched)', () => {
  test('the More trigger does not show below md', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await goto(page, '/');
    await expect(page.getByTestId('navbar')).toBeVisible();
    await expect(page.getByTestId('navbar-more-toggle')).toBeHidden();
    // S319: the mobile hamburger was deleted — the bottom tab bar is the mobile path.
    await expect(page.getByTestId('navbar-menu-toggle')).toHaveCount(0);
    await expect(page.getByTestId('tab-bar')).toBeVisible();
  });
});
