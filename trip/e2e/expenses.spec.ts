import { test, expect, seedPinnedRates } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S102 — Expense logging E2E pack.
 *
 * The fast expense-log flow: a "Log expense" button in the S101 budget panel opens a global portal
 * dialog (`expense:open` → `ExpenseLogHost` → `expense-dialog`), the logged expense appears in the
 * panel's list AND feeds the S101 `rollUp` `spent` seam so spent/remaining + the grand total update
 * live, everything persists through the typed storage gateway (key 11, `expensesStore`) — client-
 * side localStorage, no backend (D-004). These specs prove the centrepiece guarantees on a real run:
 *
 *   1. LOG → APPEARS → TOTALS UPDATE → RELOAD PERSISTS (D-018-class): set a Nepal budget, log a
 *      Nepal expense (amount + category), it lands in the list, spent/remaining + grand total move,
 *      and it all survives a reload.
 *   2. EDIT: change an expense's amount → the list + totals update → persists.
 *   3. DELETE: remove an expense → the list + totals revert → persists.
 *
 * ── THE RATES ARE PINNED BY THE FIXTURE, NOT READ FROM THE SEED ─────────────────────────────
 * Expenses are entered and stored in the leg's LOCAL currency, so the `Rs …` assertions below are
 * rate-free. The grand-total spent/remaining figures are not: they are the same NPR amounts rolled
 * up into USD. Those are checked against `PINNED_RATES` (138 NPR/$1), seeded into the budget slot by
 * `seedPinnedRates` before the app boots — NOT against `SEED_RATES`, a build-time default that moves
 * when the real market has (it did on 2026-08-15, and took every dollar figure here red). What is
 * under test is that a logged/edited/deleted expense reaches the roll-up at all, not what the seed
 * happens to say this month.
 *
 * ── SETTLE DISCIPLINE (mirrors budget.spec.ts) ──────────────────────────────────────────────
 * The budget panel is a lazy `ssr:false` island that hydrates from `loadBudget()`/`loadExpenses()`
 * in mount effects. Every navigation/reload goes through `waitUntil:'domcontentloaded'` + `settleBudget`,
 * which blocks until the panel is visible and hydration has resolved before any assertion, so no
 * assertion runs against a transient pre-hydrate frame.
 *
 * Leg preset: outside the trip window (the default E2E clock) the host presets the leg to the FIRST
 * trip day's leg (Nepal → NPR). We log Nepal expenses so amounts read in NPR without a toggle tap.
 */

const EXPENSES_KEY = 'nepal_japan_expenses';

async function gotoPlanSettled(page: Page) {
  await seedPinnedRates(page); // see the header — the USD roll-up figures are checked against these
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
}

async function reloadSettled(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
}

/** Block until the budget island has mounted + hydrated (the USD toggle has a concrete state). */
async function settleBudget(page: Page) {
  // S167/FU-26: give the readiness wait a real timeout (was the implicit 5s, which `networkidle`
  // used to cushion). The panel genuinely mounts under load; a real regression still fails, at 15s.
  await expect(page.getByTestId('budget-panel')).toBeVisible({ timeout: 15_000 });
  // S146: the home-currency toggle relocated to /settings, so the readiness signal is now the
  // grand-total value (always rendered on /plan once the panel has mounted + hydrated).
  await expect(page.getByTestId('budget-grand-total-value')).toBeVisible({ timeout: 15_000 });
}

/** Read the raw persisted expense list from localStorage (null when unset). */
async function readStored(page: Page): Promise<Array<Record<string, unknown>> | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, EXPENSES_KEY);
}

/**
 * S322: the money panel's four views (budget · expenses · burn · settle) now sit behind a segmented
 * control (one at a time). Select a view's tab before *clicking* its controls or asserting they're
 * *visible*; text/count/value assertions (toHaveText/toHaveCount/toHaveValue) read hidden panels
 * fine, so only visibility/action steps need a select. Budget is the default view.
 */
async function showView(page: Page, view: 'budget' | 'expenses' | 'burn' | 'settle') {
  await page.getByTestId(`budget-view-tab-${view}`).click();
}

/** Open the log dialog, fill amount + category (Nepal leg preset), and Save. */
async function logExpense(page: Page, amount: string, category: string) {
  await showView(page, 'expenses'); // S322: the log trigger lives on the Expenses view
  await page.getByTestId('expense-log-open').click();
  await expect(page.getByTestId('expense-dialog')).toBeVisible();
  // Amount is autofocused; fill + tap the category chip.
  await page.getByTestId('expense-amount-input').fill(amount);
  await page.getByTestId(`expense-category-${category}`).click();
  // Leg preset is Nepal (first trip day) outside the trip window — confirm before saving.
  await expect(page.getByTestId('expense-leg-nepal')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('expense-save').click();
  await expect(page.getByTestId('expense-dialog')).toHaveCount(0);
}

test.describe('S102 Expense logging — log/edit/delete feeds spent + remaining, persists', () => {
  test('log an expense: it appears, spent/remaining + grand total update, and it survives reload', async ({
    page,
  }) => {
    await gotoPlanSettled(page);
    await settleBudget(page);

    // Set the Nepal leg budget to 13,800 NPR (= 100 USD at the NPR rate THIS fixture pins, 138), so
    // remaining is meaningful.
    const nepal = page.getByTestId('budget-leg-nepal-input');
    await nepal.fill('13800');
    await nepal.blur();
    await expect(page.getByTestId('budget-grand-total-value')).toHaveText('$100');

    // Log a 6,900 NPR food expense (= 50 USD).
    await logExpense(page, '6900', 'food');

    // It appears in the list.
    await expect(page.getByTestId('expense-list')).toBeVisible();
    await expect(page.getByTestId('expense-log-empty')).toHaveCount(0);
    const rows = page.locator('[data-testid^="expense-item-"][data-testid$="-amount"]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Rs 6,900');

    // The Nepal leg's spent/remaining reflects it (local NPR), and the grand total spend rolls up (USD).
    await expect(page.getByTestId('budget-leg-nepal-spent-remaining-spent')).toHaveText('Rs 6,900');
    await expect(page.getByTestId('budget-leg-nepal-spent-remaining-remaining')).toHaveText('Rs 6,900'); // 13800 − 6900
    await expect(page.getByTestId('budget-grand-total-spent')).toHaveText('$50');
    await expect(page.getByTestId('budget-grand-total-remaining')).toHaveText('$50'); // 100 − 50

    // It persisted to localStorage.
    const stored = await readStored(page);
    expect(stored).not.toBeNull();
    expect(stored).toHaveLength(1);
    expect(stored![0].leg).toBe('nepal');
    expect(stored![0].category).toBe('food');
    expect(stored![0].amount).toBe(6900);

    // RELOAD — the logged expense + the derived totals survive (the hard guarantee for the domain).
    await reloadSettled(page);
    await settleBudget(page);
    await expect(page.locator('[data-testid^="expense-item-"][data-testid$="-amount"]')).toHaveCount(1);
    await expect(page.getByTestId('budget-grand-total-spent')).toHaveText('$50');
    await expect(page.getByTestId('budget-grand-total-remaining')).toHaveText('$50');
  });

  test('over budget: logging more than the budget shows the over-budget cue (negative remaining)', async ({
    page,
  }) => {
    await gotoPlanSettled(page);
    await settleBudget(page);

    const nepal = page.getByTestId('budget-leg-nepal-input');
    await nepal.fill('1000'); // small budget
    await nepal.blur();
    await logExpense(page, '3000', 'transportation'); // spend more than budgeted

    // Remaining goes negative → the panel shows "Over by …" (the over-budget cue). 3000 − 1000 = 2000 over.
    await expect(page.getByTestId('budget-leg-nepal-spent-remaining')).toContainText('Over by');
    await expect(page.getByTestId('budget-leg-nepal-spent-remaining-remaining')).toHaveText('Rs 2,000');
  });

  test('edit an expense: changing the amount updates the list + totals, and persists', async ({
    page,
  }) => {
    await gotoPlanSettled(page);
    await settleBudget(page);

    const nepal = page.getByTestId('budget-leg-nepal-input');
    await nepal.fill('13800');
    await nepal.blur();
    await logExpense(page, '6900', 'food'); // 50 USD
    await expect(page.getByTestId('budget-grand-total-spent')).toHaveText('$50');

    // Open the row's edit control → the dialog opens preset from the expense.
    const editBtn = page.locator('[data-testid^="expense-item-edit-"]').first();
    await editBtn.click();
    await expect(page.getByTestId('expense-dialog')).toBeVisible();
    await expect(page.getByTestId('expense-amount-input')).toHaveValue('6900');
    // Change the amount to 2,760 NPR (= 20 USD).
    await page.getByTestId('expense-amount-input').fill('2760');
    await page.getByTestId('expense-save').click();
    await expect(page.getByTestId('expense-dialog')).toHaveCount(0);

    // The list row + totals update (still one expense).
    await expect(page.locator('[data-testid^="expense-item-"][data-testid$="-amount"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="expense-item-"][data-testid$="-amount"]').first()).toContainText('Rs 2,760');
    await expect(page.getByTestId('budget-grand-total-spent')).toHaveText('$20');
    await expect(page.getByTestId('budget-grand-total-remaining')).toHaveText('$80'); // 100 − 20

    // Persisted amount is the edited value.
    const stored = await readStored(page);
    expect(stored).toHaveLength(1);
    expect(stored![0].amount).toBe(2760);

    // Survives reload.
    await reloadSettled(page);
    await settleBudget(page);
    await expect(page.getByTestId('budget-grand-total-spent')).toHaveText('$20');
  });

  test('split an expense: the "Settle up" summary shows who-owes-whom, persists, and clears back to the fast path', async ({
    page,
  }) => {
    await gotoPlanSettled(page);
    await settleBudget(page);

    // No split logged yet ⇒ the Settle up summary is hidden.
    await expect(page.getByTestId('settle-up')).toHaveCount(0);

    // Log a 300 NPR expense split among all three (default). Powan (the signed-in traveler) pays.
    await showView(page, 'expenses'); // S322: the log trigger lives on the Expenses view
    await page.getByTestId('expense-log-open').click();
    await expect(page.getByTestId('expense-dialog')).toBeVisible();
    await page.getByTestId('expense-amount-input').fill('300');
    await page.getByTestId('expense-category-food').click();
    await expect(page.getByTestId('expense-leg-nepal')).toHaveAttribute('aria-pressed', 'true');
    // Opt into split (default payer = Powan, members = whole roster).
    await page.getByTestId('expense-split-toggle').click();
    await expect(page.getByTestId('expense-split-panel')).toBeVisible();
    await expect(page.getByTestId('expense-payer-Powan')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('expense-save').click();
    await expect(page.getByTestId('expense-dialog')).toHaveCount(0);

    // The row shows a split chip, and the Settle up summary appears with the minimal transfers:
    // 300 split 3 ways = 100 each; Sushil and Uttam each pay Powan Rs 100.
    await expect(page.locator('[data-testid$="-split"]').first()).toBeVisible();
    await showView(page, 'settle'); // S322: the who-owes-whom summary is behind the Settle tab
    await expect(page.getByTestId('settle-up')).toBeVisible();
    await expect(page.getByTestId('settle-up-transfer-nepal-Sushil-Powan')).toContainText('Sushil');
    await expect(page.getByTestId('settle-up-transfer-nepal-Sushil-Powan')).toContainText('Rs 100');
    await expect(page.getByTestId('settle-up-transfer-nepal-Uttam-Powan')).toContainText('Rs 100');
    await expect(page.getByTestId('settle-up-balance-nepal-Powan')).toContainText('is owed');

    // The split fields persisted to localStorage.
    const stored = await readStored(page);
    expect(stored).toHaveLength(1);
    expect(stored![0].paidBy).toBe('Powan');
    expect(stored![0].split).toEqual(['Powan', 'Sushil', 'Uttam']);

    // RELOAD — the split + the Settle up summary survive.
    await reloadSettled(page);
    await settleBudget(page);
    await showView(page, 'settle'); // reload resets to the default Budget view
    await expect(page.getByTestId('settle-up')).toBeVisible();
    await expect(page.getByTestId('settle-up-transfer-nepal-Sushil-Powan')).toContainText('Rs 100');

    // Edit → clear the split → back to the fast path (summary gone, expense unchanged in totals).
    await showView(page, 'expenses'); // the expense rows (+ their edit control) live on Expenses
    await page.locator('[data-testid^="expense-item-edit-"]').first().click();
    await expect(page.getByTestId('expense-dialog')).toBeVisible();
    await expect(page.getByTestId('expense-split-panel')).toBeVisible(); // split was on
    await page.getByTestId('expense-split-toggle').click(); // collapse + clear
    await page.getByTestId('expense-save').click();
    await expect(page.getByTestId('expense-dialog')).toHaveCount(0);

    // Fast path: the Settle up summary is gone and the split fields were cleared from storage.
    await expect(page.getByTestId('settle-up')).toHaveCount(0);
    const cleared = await readStored(page);
    expect(cleared).toHaveLength(1);
    expect(cleared![0].split).toBeUndefined();
    expect(cleared![0].paidBy).toBeUndefined();

    // Survives reload as a fast-path expense.
    await reloadSettled(page);
    await settleBudget(page);
    await expect(page.getByTestId('settle-up')).toHaveCount(0);
    await expect(page.locator('[data-testid^="expense-item-"][data-testid$="-amount"]')).toHaveCount(1);
  });

  test('delete an expense: it is removed, totals revert to no-spend, and persists', async ({
    page,
  }) => {
    await gotoPlanSettled(page);
    await settleBudget(page);

    const nepal = page.getByTestId('budget-leg-nepal-input');
    await nepal.fill('13800');
    await nepal.blur();
    await logExpense(page, '6900', 'food');
    await expect(page.getByTestId('budget-grand-total-spent')).toHaveText('$50');

    // Delete the row.
    await page.locator('[data-testid^="expense-item-delete-"]').first().click();

    // The list empties (empty state returns), and the spend indicators disappear (no spend).
    await expect(page.getByTestId('expense-log-empty')).toBeVisible();
    await expect(page.getByTestId('expense-list')).toHaveCount(0);
    await expect(page.getByTestId('budget-grand-total-spent')).toHaveCount(0);
    // The budget itself is untouched (grand total budget still $100).
    await expect(page.getByTestId('budget-grand-total-value')).toHaveText('$100');

    // Persisted list is now empty ([]), not absent — the delete was written.
    const stored = await readStored(page);
    expect(stored).toEqual([]);

    // Survives reload — still empty.
    await reloadSettled(page);
    await settleBudget(page);
    await showView(page, 'expenses'); // reload resets to the default Budget view
    await expect(page.getByTestId('expense-log-empty')).toBeVisible();
    await expect(page.getByTestId('budget-grand-total-spent')).toHaveCount(0);
  });
});

/**
 * S356 — the expense row's text is CLAMPED above 640px and WRAPS below it.
 *
 * Why this exists: `expense-log.tsx` used to apply `truncate` unconditionally. At 390px the row
 * spends ~150 of its ~241px inner width on the shrink-0 category chip, the two 44px (a11y-floor)
 * icon buttons and three gaps, so the text column is ~89px and EVERY line ellipsised — including
 * the `split N` chip, which vanished entirely. The pack above never saw it: `toHaveText` /
 * `innerText` return the full string regardless of a CSS ellipsis, so those specs were green on a
 * row a phone user could not read. S356 gated the clamp at `sm:`.
 *
 * The pair is the guard, and each half is load-bearing:
 *   - drop the `sm:` gate (clamp at every width) → the 390px assertion goes RED;
 *   - drop the clamp entirely → the 1280px control goes RED.
 * Both were observed failing on a real mutation run before this landed. Geometry
 * (`scrollWidth` vs `clientWidth`) is the instrument ON PURPOSE — the className is what we are
 * testing the effect of, so asserting it would just compare the code to itself, and `innerText`
 * is the exact instrument that was blind here.
 */
test.describe('S356 — expense row clamp behaviour', () => {
  // Long overall, but every WORD is short. Measured: with a 10+ letter word the wrapped line still
  // overhangs the `min-w-0` column by ~6px at 390 (the word alone is wider than the column, and no
  // `overflow-hidden` applies once the clamp is off, so it spills rather than clips). That is a
  // separate, cosmetic effect; keeping the words short means this probe measures ONLY the clamp.
  const LONG_NOTE =
    'Dinner for the group at the izakaya by the station, plus a taxi back to the room after the last train had gone and the rain had not let up yet';

  test('the note wraps at 390 and ellipsises at 1280', async ({ page }) => {
    await page.addInitScript(
      ({ key, note }: { key: string; note: string }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify([
            {
              id: 'clamp-probe',
              leg: 'nepal',
              category: 'food',
              amount: 1234,
              note,
              createdAt: '2026-12-10T00:00:00.000Z',
            },
          ]),
        );
      },
      { key: EXPENSES_KEY, note: LONG_NOTE },
    );

    const probe = page.getByTestId('expense-item-clamp-probe-note');
    const overflow = () => probe.evaluate((el) => el.scrollWidth - el.clientWidth);

    // MOBILE (390): `sm:truncate` is inactive → the note wraps, so nothing is clipped.
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoPlanSettled(page);
    await settleBudget(page);
    await showView(page, 'expenses');
    await expect(probe).toBeVisible();
    expect(await overflow(), 'clipped at 390px — the sm: gate is gone').toBeLessThanOrEqual(0);

    // DESKTOP (1280) — POSITIVE CONTROL: the clamp IS active, so the same note overflows.
    await page.setViewportSize({ width: 1280, height: 900 });
    await reloadSettled(page);
    await settleBudget(page);
    await showView(page, 'expenses');
    await expect(probe).toBeVisible();
    expect(await overflow(), 'not clamped at 1280px — truncate no longer applies').toBeGreaterThan(0);
  });
});
