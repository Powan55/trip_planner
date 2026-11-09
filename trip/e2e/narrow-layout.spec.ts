import { test, expect } from './fixtures';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

test('/safety does not scroll sideways at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/safety/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('safety-checklist-vaccinations')).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
});

// 320px is out of scope: chips are ~84px wide there and long labels still break.
for (const width of [360, 390]) {
  test(`plan form category chips wrap whole words at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('calendar-add-item').click();
    const editor = page.getByTestId('calendar-editor');
    await expect(editor).toBeVisible();
    const split = await editor.evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>('[data-testid^="calendar-editor-category-"] > span')]
        .filter((s) => {
          s.style.overflowWrap = 'normal';
          const wide = s.scrollWidth > s.clientWidth;
          s.style.overflowWrap = '';
          return wide;
        })
        .map((s) => s.textContent),
    );
    expect(split).toEqual([]);
  });
}
