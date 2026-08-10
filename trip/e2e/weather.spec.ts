import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S99 — Weather + golden-hour E2E pack.
 *
 * The weather card (`components/weather-card.tsx`) mounts inside the in-trip Today panel
 * (`components/today-panel.tsx`) and fetches Open-Meteo CLIENT-SIDE for the current trip city
 * (D-004: keyless, no backend). These specs are DETERMINISTIC — the Open-Meteo API is STUBBED
 * with `page.route('**\/api.open-meteo.com/**', …)`; the live network is never touched (the
 * sandbox can't reliably reach it, and a live call would be non-deterministic). The live call
 * is spot-checkable by the operator in a real browser.
 *
 * Covers:
 *   1. Stubbed API → the weather card renders temp / condition / golden-hour on the in-trip
 *      Today panel (`?today=2026-12-12`, Day 4 Kathmandu).
 *   2. OFFLINE: first load caches the stubbed response, then the route is ABORTED (offline) and
 *      the page reloaded → the CACHED weather still renders (the "Offline — last updated …"
 *      indicator), with no error state.
 *
 * ── SETTLE DISCIPLINE (mirrors today.spec.ts / persistence.spec.ts) ──────────────────────
 * `TodayPanel` is a `next/dynamic(ssr:false)` island. On every navigation/reload the app must
 * remount the island, resolve the `?today=` override, hydrate the store, THEN fetch weather.
 * A plain assertion fired immediately can catch a transient pre-hydrate/pre-fetch frame. So
 * every navigation goes through `waitUntil:'domcontentloaded'` (like the sibling packs) AND
 * `settleTodayPanel`, which blocks until the panel is visible + the store has hydrated (a
 * seeded toggle carries a concrete `aria-pressed`) before any assertion. The weather card is
 * then awaited to reach a concrete state (`data-state` live/cached) — never asserted mid-fetch.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const IN_TRIP_DAY = '2026-12-12'; // Day 4, Kathmandu / Nepal window.

// A captured, realistic Open-Meteo `/v1/forecast` body used as the deterministic stub.
const OPEN_METEO_FIXTURE = {
  latitude: 27.71,
  longitude: 85.32,
  timezone: 'Asia/Kathmandu',
  current: {
    time: '2026-12-12T09:00',
    temperature_2m: 12.4,
    weather_code: 1, // "Mainly clear"
  },
  daily: {
    time: ['2026-12-12'],
    sunrise: ['2026-12-12T06:42'],
    sunset: ['2026-12-12T17:08'],
    temperature_2m_max: [18.9],
    temperature_2m_min: [3.2],
    weather_code: [2],
  },
};

// S150: a 7-day variant of the same fixture (full `daily` arrays) so the outlook has a real
// week to render.
const OPEN_METEO_WEEK_FIXTURE = {
  ...OPEN_METEO_FIXTURE,
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
 * Block until the in-trip Today island has mounted + the store has hydrated (a seeded toggle's
 * aria-pressed is concrete), so no assertion runs against a transient pre-hydrate frame. Same
 * primitive as today.spec.ts's settleTodayPanel, keyed on the seeded item id below.
 */
async function settleTodayPanel(page: Page) {
  await expect(page.getByTestId('today-panel')).toBeVisible();
  await page.waitForFunction(
    () => {
      const t = document.querySelector('[data-testid="today-done-toggle-w99-1"]');
      const p = t?.getAttribute('aria-pressed');
      return p === 'true' || p === 'false';
    },
    { timeout: 15_000 },
  );
}

/**
 * Block until the weather card has resolved to a CONCRETE state (live | cached | unavailable)
 * — i.e. the first fetch settled — so we never assert against the loading skeleton.
 */
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

/** Seed a small controlled itinerary on IN_TRIP_DAY so the Today panel is deterministic. */
async function seedTodayFixture(page: Page) {
  await page.evaluate(
    ({ key, date }: { key: string; date: string }) => {
      const dayPlan = {
        date,
        city: 'Kathmandu',
        country: 'nepal',
        items: [{ id: 'w99-1', title: 'S99 Boudhanath at dawn', category: 'photography' }],
      };
      window.localStorage.setItem(key, JSON.stringify([dayPlan]));
    },
    { key: ITINERARY_KEY, date: IN_TRIP_DAY },
  );
}

/** Route Open-Meteo to the deterministic fixture (STUB — never hits the live API). */
async function stubOpenMeteo(page: Page, fixture: unknown = OPEN_METEO_FIXTURE) {
  await page.route('**/api.open-meteo.com/**', (route) => route.fulfill({ json: fixture }));
}

/** Block until the 7-day outlook disclosure is in the DOM (S150). */
async function settleForecast(page: Page) {
  await expect(page.getByTestId('weather-forecast')).toBeVisible({ timeout: 15_000 });
}

test.describe('S99 — weather + golden hour (stubbed Open-Meteo)', () => {
  test('stubbed API: the weather card renders temp, condition, and golden-hour on the in-trip Today panel', async ({
    page,
  }) => {
    await stubOpenMeteo(page);
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedTodayFixture(page);
    // Reload so the app hydrates from the seed (the ?today= override persists across the
    // same-tab reload, so the clock stays in-trip); the stub route persists too.
    await reloadSettled(page);
    await settleTodayPanel(page);
    await settleWeatherCard(page);

    const card = page.getByTestId('weather-card');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-state', 'live');

    // Current conditions from the fixture (12.4°C → 12°, weather_code 1 → "Mainly clear").
    await expect(page.getByTestId('weather-temp')).toContainText('12°');
    await expect(page.getByTestId('weather-condition')).toContainText('Mainly clear');
    // Hi/lo (18.9 → 19, 3.2 → 3).
    await expect(page.getByTestId('weather-hilo')).toContainText('19°');
    await expect(page.getByTestId('weather-hilo')).toContainText('3°');

    // Golden hour — morning [06:42, 07:32], evening [16:18, 17:08] (sunrise/sunset ± 50m).
    const golden = page.getByTestId('weather-golden-hour');
    await expect(golden).toBeVisible();
    await expect(page.getByTestId('weather-golden-morning')).toContainText('6:42 AM');
    await expect(page.getByTestId('weather-golden-morning')).toContainText('7:32 AM');
    await expect(page.getByTestId('weather-golden-evening')).toContainText('4:18 PM');
    await expect(page.getByTestId('weather-golden-evening')).toContainText('5:08 PM');

    // The Open-Meteo attribution is present (D-088, CC-BY 4.0).
    const attribution = page.getByTestId('weather-attribution');
    await expect(attribution).toBeVisible();
    await expect(attribution).toContainText('Open-Meteo');
    await expect(attribution).toHaveAttribute('href', 'https://open-meteo.com/');

    // Fresh data → no offline "last updated" indicator yet.
    await expect(page.getByTestId('weather-cached-indicator')).toHaveCount(0);
  });

  test('offline: after caching a fetch, aborting the route + reloading still renders the CACHED weather (no error)', async ({
    page,
  }) => {
    // First load: stub succeeds → the card renders live AND writes through to the gateway cache.
    await stubOpenMeteo(page);
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedTodayFixture(page);
    await reloadSettled(page);
    await settleTodayPanel(page);
    await settleWeatherCard(page);
    await expect(page.getByTestId('weather-card')).toHaveAttribute('data-state', 'live');

    // Go OFFLINE for Open-Meteo: replace the stub with an aborting route (simulates no network).
    await page.unroute('**/api.open-meteo.com/**');
    await page.route('**/api.open-meteo.com/**', (route) => route.abort());

    // Reload — the fetch now fails, so the client must serve the CACHED last-good value.
    await reloadSettled(page);
    await settleTodayPanel(page);
    await settleWeatherCard(page);

    const card = page.getByTestId('weather-card');
    await expect(card).toBeVisible();
    // Cached (offline) state — same data, plus the "last updated" indicator, NO error UI.
    await expect(card).toHaveAttribute('data-state', 'cached');
    await expect(page.getByTestId('weather-temp')).toContainText('12°');
    await expect(page.getByTestId('weather-condition')).toContainText('Mainly clear');
    await expect(page.getByTestId('weather-golden-hour')).toBeVisible();

    const cachedIndicator = page.getByTestId('weather-cached-indicator');
    await expect(cachedIndicator).toBeVisible();
    await expect(cachedIndicator).toContainText('Offline');
    await expect(cachedIndicator).toContainText('last updated');
  });
});

test.describe('S150 — 7-day outlook (stubbed Open-Meteo, same response, zero extra fetch)', () => {
  test('stubbed 7-day API: the outlook disclosure renders 7 rows, collapsed by default and keyboard-expandable', async ({
    page,
  }) => {
    await stubOpenMeteo(page, OPEN_METEO_WEEK_FIXTURE);
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedTodayFixture(page);
    await reloadSettled(page);
    await settleTodayPanel(page);
    await settleWeatherCard(page);
    await settleForecast(page);

    const outlook = page.getByTestId('weather-forecast');
    await expect(outlook).toBeVisible();

    // Collapsed by default (native <details>, not [open]) — the rows are still IN the DOM
    // (native <details> hides non-summary children via the UA stylesheet, it doesn't remove
    // them), so the correct collapsed assertion is "not visible", not "count 0".
    const isOpenInitially = await outlook.evaluate((el) => (el as HTMLDetailsElement).open);
    expect(isOpenInitially).toBe(false);
    await expect(page.getByTestId('weather-forecast-day').first()).toBeHidden();

    // Open via keyboard: Tab to the summary, then Enter/Space toggles a native <details>.
    const summary = outlook.locator('summary');
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');

    const isOpenAfter = await outlook.evaluate((el) => (el as HTMLDetailsElement).open);
    expect(isOpenAfter).toBe(true);
    const rows = page.getByTestId('weather-forecast-day');
    await expect(rows).toHaveCount(7);
    await expect(rows.first()).toBeVisible();

    // Row 0 = today (from the fixture: hi 18.9→19, lo 3.2→3, "Partly cloudy", golden hour
    // sunrise/sunset ± 50m identical to the existing single-day assertions above).
    await expect(rows.nth(0)).toContainText('Today');
    await expect(rows.nth(0)).toContainText('19°');
    await expect(rows.nth(0)).toContainText('3°');
    await expect(rows.nth(0)).toContainText('Partly cloudy');
    await expect(rows.nth(0)).toContainText('6:42 AM');
    await expect(rows.nth(0)).toContainText('5:08 PM');

    await expect(rows.nth(1)).toContainText('Tomorrow');
    // Last row (weather_code 0 → "Clear sky", hi 17.6→18, lo 3.4→3).
    await expect(rows.nth(6)).toContainText('Clear sky');
    await expect(rows.nth(6)).toContainText('18°');
    await expect(rows.nth(6)).toContainText('3°');

    // Toggling closed again via keyboard (Space on a focused <summary>).
    await summary.focus();
    await page.keyboard.press('Enter');
    const isOpenClosedAgain = await outlook.evaluate((el) => (el as HTMLDetailsElement).open);
    expect(isOpenClosedAgain).toBe(false);
  });

  test('offline: the outlook still renders from the cached forecast, tagged via the same stale card state', async ({
    page,
  }) => {
    // First load: 7-day stub succeeds → live card + outlook, both write-through to the cache.
    await stubOpenMeteo(page, OPEN_METEO_WEEK_FIXTURE);
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedTodayFixture(page);
    await reloadSettled(page);
    await settleTodayPanel(page);
    await settleWeatherCard(page);
    await settleForecast(page);
    await expect(page.getByTestId('weather-card')).toHaveAttribute('data-state', 'live');

    // Go offline for Open-Meteo.
    await page.unroute('**/api.open-meteo.com/**');
    await page.route('**/api.open-meteo.com/**', (route) => route.abort());
    await reloadSettled(page);
    await settleTodayPanel(page);
    await settleWeatherCard(page);

    const card = page.getByTestId('weather-card');
    await expect(card).toHaveAttribute('data-state', 'cached');
    await expect(page.getByTestId('weather-cached-indicator')).toBeVisible();

    // The outlook is still present (cached forecast rides the offline fallback) — expand and
    // check its rows are the same 7 cached days, no error state anywhere.
    await settleForecast(page);
    const outlook = page.getByTestId('weather-forecast');
    await outlook.locator('summary').click();
    await expect(page.getByTestId('weather-forecast-day')).toHaveCount(7);
  });

  test('no cache + failed fetch: no outlook, no error — the quiet unavailable card only', async ({ page }) => {
    await page.route('**/api.open-meteo.com/**', (route) => route.abort());
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedTodayFixture(page);
    await reloadSettled(page);
    await settleTodayPanel(page);
    await settleWeatherCard(page);

    await expect(page.getByTestId('weather-card')).toHaveAttribute('data-state', 'unavailable');
    await expect(page.getByTestId('weather-forecast')).toHaveCount(0);
  });

  /**
   * S150 DoD #5 — axe-clean on the card's surface. NOTE: neither `e2e/a11y.spec.ts` (S85) nor
   * `e2e/a11y-intrip.spec.ts` (F19b) stub Open-Meteo, so the weather card only ever reaches
   * `unavailable` in those packs — the LIVE/populated card (incl. the new outlook, expanded)
   * has never actually been axe-scanned until this test. Run twice to confirm determinism.
   */
  for (const attempt of [1, 2]) {
    test(`axe: the live card WITH the outlook expanded has zero serious/critical violations (run ${attempt})`, async ({
      page,
    }, testInfo) => {
      await stubOpenMeteo(page, OPEN_METEO_WEEK_FIXTURE);
      await gotoHomeWithClock(page, IN_TRIP_DAY);
      await seedTodayFixture(page);
      await reloadSettled(page);
      await settleTodayPanel(page);
      await settleWeatherCard(page);
      await settleForecast(page);
      await page.getByTestId('weather-forecast').locator('summary').click();
      await expect(page.getByTestId('weather-forecast-day')).toHaveCount(7);

      // S336: under reduced motion the today-panel's whileInView reveal wrapper starts at
      // opacity:0 and only commits to 1 once it has actually intersected the viewport (the
      // summary.click above scrolls it in). Wait for that settle before axe samples colors —
      // otherwise every text node reads deflated by the sub-1 ancestor opacity, a false AA fail
      // (the s157-a11y-close-targets settle-guard pattern; at opacity 1 the card is ≥AA).
      await expect(page.locator('[data-testid="today-panel"] > div').first()).toHaveCSS('opacity', '1');

      const results = await new AxeBuilder({ page })
        .include('[data-testid="weather-card"]')
        .analyze();
      const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      for (const v of results.violations) {
        testInfo.annotations.push({
          type: `axe:${v.impact ?? 'unknown'}`,
          description: `${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`,
        });
      }
      expect(
        blocking,
        `serious/critical a11y violations on weather-card: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`,
      ).toEqual([]);
    });
  }
});
