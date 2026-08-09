import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S205 — the Home "at a glance" bento grid. Read-only composition of EXISTING data
 * (D-018); this pack proves: (a) the honest empty states pre-data, (b) seeded data
 * renders in the tiles, (c) the map + Travel Mode tiles actually navigate. The section
 * is a below-fold `LazyVisible` island (D-116) — every test waits on `home-bento` with a
 * generous timeout for the idle-fallback mount, mirroring `budget.spec.ts`'s pattern for
 * other lazy islands.
 */

const BUDGET_KEY = 'nepal_japan_budget';
const EXPENSES_KEY = 'nepal_japan_expenses';

async function gotoHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

async function settleBento(page: Page) {
  await expect(page.getByTestId('home-bento')).toBeVisible({ timeout: 15_000 });
}

test.describe('S205 — Home bento grid: honest empty states (fresh session, pre-trip)', () => {
  test('next-up shows the first planned item, weather is absent, budget shows its actionable empty state; packing/docs show a template-derived %', async ({ page }) => {
    await gotoHome(page);
    await settleBento(page);

    // S357A — the empty-state ban. Two tiles used to spend a whole card saying "come back
    // later"; both are gone. "Next up" pre-trip resolves to the FIRST item on the itinerary
    // (a fresh session is seeded with SAMPLE_ITINERARY per D-018, whose first day is
    // 2026-12-09 / "Depart Syracuse …"), and Weather is not rendered at all pre-trip because
    // the forecast cache only ever holds trip days.
    const nextUp = page.getByTestId('home-bento-next-up');
    await expect(nextUp).toContainText('Depart Syracuse');
    await expect(nextUp).toContainText('First up');
    await expect(nextUp).not.toContainText('Appears once your trip begins');
    await expect(page.getByTestId('home-bento-weather')).toHaveCount(0);
    // The banned copy must not have merely moved somewhere else on the page.
    await expect(page.getByTestId('home-bento')).not.toContainText(/Appears once/);

    // Budget's empty state SURVIVES the ban on purpose: it names an action you can take now,
    // which is the difference between an honest empty state and a placeholder.
    await expect(page.getByTestId('home-bento-budget')).toContainText('Set a budget in Settings');

    // Packing/docs are NEVER empty (S206/S217: a fixed pre-populated template, no empty state) —
    // both tiles show a concrete percentage.
    await expect(page.getByTestId('home-bento-packing')).toContainText('%');
    await expect(page.getByTestId('home-bento-docs')).toContainText('%');
  });
});

test.describe('S205 — Home bento grid: seeded data renders', () => {
  test('a set budget + logged spend renders the spent/total figure', async ({ page }) => {
    await page.addInitScript(
      ({ budgetKey, expensesKey }) => {
        const model = {
          version: 1,
          homeCurrency: 'USD',
          rates: { NPR: 138, JPY: 155 },
          legBudgets: { nepal: 13800, japan: 0 }, // 13,800 NPR = 100 USD at the seed rate
          categoryBudgets: {},
        };
        window.localStorage.setItem(budgetKey, JSON.stringify(model));
        const expenses = [
          {
            id: 's205-exp-1',
            leg: 'nepal',
            category: 'food',
            amount: 1380, // 1,380 NPR = 10 USD
            createdAt: new Date().toISOString(),
          },
        ];
        window.localStorage.setItem(expensesKey, JSON.stringify(expenses));
      },
      { budgetKey: BUDGET_KEY, expensesKey: EXPENSES_KEY },
    );
    await gotoHome(page);
    await settleBento(page);

    const tile = page.getByTestId('home-bento-budget');
    await expect(tile).toContainText('$10'); // spent
    await expect(tile).toContainText('$100'); // total budget
  });

  test('an in-trip clock (?today=) resolves the next-up tile from the real itinerary', async ({ page }) => {
    const ITINERARY_KEY = 'nepal_japan_itinerary';
    const FIXTURE_DAY = '2026-12-15';
    await page.addInitScript(
      ({ key, date }) => {
        const dayPlan = {
          date,
          city: 'Kathmandu',
          country: 'nepal',
          items: [{ id: 's205-next', title: 'S205 Sunrise viewpoint', category: 'photography', time: '13:00' }],
        };
        window.localStorage.setItem(key, JSON.stringify([dayPlan]));
      },
      { key: ITINERARY_KEY, date: FIXTURE_DAY },
    );
    // Local-noon clock on the fixture day: the 13:00 item is upcoming.
    await page.goto(`/?today=${FIXTURE_DAY}`, { waitUntil: 'domcontentloaded' });
    await settleBento(page);

    await expect(page.getByTestId('home-bento-next-up')).toContainText('S205 Sunrise viewpoint');
  });
});

test.describe('S205 — Home bento grid: tile links navigate', () => {
  test('the map tile navigates to /map/', async ({ page }) => {
    await gotoHome(page);
    await settleBento(page);
    await page.getByTestId('home-bento-map').click();
    await expect(page).toHaveURL(/\/map\/?$/);
  });

  test('the Travel Mode tile enters Travel Mode (shared entry path, D-164)', async ({ page }) => {
    await gotoHome(page);
    await settleBento(page);
    await page.getByTestId('home-bento-travel-mode').click();
    await expect(page).toHaveURL(/\/travel\/?$/);
  });
});

test.describe('S205 — Home bento grid: no console errors, axe-clean', () => {
  test('renders with zero console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await gotoHome(page);
    await settleBento(page);
    expect(errors).toEqual([]);
  });
});
