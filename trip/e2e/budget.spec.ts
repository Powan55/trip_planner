import { test, expect, seedPinnedRates } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S101 — Trip Budget (the core) E2E pack.
 *
 * The budget panel (`components/budget-panel.tsx`) is a `/plan` island
 * (`next/dynamic(ssr:false)`, behind a SectionSkeleton) that sets per-leg + per-category budgets
 * and shows the roll-up totals. Everything persists through the typed storage gateway (key 10,
 * `budgetStore`) — client-side localStorage, no backend (D-004), no rate API (D-088). These specs
 * prove the centrepiece guarantees on a real run:
 *
 *   1. PERSISTENCE (D-018-class): set a leg budget → RELOAD → it survives.
 *   2. FRESH VISITOR: with no saved model, the panel shows the seeded defaults (empty budgets,
 *      $0 grand total).
 *   3. PER-CATEGORY: a category budget persists and survives reload.
 *
 * ── S146 RELOCATION ─────────────────────────────────────────────────────────────────────────
 * The home-currency toggle + exchange-rate override moved OFF this panel to the Settings page
 * (`/settings`, `components/settings-panel.tsx`). Their behavior — and the cross-page effect on
 * this panel's grand total — is covered in `settings.spec.ts`. This pack now proves only what
 * lives on `/plan`.
 *
 * ── THE RATES ARE PINNED BY THE FIXTURE, NOT READ FROM THE SEED ─────────────────────────────
 * Every USD figure below is arithmetic against `PINNED_RATES` (138 NPR/$1, 155 JPY/$1), seeded into
 * the budget slot by `seedPinnedRates` before the app boots — NOT against `SEED_RATES`, which is a
 * build-time default that gets re-checked against the real market and moved (it did on 2026-08-15,
 * and took this pack's totals with it). What these specs prove is that the panel converts and rolls
 * up correctly at a KNOWN rate; the seed's actual value is not part of that claim.
 *
 * ── SETTLE DISCIPLINE (mirrors persistence.spec.ts / today.spec.ts) ─────────────────────────
 * The panel is a lazy `ssr:false` island that hydrates from `loadBudget()` in a mount effect. So
 * every navigation goes through `waitUntil:'domcontentloaded'` AND `settleBudget`, which blocks
 * until the panel is visible and its grand-total value has rendered (hydration resolved) before any
 * assertion. The settle only removes the race; it never weakens what is verified.
 */

const BUDGET_KEY = 'nepal_japan_budget';

/**
 * Navigate to /plan with reduced motion pinned and the network settled.
 *
 * Pins the FX rates by default (see the header) — every test that asserts a USD figure wants that,
 * and defaulting it on is what keeps the next test somebody adds here seed-proof. `pinRates: false`
 * is for the one test whose subject IS the absence of a stored model.
 */
async function gotoPlanSettled(page: Page, { pinRates = true }: { pinRates?: boolean } = {}) {
  if (pinRates) await seedPinnedRates(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
}

async function reloadSettled(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
}

/** Block until the budget island has mounted + hydrated (the grand-total value has rendered). */
async function settleBudget(page: Page) {
  await expect(page.getByTestId('budget-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('budget-grand-total-value')).toBeVisible({ timeout: 15_000 });
}

/** Read the raw persisted budget model from localStorage (null when unset). */
async function readStored(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, BUDGET_KEY);
}

test.describe('S101 Trip Budget — set budgets + see totals (persistence)', () => {
  test('fresh visitor: the panel shows the seeded defaults (empty budgets, $0 grand total)', async ({
    page,
  }) => {
    // NO seeded model here, and that is the point of this test: it asserts the slot is still
    // absent until the user edits something, so it must meet a genuinely empty localStorage.
    await gotoPlanSettled(page, { pinRates: false });
    await settleBudget(page);

    // Leg budgets start empty (no value → placeholder). Nothing rendered as NaN.
    await expect(page.getByTestId('budget-leg-nepal-input')).toHaveValue('');
    await expect(page.getByTestId('budget-leg-japan-input')).toHaveValue('');

    // Grand total is $0 (no budget set yet), never NaN.
    await expect(page.getByTestId('budget-grand-total-value')).toHaveText('$0');

    // No model persisted until the user edits something.
    expect(await readStored(page)).toBeNull();
  });

  test('persistence: set a leg budget, reload, and it survives (D-018-class)', async ({ page }) => {
    await gotoPlanSettled(page);
    await settleBudget(page);

    // Set the Nepal leg budget to 13,800 NPR (= 100 USD at the NPR rate THIS fixture pins, 138).
    const nepal = page.getByTestId('budget-leg-nepal-input');
    await nepal.fill('13800');

    // The grand total re-expresses live in USD at the pinned rate: 13800 / 138 = 100.
    await expect(page.getByTestId('budget-grand-total-value')).toHaveText('$100');

    // It persisted to localStorage.
    const stored = await readStored(page);
    expect(stored).not.toBeNull();
    expect((stored as { legBudgets: { nepal: number } }).legBudgets.nepal).toBe(13800);

    // RELOAD — the set budget survives (the hard guarantee for the budget domain).
    await reloadSettled(page);
    await settleBudget(page);

    await expect(page.getByTestId('budget-leg-nepal-input')).toHaveValue('13800');
    await expect(page.getByTestId('budget-grand-total-value')).toHaveText('$100');
  });

  test('grand total sums both legs at the pinned rates', async ({ page }) => {
    await gotoPlanSettled(page);
    await settleBudget(page);

    // Nepal 13,800 NPR (=100 USD) + Japan 31,000 JPY (=200 USD) = 300 USD — at the two rates THIS
    // fixture pins (138 / 155), which is what makes both halves of the sum checkable at once.
    await page.getByTestId('budget-leg-nepal-input').fill('13800');
    await page.getByTestId('budget-leg-japan-input').fill('31000');
    await expect(page.getByTestId('budget-grand-total-value')).toHaveText('$300');

    // The stored LOCAL amounts are exactly as entered.
    const stored = await readStored(page);
    expect((stored as { legBudgets: { nepal: number; japan: number } }).legBudgets).toEqual({
      nepal: 13800,
      japan: 31000,
    });
  });

  test('per-category budget: setting a category amount persists and survives reload', async ({
    page,
  }) => {
    await gotoPlanSettled(page);
    await settleBudget(page);

    // Expand Nepal's category breakdown and set a food budget of 2,760 NPR.
    await page.getByTestId('budget-leg-nepal-categories-toggle').click();
    const food = page.getByTestId('budget-cat-nepal-food');
    await food.fill('2760');

    // Persisted under the category map.
    const stored = await readStored(page);
    expect(
      (stored as { categoryBudgets: { nepal?: { food?: number } } }).categoryBudgets.nepal?.food,
    ).toBe(2760);

    // Survives reload (re-expand, since <details> collapses on remount).
    await reloadSettled(page);
    await settleBudget(page);
    await page.getByTestId('budget-leg-nepal-categories-toggle').click();
    await expect(page.getByTestId('budget-cat-nepal-food')).toHaveValue('2760');
  });
});
