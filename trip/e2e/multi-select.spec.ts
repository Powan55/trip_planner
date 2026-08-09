import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S130 — multi-select + copy-day E2E pack (dormant `out/` build).
 *
 * Both bulk ops route through the store's ONE-commit choke-point (deleteItems / copyDay), so
 * they inherit the D-018 persistence hard guarantee. This pack proves, on a real run:
 *   1. Bulk delete: enter select mode → select ≥2 items → Delete selected (confirm) → the
 *      selected items are gone, the unselected one stays → reload → still gone → Undo returns
 *      the deleted items and they survive a reload.
 *   2. Copy day: enter select mode → Copy day to another day → the target day gains fresh-id
 *      copies of every item (different ids from the source) → reload → the copies persist.
 *
 * Settle discipline mirrors persistence.spec.ts: navigate to `domcontentloaded`, then block on
 * the real readiness signal (the lazy planner island mounted), never `networkidle`.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const FIXTURE_DAY = '2026-12-20'; // inside the trip window → reachable via calendar-day-*
const DST_DAY = '2026-12-21'; // copy/move target (also in-window)

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

test.describe('S130 multi-select — bulk delete', () => {
  test('select two of three → delete → gone (third stays) → reload → still gone → undo restores', async ({ page }) => {
    await gotoPlan(page);
    await seedFixture(page, [
      { id: 's130-a', title: 'S130 bulk item A' },
      { id: 's130-b', title: 'S130 bulk item B' },
      { id: 's130-c', title: 'S130 bulk item C' },
    ]);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s130-a')).toBeVisible();

    // Enter select mode → checkboxes + bulk bar appear.
    await page.mouse.wheel(0, -5000);
    await page.getByTestId('calendar-select-toggle').click();
    await expect(page.getByTestId('calendar-bulk-bar')).toBeVisible();

    // Select A and C (leave B).
    await page.getByTestId('calendar-item-select-s130-a').check();
    await page.getByTestId('calendar-item-select-s130-c').check();
    await expect(page.getByTestId('calendar-bulk-count')).toHaveText('2 selected');

    // Delete selected → confirm.
    await page.getByTestId('calendar-bulk-delete').click();
    await expect(page.getByTestId('calendar-bulk-delete-confirm')).toBeVisible();
    await page.getByTestId('calendar-bulk-delete-action').click();

    // A and C gone; B remains.
    await expect(page.getByTestId('calendar-item-s130-a')).toHaveCount(0);
    await expect(page.getByTestId('calendar-item-s130-c')).toHaveCount(0);
    await expect(page.getByTestId('calendar-item-s130-b')).toBeVisible();

    await reloadPlan(page);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s130-a')).toHaveCount(0);
    await expect(page.getByTestId('calendar-item-s130-c')).toHaveCount(0);
    await expect(page.getByTestId('calendar-item-s130-b')).toBeVisible();

    // Re-run the delete to get a live Undo toast (the first toast is gone after reload).
    await page.mouse.wheel(0, -5000);
    await page.getByTestId('calendar-select-toggle').click();
    await page.getByTestId('calendar-item-select-s130-b').check();
    await page.getByTestId('calendar-bulk-delete').click();
    await page.getByTestId('calendar-bulk-delete-action').click();
    await expect(page.getByTestId('calendar-item-s130-b')).toHaveCount(0);

    // Undo returns the item; it survives a reload (dormant: same id).
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('calendar-item-s130-b')).toBeVisible();
    await reloadPlan(page);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s130-b')).toBeVisible();
  });
});

/**
 * S396 (open item B) — bulk move gained the Undo its two destructive siblings already had.
 *
 * 🔴 SCOPE OF THIS PROOF, stated so it is not over-read: `out/` is the DORMANT build, where a move
 * preserves item ids. An inverse built from the ORIGINAL (selected) ids therefore WORKS here — so
 * this spec CANNOT discriminate the sync-only defect the docblock on `moveItems` warns about. It
 * proves the user-visible round trip: the toast appears, Undo returns the items, and both the move
 * and the undo survive a reload. The discriminating proof (sync on, fresh landed ids) lives in
 * `lib/__tests__/use-itinerary-bulk-sync.test.ts`.
 */
test.describe('S396 multi-select — bulk move + Undo', () => {
  test('select two → move to another day → persists → re-move → Undo returns them → persists', async ({ page }) => {
    const titleA = 'S396 move item A';
    const titleB = 'S396 move item B';
    const titleC = 'S396 move item C';

    await gotoPlan(page);
    await seedFixture(page, [
      { id: 's396-a', title: titleA },
      { id: 's396-b', title: titleB },
      { id: 's396-c', title: titleC },
    ]);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s396-a')).toBeVisible();

    // Select A and C, move them to DST_DAY.
    await page.mouse.wheel(0, -5000);
    await page.getByTestId('calendar-select-toggle').click();
    await page.getByTestId('calendar-item-select-s396-a').check();
    await page.getByTestId('calendar-item-select-s396-c').check();
    await expect(page.getByTestId('calendar-bulk-count')).toHaveText('2 selected');
    await page.getByTestId('calendar-bulk-move-select').selectOption(DST_DAY);

    // Gone from the source day; B (unselected) stays. The sibling copy is shown.
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: titleA }),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: titleC }),
    ).toHaveCount(0);
    await expect(page.getByTestId('calendar-item-s396-b')).toBeVisible();
    await expect(page.getByText('Moved 2 items')).toBeVisible();

    // They landed on the target, and the move survives a reload.
    await page.getByTestId(`calendar-day-${DST_DAY}`).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: titleA }),
    ).toHaveCount(1);
    await reloadPlan(page);
    await page.getByTestId(`calendar-day-${DST_DAY}`).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: titleA }),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: titleC }),
    ).toHaveCount(1);

    // Re-run a move (the first toast died with the reload) so there is a LIVE Undo to click.
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s396-b')).toBeVisible();
    await page.mouse.wheel(0, -5000);
    await page.getByTestId('calendar-select-toggle').click();
    await page.getByTestId('calendar-item-select-s396-b').check();
    await page.getByTestId('calendar-bulk-move-select').selectOption(DST_DAY);
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: titleB }),
    ).toHaveCount(0);
    await expect(page.getByText('Moved 1 item')).toBeVisible();

    // Undo puts it back on the day it came from — and that survives a reload.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: titleB }),
    ).toHaveCount(1);
    await reloadPlan(page);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: titleB }),
    ).toHaveCount(1);
    // …and it did NOT stay on the target day.
    await page.getByTestId(`calendar-day-${DST_DAY}`).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: titleB }),
    ).toHaveCount(0);
  });
});

test.describe('S130 copy-day — fresh-id copies onto another day', () => {
  test('copy the whole day → target gains fresh-id copies → reload persists', async ({ page }) => {
    const titleA = 'S130 copyday Temple';
    const titleB = 'S130 copyday Ramen';

    await gotoPlan(page);
    await seedFixture(page, [
      { id: 's130-cp-a', title: titleA, category: 'cultural' },
      { id: 's130-cp-b', title: titleB, category: 'food' },
    ]);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s130-cp-a')).toBeVisible();

    // Enter select mode and copy the whole day to DST_DAY.
    await page.mouse.wheel(0, -5000);
    await page.getByTestId('calendar-select-toggle').click();
    await page.getByTestId('calendar-bulk-copy-select').selectOption(DST_DAY);

    // The target day now holds fresh-id copies of both items (different ids from source).
    await page.getByTestId(`calendar-day-${DST_DAY}`).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: titleA }),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: titleB }),
    ).toHaveCount(1);
    const copyAIds = await itemIdsWithTitle(page, titleA);
    expect(copyAIds).toHaveLength(1);
    expect(copyAIds[0]).not.toBe('s130-cp-a'); // fresh id, never the source id

    await reloadPlan(page);
    await page.getByTestId(`calendar-day-${DST_DAY}`).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: titleA }),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: titleB }),
    ).toHaveCount(1);
    // The source day still has its originals.
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s130-cp-a')).toBeVisible();
    await expect(page.getByTestId('calendar-item-s130-cp-b')).toBeVisible();
  });
});
