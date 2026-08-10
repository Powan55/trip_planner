import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S239 — `/trips/` hub E2E pack (D-172 / D-205 / D-209, S238 registry).
 *
 * Proves, on the served static `out/` build (dormant — `NEXT_PUBLIC_TRIP_ID` unset):
 *   1. The hub lists every known trip, default pack first, with the Current badge.
 *   2. Create-with-name mints a UUID pack, registers it under the typed name, writes the
 *      pointer, and lands on the HOME dashboard.
 *   3. Tapping a non-current row is the D-172 switch primitive (pointer flipped + Home).
 *   4. Inline rename persists across a full reload (registry storage, S238).
 *   5. Join-by-key registers the trip under the OPTIONAL custom name and lands Home.
 *   6. axe: zero serious/critical violations on the hub.
 *   7. (S338B / D-239) This is the POST-LOGIN surface: select · create · add-by-**Trip Token**, the
 *      per-trip raw Trip Token is copyable, and a grandfathered traveler (identity but no User
 *      Token) is not locked out and can complete their account here.
 */

const ACTIVE_TRIP_KEY = 'tripPlannerActiveTrip';
const KNOWN_TRIPS_KEY = 'tripPlannerKnownTrips';
const REMOVED_TRIPS_KEY = 'tripPlannerRemovedTrips';
const SYNC_KEY = 'tripPlannerSyncCode'; // key 28 — the USER TOKEN on disk (D-239 keeps the name)
const A_UUID = '11111111-2222-4333-8444-555566667777';
/** Origin + '/' exactly — the post-switch landing target (mirrors token-trips.spec). */
const HOME_URL = /^https?:\/\/[^/]+\/$/;

/** Navigate and ride out the SW-controller settle (mirrors token-trips.spec). */
async function goto(page: Page, path = '/trips/') {
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

const readKnownTrips = (page: Page): Promise<Array<{ id: string; name: string }>> =>
  page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? '[]'), KNOWN_TRIPS_KEY);

const readRemovedTrips = (page: Page): Promise<Array<{ id: string; removedAt: number }>> =>
  page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? '[]'), REMOVED_TRIPS_KEY);

test.describe('S239 — /trips/ hub', () => {
  test('lists the default pack first with the Current badge and "Main trip" (no joined date)', async ({
    page,
  }) => {
    await goto(page);
    const row0 = page.getByTestId('trips-hub-row-0');
    await expect(row0).toBeVisible({ timeout: 15_000 });
    await expect(row0).toContainText('Nepal × Japan');
    await expect(row0).toContainText('Current');
    await expect(row0).toContainText('Main trip');
    // Dormant build: the default pack has no share token (env unset) → no copy button.
    await expect(page.getByTestId('trips-hub-copy-0')).toHaveCount(0);
  });

  test('exports a per-route document.title (S264 server-component metadata)', async ({
    page,
  }) => {
    await goto(page);
    await expect(page.getByTestId('trips-hub-row-0')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveTitle(/^Trips ·/);
  });

  test('Create with a required name mints a UUID pack, registers the name, and lands Home', async ({
    page,
  }) => {
    await goto(page);
    const createBtn = page.getByTestId('trips-hub-create');
    await expect(createBtn).toBeVisible({ timeout: 15_000 });
    await expect(createBtn).toBeDisabled(); // name is REQUIRED — empty form cannot submit

    await page.getByTestId('trips-hub-create-name').fill('Kerala 2027');
    await createBtn.click();

    // D-172: full navigation to the HOME dashboard with the new pack active.
    await page.waitForURL(HOME_URL, { timeout: 15_000 });
    const pointer = await readActiveTrip(page);
    expect(pointer).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readKnownTrips(page)).toContainEqual(
      expect.objectContaining({ id: pointer, name: 'Kerala 2027' }),
    );
  });

  test('tapping a non-current row switches (pointer flipped) and lands Home', async ({ page }) => {
    // Seed: browser is ON the shared trip A_UUID, which is registered in the known list.
    // ONCE-guarded: addInitScript re-runs on EVERY navigation, and this test's whole point is
    // that the app flips the pointer — an unguarded seed would silently reset it on the
    // post-switch Home load and assert against its own fixture.
    await page.addInitScript(
      ({ pointerKey, knownKey, id }: { pointerKey: string; knownKey: string; id: string }) => {
        if (window.localStorage.getItem('__s239Seeded')) return;
        window.localStorage.setItem('__s239Seeded', '1');
        window.localStorage.setItem(pointerKey, id);
        window.localStorage.setItem(
          knownKey,
          JSON.stringify([{ id, name: 'Trek crew', joinedAt: 1750000000000 }]),
        );
      },
      { pointerKey: ACTIVE_TRIP_KEY, knownKey: KNOWN_TRIPS_KEY, id: A_UUID },
    );
    await goto(page);

    // Row 0 = default pack (always first, non-current); row 1 = the active shared trip.
    const row1 = page.getByTestId('trips-hub-row-1');
    await expect(row1).toBeVisible({ timeout: 15_000 });
    await expect(row1).toContainText('Trek crew');
    await expect(row1).toContainText('Current');
    // Shared pack: the id IS the token (D-205) → the row is shareable even in a dormant build.
    await expect(page.getByTestId('trips-hub-copy-1')).toBeVisible();

    await page
      .getByTestId('trips-hub-row-0')
      .getByRole('button', { name: /tap to switch/ })
      .click();

    await page.waitForURL(HOME_URL, { timeout: 15_000 });
    // Switching to the default pack writes its literal id as the pointer (D-172 grandfather).
    expect(await readActiveTrip(page)).toBe('nepal-japan-2026');
  });

  test('inline rename survives a full reload', async ({ page }) => {
    await goto(page);
    await expect(page.getByTestId('trips-hub-row-0')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('trips-hub-rename-0').click();
    const input = page.getByTestId('trips-hub-rename-input-0');
    await expect(input).toBeVisible();
    await input.fill('Our big year');
    await page.getByTestId('trips-hub-rename-save-0').click();
    await expect(page.getByTestId('trips-hub-row-0')).toContainText('Our big year');

    await goto(page); // full reload — the name must come back from the registry (S238)
    await expect(page.getByTestId('trips-hub-row-0')).toContainText('Our big year', {
      timeout: 15_000,
    });
    expect(await readKnownTrips(page)).toContainEqual(
      expect.objectContaining({ id: 'nepal-japan-2026', name: 'Our big year' }),
    );
  });

  test('Join by key registers with the custom name, switches, and lands Home', async ({ page }) => {
    await goto(page);
    const joinBtn = page.getByTestId('trips-hub-join');
    await expect(joinBtn).toBeVisible({ timeout: 15_000 });
    await expect(joinBtn).toBeDisabled(); // key is required

    await page.getByTestId('trips-hub-join-key').fill(A_UUID);
    await page.getByTestId('trips-hub-join-name').fill('Annapurna crew');
    await joinBtn.click();

    await page.waitForURL(HOME_URL, { timeout: 15_000 });
    expect(await readActiveTrip(page)).toBe(A_UUID);
    expect(await readKnownTrips(page)).toContainEqual(
      expect.objectContaining({ id: A_UUID, name: 'Annapurna crew' }),
    );
  });

  test('Forget a trip removes it from the list and it stays gone after a full reload (S269)', async ({
    page,
  }) => {
    // Seed a non-active shared trip in the known list (pointer unset → default pack is active, so the
    // forgotten row is NOT the active trip and the hub stays put instead of navigating Home).
    await page.addInitScript(
      ({ knownKey, id }: { knownKey: string; id: string }) => {
        if (window.localStorage.getItem('__s269Seeded')) return;
        window.localStorage.setItem('__s269Seeded', '1');
        window.localStorage.setItem(
          knownKey,
          JSON.stringify([{ id, name: 'Old crew', joinedAt: 1750000000000 }]),
        );
      },
      { knownKey: KNOWN_TRIPS_KEY, id: A_UUID },
    );
    await goto(page);

    const row1 = page.getByTestId('trips-hub-row-1');
    await expect(row1).toBeVisible({ timeout: 15_000 });
    await expect(row1).toContainText('Old crew');

    // Forget it — confirm through the reused Radix AlertDialog.
    await page.getByTestId('trips-hub-forget-1').click();
    await expect(page.getByTestId('trips-hub-forget-confirm')).toBeVisible();
    await page.getByTestId('trips-hub-forget-action').click();

    // Row gone immediately; only the default pack remains.
    await expect(page.getByTestId('trips-hub-row-1')).toHaveCount(0);
    await expect(page.getByTestId('trips-hub-row-0')).toBeVisible();

    // Storage: the trip left the known list and a tombstone was written.
    expect(await readKnownTrips(page)).not.toContainEqual(expect.objectContaining({ id: A_UUID }));
    expect(await readRemovedTrips(page)).toContainEqual(expect.objectContaining({ id: A_UUID }));

    // Full reload (the once-guarded seed does NOT re-run) — the row must stay gone.
    await goto(page);
    await expect(page.getByTestId('trips-hub-row-0')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('trips-hub-row-1')).toHaveCount(0);
  });

  test('axe: zero serious/critical violations on the hub', async ({ page }) => {
    await goto(page);
    await expect(page.getByTestId('trips-hub-list')).toBeVisible({ timeout: 15_000 });
    const results = await new AxeBuilder({ page }).include('[data-testid="trips-hub"]').analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')).toEqual([]);
  });
});

test.describe('S338B — /trips is the post-login surface (D-239: select · create · add by Trip Token)', () => {
  test('the three actions are named in two-token vocabulary; the raw Trip Token is copyable per trip', async ({
    page,
  }) => {
    // Seed a shared trip so a row with a real Trip Token exists in the dormant build.
    await page.addInitScript(
      ({ knownKey, id }: { knownKey: string; id: string }) => {
        if (window.localStorage.getItem('__s338bSeeded')) return;
        window.localStorage.setItem('__s338bSeeded', '1');
        window.localStorage.setItem(
          knownKey,
          JSON.stringify([{ id, name: 'Trek crew', joinedAt: 1750000000000 }]),
        );
      },
      { knownKey: KNOWN_TRIPS_KEY, id: A_UUID },
    );
    await goto(page);
    const hub = page.getByTestId('trips-hub');
    await expect(page.getByTestId('trips-hub-row-1')).toBeVisible({ timeout: 15_000 });

    // Create a trip + add a trip BY TRIP TOKEN — and the retired names are gone from the surface.
    await expect(hub).toContainText('Create a trip');
    await expect(hub).toContainText('Add a trip by Trip Token');
    await expect(hub).not.toContainText('Trip Key');
    await expect(hub).not.toContainText('sync code');
    // S355 RETIREMENT GUARD: "User Token" is retired from user-visible copy — the account
    // credential is "your key" now. Same guard shape as the two above, scoped to the hub, which is
    // where 6 of the 24 renamed sites live. Without it the rename has nothing behind it and the old
    // term can silently return under a fully green suite. "Trip Token" is a DIFFERENT concept and
    // is deliberately still asserted PRESENT two lines up.
    await expect(hub).not.toContainText('User Token');
    await expect(page.getByTestId('trips-hub-join-key')).toHaveAttribute(
      'placeholder',
      'Paste a Trip Token',
    );

    // Sharing a trip IS sharing its Trip Token (D-239): the raw token, next to the link.
    const copyToken = page.getByTestId('trips-hub-copy-token-1');
    await expect(copyToken).toBeVisible();
    await expect(copyToken).toHaveAttribute('aria-label', 'Copy the Trip Token for Trek crew');
    await expect(page.getByTestId('trips-hub-copy-1')).toBeVisible();
  });

  test('a grandfathered traveler (identity, no User Token) is NOT locked out and can finish their account', async ({
    page,
  }) => {
    await goto(page);
    // The default fixture is exactly the grandfathered shape: nickname seeded, key 28 absent.
    await expect(page.getByTestId('trips-hub-row-0')).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate((k) => window.localStorage.getItem(k), SYNC_KEY)).toBeNull();
    // Not locked out: the hub and its actions are fully usable before any upgrade.
    await expect(page.getByTestId('trips-hub-create')).toBeVisible();

    const card = page.getByTestId('trips-hub-finish-account');
    await expect(card).toBeVisible();
    await page.getByTestId('trips-hub-finish-account-mint').click();

    // Show-once: the minted User Token is displayed and is what landed on key 28.
    const minted = await page.evaluate((k) => window.localStorage.getItem(k), SYNC_KEY);
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByTestId('trips-hub-finish-account-show-once-value')).toHaveText(minted!);

    // Minting touches ONLY key 28 (D-239): identity, the registry and the pointer are untouched.
    const after = await page.evaluate(
      ({ known, pointer }: { known: string; pointer: string }) => ({
        token: window.localStorage.getItem('tripPlannerToken'),
        known: window.localStorage.getItem(known),
        pointer: window.localStorage.getItem(pointer),
      }),
      { known: KNOWN_TRIPS_KEY, pointer: ACTIVE_TRIP_KEY },
    );
    expect(after.token).toBe('Powan');
    expect(after.known).toBeNull();
    expect(after.pointer).toBeNull();

    // S355: the confirm is gated on the "I've saved my key" acknowledgement (both mounts of the
    // show-once screen — the grandfathered upgrade is handed the same irreplaceable credential).
    const confirm = page.getByTestId('trips-hub-finish-account-show-once-confirm');
    await expect(confirm).toBeDisabled();
    await page.getByTestId('trips-hub-finish-account-show-once-ack').check();
    await expect(confirm).toBeEnabled();

    await confirm.click();
    await expect(card).toHaveCount(0);
  });

  test('a traveler who already has a User Token never sees the upgrade card', async ({ page }) => {
    await page.addInitScript(
      ({ key, token }: { key: string; token: string }) => window.localStorage.setItem(key, token),
      { key: SYNC_KEY, token: '99999999-8888-4777-8666-555544443333' },
    );
    await goto(page);
    await expect(page.getByTestId('trips-hub-row-0')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('trips-hub-finish-account')).toHaveCount(0);
  });
});
