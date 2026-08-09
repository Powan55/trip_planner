import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * FU-34 — `/map` favorites (popup heart + "Saved" filter) + offline connectivity hint
 * (dormant `out/` build). The deferred map-halves of S149 (favorites) and S154
 * (offline UX), now unblocked by S135 (TripMap extraction) + S151 (map trip-mode).
 *
 * Proves, on a real run:
 *   1. Favorite from a map popup persists to the SAME flat gateway-key-14 store
 *      (`nepal_japan_favorites`) the guide cards use, and survives a reload.
 *   2. The "Saved" chip is absent at 0 favorites, appears at >=1, and actually
 *      narrows the rendered marker set (via `map-shell`'s `data-visible-count`,
 *      mirroring the existing `data-stop-count`/`data-total-count` test-attribute
 *      idiom already used on `plan-day-map`/`map-itinerary-toggle`).
 *   3. Map favorites and guide favorites do NOT cross-contaminate — the id-space
 *      disjointness decision (map `np-*`/`jp-*` vs guide `na#`/`nf#`/`ja#`/`jf#`)
 *      holds in the real, running app, not just as a static id-shape assertion.
 *   4. The offline hint (`useOnline()`) appears/disappears with real browser
 *      connectivity (`context.setOffline`), no console errors.
 *   5. The heart does NOT render on `/plan`'s day-map popup (prop-gated —
 *      `enablePopupFavorite` is omitted there).
 *   6. axe `/map` serious/critical = 0 with the new UI (heart + Saved chip)
 *      actually present (not just the empty/default state already covered by
 *      `e2e/a11y.spec.ts`).
 *
 * IDENTITY: `test`/`expect` from `./fixtures` (signed-in default, D-241) —
 * seeded explicitly, deliberately; `/map`, `/nepal`, `/plan` are all reachable
 * on that identity.
 *
 * Harness notes mirror `e2e/map-trip-mode.spec.ts` / `e2e/favorites.spec.ts` /
 * `e2e/offline-banner.spec.ts` / `e2e/plan-map-split.spec.ts`:
 *  - `domcontentloaded` + block on a real testid — never `networkidle` (D-093).
 *  - Search-to-select (`map-search-toggle` -> `map-search-input` ->
 *    `map-search-result-{id}`) is the deterministic way to open a specific
 *    marker's popup regardless of the active category/Saved filter (it flies
 *    the camera + opens by lat/lng directly — see trip-map.tsx's `focusMarker`).
 */

const FAVORITES_KEY = 'nepal_japan_favorites';
const BOUDHA_ID = 'np-boudhanath'; // Cultural category, Nepal
const BOUDHA_NAME = 'Boudhanath Stupa';
const HOTEL_ID = 'jp-park-hyatt'; // Hotel category, Japan — deliberately a DIFFERENT category from Boudhanath
const NEPAL_REC_ID = 'na1'; // stable Nepal guide rec id (favorites.spec.ts)

async function gotoMap(page: Page) {
  await page.goto('/map/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('map-shell')).toBeVisible();
  // Wait for the GL canvas (maplibre-gl's lazy chunk resolved + Map constructed) so
  // `focusMarker`/search-select isn't raced against the async import (D-047).
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 20_000 });
}

/** Open a marker's popup deterministically via the search panel (works regardless
 *  of the active category/Saved filter — see trip-map.tsx's `focusMarker`).
 *  Wrapped in `toPass` (mirrors map-trip-mode.spec.ts's marker-click retry) since the
 *  camera flyTo/popup-open is timing-sensitive on a cold GL canvas. */
async function openPopupViaSearch(page: Page, query: string, resultId: string) {
  const popup = page.locator('.njp-map-popup');
  await expect(async () => {
    const toggle = page.getByTestId('map-search-toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click();
    }
    const input = page.getByTestId('map-search-input');
    await input.fill(query);
    await page.getByTestId(`map-search-result-${resultId}`).click();
    await expect(popup).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  return popup;
}

async function readStoredFavorites(page: Page): Promise<string[] | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, FAVORITES_KEY);
}

// This sandbox has no real internet access, so the map's raster tile source
// (basemaps.cartocdn.com) always 404s/aborts/`ERR_INTERNET_DISCONNECTED`s —
// REGARDLESS of `context.setOffline` and regardless of this slice's changes (the
// same tile-fetch noise appears in the pre-existing `e2e/map-trip-mode.spec.ts`
// pack, unrelated to this feature). That's an environment limit, not a functional
// regression, so it is filtered out of the "no console errors" assertions here —
// anything else still fails the test.
const KNOWN_TILE_FETCH_NOISE =
  /basemaps\.cartocdn\.com|AJAXError: Failed to fetch|Failed to load resource: net::ERR_INTERNET_DISCONNECTED/;

// The reload in the first test below races MapLibre's in-flight glyph fetch, whose abort logs a
// bare `TypeError: Failed to fetch` that `KNOWN_TILE_FETCH_NOISE` cannot match by construction.
// Stubbed pack-wide in `e2e/fixtures.ts`'s `page` fixture (full reasoning there) — the same race
// is latent in every spec that reloads with a map mounted, so it does not belong in this file.

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !KNOWN_TILE_FETCH_NOISE.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (!KNOWN_TILE_FETCH_NOISE.test(e.message)) errors.push(e.message);
  });
  return errors;
}

test.describe('FU-34 · favorite a place from a map popup, persists across reload', () => {
  test('favorite via the popup heart persists to the shared favorites store and survives a reload', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    const popup = await openPopupViaSearch(page, 'Boudhanath', BOUDHA_ID);
    await expect(popup).toContainText(BOUDHA_NAME);

    const heart = popup.getByTestId(`map-popup-favorite-${BOUDHA_ID}`);
    await expect(heart).toBeVisible();
    await expect(heart).toHaveAttribute('aria-pressed', 'false');
    await expect(heart).toHaveAttribute('aria-label', `Save ${BOUDHA_NAME}`);

    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    await expect(heart).toHaveAttribute('aria-label', `Remove ${BOUDHA_NAME} from saved`);
    expect(await readStoredFavorites(page)).toEqual([BOUDHA_ID]);

    // RELOAD — the favorited id survives (the localStorage hard guarantee).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('map-shell')).toBeVisible();
    expect(await readStoredFavorites(page)).toEqual([BOUDHA_ID]);

    const popupAfterReload = await openPopupViaSearch(page, 'Boudhanath', BOUDHA_ID);
    await expect(popupAfterReload.getByTestId(`map-popup-favorite-${BOUDHA_ID}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });
});

test.describe('FU-34 · "Saved" filter chip — appears only with >=1 favorite, narrows the marker set', () => {
  test('chip absent at 0 favorites, appears at 1, and toggling it narrows the rendered markers', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    await expect(page.getByTestId('map-filter-saved')).toHaveCount(0);
    const shell = page.getByTestId('map-shell');
    const countAll = Number(await shell.getAttribute('data-visible-count'));
    expect(countAll).toBeGreaterThan(1);

    // Favorite one marker via its popup.
    const popup = await openPopupViaSearch(page, 'Boudhanath', BOUDHA_ID);
    await popup.getByTestId(`map-popup-favorite-${BOUDHA_ID}`).click();

    const savedChip = page.getByTestId('map-filter-saved');
    await expect(savedChip).toBeVisible();
    await expect(savedChip).toContainText('1');
    await expect(savedChip).toHaveAttribute('aria-pressed', 'false');
    // Not yet active — the full marker set is still rendered.
    await expect(shell).toHaveAttribute('data-visible-count', String(countAll));

    // Activate — narrows to ONLY the favorited marker.
    await savedChip.click();
    await expect(savedChip).toHaveAttribute('aria-pressed', 'true');
    await expect(shell).toHaveAttribute('data-visible-count', '1');

    // Deactivate — the full set returns.
    await savedChip.click();
    await expect(savedChip).toHaveAttribute('aria-pressed', 'false');
    await expect(shell).toHaveAttribute('data-visible-count', String(countAll));

    // Unfavorite — the chip disappears again.
    const popup2 = await openPopupViaSearch(page, 'Boudhanath', BOUDHA_ID);
    await popup2.getByTestId(`map-popup-favorite-${BOUDHA_ID}`).click();
    await expect(page.getByTestId('map-filter-saved')).toHaveCount(0);
  });

  test('Saved composes with the category filter (AND, not OR)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    // Favorite a Cultural marker (Boudhanath) and a Hotel marker (Park Hyatt Tokyo) —
    // deliberately different categories, so the AND-composition is actually exercised.
    const popup = await openPopupViaSearch(page, 'Boudhanath', BOUDHA_ID);
    await popup.getByTestId(`map-popup-favorite-${BOUDHA_ID}`).click();
    const popup2 = await openPopupViaSearch(page, 'Park Hyatt', HOTEL_ID);
    await popup2.getByTestId(`map-popup-favorite-${HOTEL_ID}`).click();

    const shell = page.getByTestId('map-shell');
    await page.getByTestId('map-filter-saved').click();
    // Both favorites visible while category is still "All".
    await expect(shell).toHaveAttribute('data-visible-count', '2');

    // Narrow by category too (Cultural) — Saved AND category must both hold, so
    // only Boudhanath (Cultural) remains; the Hotel favorite drops out.
    await page.getByTestId('map-filter-cultural').click();
    await expect(shell).toHaveAttribute('data-visible-count', '1');
  });
});

test.describe('FU-34 · map favorites and guide favorites do not cross-contaminate', () => {
  test('a map favorite does not appear as a guide favorite, and vice versa', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMap(page);

    const popup = await openPopupViaSearch(page, 'Boudhanath', BOUDHA_ID);
    await popup.getByTestId(`map-popup-favorite-${BOUDHA_ID}`).click();
    expect(await readStoredFavorites(page)).toEqual([BOUDHA_ID]);

    // The Nepal guide's "Saved" chip must NOT appear from a map-only favorite.
    await page.goto('/nepal/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('guide-search-input')).toBeVisible();
    await expect(page.getByTestId('guide-filter-saved')).toHaveCount(0);
    await expect(page.getByTestId(`guide-favorite-${NEPAL_REC_ID}`)).toHaveAttribute('aria-pressed', 'false');

    // Favorite a guide card too — the store now holds BOTH ids, still disjoint.
    await page.getByTestId(`guide-favorite-${NEPAL_REC_ID}`).click();
    const stored = await readStoredFavorites(page);
    expect(stored?.sort()).toEqual([BOUDHA_ID, NEPAL_REC_ID].sort());

    // Back on /map — the map "Saved" chip count reflects ONLY the map favorite (1),
    // not the guide favorite.
    await page.goto('/map/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('map-shell')).toBeVisible();
    const savedChip = page.getByTestId('map-filter-saved');
    await expect(savedChip).toBeVisible();
    await expect(savedChip).toContainText('1');
  });
});

test.describe('FU-34 · offline connectivity hint', () => {
  test('appears when offline, clears when back online, no console errors', async ({ page, context }) => {
    const errors = trackErrors(page);
    await gotoMap(page);

    await expect(page.getByTestId('map-offline-hint')).toHaveCount(0);

    await context.setOffline(true);
    const hint = page.getByTestId('map-offline-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveAttribute('role', 'status');
    await expect(hint).toContainText('offline');
    await expect(hint).toContainText('connection');

    await context.setOffline(false);
    await expect(page.getByTestId('map-offline-hint')).toHaveCount(0);

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });
});

test.describe('FU-34 · the favorite heart is prop-gated OFF on /plan\'s day-map', () => {
  test('the day-map popup on /plan never shows a favorite heart', async ({ page }) => {
    const ITINERARY_KEY = 'nepal_japan_itinerary';
    const FIXTURE_DAY = '2026-12-09';

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });

    await page.evaluate(
      ({ key, date }: { key: string; date: string }) => {
        const dayPlan = {
          date,
          city: 'Kathmandu',
          country: 'nepal',
          items: [{ id: 'fu34-solo', title: 'Boudhanath Stupa', category: 'sightseeing' }],
        };
        window.localStorage.setItem(key, JSON.stringify([dayPlan]));
      },
      { key: ITINERARY_KEY, date: FIXTURE_DAY },
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });

    await page.getByTestId('plan-map-toggle').click();
    const canvas = page.locator('canvas.maplibregl-canvas');
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    const pane = page.getByTestId('plan-day-map');
    await expect(pane).toHaveAttribute('data-stop-count', '1');

    // Single stop, reduced motion → fitted dead-center; click it to open its popup.
    await canvas.scrollIntoViewIfNeeded();
    const popup = page.locator('.njp-map-popup');
    await expect(async () => {
      const box = (await canvas.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(popup).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });

    await expect(popup).toContainText(BOUDHA_NAME);
    // No favorite heart anywhere in the popup (enablePopupFavorite omitted here).
    await expect(popup.locator('[data-testid^="map-popup-favorite-"]')).toHaveCount(0);
  });
});

test.describe('FU-34 · axe /map with the favorites UI present', () => {
  test('axe: /map has zero serious/critical violations with a favorite + Saved chip + offline hint present', async ({
    page,
    context,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoMap(page);

    const popup = await openPopupViaSearch(page, 'Boudhanath', BOUDHA_ID);
    await popup.getByTestId(`map-popup-favorite-${BOUDHA_ID}`).click();
    await expect(page.getByTestId('map-filter-saved')).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByTestId('map-offline-hint')).toBeVisible();
    // S336: the app-wide offline banner (fixed, fades opacity 0->1 on mount) can be sampled by
    // axe mid-fade, deflating its floored text-white/55 below AA (a false positive — at rest it
    // composites ≥AA on the glass pill). Settle it to opacity 1 first (s157 settle-guard pattern).
    const offlineBanner = page.getByTestId('offline-banner');
    await offlineBanner.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    if (await offlineBanner.count()) {
      await expect(offlineBanner).toHaveCSS('opacity', '1');
    }

    const results = await new AxeBuilder({ page }).exclude('canvas.maplibregl-canvas').analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    for (const v of results.violations) {
      testInfo.annotations.push({
        type: `axe:${v.impact ?? 'unknown'}`,
        description: `${v.id}: ${v.help} (${v.nodes.length} nodes)`,
      });
    }
    // eslint-disable-next-line no-console
    console.log(`axe SUMMARY /map (favorites UI): serious/critical=${blocking.length}`);
    expect(
      blocking,
      `serious/critical a11y violations on /map with favorites UI: ${blocking
        .map((v) => `${v.id} [${v.impact}] × ${v.nodes.length}`)
        .join('; ')}`,
    ).toEqual([]);

    await context.setOffline(false);
  });
});
