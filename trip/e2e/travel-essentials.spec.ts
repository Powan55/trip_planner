import { test, expect } from './fixtures';
import type { Page, ConsoleMessage } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S188 — Travel Mode Essentials block E2E pack (weather · currency · safety ·
 * flight/transit deep-links · Wake Lock).
 *
 * Runs against the served static `out/` build (D-093) on the DEFAULT (signed-in) identity, so
 * `/travel` is reachable with no gate. Mirrors the S185–S187 packs' seeding style. Frankfurter
 * (`api.frankfurter.dev`) and Open-Meteo (`api.open-meteo.com`) are both STUBBED with
 * `page.route(...)` — the live network is never touched (deterministic, sandbox-safe).
 *
 * SERVICE WORKERS BLOCKED (S213 gate triage): sw.js carries a stale-while-revalidate route for
 * api.frankfurter.dev (D-190). Once the SW installs fast enough to claim the page BEFORE the
 * Essentials island's fetch fires (warm server → fast precache install), the fetch is served
 * from inside the SW — invisible to page.route — and hits the REAL network, breaking the stub
 * deterministically on a quiet box. This spec's subject is the app-level fetch+cache logic, not
 * the SW, so SWs are blocked here; the SW's own behavior is covered by the pwa/tm-offline packs.
 */
test.use({ serviceWorkers: 'block' });

const FRANKFURTER_JPY_FIXTURE = { amount: 1, base: 'USD', date: '2026-07-15', rates: { JPY: 155.32 } };
// Frankfurter's real ECB-sourced symbol list does not carry NPR — stub the honest 200-without-
// the-symbol shape so the Nepal-leg path is exercised deterministically (S188).
const FRANKFURTER_NPR_MISSING_FIXTURE = { amount: 1, base: 'USD', date: '2026-07-15', rates: {} };

const OPEN_METEO_FIXTURE = {
  latitude: 27.71,
  longitude: 85.32,
  timezone: 'Asia/Kathmandu',
  current: { time: '2026-12-12T09:00', temperature_2m: 12.4, weather_code: 1 },
  daily: {
    time: ['2026-12-12'],
    sunrise: ['2026-12-12T06:42'],
    sunset: ['2026-12-12T17:08'],
    temperature_2m_max: [18.9],
    temperature_2m_min: [3.2],
    weather_code: [2],
  },
};

async function stubFrankfurter(page: Page, fixture: unknown = FRANKFURTER_JPY_FIXTURE) {
  await page.route('**/api.frankfurter.dev/**', (route) => route.fulfill({ json: fixture }));
}

async function stubOpenMeteo(page: Page, fixture: unknown = OPEN_METEO_FIXTURE) {
  await page.route('**/api.open-meteo.com/**', (route) => route.fulfill({ json: fixture }));
}

/** Block until the Essentials card's currency panel has resolved past its loading state. */
async function settleCurrency(page: Page) {
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="travel-essentials-currency-loading"]'),
    { timeout: 15_000 },
  );
}

async function settleWeather(page: Page) {
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="travel-essentials-weather-loading"]'),
    { timeout: 15_000 },
  );
}

/**
 * S317: Essentials collapsed to ONE row — a native <details> closed by default. Its panels stay
 * MOUNTED while collapsed (so the fetch effects run and `settle*`/`toContainText`/`toHaveAttribute`
 * reads still work), but `toBeVisible()` needs the disclosure open. Open it here for the tests that
 * assert inner visibility (flight cards, the reference-rate line, the axe scan of rendered panels).
 */
async function openEssentials(page: Page) {
  const details = page.getByTestId('travel-essentials');
  await expect(details).toBeVisible();
  await details.evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
}

test.describe('S188 · currency rate renders + "as of" (stubbed Frankfurter, Japan leg)', () => {
  test('a Japan-leg travel day shows the live JPY rate and its as-of date', async ({ page }) => {
    await stubFrankfurter(page);
    await stubOpenMeteo(page);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-19', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-essentials')).toBeVisible();
    await settleCurrency(page);

    const currency = page.getByTestId('travel-essentials-currency');
    await expect(currency).toContainText('155.32');
    await expect(currency).toContainText('JPY');
    await expect(page.getByTestId('travel-essentials-currency-asof')).toContainText('2026-07-15');
  });
});

test.describe('S188/S276 · Nepal leg — Frankfurter without NPR → labeled reference rate, no cache', () => {
  test('a fresh Nepal-leg day with no cache and a symbol-less 200 shows the labeled reference rate (no crash)', async ({
    page,
  }) => {
    // S276 superseded D-189's `unavailable` outcome for NPR: with no cache the card now renders
    // the hand-set STATIC_REFERENCE_RATES value, labeled "reference rate … not a live quote".
    await stubFrankfurter(page, FRANKFURTER_NPR_MISSING_FIXTURE);
    await stubOpenMeteo(page);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-11', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-essentials')).toBeVisible();
    await settleCurrency(page);
    await openEssentials(page);
    await expect(page.getByTestId('travel-essentials-currency-reference')).toBeVisible();
  });
});

test.describe('S188 · offline: cached rate survives a failed refetch', () => {
  test('after one successful fetch, aborting the route + reloading still renders the cached rate', async ({
    page,
  }) => {
    await stubFrankfurter(page);
    await stubOpenMeteo(page);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-19', { waitUntil: 'load' });
    await settleCurrency(page);
    await expect(page.getByTestId('travel-essentials-currency')).toContainText('155.32');

    await page.unroute('**/api.frankfurter.dev/**');
    await page.route('**/api.frankfurter.dev/**', (route) => route.abort());
    await page.goto('/travel/?today=2026-12-10&date=2026-12-19', { waitUntil: 'load' });
    await settleCurrency(page);

    const currency = page.getByTestId('travel-essentials-currency');
    await expect(currency).toContainText('155.32');
    await expect(currency).toContainText('cached');
  });
});

test.describe('S188 · leg-correct weather + currency flip across the Dec 18/19 boundary', () => {
  test('Dec 18 shows Kathmandu/NPR-leg content; Dec 19 shows Osaka/JPY-leg content', async ({ page }) => {
    await stubFrankfurter(page);
    await stubOpenMeteo(page);

    await page.goto('/travel/?today=2026-12-10&date=2026-12-18', { waitUntil: 'load' });
    await settleWeather(page);
    await expect(page.getByTestId('travel-essentials-weather')).toContainText('Kathmandu');
    await expect(page.getByTestId('travel-essentials-safety')).toContainText('Nepal');

    await page.goto('/travel/?today=2026-12-10&date=2026-12-19', { waitUntil: 'load' });
    await settleWeather(page);
    await expect(page.getByTestId('travel-essentials-weather')).toContainText('Osaka');
    await expect(page.getByTestId('travel-essentials-safety')).toContainText('Japan');
  });
});

test.describe('S188 · flight-day-only visibility + byte-exact deep-link hrefs', () => {
  test('a non-travel day shows no flight card', async ({ page }) => {
    await stubFrankfurter(page);
    await stubOpenMeteo(page);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-14', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-essentials')).toBeVisible();
    await expect(page.getByTestId('travel-essentials-flights')).toHaveCount(0);
  });

  test('Dec 9 (arrival) shows the outbound flight card with correct deep-link hrefs', async ({ page }) => {
    await stubFrankfurter(page);
    await stubOpenMeteo(page);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-09', { waitUntil: 'load' });
    await openEssentials(page);
    const flightCard = page.getByTestId('travel-essentials-flight-outbound');
    await expect(flightCard).toBeVisible();

    // FR24 tracker — byte-exact for the first leg (Meridian Air 4471).
    const tracker = page.getByTestId('travel-essentials-tracker-out-1');
    await expect(tracker).toHaveAttribute('href', 'https://www.flightradar24.com/data/flights/md4471');
    await expect(tracker).toHaveAttribute('target', '_blank');
    await expect(tracker).toHaveAttribute('rel', /noopener/);

    const r2r = page.getByTestId('travel-essentials-rome2rio-outbound');
    await expect(r2r).toHaveAttribute(
      'href',
      'https://www.rome2rio.com/s/Syracuse%20(SYR)/Kathmandu%20(KTM)',
    );
    await expect(r2r).toHaveAttribute('target', '_blank');
    await expect(r2r).toHaveAttribute('rel', /noopener/);

    const gflights = page.getByTestId('travel-essentials-gflights-outbound');
    await expect(gflights).toHaveAttribute(
      'href',
      'https://www.google.com/travel/flights?q=Flights%20from%20Syracuse%20(SYR)%20to%20Kathmandu%20(KTM)',
    );
  });

  test('Dec 19 (arrival + domestic hop) shows BOTH journeys', async ({ page }) => {
    await stubFrankfurter(page);
    await stubOpenMeteo(page);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-19', { waitUntil: 'load' });
    await openEssentials(page);
    await expect(page.getByTestId('travel-essentials-flight-return-to-japan')).toBeVisible();
    await expect(page.getByTestId('travel-essentials-flight-tokyo-to-osaka')).toBeVisible();
  });

  test('Jan 9 (departure) shows the flight-home card', async ({ page }) => {
    await stubFrankfurter(page);
    await stubOpenMeteo(page);
    await page.goto('/travel/?today=2026-12-10&date=2027-01-09', { waitUntil: 'load' });
    await openEssentials(page);
    await expect(page.getByTestId('travel-essentials-flight-flight-home')).toBeVisible();
  });
});

test.describe('S188 · Wake Lock — feature-detect no-op where unsupported', () => {
  test('renders and runs with no error in a browser without navigator.wakeLock', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'wakeLock stub only needed once; chromium is representative');
    // Force the unsupported path even in a browser that DOES implement Wake Lock, so this spec
    // is deterministic across CI environments.
    await page.addInitScript(() => {
      // Test-only deletion to force the feature-detect branch.
      delete (navigator as unknown as Record<string, unknown>).wakeLock;
    });
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await stubFrankfurter(page);
    await stubOpenMeteo(page);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-14', { waitUntil: 'load' });
    await expect(page.getByTestId('travel-essentials')).toBeVisible();
    await expect(page.getByTestId('travel-wake-lock-hint')).toHaveCount(0);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});

test.describe('S188 · axe — the Essentials block', () => {
  test('zero serious/critical violations with weather + currency + safety + a flight card rendered', async ({
    page,
  }, testInfo) => {
    await stubFrankfurter(page);
    await stubOpenMeteo(page);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-09', { waitUntil: 'load' });
    await openEssentials(page);
    await expect(page.getByTestId('travel-essentials-flight-outbound')).toBeVisible();
    await settleCurrency(page);
    await settleWeather(page);

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    for (const v of results.violations) {
      testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})` });
    }
    expect(blocking, blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')).toEqual([]);
  });
});

test.describe('S188 · no console errors', () => {
  test('a full essentials render (flight day, weather, currency, safety) runs with no console.error / pageerror', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    await stubFrankfurter(page);
    await stubOpenMeteo(page);
    await page.goto('/travel/?today=2026-12-10&date=2026-12-19', { waitUntil: 'load' });
    await openEssentials(page);
    await expect(page.getByTestId('travel-essentials-flight-return-to-japan')).toBeVisible();
    await settleCurrency(page);
    await settleWeather(page);

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
