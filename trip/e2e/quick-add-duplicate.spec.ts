import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S128 — inline quick-add + duplicate-item E2E pack (dormant `out/` build).
 *
 * Both features route through the EXISTING `addItem` → `commit()` choke-point (no new store
 * code), so they inherit the D-018 persistence hard guarantee. This pack proves, on a real run:
 *   1. Calendar inline quick-add: focus the one-line input → type a title → Enter → the item
 *      appears on the selected day → reload → it persists.
 *   2. Today-panel inline quick-add (the agenda that previously had NO add input): same flow
 *      on today's date, in-trip via the `?today=` override.
 *   3. Duplicate-item: duplicate an existing item → two items with the SAME content but
 *      DIFFERENT ids → reload → both persist (the fresh-id guarantee — never reuse the id).
 *
 * Settle discipline mirrors persistence.spec.ts / today.spec.ts: navigate to
 * `domcontentloaded`, then block on a real readiness signal (the lazy island mounted), never
 * `networkidle` (the production SW precaches ~112 entries, so the network never goes quiet).
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
// A trip date reserved for these specs (inside the window → reachable via calendar-day-*).
const FIXTURE_DAY = '2026-12-20';
// An in-trip date for the Today panel (Day 4, Kathmandu) — the `?today=` clock we drive.
const IN_TRIP_DAY = '2026-12-12';

async function waitForPlannerReady(page: Page) {
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'visible' });
}
async function gotoPlan(page: Page) {
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}
async function reloadPlan(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}

/** Seed one controlled DayPlan on FIXTURE_DAY (bypassing the 32-day sample) and reload. */
async function seedFixture(
  page: Page,
  items: Array<{ id: string; title: string; category?: string }>,
) {
  await page.evaluate(
    ({ key, date, items }: { key: string; date: string; items: Array<{ id: string; title: string; category?: string }> }) => {
      const dayPlan = {
        date,
        city: 'Tokyo',
        country: 'japan',
        items: items.map((i) => ({ id: i.id, title: i.title, category: i.category ?? 'sightseeing' })),
      };
      window.localStorage.setItem(key, JSON.stringify([dayPlan]));
    },
    { key: ITINERARY_KEY, date: FIXTURE_DAY, items },
  );
  await reloadPlan(page);
}

/** The data-testid suffixes (item ids) of every rendered card whose text contains `title`. */
async function itemIdsWithTitle(page: Page, title: string): Promise<string[]> {
  return page
    .locator('[data-testid^="calendar-item-"]')
    .filter({ hasText: title })
    .evaluateAll((els) =>
      els.map((e) => (e.getAttribute('data-testid') ?? '').replace('calendar-item-', '')),
    );
}

test.describe('S128 inline quick-add — calendar', () => {
  test('type a title, press Enter, the item appears and survives reload', async ({ page }) => {
    const title = `S128 quick-add ${Date.now()}`;

    await gotoPlan(page);
    // Clean, deterministic empty day (no 32-day sample noise).
    await page.evaluate((key) => window.localStorage.setItem(key, '[]'), ITINERARY_KEY);
    await reloadPlan(page);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();

    const input = page.getByTestId('calendar-quick-add');
    await input.click();
    await input.pressSequentially(title, { delay: 10 });
    await input.press('Enter');

    // The item appears on the day, located by rendered title (id is generated).
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: title }),
    ).toHaveCount(1);
    // Input cleared after a successful add.
    await expect(input).toHaveValue('');

    await reloadPlan(page);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: title }),
    ).toHaveCount(1);
  });

  // S357A — the composer is now the PRIMARY add path and it extracts a time from the typed
  // text. `lib/__tests__/quick-add-parse.test.ts` pins the pure extractor; this test pins the
  // WIRING, which a unit test cannot see: that `handleQuickAdd` passes the extracted minutes
  // into `addItem`, that the peeled token does NOT survive into the stored title, and that the
  // composer writes the same `startMinutes` + `HH:MM` pair the full editor writes (D-138) —
  // through the same commit() choke-point, so D-018 still holds across a reload.
  test('a leading or trailing time token is extracted into the item; a bare title stays untimed', async ({ page }) => {
    await gotoPlan(page);
    await page.evaluate((key) => window.localStorage.setItem(key, '[]'), ITINERARY_KEY);
    await reloadPlan(page);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();

    const input = page.getByTestId('calendar-quick-add');
    for (const typed of ['7pm S357A dinner', 'S357A ramen 08:30', 'S357A untimed walk']) {
      await input.click();
      await input.pressSequentially(typed, { delay: 10 });
      await input.press('Enter');
      await expect(input).toHaveValue('');
    }

    const card = (title: string) =>
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: title });

    // Leading token: the title lost "7pm" and the card renders the extracted time.
    await expect(card('S357A dinner')).toHaveCount(1);
    await expect(card('S357A dinner')).toContainText('7:00 PM');
    await expect(card('S357A dinner')).not.toContainText('7pm');
    // Trailing token: same, from the other end.
    await expect(card('S357A ramen')).toHaveCount(1);
    await expect(card('S357A ramen')).toContainText('8:30 AM');
    await expect(card('S357A ramen')).not.toContainText('08:30');
    // No time in the text ⇒ an untimed item, exactly as before this slice.
    await expect(card('S357A untimed walk')).toHaveCount(1);
    await expect(card('S357A untimed walk')).not.toContainText(/AM|PM/);

    // The stored shape is the editor's shape: BOTH `startMinutes` and the legacy `HH:MM`
    // string (D-138 dual-write). Read straight off the persisted key, not off the DOM.
    const stored = await page.evaluate(
      ({ key, date }) => {
        // On disk this is the Trip Vault envelope `{ schemaVersion, updatedAt, payload }`
        // (D-095/D-096); a legacy bare array is also a valid stored shape. Accept both.
        const raw = JSON.parse(window.localStorage.getItem(key) ?? '[]');
        type StoredItem = { title: string; time?: string; startMinutes?: number };
        const plans: Array<{ date: string; items?: StoredItem[] }> = Array.isArray(raw) ? raw : raw.payload;
        const day = plans.find((p) => p.date === date);
        return (day?.items ?? []).map((i) => ({
          title: i.title,
          time: i.time,
          startMinutes: i.startMinutes,
        }));
      },
      { key: ITINERARY_KEY, date: FIXTURE_DAY },
    );
    expect(stored).toEqual(
      expect.arrayContaining([
        { title: 'S357A dinner', time: '19:00', startMinutes: 1140 },
        { title: 'S357A ramen', time: '08:30', startMinutes: 510 },
        { title: 'S357A untimed walk', time: undefined, startMinutes: undefined },
      ]),
    );

    // D-018: all three survive the reload with their times intact.
    await reloadPlan(page);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(card('S357A dinner')).toContainText('7:00 PM');
    await expect(card('S357A ramen')).toContainText('8:30 AM');
    await expect(card('S357A untimed walk')).toHaveCount(1);
  });

  test('a blank title is a no-op (Enter with whitespace adds nothing)', async ({ page }) => {
    await gotoPlan(page);
    await page.evaluate((key) => window.localStorage.setItem(key, '[]'), ITINERARY_KEY);
    await reloadPlan(page);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();

    const input = page.getByTestId('calendar-quick-add');
    await input.click();
    await input.pressSequentially('   ', { delay: 10 });
    await input.press('Enter');

    await expect(page.getByTestId('calendar-empty-state')).toBeVisible();
    await expect(page.locator('[data-testid^="calendar-item-"]')).toHaveCount(0);
  });
});

test.describe('S128 duplicate-item — fresh id, same content', () => {
  test('duplicate → two items, same content, different ids → both persist', async ({ page }) => {
    const title = 'S128 Ramen at Ichiran';

    await gotoPlan(page);
    await seedFixture(page, [{ id: 's128-dup-src', title, category: 'food' }]);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s128-dup-src')).toBeVisible();

    // Open the duplicate picker and copy onto THIS day, so both copies are visible together.
    await page.mouse.wheel(0, -5000);
    await page.getByTestId('calendar-item-duplicate-s128-dup-src').click();
    await page
      .getByTestId('calendar-item-duplicate-select-s128-dup-src')
      .selectOption(FIXTURE_DAY);

    // Two cards with the same title now exist.
    const idsBefore = await itemIdsWithTitle(page, title);
    expect(idsBefore.length).toBe(2);
    // The copy carries a FRESH id — never the source id, and distinct from each other.
    expect(idsBefore[0]).not.toBe(idsBefore[1]);
    expect(idsBefore).toContain('s128-dup-src');
    const copyId = idsBefore.find((id) => id !== 's128-dup-src');
    expect(copyId).toBeTruthy();
    expect(copyId).not.toBe('s128-dup-src');

    await reloadPlan(page);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    const idsAfter = await itemIdsWithTitle(page, title);
    expect(idsAfter.length).toBe(2);
    expect(idsAfter[0]).not.toBe(idsAfter[1]);
    // Both the source and the fresh-id copy survived the reload.
    expect(idsAfter).toContain('s128-dup-src');
    expect(idsAfter).toContain(copyId);
  });
});

test.describe('S128 inline quick-add — Today panel', () => {
  async function gotoHomeInTrip(page: Page) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/?today=${IN_TRIP_DAY}`, { waitUntil: 'domcontentloaded' });
  }

  test('Today agenda quick-add: type + Enter adds an item that survives reload', async ({ page }) => {
    const title = `S128 today quick-add ${Date.now()}`;

    await gotoHomeInTrip(page);
    // Start from an empty itinerary so the in-trip day is deterministic.
    await page.evaluate((key) => window.localStorage.setItem(key, '[]'), ITINERARY_KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('today-panel')).toBeVisible();
    const input = page.getByTestId('today-quick-add');
    await input.click();
    await input.pressSequentially(title, { delay: 10 });
    await input.press('Enter');

    // The new item shows in today's agenda.
    await expect(
      page.locator('[data-testid="today-agenda-item"]').filter({ hasText: title }),
    ).toHaveCount(1);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('today-panel')).toBeVisible();
    await expect(
      page.locator('[data-testid="today-agenda-item"]').filter({ hasText: title }),
    ).toHaveCount(1);
  });
});
