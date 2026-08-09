import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S274 (D-224) — trip-day timezone derivation E2E pack.
 *
 * Proves, on the served static `out/` build, that the REAL-clock branch of `getTodayInTrip`
 * (`lib/trip-now.ts` → `core/dates/day-in-trip.ts`'s `dayInTripFor`) now derives the trip-day
 * at the destination leg's fixed wall-clock offset instead of the DEVICE calendar day — fixing
 * the "home-time phone shows the wrong day" bug (P4, audit) while leaving the `?today=`
 * override and custom trips on device-local (D-140 parity / no known geography).
 *
 * Uses Playwright's fake clock (`page.clock.install`, the same idiom as
 * `e2e/tm-acceptance.spec.ts`'s TM-6b pair) + a per-context `timezoneId` to emulate a phone
 * that is on HOME time, not destination time — a real "wall clock" scenario the `?today=`
 * local-noon override (which declares the destination day directly, D-140) cannot express.
 * Reduced motion is pinned so the hero's count-up/reveal animations resolve immediately.
 *
 * The frozen S82 `?today=` boundary matrix (`e2e/countdown.spec.ts`) is run SEPARATELY,
 * unchanged, as the regression guard for the untouched override branch (D-224: "ZERO risk to
 * the frozen S82 matrix — that net runs only through the untouched override branch").
 */

const DEFAULT_TOKEN = 'Powan';

/** Seed the default signed-in identity (mirrors e2e/fixtures.ts) on a fresh context. */
async function seedDefaultIdentity(page: Page) {
  await page.addInitScript((token: string) => {
    window.localStorage.setItem('tripPlannerToken', token);
    window.localStorage.setItem('tripPlannerUserName', token);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1');
    window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss app-wide install toast (duration:Infinity poisons axe scans)
  }, DEFAULT_TOKEN);
}

/** Seed a signed-in traveler on a CUSTOM (non-default-pack) trip — mirrors
 *  e2e/custom-hero.spec.ts's seedCustomTrip: a single 'main' leg, utcOffsetMin 0 (no known
 *  geography). Dates deliberately sit OUTSIDE the default pack's Dec-9..Jan-9 window (May
 *  2027) so `getCityForDate` can't coincidentally resolve through the default pack's
 *  content-derived TRIP_CITIES map (which is not trip-scoped) — it must fall through to the
 *  custom leg's `fallbackCity`, the real device-local-fallback path under test. */
async function seedCustomTrip(page: Page) {
  const token = '11111111-2222-4333-8444-555566667777';
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
              start: '2027-05-08',
              end: '2027-05-12',
              destinations: ['Testville'],
              vibe: 'city',
              updatedAt: Date.now(),
            },
          },
        ]),
      );
    },
    { token, tour: 'nepal_japan_first_run_tour_seen' },
  );
}

test.describe('S274 (D-224) — home-time-phone regression guard', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('2026-12-10T03:00:00Z on a NY-time phone -> Day 2 / Kathmandu (device-local would say Day 1)', async ({
    page,
  }) => {
    // 03:00Z Dec 10 = 22:00 EST Dec 9 device-local -> the OLD device-local code would read
    // Day 1. The destination (NPT +345) reads 08:45 Dec 10 -> Day 2. This is the load-bearing
    // regression guard for the whole slice.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedDefaultIdentity(page);
    await page.clock.install({ time: new Date('2026-12-10T03:00:00Z') });
    await page.goto('/', { waitUntil: 'load' });

    await expect(page.getByTestId('hero-travel-mode')).toBeVisible();
    await expect(page.getByTestId('hero-day-number')).toHaveText('2');
    await expect(page.getByTestId('hero-travel-mode')).toContainText('Kathmandu');
  });
});

test.describe('S274 (D-224) — Dec-18->19 rollover uses the earliest-leg seed', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('16:00Z Dec 18 (21:45 NPT) -> still Day 10 / Kathmandu, not Day 11', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedDefaultIdentity(page);
    await page.clock.install({ time: new Date('2026-12-18T16:00:00Z') });
    await page.goto('/', { waitUntil: 'load' });

    await expect(page.getByTestId('hero-travel-mode')).toBeVisible();
    await expect(page.getByTestId('hero-day-number')).toHaveText('10');
    await expect(page.getByTestId('hero-travel-mode')).toContainText('Kathmandu');
  });

  test('19:00Z Dec 18 (04:00Z Dec 19 JST) -> Day 11 / Osaka', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedDefaultIdentity(page);
    await page.clock.install({ time: new Date('2026-12-18T19:00:00Z') });
    await page.goto('/', { waitUntil: 'load' });

    await expect(page.getByTestId('hero-travel-mode')).toBeVisible();
    await expect(page.getByTestId('hero-day-number')).toHaveText('11');
    await expect(page.getByTestId('hero-travel-mode')).toContainText('Osaka');
  });
});

test.describe('S274 (D-224) — boundary sharpness at Kathmandu midnight (18:15 UTC)', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('18:14Z -> Day 10, 18:15Z -> Day 11 (KTM 23:59 vs 00:00)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedDefaultIdentity(page);

    await page.clock.install({ time: new Date('2026-12-18T18:14:00Z') });
    await page.goto('/', { waitUntil: 'load' });
    await expect(page.getByTestId('hero-day-number')).toHaveText('10');
    await expect(page.getByTestId('hero-travel-mode')).toContainText('Kathmandu');

    await page.clock.setFixedTime(new Date('2026-12-18T18:15:00Z'));
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('hero-day-number')).toHaveText('11');
    await expect(page.getByTestId('hero-travel-mode')).toContainText('Osaka');
  });
});

test.describe('S274 (D-224) — custom trip has no known geography -> device-local fallback', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('fixed instant on a custom trip -> header tracks device-local date, not any leg offset', async ({
    page,
  }) => {
    // Custom trip: single 'main' leg, utcOffsetMin 0 -> tripOffsetMinFor returns null (no
    // known geography) -> dayInTripFor stays on the device-local branch. 03:00Z May 11 2027
    // under America/New_York (EDT, UTC-4) reads 23:00 EDT May 10 -> device-local date
    // 2027-05-10 -> the trip's Day 3 (window starts May 8).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedCustomTrip(page);
    await page.clock.install({ time: new Date('2027-05-11T03:00:00Z') });
    await page.goto('/', { waitUntil: 'load' });

    await expect(page.getByTestId('hero-travel-mode')).toBeVisible();
    await expect(page.getByTestId('hero-day-number')).toHaveText('3');
    await expect(page.getByTestId('hero-travel-mode')).toContainText('Testville');
    await expect(page.getByTestId('hero-travel-mode')).not.toContainText('Kathmandu');
  });
});
