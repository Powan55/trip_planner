import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S149 — Favorites/bookmarks on guides (guides-scoped) E2E pack.
 *
 * A traveler can favorite/bookmark a `RecommendationCard` on `/nepal` and `/japan`
 * (`hooks/use-favorites.ts`, gateway key 14, `favoritesStore`, D-130 local-only), and a "Saved"
 * filter chip appears in a `RecommendationSection` only once that section has >= 1 favorited
 * item, filtering the results grid to favorites when toggled on.
 *
 * IDENTITY: with no guest mode (D-241), `/nepal` and `/japan` are reachable only signed-in.
 * `test`/`expect` come from `./fixtures`, whose DEFAULT identity is a SIGNED-IN traveler (seeds
 * `tripPlannerToken`/`tripPlannerUserName` via `addInitScript`) — seeded explicitly by importing
 * the default fixture, deliberately.
 *
 * Harness notes (mirrors e2e/interaction.spec.ts, the existing `/nepal` guide pack):
 *  - `waitUntil: 'load'` (never `networkidle` — D-093, the live countdown + SW keep the network
 *    busy) + a ride-through wait for the first-load SW `controllerchange` reload (D-073).
 *  - The guide island mounts via `next/dynamic({ssr:false})` behind a skeleton, so every spec
 *    waits for a real `guide-*` testid to attach before interacting.
 *  - `na1` ("Boudhanath Stupa") and `na9` ("Shivapuri National Park") are stable Nepal ids
 *    (lib/nepal-data.ts), reused from interaction.spec.ts's documented id map.
 */

const FAVORITES_KEY = 'nepal_japan_favorites';
const BOUDHA_ID = 'na1';
const SHIVAPURI_ID = 'na9';

/** Navigate and ride through the one-off first-load SW reload (D-073), mirrors interaction.spec.ts. */
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

/** Wait for the Nepal guide island to mount + its last card to attach (quiets whileInView churn). */
async function waitForGuide(page: Page) {
  await expect(page.getByTestId('guide-search-input')).toBeVisible();
  await expect(page.getByTestId('guide-card-na20')).toBeAttached();
}

/**
 * S322G — the guide filter facets ("saved" included) fold into a collapsed FilterSheet behind
 * the pinned "Filters" trigger; search stays on-page. So the `guide-filter-saved` chip only
 * mounts inside the OPEN sheet. Open it to assert against the facet, close it to reach the cards.
 */
async function openGuideFilters(page: Page) {
  await page.getByTestId('guide-filters-trigger').click();
  await expect(page.getByTestId('guide-filters-sheet')).toBeVisible();
}
async function closeGuideFilters(page: Page) {
  await page.getByTestId('guide-filters-apply').click();
  await expect(page.getByTestId('guide-filters-sheet')).toHaveCount(0);
}

/** Read the raw persisted favorites list from localStorage (null when unset). */
async function readStoredFavorites(page: Page): Promise<string[] | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, FAVORITES_KEY);
}

test.describe('S149 favorites — toggle on a guide card, persists across reload', () => {
  test('favorite a card, it persists to localStorage, and survives a reload', async ({ page }) => {
    await goto(page, '/nepal/');
    await waitForGuide(page);

    const favBtn = page.getByTestId(`guide-favorite-${BOUDHA_ID}`);
    await expect(favBtn).toBeVisible();
    await expect(favBtn).toHaveAttribute('aria-pressed', 'false');

    await favBtn.click();
    await expect(favBtn).toHaveAttribute('aria-pressed', 'true');

    const stored = await readStoredFavorites(page);
    expect(stored).toEqual([BOUDHA_ID]);

    // RELOAD — the favorited id survives (the localStorage hard guarantee).
    await page.reload({ waitUntil: 'load' });
    await waitForGuide(page);
    await expect(page.getByTestId(`guide-favorite-${BOUDHA_ID}`)).toHaveAttribute('aria-pressed', 'true');
    expect(await readStoredFavorites(page)).toEqual([BOUDHA_ID]);
  });

  test('unfavorite removes it from localStorage and the button reflects it', async ({ page }) => {
    await goto(page, '/nepal/');
    await waitForGuide(page);

    const favBtn = page.getByTestId(`guide-favorite-${BOUDHA_ID}`);
    await favBtn.click();
    await expect(favBtn).toHaveAttribute('aria-pressed', 'true');

    await favBtn.click();
    await expect(favBtn).toHaveAttribute('aria-pressed', 'false');
    expect(await readStoredFavorites(page)).toEqual([]);

    await page.reload({ waitUntil: 'load' });
    await waitForGuide(page);
    await expect(page.getByTestId(`guide-favorite-${BOUDHA_ID}`)).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('S149 "Saved" filter chip — appears only with >=1 favorite, filters the grid', () => {
  test('chip is absent at 0 favorites, appears at 1, filters, and hides again at 0', async ({ page }) => {
    await goto(page, '/nepal/');
    await waitForGuide(page);

    // No favorites yet — the Saved facet does not render even inside the sheet.
    await openGuideFilters(page);
    await expect(page.getByTestId('guide-filter-saved')).toHaveCount(0);
    await closeGuideFilters(page);

    // Favorite one card (on-page), then open the sheet — the Saved facet now appears, count 1.
    await page.getByTestId(`guide-favorite-${BOUDHA_ID}`).click();
    await openGuideFilters(page);
    const savedChip = page.getByTestId('guide-filter-saved');
    await expect(savedChip).toBeVisible();
    await expect(savedChip).toContainText('1');
    await expect(savedChip).toHaveAttribute('aria-pressed', 'false');
    // The "Filters" trigger badge stays 0 until the facet is actually toggled on (available, not active).
    await expect(page.getByTestId('guide-filters-trigger')).toHaveAttribute('aria-label', 'Filters');

    // Both an unfavorited card and the favorited one are still in the grid (chip not yet active).
    await expect(page.getByTestId(`guide-card-${BOUDHA_ID}`)).toBeVisible();
    await expect(page.getByTestId(`guide-card-${SHIVAPURI_ID}`)).toBeVisible();

    // Activate the facet — the grid filters down to ONLY the favorited card, and the trigger
    // badge reflects one active filter.
    await savedChip.click();
    await expect(savedChip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('guide-filters-trigger')).toHaveAttribute('aria-label', 'Filters, 1 active');
    await expect(page.getByTestId(`guide-card-${BOUDHA_ID}`)).toBeVisible();
    await expect(page.getByTestId(`guide-card-${SHIVAPURI_ID}`)).toHaveCount(0);
    await expect(page.locator('[data-testid="guide-results"] [data-testid^="guide-card-"]')).toHaveCount(1);

    // Deactivate — the full grid returns.
    await savedChip.click();
    await expect(savedChip).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId(`guide-card-${SHIVAPURI_ID}`)).toBeVisible();

    // Close the sheet to reach the cards, unfavorite the only saved item — the Saved facet
    // disappears (section back to 0 favorites), proven by reopening the sheet.
    await closeGuideFilters(page);
    await page.getByTestId(`guide-favorite-${BOUDHA_ID}`).click();
    await openGuideFilters(page);
    await expect(page.getByTestId('guide-filter-saved')).toHaveCount(0);
  });

  test('favorites are scoped per data set: a Japan favorite does not surface the Nepal chip', async ({
    page,
  }) => {
    await goto(page, '/japan/');
    await expect(page.getByTestId('guide-search-input')).toBeVisible();
    const firstJapanCard = page.locator('[data-testid^="guide-favorite-ja"]').first();
    await expect(firstJapanCard).toBeVisible();
    await firstJapanCard.click();
    // The Saved facet surfaces for Japan — inside its FilterSheet.
    await openGuideFilters(page);
    await expect(page.getByTestId('guide-filter-saved')).toBeVisible();

    // The Nepal section has no favorited item of its own — its Saved facet stays absent even
    // when its own sheet is opened.
    await goto(page, '/nepal/');
    await waitForGuide(page);
    await openGuideFilters(page);
    await expect(page.getByTestId('guide-filter-saved')).toHaveCount(0);
  });
});
