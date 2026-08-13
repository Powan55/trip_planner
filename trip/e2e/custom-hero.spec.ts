import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S253 — universal vibe hero for custom (non-default-pack) trips.
 *
 * Proves, on the served static `out/` build:
 *   1. A traveler on a custom trip sees their OWN trip name + date range (+ destinations/vibe
 *      tagline) in the Home hero, never the "Nepal × Japan" branding or copy.
 *   2. At a 360×740 mobile viewport the countdown grid + primary CTA land above the fold and
 *      the page never overflows horizontally (S253 mobile-polish acceptance, both trip types).
 */

const TOKEN = '11111111-2222-4333-8444-555566667777';
const TOUR_SEEN = 'nepal_japan_first_run_tour_seen';

/** Seed a signed-in traveler on a CUSTOM trip (mirrors e2e/trip-wizard.spec.ts's seeding pattern:
 *  the registry entry + config block live entirely in `tripPlannerKnownTrips`, gateway key 26). */
async function seedCustomTrip(page: Page) {
  await page.addInitScript(
    ({ token, tour }: { token: string; tour: string }) => {
      window.localStorage.setItem('tripPlannerToken', 'Powan');
      window.localStorage.setItem('tripPlannerUserName', 'Powan');
      window.localStorage.setItem(tour, '1');
      window.localStorage.setItem('tripPlannerActiveTrip', token);
      window.localStorage.setItem(
        'tripPlannerKnownTrips',
        JSON.stringify([
          {
            id: token,
            name: 'Testville Escape',
            joinedAt: Date.now(),
            config: {
              start: '2027-05-10',
              end: '2027-05-12',
              destinations: ['Testville', 'Sampleburg'],
              vibe: 'beach',
              updatedAt: Date.now(),
            },
          },
        ]),
      );
    },
    { token: TOKEN, tour: TOUR_SEEN },
  );
}

test.describe('S253 — custom trip hero', () => {
  test('shows the trip name + date range + destinations, no Nepal×Japan branding', async ({ page }) => {
    await seedCustomTrip(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const heading = page.locator('#hero-heading');
    await expect(heading).toHaveText('Testville Escape');

    const hero = page.locator('section#hero');
    await expect(hero).not.toContainText('Nepal');
    await expect(hero).not.toContainText('Japan');

    // Date badge is already trip-correct (core/dates derives TRIP_DATE_LABEL from the active trip).
    await expect(hero).toContainText('May 10, 2027 – May 12, 2027');

    // Subtitle: destinations joined + the beach vibe's tagline.
    await expect(hero).toContainText('Testville × Sampleburg');
    await expect(hero).toContainText('Salt air, slow days, endless horizon.');

    // S321 — the hero collapsed to ONE primary CTA. Pre-trip (this custom trip starts
    // 2027-05-10) it is "Open Planner" → the universal /plan/ (works for any trip; there is
    // no longer a destinations CTA that would dangle to a nonexistent custom guide).
    await expect(page.getByRole('link', { name: 'Open Planner' })).toHaveAttribute('href', '/plan/');
  });

  // S407 — the custom trip's PLANNER day header, on the served build. Two outputs are wrong here
  // and this asserts against both: "Testville, Japan" (the pre-S407 nepal/japan ternary, which
  // named a country the traveller is nowhere near) and "Testville, Testville × Sampleburg" (the
  // naive fix — a custom leg's `countryLabel` IS `destinations.join(' × ')`, core/trips/custom.ts).
  // A single-leg trip's country label is constant across the trip, so it is simply omitted.
  test('the planner day header names the city alone — no country, no joined-destinations label', async ({ page }) => {
    await seedCustomTrip(page);
    await page.goto('/plan/?today=2027-05-11', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('calendar-prev-day')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('calendar-day-2027-05-11').click();

    // `exact` matters: a substring match would still pass if a label were appended.
    await expect(page.getByText('Day 2 • Testville', { exact: true })).toBeVisible();
    await expect(page.getByText('Day 2 • Testville, Japan')).toHaveCount(0);
    await expect(page.getByText('Day 2 • Testville, Nepal')).toHaveCount(0);
    await expect(page.getByText('Day 2 • Testville, Testville × Sampleburg')).toHaveCount(0);
  });

  test('360×740 mobile: tidy 3-col countdown grid above the fold, no horizontal overflow', async ({
    browser,
  }) => {
    // reducedMotion: the hero's entrance reveals move the countdown cells, which jitters
    // boundingBox() row-y comparisons on a live run; 'reduce' collapses them (D-179 guarantees
    // the reduced layout is identical). (S354 deleted the cells' `.animate-pulse-glow` loop,
    // which this note used to cite — the entrance motion is the remaining reason to pin it.)
    // serviceWorkers blocked per the standing SW-stub memory rule.
    const context = await browser.newContext({
      viewport: { width: 360, height: 740 },
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await seedCustomTrip(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#hero-heading').waitFor({ state: 'visible' });

    // No horizontal scrollbar at 360px (the hard mobile-polish requirement).
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);

    // `grid-cols-3 sm:flex` (S253 mobile polish): the countdown cells lay out 3 to a row at
    // this width. The first 3 share one row, the 4th starts the next.
    //
    // The cells are read by POSITION, not by unit name: since issue #11 a calendar unit that
    // is zero is not rendered, so which of months/weeks/days is present depends on the real
    // clock against this seeded trip's 2027-05-10 start. The rendered set is 3 to 6 cells,
    // always ending in hours/minutes/seconds, which is enough for the row test.
    const cells = page.getByTestId(/^countdown-(months|weeks|days|hours|minutes|seconds)$/);
    const count = await cells.count();
    expect(count).toBeGreaterThanOrEqual(4);
    const boxes = await Promise.all(
      [0, 1, 2, 3].map((i) => cells.nth(i).boundingBox()),
    );
    for (const box of boxes) expect(box).not.toBeNull();
    const [first, second, third, fourth] = boxes;
    expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
    expect(Math.abs(first!.y - third!.y)).toBeLessThan(2);
    expect(fourth!.y).toBeGreaterThan(first!.y + 5); // 2nd row, strictly below the 1st

    // The countdown grid itself lands above the fold (it's the first content below the
    // hero's badge/title/subtitle/quote — the explicit mobile-polish
    // target). Note: the CTA row further below does not also fit above a literal 740px fold —
    // that is pre-existing hero content height (badge + 2-line title + subtitle + quote +
    // label), identical for the default Nepal×Japan hero at this viewport, and trimming that
    // copy was out of this slice's scope.
    expect(first!.y + first!.height).toBeLessThanOrEqual(740);

    await context.close();
  });
});
