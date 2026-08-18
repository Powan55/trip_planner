import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S234 — multi-trip isolation net (D-205 / D-209 / D-210 / D-212 / D-172).
 *
 * The verification layer over S232 (dynamic getTripId, trip-scoped itinerary Vault) + S233 (Create/
 * Join Trip UI, `?trip=` handshake). Proves, on the served static `out/` build, driving the REAL
 * S233 Settings UI:
 *
 *   1. ITINERARY isolation end-to-end — an edit made on a newly-created pack lands in that pack's
 *      `trip:{token}:itinerary` slot and NEVER touches the default pack's grandfathered
 *      `nepal_japan_itinerary` key; switching back to the default pack finds its itinerary
 *      byte-identical (full localStorage dump comparison, not a UI spot-check). This is the
 *      hard local-isolation guarantee for the one domain S231 actually scoped.
 *   2. FULL localStorage key enumeration + classification — after living on a second pack, every
 *      key present classifies as trip-prefixed (`trip:*`), app-scoped-shared, or a legacy
 *      default-pack literal; an unclassified key FAILS the test (a tripwire for a new un-scoped key).
 *   3. A signed-in traveler on a fresh (non-default) pack still passes the front-door wall on a
 *      non-Home route — a fresh pack does not weaken the wall.
 *
 * ── S234-F1 FIXED IN S235 (D-218) ───────────────────────────────────────────────────────────────
 * EVERY trip-scoped domain (expenses/budget/journal/favorites/photos/packing/docs/dayAnchors/
 * shareInbox/weatherCache/syncOutbox) now routes its gateway accessor through `keyFor(slot)`, so a
 * non-default pack namespaces every domain to `trip:{token}:{slot}` and never touches the default
 * pack's grandfathered literal. This net now proves it end-to-end on TWO domains — itinerary AND
 * packing — through the same Create→edit→switch-back round trip, with byte-identity of the default
 * pack after the excursion. The unit regression is table-driven over the whole slot union in
 * `lib/__tests__/multi-trip-sync-path.test.ts` Part B.
 *
 * ── SWITCH-BACK-TO-DEFAULT (S234-F2 FIXED IN S235) ──────────────────────────────────────────────
 * The Settings Trip group now shows a "Switch to my main trip" button whenever the active pack is
 * non-default (`settings-trip-switch-main`); it writes `setActiveTripId(DEFAULT_TRIP_ID)` + reloads,
 * landing back on the grandfathered pack regardless of what the displayed (possibly-secret) Trip Key
 * is. The packing round-trip below returns via that button (not the Join-paste workaround the S234
 * net had to use). The itinerary round-trip keeps the Join-paste path for continuity of coverage.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const PACKING_KEY = 'nepal_japan_packing';
const PACK_ITEM = 'packing-item-universal-passport-copies'; // a stable DEFAULT_TEMPLATE item id
const ACTIVE_TRIP_KEY = 'tripPlannerActiveTrip';
const DEFAULT_ID = 'nepal-japan-2026';
const TOUR_SEEN = 'nepal_japan_first_run_tour_seen';
const KNOWN_DAY = '2026-12-11'; // a real Nepal-leg date the sample itinerary populates

/** Seed a signed-in traveler before any app script (identity is app-scoped → safe across reloads). */
async function seedTraveler(page: Page, token = 'Powan') {
  await page.addInitScript(
    ({ t, tour }: { t: string; tour: string }) => {
      window.localStorage.setItem('tripPlannerToken', t);
      window.localStorage.setItem('tripPlannerUserName', t);
      window.localStorage.setItem(tour, '1');
    },
    { t: token, tour: TOUR_SEEN },
  );
}

/** The lazy `CalendarPlanner` island is mounted once a `calendar-day-*` cell is present (not the skeleton). */
async function waitForPlannerReady(page: Page) {
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'visible' });
}
async function gotoSettled(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}

/**
 * Add an itinerary item via the real editor (mirrors persistence.spec's proven flow).
 * `day` defaults to KNOWN_DAY (the default Nepal×Japan pack). Pass `'auto'` for a pack whose day
 * cells aren't known in advance (e.g. the SB-6 single-day placeholder pack) to resolve the first
 * `calendar-day-*` cell live, the same pattern `waitForPlannerReady` uses.
 */
async function addItineraryItem(page: Page, title: string, day: string = KNOWN_DAY) {
  if (day === 'auto') {
    await page.locator('[data-testid^="calendar-day-"]').first().click();
  } else {
    await page.getByTestId(`calendar-day-${day}`).click();
  }
  await page.getByTestId('calendar-add-item').click();
  await expect(page.getByTestId('calendar-editor')).toBeVisible();
  await page.getByTestId('calendar-editor-title-input').pressSequentially(title, { delay: 10 });
  await page.mouse.wheel(0, -5000); // lift the app-wide <footer> off the Save button (persistence.spec note)
  await page.getByTestId('calendar-editor-save').click();
  await expect(page.getByTestId('calendar-editor')).toHaveCount(0);
  await expect(
    page.locator('[data-testid^="calendar-item-"]').filter({ hasText: title }),
  ).toHaveCount(1);
}

const readKey = (page: Page, key: string) =>
  page.evaluate((k) => window.localStorage.getItem(k), key);

const readAll = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)!;
      out[k] = window.localStorage.getItem(k)!;
    }
    return out;
  });

/** Open Settings → Trip group. */
async function openTripGroup(page: Page) {
  await page.goto('/settings/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('settings-group-trip-toggle').click();
}

/**
 * Switch this browser onto a fresh, never-seen UUID pack from the ALREADY-OPEN Settings Trip group.
 *
 * S390-F deleted Settings' own "Create new trip" card (two create paths with different guarantees —
 * `/trips/` is the one that names the trip and pushes its meta). Add-by-Trip-Token is the
 * behaviour-preserving substitute for THIS net, and deliberately so: it calls the same `joinTrip(id)`
 * primitive with no trip config. Since SB-6 (A-2 fix), joining a never-before-seen id no longer falls
 * back to the Nepal×Japan template — it resolves to `placeholderTripConfig`, a single-day pack (leg
 * id `'main'`, `start=end=today`, city `'Somewhere'`). Assertions against this fresh pack must resolve
 * its one day dynamically rather than assume `calendar-day-2026-12-11` is present. Driving `/trips/`'s
 * create instead would mint a CUSTOM-dated trip and silently stop testing isolation against the seeded
 * content. Returns the new pack's token.
 */
async function createPackViaSettings(page: Page): Promise<string> {
  const id = crypto.randomUUID();
  await page.getByTestId('settings-trip-join-input').fill(id);
  await page.getByTestId('settings-trip-join-submit').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
  return id;
}

/** Load /packing and wait for the (ssr:false) checklist island to mount. */
async function gotoPacking(page: Page) {
  await page.goto('/packing/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('packing-checklist')).toBeVisible({ timeout: 15_000 });
}

/** Check the stable passport item and wait until the packing slot has actually been written. */
async function checkPassportItem(page: Page, targetKey: string) {
  await page.getByTestId(PACK_ITEM).check();
  await expect.poll(() => readKey(page, targetKey)).not.toBeNull();
}

test.describe('S234 — itinerary isolation across a real Create/Join round-trip', () => {
  test('an edit on a new pack never touches the default pack; default itinerary is byte-identical after switching back', async ({
    page,
  }) => {
    await seedTraveler(page);

    // ── DEFAULT pack: make a distinctive edit, then snapshot the default itinerary bytes. ──
    await gotoSettled(page, '/plan/');
    await addItineraryItem(page, 'DEFAULT-PACK-ITEM');
    const defaultItineraryBefore = await readKey(page, ITINERARY_KEY);
    expect(defaultItineraryBefore).not.toBeNull();
    expect(defaultItineraryBefore).toContain('DEFAULT-PACK-ITEM');
    expect(await readKey(page, ACTIVE_TRIP_KEY)).toBeNull(); // default pack → no pointer

    // ── Move onto a fresh pack via the REAL Settings UI (paste a new token → pointer → reload). ──
    await openTripGroup(page);
    await createPackViaSettings(page);
    const newToken = await readKey(page, ACTIVE_TRIP_KEY);
    expect(newToken).toMatch(/^[0-9a-f-]{36}$/);

    // The default pack's itinerary key is UNTOUCHED by the switch (still holds the edit).
    expect(await readKey(page, ITINERARY_KEY)).toBe(defaultItineraryBefore);

    // ── On the new pack: it's the SB-6 single-day placeholder, NOT the default pack's edit. ──
    await gotoSettled(page, '/plan/');
    await page.locator('[data-testid^="calendar-day-"]').first().click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: 'DEFAULT-PACK-ITEM' }),
    ).toHaveCount(0);

    // Write in the new pack. It must land in trip:{token}:itinerary, never the legacy literal.
    await addItineraryItem(page, 'NEWPACK-ITEM', 'auto');
    expect(await readKey(page, `trip:${newToken}:itinerary`)).toContain('NEWPACK-ITEM');
    const defaultDuringNewPack = await readKey(page, ITINERARY_KEY);
    expect(defaultDuringNewPack).toBe(defaultItineraryBefore); // legacy key still pristine
    expect(defaultDuringNewPack).not.toContain('NEWPACK-ITEM');

    // ── Switch back to the default pack via the real Join UI (paste the default local id). ──
    await openTripGroup(page);
    await page.getByTestId('settings-trip-join-input').fill(DEFAULT_ID);
    await page.getByTestId('settings-trip-join-submit').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
    expect(await readKey(page, ACTIVE_TRIP_KEY)).toBe(DEFAULT_ID); // resolves to the grandfathered pack

    // Default itinerary is BYTE-IDENTICAL to the pre-excursion snapshot; the new pack's item never leaked.
    const defaultItineraryAfter = await readKey(page, ITINERARY_KEY);
    expect(defaultItineraryAfter).toBe(defaultItineraryBefore);
    expect(defaultItineraryAfter).not.toContain('NEWPACK-ITEM');

    // And the UI on the default pack shows the default edit, not the new pack's.
    await gotoSettled(page, '/plan/');
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: 'DEFAULT-PACK-ITEM' }),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: 'NEWPACK-ITEM' }),
    ).toHaveCount(0);
  });
});

test.describe('S235 — packing (2nd domain) isolation + switch-back-via-button round-trip', () => {
  test('a packing edit on a new pack never touches the default pack; the switch-back button restores byte-identical packing', async ({
    page,
  }) => {
    await seedTraveler(page);

    // ── DEFAULT pack: check the passport item, snapshot the default packing bytes. ──
    await gotoPacking(page);
    await checkPassportItem(page, PACKING_KEY);
    const defaultPackingBefore = await readKey(page, PACKING_KEY);
    expect(defaultPackingBefore).not.toBeNull();
    expect(await readKey(page, ACTIVE_TRIP_KEY)).toBeNull(); // default pack → no pointer

    // ── Move onto a fresh pack via the real Settings UI. ──
    await openTripGroup(page);
    await createPackViaSettings(page);
    const newToken = await readKey(page, ACTIVE_TRIP_KEY);
    expect(newToken).toMatch(/^[0-9a-f-]{36}$/);
    // The switch left the default packing key pristine.
    expect(await readKey(page, PACKING_KEY)).toBe(defaultPackingBefore);

    // ── On the new pack: the passport item starts UNchecked (fresh template, not the default edit). ──
    await gotoPacking(page);
    await expect(page.getByTestId(PACK_ITEM)).not.toBeChecked();
    // The pre-toggle state: no packing key for this pack yet (template is seeded on read, written on edit).
    expect(await readKey(page, `trip:${newToken}:packing`)).toBeNull();

    // Edit on the new pack → lands in trip:{token}:packing, default literal untouched.
    await checkPassportItem(page, `trip:${newToken}:packing`);
    expect(await readKey(page, `trip:${newToken}:packing`)).not.toBeNull();
    const defaultDuringNewPack = await readKey(page, PACKING_KEY);
    expect(defaultDuringNewPack).toBe(defaultPackingBefore); // legacy key still pristine

    // ── Switch back to the default pack via the F2 BUTTON (visible only on a non-default pack). ──
    await openTripGroup(page);
    await expect(page.getByTestId('settings-trip-shared-banner')).toBeVisible();
    await page.getByTestId('settings-trip-switch-main').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
    expect(await readKey(page, ACTIVE_TRIP_KEY)).toBe(DEFAULT_ID); // back on the grandfathered pack
    // The banner + switch button are gone on the default pack.
    await page.getByTestId('settings-group-trip-toggle').click();
    await expect(page.getByTestId('settings-trip-switch-main')).toHaveCount(0);

    // Default packing is BYTE-IDENTICAL to the pre-excursion snapshot; the new pack's edit never leaked.
    const defaultPackingAfter = await readKey(page, PACKING_KEY);
    expect(defaultPackingAfter).toBe(defaultPackingBefore);

    // And the UI on the default pack shows the passport item still checked (the default edit).
    await gotoPacking(page);
    await expect(page.getByTestId(PACK_ITEM)).toBeChecked();
  });
});

test.describe('S234 — full localStorage key classification on a non-default pack', () => {
  // App-scoped keys shared across every pack by design (identity, prefs, device, pointer, tour, TM).
  const APP_SCOPED = new Set([
    'tripPlannerUserName',
    'tripPlannerToken',
    'nightlife_section_visible',
    'tripPlannerTodayOverride',
    'chunk_reload_once',
    'nepal_japan_first_run_tour_seen',
    'tripPlannerActiveTrip',
    'tripPlannerKnownTrips', // S238 key 26 — the list the pointer selects from (app-scoped like the pointer)
    'tripPlannerSyncCode', // S255 key 28 — personal Sync Code (app-scoped, mirrors the trip list cross-device)
    'tripPlannerRemovedTrips', // S269 key 29 — trip-forget tombstones (app-scoped, like knownTrips)
    'nepal_japan_travel_legibility',
    'nepal_japan_travel_mode',
    'tripPlannerTravelReturn',
    'nepal_japan_device_id',
    'tripPlannerPriorNames', // S390-C key 30 — prior display names (app-scoped, like the identity it belongs to)
  ]);
  // The default pack's grandfathered trip-scoped literals (D-172): present because the default pack
  // wrote them, and correctly UNTOUCHED while a non-default pack is active.
  const LEGACY_LITERALS = new Set([
    'nepal_japan_weather_cache',
    'nepal_japan_budget',
    'nepal_japan_expenses',
    'nepal_japan_journal',
    'nepal_japan_favorites',
    'nepal_japan_sync_outbox',
    'nepal_japan_photos',
    'nepal_japan_itinerary',
    'nepal_japan_itinerary_corrupt',
    'nepal_japan_docs_checklist',
    'nepal_japan_packing',
    'nepal_japan_day_anchors',
    'nepal_japan_share_inbox',
  ]);

  test('every localStorage key classifies as trip-prefixed, app-scoped, or a legacy default literal', async ({
    page,
  }) => {
    await seedTraveler(page);

    // Touch a few domains on the default pack so real trip-scoped literals exist, then create a new pack.
    await gotoSettled(page, '/plan/');
    await addItineraryItem(page, 'CLASSIFY-DEFAULT');

    await openTripGroup(page);
    await createPackViaSettings(page);
    const token = await readKey(page, ACTIVE_TRIP_KEY);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);

    // Write in the new pack so a trip:{token}:* key exists.
    await gotoSettled(page, '/plan/');
    await addItineraryItem(page, 'CLASSIFY-NEWPACK', 'auto');

    const all = await readAll(page);
    const keys = Object.keys(all);
    // Sanity: the new pack's namespaced itinerary key is present.
    expect(keys).toContain(`trip:${token}:itinerary`);

    const unclassified = keys.filter(
      (k) => !(k.startsWith('trip:') || APP_SCOPED.has(k) || LEGACY_LITERALS.has(k)),
    );
    expect(unclassified, `unclassified localStorage keys: ${unclassified.join(', ')}`).toEqual([]);

    // Every trip:-prefixed key belongs to the ACTIVE token (no other pack leaked a namespaced key).
    const foreignPrefixed = keys.filter((k) => k.startsWith('trip:') && !k.startsWith(`trip:${token}:`));
    expect(foreignPrefixed, `foreign trip-prefixed keys: ${foreignPrefixed.join(', ')}`).toEqual([]);
  });
});

test.describe('S234 — a fresh (non-default) pack does not weaken the front-door wall', () => {
  test('a signed-in traveler on a fresh (non-default) pack passes the wall on a non-Home route', async ({ page }) => {
    await page.addInitScript(
      ({ tour, token }: { tour: string; token: string }) => {
        window.localStorage.setItem('tripPlannerToken', 'Powan');
        window.localStorage.setItem('tripPlannerUserName', 'Powan');
        window.localStorage.setItem('tripPlannerActiveTrip', token);
        window.localStorage.setItem(tour, '1');
      },
      { tour: TOUR_SEEN, token: '99999999-8888-4777-8666-555544443333' },
    );
    await gotoSettled(page, '/plan/');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="calendar-day-"]').first()).toBeVisible();
  });
});
