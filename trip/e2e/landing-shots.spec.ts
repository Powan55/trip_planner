import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * S356 — the landing-page product-shot SHOOT. This is an ASSET GENERATOR, not a check.
 *
 * 🔴 IT IS NOT PART OF THE DEFAULT NET. It WRITES committed files under
 * `public/images/landing/`, so running it inside `npm run test:e2e` would rewrite tracked
 * assets mid-suite. It is excluded via the chromium project's `testIgnore` in
 * `playwright.config.ts` (same mechanism `tm-acceptance.spec.ts` already uses) and is invoked
 * explicitly:
 *
 *   npm run build                       # out/ must exist — webServer builds nothing
 *   PLAYWRIGHT_PORT=<free> npx playwright test e2e/landing-shots.spec.ts --project=chromium
 *   npm run gen:images                  # AVIF/WebP derivatives + lib/image-manifest.json
 *
 * 🔴 WHY THE FIXTURE BELOW IS FICTIONAL, AND WHY THAT IS THE ONLY GUARANTEE THERE IS.
 * These PNGs land on a PUBLIC marketing page that a logged-out stranger sees. No grep, lint
 * or test in this repo can read text inside a raster — `e2e/login.spec.ts:75-92` ("the wall
 * carries no live trip data") passes trivially against any string baked into an image. D-242
 * governs SOURCE; a screenshot has no source. So the fiction has to be structural:
 *
 *   - The itinerary/expense payloads here are AUTHORED FOR THE SHOOT. They deliberately do
 *     NOT reuse `SAMPLE_ITINERARY` — despite the name, `lib/sample-itinerary.ts` is a one-line
 *     re-export of `TRIP_ITINERARY`, i.e. the REAL 32-day content pack.
 *   - The three names (Sam / Alex / Rina) are NOT the `TRAVELERS` roster in `lib/token-auth.ts`.
 *     The identity seeded below is `Sam`, so no real traveler name can reach a pixel via the
 *     navbar chip, the author-filter chips, or an expense's "logged by" line.
 *   - Coordinates are public landmarks (a stupa, a square, a shrine) — never a residence.
 *   - No flight numbers, seat rows, booking refs or street addresses exist in this file (D-242).
 *
 * Settling discipline is copied from `e2e/visual.spec.ts:150-173`: an own context (so
 * `reducedMotion` — a CONTEXT option — applies), `?today=` frozen clock (D-075), wait for the
 * SW controller, the lead <h1>, the lazy island's own testid, then `document.fonts.ready`.
 * An unsettled page screenshots with half-loaded fonts.
 */

/** Frozen PRE-trip clock (D-075) — keeps the planner on TRIP_DATES[0] and nothing ticking. */
const SHOOT_TODAY = '2026-11-15';

/** Phone frame. The landing slots are `aspect-[390/844]` (`landing-page.tsx`), so the shot is 1:1. */
const VIEWPORT = { width: 390, height: 844 } as const;

/** Fictional party for the shoot. Deliberately none of `TRAVELERS` (Powan / Sushil / Uttam). */
const ME = 'Sam';
const FRIEND_A = 'Alex';
const FRIEND_B = 'Rina';

/**
 * The fictional trip. Three authored days — a full Kathmandu day 1 (the day-planner shot),
 * a short second Nepal day, and a Tokyo day the expenses hang off. Days not listed simply
 * render the planner's empty state, which is honest.
 */
const FICTIONAL_PLANS = [
  {
    date: '2026-12-09',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      {
        id: 'ls-d1-1',
        title: 'Rooftop sunrise',
        category: 'photography',
        startMinutes: 380, // 06:20
        durationMinutes: 40,
        location: 'Thamel',
        notes: 'Haze lifts by seven.',
        lat: 27.7154,
        lng: 85.3123,
        createdBy: ME,
      },
      {
        id: 'ls-d1-2',
        title: 'Chiya and bara',
        category: 'food',
        startMinutes: 450, // 07:30
        durationMinutes: 45,
        location: 'Thamel corner shop',
        createdBy: FRIEND_B,
      },
      {
        id: 'ls-d1-3',
        title: 'Boudhanath kora',
        category: 'cultural',
        startMinutes: 540, // 09:00
        durationMinutes: 90,
        location: 'Boudhanath Stupa',
        lat: 27.7215,
        lng: 85.362,
        createdBy: ME,
      },
      {
        id: 'ls-d1-4',
        title: 'Patan courtyards',
        category: 'sightseeing',
        startMinutes: 675, // 11:15
        durationMinutes: 105,
        location: 'Patan',
        lat: 27.6727,
        lng: 85.325,
        createdBy: FRIEND_A,
      },
      {
        id: 'ls-d1-5',
        title: 'Momo lunch',
        category: 'food',
        startMinutes: 810, // 13:30
        durationMinutes: 60,
        location: 'Mangal Bazaar',
        createdBy: FRIEND_B,
      },
      {
        id: 'ls-d1-6',
        title: 'Garden of Dreams',
        category: 'free',
        startMinutes: 960, // 16:00
        durationMinutes: 90,
        location: 'Kaiser Mahal',
        lat: 27.7145,
        lng: 85.3145,
        createdBy: ME,
      },
    ],
  },
  {
    date: '2026-12-11',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      {
        id: 'ls-d3-1',
        title: 'Bus to the hills',
        category: 'transportation',
        startMinutes: 420, // 07:00
        durationMinutes: 180,
        location: 'Machha Pokhari stand',
        createdBy: FRIEND_A,
      },
      {
        id: 'ls-d3-2',
        title: 'Ridge walk at dusk',
        category: 'nature',
        startMinutes: 900, // 15:00
        durationMinutes: 120,
        createdBy: ME,
      },
    ],
  },
  {
    date: '2026-12-22',
    city: 'Tokyo',
    country: 'japan',
    items: [
      // No lat/lng on the Japan day ON PURPOSE: `buildItineraryStops` fits the map to EVERY
      // pinned stop, and a Kathmandu+Tokyo bounding box zooms out to all of Asia (verified —
      // the first shoot produced exactly that). Pins live only on the Nepal day so shot 3
      // frames one city.
      {
        id: 'ls-d14-1',
        title: 'Shrine, early',
        category: 'cultural',
        startMinutes: 465, // 07:45
        durationMinutes: 75,
        location: 'Meiji Jingu',
        createdBy: FRIEND_B,
      },
      {
        id: 'ls-d14-2',
        title: 'Old-town streets',
        category: 'photography',
        startMinutes: 630, // 10:30
        durationMinutes: 120,
        location: 'Yanaka',
        createdBy: ME,
      },
      {
        id: 'ls-d14-3',
        title: 'Izakaya, all of us',
        category: 'food',
        startMinutes: 1140, // 19:00
        durationMinutes: 120,
        location: 'Shinjuku',
        createdBy: ME,
      },
    ],
  },
];

/** Fictional expenses. Newest `createdAt` sorts first, so the split dinner heads the list. */
const FICTIONAL_EXPENSES = [
  {
    id: 'ls-exp-1',
    leg: 'nepal',
    category: 'food',
    amount: 2450,
    date: '2026-12-11',
    note: 'Momo lunch for three, Mangal Bazaar',
    createdAt: '2026-12-11T08:15:00.000Z',
    createdBy: FRIEND_B,
  },
  {
    id: 'ls-exp-2',
    leg: 'japan',
    category: 'free',
    amount: 3000,
    date: '2026-12-20',
    note: 'IC card top-up',
    createdAt: '2026-12-20T02:40:00.000Z',
    createdBy: FRIEND_A,
  },
  {
    id: 'ls-exp-3',
    leg: 'japan',
    category: 'hotel',
    amount: 24600,
    date: '2026-12-21',
    note: 'Two nights',
    createdAt: '2026-12-21T09:05:00.000Z',
    paidBy: FRIEND_A,
    split: [ME, FRIEND_A, FRIEND_B],
    createdBy: FRIEND_A,
  },
  {
    id: 'ls-exp-5',
    leg: 'japan',
    category: 'food',
    amount: 11700,
    date: '2026-12-22',
    note: 'Izakaya, Shinjuku',
    createdAt: '2026-12-22T13:30:00.000Z',
    paidBy: ME,
    split: [ME, FRIEND_A, FRIEND_B],
    createdBy: ME,
  },
];

/** Seed exactly the on-disk bytes the app writes: identity + the v5 itinerary envelope + expenses. */
async function seedFictionalTrip(ctx: BrowserContext) {
  await ctx.addInitScript(
    ({ me, plans, expenses }: { me: string; plans: unknown; expenses: unknown }) => {
      window.localStorage.setItem('tripPlannerToken', me);
      window.localStorage.setItem('tripPlannerUserName', me);
      window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1');
      window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1');
      window.localStorage.setItem('nepal_japan_travel_mode', 'seen');
      // CURRENT_ITINERARY_VERSION === 5 (core/vault/migrations.ts).
      window.localStorage.setItem(
        'nepal_japan_itinerary',
        JSON.stringify({ schemaVersion: 5, updatedAt: '2026-11-15T00:00:00.000Z', payload: plans }),
      );
      window.localStorage.setItem('nepal_japan_expenses', JSON.stringify(expenses));
    },
    { me: ME, plans: FICTIONAL_PLANS, expenses: FICTIONAL_EXPENSES },
  );
}

/** Mirror of `visual.spec.ts` gotoSettled: frozen clock, SW controller, lead h1, fonts. */
async function gotoSettled(page: Page, route: string) {
  const url = route + (route.includes('?') ? '&' : '?') + `today=${SHOOT_TODAY}`;
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
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  await page
    .evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.ready)
    .catch(() => {});
}

/** Put `testId`'s box at the top of the viewport, then let paint settle. */
async function frame(page: Page, testId: string, offsetY = 0) {
  await page.getByTestId(testId).evaluate((el, dy) => {
    const top = el.getBoundingClientRect().top + window.scrollY - dy;
    window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
  }, offsetY);
  await page.waitForTimeout(600);
}

test.describe('S356 — landing product shots', () => {
  let ctx: BrowserContext;
  let page: Page;
  let outDir: string;

  test.beforeEach(async ({ browser }, testInfo) => {
    outDir = path.join(testInfo.config.rootDir, '..', 'public', 'images', 'landing');
    await mkdir(outDir, { recursive: true });
    ctx = await browser.newContext({
      viewport: { ...VIEWPORT },
      reducedMotion: 'reduce',
      deviceScaleFactor: 1, // 390px-wide source → gen-images emits no sub-native variants (R2).
    });
    await seedFictionalTrip(ctx);
    page = await ctx.newPage();
  });

  test.afterEach(async () => {
    await ctx.close();
  });

  test('shot 1 — the day planner, a morning in Kathmandu', async () => {
    await gotoSettled(page, '/plan/');
    // The planner is a dynamic(ssr:false) island — wait for its own furniture, not just the h1.
    await expect(page.getByTestId('calendar-add-item')).toBeVisible({ timeout: 20_000 });
    // Testid, not text: the same title also renders in the TripTimeline below (strict-mode clash).
    await expect(page.getByTestId('calendar-row-swipe-ls-d1-1')).toBeVisible({ timeout: 20_000 });
    await frame(page, 'calendar-day-glance', 120);
    await page.screenshot({ path: path.join(outDir, 'shot-1-day-planner.png') });
  });

  test('shot 2 — the shared expense list, splitting a dinner in Tokyo', async () => {
    await gotoSettled(page, '/plan/');
    await expect(page.getByTestId('budget-panel')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('budget-view-tab-expenses').click();
    await expect(page.getByTestId('expense-list')).toBeVisible({ timeout: 20_000 });
    await frame(page, 'budget-view-tab-expenses', 96);
    await page.screenshot({ path: path.join(outDir, 'shot-2-expenses.png') });
  });

  test('shot 3 — the trip map with the saved places pinned', async () => {
    await gotoSettled(page, '/map/');
    await expect(page.getByTestId('map-shell')).toBeVisible({ timeout: 20_000 });
    // Overlay the fictional trip's pinned stops on top of the curated markers.
    await page.getByTestId('map-itinerary-toggle').click();
    await expect(page.getByTestId('map-itinerary-count')).toBeVisible({ timeout: 20_000 });
    await frame(page, 'map-shell', 72); // just clear of the sticky navbar
    await page.waitForTimeout(1500); // GL canvas paint
    await page.screenshot({ path: path.join(outDir, 'shot-3-map.png') });
  });
});
