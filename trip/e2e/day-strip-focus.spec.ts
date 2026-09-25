import { test, expect } from './fixtures';

/**
 * #597 — keyboard Tab into a day-strip chip that isn't fully in view must center it.
 *
 * The strip auto-centers the SELECTED chip on mount/change (day-strip.tsx) via manual
 * scrollLeft math (not `scrollIntoView`, so a horizontal centering never nudges the page's
 * vertical scroll). A chip reached by keyboard Tab only got the browser's default
 * "nearest edge" scroll-into-view, which lands the chip flush to an edge rather than
 * centered — measurably different from the selection behavior and easy to read as still
 * "off to the side" on a narrow phone strip. The fix re-runs the same centering on
 * `onFocus`, so Tab lands the chip the same place a tap/select would.
 */
const PHONE = { width: 360, height: 800 } as const;

test('Tab-focusing a day chip not fully in view centers it in the strip, like selection does', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // instant scrollLeft, no smooth-scroll race
  await page.setViewportSize(PHONE);
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });

  const scroller = page.getByTestId('day-strip');
  await scroller.waitFor({ state: 'attached' });

  const chips = page.locator('[data-testid^="day-strip-"]');
  const testIds = await chips.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  const targetIdx = Math.floor(testIds.length / 2); // a chip with room to center on both sides
  const target = testIds[targetIdx]!;
  const prev = testIds[targetIdx - 1]!;

  // Pin the strip fully left so the target chip starts outside (or only partly inside) the
  // scroller's visible rect.
  await scroller.evaluate((el) => {
    el.scrollLeft = 0;
  });
  const scrollerBoxBefore = (await scroller.boundingBox())!;
  const targetBoxBefore = (await page.locator(`[data-testid="${target}"]`).boundingBox())!;
  expect(targetBoxBefore.x + targetBoxBefore.width).toBeGreaterThan(
    scrollerBoxBefore.x + scrollerBoxBefore.width,
  );

  // Real keyboard Tab, one press, from the chip immediately before the target — the actual
  // path a user's Tab key takes through the strip.
  await page.locator(`[data-testid="${prev}"]`).evaluate((el: HTMLElement) => el.focus());
  await page.keyboard.press('Tab');
  await expect(page.locator(`[data-testid="${target}"]`)).toBeFocused();

  const scrollerBox = (await scroller.boundingBox())!;
  const chipBox = (await page.locator(`[data-testid="${target}"]`).boundingBox())!;

  // Fully inside the scroller's visible rect...
  expect(chipBox.x).toBeGreaterThanOrEqual(scrollerBox.x - 1);
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(scrollerBox.x + scrollerBox.width + 1);
  // ...and actually CENTERED there (not just edge-clipped-in, which the browser's default
  // "nearest" scroll-into-view would also satisfy).
  const chipCenter = chipBox.x + chipBox.width / 2;
  const scrollerCenter = scrollerBox.x + scrollerBox.width / 2;
  expect(Math.abs(chipCenter - scrollerCenter)).toBeLessThan(4);

  // Not hidden under the "Month view" toggle beside the strip.
  const monthToggleBox = (await page.getByTestId('calendar-month-view-toggle').boundingBox())!;
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(monthToggleBox.x);
});
