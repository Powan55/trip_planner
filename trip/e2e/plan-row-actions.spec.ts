import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const day = '2026-12-09';
const longTitle = 'Depart Kathmandu - Regional connection to Pokhara with a long layover at the domestic terminal';
const item = { id: 'row-actions-item', title: longTitle, category: 'transportation' };

async function openPlan(page: Page) {
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });
  await page.evaluate(({ day, item }) => {
    localStorage.setItem('nepal_japan_itinerary', JSON.stringify([
      { date: day, city: 'Kathmandu', country: 'nepal', items: [item] },
    ]));
  }, { day, item });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });
}

const actions = (page: Page) => page.getByTestId(`calendar-item-delete-${item.id}`).locator('..');

test.describe('touch tablet', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('row actions are visible without hover', async ({ page }) => {
    await openPlan(page);
    await expect(actions(page)).toHaveCSS('opacity', '1');
  });
});

test.describe('mouse desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('row actions reveal on hover and keyboard focus', async ({ page }) => {
    await openPlan(page);
    await expect(actions(page)).toHaveCSS('opacity', '0');
    await page.getByTestId(`calendar-item-${item.id}`).hover();
    await expect(actions(page)).toHaveCSS('opacity', '1');
    await page.mouse.move(0, 0);
    await expect(actions(page)).toHaveCSS('opacity', '0');
    await page.getByTestId(`calendar-item-edit-${item.id}`).focus();
    await expect(actions(page)).toHaveCSS('opacity', '1');
  });
});

test('long row title wraps to two lines and keeps the full text reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlan(page);
  const title = page.getByTestId(`calendar-item-${item.id}`).getByText(longTitle, { exact: true });
  await expect(title).toHaveAttribute('title', longTitle);
  const { lineHeight, height } = await title.evaluate((el) => ({
    lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    height: el.getBoundingClientRect().height,
  }));
  expect(height).toBeGreaterThan(lineHeight * 1.5);
});
