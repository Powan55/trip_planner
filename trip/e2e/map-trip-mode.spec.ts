import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S151 — map trip-mode upgrades (dormant `out/` build):
 *   (a) search-within-map — type a known place, select it, camera flies + popup opens;
 *       selecting a result that's filtered out resets the category filter to 'All'.
 *   (b) Directions link in the popup — byte-exact D-074 URL, target=_blank, rel~noopener.
 *   (c) live-location (GeolocateControl) — verify-only: present, inactive on load,
 *       nothing written to localStorage.
 *   (d) schematic-line caveat — shown only while the "My itinerary" overlay is on.
 *
 * Settle discipline mirrors pin-drop.spec.ts / plan-map-split.spec.ts: navigate to
 * `domcontentloaded`, block on `map-shell`, never `networkidle`. Reduced motion is
 * emulated on the search/directions specs so the search-select camera move (jumpTo,
 * not flyTo) and any concurrent fitBounds are instant and deterministic.
 */

const BOUDHA_ID = 'np-boudhanath';
const BOUDHA_NAME = 'Boudhanath Stupa';
const BOUDHA_LAT = 27.7215;
const BOUDHA_LNG = 85.362;

async function gotoMap(page: Page) {
  await page.goto('/map/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('map-shell')).toBeVisible();
}

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.describe('S151 · map trip-mode upgrades', () => {
  test('search: type a known place, select it -> the popup for that place opens', async ({ page }) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    const toggle = page.getByTestId('map-search-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const input = page.getByTestId('map-search-input');
    await expect(input).toBeFocused();
    await input.fill('Boudhanath');

    const result = page.getByTestId(`map-search-result-${BOUDHA_ID}`);
    await expect(result).toBeVisible();
    await expect(result).toContainText(BOUDHA_NAME);
    await result.click();

    // Panel closes on select.
    await expect(page.getByTestId('map-search-panel')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // The popup for the selected place opens.
    const popup = page.locator('.njp-map-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(popup).toContainText(BOUDHA_NAME);

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('search: a result reachable by keyboard alone (Tab focus + Enter)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    await page.getByTestId('map-search-toggle').click();
    await page.getByTestId('map-search-input').fill('Fushimi');
    const result = page.getByTestId('map-search-result-jp-fushimi');
    await expect(result).toBeVisible();
    await result.focus();
    await result.press('Enter');

    const popup = page.locator('.njp-map-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(popup).toContainText('Fushimi Inari Taisha');
  });

  test('search: Esc closes the panel', async ({ page }) => {
    await gotoMap(page);
    const toggle = page.getByTestId('map-search-toggle');
    await toggle.click();
    const input = page.getByTestId('map-search-input');
    await expect(input).toBeVisible();
    await input.press('Escape');
    await expect(page.getByTestId('map-search-panel')).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('search: selecting a result filtered out by category resets the filter to All', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    // Filter to Hotel — Boudhanath (Cultural) is excluded from the visible set.
    await page.getByTestId('map-filter-hotel').click();
    await expect(page.getByTestId('map-filter-hotel')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('map-search-toggle').click();
    await page.getByTestId('map-search-input').fill('Boudhanath');
    await page.getByTestId(`map-search-result-${BOUDHA_ID}`).click();

    // Filter reset to All (the marker is reachable for the popup to make sense).
    await expect(page.getByTestId('map-filter-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('map-filter-hotel')).toHaveAttribute('aria-pressed', 'false');

    const popup = page.locator('.njp-map-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(popup).toContainText(BOUDHA_NAME);
  });

  test('directions: the popup Directions link is byte-exact D-074, target=_blank, rel~noopener', async ({ page }) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    await page.getByTestId('map-search-toggle').click();
    await page.getByTestId('map-search-input').fill('Boudhanath');
    await page.getByTestId(`map-search-result-${BOUDHA_ID}`).click();

    const popup = page.locator('.njp-map-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });

    const directions = popup.getByTestId('map-popup-directions');
    await expect(directions).toBeVisible();
    await expect(directions).toHaveAttribute(
      'href',
      `https://www.google.com/maps/dir/?api=1&destination=${BOUDHA_LAT},${BOUDHA_LNG}`,
    );
    await expect(directions).toHaveAttribute('target', '_blank');
    const rel = await directions.getAttribute('rel');
    expect(rel ?? '').toContain('noopener');

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('live-location: GeolocateControl present but inactive on load; nothing persisted', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoMap(page);

    const keysBefore = await page.evaluate(() => Object.keys(window.localStorage).sort());

    const geo = page.locator('.maplibregl-ctrl-geolocate');
    await expect(geo).toBeVisible();
    await expect(geo).not.toHaveClass(/maplibregl-ctrl-geolocate-active/);
    await expect(geo).not.toHaveClass(/maplibregl-ctrl-geolocate-background/);

    // Give the map a moment to fully settle (style load, initial fitBounds) —
    // geolocation is permission-gated and never auto-fires, so storage must be
    // byte-identical to the pre-settle snapshot: nothing new, nothing geo-shaped.
    await page.waitForTimeout(500);
    const keysAfter = await page.evaluate(() => Object.keys(window.localStorage).sort());
    expect(keysAfter).toEqual(keysBefore);
    expect(keysAfter.some((k) => /geo|position/i.test(k))).toBe(false);

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('caveat: the schematic-line note shows only while "My itinerary" is on', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoMap(page);
    await expect(page.getByTestId('map-route-caveat')).toHaveCount(0);

    await page.getByTestId('map-itinerary-toggle').click();
    const caveat = page.getByTestId('map-route-caveat');
    await expect(caveat).toBeVisible();
    await expect(caveat).toContainText('schematic');

    await page.getByTestId('map-itinerary-toggle').click();
    await expect(page.getByTestId('map-route-caveat')).toHaveCount(0);

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });
});

/**
 * S406 — search resolves EVERY place in the trip, not only the 27 curated markers.
 *
 * Two halves, and both matter:
 *  • Syracuse (the Dec 9 departure city, S393) is a TRIP CITY with no curated marker, so
 *    before this slice there was no way to bring it into view by name at all. The camera
 *    assertion reads `data-map-view` (lng,lat,zoom, emitted on every `moveend`) — Syracuse
 *    sits at -76.1°, and every other place on this map is between 83°E and 141°E, so a
 *    camera at -76° cannot happen by accident.
 *  • The CEILING: a place that is NOT in the trip does not resolve, because the whole search
 *    path is in-bundle data (D-088 — no geocoder, no network). The second test pins that the
 *    typed name never leaves the browser, so a later "improvement" cannot quietly turn this
 *    into a geocoding request.
 */
const SYRACUSE_LAT = 43.0481;
const SYRACUSE_LNG = -76.1474;

/** Block until TripMap has reported a camera at least once (`data-map-view` goes non-empty
 *  on the first `emitView`, fired inside the GL `load` handler — a visible canvas is not
 *  that signal). Returns the settled camera string. */
async function waitForCamera(page: Page): Promise<string> {
  const shell = page.getByTestId('map-shell');
  await expect
    .poll(async () => (await shell.getAttribute('data-map-view')) ?? '', { timeout: 20_000 })
    .not.toBe('');
  // Reduced motion makes the initial fit an instant jumpTo, so one short settle is enough.
  await page.waitForTimeout(500);
  return (await shell.getAttribute('data-map-view')) ?? '';
}

test.describe('S406 · map search over every place in the trip', () => {
  test('search: Syracuse — a trip city with no curated marker — is found and the camera flies to it', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    const shell = page.getByTestId('map-shell');
    const before = await waitForCamera(page);
    // Sanity: the load frame is over Nepal→Japan, i.e. NOT anywhere near Syracuse.
    expect(Number(before.split(',')[0])).toBeGreaterThan(0);

    await page.getByTestId('map-search-toggle').click();
    await page.getByTestId('map-search-input').fill('Syracuse');

    const result = page.getByTestId('map-search-result-city-syracuse');
    await expect(result).toBeVisible();
    await expect(result).toContainText('Syracuse');
    await expect(result).toContainText('A city on your trip');
    await result.click();

    // The popup that opens names the place that was actually targeted.
    const popup = page.locator('.njp-map-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(popup).toContainText('Syracuse');

    // The camera MOVED, and it moved TO SYRACUSE. (focusMarker centres with a 150px popup
    // offset, hence the 0.5° tolerance — still ~160° away from anything else on this map.)
    await expect
      .poll(
        async () => {
          const [lng, lat] = ((await shell.getAttribute('data-map-view')) ?? '')
            .split(',')
            .map(Number);
          return (
            Number.isFinite(lng) &&
            Math.abs(lng - SYRACUSE_LNG) < 0.5 &&
            Math.abs(lat - SYRACUSE_LAT) < 0.5
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    expect(await shell.getAttribute('data-map-view')).not.toBe(before);

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });

  test("search: one of the user's OWN planned stops is findable by its title and flies to its pin", async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    const shell = page.getByTestId('map-shell');
    await waitForCamera(page);

    // A Day-1 plan (seed item n1-2). It is NOT a curated marker and NOT a city name — it is
    // reachable only as a planned stop, and it shares its pin with the other two Day-1 plans,
    // so it also proves a row addresses its GROUP's pin rather than one that was never drawn.
    await page.getByTestId('map-search-toggle').click();
    await page.getByTestId('map-search-input').fill('Layover at New York');

    const result = page.getByTestId('map-search-result-stop-n1-2');
    await expect(result).toBeVisible();
    await expect(result).toContainText('Layover at New York (JFK) Terminal 4');
    // D-279 — an approximate stop says so, and quotes the text its coordinate came from.
    await expect(result).toContainText('A stop you planned · Approximate — placed from “Syracuse”.');
    await result.click();

    // Selecting a stop turns the itinerary overlay on (its pin is only drawn there)...
    await expect(page.getByTestId('map-itinerary-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // ...and the STOP popup opens (not the curated one, which would offer Directions to a
    // centroid), naming the plans that share the pin.
    const stopPopup = page.getByTestId('map-stop-popup');
    await expect(stopPopup).toBeVisible({ timeout: 10_000 });
    await expect(stopPopup).toHaveAttribute('data-approximate', 'true');
    await expect(stopPopup).toContainText('Layover at New York (JFK) Terminal 4');

    // The camera is on the pin — NOT on the whole-route fit that switching the overlay on
    // triggers (Syracuse -76° to Tokyo 141°), which is the race the queued focus exists for.
    await expect
      .poll(
        async () => {
          const [lng, lat] = ((await shell.getAttribute('data-map-view')) ?? '')
            .split(',')
            .map(Number);
          return (
            Number.isFinite(lng) &&
            Math.abs(lng - SYRACUSE_LNG) < 0.5 &&
            Math.abs(lat - SYRACUSE_LAT) < 0.5
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('search: a place that is NOT in the trip resolves to nothing, moves nothing, and never reaches the network', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    const shell = page.getByTestId('map-shell');
    const before = await waitForCamera(page);

    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));

    await page.getByTestId('map-search-toggle').click();
    await page.getByTestId('map-search-input').fill('Reykjavik');

    const results = page.getByTestId('map-search-results');
    await expect(results).toContainText('No places match “Reykjavik”.');
    await expect(results.getByRole('button')).toHaveCount(0);

    // Give any (forbidden) lookup a full second to fire.
    await page.waitForTimeout(1000);

    // D-088: the search is in-bundle data only. The typed name must never appear in ANY
    // request the page makes — that is the tripwire on a future silent geocoder.
    expect(
      requests.filter((u) => u.toLowerCase().includes('reykjav')),
      `the query reached the network: ${requests.join('\n')}`,
    ).toEqual([]);

    // And the camera did not move.
    expect(await shell.getAttribute('data-map-view')).toBe(before);

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });
});
