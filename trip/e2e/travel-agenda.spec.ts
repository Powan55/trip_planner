import { test, expect } from './fixtures';
import type { Page, ConsoleMessage } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * S186 — Travel Mode agenda E2E pack (the shared `TripAgenda`, travel variant).
 *
 * Runs against the served static `out/` build (D-093) on the DEFAULT (signed-in) identity, so
 * `/travel` is reachable with no gate. The clock is driven by the D-075 `?today=` override (local
 * NOON of the day) exactly like the S185 hero pack. `2026-12-10` is a Nepal day (NPT +5:45); under
 * `?today=2026-12-10` "now" is 12:00 NPT.
 *
 * Seeding is a GUARDED `addInitScript` (sets the fixture only when the key is absent), so it seeds
 * ONCE on first paint and then NEVER overwrites — a toggle survives a reload AND a cross-route
 * navigation to Home, which is exactly how we prove the done-state is the SAME store the Today
 * panel reads (a TM toggle reflects on `/`).
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const DAY = '2026-12-10';

type SeedItem = {
  id: string;
  title: string;
  category: string;
  startMinutes?: number;
  durationMinutes?: number;
  location?: string;
  done?: boolean;
};

/** Guarded seed: sets the fixture only if the itinerary key is absent (survives reload/nav). */
async function seedDay(page: Page, items: SeedItem[]) {
  await page.addInitScript(
    ({ key, day, items }) => {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(
        key,
        JSON.stringify([{ date: day, city: 'Kathmandu', country: 'nepal', items }]),
      );
    },
    { key: ITINERARY_KEY, day: DAY, items },
  );
}

async function gotoTravel(page: Page, opts: { reduced?: boolean } = {}) {
  if (opts.reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/travel/?today=${DAY}`, { waitUntil: 'load' });
  await expect(page.getByTestId('travel-agenda')).toBeVisible();
}

// A now item (11:00–13:00, in progress at noon), an upcoming item (15:00), and an untimed one.
const FIXTURE: SeedItem[] = [
  { id: 'ta-now', title: 'Boudhanath walk', category: 'photography', startMinutes: 660, durationMinutes: 120 },
  { id: 'ta-next', title: 'Thamel lunch', category: 'food', startMinutes: 900, location: 'Thamel' },
  { id: 'ta-untimed', title: 'Souvenir hunt', category: 'sightseeing' },
];

test.describe('S186 · rows render for a seeded day, with per-row phase from the shared machine', () => {
  test('one row per item, phases now / upcoming / untimed match deriveRowPhases', async ({ page }) => {
    await seedDay(page, FIXTURE);
    await gotoTravel(page);

    await expect(page.locator('[data-testid="travel-agenda-item"]')).toHaveCount(3);
    await expect(page.getByTestId('travel-done-toggle-ta-now')).toHaveAttribute('data-row-phase', 'now');
    await expect(page.getByTestId('travel-done-toggle-ta-next')).toHaveAttribute('data-row-phase', 'upcoming');
    await expect(page.getByTestId('travel-done-toggle-ta-untimed')).toHaveAttribute('data-row-phase', 'untimed');
  });
});

test.describe('S186 · rows are ≥48pt tall (real boundingBox)', () => {
  test('every agenda row measures at least 48px high', async ({ page }) => {
    await seedDay(page, FIXTURE);
    await gotoTravel(page);

    const rows = page.locator('[data-testid^="travel-done-toggle-"]');
    const count = await rows.count();
    expect(count).toBe(3);
    for (let i = 0; i < count; i++) {
      const box = await rows.nth(i).boundingBox();
      expect(box, `row ${i} has a box`).not.toBeNull();
      expect(box!.height, `row ${i} height`).toBeGreaterThanOrEqual(48);
    }
  });
});

test.describe('S186 · done-toggle persists across reload AND reflects on the Today panel', () => {
  test('toggle in TM → survives reload → the same item is done on Home /', async ({ page }) => {
    await seedDay(page, FIXTURE);
    await gotoTravel(page);

    const toggle = page.getByTestId('travel-done-toggle-ta-next');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // It persisted to localStorage as done:true.
    const doneOnDisk = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const days = Array.isArray(parsed) ? parsed : parsed.payload;
      const item = days
        .flatMap((d: { items: { id: string; done?: boolean }[] }) => d.items)
        .find((i: { id: string }) => i.id === 'ta-next');
      return item ? item.done === true : null;
    }, ITINERARY_KEY);
    expect(doneOnDisk).toBe(true);

    // Reload — the done state survives (the guarded seed does NOT re-write the key).
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('travel-done-toggle-ta-next')).toHaveAttribute('aria-pressed', 'true');

    // Cross-route to Home under the same in-trip clock: the Today panel reads the SAME store,
    // so the SAME item shows done — one source of truth (D-018).
    await page.goto(`/?today=${DAY}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('today-panel')).toBeVisible();
    const homeToggle = page.getByTestId('today-done-toggle-ta-next');
    await expect(homeToggle).toBeVisible();
    await expect(homeToggle).toHaveAttribute('aria-pressed', 'true');
    // A sibling item stayed not-done — the toggle is per-item.
    await expect(page.getByTestId('today-done-toggle-ta-now')).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('S186 · empty day shows an honest empty state, not rows', () => {
  test('a zero-item in-trip day renders the empty state', async ({ page }) => {
    await page.addInitScript((key: string) => {
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, '[]');
    }, ITINERARY_KEY);
    await page.goto(`/travel/?today=${DAY}`, { waitUntil: 'load' });

    await expect(page.getByTestId('travel-agenda-empty')).toBeVisible();
    await expect(page.locator('[data-testid="travel-agenda-item"]')).toHaveCount(0);
  });
});

test.describe('S186 · axe — /travel with the agenda populated', () => {
  test('zero serious/critical violations', async ({ page }, testInfo) => {
    await seedDay(page, FIXTURE);
    await gotoTravel(page);

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    for (const v of results.violations) {
      testInfo.annotations.push({
        type: `axe:${v.impact ?? 'unknown'}`,
        description: `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})`,
      });
    }
    expect(blocking, blocking.map((v) => `${v.id} [${v.impact}]`).join('; ')).toEqual([]);
  });
});

test.describe('S186 · no console errors', () => {
  test('the agenda loads and toggles with no console.error / pageerror', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    await seedDay(page, FIXTURE);
    await gotoTravel(page);
    await page.getByTestId('travel-done-toggle-ta-untimed').click();
    await expect(page.getByTestId('travel-done-toggle-ta-untimed')).toHaveAttribute('aria-pressed', 'true');

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
