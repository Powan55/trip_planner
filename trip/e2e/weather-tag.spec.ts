import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S216 — quiet, read-only weather tag on the calendar day-detail header
 * (`components/calendar-planner.tsx`, `data-testid="calendar-day-weather-tag"`).
 *
 * PURE CLIENT-SIDE DERIVATION over the SAME `weatherCache` gateway entry the Today panel's
 * weather card (S99/S150) already write-throughs — the calendar itself NEVER fetches (D-016).
 * So the deterministic path to a populated cache is: stub Open-Meteo, visit Home under the
 * `?today=` clock override so the Today panel's weather card actually fetches + write-throughs
 * the 7-day outlook (same idiom as `weather.spec.ts`), THEN navigate to `/plan` under the SAME
 * `?today=` value — the calendar reads whatever `nepal_japan_weather_cache` now holds, read-only.
 *
 * Covers:
 *   1. A date INSIDE the cached forecast window → the tag renders with the right label.
 *   2. A date OUTSIDE the cached window (same city, no cache row for that date) → no tag, no
 *      broken layout.
 *   3. A completely fresh session (weather never fetched at all) → no tag anywhere, no console
 *      errors.
 *   4. axe: the day-detail header WITH the tag visible has zero serious/critical violations.
 */

const IN_TRIP_DAY = '2026-12-12'; // Day 4, Kathmandu — matches weather.spec.ts's fixture day.
// S393: was 2026-12-09, which is now SYRACUSE (the departure day). This case's whole point is
// "same city, date outside the cached window" — with a different city it would still pass while
// no longer testing the window at all. Moved to Dec 10, the earliest Kathmandu day, which is
// still before the 12th–18th cache window, so the case keeps its discriminating power.
const OUT_OF_WINDOW_DAY = '2026-12-10'; // Day 2, Kathmandu, but before the cached window.

// Same shape/idiom as weather.spec.ts's week fixture — index 0 = 2026-12-12, "Partly cloudy"
// (weather_code 2), through 2026-12-18.
const OPEN_METEO_WEEK_FIXTURE = {
  latitude: 27.71,
  longitude: 85.32,
  timezone: 'Asia/Kathmandu',
  current: { time: '2026-12-12T09:00', temperature_2m: 12.4, weather_code: 1 },
  daily: {
    time: ['2026-12-12', '2026-12-13', '2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18'],
    sunrise: [
      '2026-12-12T06:42', '2026-12-13T06:43', '2026-12-14T06:43', '2026-12-15T06:44',
      '2026-12-16T06:44', '2026-12-17T06:45', '2026-12-18T06:45',
    ],
    sunset: [
      '2026-12-12T17:08', '2026-12-13T17:08', '2026-12-14T17:08', '2026-12-15T17:08',
      '2026-12-16T17:09', '2026-12-17T17:09', '2026-12-18T17:09',
    ],
    temperature_2m_max: [18.9, 19.2, 17.8, 20.1, 19.5, 18.0, 17.6],
    temperature_2m_min: [3.2, 2.8, 4.1, 3.9, 3.0, 2.5, 3.4],
    weather_code: [2, 0, 3, 1, 2, 61, 0],
  },
};

const ITINERARY_KEY = 'nepal_japan_itinerary';

async function stubOpenMeteo(page: Page) {
  await page.route('**/api.open-meteo.com/**', (route) => route.fulfill({ json: OPEN_METEO_WEEK_FIXTURE }));
}

/** Seed a small controlled itinerary on IN_TRIP_DAY so the Today panel mounts deterministically
 *  (verbatim idiom from weather.spec.ts). */
async function seedTodayFixture(page: Page) {
  await page.evaluate(
    ({ key, date }: { key: string; date: string }) => {
      const dayPlan = {
        date,
        city: 'Kathmandu',
        country: 'nepal',
        items: [{ id: 's216-1', title: 'S216 fixture item', category: 'sightseeing' }],
      };
      window.localStorage.setItem(key, JSON.stringify([dayPlan]));
    },
    { key: ITINERARY_KEY, date: IN_TRIP_DAY },
  );
}

async function settleWeatherCard(page: Page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="weather-card"]');
      const s = el?.getAttribute('data-state');
      return s === 'live' || s === 'cached' || s === 'unavailable';
    },
    { timeout: 15_000 },
  );
}

async function settleForecast(page: Page) {
  await expect(page.getByTestId('weather-forecast')).toBeVisible({ timeout: 15_000 });
}

/** Prime the weather cache: visit Home under the clock override with Open-Meteo stubbed,
 *  let the Today panel's weather card fetch + write-through the 7-day outlook. */
async function primeWeatherCache(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubOpenMeteo(page);
  await page.goto(`/?today=${IN_TRIP_DAY}`, { waitUntil: 'domcontentloaded' });
  await seedTodayFixture(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('today-panel')).toBeVisible();
  await settleWeatherCard(page);
  await settleForecast(page);
  await expect(page.getByTestId('weather-card')).toHaveAttribute('data-state', 'live');
}

async function gotoPlanner(page: Page, todayParam: string) {
  await page.goto(`/plan/?today=${todayParam}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('calendar-prev-day')).toBeVisible({ timeout: 15_000 });
}

test.describe('S216 — calendar day-card weather tag (read-only, cache-derived)', () => {
  test('a date inside the cached forecast window shows the right tag', async ({ page }) => {
    await primeWeatherCache(page);
    await gotoPlanner(page, IN_TRIP_DAY);

    const tag = page.getByTestId('calendar-day-weather-tag');
    await expect(tag).toBeVisible();
    await expect(tag).toContainText('Partly cloudy'); // weather_code 2 on 2026-12-12 (index 0)
  });

  test('a date outside the cached window (same city) shows no tag, no broken layout', async ({ page }) => {
    await primeWeatherCache(page);
    await gotoPlanner(page, IN_TRIP_DAY);
    await expect(page.getByTestId('calendar-day-weather-tag')).toBeVisible();

    // Select Dec 10 — Kathmandu, the SAME city as the primed day, but outside the 12th-18th
    // cache window written above, so no forecast row exists for it.
    await page.getByTestId(`calendar-day-${OUT_OF_WINDOW_DAY}`).click();
    await expect(page.getByTestId('calendar-day-weather-tag')).toHaveCount(0);
    // The header itself still renders correctly (no broken layout from the missing tag).
    // S336: 'Day N •' matches two legit header nodes (the compact date line AND the
    // location line), so assert the unambiguous location header specifically.
    await expect(page.getByTestId('calendar-prev-day')).toBeVisible();
    await expect(page.getByText('Day 2 • Kathmandu, Nepal')).toBeVisible();
  });

  // S407 — the RENDERED day header, on the served build. Dec 9 is spent in Syracuse / JFK / the
  // air; `country: 'nepal'` is the LEG ID that drives currency + UTC offset, not a label, so the
  // header used to read "Syracuse, Nepal". It must now read the day's own label, while Dec 10 —
  // asserted verbatim above — keeps its leg label. Lives in this file because it is the same
  // day-detail header these cases already drive.
  test('S407: the Dec-9 header renders "Syracuse, USA", never "Syracuse, Nepal"', async ({ page }) => {
    await gotoPlanner(page, IN_TRIP_DAY);
    await page.getByTestId('calendar-day-2026-12-09').click();
    await expect(page.getByText('Day 1 • Syracuse, USA')).toBeVisible();
    await expect(page.getByText('Day 1 • Syracuse, Nepal')).toHaveCount(0);
  });

  test('a fresh session (weather never fetched) shows no tag anywhere, no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await gotoPlanner(page, IN_TRIP_DAY);
    await expect(page.getByTestId('calendar-day-weather-tag')).toHaveCount(0);
    await expect(page.getByTestId('calendar-prev-day')).toBeVisible();
    expect(errors, `console/page errors: ${errors.join('; ')}`).toEqual([]);
  });

  test('axe: the day-detail header WITH the weather tag visible has zero serious/critical violations', async ({
    page,
  }, testInfo) => {
    await primeWeatherCache(page);
    await gotoPlanner(page, IN_TRIP_DAY);
    await expect(page.getByTestId('calendar-day-weather-tag')).toBeVisible();

    // S336 (ported S351B — the guard was written for wrapped-story.spec.ts the same commit but
    // never carried here): the mid-trip travel-arrival toast (fixed, fades opacity 0->1 on mount)
    // can be sampled by axe mid-fade, which deflates its text-white/60 to a false ~4.05:1 contrast
    // reading — at rest it composites to ~7:1 on the glass surface. IN_TRIP_DAY (2026-12-12) is
    // inside the trip window and this pack never dismisses/seeds the toast's 'seen' flag, so it is
    // eligible here exactly like it was on /recap. Settle it to opacity 1 first (the
    // s157-a11y-close-targets pattern) so the scan reads its true colors.
    const arrivalToast = page.getByTestId('travel-arrival-toast');
    await arrivalToast.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    if (await arrivalToast.count()) {
      await expect(arrivalToast).toHaveCSS('opacity', '1');
    }

    const results = await new AxeBuilder({ page }).exclude('canvas.maplibregl-canvas').analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    for (const v of results.violations) {
      testInfo.annotations.push({
        type: `axe:${v.impact ?? 'unknown'}`,
        description: `${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`,
      });
    }
    expect(
      blocking,
      `serious/critical a11y violations: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`,
    ).toEqual([]);
  });
});
