import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * D-316 (issue #18) — the overlap guard, proved through the REAL UI rather than through the
 * predicate. `lib/__tests__/sort-items-by-time.test.ts` proves `firstClashWith` /
 * `timeFootprintChanged`; nothing there proves that `ItemEditor` actually CALLS them, so
 * deleting the guard from `components/calendar-planner.tsx` would leave that suite green.
 * This spec fails if the call site goes away.
 *
 * Harness conventions are lifted wholesale from the sibling `sort-clash.spec.ts` (same
 * signed-in fixture, `domcontentloaded` + `waitForPlannerReady`, never `networkidle` per
 * D-093, and the same `seedFixtureDay` that writes `startMinutes`/`durationMinutes` straight
 * into localStorage).
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';

// The same reserved fixture day sort-clash.spec.ts uses — a real trip date inside
// NEPAL_START..NEPAL_END, so the day resolves to one country/offset deterministically.
const FIXTURE_DAY = '2026-12-15';

async function waitForPlannerReady(page: Page) {
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'visible' });
}

type FixtureItem = { id: string; title: string; startMinutes?: number; durationMinutes?: number };

/** Seed a small, fully-controlled itinerary on FIXTURE_DAY (bypassing the 32-day sample). */
async function seedFixtureDay(page: Page, items: FixtureItem[]) {
  await page.evaluate(
    ({ key, date, items }: { key: string; date: string; items: FixtureItem[] }) => {
      const dayPlan = {
        date,
        city: 'Kathmandu',
        country: 'nepal',
        items: items.map((i) => ({
          id: i.id,
          title: i.title,
          category: 'sightseeing',
          startMinutes: i.startMinutes,
          durationMinutes: i.durationMinutes,
        })),
      };
      window.localStorage.setItem(key, JSON.stringify([dayPlan]));
    },
    { key: ITINERARY_KEY, date: FIXTURE_DAY, items },
  );
}

/** The stored row for `id` on FIXTURE_DAY, read straight out of localStorage. */
async function storedItem(page: Page, id: string) {
  return page.evaluate(
    ({ key, date, id }: { key: string; date: string; id: string }) => {
      const raw = JSON.parse(window.localStorage.getItem(key) || '[]');
      // The seed writes the bare-array (pre-envelope) form; the app rewrites it wrapped.
      const days = Array.isArray(raw) ? raw : raw.payload;
      const day = days.find((d: { date: string }) => d.date === date);
      return (day?.items ?? []).find((i: { id: string }) => i.id === id) ?? null;
    },
    { key: ITINERARY_KEY, date: FIXTURE_DAY, id },
  );
}

/** Seed the pair, land on FIXTURE_DAY, and open the editor on the second item. */
async function openEditorOnFree(page: Page) {
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
  await seedFixtureDay(page, [
    // 9:00–10:00 — the occupant.
    { id: 'd316-taken', title: 'D316 Taken 9am', startMinutes: 540, durationMinutes: 60 },
    // Untimed, no duration — cannot clash until the user gives it a footprint.
    { id: 'd316-free', title: 'D316 Free Item' },
  ]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
  await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();

  await page.getByTestId('calendar-item-edit-d316-free').click();
  await expect(page.getByTestId('calendar-editor')).toBeVisible();
}

/** Set the editor's time via the picker (12-hour columns) and its duration in minutes. */
async function setEditorTime(page: Page, hour: number, minute: number, period: 'AM' | 'PM', durationMin: number) {
  await page.getByTestId('calendar-editor-time-input').click();
  await expect(page.getByTestId('time-picker-panel')).toBeVisible();
  await page.getByTestId(`time-picker-hour-${hour}`).click();
  await page.getByTestId(`time-picker-minute-${minute}`).click();
  await page.getByTestId(`time-picker-period-${period}`).click();
  await page.getByTestId('time-picker-done').click();
  await expect(page.getByTestId('time-picker-panel')).toHaveCount(0);

  // S357A: Duration lives behind the editor's "More details" disclosure.
  await page.getByTestId('calendar-editor-more-toggle').click();
  await page.getByTestId('calendar-editor-duration-input').fill(String(durationMin));
}

test.describe('D-316 — the ItemEditor refuses a save that would create a new overlap', () => {
  test('9:30+60min onto a 9:00–10:00 day is refused: the alert speaks, the editor stays, nothing lands', async ({
    page,
  }) => {
    await openEditorOnFree(page);
    await setEditorTime(page, 9, 30, 'AM', 60); // 9:30–10:30, straddling the 9:00–10:00 occupant

    await page.getByTestId('calendar-editor-save').click();

    // 1. The refusal is announced, and it names the blocking item (describeClash).
    const alert = page.getByTestId('calendar-editor-clash-error');
    await expect(alert).toContainText('Overlaps');
    await expect(alert).toContainText('D316 Taken 9am');
    await expect(alert).toContainText('9:00 AM–10:00 AM');
    // …and it names the escape hatch, which is the only way out (there is no "Save anyway").
    await expect(alert).toContainText('clear the duration');

    // 2. The editor did NOT close — the user keeps everything they typed.
    await expect(page.getByTestId('calendar-editor')).toBeVisible();

    // 3. The write never happened: the stored row is still untimed and duration-less.
    const stored = await storedItem(page, 'd316-free');
    expect(stored).not.toBeNull();
    expect(stored.startMinutes).toBeUndefined();
    expect(stored.durationMinutes).toBeUndefined();
    expect(stored.time).toBeUndefined();
  });

  test('non-vacuous: the SAME save at 10:00 (touching, half-open) is allowed and lands', async ({ page }) => {
    // Without this the test above would pass just as well against an editor whose save button
    // was simply broken. 10:00–11:00 touches the 9:00–10:00 occupant and must not clash.
    await openEditorOnFree(page);
    await setEditorTime(page, 10, 0, 'AM', 60);

    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);
    await expect(page.getByTestId('calendar-item-d316-free')).toContainText('10:00 AM');

    const stored = await storedItem(page, 'd316-free');
    expect(stored.startMinutes).toBe(600);
    expect(stored.durationMinutes).toBe(60);
  });
});
