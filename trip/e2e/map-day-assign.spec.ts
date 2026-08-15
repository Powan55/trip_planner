import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S224 — map-linked itinerary editing (dormant `out/` build).
 *
 * The map (a polished MapLibre mock, D-003/D-079) becomes an INPUT to day planning:
 * a user assigns a map pin to a trip day, and that day's stops re-order by client-side
 * haversine distance from the anchor (NO routing API — free-tools-only, LOCKED).
 *
 * Proves, on a real run:
 *   1. Assign via the NON-DRAG path (popup day <select> + Anchor button — the keyboard/
 *      touch equivalent): the pin is added to the chosen day via the existing itinerary
 *      CRUD, the day-strip target flips to anchored, and BOTH the added stop (Vault) and
 *      the anchor (gateway key 22) survive a reload — the localStorage hard guarantee.
 *   2. S381/D-281 (⚠️ this case used to assert the OPPOSITE): anchoring does NOT re-order
 *      the day. Nearest-first ordering was retired on every surface, decided knowing in
 *      the question that it costs the day anchor its walking-route purpose — so the panel
 *      stays in TIME order and the newly added pin lands where time puts it, not first.
 *   3. axe `/map` serious/critical = 0 with the assign UI + day panel present.
 *   4. No console errors (map raster-tile 404s in this offline sandbox are filtered —
 *      same environment limit documented in map-favorites-offline.spec.ts).
 *
 * The desktop HTML5 pointer-DRAG affordance (popup grip → day chip) is NOT automated:
 * HTML5 drag-and-drop over a MapLibre canvas popup is flaky under Playwright and never
 * fires on touch anyway. It is manually verified; the tested path is the equivalent
 * keyboard/touch <select>+button, which is the a11y floor the drag mirrors.
 *
 * Identity: default fixture (signed-in traveler). Harness discipline mirrors
 * map-favorites-offline.spec.ts: `domcontentloaded` + block on a real testid + the GL
 * canvas; open a specific marker's popup deterministically via the search panel.
 *
 * S380 adds two more, both about the day strip / day panel:
 *   5. The day-strip badge counts PLANS, not just what the coordinate join could place
 *      (the curated seed's Day 1 holds 3 items and places 0 of them — it used to read
 *      "0 stops"). S381 re-points its qualifier from "N mapped" to "N exact": under the
 *      D-278 ladder every plan is mapped, so "mapped" could no longer fail.
 *   6. A day-order row is a real focusable <button> whose Enter flies the map and opens
 *      that stop's popup (it used to be an inert <li> with three <span>s).
 *
 * S381 adds the ladder itself:
 *   7. Every plan of a day gets a row — the seed's Day 1 (3 transport legs, none of which
 *      names a curated place) rendered NO rows at all before this slice — and a row whose
 *      position was DERIVED says so, in shape and in words, quoting its own source.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const ANCHORS_KEY = 'nepal_japan_day_anchors';

const DAY1 = '2026-12-09'; // Day 1
const DAY2 = '2026-12-10'; // Day 2

const BOUDHA_ID = 'np-boudhanath';
const BOUDHA_NAME = 'Boudhanath Stupa';
const SWAYAMBHU_ID = 'np-swayambhunath';
const TOKYO_ID = 'jp-park-hyatt'; // Tokyo — ~5000 km from the Kathmandu markers

const DESKTOP = { width: 1280, height: 900 } as const;

const KNOWN_TILE_FETCH_NOISE =
  /basemaps\.cartocdn\.com|AJAXError: Failed to fetch|Failed to load resource: net::ERR_INTERNET_DISCONNECTED/;

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !KNOWN_TILE_FETCH_NOISE.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (!KNOWN_TILE_FETCH_NOISE.test(e.message)) errors.push(e.message);
  });
  return errors;
}

async function gotoMap(page: Page) {
  // Retry the navigation itself: on this shared box the single-threaded serve-out
  // server + parallel workloads intermittently stall a cold `page.goto`/island mount
  // (documented in playwright.config.ts). Re-goto until the map island's shell mounts.
  await expect(async () => {
    await page.goto('/map/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('map-shell')).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 45_000 });
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('map-day-strip')).toBeVisible();
}

/** Open a marker's popup deterministically via the search panel (works regardless of the
 *  active filter — trip-map.tsx's focusMarker addresses the marker by lat/lng). */
async function openPopupViaSearch(page: Page, query: string, resultId: string) {
  const popup = page.locator('.njp-map-popup');
  await expect(async () => {
    const toggle = page.getByTestId('map-search-toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click();
    }
    const input = page.getByTestId('map-search-input');
    await input.fill(query);
    await page.getByTestId(`map-search-result-${resultId}`).click();
    await expect(popup).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  return popup;
}

async function readAnchors(page: Page): Promise<Record<string, string> | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, ANCHORS_KEY);
}

/** Seed an EMPTY itinerary (D-018: key present + empty ⇒ no sample reseed), so day-stop
 *  counts start deterministically at 0 rather than inheriting SAMPLE_ITINERARY. */
async function seedEmpty(page: Page) {
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });
  await page.evaluate((key) => window.localStorage.setItem(key, '[]'), ITINERARY_KEY);
}

async function seedDay(
  page: Page,
  date: string,
  items: Array<{ id: string; sourceId: string; title: string; startMinutes?: number }>,
) {
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });
  await page.evaluate(
    ({ key, date, items }) => {
      const plans = [
        {
          date,
          city: 'Kathmandu',
          country: 'nepal',
          items: items.map((it) => ({ ...it, category: 'sightseeing' })),
        },
      ];
      window.localStorage.setItem(key, JSON.stringify(plans));
    },
    { key: ITINERARY_KEY, date, items },
  );
}

test.describe('S224 · assign a pin to a day (non-drag popup path), persists across reload', () => {
  test('anchor Boudhanath to Day 2 via the popup select+button; stop + anchor survive reload', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(DESKTOP);
    await seedEmpty(page);
    await gotoMap(page);

    // Day 2 starts un-anchored with no stops.
    const day2 = page.getByTestId(`map-day-target-${DAY2}`);
    await expect(day2).toHaveAttribute('data-anchored', 'false');
    await expect(day2).toHaveAttribute('data-stop-count', '0');

    // Open Boudhanath's popup and use the "Anchor to a day" control (keyboard/touch path).
    const popup = await openPopupViaSearch(page, 'Boudhanath', BOUDHA_ID);
    await expect(popup.getByTestId(`map-popup-assign-${BOUDHA_ID}`)).toBeVisible();
    await popup.getByTestId(`map-popup-assign-select-${BOUDHA_ID}`).selectOption(DAY2);
    await popup.getByTestId(`map-popup-assign-confirm-${BOUDHA_ID}`).click();

    // The day-strip target flips to anchored with one stop; the panel lists the pin.
    await expect(day2).toHaveAttribute('data-anchored', 'true');
    await expect(day2).toHaveAttribute('data-stop-count', '1');
    await expect(page.getByTestId('map-day-order')).toHaveAttribute('data-anchored', 'true');
    // S381: rows are keyed by the ITEM id (generated at add time), so address the row by the
    // marker it resolved to — and assert it resolved EXACTLY, since it came from a real pin.
    const addedRow = page.locator(
      `[data-testid^="map-day-order-stop-"][data-marker-id="${BOUDHA_ID}"]`,
    );
    await expect(addedRow).toBeVisible();
    await expect(addedRow).toHaveAttribute('data-placement', 'exact');

    // Persistence: the anchor (key 22) + the stop (Vault key) are both on disk.
    expect(await readAnchors(page)).toEqual({ [DAY2]: BOUDHA_ID });
    const itinRaw = await page.evaluate((key) => window.localStorage.getItem(key), ITINERARY_KEY);
    expect(itinRaw).toContain(BOUDHA_ID);

    // RELOAD — both survive (the localStorage hard guarantee).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await gotoMap(page);
    expect(await readAnchors(page)).toEqual({ [DAY2]: BOUDHA_ID });
    await expect(page.getByTestId(`map-day-target-${DAY2}`)).toHaveAttribute('data-anchored', 'true');
    await expect(page.getByTestId(`map-day-target-${DAY2}`)).toHaveAttribute('data-stop-count', '1');

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });
});

test.describe('S381/D-281 · anchoring does NOT re-order the day; time order holds, and survives reload', () => {
  test('Day 1 seeded 19:00 Tokyo + 08:00 Swayambhu lists early→late, and anchoring on far-away Boudha leaves that order alone', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(DESKTOP);

    // Deliberately adversarial for the OLD behaviour: the day is stored late-first, and the
    // anchor (Boudhanath) is ~7 km from Swayambhu but ~5000 km from the Tokyo hotel — so a
    // proximity sort would produce a visibly different order from the time sort.
    await seedDay(page, DAY1, [
      { id: 's224-tokyo', sourceId: TOKYO_ID, title: 'Park Hyatt Tokyo', startMinutes: 19 * 60 },
      { id: 's224-sway', sourceId: SWAYAMBHU_ID, title: 'Swayambhunath', startMinutes: 8 * 60 },
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await gotoMap(page);

    // Before anchoring: TIME order, not stored order (stored is Tokyo-then-Swayambhu).
    await page.getByTestId(`map-day-target-${DAY1}`).click();
    const panel = page.getByTestId('map-day-order');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-anchored', 'false');
    const orderedIds = async () =>
      panel.locator('[data-testid^="map-day-order-stop-"]').evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-testid')),
      );
    expect(await orderedIds()).toEqual([
      'map-day-order-stop-s224-sway',
      'map-day-order-stop-s224-tokyo',
    ]);

    // Anchor Day 1 around Boudhanath. It is added as a third, UNTIMED stop — so it sinks to
    // the end (sortItemsByTime's stable untimed rule). The retired behaviour would have put
    // it FIRST, at distance 0, and pushed Tokyo last by distance.
    const popup = await openPopupViaSearch(page, 'Boudhanath', BOUDHA_ID);
    await popup.getByTestId(`map-popup-assign-select-${BOUDHA_ID}`).selectOption(DAY1);
    await popup.getByTestId(`map-popup-assign-confirm-${BOUDHA_ID}`).click();

    await expect(panel).toHaveAttribute('data-anchored', 'true');
    const anchoredOrder = async () =>
      panel.locator('[data-testid^="map-day-order-stop-"]').evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-marker-id')),
      );
    await expect(async () => {
      expect(await anchoredOrder()).toEqual([SWAYAMBHU_ID, TOKYO_ID, BOUDHA_ID]);
    }).toPass({ timeout: 5_000 });

    // The anchor still has a job: it is the day's BASE POINT, so every row now carries a
    // distance from it (D-281) — including the ~5000 km one.
    await expect(panel).toContainText('km');

    // Reload: the anchor persists → the order is unchanged (and still not proximity-sorted).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await gotoMap(page);
    await page.getByTestId(`map-day-target-${DAY1}`).click();
    await expect(panel).toHaveAttribute('data-anchored', 'true');
    expect(await anchoredOrder()).toEqual([SWAYAMBHU_ID, TOKYO_ID, BOUDHA_ID]);
  });
});

test.describe('S380/S381 · the day-strip badge counts PLANS, qualified by how many are EXACT', () => {
  test('Day 1 (3 curated plans, 0 exact) reads "3 plans · 0 exact"; every plan still gets a row', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(DESKTOP);
    // NO seeding on purpose: this runs against the curated seed itinerary a fresh device
    // gets (core/content/itinerary.ts). Measured on that seed: Day 1 = 3 items, 0 of which
    // resolve to an asserted coordinate; Day 2 = 6 items, exactly 1 of which does.
    await gotoMap(page);

    const day1 = page.getByTestId(`map-day-target-${DAY1}`);
    // The number the user reads is the number of plans they made.
    await expect(day1).toHaveAttribute('data-stop-count', '3');
    // S381/D-279: the qualifier is EXACT-vs-total. "Mapped" would now be 3 of 3 on every
    // day of the trip — a ratio that can no longer fail is not worth rendering.
    await expect(day1).toHaveAttribute('data-mapped-count', '0');
    await expect(day1).toContainText('3 plans');
    await expect(day1).toContainText('0 exact');
    // The badge and the screen-reader label must agree — a chip that shows 3 and announces
    // 0 is no better than the bug.
    expect(await day1.getAttribute('aria-label')).toContain('3 plans, 0 exact');

    // Day 2 is the discriminator: 6 planned, 2 exactly-placed. A badge that simply echoed
    // the total into both slots fails here.
    // ⚠️ This read "1" before S381, and the change is the ITEM-KEYING fix (D-278): the
    // day's "Check in to the Thamel hotel" and "Evening walk in Thamel" both resolve to the
    // np-thamel marker, and the old per-marker dedupe silently dropped the second one. Two
    // plans are exactly placed here; only one used to be counted.
    const day2 = page.getByTestId(`map-day-target-${DAY2}`);
    await expect(day2).toHaveAttribute('data-stop-count', '6');
    await expect(day2).toHaveAttribute('data-mapped-count', '2');
    await expect(day2).toContainText('6 plans');
    await expect(day2).toContainText('2 exact');

    // 🔴 S381, the whole point: this day used to render NO rows and an empty state that said
    // so. All three plans now have a row, all three are APPROXIMATE, and each one names the
    // text its position came from — the day's city — so the claim is checkable.
    // ⚠️ D-315 moved that city: Day 1 is spent in Syracuse / JFK / the air (the traveller does
    // not reach Kathmandu until Day 2) and is NAMED New York, so rung 5 quotes "New York" and the
    // pins sit on JFK's real coordinates. The expected value tracks the day's city BY DESIGN.
    await day1.click();
    await expect(page.getByTestId('map-day-order-empty')).toHaveCount(0);
    const rows = page.locator('[data-testid^="map-day-order-stop-"]');
    await expect(rows).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(rows.nth(i)).toHaveAttribute('data-placement', 'approximate');
      await expect(rows.nth(i)).toHaveAttribute('data-via', 'city');
      await expect(rows.nth(i)).toHaveAttribute('data-derived-from', 'New York');
      // Marked in TEXT, not colour alone (D-279) — this survives greyscale.
      await expect(rows.nth(i)).toContainText('≈ New York');
    }

    // Day 2 mixes the two: six rows, two exact. Both exact rows survive even though they
    // share ONE marker — the row is keyed by the item now, so neither is dropped and neither
    // duplicates the other's key/testid.
    await day2.click();
    await expect(page.locator('[data-testid^="map-day-order-stop-"]')).toHaveCount(6);
    await expect(
      page.locator('[data-testid^="map-day-order-stop-"][data-placement="exact"]'),
    ).toHaveCount(2);
    await expect(
      page.locator('[data-testid^="map-day-order-stop-"][data-marker-id="np-thamel"]'),
    ).toHaveCount(2);
  });
});

test.describe('S381 · an approximate pin says so in its popup, quoting its own source', () => {
  test('clicking a derived stop opens a popup that names the plans and the text they were placed from', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(DESKTOP);
    await gotoMap(page);

    // Fly to the first of Day 1's three derived plans via its row (the S380 gesture).
    await page.getByTestId(`map-day-target-${DAY1}`).click();
    await page.locator('[data-testid^="map-day-order-stop-"]').first().click();

    const popup = page.getByTestId('map-stop-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(popup).toHaveAttribute('data-approximate', 'true');
    // D-315: Day 1's city is New York (departure day), so the derived pin quotes New York.
    await expect(popup).toHaveAttribute('data-derived-from', 'New York');
    // D-278: all three plans share one coordinate, so they share ONE pin, and the popup
    // lists them rather than stacking three pins on the same point.
    await expect(popup).toContainText('3 plans here');
    // D-279: the note quotes the source verbatim; the user can check the claim.
    await expect(page.getByTestId('map-stop-approx-note')).toContainText(
      'Approximate — placed from “New York”.',
    );
    // D-279: the affordance to fix it — the already-shipped S357B picker on /plan.
    await expect(page.getByTestId('map-stop-set-pin')).toHaveAttribute('href', '/plan/');
  });
});

test.describe('S380 · a day-order row is a real control that flies the map (INTAKE-05)', () => {
  test('the row is a focusable <button>; Enter flies to that stop and opens its popup', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(DESKTOP);
    await seedDay(page, DAY1, [
      { id: 's380-boudha', sourceId: BOUDHA_ID, title: BOUDHA_NAME },
    ]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await gotoMap(page);

    await page.getByTestId(`map-day-target-${DAY1}`).click();
    // S381: keyed by the ITEM id — the seed above sets it, so this stays deterministic.
    const row = page.getByTestId('map-day-order-stop-s380-boudha');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-marker-id', BOUDHA_ID);

    // A real <button> — not a click handler bolted onto the <li>.
    expect(await row.evaluate((el) => el.tagName)).toBe('BUTTON');
    // Its accessible name says where it goes, not just what it is called.
    expect(await row.getAttribute('aria-label')).toContain(`Show ${BOUDHA_NAME} on the map`);

    // Focusable BY THE BROWSER: .focus() on a non-focusable <li> leaves activeElement on <body>.
    await row.focus();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(
      'map-day-order-stop-s380-boudha',
    );

    // Enter activates it: the camera flies and THAT marker's popup opens.
    await page.keyboard.press('Enter');
    await expect(page.locator('.njp-map-popup')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`map-popup-favorite-${BOUDHA_ID}`)).toBeVisible();

    // …and the itinerary overlay is forced on, so the numbered stop is actually drawn
    // underneath the popup rather than floating over an empty basemap.
    await expect(page.getByTestId('map-itinerary-toggle')).toHaveAttribute('aria-pressed', 'true');

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });
});

test.describe('S224 · axe /map with the assign UI + day-order panel present', () => {
  test('axe: zero serious/critical violations with the day strip + open order panel', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(DESKTOP);
    await gotoMap(page);

    // Anchor a day so the panel + anchored chip are on the page during the scan.
    const popup = await openPopupViaSearch(page, 'Boudhanath', BOUDHA_ID);
    await popup.getByTestId(`map-popup-assign-select-${BOUDHA_ID}`).selectOption(DAY1);
    await popup.getByTestId(`map-popup-assign-confirm-${BOUDHA_ID}`).click();
    await expect(page.getByTestId('map-day-order')).toBeVisible();

    // Scope the scan to the feature under test: exclude the GL canvas (WebGL, not DOM)
    // and Sonner's transient toaster region — the assign fires a momentary toast, and
    // the third-party toaster's own list markup is neither this slice's UI nor stable
    // to scan mid-animation (favoriting, which never toasts, keeps FU-34's axe clean).
    const results = await new AxeBuilder({ page })
      .exclude('canvas.maplibregl-canvas')
      .exclude('[data-sonner-toaster]')
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    console.log(`axe SUMMARY /map (assign UI): serious/critical=${blocking.length}`);
    expect(
      blocking,
      `serious/critical a11y violations on /map with assign UI: ${blocking
        .map((v) => `${v.id} [${v.impact}] × ${v.nodes.length}`)
        .join('; ')}`,
    ).toEqual([]);
  });
});
