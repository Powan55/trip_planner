import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S318 — "Log something different" inline quick-add (Lane T, T3).
 *
 * Proves the S318 slot under the /travel checklist: reveal → type a title → an item lands on the
 * VIEWED day ALREADY checked `done` with the S316 "✓ Completed · <name>" footer, and SURVIVES a
 * reload (the client-side localStorage hard guarantee). Also pins the ≤2-field category path and
 * the no-display-name path (done but nameless, D-038).
 *
 * Runs on the default chromium project (Desktop Chrome). Service workers are BLOCKED so the D-073
 * first-load reload can't race the add/reload assertions (nothing is network-stubbed here; this is
 * purely determinism hygiene per the SW-stub lesson).
 */

test.use({ serviceWorkers: 'block' });

const ITINERARY_KEY = 'nepal_japan_itinerary';
const NEPAL_DAY = '2026-12-10';

type SeedItem = { id: string; title: string; category: string; done?: boolean };
type SeedDay = { date: string; city: string; country: 'nepal' | 'japan'; items: SeedItem[] };

/**
 * GUARDED seed (the TM-11 idiom): `addInitScript` re-runs on every navigation incl. the reload, so
 * an UNCONDITIONAL seed would clobber the quick-added item and mask the persistence proof. Guarding
 * it means the first load seeds an empty day, the quick-add writes the vault, and the reload's
 * init-script no-ops — so the added item genuinely survives.
 */
async function seedGuardedDay(page: Page, day: SeedDay) {
  await page.addInitScript((d: SeedDay) => {
    const KEY = 'nepal_japan_itinerary';
    if (!window.localStorage.getItem(KEY)) window.localStorage.setItem(KEY, JSON.stringify([d]));
  }, day);
}

async function gotoTravel(page: Page, query = '') {
  await page.goto(`/travel/${query}`, { waitUntil: 'load' });
  await expect(page.getByTestId('travel-mode-root')).toBeVisible();
}

/** Read the (single) itinerary item whose title matches, unwrapping the bare-array OR vault envelope. */
async function readItemByTitle(page: Page, title: string) {
  return page.evaluate(
    ({ key, wanted }) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const days = Array.isArray(parsed) ? parsed : parsed.payload;
      const items = days.flatMap((d: { items: Record<string, unknown>[] }) => d.items);
      return items.find((i: { title?: string }) => i.title === wanted) ?? null;
    },
    { key: ITINERARY_KEY, wanted: title },
  );
}

test.describe('S318 · "Log something different" quick-add', () => {
  test('reveal → add a title → item lands pre-checked done + footer → survives reload', async ({ page }) => {
    await seedGuardedDay(page, { date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: [] });
    await gotoTravel(page, `?today=${NEPAL_DAY}`);

    // The slot is present and collapsed by default (unobtrusive — it does not compete with the checklist).
    const slot = page.getByTestId('travel-quick-add-slot');
    await expect(slot).toBeVisible();
    await expect(page.getByTestId('travel-log-different-trigger')).toBeVisible();
    await expect(page.getByTestId('travel-log-different-input')).toHaveCount(0);

    // Reveal → type a title → Enter.
    await page.getByTestId('travel-log-different-trigger').click();
    const input = page.getByTestId('travel-log-different-input');
    await expect(input).toBeVisible();
    await input.fill('Found a street market');
    await input.press('Enter');

    // The item shows in the checklist ALREADY done: the row's toggle exposes the "Mark not done"
    // name (aria-pressed=true) and the S316 completion footer names the acting traveler (Alina).
    const agenda = page.getByTestId('travel-agenda');
    await expect(agenda).toContainText('Found a street market');
    await expect(agenda.getByRole('button', { name: 'Mark not done: Found a street market' })).toBeVisible();
    await expect(agenda).toContainText('Completed');
    await expect(agenda).toContainText('Alina');

    // The hard guarantee — persisted to the vault done:true + doneBy, no sourceId/sourceType (D-074).
    // POLL the on-disk read: the footer renders from in-memory state a microtask BEFORE the store
    // flushes to localStorage, so a one-shot read can false-red in a big batch run. Gate every field
    // assertion behind the flush (the write is one atomic setItem, so once done:true is visible the
    // whole item is present).
    let onDisk: Record<string, unknown> | null = null;
    await expect
      .poll(async () => {
        onDisk = await readItemByTitle(page, 'Found a street market');
        return (onDisk as { done?: boolean } | null)?.done;
      })
      .toBe(true);
    // Flow analysis can't see the in-closure assignment, so `onDisk` narrows to `null` here —
    // cast through `unknown` to the item shape (the poll above guarantees it's non-null by now).
    const item = onDisk as unknown as {
      doneBy?: string;
      doneAt?: string;
      category?: string;
      sourceId?: string;
      sourceType?: string;
    };
    expect(item.doneBy).toBe('Alina');
    expect(item.doneAt).toBeTruthy();
    expect(item.category).toBe('sightseeing');
    expect(item.sourceId).toBeUndefined();
    expect(item.sourceType).toBeUndefined();

    // Survives a reload (guarded seed no-ops) — still present, still checked done, still attributed.
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('travel-mode-root')).toBeVisible();
    const agendaAfter = page.getByTestId('travel-agenda');
    await expect(agendaAfter.getByRole('button', { name: 'Mark not done: Found a street market' })).toBeVisible();
    await expect(agendaAfter).toContainText('Completed');
    await expect(agendaAfter).toContainText('Alina');
    let afterReload: Record<string, unknown> | null = null;
    await expect
      .poll(async () => {
        afterReload = await readItemByTitle(page, 'Found a street market');
        return (afterReload as { done?: boolean } | null)?.done;
      })
      .toBe(true);
    expect((afterReload as unknown as { doneBy?: string }).doneBy).toBe('Alina');
  });

  test('the optional category field (≤2 fields) sets the item category', async ({ page }) => {
    await seedGuardedDay(page, { date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: [] });
    await gotoTravel(page, `?today=${NEPAL_DAY}`);

    await page.getByTestId('travel-log-different-trigger').click();
    await page.getByTestId('travel-log-different-category').selectOption('food');
    const input = page.getByTestId('travel-log-different-input');
    await input.fill('Momo stall we found');
    await input.press('Enter');

    await expect(page.getByTestId('travel-agenda')).toContainText('Momo stall we found');
    let onDisk: Record<string, unknown> | null = null;
    await expect
      .poll(async () => {
        onDisk = await readItemByTitle(page, 'Momo stall we found');
        return (onDisk as { done?: boolean } | null)?.done;
      })
      .toBe(true);
    expect((onDisk as unknown as { category?: string }).category).toBe('food');
  });

  test('no display name set → item still adds, done but NAMELESS (D-038)', async ({ page }) => {
    // Clear the fixture-seeded display name AFTER the fixture sets it (later addInitScript wins),
    // keeping the token so the /travel front-door wall stays bypassed.
    await page.addInitScript(() => window.localStorage.removeItem('tripPlannerUserName'));
    await seedGuardedDay(page, { date: NEPAL_DAY, city: 'Kathmandu', country: 'nepal', items: [] });
    await gotoTravel(page, `?today=${NEPAL_DAY}`);

    await page.getByTestId('travel-log-different-trigger').click();
    const input = page.getByTestId('travel-log-different-input');
    await input.fill('Nameless detour');
    await input.press('Enter');

    const agenda = page.getByTestId('travel-agenda');
    await expect(agenda.getByRole('button', { name: 'Mark not done: Nameless detour' })).toBeVisible();
    await expect(agenda).toContainText('Completed'); // the nameless footer still renders

    let onDisk: Record<string, unknown> | null = null;
    await expect
      .poll(async () => {
        onDisk = await readItemByTitle(page, 'Nameless detour');
        return (onDisk as { done?: boolean } | null)?.done;
      })
      .toBe(true); // done regardless of name
    expect((onDisk as unknown as { doneBy?: string }).doneBy).toBeUndefined(); // name-gated (D-038): no attribution
    expect((onDisk as unknown as { doneAt?: string }).doneAt).toBeUndefined();
  });
});
