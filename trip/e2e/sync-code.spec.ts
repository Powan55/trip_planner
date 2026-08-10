import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S255 → S338B — the **User Token** settings card (D-239 promotes S255's "Sync Code" to the account
 * credential: SAME on-disk key `tripPlannerSyncCode`, key 28 — zero migration, so every device that
 * ever minted one is already an account).
 *
 * Run against the served static `out/` build WITHOUT live Firebase (the dormant build: minting is a
 * pure local write; push/subscribe self-gate on `isRemoteConfigured()` and no-op). The two-device
 * merge itself is covered at unit level (`lib/__tests__/sync-code.test.ts`) — this spec proves the
 * UI + persistence surface under the new contract:
 *
 *   1. The "Your User Token" card renders for a logged-in traveler; the token starts masked/unset,
 *      and the copy carries the NEVER-SHARE warning that separates it from a Trip Token.
 *   2. Reveal mints a UUID, shows it, persists it to `tripPlannerSyncCode`, and survives a reload
 *      (same token on re-reveal — mint is once-only). This is ALSO the D-239 grandfathered path:
 *      a nickname-only traveler is never locked out, they just complete their account here.
 *   3. The "Enter a code" form is GONE (D-239): entering a User Token is LOGGING IN, and the front
 *      door owns that. Switching accounts = sign out → log in. This test replaces the deleted
 *      form's coverage by pinning the deletion AND the surviving route back in.
 *   4. The /trips hub points at this card in User-Token language.
 */

const SYNC_KEY = 'tripPlannerSyncCode';
const TOUR_SEEN = 'nepal_japan_first_run_tour_seen';

async function gotoSettingsSync(page: Page) {
  await page.addInitScript((tour: string) => {
    // S352: identity is seeded ONLY on this test's FIRST navigation (sessionStorage-guarded — see
    // the identical comment in settings.spec.ts's gotoSettings). signOut() now reloads after its
    // full teardown (Ruling 3); an unconditional reseed here would resurrect the identity sign-out
    // just cleared on that very reload, masking the teardown in this harness only (no addInitScript
    // exists in a real browser).
    const FIRST_NAV = '__e2e_settings_identity_seeded__';
    if (window.sessionStorage.getItem(FIRST_NAV) === null) {
      window.sessionStorage.setItem(FIRST_NAV, '1');
      window.localStorage.setItem('tripPlannerToken', 'Powan');
      window.localStorage.setItem('tripPlannerUserName', 'Powan');
    }
    window.localStorage.setItem(tour, '1');
  }, TOUR_SEEN);
  await page.goto('/settings/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('settings-group-sync-toggle').click();
  await expect(page.getByTestId('settings-sync-card')).toBeVisible();
}

const readCode = (page: Page) => page.evaluate((k) => window.localStorage.getItem(k), SYNC_KEY);

test.describe('S338B — Your User Token card', () => {
  test('renders for a traveler; unset state shows no token, copy disabled, never-share warning', async ({
    page,
  }) => {
    await gotoSettingsSync(page);
    await expect(page.getByTestId('settings-sync-code')).toHaveText('Not set up yet');
    await expect(page.getByTestId('settings-sync-reveal')).toHaveText('Create my key');
    await expect(page.getByTestId('settings-sync-copy')).toBeDisabled();
    expect(await readCode(page)).toBeNull();

    // D-239: a User Token is NOT a Trip Token — the copy has to say so, in these words.
    const card = page.getByTestId('settings-sync-card');
    await expect(card).toContainText('Never share it');
    await expect(card).toContainText('Trip Token');
  });

  test('reveal mints a User Token once, shows it, persists it, and survives reload (also the D-239 upgrade)', async ({
    page,
  }) => {
    await gotoSettingsSync(page);
    await page.getByTestId('settings-sync-reveal').click();

    const stored = await readCode(page);
    expect(stored).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByTestId('settings-sync-code')).toHaveText(stored!);
    await expect(page.getByTestId('settings-sync-copy')).toBeEnabled();

    // Minting touches ONLY key 28 — the grandfathered traveler's identity is untouched.
    expect(await page.evaluate(() => window.localStorage.getItem('tripPlannerToken'))).toBe('Powan');

    // Reload → masked again, but re-reveal shows the SAME token (mint is once-only, D-018).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('settings-group-sync-toggle').click();
    await expect(page.getByTestId('settings-sync-code')).toHaveText('•'.repeat(24));
    await page.getByTestId('settings-sync-reveal').click();
    await expect(page.getByTestId('settings-sync-code')).toHaveText(stored!);
    expect(await readCode(page)).toBe(stored);
  });

  test('the "Enter a code" form is DELETED — logging in is the only way to enter a User Token', async ({
    page,
  }) => {
    await gotoSettingsSync(page);
    // S391: this used to assert `settings-sync-enter-input` / `-submit` had count 0.
    // Neither id exists anywhere in the tree, so both assertions were true of ANY DOM — a
    // re-added form under any other id sailed through. Anchor on the real card instead: the
    // card renders exactly two buttons (reveal + copy) and NOTHING you can type into, so any
    // re-added entry field, textarea or form is red no matter what it is called.
    const card = page.getByTestId('settings-sync-card');
    await expect(card.locator('input, textarea, form, [contenteditable="true"]')).toHaveCount(0);
    await expect(card.locator('button')).toHaveCount(2);
    // The card explains where the credential DOES get entered, so the route isn't just removed.
    await expect(card).toContainText('front door');
  });

  test('the D-205 amendment holds on /settings: qualified names only, retired names gone', async ({
    page,
  }) => {
    await gotoSettingsSync(page);
    await page.getByTestId('settings-group-trip-toggle').click();
    await expect(page.getByTestId('settings-trip-key')).toBeVisible();

    const panel = page.getByTestId('settings-panel');
    await expect(panel).toContainText('Trip Token');
    // S355: the account credential is "your key" in UI copy now ("User Token" survives only as
    // D-239's formal name for the concept, in comments). "Trip Token" is a DIFFERENT concept and
    // is NOT renamed — both terms must be present and distinct on this surface.
    await expect(panel).toContainText('Your key');
    // "Trip Key" and "Sync Code" are RETIRED names (D-205 as amended by D-239).
    await expect(panel).not.toContainText('Trip Key');
    await expect(panel).not.toContainText('Trip key');
    await expect(panel).not.toContainText('sync code');
    await expect(panel).not.toContainText('Sync code');
    // S355 RETIREMENT GUARD: "User Token" is now retired from user-visible copy too. Without this
    // line the rename has nothing behind it and the old term can silently return under a fully
    // green suite — the same guard shape that already pins "Trip Key"/"sync code" above. Scoped to
    // the settings panel, which is where 8 of the 24 renamed sites live.
    await expect(panel).not.toContainText('User Token');
  });

  // S352 REWRITE: the old version of this test pinned "Sign-out is lockout-safe
  // (D-239): key 28 and the trip registry stay on disk" — and never minted a sync code, so
  // `token-gate-use-saved` was absent before AND after for an UNRELATED reason (no code existed to
  // offer). That made it pass vacuously; it pinned nothing about key 28 itself. D-249 deliberately
  // REVERSES D-239 here: sign-out is now a full device teardown, so the User Token must NOT
  // survive on a shared device. Rewritten to actually mint a code first, so the "now cleared"
  // assertion is real.
  test('sign out → the front door asks for the User Token, AND the User Token itself is cleared (S352 supersedes D-239)', async ({
    page,
  }) => {
    await gotoSettingsSync(page);
    // Mint a REAL User Token first (Identity, defaultOpen, already has sign-out alongside it).
    await page.getByTestId('settings-sync-reveal').click();
    const minted = await readCode(page);
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);

    // S352 (D-249): sign-out is now a confirm-gated full teardown, not a bare one-click action.
    await page.getByTestId('settings-sign-out').click();
    await page.getByTestId('settings-sign-out-confirm').click();

    // The wall returns in place, and it is the two-token door (User Token only), not a name prompt.
    await expect(page.locator('[role="dialog"]')).toHaveCount(1, { timeout: 15_000 });
    // S355: the wall opens on the marketing LANDING — a CTA opens the auth card. The door then
    // opens on "Create" by default (A1/S345), so select "Log in" to reach the key field.
    await page.getByTestId('landing-cta-login').click();
    await page.getByTestId('token-gate-mode-login').click();
    await expect(page.getByTestId('token-gate-user-token')).toBeVisible();
    // The User Token (key 28, `tripPlannerSyncCode`) is now CLEARED by sign-out — this REVERSES
    // the old "stays on disk" contract (D-239). Nothing survives to offer as a saved login.
    await expect(page.getByTestId('token-gate-use-saved')).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem('tripPlannerToken'))).toBeNull();
    expect(await readCode(page)).toBeNull();
  });
});

test.describe('S255 — /trips hub pointer', () => {
  test('the hub links to the Settings User Token card', async ({ page }) => {
    await page.addInitScript((tour: string) => {
      window.localStorage.setItem('tripPlannerToken', 'Powan');
      window.localStorage.setItem('tripPlannerUserName', 'Powan');
      window.localStorage.setItem(tour, '1');
    }, TOUR_SEEN);
    await page.goto('/trips/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('trips-hub')).toBeVisible({ timeout: 15_000 });
    const link = page.getByTestId('trips-hub-sync-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /\/settings\/?$/);
    await expect(link).toContainText('your key');
  });
});
