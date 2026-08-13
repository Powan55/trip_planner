import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Fake-clock countdown + date-boundary pack (slice S82, D-075) — E2E wave 2.
 *
 * Drives the app-wide clock via the `?today=YYYY-MM-DD` override
 * (`lib/trip-now.ts`, LOCKED D-075) against the served static `out/` build, and
 * proves the hero countdown / travel-mode panel and the dashboard's clock-derived
 * cards flip correctly across the whole trip window: pre-trip countdown math,
 * the in-trip "Day N — city" panel, the Dec-19 Nepal→Japan boundary (the
 * permanent B-01 regression guard fixed at S60), the full four-corner boundary
 * matrix, the post-trip state, and `?today=off` restoring the real clock.
 *
 * ── Determinism notes (read before touching numbers) ────────────────────────
 *
 * 1. `getNow()` returns a FROZEN instant while a `?today=` override is active
 *    (`lib/trip-now.ts`: `overrideMs` is a fixed epoch value, never `Date.now()`),
 *    constructed at LOCAL NOON of the given day. So every clock-derived value in
 *    this pack is a fixed, computable target — not a moving one — and can be
 *    asserted exactly.
 *
 * 2. Two animation layers sit between that frozen target and the DOM, and both
 *    are neutralized the same way (`page.emulateMedia({ reducedMotion: 'reduce' })`,
 *    set once per test before navigating):
 *      - `useCountUp` (hooks/use-count-up.ts): a ~2s eased count-up reveal for
 *        every countdown unit and every dashboard stat. Under reduced motion it
 *        skips the rAF loop and reports the final value immediately (D-056b).
 *      - The dashboard's `StatCard` `whileInView` scroll-reveal (`opacity`/`y`
 *        transition on first intersection). Reduced motion collapses this too,
 *        but the card must still be SCROLLED INTO VIEW at least once for
 *        `viewport={{ once: true }}` to fire at all — confirmed live (CDP probe
 *        during this slice) that a dashboard `data-testid` card sits at
 *        `opacity: 0` (Playwright: not visible) until scrolled into view, even
 *        under reduced motion. `scrollDashboardIntoView()` below does this.
 *
 * 3. Exact numbers below were computed two ways and cross-checked: (a) by hand
 *    against `lib/countdown.ts`'s `computeCountdown` (whole days via date-fns, then
 *    carried maximally into 28-day months / 7-day weeks / days, with the
 *    hour/min/sec residue measured from `now`) and `lib/trip-data.ts`'s
 *    `TRIP_DATES`/`getCountryForDate`; (b) by a live CDP probe of the actual
 *    served `out/` build for every `?today=` value used here, under
 *    `reducedMotion: 'reduce'`, confirming the DOM text matches the hand
 *    computation exactly.
 */

const BASE_URL = 'http://127.0.0.1';

/** Navigate with the `?today=` override applied and reduced motion pinned. */
async function gotoWithClock(page: Page, todayParam: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/?today=${todayParam}`, { waitUntil: 'load' });
}

/**
 * Scroll the dashboard's Trip Status card into view so its `whileInView` reveal
 * fires at least once (see note 2 above), then give the (now-instant, reduced-
 * motion) reveal a moment to flip `opacity`/`display` before asserting.
 */
async function scrollDashboardIntoView(page: Page) {
  await page.getByTestId('dashboard-trip-status').scrollIntoViewIfNeeded();
}

test.describe('Pre-trip countdown + total-days math (D-016 computeCountdown, frozen clock)', () => {
  test('?today=2026-11-09 (local noon) -> exact countdown breakdown, Upcoming status', async ({
    page,
  }) => {
    // Nov 9, 2026 12:00 local -> Dec 9, 2026 00:00 local (TRIP_START) is EXACTLY
    // 1 month / 0 weeks / 1 day / 12 hours / 0 min / 0 sec remaining, totalDays=29.
    //
    // The TOTAL has never moved (29d 12h; totalDays still 29) and still sums back to the
    // exact target instant. Only the bucketing has: this pinned `04` weeks / `01` day, then
    // `29` days once "4 weeks" was banned, and issue #11 carries it properly: 29 = 28 + 1,
    // so 1 month 1 day. THIS IS THE REPORTED BUG'S EXACT INSTANT: weeks is 0 here, and a
    // zero unit is not rendered, so the Weeks cell must be ABSENT rather than showing "00".
    await gotoWithClock(page, '2026-11-09');

    // Travel-mode panel must be ABSENT outside the trip window.
    await expect(page.getByTestId('hero-travel-mode')).toHaveCount(0);

    // Countdown grid IS present and shows the exact frozen breakdown.
    await expect(page.getByTestId('countdown-months')).toHaveText('01');
    await expect(page.getByTestId('countdown-weeks')).toHaveCount(0);
    await expect(page.getByTestId('countdown-days')).toHaveText('01');
    await expect(page.getByTestId('countdown-hours')).toHaveText('12');
    await expect(page.getByTestId('countdown-minutes')).toHaveText('00');
    await expect(page.getByTestId('countdown-seconds')).toHaveText('00');
    await expect(page.getByTestId('countdown-total-days')).toHaveText('29');

    // Dashboard: status = "Upcoming", duration = the full 32-day trip, days
    // remaining mirrors the countdown's totalDays (29).
    await scrollDashboardIntoView(page);
    await expect(page.getByTestId('dashboard-trip-status')).toContainText('Upcoming');
    await expect(page.getByTestId('dashboard-trip-duration')).toContainText('32');
    await expect(page.getByTestId('dashboard-days-remaining')).toContainText('29');
  });
});

test.describe('In-trip flip — "Day N — city" panel replaces the countdown', () => {
  test('?today=2026-12-12 -> Day 4, Kathmandu (Nepal window), countdown grid hidden, On the trip', async ({
    page,
  }) => {
    await gotoWithClock(page, '2026-12-12');

    await expect(page.getByTestId('hero-travel-mode')).toBeVisible();
    await expect(page.getByTestId('hero-day-number')).toHaveText('4');
    await expect(page.getByTestId('hero-travel-mode')).toContainText('Kathmandu');

    // Countdown grid must be ABSENT while in travel mode.
    await expect(page.getByTestId('countdown-days')).toHaveCount(0);
    await expect(page.getByTestId('countdown-total-days')).toHaveCount(0);

    await scrollDashboardIntoView(page);
    await expect(page.getByTestId('dashboard-trip-status')).toContainText('On the trip');
  });
});

test.describe('Dec-19 boundary — permanent B-01 regression guard', () => {
  test('?today=2026-12-19 -> Day 11, Osaka/Japan (NOT Nepal/Kathmandu)', async ({ page }) => {
    // B-01 (fixed S60): a naive `new Date('2026-12-19')` UTC-midnight parse could
    // slip Dec 19 into the Nepal window at negative UTC offsets. The local-noon
    // override construction in trip-now.ts + the lexicographic getCountryForDate
    // comparison in trip-data.ts are the fix; this is the permanent guard.
    // S112 (D-124): the Japan leg is now Osaka -> Kyoto -> Tokyo, so Dec-19's city
    // changed from Tokyo to Osaka — the invariant this guard actually protects
    // ("Japan window, NOT Kathmandu") is unchanged.
    await gotoWithClock(page, '2026-12-19');

    await expect(page.getByTestId('hero-travel-mode')).toBeVisible();
    await expect(page.getByTestId('hero-day-number')).toHaveText('11');
    await expect(page.getByTestId('hero-travel-mode')).toContainText('Osaka');
    await expect(page.getByTestId('hero-travel-mode')).not.toContainText('Kathmandu');
  });
});

test.describe('Boundary matrix (S65) — all four corners of the trip window', () => {
  const CASES = [
    // S393 (Q4): Dec 9 is spent in Syracuse, JFK and the air, so the hero names Syracuse — the
    // day is still Day 1 of the Nepal leg. Changed in deliberate lockstep with the content root
    // (the S112/D-124 pattern for a frozen boundary city).
    { today: '2026-12-09', day: '1', city: 'Syracuse', label: 'Dec 9 -> Day 1 (Nepal start)' },
    { today: '2026-12-18', day: '10', city: 'Kathmandu', label: 'Dec 18 -> Day 10 (Nepal end)' },
    { today: '2026-12-19', day: '11', city: 'Osaka', label: 'Dec 19 -> Day 11 (Japan start)' },
    { today: '2027-01-09', day: '32', city: 'Tokyo', label: 'Jan 9 -> Day 32 (Japan end / trip end)' },
  ] as const;

  for (const { today, day, city, label } of CASES) {
    test(`${label}`, async ({ page }) => {
      await gotoWithClock(page, today);
      await expect(page.getByTestId('hero-travel-mode')).toBeVisible();
      await expect(page.getByTestId('hero-day-number')).toHaveText(day);
      await expect(page.getByTestId('hero-travel-mode')).toContainText(city);
    });
  }
});

test.describe('Post-trip state', () => {
  test('?today=2027-01-15 -> travel mode gone, countdown grid shows the zero clock (isPast), Completed', async ({
    page,
  }) => {
    // Jan 15, 2027 is outside TRIP_DATES entirely (trip ends Jan 9), so
    // getTodayInTrip() is null and the hero falls back to the countdown branch.
    // computeCountdown returns its ZERO_PAST shape once `now >= target`. Since issue #11
    // a zero calendar unit is not rendered, so months/weeks/days are ABSENT here; the
    // clock cells stay (they tick, and a running clock reading 00 is a clock) and read "00".
    await gotoWithClock(page, '2027-01-15');

    await expect(page.getByTestId('hero-travel-mode')).toHaveCount(0);
    await expect(page.getByTestId('countdown-months')).toHaveCount(0);
    await expect(page.getByTestId('countdown-weeks')).toHaveCount(0);
    await expect(page.getByTestId('countdown-days')).toHaveCount(0);
    await expect(page.getByTestId('countdown-hours')).toHaveText('00');
    await expect(page.getByTestId('countdown-minutes')).toHaveText('00');
    await expect(page.getByTestId('countdown-seconds')).toHaveText('00');
    await expect(page.getByTestId('countdown-total-days')).toHaveText('0');

    await scrollDashboardIntoView(page);
    await expect(page.getByTestId('dashboard-trip-status')).toContainText('Completed');
  });
});

/**
 * Slack the CTA must keep below the fold line. It has to EXCEED the widest measured
 * reflow delta, which is 10.625px: at a 345px layout width (360 minus a Linux 15px
 * scrollbar) the hero badge's date label wraps to a second line, and because the hero
 * block is vertically centred the CTA only absorbs HALF of that 21.25px (issue #54 E2).
 * A margin under 12 makes this spec pass or fail on which platform's scrollbar is
 * present rather than on the layout.
 */
const FOLD_MARGIN_PX = 12;
const FOLD_HEIGHT_PX = 740;

test.describe('S258: hero first CTA clears the fold on an xs viewport', () => {
  // 320 is the narrowest supported width and the WORST case (the badge and the CTA row
  // are widest relative to the viewport there); it used to sit 19.25px BELOW the fold on
  // every platform, and nothing covered it — CI only ever caught the 345px wrap by
  // accident, via the Linux scrollbar. Both widths are now asserted explicitly.
  for (const width of [320, 360] as const) {
    test(`the single "Open Planner" CTA sits fully in-viewport at ${width}×${FOLD_HEIGHT_PX} (total-days ring hidden below 420px)`, async ({
      page,
    }) => {
      // xs phone; pre-trip clock so the countdown branch (not travel mode) renders — the
      // tallest hero state. Reduced motion pins the reveal to its final layout immediately.
      await page.setViewportSize({ width, height: FOLD_HEIGHT_PX });
      await gotoWithClock(page, '2026-11-09');

      // The countdown grid must still be present (only the total-days ring is cut on xs;
      // S321 removed the decorative quote entirely).
      await expect(page.getByTestId('countdown-days')).toBeVisible();
      // The xs-hidden element: the total-days ring wrapper is display:none below 420px.
      await expect(page.getByTestId('countdown-total-days')).toBeHidden();

      // READINESS — measure the SETTLED layout, not a mid-load one. Home's lazy islands
      // (the trip strip above the hero especially) each render a sized placeholder until
      // they mount, so a geometry read taken cold sees the hero ~700px lower than it ends
      // up. Waiting for zero pending placeholders is the precedent in
      // `s158-expense-csv-and-home-nav.spec.ts`, and it is D-093-clean: a real DOM
      // condition, no `networkidle` and no sleep. (Do NOT wait on the strip's testid
      // instead — that island renders null when signed out and the wait would hang.)
      await expect(page.locator('[data-lazy-visible="pending"]')).toHaveCount(0);

      // S321 — the hero collapsed to ONE primary CTA (was "View Itinerary" among 4).
      const cta = page.getByRole('link', { name: 'Open Planner' });
      await expect(cta).toBeVisible();
      const box = await cta.boundingBox();
      expect(box).not.toBeNull();
      // Fully within the fold, with margin: top non-negative, bottom at or above the line.
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(FOLD_HEIGHT_PX - FOLD_MARGIN_PX);
    });
  }
});

test.describe('?today=off restores the real clock', () => {
  test('after an override, ?today=off falls back to the real (pre-trip) clock', async ({
    page,
  }) => {
    // First land on an in-trip override so travel mode is showing...
    await gotoWithClock(page, '2026-12-12');
    await expect(page.getByTestId('hero-travel-mode')).toBeVisible();

    // ...then explicitly clear it. Per trip-now.ts, `?today=off` removes the
    // sessionStorage key and falls through to `new Date()` — today (per the
    // project's current-date context) is 2026-07-05, well before TRIP_START, so
    // the real clock must show the countdown grid, not travel mode.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?today=off', { waitUntil: 'load' });

    await expect(page.getByTestId('hero-travel-mode')).toHaveCount(0);
    // The HOURS cell, not the days cell: this test runs on the REAL clock, and since
    // issue #11 a calendar unit that is zero is not rendered, and `days` is 0 whenever the
    // real remaining day count happens to divide by 7. The clock cells always render.
    await expect(page.getByTestId('countdown-hours')).toBeVisible();
    await expect(page.getByTestId('countdown-total-days')).toBeVisible();

    // The real clock's total-days must be a large positive number (months out),
    // not one of the small fixed values used elsewhere in this file — this is
    // the signal that the override was actually cleared rather than silently
    // reused from sessionStorage.
    const totalDaysText = await page.getByTestId('countdown-total-days').textContent();
    const totalDays = Number(totalDaysText);
    expect(Number.isFinite(totalDays)).toBe(true);
    expect(totalDays).toBeGreaterThan(100);

    await scrollDashboardIntoView(page);
    await expect(page.getByTestId('dashboard-trip-status')).toContainText('Upcoming');
  });
});
