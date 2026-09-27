import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S126 — warn-only clash badges (D-142) + the D-018 stored-order guarantee, E2E pack.
 * Mirrors time-picker.spec.ts / persistence.spec.ts's harness conventions exactly: same
 * signed-in fixture, `domcontentloaded` + `waitForPlannerReady`, never `networkidle`
 * (D-093). Presentation-only, zero store writes — the zero-writes-proof test is the
 * D-018 guarantee for this slice.
 *
 * 🔴 THE CALENDAR IS CHRONOLOGICAL NOW (owner-instructed). The first describe below used to
 * assert the opposite — that a day seeded out of order stayed in STORED order — because the day
 * list rendered the manual drag order. A day holding a 3pm plan before a 10am one then printed
 * "Afternoon" and filed the morning plan under it, so the ordering rule changed and these
 * assertions were inverted with it. The zero-writes proof at the bottom of this file is
 * UNCHANGED and still the D-018 guarantee: the sort is view-level, so stored order is untouched.
 *
 * 🔴 (#94) THE PURE-FUNCTION SORT NET LIVES IN `lib/__tests__/sort-items-by-time.test.ts` NOW.
 * Every test here used to have a second half that drove `#timeline` on /plan; #94 deleted that
 * section (it was an unsynced duplicate of the itinerary), so those halves are gone and each
 * test is retitled to name the surface it still proves — the calendar. The view-level
 * `sortItemsByTime` projection and the S377 Jan-9 date-line case (the DTW layover sorting after
 * the HND→DTW flight that produces it) are covered against the REAL seed content by
 * `lib/__tests__/sort-items-by-time.test.ts` :91 and :106 — that is where a date-line
 * regression is caught, not here.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';

// A real trip date inside NEPAL_START..NEPAL_END, reserved for this spec's small
// controlled fixtures (mirrors persistence.spec.ts's FIXTURE_DAY pattern).
const FIXTURE_DAY = '2026-12-15';

async function waitForPlannerReady(page: Page) {
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'visible' });
}

async function gotoSettled(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
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

test.describe('the calendar day list is CHRONOLOGICAL (owner-instructed)', () => {
  test('a day seeded OUT of chronological order renders sorted by time', async ({ page }) => {
    // Stored order: late (3pm), early (8am), mid (12pm) — deliberately NOT chronological.
    await gotoSettled(page, '/plan/');
    await seedFixtureDay(page, [
      { id: 's126-late', title: 'S126 Late Item', startMinutes: 900 }, // 3:00 PM
      { id: 's126-early', title: 'S126 Early Item', startMinutes: 480 }, // 8:00 AM
      { id: 's126-mid', title: 'S126 Mid Item', startMinutes: 720 }, // 12:00 PM
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();

    const calendarIds = await page.locator('[data-testid^="calendar-item-s126-"]').evaluateAll(
      (els) => els.map((el) => el.getAttribute('data-testid')),
    );
    expect(calendarIds).toEqual([
      'calendar-item-s126-early',
      'calendar-item-s126-mid',
      'calendar-item-s126-late',
    ]);
  });

  test('the Morning header precedes the Afternoon header, and each plan sits under its own', async ({ page }) => {
    // THE REPORTED DEFECT, end to end. A 10am plan stored after a 3pm one used to render with
    // "Afternoon" as the day's first (and only) header and the morning plan beneath it. This
    // walks the rendered day in DOM order and asserts headers and rows interleave correctly.
    await gotoSettled(page, '/plan/');
    await seedFixtureDay(page, [
      { id: 's126-pm', title: 'S126 Three PM', startMinutes: 900 }, // 3:00 PM
      { id: 's126-am', title: 'S126 Ten AM', startMinutes: 600 }, // 10:00 AM
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s126-am')).toBeVisible();

    const sequence = await page
      .locator('[data-testid^="calendar-phase-header-"], [data-testid^="calendar-item-s126-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
    expect(sequence).toEqual([
      'calendar-phase-header-morning-s126-am',
      'calendar-item-s126-am',
      'calendar-phase-header-afternoon-s126-pm',
      'calendar-item-s126-pm',
    ]);
  });

  test('an untimed plan trails the timed ones under an Anytime header', async ({ page }) => {
    await gotoSettled(page, '/plan/');
    await seedFixtureDay(page, [
      { id: 's126-idea', title: 'S126 Untimed Idea' }, // no time — an idea, not a commitment
      { id: 's126-nine', title: 'S126 Nine AM', startMinutes: 540 },
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();

    const ids = await page.locator('[data-testid^="calendar-item-s126-"]').evaluateAll(
      (els) => els.map((el) => el.getAttribute('data-testid')),
    );
    expect(ids).toEqual(['calendar-item-s126-nine', 'calendar-item-s126-idea']);
    await expect(page.getByTestId('calendar-phase-header-anytime-s126-idea')).toBeVisible();
  });
});

test.describe('drag follows from the chronological order', () => {
  test('a TIMED row has no reorder grip; an UNTIMED one still does', async ({ page }) => {
    // A timed row's position is decided by its time, so offering a grip that snapped back would
    // be worse than offering none. The untimed run keeps its grip, because reordering it has a
    // real and lasting effect.
    await gotoSettled(page, '/plan/');
    await seedFixtureDay(page, [
      { id: 's126-timed', title: 'S126 Timed Row', startMinutes: 540 },
      { id: 's126-open', title: 'S126 Open Row' },
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();

    await expect(page.getByTestId('calendar-item-s126-timed')).toHaveAttribute('data-drag-disabled', 'true');
    await expect(page.getByRole('button', { name: 'Reorder S126 Timed Row' })).toHaveCount(0);
    await expect(page.getByTestId('calendar-item-grip-locked-s126-timed')).toBeVisible();

    await expect(page.getByTestId('calendar-item-s126-open')).not.toHaveAttribute('data-drag-disabled', 'true');
    await expect(page.getByRole('button', { name: 'Reorder S126 Open Row' })).toBeVisible();
  });
});

test.describe('S126 — warn-only clash badges (half-open, D-142)', () => {
  test('two overlapping timed items both show the clash badge in the calendar', async ({ page }) => {
    // 9:00-10:00 and 9:30-10:30 — genuinely overlapping.
    await gotoSettled(page, '/plan/');
    await seedFixtureDay(page, [
      { id: 's126-clash-a', title: 'S126 Clash A', startMinutes: 540, durationMinutes: 60 },
      { id: 's126-clash-b', title: 'S126 Clash B', startMinutes: 570, durationMinutes: 60 },
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();

    await expect(page.getByTestId('calendar-item-clash-s126-clash-a')).toBeVisible();
    await expect(page.getByTestId('calendar-item-clash-s126-clash-b')).toBeVisible();
  });

  test('a touching pair (09:00+60min and 10:00+30min) shows NO clash badge in the calendar — half-open', async ({ page }) => {
    await gotoSettled(page, '/plan/');
    await seedFixtureDay(page, [
      { id: 's126-touch-a', title: 'S126 Touch A', startMinutes: 540, durationMinutes: 60 }, // 9-10
      { id: 's126-touch-b', title: 'S126 Touch B', startMinutes: 600, durationMinutes: 30 }, // 10-10:30
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();

    // Both rows ARE present — proving this is a real "no badge despite items existing"
    // check, not a vacuous pass from the day never being selected.
    await expect(page.getByTestId('calendar-item-s126-touch-a')).toBeVisible();
    await expect(page.getByTestId('calendar-item-s126-touch-b')).toBeVisible();
    await expect(page.getByTestId('calendar-item-clash-s126-touch-a')).toHaveCount(0);
    await expect(page.getByTestId('calendar-item-clash-s126-touch-b')).toHaveCount(0);
  });
});

test.describe('S126 — zero-writes proof (D-018/D-142)', () => {
  test('viewing the calendar day does not change stored item order or content', async ({ page }) => {
    await gotoSettled(page, '/plan/');
    await seedFixtureDay(page, [
      { id: 's126-zw-late', title: 'S126 ZW Late', startMinutes: 900 },
      { id: 's126-zw-early', title: 'S126 ZW Early', startMinutes: 480 },
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });

    const before = await page.evaluate((key) => window.localStorage.getItem(key), ITINERARY_KEY);

    // View the calendar day (already selected via seed + reload isn't guaranteed — click
    // it explicitly). BOTH rows are asserted visible so this is a real "the day was actually
    // rendered" run, not a vacuous pass from the day never being opened.
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s126-zw-late')).toBeVisible();
    await expect(page.getByTestId('calendar-item-s126-zw-early')).toBeVisible();

    const after = await page.evaluate((key) => window.localStorage.getItem(key), ITINERARY_KEY);
    // Byte-identical — rendering the day never wrote back to storage, and the stored
    // (manual) order is untouched by the read.
    expect(after).toBe(before);

    const parsed = JSON.parse(after as string);
    const dayPlan = parsed.find((p: { date: string }) => p.date === FIXTURE_DAY);
    // STILL late-then-early on disk, while the screen shows early-then-late: the chronological
    // order is a render-time projection, and the persisted order is the persisted truth (D-018).
    expect(dayPlan.items.map((i: { id: string }) => i.id)).toEqual(['s126-zw-late', 's126-zw-early']);
  });
});
