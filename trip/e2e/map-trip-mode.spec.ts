import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S151 — map trip-mode upgrades (dormant `out/` build):
 *   (a) search-within-map — type a known place, select it, camera flies + popup opens;
 *       selecting a result that's filtered out resets the category filter to 'All'.
 *   (b) Directions link in the popup — byte-exact D-074 URL, target=_blank, rel~noopener.
 *   (c) live-location (GeolocateControl) — verify-only: present, inactive on load, and the
 *       storage guarantee, AMENDED by D-320 (issue #30) from "nothing written" to "nothing
 *       COORDINATE-shaped written". #30's visit autocount may write its own two lifetime keys on
 *       any route while the trip clock is inside the trip window; the GeolocateControl itself
 *       still writes nothing, and no `GeolocationPosition` field may reach disk from either.
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

  /**
   * The two keys issue #30 owns (gateway keys 32 and 33). They are EXCLUDED from the snapshot
   * comparison below rather than asserted absent, because whether they exist depends on the date
   * the suite runs at: inside the trip window the boot-once visit autocount writes them on every
   * route, this one included. Excluding them also makes the check immune to the race between the
   * island's mount and the first snapshot.
   */
  const VISIT_AUTOCOUNT_KEYS = ['tripPlannerLifetimeVisits', 'tripPlannerVisitConfirmations'];

  test('live-location: GeolocateControl present but inactive on load; nothing geo-shaped persisted', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await gotoMap(page);

    const snapshot = () =>
      page.evaluate(
        (owned: string[]) => Object.keys(window.localStorage).filter((k) => !owned.includes(k)).sort(),
        VISIT_AUTOCOUNT_KEYS,
      );
    const keysBefore = await snapshot();

    const geo = page.locator('.maplibregl-ctrl-geolocate');
    await expect(geo).toBeVisible();
    await expect(geo).not.toHaveClass(/maplibregl-ctrl-geolocate-active/);
    await expect(geo).not.toHaveClass(/maplibregl-ctrl-geolocate-background/);

    // Give the map a moment to fully settle (style load, initial fitBounds) — the GeolocateControl
    // is permission-gated and never auto-fires, so storage must be byte-identical to the pre-settle
    // snapshot: nothing new, nothing geo-shaped.
    await page.waitForTimeout(500);
    const keysAfter = await snapshot();
    expect(keysAfter).toEqual(keysBefore);
    expect(keysAfter.some((k) => /geo|position/i.test(k))).toBe(false);

    /**
     * D-158 said "nothing persisted"; D-320 (issue #30) amended that to "no COORDINATE persisted",
     * and this is that half, re-asserted at the surface the original guarantee was written about.
     * #30 may store a resolved place name and a timestamp; it may never store anything lifted off
     * a `GeolocationPosition`.
     *
     * Scoped to #30's own two keys ON PURPOSE — a sweep over every value would be wrong, not
     * merely broad: `myPlaces` and an itinerary item's own pin legitimately hold `lat`/`lng`
     * (D-278/D-280), authored or entered by the user rather than read off the device.
     */
    const coordinateLeak = await page.evaluate((owned: string[]) => {
      const values = owned.map((k) => window.localStorage.getItem(k) ?? '').join('\n');
      return values.match(/latitude|longitude|"lat"|"lng"|coords|accuracy|altitude|heading/i)?.[0] ?? null;
    }, VISIT_AUTOCOUNT_KEYS);
    expect(coordinateLeak, 'a coordinate-shaped field reached the visit record').toBeNull();

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
 *  • New York (the Dec 9 departure day's city, D-315 — Syracuse until 2026-08-14) is a TRIP
 *    CITY with no curated marker, so before this slice there was no way to bring it into view
 *    by name at all. The camera assertion reads `data-map-view` (lng,lat,zoom, emitted on every
 *    `moveend`) — New York (JFK) sits at -73.8°, and every other place on this map is between
 *    83°E and 141°E, so a camera at -73.8° cannot happen by accident.
 *  • The CEILING, as it stood: a place that is NOT in the trip did not resolve at all.
 *
 * 🔴 ISSUE #22 LIFTED THAT CEILING, AND MOVED THIS TEST'S AIM RATHER THAN RETIRING IT. A place
 * anywhere in the world now resolves — through `lib/world-search.ts`, a keyless Nominatim lookup
 * fired ONLY from the search panel's submit button. So the third test below no longer asserts
 * "the query never reaches the network"; it asserts the thing that is still forbidden and is
 * easier to break by accident: **a keystroke never reaches the network.** Nominatim's usage
 * policy bans search-as-you-type outright (a debounce is not a compliant substitute), so an
 * innocent-looking `useEffect([query])` added later would breach the provider's terms, not merely
 * waste requests. That is exactly the kind of regression a tripwire is for.
 */
// CITY_COORDS['New York'] (lib/city-coords.ts) — JFK, where the day is actually spent.
const NEW_YORK_LAT = 40.6413;
const NEW_YORK_LNG = -73.7781;

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
  test('search: New York — a trip city with no curated marker — is found and the camera flies to it', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    const shell = page.getByTestId('map-shell');
    const before = await waitForCamera(page);
    // Sanity: the load frame is over Nepal→Japan, i.e. NOT anywhere near New York.
    expect(Number(before.split(',')[0])).toBeGreaterThan(0);

    await page.getByTestId('map-search-toggle').click();
    await page.getByTestId('map-search-input').fill('New York');

    // The city row sorts ahead of the Day-1 plan titles that also contain "New York"
    // (CURATED_HITS, then cityHits, then stopHits — map-section.tsx).
    const result = page.getByTestId('map-search-result-city-new-york');
    await expect(result).toBeVisible();
    await expect(result).toContainText('New York');
    await expect(result).toContainText('A city on your trip');
    await result.click();

    // The popup that opens names the place that was actually targeted.
    const popup = page.locator('.njp-map-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(popup).toContainText('New York');

    // The camera MOVED, and it moved TO NEW YORK. (focusMarker centres with a 150px popup
    // offset, hence the 0.5° tolerance — still ~160° away from anything else on this map.)
    await expect
      .poll(
        async () => {
          const [lng, lat] = ((await shell.getAttribute('data-map-view')) ?? '')
            .split(',')
            .map(Number);
          return (
            Number.isFinite(lng) &&
            Math.abs(lng - NEW_YORK_LNG) < 0.5 &&
            Math.abs(lat - NEW_YORK_LAT) < 0.5
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
    await expect(result).toContainText('A stop you planned · Approximate — placed from “New York”.');
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
    // triggers (New York -73.8° to Tokyo 141°), which is the race the queued focus exists for.
    await expect
      .poll(
        async () => {
          const [lng, lat] = ((await shell.getAttribute('data-map-view')) ?? '')
            .split(',')
            .map(Number);
          return (
            Number.isFinite(lng) &&
            Math.abs(lng - NEW_YORK_LNG) < 0.5 &&
            Math.abs(lat - NEW_YORK_LAT) < 0.5
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('search: TYPING a place that is not in the trip lists nothing, moves nothing, and never reaches the network', async ({
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
    await expect(results).toContainText('Nothing on your trip matches “Reykjavik” yet.');
    await expect(results.getByRole('button')).toHaveCount(0);
    // The world list does not exist until it is asked for. Typing is not asking.
    await expect(page.getByTestId('map-search-world-results')).toHaveCount(0);

    // Give any (forbidden) as-you-type lookup a full second to fire.
    await page.waitForTimeout(1000);

    // Issue #22: the world lookup is submit-only, because Nominatim's usage policy forbids
    // as-you-type querying. The typed name must not appear in ANY request the page made while
    // the user was only typing — that is the tripwire on a future debounced "improvement".
    expect(
      requests.filter((u) => u.toLowerCase().includes('reykjav')),
      `a keystroke reached the network: ${requests.join('\n')}`,
    ).toEqual([]);

    // And the camera did not move.
    expect(await shell.getAttribute('data-map-view')).toBe(before);

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });
});

/**
 * Issue #22 — the WORLD half. Nominatim is STUBBED with `page.route(...)`, the same shape
 * `weather.spec.ts` / `travel-essentials.spec.ts` already use for Open-Meteo and Frankfurter: the
 * live service is never touched from CI (it is a free community endpoint; hammering it from a
 * test runner is exactly what its usage policy asks us not to do), and both the success and the
 * failure path become deterministic.
 */
const NOMINATIM_ROUTE = '**/nominatim.openstreetmap.org/**';

/** The real service sends `Access-Control-Allow-Origin: *` (it is built to be called from a
 *  browser). The stub says so explicitly rather than relying on the harness to add it, so a
 *  CORS-blocked read can never masquerade as "the parser returned nothing". */
const CORS_OK = { 'access-control-allow-origin': '*' };

/** One real `format=jsonv2` row. Note `lat`/`lon` arrive as STRINGS — see lib/world-search.ts. */
const REYKJAVIK_FIXTURE = [
  {
    place_id: 297577535,
    osm_type: 'relation',
    osm_id: 2580605,
    lat: '64.1466019',
    lon: '-21.9422367',
    name: 'Reykjavík',
    display_name: 'Reykjavík, Capital Region, Iceland',
  },
];
const REYKJAVIK_LAT = 64.1466019;
const REYKJAVIK_LNG = -21.9422367;

test.describe('issue #22 · searching for a place anywhere in the world', () => {
  test('submit: a world result is listed under its own heading, and choosing it flies the camera there', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.route(NOMINATIM_ROUTE, (route) =>
      route.fulfill({ json: REYKJAVIK_FIXTURE, headers: CORS_OK }),
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    const shell = page.getByTestId('map-shell');
    const before = await waitForCamera(page);
    // Sanity: the load frame is over Nepal→Japan, i.e. nowhere near Iceland.
    expect(Number(before.split(',')[0])).toBeGreaterThan(0);

    await page.getByTestId('map-search-toggle').click();
    await page.getByTestId('map-search-input').fill('Reykjavik');
    // Nothing on the trip matches, and until the button is pressed that is the whole answer.
    await expect(page.getByTestId('map-search-results')).toContainText('Nothing on your trip matches');
    await page.getByTestId('map-search-world-submit').click();

    // TRIP FIRST, WORLD SECOND — in the DOM, not just visually.
    const world = page.getByTestId('map-search-world-results');
    await expect(world).toBeVisible();
    const result = page.getByTestId('map-search-result-world-297577535');
    await expect(result).toContainText('Reykjavík');
    // The full region trail, verbatim from the provider — it is what separates two same-named
    // places, so it is asserted rather than assumed.
    await expect(result).toContainText('Reykjavík, Capital Region, Iceland');

    // The count is announced, and focus lands on the sentence that announces it.
    const status = page.getByTestId('map-search-status');
    await expect(status).toHaveText(/0 places on your trip, 1 place elsewhere in the world\./);
    await expect(status).toBeFocused();

    await result.click();

    // The panel closes and the note says which off-trip place the map is showing.
    await expect(page.getByTestId('map-search-panel')).toHaveCount(0);
    await expect(page.getByTestId('map-note')).toContainText('Reykjavík, Capital Region, Iceland');

    // The camera MOVED, and it moved TO REYKJAVÍK — 105° west of anything else on this map.
    await expect
      .poll(
        async () => {
          const [lng, lat] = ((await shell.getAttribute('data-map-view')) ?? '')
            .split(',')
            .map(Number);
          return (
            Number.isFinite(lng) &&
            Math.abs(lng - REYKJAVIK_LNG) < 0.5 &&
            Math.abs(lat - REYKJAVIK_LAT) < 0.5
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('submit: a failed lookup says so in plain words, and the trip search still works', async ({
    page,
  }) => {
    // Deliberately no `trackErrors` here: an aborted cross-origin request prints a browser-level
    // "Failed to load resource" that no application code can suppress (the finding recorded on
    // `lib/currency-rate.ts`). The point of this test is what the USER is told.
    await page.route(NOMINATIM_ROUTE, (route) => route.abort());
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    const shell = page.getByTestId('map-shell');
    const before = await waitForCamera(page);

    await page.getByTestId('map-search-toggle').click();
    await page.getByTestId('map-search-input').fill('Boudhanath');
    await page.getByTestId('map-search-world-submit').click();

    // Plain words. Not an error code, not a stack, not "TypeError: Failed to fetch".
    const status = page.getByTestId('map-search-status');
    await expect(status).toContainText("Couldn't reach the worldwide place lookup");
    await expect(status).toContainText('Everything on your trip still searches');
    await expect(status).not.toContainText(/error|fetch|http/i);
    await expect(status).toBeFocused();
    await expect(page.getByTestId('map-search-world-results')).toHaveCount(0);

    // And the trip search is untouched by the failure: the curated result is still there, still
    // selectable, and still flies the camera.
    const trip = page.getByTestId(`map-search-result-${BOUDHA_ID}`);
    await expect(trip).toContainText(BOUDHA_NAME);
    await trip.click();
    await expect
      .poll(
        async () => {
          const [lng, lat] = ((await shell.getAttribute('data-map-view')) ?? '')
            .split(',')
            .map(Number);
          return (
            Number.isFinite(lng) &&
            Math.abs(lng - BOUDHA_LNG) < 0.5 &&
            Math.abs(lat - BOUDHA_LAT) < 0.5
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    expect(await shell.getAttribute('data-map-view')).not.toBe(before);
  });
});
