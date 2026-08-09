import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S103 — Burn-rate vs plan + calendar cost overlays (Yen & Rupee 3) E2E pack.
 *
 * Layers onto the S101 budget panel + S102 expense log with NO reshape: the burn-rate view
 * (`burn-rate`, in the budget panel) reads the SAME live `rollUp` totals + the trip clock and shows
 * spending pace (spent-vs-budget bar, days elapsed/remaining, daily avg vs budget, projected total,
 * under/on/over). The calendar cost overlay (`calendar-day-spend-total` single-day readout +
 * `calendar-day-<date>-spend` month-grid markers) is a READ-ONLY display add on the D-018 calendar.
 *
 * These specs prove the centrepiece on a real run, MID-TRIP via the D-075 `?today=` override:
 *   1. Under `?today=2026-12-12` (Day 4, Nepal): set a budget, log dated expenses → the burn-rate
 *      view shows the real elapsed day count, spent figure, a pace badge, and a projected total.
 *   2. A day with logged spend shows the single-day spend readout (leg-local NPR) in the calendar,
 *      and a subtle month-grid marker on that day.
 *   3. Reload persists — the burn-rate figures + the calendar spend readout reflect the persisted
 *      expenses (the D-018-class hard guarantee, and the proof the read-only overlay survives).
 *
 * ── SETTLE DISCIPLINE (mirrors expenses.spec.ts / today.spec.ts) ────────────────────────────
 * `/plan` lazy-mounts the budget panel + calendar as `ssr:false` islands that hydrate from
 * localStorage in mount effects, and resolves the `?today=` override once per load. Every
 * navigation/reload goes through `waitUntil:'domcontentloaded'` + a settle that blocks until the panel is
 * visible and hydration has resolved, so no assertion runs against a transient pre-hydrate frame.
 * The override persists in sessionStorage across a same-tab reload, so the clock stays mid-trip.
 */

const EXPENSES_KEY = 'nepal_japan_expenses';
// Day 4 of the trip (Kathmandu / Nepal window) — the clock override we drive so burn-rate is mid-trip.
const IN_TRIP_DAY = '2026-12-12';

/** Navigate to /plan with the `?today=` override + reduced motion pinned. */
async function gotoPlanWithClock(page: Page, todayParam: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/plan/?today=${todayParam}`, { waitUntil: 'domcontentloaded' });
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

/**
 * S322: the money panel's four views (budget · expenses · burn · settle) now sit behind a segmented
 * control (one at a time). Select a view's tab before asserting on its content / clicking its
 * controls. The budget view is the default, so budget inputs + grand total need no select.
 */
async function showView(page: Page, view: 'budget' | 'expenses' | 'burn' | 'settle') {
  await page.getByTestId(`budget-view-tab-${view}`).click();
}

/**
 * Open the log dialog, fill amount + category, and Save. Under the `?today=2026-12-12` clock the host
 * presets the leg to Nepal AND the date to 2026-12-12 (the in-trip day), so the logged expense is
 * attributed to that day with no extra taps — which is what the calendar overlay reads.
 */
async function logExpense(page: Page, amount: string, category: string) {
  await showView(page, 'expenses'); // S322: the log trigger lives on the Expenses view
  await page.getByTestId('expense-log-open').click();
  await expect(page.getByTestId('expense-dialog')).toBeVisible();
  await page.getByTestId('expense-amount-input').fill(amount);
  await page.getByTestId(`expense-category-${category}`).click();
  await expect(page.getByTestId('expense-leg-nepal')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('expense-save').click();
  await expect(page.getByTestId('expense-dialog')).toHaveCount(0);
}

/** Read the raw persisted expense list from localStorage (null when unset). */
async function readStored(page: Page): Promise<Array<Record<string, unknown>> | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, EXPENSES_KEY);
}

test.describe('S103 Burn-rate vs plan — pace figures over the live budget + clock', () => {
  test('mid-trip: setting a budget + logging spend shows elapsed days, spent, pace, and a projected total', async ({
    page,
  }) => {
    await gotoPlanWithClock(page, IN_TRIP_DAY);
    await settleBudget(page);

    // Set the Nepal leg budget to 27,600 NPR (= 200 USD at the seed rate 138) so there's a plan to
    // pace against. The daily budget is 200/32 ≈ $6.25/day.
    await page.getByTestId('budget-leg-nepal-input').fill('27600');
    await expect(page.getByTestId('budget-grand-total-value')).toHaveText('$200');

    // Before any spend, the burn-rate view is present (budget is set) and reads the real elapsed day.
    // The elapsed-day value lives in the figure's <dd> (burn-rate-days); the "N days left" sub-line
    // is a sibling <p> in the same figure card, so assert it against the burn-rate root.
    await showView(page, 'burn'); // S322: the burn-rate view is behind its own tab now
    await expect(page.getByTestId('burn-rate')).toBeVisible();
    await expect(page.getByTestId('burn-rate-days')).toHaveText('Day 4 / 32');
    await expect(page.getByTestId('burn-rate')).toContainText('28 days left');

    // Log a 6,900 NPR food expense (= 50 USD), attributed to 2026-12-12 by the host preset.
    await logExpense(page, '6900', 'food');

    // The burn-rate view now shows the spend (home currency USD) and a concrete percentage.
    await showView(page, 'burn'); // logExpense left us on the Expenses tab
    await expect(page.getByTestId('burn-rate-spent')).toHaveText('$50');
    await expect(page.getByTestId('burn-rate-percent')).toHaveText('25%'); // 50 / 200

    // Daily average = 50 spent / 4 elapsed days = $12.50 → rounds to $13 (formatMoney is whole units).
    await expect(page.getByTestId('burn-rate-daily-avg')).toHaveText('$13');

    // Projected total at this pace = (50/4) * 32 = $400 — double the $200 budget → OVER pace.
    await expect(page.getByTestId('burn-rate-projected')).toHaveText('$400');
    await expect(page.getByTestId('burn-rate-pace')).toHaveAttribute('data-pace', 'over');
    await expect(page.getByTestId('burn-rate-pace')).toContainText('Over pace');

    // The progressbar exposes the spent percentage to AT.
    await expect(page.getByTestId('burn-rate').locator('[role="progressbar"]')).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
  });

  test('pace reads UNDER when spending slowly against a generous budget', async ({ page }) => {
    await gotoPlanWithClock(page, IN_TRIP_DAY);
    await settleBudget(page);

    // A large budget: 138,000 NPR (= 1000 USD) → daily budget $31.25.
    await page.getByTestId('budget-leg-nepal-input').fill('138000');
    await expect(page.getByTestId('budget-grand-total-value')).toHaveText('$1,000');

    // Spend just 1,380 NPR (= 10 USD) over 4 days → $2.50/day → projected $80 << $1000 → under.
    await logExpense(page, '1380', 'food');
    await showView(page, 'burn'); // logExpense left us on the Expenses tab
    await expect(page.getByTestId('burn-rate-pace')).toHaveAttribute('data-pace', 'under');
    await expect(page.getByTestId('burn-rate-pace')).toContainText('Under pace');
    await expect(page.getByTestId('burn-rate-projected')).toHaveText('$80');
  });
});

test.describe('S103 Calendar cost overlay — read-only per-day spend (D-018 preserved)', () => {
  test('a day with logged spend shows the single-day readout + a month-grid marker, and persists', async ({
    page,
  }) => {
    await gotoPlanWithClock(page, IN_TRIP_DAY);
    await settleBudget(page);

    // The calendar's travel-mode default selects today (2026-12-12) under the override, so the
    // single-day view is already on the day we'll log against.
    await page.getByTestId('budget-leg-nepal-input').fill('27600');
    // Log a dated Nepal expense (attributed to 2026-12-12 by the host preset).
    await logExpense(page, '5000', 'food');

    // Confirm it persisted WITH the in-trip date (this is what the overlay buckets on).
    const stored = await readStored(page);
    expect(stored).not.toBeNull();
    expect(stored).toHaveLength(1);
    expect(stored![0].date).toBe(IN_TRIP_DAY);
    expect(stored![0].amount).toBe(5000);

    // The single-day spend readout appears in the calendar day-detail (leg-local NPR).
    const dayReadout = page.getByTestId('calendar-day-spend-total');
    await expect(dayReadout).toBeVisible();
    await expect(dayReadout).toContainText('Rs 5,000');

    // The month-grid cell for that day carries the subtle spend marker AND an extended aria-label
    // that still includes the activity text (extended, not replaced — D-018).
    await expect(page.getByTestId(`calendar-day-${IN_TRIP_DAY}-spend`)).toHaveCount(1);
    await expect(page.getByTestId(`calendar-day-${IN_TRIP_DAY}`)).toHaveAttribute(
      'aria-label',
      /activities planned.*Rs 5,000 spent/,
    );

    // A different in-trip day with NO spend shows neither the marker nor a readout for it.
    await expect(page.getByTestId('calendar-day-2026-12-14-spend')).toHaveCount(0);

    // RELOAD — the persisted expense still drives the single-day readout + the marker.
    await reloadSettled(page);
    await settleBudget(page);
    await expect(page.getByTestId('calendar-day-spend-total')).toContainText('Rs 5,000');
    await expect(page.getByTestId(`calendar-day-${IN_TRIP_DAY}-spend`)).toHaveCount(1);
  });

  test('selecting a no-spend day hides the single-day readout (only spend days show it)', async ({
    page,
  }) => {
    await gotoPlanWithClock(page, IN_TRIP_DAY);
    await settleBudget(page);

    await page.getByTestId('budget-leg-nepal-input').fill('27600');
    await logExpense(page, '5000', 'food'); // logged to 2026-12-12
    await expect(page.getByTestId('calendar-day-spend-total')).toBeVisible();

    // Select a different day (Day 6, no spend) — the readout disappears (it's per selected day).
    await page.getByTestId('calendar-day-2026-12-14').click();
    await expect(page.getByTestId('calendar-day-spend-total')).toHaveCount(0);

    // Back to the spend day — it returns.
    await page.getByTestId(`calendar-day-${IN_TRIP_DAY}`).click();
    await expect(page.getByTestId('calendar-day-spend-total')).toContainText('Rs 5,000');
  });
});
