import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S110-FIX / F19b — in-trip axe accessibility scan pack.
 *
 * Closes the blind spot that `e2e/a11y.spec.ts` (S85) leaves open: that pack scans each route
 * with the app clock OUTSIDE the trip window, so the in-trip surfaces — the Today panel
 * (`today-panel.tsx`, incl. its WeatherCard + JournalCard), the read-only day recap
 * (`trip-recap.tsx`), and the budget / burn-rate panels (`budget-panel.tsx` / `burn-rate-view.tsx`)
 * on `/plan` — are NEVER axe-scanned there. This pack drives the `?today=` override (D-075) INTO the
 * trip window (`2026-12-12`, Day 4 Kathmandu), seeds one journal entry + one expense + a budget
 * through the app's own storage shapes so that content actually renders, scrolls the relevant panels
 * into view, and asserts ZERO serious/critical axe violations — the SAME hard contract as S85.
 *
 * ── Harness (mirrors a11y.spec.ts + today.spec.ts) ──────────────────────────────────────────────
 *   - `test`/`expect` from `./fixtures` (signed-in front-door bypass — `tripPlannerToken` seeded
 *     pre-script so the Trip Token wall never opens; otherwise the scan would audit the dialog,
 *     not the page).
 *   - reduced motion is pinned (as today.spec.ts does). S354/D-246 replaced D-100's full-opacity
 *     PIN with a 0.7→1 floor, so that old "the reveals never fade" reasoning no longer holds —
 *     what holds now is that every floored reveal forks on `useReducedMotion()` and its reduced
 *     branch lands at opacity 1, so under the pinned preference this scan still sees fully-opaque
 *     text. That fork is asserted directly in e2e/reveal.spec.ts (S354 describe block).
 *   - navigation settles on `waitUntil:'domcontentloaded'` + a real readiness wait on the route's
 *     `dynamic({ssr:false})` island (FU-26/S167 — never `networkidle`, the SW precache defeats it)
 *     BEFORE axe runs, so the scan never catches a pre-hydrate frame.
 *   - the serious/critical partition + annotations logging match a11y.spec.ts exactly; moderate/minor
 *     are surfaced but non-fatal.
 */

const IN_TRIP_DAY = '2026-12-12'; // Day 4 (Kathmandu / Nepal window) — inside TRIP_DATES.

// Storage keys (the app's own shapes — see core/storage/gateway.ts + lib/itinerary-storage.ts).
const ITINERARY_KEY = 'nepal_japan_itinerary';
const JOURNAL_KEY = 'nepal_japan_journal';
const EXPENSES_KEY = 'nepal_japan_expenses';
const BUDGET_KEY = 'nepal_japan_budget';

/**
 * Seed all in-trip content BEFORE any app script runs, on every navigation in this context
 * (addInitScript, like the identity fixture). Shapes are the app's own persisted envelopes:
 *   - itinerary: a bare `DayPlan[]` (lib/itinerary-storage reads the key verbatim — D-018),
 *   - journal:   a bare `JournalEntry[]` (core/journal/storage),
 *   - expenses:  a bare `Expense[]` (core/budget/expenses),
 *   - budget:    a `BudgetModel` with a nepal leg budget so the burn-rate view renders (it is
 *                `null` when the budget is 0). All localStorage-only, offline-safe.
 */
async function seedInTrip(page: Page) {
  await page.addInitScript(
    ({ itinKey, journalKey, expensesKey, budgetKey, date }) => {
      window.localStorage.setItem(
        itinKey,
        JSON.stringify([
          {
            date,
            city: 'Kathmandu',
            country: 'nepal',
            items: [
              { id: 'a11y-1', title: 'Boudhanath at dawn', category: 'photography', time: '06:00', location: 'Boudhanath Stupa' },
              { id: 'a11y-2', title: 'Thamel wander', category: 'sightseeing', done: true },
            ],
          },
        ]),
      );
      window.localStorage.setItem(
        journalKey,
        JSON.stringify([
          {
            date,
            text: 'Quiet morning at the stupa, then momos in Thamel. A good, gentle first few days.',
            mood: 'good',
            highlight: 'Prayer flags at first light',
            createdAt: '2026-12-12T09:00:00.000Z',
            updatedAt: '2026-12-12T09:00:00.000Z',
          },
        ]),
      );
      window.localStorage.setItem(
        expensesKey,
        JSON.stringify([
          {
            id: 'a11y-exp-1',
            leg: 'nepal',
            category: 'food',
            amount: 1200,
            date,
            note: 'Momos + tea',
            createdAt: '2026-12-12T10:00:00.000Z',
          },
        ]),
      );
      window.localStorage.setItem(
        budgetKey,
        JSON.stringify({
          version: 1,
          homeCurrency: 'USD',
          rates: { NPR: 133, JPY: 156 },
          legBudgets: { nepal: 50000, japan: 200000 },
          categoryBudgets: { nepal: { food: 10000 } },
        }),
      );
    },
    { itinKey: ITINERARY_KEY, journalKey: JOURNAL_KEY, expensesKey: EXPENSES_KEY, budgetKey: BUDGET_KEY, date: IN_TRIP_DAY },
  );
}

/** Navigate with the `?today=` override + reduced motion pinned, then block on the route's
 * in-trip island so the axe scan never races a pre-hydrate frame. */
async function gotoInTrip(page: Page, path: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const sep = path.includes('?') ? '&' : '?';
  // FU-26 (S167): nav settles on `domcontentloaded` + a REAL readiness wait, not `networkidle`.
  // The production SW precaches ~80 entries + runs update checks, so the network never idles for
  // 500ms under load — `networkidle` was the actual axe-scan flake source in S117 (S114/FU-15).
  // Block on the route's in-trip dynamic island (`/plan/` → budget panel, `/` → Today panel) so
  // the scan runs against hydrated content. Assertions downstream are unchanged in strength.
  await page.goto(`${path}${sep}today=${IN_TRIP_DAY}`, { waitUntil: 'domcontentloaded' });
  const ready = path.startsWith('/plan') ? 'budget-panel' : 'today-panel';
  await expect(page.getByTestId(ready)).toBeVisible({ timeout: 15_000 });
}

/** Build an axe scan (exclude only the opaque MapLibre canvas, exactly as a11y.spec.ts does). */
function scanFor(page: Page) {
  return new AxeBuilder({ page }).exclude('canvas.maplibregl-canvas');
}

/** The shared serious/critical assertion + annotation logging (mirrors a11y.spec.ts). */
async function expectNoSeriousCritical(page: Page, label: string, testInfo: import('@playwright/test').TestInfo) {
  const results = await scanFor(page).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const advisory = results.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');
  for (const v of results.violations) {
    const line = `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`;
    testInfo.annotations.push({ type: `axe:${v.impact ?? 'unknown'}`, description: line });
    console.log(`  axe ${label} ${line}`);
  }
  console.log(`axe SUMMARY ${label}: serious/critical=${blocking.length}, moderate/minor=${advisory.length}`);
  expect(
    blocking,
    `serious/critical a11y violations on ${label}: ${blocking
      .map((v) => `${v.id} [${v.impact}] × ${v.nodes.length}`)
      .join('; ')}`,
  ).toEqual([]);
}

/**
 * #54C — a 7-DAY Open-Meteo body, stubbed LOCALLY for this pack.
 *
 * Why local and not hoisted into `e2e/fixtures.ts`: the sibling weather specs
 * (`weather.spec.ts:136`, `weather-tag.spec.ts:58`, `travel-essentials.spec.ts:48`) each assert
 * against a DELIBERATELY different body, so an always-on route would silently flip them from
 * `unavailable` to `live`. A third copy of the literal beats that coupling.
 *
 * Why 7 days and not 1: with a working network this pack renders the real forecast, so axe scans
 * `ForecastOutlook` (the `<details>`/`<ol>` at `weather-card.tsx:99-113`). A 1-day body makes
 * `parseForecast` return a single row and shrinks the scanned surface — quietly reducing a11y
 * coverage to get green is exactly what D-007 forbids. Literal copied from `weather-tag.spec.ts:34`.
 */
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

test.describe('in-trip axe (F19b) — Today panel + recap + budget/burn-rate scanned in-window', () => {
  // #54C — this was the ONLY weather-rendering pack with no Open-Meteo stub. On a runner with no
  // route to the host the connection STALLS rather than rejecting, `fetchWeather` never settles,
  // `data-state` stays `loading`, and the readiness wait below times out (CI run 31641098716:
  // 30s × 3/3 attempts). Registered BEFORE any navigation so no request escapes to the live API.
  test.beforeEach(async ({ page }) => {
    await page.route('**/api.open-meteo.com/**', (route) => route.fulfill({ json: OPEN_METEO_WEEK_FIXTURE }));
  });

  test('Home in-trip: Today panel (weather + journal) + day recap have zero serious/critical', async ({ page }, testInfo) => {
    await seedInTrip(page);
    await gotoInTrip(page, '/');

    // Settle: the in-trip Today island + the recap island must have mounted from hydrated storage.
    await expect(page.getByTestId('today-panel')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('journal-card')).toBeVisible({ timeout: 15_000 });
    // The weather card fetches async and, while pending, renders a loading skeleton whose
    // `aria-busy` div carries an `aria-label` (axe: aria-prohibited-attr [serious]) — block until
    // it resolves to a concrete state so the scan audits the settled card, not the skeleton.
    // (`networkidle` used to mask this by waiting out the fetch; S167/FU-26 makes the wait explicit.)
    await page.waitForFunction(
      () => {
        const s = document.querySelector('[data-testid="weather-card"]')?.getAttribute('data-state');
        return s === 'live' || s === 'cached' || s === 'unavailable';
      },
      { timeout: 15_000 },
    );
    // The recap renders once the trip has elapsed days; wait for its populated Day-4 card + journal read.
    await expect(page.getByTestId('trip-recap')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`recap-journal-${IN_TRIP_DAY}`)).toBeVisible({ timeout: 15_000 });
    // Scroll the recap into view so axe evaluates it laid out (not just the Today panel above the fold).
    await page.getByTestId('trip-recap').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300); // brief settle after scroll (reveals are full-opacity; no fade race)

    await expectNoSeriousCritical(page, 'home?today (Today+recap)', testInfo);
  });

  test('Plan in-trip: budget panel + burn-rate view have zero serious/critical', async ({ page }, testInfo) => {
    await seedInTrip(page);
    await gotoInTrip(page, '/plan/');

    // Settle: the budget panel (dynamic island) is up.
    await expect(page.getByTestId('budget-panel')).toBeVisible({ timeout: 15_000 });

    // S322: the money views (budget · expenses · burn · settle) sit behind a segmented control, one
    // at a time. axe only scans the VISIBLE panel (hidden ones are display:none), so scan each money
    // view in turn. Budget is the default view.
    await expectNoSeriousCritical(page, 'plan?today (budget view)', testInfo);

    await page.getByTestId('budget-view-tab-burn').click();
    await expect(page.getByTestId('burn-rate')).toBeVisible({ timeout: 15_000 }); // seeded budget → renders
    await page.getByTestId('burn-rate').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await expectNoSeriousCritical(page, 'plan?today (burn-rate view)', testInfo);

    await page.getByTestId('budget-view-tab-expenses').click();
    await expect(page.getByTestId('expense-list')).toBeVisible({ timeout: 15_000 }); // the seeded expense row
    await expectNoSeriousCritical(page, 'plan?today (expenses view)', testInfo);
  });
});
