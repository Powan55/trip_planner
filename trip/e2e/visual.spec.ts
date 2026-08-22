import { test, expect } from './fixtures';
import type { Page, Locator } from '@playwright/test';

/**
 * Visual-regression baseline pack (slice S86) — E2E wave 5 (part 2).
 *
 * Pixel snapshots of the app's KEY, DETERMINISTIC sections across three viewports
 * (mobile 390 · tablet 768 · desktop 1280), using Playwright's BUILT-IN
 * `toHaveScreenshot` — no new dependency (D-088: `toHaveScreenshot` ships in
 * `@playwright/test`, already installed). The app is dark-mode only (D-009), so
 * the matrix is sections × viewports with NO light/dark doubling.
 *
 * BASELINE PORTABILITY — READ BEFORE TRUSTING A CI FAILURE.
 * These baseline PNGs (committed under `visual.spec.ts-snapshots/`) were generated on
 * Windows and carry a `-win32` suffix. `toHaveScreenshot` is pixel-sensitive to the OS font
 * renderer / GPU rasterizer, so the same build shot on a Linux CI runner would differ by
 * sub-pixel AA on text — but Playwright never gets that far: it looks for a `-linux` file,
 * finds none, and reports a MISSING snapshot, never a diff. ci.yml runs the visual job
 * advisory (continue-on-error) for that reason and carries the promotion path to a blocking
 * Linux job. This caveat is also flagged in the S86 notes.
 *
 * A comparison therefore only ever happens against same-OS baselines, which is why there is
 * no `maxDiffPixelRatio` here (#135): the cross-OS AA drift a tolerance exists to absorb
 * cannot occur on the path that actually compares, while 2% of a 1280x900 hero is ~23k
 * pixels — room to hide a recoloured button or a shifted line of type. Any differing pixel
 * fails. If a Linux baseline set lands and this job goes blocking, measure the drift on that
 * runner rather than restoring 2% from memory.
 *
 * ── Determinism technique (why these screenshots are stable) ────────────────────
 *   1. FROZEN CLOCK. Every navigation carries `?today=2026-11-15` — a fixed
 *      PRE-trip date via the D-075 `?today=` override. With an override active,
 *      `getNow()` returns a CONSTANT `new Date(overrideMs)` (local noon of that
 *      day), so the hero countdown's month/week/day/hour/min/SEC breakdown is
 *      fixed rather than ticking. (Nov 15 is well before Dec 9, so the hero shows
 *      the countdown grid, not travel-mode.)
 *   2. REDUCED MOTION. The context is created with `reducedMotion:'reduce'`, so
 *      the app's reveal/parallax/float/count-up animations collapse to their
 *      settled end-state (D-007/D-056) — no mid-animation frames captured.
 *   3. `animations:'disabled'` in every `toHaveScreenshot` call — Playwright
 *      additionally finishes CSS animations/transitions before capturing.
 *   4. MASKS. Even with a frozen clock we defensively `mask:` the live countdown
 *      region (it is the one surface designed to tick every second) and the
 *      footer's `new Date().getFullYear()` copyright (real wall-clock, NOT the
 *      frozen app clock — would drift across a year boundary / differ on CI). A
 *      masked region is painted over with a solid box, so its pixels never enter
 *      the compare.
 *
 * ── Section choice (stable over flaky) ──────────────────────────────────────────
 *   We snapshot editorial/chrome sections that mount immediately and hold still:
 *   the Home hero (countdown MASKED), each sub-route's PageHero masthead (static
 *   gradient + type, no clock, no lazy stream), the /map shell chrome, and the
 *   shared Footer (year MASKED). We deliberately AVOID the guide card grids and
 *   the live MapLibre canvas — those stream in / re-render and are covered
 *   behaviorally by the interaction/map specs instead.
 *
 * ── Harness notes ───────────────────────────────────────────────────────────────
 *   - `test`/`expect` from `./fixtures` (wall bypass). `waitUntil:'load'`, never
 *     networkidle (D-093).
 *   - The served `out/` is a production build → the SW does ONE first-load reload
 *     (D-073). Screenshotting before it flushes detaches the tree. So `gotoSettled`
 *     rides through the reload (mirror of the S83/S84 `goto`) before any capture.
 *   - `reducedMotion` is a CONTEXT option, so we re-create the context per viewport
 *     via `browser.newContext(...)` inside each viewport block and re-apply the
 *     wall-bypass init script there (the file-level `fixtures` page is not used for
 *     the capture pages — those need the reduced-motion context).
 */

const TODAY = '2026-11-15'; // fixed PRE-trip date (D-075) → frozen countdown, grid visible.

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

// No diff budget: every pixel must match (#135 — see the portability note above).
const SHOT = {
  animations: 'disabled',
  // Screenshot only the targeted element's box; scale to CSS pixels so the
  // baseline is DPR-independent.
  scale: 'css',
} as const;

/**
 * The live per-second countdown region on Home. Frozen by `?today=` AND masked
 * (belt-and-suspenders) — it is the single surface designed to tick, and the
 * one-time count-up reveal can be mid-flight on very first paint.
 */
function countdownMask(page: Page): Locator[] {
  return [
    // The whole countdown grid (six unit cells) + the "N total days" line live in
    // one `.mb-10` wrapper alongside the "Countdown to Departure" label; masking
    // each ticking value cell + the total is precise and survives layout tweaks.
    page.getByTestId('countdown-months'),
    page.getByTestId('countdown-weeks'),
    page.getByTestId('countdown-days'),
    page.getByTestId('countdown-hours'),
    page.getByTestId('countdown-minutes'),
    page.getByTestId('countdown-seconds'),
    page.getByTestId('countdown-total-days'),
    // The ring itself (components/countdown-ring.tsx), not just the digit centered in
    // it: its own docstring says "the ring value itself still updates live every
    // second", same as the digits, but the frozen `?today=` fraction lands at (or
    // extremely near) a full circle pre-trip, and `strokeLinecap="round"` at that
    // fraction renders its seam with a sub-pixel anti-aliasing wobble that is NOT
    // deterministic frame to frame on an identical build (confirmed: reran twice with
    // zero code changes, got 3 then 4 differing pixels at the same spot, under the #135
    // zero-tolerance diff). Masking the whole ring removes that noise instead of hiding
    // a real one — the digit-only mask already established the same exemption.
    page.getByTestId('countdown-ring'),
  ];
}

/** The footer's real-wall-clock copyright year (NOT the frozen app clock). */
function footerYearMask(page: Page): Locator[] {
  // The year sits in the last <p> of the footer; mask that paragraph.
  return [page.locator('footer p').last()];
}

/**
 * Navigate (with the frozen clock) and settle past the first-load SW reload before
 * screenshotting — identical intent to the S83/S84 `goto` settle. Uses the passed
 * `page` (which belongs to the reduced-motion context created per viewport).
 */
async function gotoSettled(page: Page, path: string) {
  const url = path + (path.includes('?') ? '&' : '?') + `today=${TODAY}`;
  await page.goto(url, { waitUntil: 'load' });
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {
      /* no SW / already stable — proceed */
    });
  // Settle any remaining entrance work: wait for the lead <h1> to be visible.
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  // Fonts affect text rasterization; wait for them so a screenshot isn't captured
  // mid-swap (still env-specific, but at least consistent within a run).
  await page.evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.ready).catch(() => {});
}

// One describe per viewport so each gets its OWN reduced-motion context (a context
// option) with the identity init script re-applied.
for (const vp of VIEWPORTS) {
  test.describe(`visual · ${vp.name} (${vp.width}px)`, () => {
    // Per-viewport reduced-motion context. We cannot set reducedMotion on the
    // fixtures' shared page (it is a context option), so build a dedicated context
    // and re-seed the identity (mirror of fixtures.ts) on it.
    let ctx: Awaited<ReturnType<Page['context']>>;
    let page: Page;

    test.beforeEach(async ({ browser }) => {
      ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        reducedMotion: 'reduce',
        deviceScaleFactor: 1,
      });
      // S113E: seed the SIGNED-IN traveler identity (mirror of fixtures.ts's new default) —
      // with no guest mode (D-241), any unidentified session sees the front-door wall on
      // EVERY route, which would put the wall in every sub-route screenshot.
      await ctx.addInitScript(() => {
        window.localStorage.setItem('tripPlannerToken', 'Powan');
        window.localStorage.setItem('tripPlannerUserName', 'Powan');
        // S155: this block owns its OWN context (not the shared fixtures.ts page), so it
        // must ALSO pre-seed the first-run-tour "seen" flag — otherwise the tour's
        // full-screen dialog fires on fresh storage and lands in every hero/footer baseline.
        window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1');
        window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss app-wide install toast (duration:Infinity poisons axe scans)
      });
      page = await ctx.newPage();
    });

    test.afterEach(async () => {
      await ctx.close();
    });

    test('home hero (countdown masked)', async () => {
      await gotoSettled(page, '/');
      // The hero <section id="hero"> is the masthead; mask the ticking countdown.
      await expect(page.locator('section#hero')).toHaveScreenshot(`home-hero-${vp.name}.png`, {
        ...SHOT,
        mask: countdownMask(page),
      });
    });

    test('nepal page hero', async () => {
      await gotoSettled(page, '/nepal/');
      // The PageHero <header> is the first <header> on the page (static gradient +
      // type; no clock, no lazy stream) — a rock-stable masthead to baseline.
      await expect(page.locator('header').first()).toHaveScreenshot(`nepal-hero-${vp.name}.png`, SHOT);
    });

    test('japan page hero', async () => {
      await gotoSettled(page, '/japan/');
      await expect(page.locator('header').first()).toHaveScreenshot(`japan-hero-${vp.name}.png`, SHOT);
    });

    test('plan page hero', async () => {
      await gotoSettled(page, '/plan/');
      await expect(page.locator('header').first()).toHaveScreenshot(`plan-hero-${vp.name}.png`, SHOT);
    });

    test('map page hero', async () => {
      await gotoSettled(page, '/map/');
      await expect(page.locator('header').first()).toHaveScreenshot(`map-hero-${vp.name}.png`, SHOT);
    });

    test('place detail sheet meta dl (open, ja1)', async () => {
      // FU-38: no OPEN-place-detail-sheet baseline existed before this — the gap that
      // let the `only-dlitems` axe defect in the meta `<dl>` ship uncaught. ja1
      // (Senso-ji Temple) is the one item with ALL FOUR optional meta fields
      // (bestTime/duration/priceHint/rating), so all four dt/dd rows render.
      await gotoSettled(page, '/japan/');
      await expect(page.getByTestId('guide-search-input')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('guide-card-ja1').click();
      const sheet = page.getByTestId('place-detail-sheet');
      await expect(sheet).toBeVisible();
      const dl = sheet.locator('dl');
      await expect(dl).toHaveScreenshot(`place-detail-dl-${vp.name}.png`, SHOT);
    });

    test('command palette (open, FU-39 baseline)', async () => {
      // FU-39: no baseline covered the OPEN command palette before this — the gap
      // S157 flagged (its 6th close-X, the shared `ui/dialog.tsx` DialogPrimitive.Close,
      // was deliberately left unfixed pending exactly this baseline). Opened via the
      // real ⌘K/Ctrl+K shortcut (command-palette.tsx), not a direct DOM poke.
      await gotoSettled(page, '/');
      await page.keyboard.press('Control+k');
      const dialog = page.getByTestId('command-palette-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveScreenshot(`command-palette-${vp.name}.png`, SHOT);
    });

    test('footer (shared chrome, year masked)', async () => {
      // Screenshot from any route; use /nepal/ where the footer sits below a short,
      // static page so it is reachable without heavy lazy content in between.
      await gotoSettled(page, '/nepal/');
      const footer = page.locator('footer');
      await footer.scrollIntoViewIfNeeded();
      await expect(footer).toHaveScreenshot(`footer-${vp.name}.png`, {
        ...SHOT,
        mask: footerYearMask(page),
      });
    });
  });
}
