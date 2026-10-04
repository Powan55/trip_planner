import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S233 → S338B — capability-token trips UX E2E pack (D-205 amended / D-209 / D-172 / **D-239**).
 *
 * Proves, on the served static `out/` build (dormant; #10 retired NEXT_PUBLIC_TRIP_ID outright —
 * the default pack is a LOCAL-ONLY SAMPLE with no Trip Token in ANY build, deterministic):
 *   1. FRONT DOOR (D-660) — the wall asks for a username + password and lands `/trips/`; on this
 *      dormant build it admits locally, keeping or minting the account id on key 28. The display
 *      name is reused-from-device / defaults to "Traveler" at login; "Create an account" also
 *      collects a name. A `?trip=` invitation is HELD through login, then confirmed in the join dialog.
 *   2. Settings → Trip: a custom trip shows its Trip Token; the default pack shows the sample
 *      note instead (#10); Add-by-Trip-Token switches the active pack (pointer + reload).
 *   3. `?trip=` handshake for an IDENTIFIED user: Add switches + strips the param; Cancel strips the
 *      param and stays.
 *   4. axe clean on the front-door gate (both door states) and the Settings Trip surface, and no
 *      horizontal overflow at 360 (D-022).
 */

const ACTIVE_TRIP_KEY = 'tripPlannerActiveTrip';
const SYNC_KEY = 'tripPlannerSyncCode'; // key 28 — the account id on disk (D-660)
const TOUR_SEEN = 'nepal_japan_first_run_tour_seen';
const A_UUID = '11111111-2222-4333-8444-555566667777';
const AN_ACCOUNT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000';

/** Fresh visitor: no token, no guest — the front-door wall shows on every route incl. Home. */
async function gotoFresh(page: Page, path = '/') {
  await page.addInitScript((k) => window.localStorage.setItem(k, '1'), TOUR_SEEN);
  await page.goto(path, { waitUntil: 'load' });
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {});
}

/** Signed-in traveler seeded before any app script (mirrors settings.spec). */
async function gotoSignedIn(page: Page, path = '/settings/', token = 'Powan') {
  await page.addInitScript(
    ({ t, tour }: { t: string; tour: string }) => {
      window.localStorage.setItem('tripPlannerToken', t);
      window.localStorage.setItem('tripPlannerUserName', t);
      window.localStorage.setItem(tour, '1');
    },
    { t: token, tour: TOUR_SEEN },
  );
  await page.goto(path, { waitUntil: 'load' });
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {});
}

const readActiveTrip = (page: Page) =>
  page.evaluate((k) => window.localStorage.getItem(k), ACTIVE_TRIP_KEY);

// S238 — the known-trips registry (gateway key 26): every switch surface must register the trip.
const KNOWN_TRIPS_KEY = 'tripPlannerKnownTrips';
const readKnownTrips = (page: Page): Promise<Array<{ id: string; name: string }>> =>
  page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? '[]'), KNOWN_TRIPS_KEY);

const readSyncCode = (page: Page) => page.evaluate((k) => window.localStorage.getItem(k), SYNC_KEY);
const readIdentity = (page: Page) =>
  page.evaluate(() => window.localStorage.getItem('tripPlannerToken'));

/** Open the door's log-in form and submit a username + password (dormant: admitted locally). */
async function logIn(page: Page) {
  await page.getByTestId('landing-cta-login').click();
  await page.getByTestId('token-gate-mode-login').click();
  await page.getByTestId('token-gate-username').fill('powan');
  await page.getByTestId('token-gate-password').fill('password1');
  await page.getByTestId('token-gate-submit').click();
}

test.describe('D-660 — front door: username + password', () => {
  test('login asks for a username and password, and no name', async ({ page }) => {
    await gotoFresh(page, '/');
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    await page.getByTestId('landing-cta-login').click();
    await page.getByTestId('token-gate-mode-login').click();
    await expect(page.getByTestId('token-gate-username')).toBeVisible();
    await expect(page.getByTestId('token-gate-password')).toBeVisible();
    await expect(page.getByTestId('token-gate-name')).toHaveCount(0);
  });

  test('logging in (dormant) stores an account id + a default name, and lands on /trips/', async ({
    page,
  }) => {
    await gotoFresh(page, '/');
    const wall = page.locator('[role="dialog"]');
    await expect(wall).toHaveCount(1);
    await logIn(page);
    await page.waitForURL(/\/trips\/$/, { timeout: 15_000 });

    await expect(page.getByTestId('trips-hub')).toBeVisible({ timeout: 15_000 });
    await expect(wall).toHaveCount(0);
    expect(await readSyncCode(page)).toMatch(/^[0-9a-f-]{36}$/);
    // The door does not ask for a name at login: no saved name on a fresh device → "Traveler".
    expect(await readIdentity(page)).toBe('Traveler');
    // Logging in is NOT joining a trip: the door never touches the active-trip pointer.
    expect(await readActiveTrip(page)).toBeNull();
  });

  test('a device that already has an account id keeps it through a dormant login', async ({ page }) => {
    await page.addInitScript(
      ({ tour, key, id }: { tour: string; key: string; id: string }) => {
        window.localStorage.setItem(tour, '1');
        window.localStorage.setItem(key, id);
      },
      { tour: TOUR_SEEN, key: SYNC_KEY, id: AN_ACCOUNT_ID },
    );
    await page.goto('/', { waitUntil: 'load' });
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    await logIn(page);
    await page.waitForURL(/\/trips\/$/, { timeout: 15_000 });
    expect(await readSyncCode(page)).toBe(AN_ACCOUNT_ID);
  });

  test('Create an account collects a name, username and password, then lands /trips/', async ({
    page,
  }) => {
    await gotoFresh(page, '/');
    await page.getByTestId('landing-cta-create').click();
    await page.getByTestId('token-gate-mode-create').click();
    await page.getByTestId('token-gate-name').fill('Genghis');
    await page.getByTestId('token-gate-username').fill('genghis');
    await page.getByTestId('token-gate-password').fill('longenough');
    await page.getByTestId('token-gate-submit').click();
    await page.waitForURL(/\/trips\/$/, { timeout: 15_000 });
    await expect(page.getByTestId('trips-hub')).toBeVisible({ timeout: 15_000 });
    expect(await readSyncCode(page)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readIdentity(page)).toBe('Genghis');
    // The door creates an ACCOUNT, not a trip (separate acts).
    expect(await readActiveTrip(page)).toBeNull();
  });

  test('a ?trip= invitation is HELD through login, then confirmed in the join dialog (lands Home)', async ({
    page,
  }) => {
    await gotoFresh(page, `/?trip=${A_UUID}`);
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    // Exactly ONE dialog: the handshake must not also mount behind the wall.
    await expect(page.getByTestId('trip-join-dialog')).toHaveCount(0);
    await expect(page.getByTestId('token-gate-invite')).toBeVisible();

    await logIn(page);
    // #775: the wall hands the link to the join dialog; nothing switches until it is confirmed.
    await expect(page.getByTestId('trip-join-dialog')).toBeVisible({ timeout: 15_000 });
    expect(await readActiveTrip(page)).toBeNull();
    await page.getByTestId('trip-join-confirm').click();
    await expect.poll(async () => await readActiveTrip(page), { timeout: 15_000 }).toBe(A_UUID);

    // Confirming lands Home (not /trips/), param-free.
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
    expect(await readKnownTrips(page)).toContainEqual(expect.objectContaining({ id: A_UUID }));
  });

  test('the door renders without horizontal overflow at 360 (D-022)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await gotoFresh(page, '/');
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    await page.getByTestId('landing-cta-create').click();
    await expect(page.getByTestId('token-gate-password')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('S233 — Settings Trip group', () => {
  test('the DEFAULT pack shows a note, not a Trip Token', async ({ page }) => {
    await gotoSignedIn(page);
    await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('settings-group-trip-toggle').click();
    // The default pack's id is the shared trip's (or the sample, on this sync-less build), so
    // there is no token to copy; the card says what it is. This build has no sync configured.
    await expect(page.getByTestId('settings-trip-key-default')).toBeVisible();
    await expect(page.getByTestId('settings-trip-key-default')).toContainText('sample trip');
    await expect(page.getByTestId('settings-trip-key')).toHaveCount(0);
    await expect(page.getByTestId('settings-trip-key-copy')).toHaveCount(0);
    await expect(page.getByTestId('settings-trip-link-copy')).toHaveCount(0);
  });

  test('a CUSTOM trip still shows its Trip Token and the copy/share controls', async ({ page }) => {
    // Seed the pointer to a custom trip — its id IS the capability token (D-205, unchanged).
    await page.addInitScript(
      ({ id }: { id: string }) => window.localStorage.setItem('tripPlannerActiveTrip', id),
      { id: A_UUID },
    );
    await gotoSignedIn(page);
    await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('settings-group-trip-toggle').click();
    await expect(page.getByTestId('settings-trip-key')).toHaveText(A_UUID);
    await expect(page.getByTestId('settings-trip-key-copy')).toBeVisible();
    await expect(page.getByTestId('settings-trip-link-copy')).toBeVisible();
  });

  test('Add-by-Trip-Token switches the active pack to the pasted token', async ({ page }) => {
    await gotoSignedIn(page);
    await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('settings-group-trip-toggle').click();

    await page.getByTestId('settings-trip-join-input').fill(A_UUID);
    await page.getByTestId('settings-trip-join-submit').click();

    await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
    expect(await readActiveTrip(page)).toBe(A_UUID);

    // S238: the joined trip is REGISTERED in the known-trips list with the shared-trip name.
    const known = await readKnownTrips(page);
    expect(known).toContainEqual(expect.objectContaining({ id: A_UUID, name: 'Shared trip' }));
  });
});

test.describe('S233 — ?trip= shared-link handshake', () => {
  test('Cancel strips the param and stays on the current trip', async ({ page }) => {
    await gotoSignedIn(page, `/?trip=${A_UUID}`);
    const dialog = page.getByTestId('trip-join-dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('trip-join-cancel').click();
    await expect(dialog).toHaveCount(0);
    // Param stripped, pack unchanged (still the default → no pointer).
    await expect(page).toHaveURL(/\/$/);
    expect(await readActiveTrip(page)).toBeNull();
  });

  test('Join switches to the linked trip and strips the param', async ({ page }) => {
    await gotoSignedIn(page, `/?trip=${A_UUID}`);
    const dialog = page.getByTestId('trip-join-dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('trip-join-confirm').click();
    // Full reload to the clean URL; the pack pointer is now the linked token.
    await expect.poll(async () => await readActiveTrip(page), { timeout: 15_000 }).toBe(A_UUID);
    // S238: lands on the HOME dashboard (origin + '/', param-free) and registers the trip.
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
    const known = await readKnownTrips(page);
    expect(known).toContainEqual(expect.objectContaining({ id: A_UUID, name: 'Shared trip' }));
  });

  test('Join from a NON-Home route lands on the home dashboard (S238)', async ({ page }) => {
    await gotoSignedIn(page, `/settings/?trip=${A_UUID}`);
    const dialog = page.getByTestId('trip-join-dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('trip-join-confirm').click();
    await expect.poll(async () => await readActiveTrip(page), { timeout: 15_000 }).toBe(A_UUID);
    // NOT /settings/ any more — the handshake redirects home so the joiner lands oriented.
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
    expect(await readKnownTrips(page)).toContainEqual(
      expect.objectContaining({ id: A_UUID, name: 'Shared trip' }),
    );
  });

  test('no dialog when ?trip= equals the current trip key (default slug)', async ({ page }) => {
    await gotoSignedIn(page, '/?trip=nepal-japan-2026');
    await expect(page.locator('h1').first()).toBeVisible();
    // Same trip → no prompt, no switch.
    await expect(page.getByTestId('trip-join-dialog')).toHaveCount(0);
    expect(await readActiveTrip(page)).toBeNull();
  });
});

test.describe('S233 — axe', () => {
  test('front-door gate has zero serious/critical violations', async ({ page }) => {
    await gotoFresh(page, '/');
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    // Settle the entrance fade before the axe scan: mid-fade opacity composites text to a false hit.
    await expect(page.locator('[role="dialog"]')).toHaveCSS('opacity', '1');
    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')).toEqual([]);
  });

  test('the sign-up form, with an error showing, has zero serious/critical violations', async ({
    page,
  }) => {
    await gotoFresh(page, '/');
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    await page.getByTestId('landing-cta-create').click();
    await page.getByTestId('token-gate-name').fill('Genghis');
    await page.getByTestId('token-gate-username').fill('x');
    await page.getByTestId('token-gate-password').fill('longenough');
    await page.getByTestId('token-gate-submit').click();
    await expect(page.getByTestId('token-gate-error')).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCSS('opacity', '1');
    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')).toEqual([]);
  });

  test('Settings Trip group has zero serious/critical violations', async ({ page }) => {
    await gotoSignedIn(page);
    await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('settings-group-trip-toggle').click();
    // On the default pack the token card renders the note, not the token itself.
    await expect(page.getByTestId('settings-trip-key-default')).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[data-testid="settings-group-trip"]').analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')).toEqual([]);
  });
});
