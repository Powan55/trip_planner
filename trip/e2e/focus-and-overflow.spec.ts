import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * #593 — Tab-focus must clear the fixed navbar and (below md) the fixed bottom tab bar
 * (WCAG 2.4.11). #595 — a long visited-city chip must wrap instead of pushing the page wider
 * than the viewport.
 */

async function gotoAsTraveler(page: Page, path: string, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('tripPlannerUserName', t);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1');
    window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1');
  }, token);
  await page.goto(path, { waitUntil: 'load' });
}

test.describe('#593 — scroll-padding clears the fixed header and tab bar', () => {
  test('/packing/ at 360: every Tab stop lands clear of the header and tab bar', async ({ browser }) => {
    // reducedMotion: the navbar's mount entrance (`initial={{ y: -100 }}`) would otherwise
    // still be mid-transition while this races through Tab presses, reading a false negative.
    const context = await browser.newContext({
      viewport: { width: 360, height: 740 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await gotoAsTraveler(page, '/packing/');
    await expect(page.getByTestId('packing-checklist')).toBeVisible();

    const navbarBox = (await page.getByTestId('navbar').boundingBox())!;
    const headerBottom = navbarBox.y + navbarBox.height;
    const tabBarTop = (await page.getByTestId('tab-bar').boundingBox())!.y;

    // Tab through the whole page; each stop must clear both fixed bars once it's scrolled to.
    let checked = 0;
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      const rect = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        // WCAG 2.4.11 is about SCROLLED content landing under the fixed chrome — the chrome's
        // own controls (skip-link, navbar, tab-bar) are always docked, never scrolled to, so
        // they're exempt from their own clearance check.
        if (el.closest('[data-testid="navbar"], [data-testid="tab-bar"]')) return null;
        if (getComputedStyle(el).position === 'fixed') return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      });
      if (!rect || rect.height === 0) continue;
      checked++;
      expect(rect.bottom, `focus stop ${i} sits under the header`).toBeGreaterThan(headerBottom);
      expect(rect.top, `focus stop ${i} sits under the tab bar`).toBeLessThan(tabBarTop);
    }
    // A wrong selector/page state would tab through nothing and pass vacuously.
    expect(checked).toBeGreaterThan(5);
    await context.close();
  });
});

test.describe('#595 — long visited-city chip wraps instead of overflowing', () => {
  test('/profile/ at 360: a long city name does not widen the page', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await gotoAsTraveler(page, '/profile/');
    await expect(page.getByTestId('visited-city-form')).toBeVisible();

    await page.getByTestId('visited-city-input').fill('Ciudad Autónoma de Buenos Aires');
    await page.getByTestId('visited-city-add').click();
    await expect(page.getByText('Ciudad Autónoma de Buenos Aires', { exact: true })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });

  // A multi-word name wraps at a space even without break-words; a single unbroken word only
  // wraps if break-words is actually doing something. This is the case that would still fail
  // if the fix only added whitespace-normal.
  test('/profile/ at 360: a long single-word city name does not widen the page', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await gotoAsTraveler(page, '/profile/');
    await expect(page.getByTestId('visited-city-form')).toBeVisible();

    await page.getByTestId('visited-city-input').fill('Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch');
    await page.getByTestId('visited-city-add').click();
    await expect(
      page.getByText('Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch', { exact: true }),
    ).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });
});
