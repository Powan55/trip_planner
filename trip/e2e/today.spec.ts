import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S98 — Trip OS "Today" screen E2E pack.
 *
 * The Today panel (`components/today-panel.tsx`) is a HOME-page island that renders
 * ONLY when the app clock is inside the trip window (via `getTodayInTrip()`, incl. the
 * D-075 `?today=` override) and surfaces TODAY'S agenda with per-item done-tracking.
 *
 * Covers:
 *   1. In-trip (`?today=2026-12-12`, Day 4 Kathmandu): the panel renders today's agenda.
 *   2. Done-tracking PERSISTS across reload — toggle an item done, reload, it is still
 *      marked done (the D-018-class hard guarantee for the new `done` field).
 *   3. Empty state on an in-trip day with no items.
 *   4. Outside the trip window (`?today=2026-11-15`, pre-trip): the panel is ABSENT.
 *
 * ── SETTLE DISCIPLINE (why this pack navigates the way it does) ──────────────
 * `TodayPanel` is a `next/dynamic(ssr:false)` island. On every navigation/reload the
 * app must: remount the island → resolve the `?today=` override (once per load, cached
 * in a module var) → hydrate the itinerary store from localStorage → render the agenda
 * with each toggle's `aria-pressed` reflecting the persisted `done`. That whole chain is
 * exactly the D-093 dynamic-island/reload settle window (see playwright.config.ts and
 * persistence.spec.ts's harness notes). A plain `waitUntil:'load'` returns before the
 * island has finished that chain, so an assertion fired immediately after can catch a
 * transient pre-hydrate frame (a missing panel, or an `aria-pressed` that hasn't flipped
 * yet). Every navigation here therefore goes through `gotoHomeSettled`/`reloadSettled`
 * (which use `waitUntil:'domcontentloaded'` like persistence.spec.ts's `gotoSettled`) AND
 * `settleTodayPanel`, which blocks until the panel is visible and the store has hydrated
 * before ANY assertion. Assertions are unchanged in strength — the settle only removes
 * the race, it does not weaken what we verify.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';

// An in-trip date (Day 4, Kathmandu / Nepal window) — the clock override we drive.
const IN_TRIP_DAY = '2026-12-12';
// A pre-trip date — outside TRIP_DATES, so getTodayInTrip() is null and the panel is absent.
const PRE_TRIP_DAY = '2026-11-15';

/** Navigate to home with the `?today=` override applied and reduced motion pinned. */
async function gotoHomeWithClock(page: Page, todayParam: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/?today=${todayParam}`, { waitUntil: 'domcontentloaded' });
}

/** Reload and let the network settle (mirrors persistence.spec.ts's reloadSettled). */
async function reloadSettled(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
}

/**
 * Block until the in-trip Today island has fully mounted + the store has hydrated, so no
 * assertion runs against a transient pre-hydrate frame. Waits for the panel to be visible
 * AND for the seeded agenda toggle(s) to have resolved their `aria-pressed` (the store is
 * hydrated once a known item's toggle exists and carries a concrete aria-pressed value).
 */
async function settleTodayPanel(page: Page) {
  await expect(page.getByTestId('today-panel')).toBeVisible();
  // Once a seeded toggle exists and its aria-pressed is a concrete 'true'/'false' (not
  // absent), the island has rendered from hydrated store state — the settle is complete.
  await page.waitForFunction(
    () => {
      const t = document.querySelector('[data-testid="today-done-toggle-t98-1"]');
      const p = t?.getAttribute('aria-pressed');
      return p === 'true' || p === 'false';
    },
    { timeout: 15_000 },
  );
}

/**
 * Seed a small controlled itinerary on IN_TRIP_DAY (bypassing the 32-day sample) so the
 * Today agenda is deterministic. Written once via evaluate; the following reload reads it.
 */
async function seedTodayFixture(page: Page) {
  await page.evaluate(
    ({ key, date }: { key: string; date: string }) => {
      const dayPlan = {
        date,
        city: 'Kathmandu',
        country: 'nepal',
        items: [
          { id: 't98-1', title: 'S98 Boudhanath at dawn', category: 'photography', time: '06:00' },
          { id: 't98-2', title: 'S98 Thamel wander', category: 'sightseeing' },
        ],
      };
      window.localStorage.setItem(key, JSON.stringify([dayPlan]));
    },
    { key: ITINERARY_KEY, date: IN_TRIP_DAY },
  );
}

test.describe('S98 Trip OS — the Today panel (in-trip gating + done-tracking)', () => {
  test('in-trip: the Today panel renders today\'s agenda (Day N — city header + items)', async ({
    page,
  }) => {
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedTodayFixture(page);
    // Reload so the app hydrates from our seeded fixture (the ?today= override persists in
    // sessionStorage across this same-tab reload, so the clock stays in-trip), then settle.
    await reloadSettled(page);
    await settleTodayPanel(page);

    const panel = page.getByTestId('today-panel');
    await expect(panel).toBeVisible();
    // Header consistent with the hero's travel mode: "Day 4 — Kathmandu".
    await expect(panel).toContainText('Day');
    await expect(panel).toContainText('4');
    await expect(panel).toContainText('Kathmandu');

    // Both seeded items appear in the agenda.
    await expect(page.getByTestId('today-done-toggle-t98-1')).toBeVisible();
    await expect(page.getByTestId('today-done-toggle-t98-2')).toBeVisible();
    await expect(page.locator('[data-testid="today-agenda-item"]')).toHaveCount(2);
  });

  test('done-tracking persists across reload (the D-018-class guarantee for `done`)', async ({
    page,
  }) => {
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedTodayFixture(page);
    await reloadSettled(page);
    await settleTodayPanel(page);

    const toggle = page.getByTestId('today-done-toggle-t98-1');
    await expect(toggle).toBeVisible();
    // Starts not-done.
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // Toggle it done.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // It persisted to localStorage as done:true (the store wrote the Vault envelope).
    const doneOnDisk = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Post-S90 the on-disk value is the Vault envelope; payload holds the DayPlan[].
      const days = Array.isArray(parsed) ? parsed : parsed.payload;
      const item = days.flatMap((d: { items: { id: string; done?: boolean }[] }) => d.items).find(
        (i: { id: string }) => i.id === 't98-1',
      );
      return item ? item.done === true : null;
    }, ITINERARY_KEY);
    expect(doneOnDisk).toBe(true);

    // RELOAD — the done state survives (the hard guarantee for the new field). Settle the
    // island + hydration BEFORE asserting, so we never read a transient pre-hydrate frame.
    await reloadSettled(page);
    await settleTodayPanel(page);
    const toggleAfter = page.getByTestId('today-done-toggle-t98-1');
    await expect(toggleAfter).toBeVisible();
    await expect(toggleAfter).toHaveAttribute('aria-pressed', 'true');
    // The other item stayed not-done — the toggle is per-item.
    await expect(page.getByTestId('today-done-toggle-t98-2')).toHaveAttribute('aria-pressed', 'false');
  });

  test('empty state: an in-trip day with no items shows the empty state, not agenda items', async ({
    page,
  }) => {
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    // Seed an EMPTY itinerary ([]) — getDayPlan synthesizes an empty day for IN_TRIP_DAY.
    await page.evaluate((key) => window.localStorage.setItem(key, '[]'), ITINERARY_KEY);
    await reloadSettled(page);

    // The panel is up but the agenda is empty; settle on the panel + empty-state directly
    // (the toggle-based settleTodayPanel doesn't apply — there are no items here).
    await expect(page.getByTestId('today-panel')).toBeVisible();
    await expect(page.getByTestId('today-empty-state')).toBeVisible();
    await expect(page.locator('[data-testid="today-agenda-item"]')).toHaveCount(0);
  });

  test('outside the trip window (pre-trip): the Today panel is ABSENT', async ({ page }) => {
    await gotoHomeWithClock(page, PRE_TRIP_DAY);
    // The countdown hero (not travel mode) is the pre-trip signal; the Today panel is gone.
    // Wait for the countdown grid to prove the home island chain settled before asserting
    // absence (so "absent" means "resolved to null", not "not mounted yet").
    await expect(page.getByTestId('countdown-total-days')).toBeVisible();
    await expect(page.getByTestId('hero-travel-mode')).toHaveCount(0);
    await expect(page.getByTestId('today-panel')).toHaveCount(0);
  });
});
