import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Issue #223 — the print stylesheet, which nothing else in the suite can see.
 *
 * The visual baselines render at `screen`, so they cannot observe a single rule in the
 * `@media print` block: they are not weak evidence for it, they are no evidence. Everything
 * here runs under `emulateMedia({ media: 'print' })`, which is the only way to assert on it.
 *
 * The width assertion is the one that earns its keep. `overflow: visible !important` on `*`
 * is the pagination fix — a clipped box cannot flow onto page 2 — but it also unclips
 * `.sr-only`, whose `clip: rect(0,0,0,0)` is a PAINT clip rather than a layout one. Nothing
 * invisible then prints, but the document lays out far wider than the page, which makes the
 * print dialog silently shrink-to-fit everything. It measured 1905px against a 794px A4 page
 * on /checklist before the `.sr-only` carve-out went in. A blank-looking page and a
 * shrunk-to-illegible one are both failures nobody notices until they are holding the paper.
 */

const A4 = { width: 794, height: 1123 };

async function gotoPrint(page: Page, path: string, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('tripPlannerUserName', t);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1');
  }, token);
  await page.setViewportSize(A4);
  await page.emulateMedia({ media: 'print' });
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

test.describe('#223 the print stylesheet', () => {
  test('/plan prints the whole-trip sheet and hides the app chrome', async ({ page }) => {
    await gotoPrint(page, '/plan/');

    const sheet = page.locator('[data-testid="print-itinerary"]');
    await expect(sheet).toBeVisible();

    // One block per trip date, and exactly one leg change — Nepal to Japan. That break is
    // what makes the two legs come off the printer as separate sheets.
    await expect(sheet.locator('.print-day')).toHaveCount(32);
    await expect(sheet.locator('.print-day[data-leg-start]')).toHaveCount(1);

    // Chrome must not reach paper. The print button least of all: printing a picture of a
    // print button is the kind of thing that survives review precisely because it is funny.
    // No count() guard — if one of these test ids is gone the assertion should fail loudly
    // rather than skip itself into a green run.
    for (const sel of ['[data-testid="navbar"]', '[data-testid="print-button"]']) {
      await expect(page.locator(sel).first()).toHaveCSS('display', 'none');
    }
  });

  test('the planner itself is hidden on paper, so the sheet is the only itinerary', async ({
    page,
  }) => {
    await gotoPrint(page, '/plan/');
    // The route hides its screen surfaces with bare `print:hidden` wrappers (app/plan/page.tsx).
    // Asserting on those directly is what guards against the sheet and the planner BOTH
    // printing — the same 32 days twice over, which is worse than either alone.
    const wrappers = page.locator('#main .print\\:hidden');
    const n = await wrappers.count();
    expect(n, 'the print:hidden wrappers on /plan went missing').toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await expect(wrappers.nth(i)).toHaveCSS('display', 'none');
    }
  });

  // Runs on the two routes most likely to be printed, and on /checklist specifically because
  // that is where the sr-only regression showed up.
  for (const path of ['/plan/', '/checklist/', '/safety/']) {
    test(`${path} lays out within the page width in print media`, async ({ page }) => {
      await gotoPrint(page, path);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      // Not a tolerance: anything wider than the page means the browser scales the whole
      // document down to fit, and the failure is illegible paper rather than a visible break.
      expect(scrollWidth, `${path} overflows the printable width`).toBeLessThanOrEqual(
        clientWidth,
      );
    });
  }

  test('the screen layout is untouched — the block cannot match at screen', async ({ page }) => {
    await gotoPrint(page, '/plan/');
    await page.emulateMedia({ media: 'screen' });
    // The sheet is print-only; at screen it must be gone and the chrome must be back.
    await expect(page.locator('[data-testid="print-itinerary"]')).toBeHidden();
    const navbar = page.locator('[data-testid="navbar"]').first();
    if (await navbar.count()) {
      await expect(navbar).not.toHaveCSS('display', 'none');
    }
  });
});
