import { expect, type Page } from '@playwright/test';

/** Scroll every still-pending LazyVisible placeholder into view until all have mounted. */
export async function walkLazySections(page: Page) {
  const pending = page.locator('[data-lazy-visible="pending"]');
  await expect(async () => {
    await page.evaluate(() =>
      document.querySelector('[data-lazy-visible="pending"]')?.scrollIntoView(),
    );
    await expect(pending).toHaveCount(0, { timeout: 500 });
  }).toPass({ timeout: 15_000 });
}
