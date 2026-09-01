import { test, expect, isConciergeWired } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S252 — conditional nav + N×J route gating for custom trips (Plan D10, D-071 LOCKED).
 *
 * On a CUSTOM (non-default-pack) trip, the N×J-specific surfaces (Nepal/Japan/Flights)
 * disappear from every nav surface (navbar desktop row, bottom tab bar, command
 * palette; the mobile hamburger was removed in S319). S320 (D-231): the tab bar is the
 * 5-tab custom set Today·Plan·Map·Journal·More (Guides is defaultTripOnly → dropped, its
 * seat refilled by the promoted Journal; Packing/Trips fell to the `/more/` page), and a
 * direct visit to a gated route shows an honest empty-state card (no redirect — static
 * export). The default trip's nav is proven unchanged (spot-check only; the full net is
 * `nav-consolidation.spec.ts`).
 *
 * Seeding a custom trip is a plain localStorage write (`tripPlannerActiveTrip` = any
 * non-default id) — `isDefaultTrip()` only compares the pointer, so no Settings-UI
 * round-trip is needed (mirrors the traveler-stance tests in
 * `multi-trip-isolation.spec.ts`).
 */

const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1280, height: 900 } as const;
const CUSTOM_TRIP_ID = '11111111-2222-4333-8444-555566667777';

async function seedCustomTrip(page: Page) {
  await page.addInitScript(
    ({ id }: { id: string }) => {
      window.localStorage.setItem('tripPlannerActiveTrip', id);
      window.localStorage.setItem(
        'tripPlannerKnownTrips',
        JSON.stringify([{ id, name: 'Bali Getaway', joinedAt: 1 }]),
      );
    },
    { id: CUSTOM_TRIP_ID },
  );
}

async function goto(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'load' });
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {
      /* no SW / already stable — proceed */
    });
}

async function openPalette(page: Page) {
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

test.describe('S252 · custom trip — nav gating', () => {
  test('navbar desktop row shows the custom four, brand is the trip name, N×J links are gone', async ({
    page,
  }) => {
    await seedCustomTrip(page);
    await page.setViewportSize(DESKTOP);
    await goto(page, '/');

    await expect(page.getByTestId('navbar-brand')).toHaveText('Bali Getaway');

    // S320 (D-231): custom-trip primaries = Today · Plan · Map · Journal (Guides is
    // defaultTripOnly → dropped; the vacated seat is refilled by the promoted Journal).
    for (const slug of ['today', 'plan', 'map', 'journal']) {
      await expect(page.getByTestId(`navbar-link-${slug}`)).toBeVisible();
    }
    // N×J-specific routes are gone; Guides too; Packing/Trips fell to the "More" dropdown.
    for (const slug of ['nepal', 'japan', 'flights', 'guides', 'packing', 'trips']) {
      await expect(page.getByTestId(`navbar-link-${slug}`)).toHaveCount(0);
    }
    // The concierge assertion that used to live here moved to its own test below — it is
    // BUILD-dependent (see that test), and folding it in here would have made this
    // build-independent nav proof skip on an unwired build.
  });

  /**
   * ⛔ THIS ASSERTION WAS INVERTED. It read `toHaveCount(0)` under this comment:
   *   "S258: the concierge speaks a hardcoded N×J persona, so it is client-side gated to
   *    the default pack — absent on a custom trip."
   *
   * ✅ THAT GATE WAS LIFTED ON 2026-08-09 and the rationale no longer holds. The owner deployed
   * `trip-planner-concierge` v1.8.0 (Version ID `157ed2e0-2cfb-4044-af3e-ea80bc1b4ce6`), whose
   * system prompt is TRIP-AWARE, so `CONCIERGE_ON_CUSTOM_TRIPS` in `lib/concierge-config.ts` is
   * now `true` and `isConciergeAllowedForActiveTrip()` no longer consults `isDefaultTrip()`
   * (D-265: one rule, both mounts). The concierge is SUPPOSED to appear on a custom trip.
   * Do NOT "restore" the old assertion — re-closing the gate means rolling the Worker back, and
   * then this test, `lib/__tests__/travel-concierge-gating.test.ts`, and the constant move together.
   *
   * 🔴 AND THE OLD ASSERTION WAS VACUOUS EITHER WAY — the reason it survived the flip unnoticed.
   * `ConciergeChat` renders null everywhere unless `NEXT_PUBLIC_CONCIERGE_URL` was baked in at
   * BUILD time (`isConciergeConfigured()`), and the standing net serves the deploy-faithful
   * unwired `out/`. So `toHaveCount(0)` passed there for a reason that had nothing to do with the
   * trip gate: the feature was simply off. It certified the opposite of the intended behaviour and
   * could not tell the difference.
   *
   * So this test PROBES which build it met first — the same enabled-probe pattern as
   * "S252 · default trip — nav unchanged" below and `travel-day-map.spec.ts`'s S343 test — reading
   * the reference mount on the DEFAULT trip, where presence depends only on the build. Then:
   *   wired build   → assert the trigger is PRESENT on the custom trip (the real proof), and
   *   unwired build → SKIP WITH A REASON, never a silent pass.
   * Skip rather than fail because the standing net legitimately runs the unwired `out/` and a hard
   * failure there would be a false red about a build config, not about this behaviour; a skip is
   * visible in the run summary, so an unconfigured build can never report green on this assertion.
   */
  test('the concierge IS present on a custom trip: persona gate lifted 2026-08-09 (Worker v1.8.0)', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);

    // Reference read on the DEFAULT trip (no custom seed yet): is the concierge configured in the
    // build under test at all? Nothing a test can do changes this — it is baked in at build time.
    //
    // 15s, not the shared 5s default: a FALSE "not wired" here would skip the assertion below on a
    // build that actually has it — the same silent-non-coverage this test exists to remove, one
    // level up. 5s was measured too tight on a cold first navigation in this sandbox (the SW wait
    // in `goto` alone spent 15s on the first test of a session). An unwired build pays this 15s
    // once, hence the raised test timeout.
    test.setTimeout(60_000);
    await goto(page, '/');
    const wired = await isConciergeWired(page, 15_000);
    test.skip(
      !wired,
      'UNWIRED build: NEXT_PUBLIC_CONCIERGE_URL was not baked in, so ConciergeChat renders null on ' +
        'EVERY trip and a presence/absence assertion here would prove nothing about the trip gate. ' +
        'Rebuild with NEXT_PUBLIC_CONCIERGE_URL=https://concierge.test npm run build to run it.',
    );

    // Now switch to the custom trip. `addInitScript` applies from the NEXT navigation on.
    await seedCustomTrip(page);
    await goto(page, '/');
    // Guard the guard: prove the custom trip is really the active one, so a seed that silently
    // failed would show up as a red here instead of turning the assertion below into "the
    // concierge is present on the default trip" (which the probe already established).
    await expect(page.getByTestId('navbar-brand')).toHaveText('Bali Getaway');

    // The actual claim. Fixtures seed a signed-in traveler, so the traveler gate is satisfied and
    // the trip gate is the only one left under test.
    await expect(page.getByTestId('concierge-trigger')).toBeVisible();
  });

  // S319: the "mobile hamburger panel drops N×J" test was removed with the hamburger.
  // Custom-trip mobile gating is now proven on the bottom tab bar (next test); the
  // companion routes' mobile home is re-established by S320.

  test('the bottom tab bar is the 5-tab custom set: Today/Plan/Map/Journal/More (D-231)', async ({
    page,
  }) => {
    await seedCustomTrip(page);
    await page.setViewportSize(PHONE);
    await goto(page, '/');

    const tabBar = page.getByTestId('tab-bar');
    await expect(tabBar).toBeVisible();

    for (const slug of ['today', 'plan', 'map', 'journal', 'more']) {
      await expect(page.getByTestId(`tab-bar-${slug}`)).toBeVisible();
    }
    await expect(tabBar.locator('li')).toHaveCount(5);

    // N×J routes + Guides gone; Packing/Trips fell to the More page (no longer tabs).
    for (const slug of ['nepal', 'japan', 'flights', 'guides', 'packing', 'trips']) {
      await expect(page.getByTestId(`tab-bar-${slug}`)).toHaveCount(0);
    }

    // Axe pass on the gated tab bar (S252 evidence requirement).
    const results = await new AxeBuilder({ page })
      .include('[data-testid="tab-bar"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const relevant = results.violations.filter((v) => v.impact !== 'minor');
    expect(relevant, JSON.stringify(relevant, null, 2)).toEqual([]);
  });

  test('the command palette lacks Nepal/Japan/Flights (and their sub-anchors) on a custom trip', async ({
    page,
  }) => {
    await seedCustomTrip(page);
    await page.setViewportSize(DESKTOP);
    await goto(page, '/');

    await openPalette(page);
    for (const label of ['Nepal', 'Japan', 'Flights', 'Photography Guide', 'Nightlife & Bars']) {
      await expect(page.getByRole('option', { name: new RegExp(`^${label}$`) })).toHaveCount(0);
    }
    // A non-gated companion is still present.
    await expect(page.getByRole('option', { name: 'Trips' })).toBeVisible();
  });

  test('a direct visit to /nepal/ shows the empty-state card with working links, no redirect', async ({
    page,
  }) => {
    await seedCustomTrip(page);
    await goto(page, '/nepal/');

    await expect(page).toHaveURL(/\/nepal\/?$/);
    const card = page.getByTestId('default-trip-only-empty-state');
    await expect(card).toBeVisible();
    await expect(card).toContainText('This page belongs to the Nepal × Japan trip');

    // S346: the primary action switches back to the default trip and reloads into the guide.
    await expect(page.getByTestId('default-trip-only-switch')).toBeVisible();

    await page.getByTestId('default-trip-only-trips-link').click();
    await expect(page).toHaveURL(/\/trips\/?$/);
  });
});

test.describe('custom trip: expense split roster is derived, not the hardcoded N×J trio', () => {
  test('the split payer chips offer the signed-in traveler (self) and NOT Alina/Rhea/Milo', async ({
    page,
  }) => {
    // Sign in a traveler on a fresh custom trip (no expenses yet) ⇒ the derived roster is [self].
    await seedCustomTrip(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('tripPlannerToken', 'Kenji');
      window.localStorage.setItem('tripPlannerUserName', 'Kenji');
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(DESKTOP);
    await goto(page, '/plan/');

    // Open the fast-log dialog and expand the split panel.
    await expect(page.getByTestId('budget-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('budget-view-tab-expenses').click(); // S322: log trigger is on the Expenses view
    await page.getByTestId('expense-log-open').click();
    await expect(page.getByTestId('expense-dialog')).toBeVisible();
    await page.getByTestId('expense-split-toggle').click();
    await expect(page.getByTestId('expense-split-panel')).toBeVisible();

    // Self is offered as the payer; the hardcoded Nepal×Japan roster is gone.
    await expect(page.getByTestId('expense-payer-Kenji')).toBeVisible();
    await expect(page.getByTestId('expense-split-member-Kenji')).toBeVisible();
    for (const name of ['Alina', 'Rhea', 'Milo']) {
      await expect(page.getByTestId(`expense-payer-${name}`)).toHaveCount(0);
      await expect(page.getByTestId(`expense-split-member-${name}`)).toHaveCount(0);
    }
  });
});

test.describe('S252 · default trip — nav unchanged', () => {
  test('navbar top row + tab bar show the 4 shared primaries (S320: consolidated IA)', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await goto(page, '/');
    for (const slug of ['today', 'plan', 'map', 'guides']) {
      await expect(page.getByTestId(`navbar-link-${slug}`)).toBeVisible();
    }
    await expect(page.getByTestId('navbar-brand')).toHaveText('Nepal × Japan');

    // S258: concierge present on the default pack, but ONLY in a build where the
    // Worker URL was configured (NEXT_PUBLIC_CONCIERGE_URL at build time). The standing net
    // serves the deploy-faithful out/ with it UNSET, so the trigger is legitimately absent
    // there; asserting visibility unconditionally made the net env-dependent (failed at the
    // 2026-07-23 closing checkpoint). Assert the positive gate only on a concierge-enabled build.
    //
    // 2026-08-09: the companion claim this comment used to make — "the absent-on-custom assertion
    // elsewhere in this file holds on both builds" — is GONE with the gate it described. The
    // custom-trip concierge test above now asserts PRESENCE and skips loudly on an unwired build.
    // This branch stays a soft `if` only because it is a spot-check riding on a nav test; the
    // build-dependent behaviour has its own dedicated, skip-reporting test above.
    if (await isConciergeWired(page)) {
      await expect(page.getByTestId('concierge-trigger')).toBeVisible();
    }

    await page.setViewportSize(PHONE);
    await goto(page, '/');
    const tabBar = page.getByTestId('tab-bar');
    await expect(tabBar.locator('li')).toHaveCount(5);
    for (const slug of ['today', 'plan', 'map', 'guides', 'more']) {
      await expect(page.getByTestId(`tab-bar-${slug}`)).toBeVisible();
    }

    // S319: the mobile hamburger is gone — no toggle, no mobile panel links.
    await expect(page.getByTestId('navbar-menu-toggle')).toHaveCount(0);
  });
});
