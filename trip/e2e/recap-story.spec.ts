import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S156 — the POST-TRIP STORY RECAP (`/recap`, `components/trip-story-recap.tsx`) E2E pack.
 *
 * Mirrors `e2e/recap-spend.spec.ts`'s harness: signs in with a real Trip Token EXPLICITLY (its
 * own init-script), drives the clock via `?today=`, seeds the itinerary/journal/expense stores
 * via a ONE-TIME `page.evaluate` after navigation + a single reload (never `addInitScript` for
 * the data, which would re-seed on the very reload meant to prove the story reads PERSISTED
 * data), `domcontentloaded` navigation (never networkidle, D-093), and
 * `emulateMedia({ reducedMotion: 'reduce' })`.
 *
 * A firm island-ready wait (`trip-story-recap` visible) runs before every deeper assertion —
 * the island is `next/dynamic(ssr:false)`, so asserting immediately after `goto` risks the
 * FU-32 island-race flake.
 *
 * Proves, on real rendered output against the served static `out/` build:
 *   1. POST-TRIP (`?today=2027-01-15`, seeded plan + journal + spend): the full chronological
 *      story renders, weaving done/planned, a journal highlight, and a spend figure — and it
 *      survives a reload (reads PERSISTED data, no re-seed).
 *   2. PRE-TRIP and IN-TRIP: the "unlocks after the trip" locked state renders instead — NOT
 *      the full story.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const JOURNAL_KEY = 'nepal_japan_journal';
const EXPENSES_KEY = 'nepal_japan_expenses';

// The first trip day (Kathmandu) — used for the post-trip seeded plan/journal/spend.
const SEED_DAY = '2026-12-09';
// Post-trip clock — after the last trip date (2027-01-09), so the story is fully unlocked.
const POST_TRIP_DAY = '2027-01-15';
// In-trip clock — the story must stay locked here (a direct-URL visit mid-trip).
const IN_TRIP_DAY = '2026-12-20';
// Pre-trip clock — the story must stay locked here too.
const PRE_TRIP_DAY = '2026-12-01';

/** Seed a signed-in Trip Token before any app script runs (token + name, the real sign-in keys). */
async function seedTraveler(page: Page, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('tripPlannerUserName', t);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1'); // S155: keep dormant
    window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss app-wide install toast (duration:Infinity poisons axe scans)
  }, token);
}

/** Navigate to /recap with the `?today=` clock + reduced motion pinned. */
async function gotoRecapWithClock(page: Page, todayParam: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/recap/?today=${todayParam}`, { waitUntil: 'domcontentloaded' });
}

/** Block until the island has mounted (any of the three states) — the FU-32 race guard. */
async function settleStory(page: Page) {
  await expect(page.getByTestId('trip-story-recap')).toBeVisible();
}

/**
 * ONE-TIME seed: a single itinerary day (2 items, 1 done), a journal entry for that day, and a
 * matching expense — all attributed to `SEED_DAY` so the post-trip story has real plan/journal/
 * spend to weave for at least one day. Callers reload once after seeding so the app hydrates
 * from it (the `?today=` override persists in sessionStorage across the same-tab reload).
 */
async function seedStores(page: Page) {
  await page.evaluate(
    ({ itinKey, journalKey, expKey, day }: { itinKey: string; journalKey: string; expKey: string; day: string }) => {
      const plans = [
        {
          date: day,
          city: 'Kathmandu',
          country: 'nepal',
          items: [
            { id: 's156-a', title: 'S156 Boudhanath at dawn', category: 'sightseeing', time: '06:00', done: true },
            { id: 's156-b', title: 'S156 Thamel market walk', category: 'shopping', time: '16:00' },
          ],
        },
      ];
      window.localStorage.setItem(itinKey, JSON.stringify(plans));

      window.localStorage.setItem(
        journalKey,
        JSON.stringify([
          {
            date: day,
            text: 'S156 The prayer flags over the stupa at sunrise were unreal.',
            mood: 'great',
            highlight: 'S156 Sunrise at Boudhanath',
            createdAt: '2026-12-09T07:00:00.000Z',
            updatedAt: '2026-12-09T07:00:00.000Z',
          },
        ]),
      );

      window.localStorage.setItem(
        expKey,
        JSON.stringify([
          { id: 's156-exp-1', leg: 'nepal', category: 'food', amount: 1200, date: day, createdAt: '2026-12-09T10:00:00.000Z' },
        ]),
      );
    },
    { itinKey: ITINERARY_KEY, journalKey: JOURNAL_KEY, expKey: EXPENSES_KEY, day: SEED_DAY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
}

test.describe('S156 post-trip story — the full narrative renders', () => {
  test('post-trip: the seeded day weaves done/planned, journal highlight, and spend; survives a reload', async ({
    page,
  }) => {
    await seedTraveler(page);
    await gotoRecapWithClock(page, POST_TRIP_DAY);
    await seedStores(page);
    await settleStory(page);

    // Not the locked state.
    await expect(page.getByTestId('trip-story-locked')).toHaveCount(0);

    // The trip-level summary opens the story.
    await expect(page.getByTestId('story-trip-summary')).toBeVisible();
    await expect(page.getByTestId('story-trip-summary')).toContainText('1');

    // Every one of the 32 trip days renders, chronological (oldest-first): the FIRST day rendered
    // is the trip's first day, the LAST is the trip's last day.
    const dayCards = page.locator('[data-testid^="story-day-"]');
    await expect(dayCards).toHaveCount(32);
    await expect(dayCards.first()).toHaveAttribute('data-testid', `story-day-${SEED_DAY}`);
    await expect(dayCards.last()).toHaveAttribute('data-testid', 'story-day-2027-01-09');

    // The seeded day: plan-vs-actual (1 of 2 done), the two plan rows, journal highlight/mood/
    // body, and the spend figure — all woven into that one day's section.
    const seededDay = page.getByTestId(`story-day-${SEED_DAY}`);
    await expect(seededDay).toBeVisible();
    await expect(page.getByTestId(`story-plan-summary-${SEED_DAY}`)).toContainText('1');
    await expect(page.getByTestId(`story-plan-summary-${SEED_DAY}`)).toContainText('2');
    await expect(seededDay.locator('[data-testid="story-plan-item"]')).toHaveCount(2);
    await expect(seededDay.locator('[data-testid="story-plan-item"][data-done="true"]')).toHaveCount(1);

    await expect(page.getByTestId(`story-journal-${SEED_DAY}`)).toBeVisible();
    await expect(page.getByTestId(`story-journal-mood-${SEED_DAY}`)).toContainText('Great');
    await expect(page.getByTestId(`story-journal-highlight-${SEED_DAY}`)).toContainText('Sunrise at Boudhanath');
    await expect(page.getByTestId(`story-journal-body-${SEED_DAY}`)).toContainText('prayer flags');

    await expect(page.getByTestId(`story-spend-${SEED_DAY}`)).toBeVisible();
    await expect(page.getByTestId(`story-spend-${SEED_DAY}`)).toContainText('1,200');

    // A day with no seeded plan shows the free-day line, not a fabricated plan.
    await expect(page.getByTestId('story-no-plan-2026-12-10')).toBeVisible();

    // Survives a reload — reads PERSISTED data (the seed was a one-time evaluate, not an init script).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settleStory(page);
    await expect(page.getByTestId(`story-spend-${SEED_DAY}`)).toContainText('1,200');
  });
});

test.describe('S156 post-trip story — pre/in-trip stays locked', () => {
  test('in-trip: a direct-URL visit shows the "unlocks after the trip" state, not a half-built story', async ({
    page,
  }) => {
    await seedTraveler(page);
    await gotoRecapWithClock(page, IN_TRIP_DAY);
    await settleStory(page);

    await expect(page.getByTestId('trip-story-locked')).toBeVisible();
    await expect(page.locator('[data-testid^="story-day-"]')).toHaveCount(0);
    await expect(page.getByTestId('story-trip-summary')).toHaveCount(0);
  });

  test('pre-trip: also shows the locked state', async ({ page }) => {
    await seedTraveler(page);
    await gotoRecapWithClock(page, PRE_TRIP_DAY);
    await settleStory(page);

    await expect(page.getByTestId('trip-story-locked')).toBeVisible();
    await expect(page.locator('[data-testid^="story-day-"]')).toHaveCount(0);
  });
});
