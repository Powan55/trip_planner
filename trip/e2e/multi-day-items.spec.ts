import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S148 — Multi-day items (dormant `out/` build).
 *
 * Proves, on a real run:
 *   1. The editor's "spans multiple days" control sets an `endDate`; a span band then renders
 *      on EVERY covered day. On the start day the item ALSO appears as its editable row; on the
 *      covered NON-start days ONLY the band shows — the item is never re-inserted into a list.
 *   2. Reload persists the span AND — the MERGE INVARIANT — the item still lives in EXACTLY ONE
 *      DayPlan.items[] (its start day) in the stored bytes; it was never multi-homed.
 *   3. A spanning item is EXCLUDED from clash warnings (no "Overlap" badge), while two ordinary
 *      overlapping timed items on the same day still clash — clash-exclusion is non-vacuous.
 *   4. No console errors; axe on `/plan` is serious/critical-clean.
 *
 * Identity: default fixture (`./fixtures`) seeds a signed-in traveler so `/plan` is reachable
 * (dormant build, no `.env.local`). Seed + settle discipline mirrors search-plan.spec.ts (S147):
 * navigate `domcontentloaded`, block on the lazy planner island's `calendar-day-*` grid.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const DAY_A = '2026-12-09'; // TRIP_DATES[0] — the default-selected day (span start)
const DAY_B = '2026-12-10'; // covered, non-start
const DAY_C = '2026-12-11'; // covered, non-start (the chosen inclusive end)
const DAY_D = '2026-12-12'; // OUTSIDE the span — band must NOT appear here

const TREK = { id: 's148-trek', title: 'Everest Base Camp trek', category: 'nature' };

const DESKTOP = { width: 1280, height: 900 } as const;

async function waitForPlannerReady(page: Page) {
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });
}

async function seedPlan(page: Page, plans: unknown) {
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
  await page.evaluate(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: ITINERARY_KEY, value: plans },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}

async function gotoDay(page: Page, date: string) {
  await page.getByTestId(`calendar-day-${date}`).click();
  await expect(page.getByTestId(`calendar-day-${date}`)).toHaveAttribute('aria-pressed', 'true');
}

test.describe('S148 · multi-day items', () => {
  test('editor sets a span → band renders on every covered day; non-start days show ONLY the band', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await seedPlan(page, [{ date: DAY_A, city: 'Kathmandu', country: 'nepal', items: [TREK] }]);

    // Open the editor on the trek (which lives on the default-selected DAY_A).
    await page.getByTestId(`calendar-item-edit-${TREK.id}`).click();
    await expect(page.getByTestId('calendar-editor')).toBeVisible();

    // Enable the span, pick DAY_C as the inclusive last day, save.
    // S357A: the multi-day span control now sits behind the editor's "More details"
    // disclosure (only Title/Category/Time are open on load). Same toggle, one step deeper.
    await page.getByTestId('calendar-editor-more-toggle').click();
    await page.getByTestId('calendar-editor-span-toggle').click();
    await page.getByTestId('calendar-editor-span-select').selectOption(DAY_C);
    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);

    // Start day (DAY_A): band shows AND the editable row still shows.
    await expect(page.getByTestId(`calendar-span-band-${TREK.id}`)).toBeVisible();
    await expect(page.getByTestId(`calendar-item-${TREK.id}`)).toBeVisible();

    // Covered non-start days (DAY_B, DAY_C): ONLY the band — the item is NOT in the list.
    for (const day of [DAY_B, DAY_C]) {
      await gotoDay(page, day);
      await expect(page.getByTestId(`calendar-span-band-${TREK.id}`)).toBeVisible();
      await expect(page.getByTestId(`calendar-item-${TREK.id}`)).toHaveCount(0);
    }

    // Just past the span (DAY_D): no band at all.
    await gotoDay(page, DAY_D);
    await expect(page.getByTestId(`calendar-span-band-${TREK.id}`)).toHaveCount(0);
  });

  test('reload persists the span AND the item stays homed on exactly ONE day (merge invariant)', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await seedPlan(page, [{ date: DAY_A, city: 'Kathmandu', country: 'nepal', items: [TREK] }]);

    await page.getByTestId(`calendar-item-edit-${TREK.id}`).click();
    // S357A: the multi-day span control now sits behind the editor's "More details"
    // disclosure (only Title/Category/Time are open on load). Same toggle, one step deeper.
    await page.getByTestId('calendar-editor-more-toggle').click();
    await page.getByTestId('calendar-editor-span-toggle').click();
    await page.getByTestId('calendar-editor-span-select').selectOption(DAY_C);
    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);

    // Band survives the reload (default day is DAY_A again).
    await expect(page.getByTestId(`calendar-span-band-${TREK.id}`)).toBeVisible();

    // THE MERGE INVARIANT — inspect the stored bytes directly: the item exists in EXACTLY ONE
    // DayPlan.items[] (DAY_A), carrying endDate=DAY_C. It was NEVER copied onto DAY_B/DAY_C.
    const homes = await page.evaluate(
      ({ key, id }) => {
        const plans = JSON.parse(window.localStorage.getItem(key) || '[]');
        const days = Array.isArray(plans) ? plans : plans.payload;
        const found: { date: string; endDate?: string }[] = [];
        for (const d of days) {
          for (const it of d.items ?? []) {
            if (it.id === id) found.push({ date: d.date, endDate: it.endDate });
          }
        }
        return found;
      },
      { key: ITINERARY_KEY, id: TREK.id },
    );
    expect(homes).toHaveLength(1);
    expect(homes[0].date).toBe(DAY_A);
    expect(homes[0].endDate).toBe(DAY_C);
  });

  test('a spanning item is excluded from clash warnings while ordinary overlaps still clash', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.setViewportSize(DESKTOP);
    // DAY_A holds three timed items all overlapping 9:00–11:00: a SPAN (endDate=DAY_C, excluded)
    // and two ordinary items `a`/`b` that must still clash with each other.
    await seedPlan(page, [
      {
        date: DAY_A, city: 'Kathmandu', country: 'nepal',
        items: [
          { id: 's148-span', title: 'Hotel stay', category: 'hotel', startMinutes: 540, durationMinutes: 120, endDate: DAY_C },
          { id: 's148-a', title: 'Museum', category: 'cultural', startMinutes: 540, durationMinutes: 60 },
          { id: 's148-b', title: 'Walking tour', category: 'sightseeing', startMinutes: 570, durationMinutes: 60 },
        ],
      },
    ]);

    // The two ordinary overlapping items DO clash.
    await expect(page.getByTestId('calendar-item-clash-s148-a')).toBeVisible();
    await expect(page.getByTestId('calendar-item-clash-s148-b')).toBeVisible();
    // The span, despite overlapping both in clock-time, is EXCLUDED — no clash badge.
    await expect(page.getByTestId('calendar-item-clash-s148-span')).toHaveCount(0);
    // It also renders its span band.
    await expect(page.getByTestId('calendar-span-band-s148-span')).toBeVisible();

    // axe on /plan — serious/critical clean.
    const results = await new AxeBuilder({ page }).exclude('canvas.maplibregl-canvas').analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(
      blocking,
      `serious/critical a11y violations on /plan: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`,
    ).toEqual([]);

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });
});
