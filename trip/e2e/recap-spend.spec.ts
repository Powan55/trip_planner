import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S153 — the day-recap PER-DAY SPEND LINE (`components/trip-recap.tsx`, `recap-spend-<date>`)
 * E2E pack. Uses the SAME `?today=` fake-clock + seed-then-reload harness as `e2e/recap.spec.ts`
 * (S105, post-S167 `domcontentloaded` discipline — never networkidle), but signs in with a real
 * Trip Token EXPLICITLY (its own init-script, seeding the same keys fixtures.ts's post-S113E
 * signed-in default seeds), deliberately (S153).
 *
 * Data is seeded via a ONE-TIME `page.evaluate` after navigation + a single reload (recap.spec.ts's
 * `seedItinerary` pattern) — NOT `addInitScript`, which re-runs on every navigation and would
 * re-seed on the very reload meant to prove the spend line reads PERSISTED data.
 *
 * Proves, on real rendered output against the served static `out/` build:
 *   1. A day WITH seeded expenses shows `recap-spend-<date>` with the correct leg-local total,
 *      and it survives a reload (no re-seed).
 *   2. A day with NO logged expense shows no spend line at all (no zero-state).
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const EXPENSES_KEY = 'nepal_japan_expenses';

// In-trip Day 12 = 2026-12-20 (Osaka / Japan leg, S112 reroute) — matches recap.spec.ts's own
// IN_TRIP_DAY so the elapsed-day math is already proven there; this pack only adds the spend read.
const IN_TRIP_DAY = '2026-12-20';

/** Seed a signed-in Trip Token before any app script runs (token + name, the real sign-in keys). */
async function seedTraveler(page: Page, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('tripPlannerUserName', t);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1'); // S155: keep dormant
    window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss app-wide install toast (duration:Infinity poisons axe scans)
  }, token);
}

/** Navigate home with the `?today=` clock + reduced motion pinned (recap.spec.ts's idiom). */
async function gotoHomeWithClock(page: Page, todayParam: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/?today=${todayParam}`, { waitUntil: 'domcontentloaded' });
}

/**
 * ONE-TIME seed (post-navigation `page.evaluate`): an empty itinerary (deterministic zero-item
 * plans) and, optionally, two Day-12 Japan-leg expenses totalling ¥8,500. Callers reload once
 * after seeding so the app hydrates from it (the `?today=` override persists in sessionStorage
 * across the same-tab reload — the same mechanism recap.spec.ts relies on).
 */
async function seedStores(page: Page, { withExpenses }: { withExpenses: boolean }) {
  await page.evaluate(
    ({ itinKey, expKey, day, withExpenses }: { itinKey: string; expKey: string; day: string; withExpenses: boolean }) => {
      window.localStorage.setItem(itinKey, '[]');
      if (withExpenses) {
        window.localStorage.setItem(
          expKey,
          JSON.stringify([
            { id: 's153-exp-1', leg: 'japan', category: 'food', amount: 3500, date: day, createdAt: '2026-12-20T10:00:00.000Z' },
            { id: 's153-exp-2', leg: 'japan', category: 'transportation', amount: 5000, date: day, createdAt: '2026-12-20T11:00:00.000Z' },
          ]),
        );
      }
    },
    { itinKey: ITINERARY_KEY, expKey: EXPENSES_KEY, day: IN_TRIP_DAY, withExpenses },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
}

test.describe('S153 recap spend line — a day with logged expenses', () => {
  test('Day 12 (Osaka, Japan leg) shows the summed spend in JPY, and it survives a reload', async ({ page }) => {
    await seedTraveler(page);
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedStores(page, { withExpenses: true });

    await expect(page.getByTestId('trip-recap')).toBeVisible();
    const day12 = page.getByTestId(`recap-card-${IN_TRIP_DAY}`);
    await expect(day12).toBeVisible();

    const spend = page.getByTestId(`recap-spend-${IN_TRIP_DAY}`);
    await expect(spend).toBeVisible();
    // ¥3,500 + ¥5,000 = ¥8,500, formatted via the same `formatMoney` the budget panel uses.
    await expect(spend).toContainText('8,500');

    // Survives a reload — the recap reads the PERSISTED expense store (no re-seed happens here:
    // the seed was a one-time evaluate, not an init script).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('trip-recap')).toBeVisible();
    await expect(page.getByTestId(`recap-spend-${IN_TRIP_DAY}`)).toContainText('8,500');
  });
});

test.describe('S153 recap spend line — a day with no logged expenses', () => {
  test('a day with zero spend shows no spend line at all', async ({ page }) => {
    await seedTraveler(page);
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    // Empty itinerary, NO expenses — the expense store stays empty.
    await seedStores(page, { withExpenses: false });

    await expect(page.getByTestId('trip-recap')).toBeVisible();
    const day12 = page.getByTestId(`recap-card-${IN_TRIP_DAY}`);
    await expect(day12).toBeVisible();
    await expect(page.getByTestId(`recap-spend-${IN_TRIP_DAY}`)).toHaveCount(0);
  });
});
