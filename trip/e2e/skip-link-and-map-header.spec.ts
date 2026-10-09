import { test, expect } from './fixtures';

test('skip link has a target when signed in, and is absent on the wall', async ({ page, browser }) => {
  await page.goto('/');
  await expect(page.locator('#main')).toBeAttached();
  await expect(page.locator('a[href="#main"]')).toHaveCount(1);

  const ctx = await browser.newContext();
  const wall = await ctx.newPage();
  await wall.goto('/');
  await expect(wall.locator('#main')).toHaveCount(0);
  await expect(wall.locator('a[href="#main"]')).toHaveCount(0);
  await ctx.close();
});

test('map header collapses on phones and keeps its subtitle on desktop', async ({ page }) => {
  const body = page.locator('.photo-header__body');
  const sub = body.locator('p').last();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/map/');
  await expect(body).toBeAttached();
  await expect(sub).toBeHidden();
  expect(await body.evaluate((e) => parseFloat(getComputedStyle(e).paddingBottom))).toBeLessThan(14);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(sub).toBeVisible();
});
