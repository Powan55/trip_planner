import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S214 — <Reveal> scroll-driven CSS conversion (`components/reveal.tsx`), extending S180's
 * dual-path idiom (`components/scroll-progress.tsx` / e2e/motion.spec.ts's "S180" pack) from
 * the page-progress bar to the section-entrance reveal used across content routes.
 *
 * Proves, on the real served `out/` build (D-093), against the bundled Chromium:
 *   1. Content-route sections still render/reveal correctly (visible, no broken layout) on
 *      /nepal/ (Nepal guide heading) and the photography guide section it embeds — the named
 *      "/photography" is this in-page section (`#photography` / `#photography-heading`), NOT a
 *      standalone route (there isn't one — `app/nepal/sections.tsx` / `app/japan/sections.tsx`
 *      both mount `PhotographyGuide` inline).
 *   2. The CSS path actually engages on this Chromium (`data-scroll-driven="css"`,
 *      `animationName: 'reveal-view-in'`, the `.reveal-view-css` class) — proof it's LIVE, not
 *      just "no visual regression".
 *   3. Reduced motion: the CSS path NEVER renders (`data-scroll-driven` is always `"js"`, no
 *      `.reveal-view-css` node anywhere on the page) — mirrors the S180 pack's reduced-motion
 *      test for scroll-progress.tsx exactly.
 *
 * Harness notes mirror e2e/a11y.spec.ts / e2e/motion.spec.ts: `test`/`expect` from `./fixtures`
 * (signed-in traveler, passes every route gate); ride through the served production build's
 * one-off first-load service-worker reload before reading anything; `waitUntil:'load'`, never
 * networkidle (D-093). Axe-clean on /nepal/ + /japan/ is already covered by the existing
 * e2e/a11y.spec.ts pack (unmodified by this slice — SectionHeading's <Reveal> usage is
 * internals-only, so that pack's live coverage still applies and was re-run as this slice's
 * evidence rather than duplicated here).
 */

async function settleSW(page: Page) {
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

async function gotoSettled(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'load' });
  await settleSW(page);
}

async function gotoReducedSettled(page: Page, path: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path, { waitUntil: 'load' });
  await settleSW(page);
}

test.describe('S214 · Reveal — content routes render/reveal correctly (default motion)', () => {
  test('/nepal/: the Nepal guide heading and the embedded photography guide heading are both visible, no broken layout', async ({
    page,
  }) => {
    await gotoSettled(page, '/nepal/');

    const nepalHeading = page.locator('#nepal-heading');
    await expect(nepalHeading).toBeVisible();
    await expect(nepalHeading).toHaveText(/Nepal Destinations/);

    const photoHeading = page.locator('#photography-heading');
    await photoHeading.scrollIntoViewIfNeeded();
    await expect(photoHeading).toBeVisible();
    await expect(photoHeading).toHaveText(/Photography/);

    // No horizontal overflow (a broken-layout tell) at the default desktop viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('/japan/: the Japan guide heading and the embedded photography guide heading are both visible', async ({
    page,
  }) => {
    await gotoSettled(page, '/japan/');

    const japanHeading = page.locator('#japan-heading');
    await expect(japanHeading).toBeVisible();

    const photoHeading = page.locator('#photography-heading');
    await photoHeading.scrollIntoViewIfNeeded();
    await expect(photoHeading).toBeVisible();
  });
});

test.describe('S214 · Reveal — the scroll-driven CSS path is actually live on this Chromium', () => {
  test('the Nepal heading wrapper renders the CSS path: data-scroll-driven="css", .reveal-view-css, animationName reveal-view-in', async ({
    page,
  }) => {
    await gotoSettled(page, '/nepal/');

    // This Chromium must support the feature — otherwise this test proves nothing.
    expect(await page.evaluate(() => CSS.supports('animation-timeline: view()'))).toBe(true);

    const wrapper = page.locator('#nepal-heading').locator('xpath=ancestor::div[@data-scroll-driven][1]');
    await expect(wrapper).toHaveAttribute('data-scroll-driven', 'css');
    await expect(wrapper).toHaveClass(/reveal-view-css/);
    expect(await wrapper.evaluate((el) => getComputedStyle(el).animationName)).toBe('reveal-view-in');

    // At least one more Reveal instance on the page (the photography heading) also runs the
    // CSS path — proves this isn't a one-off, it's the whole-page conversion.
    const photoWrapper = page
      .locator('#photography-heading')
      .locator('xpath=ancestor::div[@data-scroll-driven][1]');
    await expect(photoWrapper).toHaveAttribute('data-scroll-driven', 'css');
  });
});

test.describe('S214 · Reveal — reduced motion: CSS path NEVER renders (D-007/D-056)', () => {
  test('/nepal/: every Reveal instance is the framer path (data-scroll-driven="js"), .reveal-view-css never appears', async ({
    page,
  }) => {
    await gotoReducedSettled(page, '/nepal/');

    const nepalHeading = page.locator('#nepal-heading');
    await expect(nepalHeading).toBeVisible();

    // Belt-and-braces: not a single .reveal-view-css node exists anywhere on the page.
    expect(await page.locator('.reveal-view-css').count()).toBe(0);
    expect(await page.locator('[data-scroll-driven="css"]').count()).toBe(0);

    const wrapper = page.locator('#nepal-heading').locator('xpath=ancestor::div[@data-scroll-driven][1]');
    await expect(wrapper).toHaveAttribute('data-scroll-driven', 'js');

    const photoHeading = page.locator('#photography-heading');
    await photoHeading.scrollIntoViewIfNeeded();
    await expect(photoHeading).toBeVisible();
    const photoWrapper = page
      .locator('#photography-heading')
      .locator('xpath=ancestor::div[@data-scroll-driven][1]');
    await expect(photoWrapper).toHaveAttribute('data-scroll-driven', 'js');
  });
});

/**
 * S354 / D-246 — the floored fade must NOT reach reduced-motion users.
 *
 * D-246 replaced D-100's opacity PIN (`initial:{opacity:1}` — a slide that never faded)
 * with a FLOOR (`initial:{opacity:FADE_FLOOR}`). On the four sites that had no
 * reduced-motion fork — reveal.tsx, trip-dashboard, flights-section, nightlife-section —
 * that floor would have applied under `prefers-reduced-motion: reduce` too, leaving any
 * reveal whose `whileInView` has not fired resting at 70% opacity. (Issue #106 deleted the
 * trip-dashboard site outright along with its section, so THREE of those four forks remain;
 * the reasoning below and every assertion in this file are unchanged, and the target here
 * has always been reveal.tsx.) That reintroduces, by a
 * different mechanism, exactly the sub-AA contrast failure D-100 exists to prevent — and
 * `e2e/a11y-intrip.spec.ts` scans WITH reduced motion pinned, so axe would sample it.
 *
 * NO EXISTING TEST CAUGHT THIS. `reveal.spec.ts`'s reduced-motion test above uses
 * `toBeVisible()`, which checks bounding box + `visibility`/`display` and NEVER opacity —
 * it passes at 0.7. `motion.spec.ts` / `motion-reduced-audit.spec.ts` assert
 * `animationName` and the running-animation timeline, not computed opacity. This assertion
 * is net-new; the pattern is `e2e/travel-hero.spec.ts`'s headline-opacity read.
 *
 * NEGATIVE CONTROL (run for the S354 gate, not vacuous): against the floored-but-unforked
 * build this test FAILED with a computed opacity of 0.7, and passed once the fork landed.
 * The target is deliberately the photography masthead, which is BELOW THE FOLD on /nepal/
 * at this viewport and is never scrolled to here — so its `whileInView` has not fired and
 * the element is sitting at its `initial` value, which is the whole point.
 */
test.describe('S354 · Reveal — reduced motion rests at FULL opacity (D-246 floor is animated-path only)', () => {
  test('/nepal/: an off-screen Reveal computes to opacity 1 under prefers-reduced-motion', async ({
    page,
  }) => {
    await gotoReducedSettled(page, '/nepal/');

    const photoWrapper = page
      .locator('#photography-heading')
      .locator('xpath=ancestor::div[@data-scroll-driven][1]');
    // Under reduce the CSS path never renders, so this is the framer path carrying the
    // `initial` opacity — the exact element the floor would have stranded at 0.7.
    await expect(photoWrapper).toHaveAttribute('data-scroll-driven', 'js');

    const opacity = await photoWrapper.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBe(1);
  });
});
