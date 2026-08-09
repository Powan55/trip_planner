import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S251 — New-trip wizard (`/trips/` Create card) + clean slate.
 *
 * Proves, on the served static `out/` build:
 *   1. Creating a trip with explicit start/end dates lands on Home, and `/plan/` shows day
 *      shells for exactly that date range (own clean slate) — NO Nepal×Japan seed content
 *      (a known N×J itinerary title, "Boudhanath", is absent).
 *   2. Switching back to the default trip via `/trips/` restores the real Nepal×Japan
 *      itinerary (the "Boudhanath" title is present again).
 */

const ACTIVE_TRIP_KEY = 'tripPlannerActiveTrip';
const TOUR_SEEN = 'nepal_japan_first_run_tour_seen';
const HOME_URL = /^https?:\/\/[^/]+\/$/;
const NJ_TITLE = 'Boudhanath'; // a real Nepal-leg itinerary item title (core/content/itinerary.ts)

/** Seed a signed-in traveler before any app script (so /plan/ never hits the front-door wall). */
async function seedTraveler(page: Page) {
  await page.addInitScript(
    ({ tour }: { tour: string }) => {
      window.localStorage.setItem('tripPlannerToken', 'Powan');
      window.localStorage.setItem('tripPlannerUserName', 'Powan');
      window.localStorage.setItem(tour, '1');
    },
    { tour: TOUR_SEEN },
  );
}

async function gotoTrips(page: Page) {
  await page.goto('/trips/', { waitUntil: 'load' });
  await expect(page.getByTestId('trips-hub-list')).toBeVisible({ timeout: 15_000 });
}

/** The lazy `CalendarPlanner` island is mounted once a `calendar-day-*` cell is present. */
async function gotoPlan(page: Page) {
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'visible', timeout: 15_000 });
}

const readActiveTrip = (page: Page) =>
  page.evaluate((k) => window.localStorage.getItem(k), ACTIVE_TRIP_KEY);

test.describe('S251 — trip wizard creates a clean-slate custom trip', () => {
  test('explicit dates → own day shells, no N×J content; switching back restores N×J', async ({
    page,
  }) => {
    await seedTraveler(page);
    await gotoTrips(page);

    await page.getByTestId('trips-hub-create-name').fill('Kerala Getaway');
    await page.getByTestId('trips-hub-create-start').fill('2027-03-01');
    await page.getByTestId('trips-hub-create-end').fill('2027-03-03');
    await page.getByTestId('trips-hub-create-destinations').fill('Kochi, Munnar');
    await page.getByTestId('trips-hub-create-vibe-beach').click();
    await page.getByTestId('trips-hub-create').click();

    await page.waitForURL(HOME_URL, { timeout: 15_000 });
    const token = await readActiveTrip(page);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);

    // The custom trip's /plan/ shows exactly its own 3-day span, no default-pack dates.
    await gotoPlan(page);
    await expect(page.getByTestId('calendar-day-2027-03-01')).toBeVisible();
    await expect(page.getByTestId('calendar-day-2027-03-02')).toBeVisible();
    await expect(page.getByTestId('calendar-day-2027-03-03')).toBeVisible();
    await expect(page.getByTestId('calendar-day-2026-12-09')).toHaveCount(0); // default-pack date

    // Clean slate: no Nepal×Japan seed itinerary content anywhere on the page.
    await expect(page.getByText(NJ_TITLE)).toHaveCount(0);

    // ── Switch back to the default trip via /trips/. ──
    await gotoTrips(page);
    await page
      .getByTestId('trips-hub-row-0')
      .getByRole('button', { name: /tap to switch/ })
      .click();
    await page.waitForURL(HOME_URL, { timeout: 15_000 });
    expect(await readActiveTrip(page)).toBe('nepal-japan-2026');

    // The default pack's real itinerary is intact.
    await gotoPlan(page);
    await expect(page.getByTestId('calendar-day-2026-12-09')).toBeVisible();
    await page.getByTestId('calendar-day-2026-12-11').click(); // n3-6 "Sunset at Boudhanath Stupa"
    await expect(page.getByText(NJ_TITLE).first()).toBeVisible();
  });
});
