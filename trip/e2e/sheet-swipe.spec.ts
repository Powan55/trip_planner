import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function openPlaceSheet(page: Page) {
  await page.goto('/nepal/', { waitUntil: 'domcontentloaded' });
  const card = page.getByTestId('guide-card-na1');
  await expect(card).toBeAttached({ timeout: 20_000 });
  await card.click();
  const sheet = page.getByTestId('place-detail-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS('opacity', '1');
  return sheet;
}

async function touchDrag(page: Page, dy: number, steps: number, stepMs: number) {
  const box = await page.getByTestId('sheet-grab-handle').boundingBox();
  if (!box) throw new Error('grab handle not rendered');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', ty: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y: ty }],
    });
  await touch('touchStart', y);
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', y + (dy * i) / steps);
    await page.waitForTimeout(stepMs);
  }
  await touch('touchEnd', y + dy);
}

test('a long swipe down on the grab handle dismisses the sheet', async ({ page }) => {
  const sheet = await openPlaceSheet(page);
  await touchDrag(page, 300, 10, 30);
  await expect(sheet).toHaveCount(0);
});

test('a short fast flick dismisses the sheet', async ({ page }) => {
  const sheet = await openPlaceSheet(page);
  await touchDrag(page, 90, 3, 0);
  await expect(sheet).toHaveCount(0);
});

test('a short slow drag springs back and keeps the sheet open', async ({ page }) => {
  const sheet = await openPlaceSheet(page);
  await touchDrag(page, 40, 8, 60);
  await page.waitForTimeout(400);
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate((el) => getComputedStyle(el).translate)).toBe('none');
});

test('swipe dismiss still works under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const sheet = await openPlaceSheet(page);
  await touchDrag(page, 300, 10, 30);
  await expect(sheet).toHaveCount(0);
});
