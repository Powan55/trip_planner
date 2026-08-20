import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Interaction-matrix E2E pack (slice S83, D-092) — E2E wave 3.
 *
 * Encodes the v2 interaction surface as permanent Playwright specs against the
 * served static `out/` build (D-093): the destination-guide filters / search /
 * sort / detail sheet, the custom-add flow (with the D-074 Maps-href BYTE
 * check + the confirm-disabled-until-title gate), the quick-add FAB → host
 * seam, the bottom-tab-bar + navbar route navigation, the ⌘K/Ctrl+K command
 * palette, and the legacy v1 hash redirects.
 *
 * ── Harness notes (read before touching waits) ──────────────────────────────
 *
 * 1. Signed-in bypass + no networkidle. `test`/`expect` come from `./fixtures`
 *    (seeds `tripPlannerToken` via addInitScript so the Trip Token wall
 *    never opens — mirror of the S80-S82 specs). The app ships a live countdown
 *    tick + a service worker, so the network never idles: every navigation uses
 *    `waitUntil: 'load'` (the default), NEVER `networkidle` (D-093 — it times
 *    out here).
 *
 * 2. `ssr:false` guide islands. `/nepal/` mounts its guide (`NepalSection` →
 *    `RecommendationSection`) via `next/dynamic({ ssr:false, loading: <Section
 *    Skeleton/> })` (app/nepal/page.tsx). So on first paint the DOM holds the
 *    skeleton, not the guide — every guide spec first waits for a real
 *    `guide-*` testid to attach (`toBeVisible`, which auto-retries) before
 *    interacting. The guide's own cards, chips and empty-state are the wave-3
 *    target surface (docs/test-ids.md).
 *
 * 3. Real guide data (lib/nepal-data.ts) is the source of the stable ids/labels
 *    asserted here: `na1` = "Boudhanath Stupa" (category Temple, city
 *    Kathmandu), `na9` = "Shivapuri National Park" (category Nature), `nf1` =
 *    "Bhojan Griha" (category Food). The Nepal set spans >1 city (Kathmandu,
 *    Lalitpur, …) so `cities.length > 2` holds and the `guide-filter-city-*`
 *    chips DO render (docs/test-ids.md reveal condition). Category chip
 *    values are the lowercased category ("Temple" → `guide-filter-category-
 *    temple`, "All" → `guide-filter-category-all`).
 *
 * 4. Custom-add (D-074). The custom dialog is reached the way a real phone user
 *    reaches it: the quick-add FAB (`components/quick-add-fab.tsx`, `md:hidden`)
 *    dispatches `quickadd:open`, which the global `QuickAddHost`
 *    (components/quick-add-host.tsx, mounted in layout) turns into
 *    `AddToItineraryDialog mode="custom"`. To exercise the FAB we set a phone
 *    viewport (the FAB is `md:hidden`; md = 768px, so 390px reveals it). The
 *    dialog is portaled to document.body (docs/test-ids.md), so the
 *    `add-item-*` ids resolve regardless of the trigger's DOM position.
 *    S357C: these specs host on `FAB_ROUTE` (Home), not `/plan/` — the FAB is
 *    route-suppressed on the planner now. See the `FAB_ROUTE` docblock below.
 */

const BOUDHA_ID = 'na1'; // "Boudhanath Stupa", category Temple, city Kathmandu
const SHIVAPURI_ID = 'na9'; // "Shivapuri National Park", category Nature
const BHOJAN_ID = 'nf1'; // "Bhojan Griha", category Food

// A phone viewport that reveals the `md:hidden` mobile chrome (tab bar + FAB).
// 390×844 = iPhone 12/13/14 logical size; well below Tailwind's md (768px).
const PHONE = { width: 390, height: 844 } as const;

/**
 * The route these FAB specs host themselves on (S357C).
 *
 * The quick-add FAB is route-SUPPRESSED (returns null → absent from the DOM) under `/travel`
 * (D-164) and, since S357C, under `/plan` — which now has its own always-visible sticky
 * composer, so a FAB there would be a duplicate add affordance. These specs used `/plan/`
 * purely as a convenient host for an app-wide component; Home is the equivalent host where
 * the FAB legitimately renders. `e2e/travel-route.spec.ts` ("Home … shows navbar, footer, tab
 * bar, and FAB again") independently asserts the FAB is VISIBLE on `/` at a phone viewport,
 * so this host choice is itself covered by a spec this slice does not touch.
 *
 * ⚠️ Do NOT move these back to `/plan/`. The FAB is absent there, and several of the
 * assertions below (`toBeHidden`, `toHaveCount(0)`) PASS for an absent element — so a
 * re-homing to `/plan/` would leave this whole describe green while testing nothing.
 */
const FAB_ROUTE = '/';

/**
 * Navigate and settle past the FIRST-LOAD service-worker reload.
 *
 * The served `out/` is a production build, so the SW registrar
 * (components/service-worker-registrar.tsx) registers, and on first
 * registration clients.claim() fires a one-off `controllerchange` that the
 * registrar answers with a single `location.reload()` (D-073). In a fresh
 * Playwright context (every test gets one) that reload lands ~immediately after
 * first paint — and if a spec starts interacting before it flushes, the reload
 * detaches the tree / destroys the execution context mid-action (seen as
 * "element detached, retrying" or "Execution context was destroyed"). This is
 * real app behaviour, not a spec bug, but the spec must ride through it.
 *
 * So after `goto` we wait (via `page.waitForFunction`, which re-evaluates on the
 * post-reload context instead of throwing) for the SW to become the controller —
 * by which point the first-load reload has already happened. Subsequent
 * navigations in the same context don't reload (the SW already controls), so
 * this is a no-op cost after the first. Uses `waitUntil:'load'` (never
 * networkidle — D-093).
 */
async function goto(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'load' });
  // Ride through the one-off first-load SW reload before any interaction. If the
  // SW never registers (defensive), the timeout simply expires and we proceed —
  // so this can only ADD stability, never falsely fail a non-SW environment.
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

/**
 * Wait for the real Nepal guide island to replace its loading skeleton AND for
 * its whileInView card reveals to finish streaming in. The guide lazy-mounts via
 * `dynamic({ssr:false})` behind a SectionSkeleton, and each of its ~27 cards
 * replays a `viewport:{once:true}` reveal on mount; interacting while that
 * background churn is still running lets Playwright's action re-resolve against a
 * briefly re-rendering ancestor. Waiting for the LAST card (na20) to attach
 * quiets the guide so filter/sort/detail interactions are stable.
 */
async function waitForGuide(page: Page) {
  await expect(page.getByTestId('guide-search-input')).toBeVisible();
  await expect(page.getByTestId('guide-card-na20')).toBeAttached();
}

/**
 * S322G — the guide facets (sort + city + Saved/Planned + category chips) moved from a
 * permanent stack above the grid into ONE "Filters · n" sheet. Every chip testid is
 * unchanged; it just now lives inside the sheet, so specs open the sheet first before
 * asserting on / clicking a chip. Search stays pinned above the grid (not in the sheet).
 */
async function openFilters(page: Page) {
  await page.getByTestId('guide-filters-trigger').click();
  await expect(page.getByTestId('guide-filters-sheet')).toBeVisible();
}

/** Close the filters sheet via Escape (exercises the D-021 Esc contract). */
async function closeFilters(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('guide-filters-sheet')).toHaveCount(0);
}

/**
 * Open the ⌘K/Ctrl+K command palette, tolerating the post-hydration listener
 * race. The global keydown listener is attached in a `useEffect`
 * (command-palette.tsx) that runs AFTER hydration; under the loaded single-worker
 * harness a Ctrl+K pressed too early can land before the listener exists and is
 * simply lost (the palette is mounted but not yet listening). We re-press until
 * the dialog appears — this doesn't mask a bug: the palette genuinely opens once
 * its effect has run; we're only absorbing the hydration-timing jitter.
 */
async function openPalette(page: Page) {
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

test.describe('S83 · guide filters + search + sort (RecommendationSection, /nepal/)', () => {
  test('category chip filters the results grid to only that category', async ({ page }) => {
    await goto(page, '/nepal/');
    await waitForGuide(page);

    // "All" is active initially: both a Temple card and a Nature card are present
    // (grid is content-first; the facets live behind the "Filters" sheet — S322G).
    await expect(page.getByTestId(`guide-card-${BOUDHA_ID}`)).toBeVisible();
    await expect(page.getByTestId(`guide-card-${SHIVAPURI_ID}`)).toBeVisible();

    // Open the filters sheet, then filter to Temple → the Temple card stays, the
    // Nature card is filtered out (cards under the sheet stay in the DOM).
    await openFilters(page);
    await page.getByTestId('guide-filter-category-temple').click();
    await expect(page.getByTestId('guide-filter-category-temple')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId(`guide-card-${BOUDHA_ID}`)).toBeVisible();
    await expect(page.getByTestId(`guide-card-${SHIVAPURI_ID}`)).toHaveCount(0);

    // Back to All → the Nature card returns.
    await page.getByTestId('guide-filter-category-all').click();
    await expect(page.getByTestId(`guide-card-${SHIVAPURI_ID}`)).toBeVisible();
  });

  test('city chips render (cities.length > 2) and filter to that city', async ({ page }) => {
    await goto(page, '/nepal/');
    await waitForGuide(page);

    // The Nepal set spans more than one city, so the city-chip row renders inside
    // the filters sheet (S322G).
    await openFilters(page);
    await expect(page.getByTestId('guide-filter-city-all')).toBeVisible();
    await expect(page.getByTestId('guide-filter-city-kathmandu')).toBeVisible();
    // Patan Durbar Square (na5) is in Lalitpur — its chip exists too.
    await expect(page.getByTestId('guide-filter-city-lalitpur')).toBeVisible();

    // Filter to Lalitpur: na5 (Lalitpur) stays; na1 (Kathmandu) is filtered out.
    await page.getByTestId('guide-filter-city-lalitpur').click();
    await expect(page.getByTestId('guide-filter-city-lalitpur')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('guide-card-na5')).toBeVisible();
    await expect(page.getByTestId(`guide-card-${BOUDHA_ID}`)).toHaveCount(0);
  });

  test('search narrows results by name; a no-match query shows the empty state + resets', async ({
    page,
  }) => {
    await goto(page, '/nepal/');
    await waitForGuide(page);

    // Typing a distinctive name filters to that card and hides an unrelated one.
    await page.getByTestId('guide-search-input').fill('Boudhanath');
    await expect(page.getByTestId(`guide-card-${BOUDHA_ID}`)).toBeVisible();
    await expect(page.getByTestId(`guide-card-${BHOJAN_ID}`)).toHaveCount(0);

    // A query that matches nothing swaps the grid for the empty-state (docs/test-ids.md).
    await page.getByTestId('guide-search-input').fill('zzzznotarealplacezzzz');
    await expect(page.getByTestId('guide-empty-state')).toBeVisible();
    await expect(page.getByTestId('guide-results')).toHaveCount(0);

    // The empty-state's "Clear filters" button resets search → results return.
    await page.getByTestId('guide-empty-state').getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByTestId('guide-results')).toBeVisible();
    await expect(page.getByTestId(`guide-card-${BOUDHA_ID}`)).toBeVisible();
  });

  test('sort by Name (A–Z) reorders the results grid alphabetically', async ({ page }) => {
    await goto(page, '/nepal/');
    await waitForGuide(page);

    // Constrain to a single, small category (Food) so the ordering is easy to
    // assert deterministically by the cards' rendered <h3> names. Category + sort
    // both live in the filters sheet now (S322G); apply them, then close it.
    await openFilters(page);
    await page.getByTestId('guide-filter-category-food').click();
    await page.getByTestId('guide-sort-select').selectOption('name');
    await closeFilters(page);

    // Read the visible card titles in DOM order and confirm they are sorted
    // ascending (localeCompare) — the exact contract of the 'name' sort branch.
    // (S110-FIX F5: the card title is now an <h3>, was <h4> — heading-order fix. The
    // assertion below is unchanged; only this locator tracks the intentional level change.)
    // (V6-10: the nesting INVERTED — `guide-card-*` is now the button INSIDE the <h3>,
    // not a wrapper around it, so the trailing ` h3` matched nothing. The button's text
    // content is exactly `item.name`, so it is now the title locator itself.)
    const titles = await page
      .locator('[data-testid="guide-results"] [data-testid^="guide-card-"]')
      .allTextContents();
    expect(titles.length).toBeGreaterThan(1);
    const sorted = [...titles].sort((a, b) => a.localeCompare(b));
    expect(titles).toEqual(sorted);
  });
});

test.describe('S83 · place detail sheet (PlaceDetailSheet, opened from a guide card)', () => {
  test('a guide card opens the detail sheet with the place name + close control', async ({
    page,
  }) => {
    await goto(page, '/nepal/');
    await waitForGuide(page); // includes the na20 "guide fully streamed" settle

    await page.getByTestId(`guide-card-${BOUDHA_ID}`).click();
    const sheet = page.getByTestId('place-detail-sheet');
    await expect(sheet).toBeVisible();
    // The sheet's title <h3> is the place name (source-linked add affordance present).
    await expect(sheet.getByRole('heading', { name: 'Boudhanath Stupa' })).toBeVisible();
    await expect(page.getByTestId('place-detail-add-to-plan')).toBeVisible();
    // The X close control is present with its accessible name (docs/test-ids.md).
    const closeBtn = page.getByTestId('place-detail-close');
    await expect(closeBtn).toBeVisible();
    await expect(closeBtn).toHaveAttribute('aria-label', 'Close details');

    await closeBtn.click();
    await expect(page.getByTestId('place-detail-sheet')).toHaveCount(0);
  });

  test('Escape closes the detail sheet', async ({ page }) => {
    await goto(page, '/nepal/');
    await waitForGuide(page);

    await page.getByTestId(`guide-card-${SHIVAPURI_ID}`).click();
    await expect(page.getByTestId('place-detail-sheet')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('place-detail-sheet')).toHaveCount(0);
  });
});

test.describe('S83 · custom-add flow — D-074 Maps href byte-check + confirm gate', () => {
  test('FAB → host opens the custom dialog; Maps link + confirm gate honor Title exactly', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await goto(page, FAB_ROUTE);

    // The phone-only quick-add FAB is present at this breakpoint.
    const fab = page.getByTestId('quick-add-fab');
    await expect(fab).toBeVisible();
    await fab.click();

    // QuickAddHost turns the emitted event into the custom-mode dialog (portal).
    const dialog = page.getByTestId('add-item-dialog');
    await expect(dialog).toBeVisible();

    // Custom mode reveals the editable Title/Location inputs (docs/test-ids.md reveal cond).
    const title = page.getByTestId('add-item-title-input');
    const location = page.getByTestId('add-item-location-input');
    await expect(title).toBeVisible();
    await expect(location).toBeVisible();

    // Title empty → the Maps affordance is the DISABLED <span> (no href,
    // aria-disabled) and the confirm button is disabled (D-074).
    const mapsLink = page.getByTestId('add-item-maps-link');
    await expect(mapsLink).toHaveAttribute('aria-disabled', 'true');
    await expect(mapsLink).not.toHaveAttribute('href', /.*/);
    await expect(page.getByTestId('add-item-confirm')).toBeDisabled();

    // Enter a known Title + Location → the href must be the EXACT D-074 string
    // for `<Title> <Location>`, URI-encoded, and the confirm becomes enabled.
    await title.fill('Ramen Nagi');
    await location.fill('Shinjuku');

    const expectedHref =
      'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent('Ramen Nagi Shinjuku');
    // Sanity-pin the literal so a future refactor of the scheme is caught here too.
    expect(expectedHref).toBe(
      'https://www.google.com/maps/search/?api=1&query=Ramen%20Nagi%20Shinjuku',
    );

    const enabledLink = page.getByTestId('add-item-maps-link');
    await expect(enabledLink).toHaveAttribute('href', expectedHref);
    await expect(enabledLink).toHaveAttribute('target', '_blank');
    await expect(page.getByTestId('add-item-confirm')).toBeEnabled();
  });

  test('with only a Title (no Location) the Maps href encodes just the Title', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await goto(page, FAB_ROUTE);

    await page.getByTestId('quick-add-fab').click();
    await expect(page.getByTestId('add-item-dialog')).toBeVisible();

    await page.getByTestId('add-item-title-input').fill('Blue Bottle Coffee');

    const expectedHref =
      'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent('Blue Bottle Coffee');
    expect(expectedHref).toBe(
      'https://www.google.com/maps/search/?api=1&query=Blue%20Bottle%20Coffee',
    );
    await expect(page.getByTestId('add-item-maps-link')).toHaveAttribute('href', expectedHref);
    await expect(page.getByTestId('add-item-confirm')).toBeEnabled();
  });

  test('the custom dialog closes on Escape', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await goto(page, FAB_ROUTE);

    await page.getByTestId('quick-add-fab').click();
    await expect(page.getByTestId('add-item-dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('add-item-dialog')).toHaveCount(0);
  });
});

test.describe('S83 · quick-add FAB seam (components/quick-add-fab.tsx)', () => {
  test('the FAB is phone-only (md:hidden) and hides while a dialog is open', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await goto(page, FAB_ROUTE);

    const fab = page.getByTestId('quick-add-fab');
    await expect(fab).toBeVisible();

    // Opening the custom dialog sets body[data-dialog-open]='1'; the FAB observes
    // that and unmounts itself (seam 2) so it never floats over the scrim.
    await fab.click();
    await expect(page.getByTestId('add-item-dialog')).toBeVisible();
    await expect(page.getByTestId('quick-add-fab')).toHaveCount(0);

    // Closing the dialog restores the FAB.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('add-item-dialog')).toHaveCount(0);
    await expect(page.getByTestId('quick-add-fab')).toBeVisible();
  });

  /**
   * 🔴 S357C — this is the `md:hidden` BREAKPOINT check, and it is deliberately NOT a bare
   * `toBeHidden()`. Do not "simplify" it back.
   *
   * It previously ran on `/plan/` and asserted only `toBeHidden()`. Playwright's
   * `toBeHidden()` ALSO PASSES FOR AN ELEMENT THAT IS NOT IN THE DOM AT ALL — so the moment
   * S357C route-suppressed the FAB on `/plan/`, that assertion would have been satisfied by
   * the SUPPRESSION, and the breakpoint this test exists to guard would have stopped being
   * exercised on any route: green, and measuring nothing (the D-261 corollary — never let an
   * assertion decay into a tautology).
   *
   * The repair has two halves, and both are load-bearing:
   *   1. host it on a route where the FAB genuinely RENDERS (`FAB_ROUTE`), so the breakpoint
   *      is the only thing that can hide it; and
   *   2. assert presence and invisibility SEPARATELY, so neither can be satisfied by absence.
   * `toBeAttached()` fails if the route suppressed it. `toHaveCSS('display','none')` fails if
   * the element is missing (it must resolve one to read computed style) AND fails if
   * `md:hidden` stopped applying. Verified by mutation in both directions (S357C).
   */
  test('the FAB is in the DOM but CSS-hidden at desktop width (md:hidden breakpoint)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await goto(page, FAB_ROUTE);

    const fab = page.getByTestId('quick-add-fab');
    // Present: this route does not route-suppress the FAB, so CSS is what we are measuring.
    await expect(fab).toBeAttached();
    // `md:hidden` → display:none at >=768px.
    await expect(fab).toHaveCSS('display', 'none');
  });

  /**
   * S357C — the new behaviour: `/plan/` route-suppresses the FAB, because the S357A sticky
   * composer is the add affordance there and a FAB would be a duplicate.
   *
   * Written as a DIFFERENTIAL in one test, at the PHONE viewport, on purpose. A bare
   * `toHaveCount(0)` on `/plan/` would also pass if the testid were renamed, if the FAB were
   * deleted outright, or if the harness never loaded the page — the same absence-passes trap
   * this describe just repaired. Asserting the FAB is really VISIBLE on Home at the SAME
   * viewport first means the zero-count below can only be the route guard, never the
   * breakpoint and never a broken harness. (Same shape `e2e/travel-route.spec.ts` uses to
   * prove /travel suppression both ways.)
   */
  test('the FAB is route-suppressed on /plan/ (the S357A composer owns adding there)', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);

    await goto(page, FAB_ROUTE);
    await expect(page.getByTestId('quick-add-fab')).toBeVisible();

    await goto(page, '/plan/');
    await expect(page.getByTestId('quick-add-fab')).toHaveCount(0);
  });
});

test.describe('S83 · navigation — bottom tab bar (phone) + navbar (desktop)', () => {
  test('tab-bar tabs navigate between routes and reflect aria-current', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await goto(page, '/');

    const tabBar = page.getByTestId('tab-bar');
    await expect(tabBar).toBeVisible();

    // S320 (D-231): the 5-tab IA — Today · Plan · Map · Guides · More. Today tab is current on '/'.
    await expect(page.getByTestId('tab-bar-today')).toHaveAttribute('aria-current', 'page');

    // Tap Guides → route changes to /guides/ and that tab becomes current.
    await page.getByTestId('tab-bar-guides').click();
    await expect(page).toHaveURL(/\/guides\/?$/);
    await expect(page.getByTestId('tab-bar-guides')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('tab-bar-today')).not.toHaveAttribute('aria-current', 'page');

    // Tap Plan → /plan/.
    await page.getByTestId('tab-bar-plan').click();
    await expect(page).toHaveURL(/\/plan\/?$/);
    await expect(page.getByTestId('tab-bar-plan')).toHaveAttribute('aria-current', 'page');

    // Tap More → /more/ (the synthetic 5th tab).
    await page.getByTestId('tab-bar-more').click();
    await expect(page).toHaveURL(/\/more\/?$/);
    await expect(page.getByTestId('tab-bar-more')).toHaveAttribute('aria-current', 'page');
  });

  test('desktop navbar links navigate between routes and reflect aria-current', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await goto(page, '/');

    await expect(page.getByTestId('navbar')).toBeVisible();
    // S320 (D-231): desktop top row consolidated to Today · Plan · Map · Guides.
    await expect(page.getByTestId('navbar-link-today')).toHaveAttribute('aria-current', 'page');

    await page.getByTestId('navbar-link-guides').click();
    await expect(page).toHaveURL(/\/guides\/?$/);
    await expect(page.getByTestId('navbar-link-guides')).toHaveAttribute('aria-current', 'page');

    await page.getByTestId('navbar-link-map').click();
    await expect(page).toHaveURL(/\/map\/?$/);
    await expect(page.getByTestId('navbar-link-map')).toHaveAttribute('aria-current', 'page');
  });

  // S319: the mobile hamburger was deleted — the bottom tab bar is the sole mobile
  // nav. Retargeted from the old "hamburger opens the panel and its links navigate".
  test('mobile nav is the bottom tab bar (no hamburger); a tab navigates', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await goto(page, '/');

    // The S47 hamburger toggle is gone (deleted, not hidden).
    await expect(page.getByTestId('navbar-menu-toggle')).toHaveCount(0);

    // The bottom tab bar is the mobile nav, and its tabs navigate. S320 (D-231): Nepal is
    // no longer a tab (consolidated behind Guides) — exercise the Guides tab instead.
    await expect(page.getByTestId('tab-bar')).toBeVisible();
    const guidesTab = page.getByTestId('tab-bar-guides');
    await expect(guidesTab).toBeVisible();
    await guidesTab.click();
    await expect(page).toHaveURL(/\/guides\/?$/);
  });
});

test.describe('S83 · command palette (⌘K / Ctrl+K, components/command-palette.tsx)', () => {
  test('Ctrl+K opens the palette; a selection navigates to the target route', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await goto(page, '/');

    // Global Ctrl+K listener opens the Radix dialog (labelled "Command palette").
    await openPalette(page);
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();

    // Type a query then select via keyboard (Enter) — the canonical cmdk path.
    // scoreItem ranks the exact-label "Japan" destination row first, so it is
    // the highlighted item; Enter fires its onSelect. (A mouse click on a cmdk
    // item is pointer-driven and flakes under the single-worker harness; the
    // keyboard path is both deterministic and the a11y contract this palette is
    // built around.) The palette then closes and cross-route navigation pushes
    // /japan/ (via scrollToSectionWhenReady) after onCloseAutoFocus.
    const input = page.getByPlaceholder('Jump to a section…');
    await input.fill('Japan');
    await expect(page.getByRole('option', { name: /Japan/ }).first()).toBeVisible();
    await input.press('Enter');

    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/japan\/?$/);
  });

  test('Escape closes the command palette', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await goto(page, '/');

    await openPalette(page);
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
  });
});

test.describe('S248 · glance-able "added" state on the guides (/nepal/)', () => {
  const PHOTO_ID = 'ps1'; // "Nagarkot Himalayan Panorama", Nepal photo spot
  const PHOTO_NAME = 'Nagarkot Himalayan Panorama';

  test('adding a place surfaces its card corner-chip + the Planned filter; both survive reload', async ({
    page,
  }) => {
    await goto(page, '/nepal/');
    await waitForGuide(page);

    // Baseline (post-S257): the SEED itinerary carries sourceId back-links, so
    // seeded places (Boudhanath na1) show their corner chip and the "Planned"
    // filter chip on a fresh vault — that IS the S257 feature. An unseeded place
    // (Shivapuri na9) shows no chip until the user adds it.
    await expect(page.getByTestId(`guide-added-${BOUDHA_ID}`)).toBeVisible();
    await expect(page.getByTestId(`guide-added-${SHIVAPURI_ID}`)).toHaveCount(0);
    // The "Planned" chip lives in the filters sheet now (S322G) — open it to confirm
    // it renders, then close so the card AddToPlanButton underneath is clickable.
    const plannedChip = page.getByTestId('guide-filter-planned');
    await openFilters(page);
    await expect(plannedChip).toBeVisible();
    await closeFilters(page);

    // Add Shivapuri via its card's own AddToPlanButton → the shared add dialog.
    await page
      .getByTestId(`guide-tilt-${SHIVAPURI_ID}`)
      .getByRole('button', { name: /^Add .* to your trip plan/ })
      .click();
    const dialog = page.getByTestId('add-item-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('add-item-confirm').click();
    await expect(dialog).toHaveCount(0);

    // The card corner chip appears.
    await expect(page.getByTestId(`guide-added-${SHIVAPURI_ID}`)).toBeVisible();

    // Activating the Planned filter (inside the sheet) narrows the grid to planned
    // cards only: the user-added na9, the seed-linked na1 — and hides unplanned na13.
    // Cards under the open sheet stay in the DOM, so their visibility is assertable.
    await openFilters(page);
    await plannedChip.click();
    await expect(plannedChip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`guide-card-${SHIVAPURI_ID}`)).toBeVisible();
    await expect(page.getByTestId(`guide-card-${BOUDHA_ID}`)).toBeVisible();
    await expect(page.getByTestId('guide-card-na13')).toHaveCount(0);

    // Clearing it brings the unplanned cards back.
    await plannedChip.click();
    await expect(plannedChip).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('guide-card-na13')).toBeVisible();
    await closeFilters(page);

    // Persistence: reload and the user-added chip + Planned filter are still there
    // (localStorage vault write; the seed-linked chip needs no persistence at all).
    await page.reload({ waitUntil: 'load' });
    await waitForGuide(page);
    await expect(page.getByTestId(`guide-added-${SHIVAPURI_ID}`)).toBeVisible();
    await openFilters(page);
    await expect(page.getByTestId('guide-filter-planned')).toBeVisible();
  });

  test('adding a photography spot surfaces its photo-added corner chip', async ({ page }) => {
    await goto(page, '/nepal/');
    await waitForGuide(page);

    await expect(page.getByTestId(`photo-added-${PHOTO_ID}`)).toHaveCount(0);

    // The photography guide's PhotoCard reuses the same shared AddToPlanButton.
    await page.getByRole('button', { name: `Add ${PHOTO_NAME} to your trip plan` }).click();
    const dialog = page.getByTestId('add-item-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('add-item-confirm').click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByTestId(`photo-added-${PHOTO_ID}`)).toBeVisible();
  });
});

test.describe('S83 · legacy v1 hash redirects (components/legacy-hash-redirect.tsx, Home)', () => {
  const CASES = [
    { hash: '#nepal', url: /\/nepal\/?$/ },
    { hash: '#japan', url: /\/japan\/?$/ },
    { hash: '#map', url: /\/map\/?$/ },
    { hash: '#itinerary', url: /\/plan\/?$/ },
  ] as const;

  for (const { hash, url } of CASES) {
    test(`/${hash} on Home redirects to its v2 route`, async ({ page }) => {
      await goto(page, `/${hash}`);
      // The island runs on mount and router.replace()s to the new home.
      await expect(page).toHaveURL(url);
    });
  }

  test('a cross-route hash with a sub-anchor lands on the destination route', async ({ page }) => {
    // #photography → /nepal/#photography (docs: ROUTE_REDIRECTS).
    await goto(page, '/#photography');
    await expect(page).toHaveURL(/\/nepal\/(#photography)?$/);
  });

  test('an unknown hash no-ops (stays on Home)', async ({ page }) => {
    await goto(page, '/#definitely-not-a-real-anchor');
    await expect(page).toHaveURL(/\/(#definitely-not-a-real-anchor)?$/);
    // Home content is still present (the hero h1).
    await expect(page.locator('h1').first()).toBeVisible();
  });
});
