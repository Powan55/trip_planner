import { test, expect } from './fixtures';

// Installed iOS app draws under the status bar. Force --safe-top and check nothing sits under the navbar.
test.use({ viewport: { width: 390, height: 844 } });

for (const path of ['/passport/', '/plan/', '/nepal/']) {
  test(`navbar clears the status bar and content on ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });
    await page.addStyleTag({ content: ':root{--safe-top:59px !important}' });
    const nav = page.getByTestId('navbar');
    await expect(nav).toBeVisible();
    await expect.poll(async () => (await nav.boundingBox())!.y).toBe(0);
    const navBox = (await nav.boundingBox())!;
    const brand = (await page.getByTestId('navbar-brand').boundingBox())!;
    expect(brand.y).toBeGreaterThanOrEqual(59);

    const h1 = (await page.locator('main h1').first().boundingBox())!;
    expect(h1.y).toBeGreaterThanOrEqual(navBox.y + navBox.height);

    // sticky strips dock below the navbar once scrolled
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(300);
    const navBottom = ((await nav.boundingBox())!).y + ((await nav.boundingBox())!).height;
    const stuck = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('main *')]
          .filter((e) => getComputedStyle(e).position === 'sticky')
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.bottom > 0 && r.top < 200)
          .map((r) => r.top),
    );
    for (const top of stuck) expect(top).toBeGreaterThanOrEqual(navBottom - 1);
  });
}
