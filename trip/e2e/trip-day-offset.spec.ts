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
 *
 * Amended: the offset names WHICH trip day it is, but the DEVICE calendar decides whether we
 * are inside the trip window at all — see the third describe below for the two ends, where
 * deriving both from the offset put the hero a day ahead of the phone, the countdown and the
 * flights card.
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

test.describe('the trip window is the DEVICE calendar, at both ends', () => {
  test.use({ timezoneId: 'America/New_York' });

  // The offset branch above answers "which trip day is it" correctly and used to answer
  // "are we on the trip at all" as well — at the destination offset, 10h45m ahead of the
  // phone. Nothing else in the app agreed: `TRIP_START`, `getFlightTiming` and
  // `elapsedInclusiveDays` all read the device calendar. Neither instant below is reachable
  // from a `?today=` spec — an active override passes `null` for the offset, so the frozen
  // boundary matrix in `e2e/countdown.spec.ts` runs the device branch only.

  test('18:15Z Dec 8 (13:15 EST, the night before) -> countdown, NOT Day 1 (Kathmandu is already on Dec 9)', async ({
    page,
  }) => {
    // 18:15Z is Kathmandu midnight, which is what used to flip the hero. The phone reads
    // 13:15 EST on Dec 8 and TRIP_START (Dec 9 00:00 LOCAL = 05:00Z) is 10h45m away, so the
    // countdown grid is what belongs here — the traveller has not left yet. An expense logged
    // in this window was being STORED as 2026-12-09, which is what makes it worth a spec.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedDefaultIdentity(page);
    // `clock.install({ time })` only seeds the START time — Date keeps ticking at the
    // real wall-clock rate after that (Playwright's own docs: use `pauseAt` for a
    // deterministic read). The target instant here lands EXACTLY on a whole-minute
    // boundary (TRIP_START − now = 10:45:00.000), so any measurable page-load/hydration
    // delay flips `countdown-minutes` from 45 to 44 before the first assertion — this
    // was failing on every run, not flaking occasionally. Installing 30s before the
    // intended instant and then `pauseAt`-ing to it once the page has loaded (the
    // documented pattern) lets timers fire normally during load and then freezes the
    // clock at the exact instant the assertions below require.
    //
    // `pauseAt` has to wait for the hero island to actually be mounted first — calling
    // it right after `waitUntil:'load'` froze the fake clock (and therefore every
    // setTimeout-driven chunk-load scheduling) before the client-only hero island's
    // dynamic import had resolved, so nothing below the app shell ever mounted at all
    // (not a countdown/day mismatch — the hero and everything after it stayed absent
    // for the rest of the test). Waiting for ANY of the hero's three mutually-exclusive
    // states to attach first guarantees hydration has already reached the hero before
    // the clock — and its timers — are frozen.
    await page.clock.install({ time: new Date('2026-12-08T18:14:30Z') });
    await page.goto('/', { waitUntil: 'load' });
    await page
      .locator(
        '[data-testid="countdown-hours"], [data-testid="hero-travel-mode"], [data-testid="hero-post-trip"]',
      )
      .first()
      .waitFor({ state: 'attached', timeout: 15000 });
    await page.clock.pauseAt(new Date('2026-12-08T18:15:00Z'));

    await expect(page.getByTestId('hero-travel-mode')).toHaveCount(0);
    await expect(page.getByTestId('hero-day-number')).toHaveCount(0);
    await expect(page.getByTestId('hero-post-trip')).toHaveCount(0);

    // Reduced motion is pinned above, so the count-up reports the final value immediately
    // (D-056b) — these are exact, not settling.
    await expect(page.getByTestId('countdown-hours')).toHaveText('10');
    await expect(page.getByTestId('countdown-minutes')).toHaveText('45');
  });

  test('15:00Z Jan 9 (10:00 EST on the last day) -> still Day 32, not the post-trip panel', async ({
    page,
  }) => {
    // The mirror case. Tokyo has already rolled to Jan 10, which is outside TRIP_DATES, so
    // deriving membership at the destination offset ended the trip while the traveller was
    // still on it — `getTodayInTrip()` went null and the hero flipped to "Trip complete" on
    // the morning of day 32. The device day is Jan 9, so the trip is still on.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedDefaultIdentity(page);
    await page.clock.install({ time: new Date('2027-01-09T15:00:00Z') });
    await page.goto('/', { waitUntil: 'load' });

    await expect(page.getByTestId('hero-travel-mode')).toBeVisible();
    await expect(page.getByTestId('hero-day-number')).toHaveText('32');
    await expect(page.getByTestId('hero-travel-mode')).toContainText('Tokyo');
    await expect(page.getByTestId('hero-post-trip')).toHaveCount(0);
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
