import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S137 → S357B — pin-drop via the MAP + the "N of M stops shown" overlay.
 *
 * S137 placed a pin by typing two decimals into lat/lng fields. S357B deleted those fields
 * (nobody knows their coordinates) and replaced them with a picker on the map pane that
 * `/plan` already owns, so this file is a REWRITE rather than a patch: the flow it drove no
 * longer exists.
 *
 * Proves, on a real run against the dormant `out/` build:
 *   1. Pick flow — arm the picker from the editor, click the canvas, and the item is pinned
 *      to the coordinate under the cursor; the pin SURVIVES A RELOAD (the D-002 hard
 *      guarantee, and the point of this file) and still PLOTS after that reload.
 *   2. Keyboard parity — "Use centre" places the pin with no pointer gesture, because a
 *      canvas click cannot be performed from the keyboard.
 *   3. Clearing a pin stops the item plotting.
 *   4. Overlay honesty — with an unmappable item present, /plan shows "N of M stops shown"
 *      and /map shows "N of M plans exactly placed" (S381/D-279 re-pointed /map's badge
 *      when D-278's ladder made "shown" true of every plan), both with N<M; pinning bumps
 *      N up to M on both.
 *
 * The assertions never hard-code a coordinate. The picked value is READ BACK off the
 * editor's pin readout and then compared against what landed in localStorage — so the test
 * proves the round trip (map → editor → commit → disk → reload → map) rather than proving
 * that one particular pixel is one particular longitude.
 *
 * Settle discipline mirrors plan-map-split.spec.ts: navigate to `domcontentloaded`, block on
 * the lazy planner island's `calendar-day-*` grid — never `networkidle`.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const FIXTURE_DAY = '2026-12-09'; // TRIP_DATES[0] — the default-selected day

async function waitForPlannerReady(page: Page) {
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });
}

/** Seed one Nepal day (FIXTURE_DAY): one item that matches a curated marker by name
 *  (Boudhanath Stupa), and one custom item with NO pin and NO name match (unmappable
 *  until pinned) — so N (plotted) < M (total) out of the box. */
async function seedMixedDay(page: Page) {
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ key, date }: { key: string; date: string }) => {
      const dayPlan = {
        date,
        city: 'Kathmandu',
        country: 'nepal',
        items: [
          { id: 's137-matched', title: 'Boudhanath Stupa', category: 'sightseeing' },
          { id: 's137-custom', title: 'Family friend’s house visit', category: 'sightseeing' },
        ],
      };
      window.localStorage.setItem(key, JSON.stringify([dayPlan]));
    },
    { key: ITINERARY_KEY, date: FIXTURE_DAY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}

/** The stored lat/lng for an item id, read straight off localStorage. The store rewrites the
 *  seeded bare array into its vault envelope on first write, so accept either shape. */
async function storedPin(page: Page, itemId: string): Promise<{ lat?: number; lng?: number } | null> {
  return page.evaluate(
    ({ key, id }: { key: string; id: string }) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const days = Array.isArray(parsed) ? parsed : parsed.payload;
      for (const day of days ?? []) {
        for (const item of day.items ?? []) {
          if (item.id === id) return { lat: item.lat, lng: item.lng };
        }
      }
      return null;
    },
    { key: ITINERARY_KEY, id: itemId },
  );
}

const CANVAS = 'canvas.maplibregl-canvas';

/** Block until the map has reported a camera at least once. `data-map-view` goes non-empty on
 *  TripMap's first `emitView()` (fired inside the GL `load` handler), which is also the point
 *  from which "Use centre" has a centre to hand back. A visible canvas is NOT that signal. */
async function waitForCamera(page: Page) {
  await expect
    .poll(async () => (await page.getByTestId('plan-day-map').getAttribute('data-map-view')) ?? '', {
      timeout: 20_000,
    })
    .not.toBe('');
}

/** Open the editor for an item and reveal the pin controls (S357A put them behind the
 *  "More details" disclosure — one toggle click, no assertion changed). */
async function openPinSection(page: Page, itemId: string) {
  await page.getByTestId(`calendar-item-edit-${itemId}`).click();
  const editor = page.getByTestId('calendar-editor');
  await expect(editor).toBeVisible();
  await editor.getByTestId('calendar-editor-more-toggle').click();
  return editor;
}

test.describe('S357B · pin-drop from the map + "N of M stops shown" overlay', () => {
  test('map pick: drop a pin on the canvas → it plots → reload → it persisted AND still plots', async ({
    page,
  }) => {
    // Reduced motion → the fit is an instant jumpTo, so the camera has settled by the time we
    // click and the coordinate under the cursor is stable (same rationale as plan-map-split).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedMixedDay(page);

    await page.getByTestId('plan-map-toggle').click();
    const pane = page.getByTestId('plan-day-map');
    await expect(page.locator(CANVAS)).toBeVisible({ timeout: 20_000 });

    // Before pinning: 1 of 2 shown (only "Boudhanath Stupa" name-matches).
    await expect(pane).toHaveAttribute('data-stop-count', '1');
    await expect(pane).toHaveAttribute('data-total-count', '2');
    await expect(page.getByTestId('plan-day-map-count')).toContainText('1 of 2 stops shown');

    // Arm the picker from the editor. The editor steps aside (visibility:hidden, still
    // mounted) and the pick bar takes over the map pane.
    const editor = await openPinSection(page, 's137-custom');
    await editor.getByTestId('calendar-editor-pin-drop').click();
    await expect(page.getByTestId('plan-map-pick-bar')).toBeVisible();
    await expect(editor).toBeHidden();
    await expect(pane).toHaveAttribute('data-pick-mode', 'true');

    // Click the canvas. `page.mouse.click` does not auto-scroll, and the first render can
    // race the GL click handler, so scroll the pane in and retry until the pick lands.
    const canvas = page.locator(CANVAS);
    await canvas.scrollIntoViewIfNeeded();
    await expect(async () => {
      const box = (await canvas.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.getByTestId('plan-map-pick-bar')).toHaveCount(0, { timeout: 1500 });
    }).toPass({ timeout: 15_000 });

    // The editor is back with everything it had, now carrying the picked coordinate.
    await expect(editor).toBeVisible();
    const readout = editor.getByTestId('calendar-editor-pin-value');
    await expect(readout).toBeVisible();
    const pickedLat = await readout.getAttribute('data-lat');
    const pickedLng = await readout.getAttribute('data-lng');
    expect(Number(pickedLat)).toBeGreaterThanOrEqual(-90);
    expect(Number(pickedLat)).toBeLessThanOrEqual(90);
    expect(Number(pickedLng)).toBeGreaterThanOrEqual(-180);
    expect(Number(pickedLng)).toBeLessThanOrEqual(180);

    await editor.getByTestId('calendar-editor-save').click();
    await expect(editor).toBeHidden();

    // Now 2 of 2 shown — the pinned item plots (stopMarkerFor prefers a manual pin).
    await expect(pane).toHaveAttribute('data-stop-count', '2');
    await expect(pane).toHaveAttribute('data-total-count', '2');
    await expect(page.getByTestId('plan-day-map-count')).toContainText('2 of 2 stops shown');

    // On disk: the EXACT coordinate the map handed back, not an approximation of it.
    const onDisk = await storedPin(page, 's137-custom');
    expect(onDisk?.lat).toBe(Number(pickedLat));
    expect(onDisk?.lng).toBe(Number(pickedLng));

    // Reload — the pin survives (D-002 hard persistence guarantee) and still plots.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);
    const afterReload = await storedPin(page, 's137-custom');
    expect(afterReload?.lat).toBe(Number(pickedLat));
    expect(afterReload?.lng).toBe(Number(pickedLng));

    await page.getByTestId('plan-map-toggle').click();
    await expect(page.locator(CANVAS)).toBeVisible({ timeout: 20_000 });
    await expect(pane).toHaveAttribute('data-stop-count', '2');
  });

  test('keyboard parity: "Use centre" pins without a pointer gesture, and persists', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedMixedDay(page);

    await page.getByTestId('plan-map-toggle').click();
    const pane = page.getByTestId('plan-day-map');
    await expect(page.locator(CANVAS)).toBeVisible({ timeout: 20_000 });
    await expect(pane).toHaveAttribute('data-stop-count', '1');

    const editor = await openPinSection(page, 's137-custom');
    await editor.getByTestId('calendar-editor-pin-drop').click();

    // Arming the picker moves focus onto its primary control — no pointer needed to reach it.
    const centre = page.getByTestId('plan-map-pick-centre');
    await expect(centre).toBeFocused();
    await waitForCamera(page);
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('plan-map-pick-bar')).toHaveCount(0);
    await expect(editor).toBeVisible();
    const readout = editor.getByTestId('calendar-editor-pin-value');
    const lat = Number(await readout.getAttribute('data-lat'));
    const lng = Number(await readout.getAttribute('data-lng'));

    await editor.getByTestId('calendar-editor-save').click();
    await expect(editor).toBeHidden();
    await expect(pane).toHaveAttribute('data-stop-count', '2');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);
    const onDisk = await storedPin(page, 's137-custom');
    expect(onDisk?.lat).toBe(lat);
    expect(onDisk?.lng).toBe(lng);
  });

  test('clearing a pin stops the item plotting', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedMixedDay(page);

    await page.getByTestId('plan-map-toggle').click();
    const pane = page.getByTestId('plan-day-map');
    await expect(page.locator(CANVAS)).toBeVisible({ timeout: 20_000 });

    // Pin it (keyboard path — the pointer path is covered above).
    let editor = await openPinSection(page, 's137-custom');
    await editor.getByTestId('calendar-editor-pin-drop').click();
    await expect(page.getByTestId('plan-map-pick-centre')).toBeFocused();
    await waitForCamera(page);
    await page.keyboard.press('Enter');
    await editor.getByTestId('calendar-editor-save').click();
    await expect(editor).toBeHidden();
    await expect(pane).toHaveAttribute('data-stop-count', '2');

    // Re-open and clear it → back to 1 of 2, and the pin is gone from disk.
    editor = await openPinSection(page, 's137-custom');
    await expect(editor.getByTestId('calendar-editor-pin-value')).toBeVisible();
    await editor.getByTestId('calendar-editor-pin-clear').click();
    await expect(editor.getByTestId('calendar-editor-pin-value')).toHaveCount(0);
    await editor.getByTestId('calendar-editor-save').click();
    await expect(editor).toBeHidden();

    await expect(pane).toHaveAttribute('data-stop-count', '1');
    await expect(pane).toHaveAttribute('data-total-count', '2');
    const onDisk = await storedPin(page, 's137-custom');
    expect(onDisk?.lat).toBeUndefined();
    expect(onDisk?.lng).toBeUndefined();
  });

  // S381: /map's badge changed MEANING (D-279) — under D-278's placement ladder every
  // plan is shown, so "N of M stops shown" would be N === M forever. It now counts the
  // EXACTLY-placed plans, which this test still discriminates: 1 of 2 before the pin (only
  // the curated-marker item is exact), 2 of 2 after.
  test('overlay: /map shows "N of M plans exactly placed" and pinning bumps N', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedMixedDay(page);

    await page.goto('/map/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('map-shell')).toBeVisible();

    const toggle = page.getByTestId('map-itinerary-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-stop-count', '1');
    await expect(toggle).toHaveAttribute('data-total-count', '2');
    await expect(page.getByTestId('map-itinerary-count')).toContainText(
      '1 of 2 plans exactly placed',
    );

    // Pin the custom item via /plan, then come back to /map — the count bumps to 2 of 2.
    await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);
    const editor = await openPinSection(page, 's137-custom');
    await editor.getByTestId('calendar-editor-pin-drop').click();
    await expect(page.locator(CANVAS)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('plan-map-pick-centre')).toBeFocused();
    await waitForCamera(page);
    await page.keyboard.press('Enter');
    await editor.getByTestId('calendar-editor-save').click();
    await expect(editor).toBeHidden();

    await page.goto('/map/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('map-shell')).toBeVisible();
    await page.getByTestId('map-itinerary-toggle').click();
    await expect(toggle).toHaveAttribute('data-stop-count', '2');
    await expect(toggle).toHaveAttribute('data-total-count', '2');
  });
});
