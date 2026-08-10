import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Nav-consolidation E2E pack (slice FU-33, D-071).
 *
 * `/journal` (S153), `/safety` (S152), `/recap` (S156) were each shipped with nav
 * wiring deliberately deferred. FU-33 wires them into `lib/nav-items.ts` as
 * `primary: false` companion routes, discoverable via the command palette (desktop)
 * — while the bottom tab bar and the desktop top row stay at the original 6 "primary"
 * routes (the D-071 ≥44px-at-360px touch-target floor / no tablet overflow).
 *
 * S319: the mobile hamburger panel (formerly the companions' mobile path) was deleted
 * as part of collapsing the three mobile nav systems to one (the bottom tab bar). The
 * companion routes are therefore temporarily mobile-unreachable — S320 (the very next
 * slice) re-homes them into a tab-bar "More" list. This pack now proves: the desktop
 * palette path works, and the two constrained surfaces (tab bar + desktop row) are
 * unchanged.
 *
 * Harness notes mirror `interaction.spec.ts` (D-093): `goto`/`openPalette` are
 * duplicated locally (not exported from that file) rather than introducing a shared
 * helper module — the smallest diff that keeps this slice self-contained.
 */

const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1280, height: 900 } as const;

// Mirrors interaction.spec.ts's `goto`: ride through the one-off first-load SW reload.
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

// Mirrors interaction.spec.ts's `openPalette`: absorbs the post-hydration listener race.
async function openPalette(page: Page) {
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

test.describe('FU-33 · companion routes reachable via the command palette (desktop)', () => {
  for (const { label, url } of [
    { label: 'Journal', url: /\/journal\/?$/ },
    { label: 'Safety', url: /\/safety\/?$/ },
    { label: 'Recap', url: /\/recap\/?$/ },
  ] as const) {
    test(`searching "${label}" and pressing Enter navigates to ${label}'s route`, async ({
      page,
    }) => {
      await page.setViewportSize(DESKTOP);
      await goto(page, '/');

      await openPalette(page);
      const input = page.getByPlaceholder('Jump to a section…');
      await input.fill(label);
      await expect(page.getByRole('option', { name: new RegExp(label) }).first()).toBeVisible();
      await input.press('Enter');

      await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
      await expect(page).toHaveURL(url);
    });
  }
});

// S319: the "companion routes via the mobile hamburger panel" describe block was
// removed with the hamburger. Mobile reachability of the companions is re-established
// by S320 (tab-bar "More" list) and re-tested there.

test.describe('S319 · the mobile hamburger is gone (bottom tab bar is the sole mobile nav)', () => {
  test('no hamburger toggle or mobile nav panel exists at phone width', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await goto(page, '/');

    // The tab bar is the mobile nav.
    await expect(page.getByTestId('tab-bar')).toBeVisible();
    // The S47 hamburger toggle + its panel are deleted (not merely hidden).
    await expect(page.getByTestId('navbar-menu-toggle')).toHaveCount(0);
    await expect(page.locator('#mobile-nav-menu')).toHaveCount(0);
  });
});

test.describe('S320 · D-231 — the bottom tab bar is the 5-tab IA (Today·Plan·Map·Guides·More)', () => {
  test('the tab bar renders exactly the 5 tabs; no companion/legacy tab exists', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await goto(page, '/');

    const tabBar = page.getByTestId('tab-bar');
    await expect(tabBar).toBeVisible();

    // The 5 tabs are all present (4 shared primaries + the synthetic More tab).
    for (const slug of ['today', 'plan', 'map', 'guides', 'more']) {
      await expect(page.getByTestId(`tab-bar-${slug}`)).toBeVisible();
    }
    // Exactly 5 <li> tabs total — the Apple-HIG ≤5 ceiling (D-231).
    await expect(tabBar.locator('li')).toHaveCount(5);

    // The consolidation guard: Nepal/Japan/Flights are no longer tabs (Guides + More own
    // them now), and the companion routes never became tabs.
    for (const slug of ['nepal', 'japan', 'flights', 'journal', 'safety', 'recap']) {
      await expect(page.getByTestId(`tab-bar-${slug}`)).toHaveCount(0);
    }
  });
});

test.describe('S320 · D-231 — the /guides/ landing fronts Nepal + Japan', () => {
  test('renders both country cards with their entry points, links drill down, and axe is clean', async ({
    page,
  }) => {
    test.slow(); // SW settle on a fresh nav (D-093 pattern).
    await page.setViewportSize(PHONE);
    await goto(page, '/guides/');

    // Both country cards + their shared entry points (photography/nightlife/essentials).
    for (const country of ['nepal', 'japan'] as const) {
      await expect(page.getByTestId(`guides-country-${country}`)).toBeVisible();
      for (const topic of ['photography', 'nightlife', 'essentials'] as const) {
        await expect(page.getByTestId(`guides-${country}-${topic}`)).toBeVisible();
      }
    }

    // axe: the new landing is a11y-clean (a11y is first-class; this route is not in the
    // a11y-full-audit fixed route list, so it gets its own scan here).
    const results = await new AxeBuilder({ page }).include('main').analyze();
    const blocking = results.violations.filter((v) => v.impact !== 'minor');
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

    // An entry point drills into the country page's section anchor (D-070: pages remain).
    await page.getByTestId('guides-nepal-photography').click();
    await expect(page).toHaveURL(/\/nepal\/?#photography$/);
  });
});

test.describe('S320 · D-231 — the /more/ route re-homes the companions + sign-out', () => {
  test('renders inset groups from the shared catalog; a row navigates; sign-out returns the gate', async ({
    page,
  }) => {
    // SW-heavy: three full navigations + the first-load SW install/claim/reload settle (the
    // suite's first nav routinely nears the 30s default). Triple the budget (D-093 pattern).
    test.slow();
    await page.setViewportSize(PHONE);
    await goto(page, '/more/');

    // Inset groups (D-231), rendered from navItems − primary (not a hand list).
    for (const heading of ['Plan & prep', 'Memories', 'Account']) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
    // Catalog-sourced companion rows, incl. the two newly-homed palette-only routes
    // (Documents = /checklist/, Shared Links = /share/) and the demoted Flights.
    for (const slug of [
      'flights',
      'packing',
      'documents',
      'shared-links',
      'safety',
      'journal',
      'recap',
      'trips',
      'settings',
    ]) {
      await expect(page.getByTestId(`more-link-${slug}`)).toBeVisible();
    }

    // axe: the new page is clean (a11y is first-class for this route — real list + headings).
    const results = await new AxeBuilder({ page }).include('main').analyze();
    const blocking = results.violations.filter((v) => v.impact !== 'minor');
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);

    // A companion row navigates.
    await page.getByTestId('more-link-flights').click();
    await expect(page).toHaveURL(/\/flights\/?$/);

    // Sign-out is a real <button> and is WIRED, confirm-gated (S352, D-249): this spec proves the
    // /more/ control exists and opens its confirm. The teardown itself (signOut() + the reload
    // actually clearing data) is proven in settings.spec.ts, which gates the SHARED fixture's seed
    // rather than the harness performing the reload's own outcome — that's the honest split, since
    // `./fixtures`' addInitScript reseeds identity every navigation and editing it is a pack-wide,
    // full-net-only change (not this spec's).
    await goto(page, '/more/');
    const signOut = page.getByTestId('more-sign-out');
    await expect(signOut).toBeVisible();
    await signOut.click();
    await expect(page.getByTestId('more-sign-out-dialog')).toBeVisible();
    await expect(page.getByTestId('more-sign-out-confirm')).toBeVisible();
    await expect(page.getByTestId('more-sign-out-confirm')).toBeEnabled();
  });
});

test.describe('S320 · D-231 — the desktop top row consolidates to the 4 shared primaries', () => {
  test('navbar desktop row shows Today·Plan·Map·Guides only; consolidated routes are gone', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goto(page, '/');

    await expect(page.getByTestId('navbar')).toBeVisible();
    for (const slug of ['today', 'plan', 'map', 'guides']) {
      await expect(page.getByTestId(`navbar-link-${slug}`)).toBeVisible();
    }
    // Nepal/Japan/Flights left the top row (Guides link + the "More" dropdown carry them);
    // the companion routes were never top-row links.
    for (const slug of ['nepal', 'japan', 'flights', 'journal', 'safety', 'recap']) {
      await expect(page.getByTestId(`navbar-link-${slug}`)).toHaveCount(0);
    }
  });
});

test.describe('S363C · R10 — the navbar desktop TravelerChip sign-out is wired', () => {
  test('desktop sign-out control opens the shared confirm dialog', async ({ page }) => {
    // All three sign-out sites (navbar desktop TravelerChip, /more/ mobile row, Settings Identity
    // row) share the ONE <SignOutConfirm> component, so its dialog/teardown BEHAVIOUR is already
    // covered — settings.spec.ts proves the full confirm->teardown->reload cycle, and the
    // 'S320 · D-231' /more/ test above proves it for that call site. Only the WIRING at the
    // navbar desktop call site (TravelerChip, `hidden md:flex` — needs a >=768px viewport) had no
    // coverage at all. This mirrors the /more/ test's depth exactly: proves the control is real,
    // visible and wired to the confirm dialog; does not re-prove the shared teardown itself.
    await page.setViewportSize(DESKTOP);
    await goto(page, '/');

    const signOut = page.getByTestId('navbar-sign-out');
    await expect(signOut).toBeVisible();
    await signOut.click();
    await expect(page.getByTestId('navbar-sign-out-dialog')).toBeVisible();
    await expect(page.getByTestId('navbar-sign-out-confirm')).toBeVisible();
    await expect(page.getByTestId('navbar-sign-out-confirm')).toBeEnabled();
  });
});
