import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S147 — search-within-plan (dormant `out/` build).
 *
 * Proves, on a real run:
 *   1. From `/plan`: typing a title fragment surfaces the seeded item; selecting it
 *      keeps the planner on the same day and rings the row (the S136 highlight+scroll
 *      path, generalized to item ids).
 *   2. Cross-day jump: searching an item seeded on a DIFFERENT day than the current
 *      selection jumps `selectedDate` AND the highlight lands correctly — proving the
 *      ordering trap (the clear-highlight effect firing on the same `selectedDate`
 *      change) is handled via the pending-focus ref.
 *   3. From the command palette (Ctrl/Cmd-K): typing a plan-item word surfaces an
 *      "In your plan" result; selecting it navigates to `/plan` focused+highlighted on
 *      that item, from a route OTHER than /plan (proving the `?focus=` cross-route
 *      hand-off works despite the palette living outside ItineraryProvider).
 *   4. Keyboard operability: the `/plan` results are reachable by Tab/Arrow keys and
 *      selectable via Enter; Escape closes the results.
 *   5. Read-only (D-018): searching/selecting never changes the persisted itinerary
 *      bytes.
 *   6. No console errors; axe on `/plan` with the search UI open is
 *      serious/critical-clean.
 *
 * Identity: default fixture (`./fixtures`) seeds a signed-in traveler so every route
 * is reachable (dormant build, no `.env.local`). Seeding + settle discipline mirrors
 * plan-map-split.spec.ts (S136): navigate `domcontentloaded`, block on the lazy
 * planner island's `calendar-day-*` grid, never `networkidle`.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const DAY_A = '2026-12-09'; // TRIP_DATES[0] — the default-selected day
const DAY_B = '2026-12-10'; // a different day — used for the cross-day jump

const ITEM_A = { id: 's147-boudha', title: 'Boudhanath Stupa Sunset', category: 'sightseeing' };
const ITEM_B = {
  id: 's147-ramen',
  title: 'Dinner reservation',
  category: 'food',
  notes: 'Ramen crawl in Shinjuku — try the tonkotsu broth',
};

const DESKTOP = { width: 1280, height: 900 } as const;

async function waitForPlannerReady(page: Page) {
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'attached' });
}

async function seedPlan(page: Page) {
  // Seed via /plan (so the localStorage key exists before we assert against it), then
  // navigate away/wherever each test needs — the write is origin-scoped, not page-scoped.
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
  await page.evaluate(
    ({ key, dayA, dayB, itemA, itemB }) => {
      const plans = [
        { date: dayA, city: 'Kathmandu', country: 'nepal', items: [itemA] },
        { date: dayB, city: 'Kathmandu', country: 'nepal', items: [itemB] },
      ];
      window.localStorage.setItem(key, JSON.stringify(plans));
    },
    { key: ITINERARY_KEY, dayA: DAY_A, dayB: DAY_B, itemA: ITEM_A, itemB: ITEM_B },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}

async function openPalette(page: Page) {
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

test.describe('S147 · search-within-plan', () => {
  test('from /plan: search + select stays on the same day and highlights the row', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seedPlan(page);

    // Default selection is DAY_A (today is out of the trip window, S65 travel-mode
    // never overrides), so searching an item seeded on DAY_A is the same-day path.
    await expect(page.getByTestId(`calendar-day-${DAY_A}`)).toHaveAttribute('aria-pressed', 'true');

    const input = page.getByTestId('plan-search-input');
    await input.fill('boudha');
    const result = page.getByTestId(`plan-search-result-${ITEM_A.id}`);
    await expect(result).toBeVisible();
    await result.click();

    // Same day — no day-change, immediate highlight + scroll.
    await expect(page.getByTestId(`calendar-day-${DAY_A}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`calendar-item-${ITEM_A.id}`)).toHaveAttribute('data-highlighted', 'true');
    // The results panel closes after a selection.
    await expect(page.getByTestId('plan-search-results')).toHaveCount(0);
  });

  test('cross-day jump: search lands on the item\'s day AND highlights the right row (ordering trap)', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await seedPlan(page);

    // Currently on DAY_A; search an item that only exists on DAY_B.
    await expect(page.getByTestId(`calendar-day-${DAY_A}`)).toHaveAttribute('aria-pressed', 'true');

    const input = page.getByTestId('plan-search-input');
    await input.fill('ramen crawl');
    const result = page.getByTestId(`plan-search-result-${ITEM_B.id}`);
    await expect(result).toBeVisible();
    await result.click();

    // selectedDate changed to DAY_B...
    await expect(page.getByTestId(`calendar-day-${DAY_B}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`calendar-day-${DAY_A}`)).toHaveAttribute('aria-pressed', 'false');
    // ...and the highlight survived the day-change (the clear-highlight effect firing on
    // the same selectedDate transition did NOT wipe out the pending search focus).
    await expect(page.getByTestId(`calendar-item-${ITEM_B.id}`)).toHaveAttribute('data-highlighted', 'true');
  });

  test('keyboard: arrow to a result and Enter selects; Escape closes', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seedPlan(page);

    const input = page.getByTestId('plan-search-input');
    await input.click();
    await input.fill('boudha');
    await expect(page.getByTestId(`plan-search-result-${ITEM_A.id}`)).toBeVisible();

    await input.press('ArrowDown');
    await expect(page.getByTestId(`plan-search-result-${ITEM_A.id}`)).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');

    await expect(page.getByTestId(`calendar-item-${ITEM_A.id}`)).toHaveAttribute('data-highlighted', 'true');
    await expect(page.getByTestId('plan-search-results')).toHaveCount(0);

    // Escape clears an open query + closes the results (no selection required).
    await input.fill('boudha');
    await expect(page.getByTestId('plan-search-results')).toBeVisible();
    await input.press('Escape');
    await expect(page.getByTestId('plan-search-results')).toHaveCount(0);
    await expect(input).toHaveValue('');
  });

  test('from the palette: a plan-item result lands on /plan focused+highlighted', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seedPlan(page);

    // Open the palette from a DIFFERENT route (Home) — proves the cross-route ?focus=
    // hand-off, not just a same-page shortcut.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openPalette(page);

    // Type character-by-character (like a real user, not a single bulk `.fill()`) —
    // cmdk re-runs its own "reselect first visible" pass on every keystroke, which is
    // how it stays correctly synced with our dynamically-mounted "In your plan" items.
    const paletteInput = page.getByPlaceholder('Jump to a section…');
    await paletteInput.pressSequentially('ramen crawl');

    const paletteResult = page.getByTestId(`palette-plan-result-${ITEM_B.id}`);
    await expect(paletteResult).toBeVisible();
    await expect(paletteResult).toHaveAttribute('role', 'option');
    // Keyboard selection (Enter), not a mouse click — cmdk items are pointer-driven and
    // flake under the single-worker harness (the same rationale interaction.spec.ts's
    // S83 palette spec documents); the query is specific enough that this is the only
    // visible option, so Enter deterministically selects it.
    await paletteInput.press('Enter');

    await expect(page).toHaveURL(/\/plan\/?/);
    await waitForPlannerReady(page);
    await expect(page.getByTestId(`calendar-day-${DAY_B}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`calendar-item-${ITEM_B.id}`)).toHaveAttribute('data-highlighted', 'true');
    // The ?focus= param is stripped after consumption (no re-highlight loop on reload).
    await expect(page).toHaveURL(/^(?!.*focus=).*$/);
  });

  test('read-only: searching and selecting never changes the persisted itinerary bytes', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await seedPlan(page);

    const before = await page.evaluate((key) => window.localStorage.getItem(key), ITINERARY_KEY);

    const input = page.getByTestId('plan-search-input');
    await input.fill('ramen crawl');
    await page.getByTestId(`plan-search-result-${ITEM_B.id}`).click();
    await input.fill('boudha');
    await page.getByTestId(`plan-search-result-${ITEM_A.id}`).click();

    // Also exercise the palette path (keyboard select — see the palette test above).
    await openPalette(page);
    const paletteInput = page.getByPlaceholder('Jump to a section…');
    await paletteInput.pressSequentially('ramen crawl');
    await expect(page.getByTestId(`palette-plan-result-${ITEM_B.id}`)).toBeVisible();
    await paletteInput.press('Enter');
    await waitForPlannerReady(page);

    const after = await page.evaluate((key) => window.localStorage.getItem(key), ITINERARY_KEY);
    expect(after).toEqual(before);
  });

  test('no console errors; axe on /plan with the search results open is serious/critical-clean', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.setViewportSize(DESKTOP);
    await seedPlan(page);

    const input = page.getByTestId('plan-search-input');
    await input.fill('boudha');
    await expect(page.getByTestId(`plan-search-result-${ITEM_A.id}`)).toBeVisible();

    const results = await new AxeBuilder({ page }).exclude('canvas.maplibregl-canvas').analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(
      blocking,
      `serious/critical a11y violations on /plan (search open): ${blocking
        .map((v) => `${v.id} [${v.impact}]`)
        .join('; ')}`,
    ).toEqual([]);

    expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
  });
});
