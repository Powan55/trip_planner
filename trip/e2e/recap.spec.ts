import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S105 — the read-only plan-vs-actual DAY RECAP E2E pack.
 *
 * The recap island (`components/trip-recap.tsx`) is a HOME-page island mounted right after the Today
 * panel. For each trip day that has already HAPPENED (via `elapsedTripDates(getNow())`, incl. the
 * D-075 `?today=` override) it pairs, READ-ONLY: the PLAN (that day's `getDayPlan(date).items`), the
 * ACTUAL (each item's `done` tick + "{done} of {planned} done", S98), and the REFLECTION (that day's
 * `getEntry(date)`, S104). It renders `null` PRE-trip and mutates nothing. These specs prove the
 * centrepiece pairing on a real run:
 *
 *   1. IN-TRIP (`?today=2026-12-20`, Day 12 Osaka — S112 reroute): the recap renders elapsed-day cards including the
 *      current Day-12 card (city correct) with a "{done} of {planned} done" line reflecting the seeded
 *      done-state, most-recent-first.
 *   2. PLAN-VS-ACTUAL PAIRING END-TO-END: write TODAY'S journal in the Today panel (reusing the S104
 *      journal testids), then assert the SAME day's recap card shows that mood/highlight/text.
 *   3. POST-TRIP (`?today=2027-01-10`): all 32 day cards render. PRE-TRIP (`?today=2026-12-01`): NO
 *      recap island (Home byte-unchanged).
 *
 * ── SETTLE DISCIPLINE (mirrors today.spec.ts / journal.spec.ts) ─────────────────────────────────
 * `TripRecap` is a `next/dynamic(ssr:false)` island. On every navigation/reload the app remounts it →
 * resolves the `?today=` override → hydrates BOTH the itinerary and journal stores → renders. Every
 * navigation goes through `gotoHomeWithClock`/`reloadSettled` (`waitUntil:'domcontentloaded'`) AND a settle
 * that blocks until the recap section is visible before any assertion, so nothing fires against a
 * transient pre-hydrate frame. Assertions are unchanged in strength — the settle only removes the race.
 * Local `retries:0`, so selectors are deterministic (seeded fixtures, stable testids).
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const JOURNAL_KEY = 'nepal_japan_journal';

// In-trip Day 12 = 2026-12-20 (Dec 9 = Day 1), Osaka (Japan window — S112 reroute). The clock override we drive.
const IN_TRIP_DAY = '2026-12-20';
// Post-trip clock — after the last trip date (2027-01-09), so all 32 days have elapsed.
const POST_TRIP_DAY = '2027-01-10';
// Pre-trip clock — before the first trip date (2026-12-09), so the recap renders nothing.
const PRE_TRIP_DAY = '2026-12-01';

/** Navigate to home with the `?today=` override applied and reduced motion pinned. */
async function gotoHomeWithClock(page: Page, todayParam: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/?today=${todayParam}`, { waitUntil: 'domcontentloaded' });
}

/** Reload and let the network settle (mirrors today.spec.ts's reloadSettled). */
async function reloadSettled(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
}

/** Block until the recap island has mounted from hydrated state (the section is visible). */
async function settleRecap(page: Page) {
  await expect(page.getByTestId('trip-recap')).toBeVisible();
}

/**
 * Seed a controlled itinerary so the elapsed days have deterministic plan + done state. The Day-12
 * plan (2026-12-20) has three items: two done, one not-done → "2 of 3 done".
 */
async function seedItinerary(page: Page) {
  await page.evaluate(
    ({ key, day }: { key: string; day: string }) => {
      const plans = [
        {
          date: day,
          city: 'Osaka',
          country: 'japan',
          items: [
            { id: 's105-a', title: 'S105 Senso-ji at opening', category: 'sightseeing', time: '08:00', done: true },
            { id: 's105-b', title: 'S105 Tsukiji breakfast', category: 'food', time: '10:00', done: true },
            { id: 's105-c', title: 'S105 Shibuya crossing', category: 'photography', time: '18:00' },
          ],
        },
      ];
      window.localStorage.setItem(key, JSON.stringify(plans));
    },
    { key: ITINERARY_KEY, day: IN_TRIP_DAY },
  );
}

/** Seed an EMPTY itinerary ([]) so every elapsed day synthesizes a zero-item plan (deterministic). */
async function seedEmptyItinerary(page: Page) {
  await page.evaluate((key) => window.localStorage.setItem(key, '[]'), ITINERARY_KEY);
}

test.describe('S105 day recap — plan-vs-actual, in-trip', () => {
  test('in-trip Day 12: the recap renders elapsed cards incl. Day 12 (Osaka) with the seeded done-count', async ({
    page,
  }) => {
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedItinerary(page);
    // Reload so the app hydrates from our seeded fixture (the ?today= override persists in
    // sessionStorage across this same-tab reload, so the clock stays in-trip), then settle.
    await reloadSettled(page);
    await settleRecap(page);

    // 12 day cards have elapsed (Dec 9 – Dec 20 inclusive), most-recent-first.
    await expect(page.locator('[data-testid^="recap-card-"]')).toHaveCount(12);

    // The current day's card exists, shows the real day-trip city (Osaka — S112 reroute) and Day 12.
    const day12 = page.getByTestId(`recap-card-${IN_TRIP_DAY}`);
    await expect(day12).toBeVisible();
    await expect(day12).toContainText('Day');
    await expect(day12).toContainText('12');
    await expect(day12).toContainText('Osaka');

    // Plan-vs-actual: the seeded plan had 3 items, 2 done → "2 of 3 done".
    await expect(page.getByTestId(`recap-done-count-${IN_TRIP_DAY}`)).toContainText('2');
    await expect(page.getByTestId(`recap-done-count-${IN_TRIP_DAY}`)).toContainText('3');
    // The three plan rows render; their read-only done state matches the seed (2 done, 1 not).
    await expect(day12.locator('[data-testid="recap-plan-item"]')).toHaveCount(3);
    await expect(day12.locator('[data-testid="recap-plan-item"][data-done="true"]')).toHaveCount(2);
    await expect(day12.locator('[data-testid="recap-plan-item"][data-done="false"]')).toHaveCount(1);

    // Most-recent-first: the FIRST rendered card is the current day (Day 12), the LAST is Day 1.
    const cards = page.locator('[data-testid^="recap-card-"]');
    await expect(cards.first()).toHaveAttribute('data-testid', `recap-card-${IN_TRIP_DAY}`);
    await expect(cards.last()).toHaveAttribute('data-testid', 'recap-card-2026-12-09');
  });

  test('plan-vs-actual pairing END-TO-END: writing today\'s journal shows it in that day\'s recap card', async ({
    page,
  }) => {
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedItinerary(page);
    await reloadSettled(page);
    await settleRecap(page);

    // The Today panel (same Home page) is the journal-capture hub for the current day. Write an entry.
    await expect(page.getByTestId('today-panel')).toBeVisible();
    await expect(page.getByTestId('journal-card')).toBeVisible();

    // No reflection yet in the recap card for today — it shows the "no journal entry" hint.
    await expect(page.getByTestId(`recap-no-journal-${IN_TRIP_DAY}`)).toBeVisible();
    await expect(page.getByTestId(`recap-journal-${IN_TRIP_DAY}`)).toHaveCount(0);

    // Write text + mood + highlight in the Today panel's journal card (reuse the S104 testids).
    await page.getByTestId('journal-write-prompt').click();
    await expect(page.getByTestId('journal-editor')).toBeVisible();
    await page.getByTestId('journal-mood-great').click();
    await page.getByTestId('journal-highlight-input').fill('Neon rain over Shibuya');
    await page.getByTestId('journal-text-input').fill('Best ramen of the trip, then the crossing at night.');
    await page.getByTestId('journal-save').click();

    // The Today panel's own read view confirms the save.
    await expect(page.getByTestId('journal-read')).toBeVisible();

    // THE PAIRING: the SAME day's recap card now shows that mood/highlight/body, live (the journal
    // hook dispatches `journal:changed`, which the recap's useJournal re-reads on) — no reload needed.
    await expect(page.getByTestId(`recap-journal-${IN_TRIP_DAY}`)).toBeVisible();
    await expect(page.getByTestId(`recap-no-journal-${IN_TRIP_DAY}`)).toHaveCount(0);
    await expect(page.getByTestId(`recap-journal-mood-${IN_TRIP_DAY}`)).toContainText('Great');
    await expect(page.getByTestId(`recap-journal-highlight-${IN_TRIP_DAY}`)).toContainText('Neon rain over Shibuya');
    await expect(page.getByTestId(`recap-journal-body-${IN_TRIP_DAY}`)).toContainText('Best ramen of the trip');

    // And it survives a reload (the D-018 hard guarantee — the recap reads the persisted entry).
    await reloadSettled(page);
    await settleRecap(page);
    await expect(page.getByTestId(`recap-journal-body-${IN_TRIP_DAY}`)).toContainText('Best ramen of the trip');
  });
});

test.describe('S105 day recap — post-trip / pre-trip gating', () => {
  test('post-trip: all 32 day cards render', async ({ page }) => {
    await gotoHomeWithClock(page, POST_TRIP_DAY);
    await seedEmptyItinerary(page);
    await reloadSettled(page);
    await settleRecap(page);

    // Every trip day has elapsed → 32 recap cards. Newest-first: first is the last trip day, last is Day 1.
    await expect(page.locator('[data-testid^="recap-card-"]')).toHaveCount(32);
    const cards = page.locator('[data-testid^="recap-card-"]');
    await expect(cards.first()).toHaveAttribute('data-testid', 'recap-card-2027-01-09');
    await expect(cards.last()).toHaveAttribute('data-testid', 'recap-card-2026-12-09');
    // With an empty itinerary, each day shows the "no plans" line rather than a plan list.
    await expect(page.getByTestId('recap-no-plan-2027-01-09')).toBeVisible();
  });

  test('pre-trip: the recap island is ABSENT (Home byte-unchanged)', async ({ page }) => {
    await gotoHomeWithClock(page, PRE_TRIP_DAY);
    // The countdown hero is the pre-trip signal; wait for it so "absent" means "resolved to null",
    // not "not mounted yet".
    await expect(page.getByTestId('countdown-total-days')).toBeVisible();
    // The Today panel is also absent pre-trip; the recap island is likewise gone.
    await expect(page.getByTestId('today-panel')).toHaveCount(0);
    await expect(page.getByTestId('trip-recap')).toHaveCount(0);
  });
});
