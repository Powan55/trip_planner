import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S100 — Today/next-up E2E pack (city generalization + the "what's-next" rail).
 *
 * Two things, both on the served static `out/` build, driven through the D-075 `?today=`
 * clock override (local NOON of the given day) exactly like the frozen S82/S98 packs:
 *
 *   1. PER-DAY CITY GENERALIZATION — before S100 the in-trip city collapsed to Kathmandu
 *      (any Nepal day) / Tokyo (any Japan day). Now a day-trip date shows the REAL city.
 *      `?today=2026-12-14` -> Nagarkot (a Nepal day trip), `?today=2026-12-26` -> Kyoto (a
 *      Japan regional stop). These are S82-ORTHOGONAL: S82 only asserts the 5 base dates
 *      (Dec-9/12/18 Kathmandu, Dec-19 & Jan-9 Tokyo), which are unchanged.
 *
 *   2. THE "UP NEXT" RAIL — the `today-next-up` band names the next upcoming, not-done,
 *      timed item by the resolved clock. Under `?today=2026-12-14` the clock is local noon
 *      ("12:00"), so with a seeded fixture straddling noon the rail must name the first item
 *      AT/AFTER noon; toggling that item done must advance the rail to the following item.
 *
 * ── SETTLE DISCIPLINE (mirrors today.spec.ts) ───────────────────────────────
 * `TodayPanel` is a `next/dynamic(ssr:false)` island. Every navigation/reload goes through
 * `waitUntil:'domcontentloaded'` + a settle that blocks until the panel is visible and the store
 * has hydrated (a known seeded toggle's `aria-pressed` is concrete) before ANY assertion, so
 * no assertion runs against a transient pre-hydrate frame (the D-093 island/reload window).
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';

// Day-trip dates that prove the city generalization (NOT the S82 base dates).
const NAGARKOT_DAY = '2026-12-14'; // Day 6 — Nagarkot (Nepal day trip; was collapsed to Kathmandu)
const KYOTO_DAY = '2026-12-26'; // Day 18 — Kyoto (Japan; was collapsed to Tokyo)

/** Navigate to home with the `?today=` override applied and reduced motion pinned. */
async function gotoHomeWithClock(page: Page, todayParam: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/?today=${todayParam}`, { waitUntil: 'domcontentloaded' });
}

/** Reload and let the network settle (mirrors today.spec.ts's reloadSettled). */
async function reloadSettled(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
}

/**
 * Block until the in-trip Today island has mounted + the store hydrated. Waits for the panel
 * to be visible AND for the seeded rail item's toggle (`s100-a`) to carry a concrete
 * `aria-pressed` — the store-is-hydrated signal, same shape as today.spec.ts.
 */
async function settleTodayPanel(page: Page) {
  await expect(page.getByTestId('today-panel')).toBeVisible();
  await page.waitForFunction(
    () => {
      const t = document.querySelector('[data-testid="today-done-toggle-s100-a"]');
      const p = t?.getAttribute('aria-pressed');
      return p === 'true' || p === 'false';
    },
    { timeout: 15_000 },
  );
}

/**
 * Seed a deterministic fixture on `date` with items STRADDLING noon (the ?today= clock is
 * local noon). Before noon: 09:00 (should be skipped as passed). At/after noon: 13:00 (the
 * first "up next" under a noon clock) then 16:00 (the item the rail advances to once 13:00 is
 * marked done). City is passed through so the header still reads the real city.
 */
async function seedRailFixture(page: Page, date: string, city: string, country: 'nepal' | 'japan') {
  await page.evaluate(
    ({ key, date, city, country }) => {
      const dayPlan = {
        date,
        city,
        country,
        items: [
          { id: 's100-morning', title: 'S100 morning (passed)', category: 'food', time: '09:00' },
          { id: 's100-a', title: 'S100 afternoon viewpoint', category: 'photography', time: '13:00' },
          { id: 's100-b', title: 'S100 evening dinner', category: 'food', time: '16:00' },
        ],
      };
      window.localStorage.setItem(key, JSON.stringify([dayPlan]));
    },
    { key: ITINERARY_KEY, date, city, country },
  );
}

test.describe('S100 city generalization — day-trip dates show the REAL city (S82-orthogonal)', () => {
  test('?today=2026-12-14 -> Nagarkot in the hero travel mode AND the Today header', async ({
    page,
  }) => {
    await gotoHomeWithClock(page, NAGARKOT_DAY);

    // Hero travel-mode panel: the generalized city, NOT the collapsed base city.
    await expect(page.getByTestId('hero-travel-mode')).toBeVisible();
    await expect(page.getByTestId('hero-day-number')).toHaveText('6');
    await expect(page.getByTestId('hero-travel-mode')).toContainText('Nagarkot');
    await expect(page.getByTestId('hero-travel-mode')).not.toContainText('Kathmandu');

    // Today panel header echoes the same generalized city (fed the same getCityForDate).
    await expect(page.getByTestId('today-panel')).toBeVisible();
    await expect(page.getByTestId('today-panel')).toContainText('Nagarkot');
  });

  test('?today=2026-12-26 -> Kyoto (a Japan day, NOT collapsed to Tokyo)', async ({ page }) => {
    await gotoHomeWithClock(page, KYOTO_DAY);

    await expect(page.getByTestId('hero-travel-mode')).toBeVisible();
    await expect(page.getByTestId('hero-day-number')).toHaveText('18');
    await expect(page.getByTestId('hero-travel-mode')).toContainText('Kyoto');
    await expect(page.getByTestId('hero-travel-mode')).not.toContainText('Tokyo');

    await expect(page.getByTestId('today-panel')).toBeVisible();
    await expect(page.getByTestId('today-panel')).toContainText('Kyoto');
  });
});

test.describe('S100 "Up next" rail — names the next item and advances when it is done', () => {
  test('under the noon clock the rail names the first item at/after noon, and advances on done', async ({
    page,
  }) => {
    await gotoHomeWithClock(page, NAGARKOT_DAY);
    await seedRailFixture(page, NAGARKOT_DAY, 'Nagarkot', 'nepal');
    // Reload so the app hydrates from the seeded fixture (the ?today= override persists in
    // sessionStorage across the same-tab reload), then settle before asserting.
    await reloadSettled(page);
    await settleTodayPanel(page);

    const rail = page.getByTestId('today-next-up');
    await expect(rail).toBeVisible();

    // Under the noon (12:00) clock: 09:00 is passed, so the next is the 13:00 item.
    // S125 (D-137/D-138): the display rule renders a parseable legacy `time` via
    // `effectiveStartMinutes`'s fallback -> AM/PM + the day-country badge (NPT here),
    // not the raw "13:00" text — an intentional, spec-mandated change to this rail's
    // rendered text, NOT the `nextUp` selection logic (untouched, S124's).
    await expect(rail).toContainText('S100 afternoon viewpoint');
    await expect(rail).toContainText('1:00 PM');
    await expect(rail).toContainText('NPT');
    // And it is NOT still showing the passed 09:00 item.
    await expect(rail).not.toContainText('S100 morning');

    // Mark the 13:00 item done — the rail must ADVANCE to the next upcoming item (16:00).
    const toggle = page.getByTestId('today-done-toggle-s100-a');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await expect(rail).toContainText('S100 evening dinner');
    await expect(rail).toContainText('4:00 PM');
    await expect(rail).not.toContainText('S100 afternoon viewpoint');
  });

  test('when every remaining item is done/past, the rail shows the all-caught-up line', async ({
    page,
  }) => {
    await gotoHomeWithClock(page, NAGARKOT_DAY);
    await seedRailFixture(page, NAGARKOT_DAY, 'Nagarkot', 'nepal');
    await reloadSettled(page);
    await settleTodayPanel(page);

    const rail = page.getByTestId('today-next-up');
    await expect(rail).toBeVisible();

    // Toggle both upcoming items (13:00, 16:00) done; the 09:00 item is already past. Now
    // nothing is upcoming -> the rail must show the "all caught up" line, still present.
    await page.getByTestId('today-done-toggle-s100-a').click();
    await expect(page.getByTestId('today-done-toggle-s100-a')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('today-done-toggle-s100-b').click();
    await expect(page.getByTestId('today-done-toggle-s100-b')).toHaveAttribute('aria-pressed', 'true');

    await expect(rail).toBeVisible();
    await expect(rail).toContainText('all caught up');
  });
});
