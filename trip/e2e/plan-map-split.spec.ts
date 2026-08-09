import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S136 — split map/list planning view on /plan (dormant `out/` build).
 *
 * Proves, on a real run:
 *   1. Interaction-lazy island — the MapLibre canvas does NOT exist on /plan first
 *      paint (the map runtime only initializes once the user opens the map); on
 *      toggle it mounts with ZERO console/page errors. (The definitive "maplibre not
 *      in First Load JS" proof is the `npm run build` route table — /plan at 106 kB.)
 *   2. Day-scoped data — the selected day's stops render (`data-stop-count`), and
 *      switching to an empty day re-scopes the map to 0 stops.
 *   3. Bidirectional highlight — a list row's "show on map" sets the shared marker
 *      highlight (list→map); clicking the marker on the canvas rings its list row
 *      (map→list).
 *   4. Live redraw, camera held — a keyboard reorder swaps the rows (the polyline
 *      re-derives from the new order) while the camera view (`data-map-view`) is
 *      UNCHANGED (no fit on a pure reorder).
 *   5. Mobile — the bottom-sheet peek shows anchored to the viewport bottom and
 *      expands taller.
 *
 * Settle discipline mirrors mobile-planner.spec.ts: navigate to `domcontentloaded`,
 * then block on the lazy planner island's `calendar-day-*` grid — never `networkidle`.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const FIXTURE_DAY = '2026-12-09'; // TRIP_DATES[0] — the default-selected day (today is out of window)
const EMPTY_DAY = '2026-12-10'; // seeded plan holds only FIXTURE_DAY, so this day is empty
const DESKTOP = { width: 1280, height: 900 } as const; // > lg → inline split pane
const PHONE = { width: 390, height: 844 } as const; // < lg → bottom-sheet peek

// Titles that resolve to curated markers via matchMarker's name join (lib/itinerary-map).
const BOUDHA_MARKER = 'np-boudhanath'; // "Boudhanath Stupa"

async function waitForPlannerReady(page: Page) {
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });
}
async function gotoPlan(page: Page) {
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}

/** Seed one Nepal day (FIXTURE_DAY) with the given items and reload. */
async function seedDay(page: Page, items: Array<{ id: string; title: string }>) {
  await gotoPlan(page);
  await page.evaluate(
    ({ key, date, items }: { key: string; date: string; items: Array<{ id: string; title: string }> }) => {
      const dayPlan = {
        date,
        city: 'Kathmandu',
        country: 'nepal',
        items: items.map((i) => ({ id: i.id, title: i.title, category: 'sightseeing' })),
      };
      window.localStorage.setItem(key, JSON.stringify([dayPlan]));
    },
    { key: ITINERARY_KEY, date: FIXTURE_DAY, items },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}

async function rowIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="calendar-row-swipe-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('calendar-row-swipe-', '')));
}

const CANVAS = 'canvas.maplibregl-canvas';

test.describe('S136 · split map/list view on /plan', () => {
  test('map island is interaction-lazy: no canvas before toggle, mounts on toggle with no console errors', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.setViewportSize(DESKTOP);
    await seedDay(page, [
      { id: 's136-a', title: 'Boudhanath Stupa' },
      { id: 's136-b', title: 'Pashupatinath Temple' },
    ]);

    // Before opening the map, the MapLibre runtime is NOT mounted (no canvas).
    await expect(page.getByTestId('plan-map-toggle')).toBeVisible();
    await expect(page.locator(CANVAS)).toHaveCount(0);

    // Open the map → the island mounts and MapLibre initializes.
    await page.getByTestId('plan-map-toggle').click();
    await expect(page.locator(CANVAS)).toBeVisible({ timeout: 20_000 });

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('day-scoped: stops render, switching to an empty day re-scopes to 0 stops', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seedDay(page, [
      { id: 's136-a', title: 'Boudhanath Stupa' },
      { id: 's136-b', title: 'Pashupatinath Temple' },
    ]);

    await page.getByTestId('plan-map-toggle').click();
    const pane = page.getByTestId('plan-day-map');
    await expect(page.locator(CANVAS)).toBeVisible({ timeout: 20_000 });
    await expect(pane).toHaveAttribute('data-stop-count', '2');

    // Switch to an empty day → the map re-scopes (0 stops for that day).
    await page.getByTestId(`calendar-day-${EMPTY_DAY}`).click();
    await expect(pane).toHaveAttribute('data-stop-count', '0');
  });

  test('list→map: a row "show on map" sets the shared marker highlight + rings the row', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seedDay(page, [
      { id: 's136-a', title: 'Boudhanath Stupa' },
      { id: 's136-b', title: 'Pashupatinath Temple' },
    ]);

    await page.getByTestId('plan-map-toggle').click();
    const pane = page.getByTestId('plan-day-map');
    await expect(page.locator(CANVAS)).toBeVisible({ timeout: 20_000 });
    await expect(pane).toHaveAttribute('data-highlight-id', '');

    await page.getByTestId('calendar-item-locate-s136-a').click();
    await expect(pane).toHaveAttribute('data-highlight-id', BOUDHA_MARKER);
    await expect(page.getByTestId('calendar-item-s136-a')).toHaveAttribute('data-highlighted', 'true');
  });

  test('map→list: clicking the marker on the canvas rings its list row', async ({ page }) => {
    // Reduced motion → fitBounds is an instant jumpTo, so the single stop sits at the
    // canvas centre immediately and a centre-click reliably hits its marker.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(DESKTOP);
    await seedDay(page, [{ id: 's136-solo', title: 'Boudhanath Stupa' }]);

    await page.getByTestId('plan-map-toggle').click();
    const pane = page.getByTestId('plan-day-map');
    const canvas = page.locator(CANVAS);
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    await expect(pane).toHaveAttribute('data-stop-count', '1');

    // The single stop is fitted to the canvas centre (data-map-view proves it). Scroll the
    // pane into view (page.mouse.click does NOT auto-scroll) and click the centre until the
    // marker click registers (absorbs first-render timing).
    await canvas.scrollIntoViewIfNeeded();
    await expect(async () => {
      const box = (await canvas.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(pane).toHaveAttribute('data-highlight-id', BOUDHA_MARKER, { timeout: 1500 });
    }).toPass({ timeout: 15_000 });

    await expect(page.getByTestId('calendar-item-s136-solo')).toHaveAttribute('data-highlighted', 'true');
  });

  test('reorder redraws the polyline WITHOUT moving the camera', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seedDay(page, [
      { id: 's136-a', title: 'Boudhanath Stupa' },
      { id: 's136-b', title: 'Pashupatinath Temple' },
    ]);

    await page.getByTestId('plan-map-toggle').click();
    const pane = page.getByTestId('plan-day-map');
    await expect(page.locator(CANVAS)).toBeVisible({ timeout: 20_000 });
    await expect(pane).toHaveAttribute('data-stop-count', '2');

    // Wait for the initial fit to settle (data-map-view goes non-empty on moveend).
    await expect.poll(async () => (await pane.getAttribute('data-map-view')) ?? '', { timeout: 10_000 }).not.toBe('');
    await page.waitForTimeout(900); // let the fit animation's final moveend land
    const viewBefore = await pane.getAttribute('data-map-view');

    // Keyboard reorder (dnd-kit): pick up row A, move past B, drop → order swaps.
    await page.getByRole('button', { name: 'Reorder Boudhanath Stupa' }).focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    await page.keyboard.press('Space');
    await expect.poll(() => rowIds(page), { timeout: 8000 }).toEqual(['s136-b', 's136-a']);

    // The polyline re-derived from the new order, but the camera did NOT move.
    await page.waitForTimeout(500);
    expect(await pane.getAttribute('data-map-view')).toBe(viewBefore);
  });

  test('mobile: the bottom-sheet peek shows anchored to the bottom and expands', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await seedDay(page, [
      { id: 's136-a', title: 'Boudhanath Stupa' },
      { id: 's136-b', title: 'Pashupatinath Temple' },
    ]);

    const toggle = page.getByTestId('plan-map-toggle');
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();

    const sheet = page.getByTestId('plan-map-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-expanded', 'false');
    await expect(page.locator(CANVAS)).toBeVisible({ timeout: 20_000 });

    // Peek is flush to the viewport bottom.
    const peek = (await sheet.boundingBox())!;
    expect(peek.y + peek.height).toBeGreaterThan(PHONE.height - 4);

    // Expand → the sheet grows taller.
    await page.getByTestId('plan-map-sheet-expand').click();
    await expect(sheet).toHaveAttribute('data-expanded', 'true');
    await page.waitForTimeout(400); // height transition
    const expanded = (await sheet.boundingBox())!;
    expect(expanded.height).toBeGreaterThan(peek.height);
  });
});
