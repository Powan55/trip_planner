import { test, expect } from './fixtures';
import type { Page, ConsoleMessage } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S190 (D-164 / D-194) — Travel Mode enter/exit affordances E2E pack.
 *
 * Rides the shared `./fixtures` default identity (a SIGNED-IN traveler) so `/travel` is reachable
 * — with no guest mode (D-241) that is the only identity that ever gets past the front door. Runs
 * at a MOBILE viewport (390×844) to prove the nav-chrome entry button is reachable WITHOUT opening
 * the hamburger.
 *
 * Coverage: entry from all four surfaces (nav button · Home hero CTA · in-trip card · arrival toast)
 * · exit restores the exact prior route · browser-Back no-trap in both directions · PWA relaunch
 * re-enter (seed flag → lands on /travel, exit works, flag cleared) · arrival toast exactly-once
 * (reload-proof) + dismiss-forever + on-trip-only · pre-trip nav entry (D-188 Day-1 preview) ·
 * ≥44px targets · axe serious/critical = 0 with the toast open · console-clean.
 *
 * On-trip is simulated with the D-075 `?today=` clock override; `2026-12-10` is a Nepal trip day.
 */

test.use({ viewport: { width: 390, height: 844 } });

const ON_TRIP = '2026-12-10';
const TRAVEL_KEY = 'nepal_japan_travel_mode';

async function goto(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'load' });
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {});
  await expect(page.locator('h1').first()).toBeVisible();
}

const navBtn = (page: Page) => page.getByTestId('navbar-travel-mode');
const root = (page: Page) => page.getByTestId('travel-mode-root');
const exitBtn = (page: Page) => page.getByTestId('travel-exit');
const toast = (page: Page) => page.getByTestId('travel-arrival-toast');

/** Assert an interactive element clears the 44px touch-target floor. */
async function expectTapTarget(page: Page, testid: string) {
  const box = await page.getByTestId(testid).boundingBox();
  expect(box, `${testid} has a layout box`).not.toBeNull();
  expect(box!.height, `${testid} height ≥ 44`).toBeGreaterThanOrEqual(44);
  expect(box!.width, `${testid} width ≥ 44`).toBeGreaterThanOrEqual(44);
}

test.describe('S190 · entry surfaces', () => {
  test('nav-chrome button enters /travel (reachable at mobile width, no hamburger)', async ({ page }) => {
    await goto(page, '/');
    // The button is visible in the top bar without opening the hamburger menu.
    await expect(navBtn(page)).toBeVisible();
    await expectTapTarget(page, 'navbar-travel-mode');

    await navBtn(page).click();
    await expect(root(page)).toBeVisible();
    // Chrome-free /travel: the navbar (with the button) is gone; the exit X is present.
    await expect(page.getByTestId('navbar')).toHaveCount(0);
    await expect(exitBtn(page)).toBeVisible();
    await expectTapTarget(page, 'travel-exit');
  });

  // S321: the always-present hero Travel Mode CTA (`hero-travel-entry`) was removed when the
  // hero collapsed to ONE state-aware action (pre-trip → Open Planner; in-trip → the on-trip
  // card's Travel Mode button, covered by the next test). Travel Mode entry pre-trip is still
  // covered by the nav-chrome button test above.

  test('in-trip card enters /travel (on-trip only)', async ({ page }) => {
    await goto(page, `/?today=${ON_TRIP}`);
    // The on-trip hero panel + its Travel Mode card only render inside the trip window.
    await expect(page.getByTestId('home-intrip-travel-card')).toBeVisible();
    await page.getByTestId('home-intrip-travel').click();
    await expect(root(page)).toBeVisible();
  });

  test('pre-trip nav entry works (D-188 Day-1 preview, no ?today)', async ({ page }) => {
    // Real clock is pre-trip; entry is a plain nav (never sets ?today/?date — D-075/D-188).
    await goto(page, '/');
    await navBtn(page).click();
    await expect(root(page)).toBeVisible();
    // Pre-trip: the date picker shows its pre-trip notice (Day-1 preview), not a crash.
    await expect(page.getByTestId('travel-pretrip-notice')).toBeVisible();
  });
});

test.describe('S190 · exit restores the prior route with no history trap', () => {
  test('exit returns to the EXACT prior in-app route', async ({ page }) => {
    await goto(page, '/nepal/');
    await navBtn(page).click();
    await expect(root(page)).toBeVisible();

    await exitBtn(page).click();
    await page.waitForURL('**/nepal/**');
    await expect(page.getByTestId('navbar')).toBeVisible(); // chrome restored
    // Flag cleared to 'seen' on exit (not active → no relaunch re-enter).
    const flag = await page.evaluate((k) => localStorage.getItem(k), TRAVEL_KEY);
    expect(flag).toBe('seen');
  });

  test('after EXIT, browser Back does NOT bounce back into /travel (no trap)', async ({ page }) => {
    await goto(page, '/nepal/');
    await navBtn(page).click();
    await expect(root(page)).toBeVisible();
    await exitBtn(page).click();
    await page.waitForURL('**/nepal/**');

    await page.goBack();
    // Replace-on-exit dropped /travel from history — Back must not land there.
    expect(page.url()).not.toContain('/travel');
  });

  test('after ENTRY, browser Back alone leaves /travel cleanly', async ({ page }) => {
    await goto(page, '/');
    await navBtn(page).click();
    await expect(root(page)).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId('navbar')).toBeVisible();
    expect(page.url()).not.toContain('/travel');
  });
});

test.describe('S190 · PWA relaunch re-enter', () => {
  test('a set flag re-enters /travel on boot; exit clears it and lands Home', async ({ page }) => {
    // Seed the gateway flag as if Travel Mode was active when the app last closed.
    await page.addInitScript((k) => localStorage.setItem(k, 'active'), TRAVEL_KEY);
    await page.goto('/', { waitUntil: 'load' });

    // Boot bounce: replace → /travel.
    await page.waitForURL('**/travel/**');
    await expect(root(page)).toBeVisible();

    // Exit after a relaunch re-enter goes Home (no stored return route) and clears the flag.
    await exitBtn(page).click();
    await page.waitForURL((url) => !url.pathname.includes('/travel'));
    const flag = await page.evaluate((k) => localStorage.getItem(k), TRAVEL_KEY);
    expect(flag).toBe('seen');
  });
});

test.describe('S351B · redirect-loop regression (signed-out visitor, stale active flag)', () => {
  test('does not brick the app in a reload loop; settles on /travel behind the front door', async ({
    page,
  }) => {
    test.setTimeout(45_000);

    // The specific gap S351 opened: `travelMode` stays 'active' from a PRIOR session (only the
    // exit X clears it — travel-exit-button.tsx's one caller; sign-out never touches the flag),
    // but the visitor is no longer signed in. Registered AFTER the fixtures' own addInitScript
    // (which seeds a signed-in identity), so this one runs second and wins on every navigation:
    // net effect is the flag active with NO identity — the exact combination nothing else in
    // this pack seeds (the only spec that ever drove /travel without a token, this file's own
    // former `guestTest`, was deleted by S351 with nothing replacing it).
    await page.addInitScript((k: string) => {
      window.localStorage.removeItem('tripPlannerToken');
      window.localStorage.removeItem('tripPlannerUserName');
      window.localStorage.setItem(k, 'active');
    }, TRAVEL_KEY);

    await goto(page, '/');

    // Boot bounce (relaunch, a client-side `router.replace` — same mechanism the signed-in
    // PWA-relaunch test above exercises): lands on /travel without a full page load.

    // Historical bug (S351B): TravelDatePicker's own `!traveler` guard fired a FULL reload
    // (`window.location.replace`) straight back to `/`, where the un-guarded relaunch bounced it
    // right back — forever, with no history entry on either hop, so Back could not escape either.
    // A `load` event here (post-settle) is unambiguous evidence that the loop fired.
    // Two other things can fire a `load` here unrelated to the loop — rule out first:
    // chunk-load-error-handler.tsx:28 (ChunkLoadError auto-reload) and
    // service-worker-registrar.tsx:51 (`controllerchange` reload when a prior controller existed).
    let reloaded = false;
    page.once('load', () => {
      reloaded = true;
    });
    await page.waitForTimeout(6_000);

    expect(reloaded, 'a `load` event after settling on /travel means the redirect loop fired').toBe(
      false,
    );
    expect(page.url()).toContain('/travel');

    // Not bricked: the front door is up (TokenGate covers /travel exactly like every other route),
    // so the visitor can recover by signing in — not a blank or looping screen.
    await expect(page.locator('[role="dialog"]')).toBeVisible();
  });
});

test.describe('S190 · arrival auto-suggest toast', () => {
  test('appears on-trip when never seen, and both actions are ≥44px', async ({ page }) => {
    await goto(page, `/?today=${ON_TRIP}`);
    await expect(toast(page)).toBeVisible();
    await expectTapTarget(page, 'travel-arrival-enter');
    await expectTapTarget(page, 'travel-arrival-dismiss');
  });

  test('does NOT appear off-trip', async ({ page }) => {
    // Pre-trip real clock (no ?today) → off-trip → the toast never shows.
    await goto(page, '/');
    await page.waitForTimeout(500);
    await expect(toast(page)).toHaveCount(0);
  });

  test('is reload-proof while undismissed, then dismiss = never again', async ({ page }) => {
    await goto(page, `/?today=${ON_TRIP}`);
    await expect(toast(page)).toBeVisible();

    // Undismissed → survives a reload (still eligible).
    await page.reload({ waitUntil: 'load' });
    await expect(toast(page)).toBeVisible();

    // Dismiss → persisted 'seen' → gone now AND after reload (exactly-once forever).
    await page.getByTestId('travel-arrival-dismiss').click();
    await expect(toast(page)).toHaveCount(0);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await expect(toast(page)).toHaveCount(0);
  });

  test('toast "Open" enters /travel', async ({ page }) => {
    await goto(page, `/?today=${ON_TRIP}`);
    await expect(toast(page)).toBeVisible();
    await page.getByTestId('travel-arrival-enter').click();
    await expect(root(page)).toBeVisible();
  });
});

test.describe('S190 · a11y + console', () => {
  test('axe: zero serious/critical with the arrival toast open', async ({ page }, testInfo) => {
    await goto(page, `/?today=${ON_TRIP}`);
    await expect(toast(page)).toBeVisible();

    // S336 settle-guard (ported S351B — this test IS the toast-open case the guard exists for,
    // yet never had it): `toBeVisible()` above does not wait for the opacity 0->1 entrance fade to
    // finish, so axe can sample it mid-fade and misread its text-white/60 subtitle as a false
    // contrast failure (rests at ~7:1 on the glass surface). Settle before scanning.
    await expect(toast(page)).toHaveCSS('opacity', '1');

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    for (const v of blocking) {
      testInfo.annotations.push({ type: `axe:${v.impact}`, description: `${v.id}: ${v.help}` });
    }
    expect(
      blocking,
      `serious/critical: ${blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')}`,
    ).toEqual([]);
  });

  test('no console errors across enter → exit', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m: ConsoleMessage) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));

    await goto(page, '/');
    await navBtn(page).click();
    await expect(root(page)).toBeVisible();
    await exitBtn(page).click();
    await page.waitForURL((url) => !url.pathname.includes('/travel'));

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
