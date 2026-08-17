import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Fake-clock countdown + date-boundary pack (slice S82, D-075) — E2E wave 2.
 *
 * Drives the app-wide clock via the `?today=YYYY-MM-DD` override
 * (`lib/trip-now.ts`, LOCKED D-075) against the served static `out/` build, and
 * proves the hero countdown / travel-mode panel and the stat row's clock-derived
 * live cell flip correctly across the whole trip window: pre-trip countdown math,
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
 * 2. One animation layer sits between that frozen target and the DOM, and it is
 *    neutralized by `page.emulateMedia({ reducedMotion: 'reduce' })` (set once per
 *    test before navigating): `useCountUp` (hooks/use-count-up.ts), a ~2s eased
 *    count-up reveal on every countdown unit. Under reduced motion it skips the rAF
 *    loop and reports the final value immediately (D-056b).
 *
 *    Issue #106 removed the SECOND layer this note used to describe. The clock-derived
 *    cards it named lived in `components/trip-dashboard.tsx`, whose `StatCard` carried a
 *    `whileInView` reveal that had to be scrolled to before it would paint at all (its
 *    `viewport={{ once: true }}` never fires off-screen, even under reduced motion). That
 *    section is deleted; its two clock-derived facts are read from `home-stat-row`'s live
 *    cell instead, which has no reveal and no count-up. `scrollLiveStatIntoView()` below
 *    still scrolls, for the different and simpler reason given at its docstring.
 *
 * 3. Exact numbers below were computed two ways and cross-checked: (a) by hand
 *    against `lib/countdown.ts`'s `computeCountdown` (whole days via date-fns, then
 *    CALENDAR-ACCURATE months via `addMonths`/`differenceInMonths` — issue #60, D-313,
 *    superseding issue #11 / D-306's fixed 28-day month — with the hour/min/sec residue
 *    measured from `now`) and `lib/trip-data.ts`'s `TRIP_DATES`/`getCountryForDate`;
 *    (b) by a live CDP probe of the actual served `out/` build for every `?today=` value
 *    used here, under `reducedMotion: 'reduce'`, confirming the DOM text matches the hand
 *    computation exactly.
 */

const BASE_URL = 'http://127.0.0.1';

/** Navigate with the `?today=` override applied and reduced motion pinned. */
async function gotoWithClock(page: Page, todayParam: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/?today=${todayParam}`, { waitUntil: 'load' });
}

/**
 * Bring the stat row's one clock-driven cell into view before asserting on it.
 *
 * `home-stat-row` is a `LazyVisible` island (D-116) sitting below the hero's
 * `min-h-[100svh]` column, so on a cold load its section is a sized placeholder until
 * either its intersection trigger or the ~200ms idle fallback mounts it. Scrolling to
 * the cell fires the trigger directly instead of racing the fallback, and
 * `scrollIntoViewIfNeeded` auto-waits for the node to exist, so this doubles as the
 * "island has mounted" wait. It is NOT waiting on a reveal: unlike the deleted
 * trip-dashboard cards, this cell has no `whileInView` and no count-up (see note 2).
 */
async function scrollLiveStatIntoView(page: Page) {
  await page.getByTestId('home-stat-live').scrollIntoViewIfNeeded();
}

/**
 * The live cell's two lines. `home-stat-row.tsx`'s `liveCell()` puts the FIGURE in the
 * first `<p>` and the state's CAPTION in the second, and the caption is what carries the
 * trip-lifecycle fact the deleted `dashboard-trip-status` card used to spell out:
 * "Days to go" pre-trip · "Day on trip" in-trip · "Days travelled" post-trip.
 */
function liveStat(page: Page) {
  const cell = page.getByTestId('home-stat-live');
  return { value: cell.locator('p').first(), caption: cell.locator('p').nth(1) };
}

/**
 * The hero raster the browser ACTUALLY RESOLVED, as a bare filename stem.
 *
 * Issue #89 made the hero photograph leg-aware (`lib/hero-image.ts` ->
 * `components/hero-section.tsx`), and nothing committed proved it: reverting `src={heroSrc}`
 * to a literal left the whole suite green. These assertions are that proof, which is why
 * they live on the two `?today=` cases that already pin the leg rather than in a spec of
 * their own — one navigation, both facts.
 *
 * It reads `currentSrc`, NOT the React prop and NOT `src`. `OptimizedImage` renders a
 * <picture> with AVIF and WebP <source>s and passes `sizes="100vw"`, so what the browser
 * actually fetches is a width-selected derivative that the `src` attribute never names;
 * `currentSrc` is the only thing that reports the resolved URL. `picture img` also
 * disambiguates the raster from the LQIP backdrop, which is a sibling data: URI.
 *
 * The stem is compared, not the whole URL, so the assertion survives the basePath build,
 * the -640w/-1024w/native variant the viewport happens to pick, and the AVIF/WebP choice.
 */
async function resolvedHeroStem(page: Page): Promise<string> {
  const img = page.locator('.hero-photo-wrap picture img');
  await expect(img).toBeVisible();
  await expect.poll(async () => await img.evaluate((el: HTMLImageElement) => el.currentSrc)).not.toBe('');
  const currentSrc = await img.evaluate((el: HTMLImageElement) => el.currentSrc);
  // /base/images/hero/hero-japan-1024w.avif -> hero-japan
  return new URL(currentSrc).pathname
    .split('/')
    .pop()!
    .replace(/\.(avif|webp|jpe?g|png)$/i, '')
    .replace(/-\d+w$/, '');
}

test.describe('Pre-trip countdown + total-days math (D-016 computeCountdown, frozen clock)', () => {
  test('?today=2026-11-09 (local noon) -> exact countdown breakdown, Upcoming status', async ({
    page,
  }) => {
    // Nov 9, 2026 12:00 local -> Dec 9, 2026 00:00 local (TRIP_START) is EXACTLY
    // 0 months / 0 weeks / 29 days / 12 hours / 0 min / 0 sec remaining, totalDays=29.
    //
    // The TOTAL has never moved (29d 12h; totalDays still 29) and still sums back to the
    // exact target instant. Only the bucketing has, across three schemes now: this pinned
    // `04` weeks / `01` day, then `29` days once "4 weeks" was banned (S423), then issue #11
    // / D-306 carried it into a fixed 28-day month (1 month 1 day). Issue #60 / D-313 reverts
    // to calendar-accurate months: Nov 9 -> Dec 9 has not completed a calendar month one day
    // short of the borrow-adjusted walk target, so months is 0 again and the 29-day residue
    // is >= the suppression window (28), reporting unsplit as `29` rather than splitting into
    // weeks. THIS IS THE REPORTED BUG'S EXACT INSTANT: months and weeks are both 0 here, and
    // a zero unit is not rendered, so both cells must be ABSENT.
    await gotoWithClock(page, '2026-11-09');

    // Travel-mode panel must be ABSENT outside the trip window.
    await expect(page.getByTestId('hero-travel-mode')).toHaveCount(0);

    // Countdown grid IS present and shows the exact frozen breakdown.
    await expect(page.getByTestId('countdown-months')).toHaveCount(0);
    await expect(page.getByTestId('countdown-weeks')).toHaveCount(0);
    await expect(page.getByTestId('countdown-days')).toHaveText('29');
    await expect(page.getByTestId('countdown-hours')).toHaveText('12');
    await expect(page.getByTestId('countdown-minutes')).toHaveText('00');
    await expect(page.getByTestId('countdown-seconds')).toHaveText('00');
    await expect(page.getByTestId('countdown-total-days')).toHaveText('29');

    // Stat row: the PRE-TRIP lifecycle state (what the deleted dashboard called
    // "Upcoming") is the live cell's caption, duration = the full 32-day trip, and the
    // live figure mirrors the countdown's totalDays (29) — `liveCell()` reads it from
    // the same `computeCountdown(TRIP_START, now).totalDays` the hero's ring does.
    await scrollLiveStatIntoView(page);
    await expect(liveStat(page).caption).toHaveText('Days to go');
    await expect(page.getByTestId('home-stat-days')).toContainText('32');
    await expect(liveStat(page).value).toHaveText('29');
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

    // Issue #89: the Nepal leg keeps the Himalaya hero. Paired with the Dec-19 case below,
    // this is what makes the leg swap revertible-with-a-failure instead of silently.
    expect(await resolvedHeroStem(page)).toBe('hero');

    // Countdown grid must be ABSENT while in travel mode.
    await expect(page.getByTestId('countdown-days')).toHaveCount(0);
    await expect(page.getByTestId('countdown-total-days')).toHaveCount(0);

    // The IN-TRIP lifecycle state (the deleted dashboard's "On the trip"): the live cell
    // switches to `getTodayInTrip().dayNumber` under a "Day on trip" caption, so the
    // caption proves the state and the figure agrees with the hero's own Day 4.
    await scrollLiveStatIntoView(page);
    await expect(liveStat(page).caption).toHaveText('Day on trip');
    await expect(liveStat(page).value).toHaveText('4');
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

    // Issue #89: Dec 19 is the day the hero photograph itself changes, so this is where the
    // swap is asserted. It resolves to hero-japan only if the mount-time leg read reaches
    // the `src` — the SSR/first paint is hero.jpg for every leg by construction.
    expect(await resolvedHeroStem(page)).toBe('hero-japan');
  });
});

test.describe('Boundary matrix (S65) — all four corners of the trip window', () => {
  const CASES = [
    // D-315 (owner-ruled 2026-08-14, amending D-285): Dec 9 is spent in Syracuse, JFK and the air
    // and is NAMED New York, so the hero names New York — the day is still Day 1 of the Nepal leg.
    // Changed in deliberate lockstep with the content root (the S112/D-124 pattern for a frozen
    // boundary city).
    { today: '2026-12-09', day: '1', city: 'New York', label: 'Dec 9 -> Day 1 (Nepal start)' },
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
    // computeCountdown returns its ZERO_PAST shape once `now >= target`. A zero calendar
    // unit is not rendered, so months/weeks/days are ABSENT here; the clock cells stay
    // (they tick, and a running clock reading 00 is a clock) and read "00".
    await gotoWithClock(page, '2027-01-15');

    await expect(page.getByTestId('hero-travel-mode')).toHaveCount(0);
    await expect(page.getByTestId('countdown-months')).toHaveCount(0);
    await expect(page.getByTestId('countdown-weeks')).toHaveCount(0);
    await expect(page.getByTestId('countdown-days')).toHaveCount(0);
    await expect(page.getByTestId('countdown-hours')).toHaveText('00');
    await expect(page.getByTestId('countdown-minutes')).toHaveText('00');
    await expect(page.getByTestId('countdown-seconds')).toHaveText('00');
    await expect(page.getByTestId('countdown-total-days')).toHaveText('0');

    // The POST-TRIP lifecycle state (the deleted dashboard's "Completed"). `liveCell()`
    // reaches it only through `computeCountdown(...).isPast`, so this caption is the same
    // proof the old assertion was: it cannot read "Days travelled" unless the clock is
    // past TRIP_START and `getTodayInTrip()` is null, i.e. the trip is over. The figure
    // is then the trip LENGTH (32), not a remaining count.
    await scrollLiveStatIntoView(page);
    await expect(liveStat(page).caption).toHaveText('Days travelled');
    await expect(liveStat(page).value).toHaveText('32');
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
    // sessionStorage key and falls through to `new Date()`. This test assumes only that the
    // real clock is still PRE-trip (before TRIP_START, 2026-12-09), so the real clock must
    // show the countdown grid rather than travel mode. It stops being meaningful once the
    // real date reaches the trip window, which is a property of the fixture trip, not
    // something a threshold here can paper over.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?today=off', { waitUntil: 'load' });

    await expect(page.getByTestId('hero-travel-mode')).toHaveCount(0);
    // The HOURS cell, not the days cell: this test runs on the REAL clock, and a calendar
    // unit that is zero is not rendered, so `days` (or `weeks`/`months`) can legitimately be
    // absent depending on where the real date happens to land. The clock cells always render.
    await expect(page.getByTestId('countdown-hours')).toBeVisible();
    await expect(page.getByTestId('countdown-total-days')).toBeVisible();

    // The signal that the override was actually cleared rather than silently reused from
    // sessionStorage: the figure is a live pre-trip countdown and is NOT the one pre-trip
    // value this file freezes.
    //
    // This asserted `> 100` until issue #106. That was a bound on the calendar, not on the
    // behaviour under test, and it was 15 days from expiring when it was found — the real
    // clock crosses TRIP_START - 100 days on 2026-08-31, after which a correct app fails a
    // green test. Naming the frozen value instead says what the check is actually for and
    // holds for as long as the surrounding pre-trip assumption does.
    const totalDaysText = await page.getByTestId('countdown-total-days').textContent();
    const totalDays = Number(totalDaysText);
    expect(Number.isFinite(totalDays)).toBe(true);
    expect(totalDays).toBeGreaterThan(0);
    expect(totalDays).not.toBe(29); // `?today=2026-11-09` above

    // Back to the pre-trip lifecycle state on the REAL clock, and the live cell's figure
    // must be the same large countdown the ring just reported — a stale override would
    // have left it on one of this file's small fixed values.
    await scrollLiveStatIntoView(page);
    await expect(liveStat(page).caption).toHaveText('Days to go');
    await expect(liveStat(page).value).toHaveText(String(totalDays));
  });
});
