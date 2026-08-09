import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S104 — Afterglow 1: in-trip per-day TEXT journal E2E pack.
 *
 * The journal card (`components/journal-card.tsx`) mounts INSIDE the in-trip Today panel
 * (`components/today-panel.tsx`), below the agenda — so it renders ONLY when the app clock is inside
 * the trip window (via `getTodayInTrip()`, incl. the D-075 `?today=` override). It reads/writes
 * TODAY'S entry through `useJournal()` → the framework-free journal core + gateway key 12
 * (`journalStore`) — client-side localStorage, no backend (D-004). These specs prove the centrepiece
 * guarantees on a real run:
 *
 *   1. WRITE → APPEARS → RELOAD PERSISTS (D-018-class): under `?today=2026-12-14` (in-trip, Day 6
 *      Kathmandu) write text + mood + highlight, it renders in the read view, and it all survives a reload.
 *   2. EDIT: change the text → persists across reload.
 *   3. CLEAR-ALL: clear every field + Save → the entry is removed, the empty "Write about today"
 *      prompt returns, and that empty state survives reload (no phantom re-seed).
 *
 * ── SETTLE DISCIPLINE (mirrors today.spec.ts / expenses.spec.ts) ────────────────────────────────
 * `TodayPanel` (which mounts the journal card) is a `next/dynamic(ssr:false)` island. On every
 * navigation/reload (`waitUntil:'domcontentloaded'`, FU-26/S167 — never `networkidle`) the app
 * remounts the island → resolves the `?today=` override → hydrates the itinerary store → renders.
 * `settleJournal` blocks until the journal card is visible before any
 * assertion, so nothing fires against a transient pre-hydrate frame. Assertions are unchanged in
 * strength — the settle only removes the race. The journal is local-only, so NOTHING external is
 * stubbed.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const JOURNAL_KEY = 'nepal_japan_journal';

// An in-trip date (Day 6, Kathmandu / Nepal window) — the clock override we drive.
const IN_TRIP_DAY = '2026-12-14';

/** Navigate to home with the `?today=` override applied and reduced motion pinned. */
async function gotoHomeWithClock(page: Page, todayParam: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/?today=${todayParam}`, { waitUntil: 'domcontentloaded' });
}

/** Reload and let the network settle (mirrors today.spec.ts's reloadSettled). */
async function reloadSettled(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
}

/**
 * Block until the in-trip Today island + its journal card have mounted (the panel is visible AND the
 * journal card exists), so no assertion runs against a transient pre-hydrate frame.
 */
async function settleJournal(page: Page) {
  await expect(page.getByTestId('today-panel')).toBeVisible();
  await expect(page.getByTestId('journal-card')).toBeVisible();
}

/**
 * Seed an EMPTY itinerary ([]) so the Today panel renders a deterministic (empty-agenda) day that
 * still mounts the journal card. Written once via evaluate; the following reload reads it.
 */
async function seedEmptyItinerary(page: Page) {
  await page.evaluate((key) => window.localStorage.setItem(key, '[]'), ITINERARY_KEY);
}

/** Read the raw persisted journal list from localStorage (null when unset). */
async function readStored(page: Page): Promise<Array<Record<string, unknown>> | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, JOURNAL_KEY);
}

test.describe('S104 in-trip journal — write/edit/clear, persists across reload', () => {
  test('write text + mood + highlight: it appears in the read view and survives reload', async ({
    page,
  }) => {
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedEmptyItinerary(page);
    await reloadSettled(page);
    await settleJournal(page);

    // Empty state first: the "Write about today" prompt, no read view yet.
    await expect(page.getByTestId('journal-write-prompt')).toBeVisible();
    await expect(page.getByTestId('journal-read')).toHaveCount(0);

    // Open the editor, fill all three fields (mood chip + highlight + body), save.
    await page.getByTestId('journal-write-prompt').click();
    await expect(page.getByTestId('journal-editor')).toBeVisible();
    await page.getByTestId('journal-mood-great').click();
    await expect(page.getByTestId('journal-mood-great')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('journal-highlight-input').fill('Sunset over Boudhanath');
    await page.getByTestId('journal-text-input').fill('Momos in Thamel; the light was perfect.');
    await page.getByTestId('journal-save').click();

    // Read view renders with the mood, highlight, and body.
    await expect(page.getByTestId('journal-read')).toBeVisible();
    await expect(page.getByTestId('journal-editor')).toHaveCount(0);
    await expect(page.getByTestId('journal-mood-display')).toContainText('Great');
    await expect(page.getByTestId('journal-highlight-display')).toContainText('Sunset over Boudhanath');
    await expect(page.getByTestId('journal-body')).toContainText('Momos in Thamel');

    // It persisted to localStorage under key 12.
    const stored = await readStored(page);
    expect(stored).not.toBeNull();
    expect(stored).toHaveLength(1);
    expect(stored![0].date).toBe(IN_TRIP_DAY);
    expect(stored![0].mood).toBe('great');
    expect(stored![0].highlight).toBe('Sunset over Boudhanath');
    expect(stored![0].text).toBe('Momos in Thamel; the light was perfect.');

    // RELOAD — the entry survives (the D-018 hard guarantee for the journal domain).
    await reloadSettled(page);
    await settleJournal(page);
    await expect(page.getByTestId('journal-read')).toBeVisible();
    await expect(page.getByTestId('journal-mood-display')).toContainText('Great');
    await expect(page.getByTestId('journal-highlight-display')).toContainText('Sunset over Boudhanath');
    await expect(page.getByTestId('journal-body')).toContainText('Momos in Thamel');
    // The empty prompt is gone.
    await expect(page.getByTestId('journal-write-prompt')).toHaveCount(0);
  });

  test('edit the text: the change persists across reload', async ({ page }) => {
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedEmptyItinerary(page);
    await reloadSettled(page);
    await settleJournal(page);

    // Create an initial entry.
    await page.getByTestId('journal-write-prompt').click();
    await page.getByTestId('journal-text-input').fill('First draft.');
    await page.getByTestId('journal-save').click();
    await expect(page.getByTestId('journal-body')).toContainText('First draft.');

    // Edit → the editor opens pre-seeded from the entry; change the text.
    await page.getByTestId('journal-edit').click();
    await expect(page.getByTestId('journal-editor')).toBeVisible();
    await expect(page.getByTestId('journal-text-input')).toHaveValue('First draft.');
    await page.getByTestId('journal-text-input').fill('Edited — a much better second take.');
    await page.getByTestId('journal-save').click();
    await expect(page.getByTestId('journal-body')).toContainText('Edited — a much better second take.');

    // Persisted value is the edited text, and it's still one entry.
    const stored = await readStored(page);
    expect(stored).toHaveLength(1);
    expect(stored![0].text).toBe('Edited — a much better second take.');

    // Survives reload.
    await reloadSettled(page);
    await settleJournal(page);
    await expect(page.getByTestId('journal-body')).toContainText('Edited — a much better second take.');
  });

  test('clear all content + save: the entry is removed, empty state returns, survives reload', async ({
    page,
  }) => {
    await gotoHomeWithClock(page, IN_TRIP_DAY);
    await seedEmptyItinerary(page);
    await reloadSettled(page);
    await settleJournal(page);

    // Create an entry with text + mood.
    await page.getByTestId('journal-write-prompt').click();
    await page.getByTestId('journal-mood-good').click();
    await page.getByTestId('journal-text-input').fill('Something to clear later.');
    await page.getByTestId('journal-save').click();
    await expect(page.getByTestId('journal-read')).toBeVisible();

    // Edit → clear the text AND untoggle the mood (tap the active chip again) → Save.
    await page.getByTestId('journal-edit').click();
    await page.getByTestId('journal-text-input').fill('');
    // The mood chip is active; tap it to clear.
    await expect(page.getByTestId('journal-mood-good')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('journal-mood-good').click();
    await expect(page.getByTestId('journal-mood-good')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('journal-save').click();

    // The entry is gone: the empty prompt returns, the read view is absent.
    await expect(page.getByTestId('journal-write-prompt')).toBeVisible();
    await expect(page.getByTestId('journal-read')).toHaveCount(0);
    await expect(page.getByTestId('journal-editor')).toHaveCount(0);

    // Persisted list is now empty ([]) — no phantom entry re-seeded (D-018).
    const stored = await readStored(page);
    expect(stored).toEqual([]);

    // Survives reload — still the empty prompt.
    await reloadSettled(page);
    await settleJournal(page);
    await expect(page.getByTestId('journal-write-prompt')).toBeVisible();
    await expect(page.getByTestId('journal-read')).toHaveCount(0);
  });
});
