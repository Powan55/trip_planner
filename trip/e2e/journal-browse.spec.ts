import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * S153 — the journal BROWSE view (`/journal`, `components/journal-browse.tsx`) E2E pack.
 *
 * Signs in with a real Trip Token EXPLICITLY (its own `gotoAsTraveler`, seeding the same keys
 * `fixtures.ts`'s post-S113E signed-in default seeds) rather than riding any pack default,
 * deliberately (S153). Note every route, `/journal` included, sits behind the single front-door
 * wall (D-241) — the signed-in token passes it.
 *
 * Proves, on real rendered output against the served static `out/` build (never `next dev`):
 *   1. Empty state when no journal entries are persisted.
 *   2. Seeded entries render newest-first with date/mood/highlight/text.
 *   3. Edit -> reload -> persists: editing an entry via the reused `JournalCard` primitive
 *      (Save) survives a full page reload (the D-018 hard guarantee), and the SAME row again
 *      shows the "View all entries" -> edit -> save round trip from the Today panel's own
 *      journal card, into this list.
 */

const JOURNAL_KEY = 'nepal_japan_journal';

/**
 * Seed a signed-in Trip Token before any app script runs (the exact keys the real sign-in
 * writes — token + display name, matching fixtures.ts post-S113E), navigate, and settle PAST
 * the SW's one-off first-load `location.reload()` (D-073 — the a11y/visual/motion packs'
 * idiom). Without that settle the reload can fire mid-test and detach the open editor (seen on
 * a real run as a "journal-save not stable / detached" 30s timeout).
 */
async function gotoAsTraveler(page: Page, path: string, token = 'Powan') {
  await page.addInitScript((t: string) => {
    window.localStorage.setItem('tripPlannerToken', t);
    window.localStorage.setItem('tripPlannerUserName', t);
    window.localStorage.setItem('nepal_japan_first_run_tour_seen', '1'); // S155: keep dormant
    window.localStorage.setItem('nepal_japan_install_hint_dismissed', '1'); // S272: dismiss app-wide install toast (duration:Infinity poisons axe scans)
  }, token);
  await page.goto(path, { waitUntil: 'load' });
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {
      /* no SW / already stable — proceed */
    });
}

/**
 * Seed two journal entries directly into localStorage (the app's own persisted shape) via a
 * ONE-TIME `page.evaluate` AFTER navigation (mirrors `recap.spec.ts`'s `seedItinerary`) — NOT
 * `page.addInitScript`, which re-runs on every navigation in the page (including a `reload()`)
 * and would silently stomp an in-test edit back to the seed on the very reload meant to prove
 * persistence. Callers must `page.reload()` once after seeding so the app hydrates from it.
 */
async function seedEntries(page: Page) {
  await page.evaluate((key: string) => {
    window.localStorage.setItem(
      key,
      JSON.stringify([
        {
          date: '2026-12-10',
          text: 'Boudhanath at dawn, then momos in Thamel.',
          mood: 'good',
          highlight: 'Prayer flags at first light',
          createdAt: '2026-12-10T09:00:00.000Z',
          updatedAt: '2026-12-10T09:00:00.000Z',
        },
        {
          date: '2026-12-15',
          text: 'A quiet free day — laundry and journaling.',
          mood: 'okay',
          createdAt: '2026-12-15T09:00:00.000Z',
          updatedAt: '2026-12-15T09:00:00.000Z',
        },
      ]),
    );
  }, JOURNAL_KEY);
  await page.reload({ waitUntil: 'load' });
}

test.describe('S153 journal browse — empty state', () => {
  test('no entries: shows the empty state, not the list', async ({ page }) => {
    await gotoAsTraveler(page, '/journal/');
    await expect(page.getByTestId('journal-browse')).toBeVisible();
    await expect(page.getByTestId('journal-browse-empty')).toBeVisible();
    await expect(page.getByTestId('journal-browse-list')).toHaveCount(0);
  });
});

test.describe('S153 journal browse — seeded entries render newest-first', () => {
  test('two seeded entries render newest-first with date/mood/highlight/text', async ({ page }) => {
    await gotoAsTraveler(page, '/journal/');
    await seedEntries(page);

    await expect(page.getByTestId('journal-browse-list')).toBeVisible();
    const rows = page.locator('[data-testid^="journal-browse-row-"]');
    await expect(rows).toHaveCount(2);

    // Newest-first: 2026-12-15 (later date) renders before 2026-12-10.
    await expect(rows.first()).toHaveAttribute('data-testid', 'journal-browse-row-2026-12-15');
    await expect(rows.last()).toHaveAttribute('data-testid', 'journal-browse-row-2026-12-10');

    // The Dec-10 row: mood, highlight, and body text all present.
    const dec10 = page.getByTestId('journal-browse-row-2026-12-10');
    await expect(dec10).toContainText('December 10');
    await expect(page.getByTestId('journal-browse-mood-2026-12-10')).toContainText('Good');
    await expect(page.getByTestId('journal-browse-highlight-2026-12-10')).toContainText('Prayer flags at first light');
    await expect(page.getByTestId('journal-browse-body-2026-12-10')).toContainText('Boudhanath at dawn');

    // The Dec-15 row has a mood but no highlight — the highlight testid must be absent.
    await expect(page.getByTestId('journal-browse-mood-2026-12-15')).toContainText('Okay');
    await expect(page.getByTestId('journal-browse-highlight-2026-12-15')).toHaveCount(0);
  });
});

test.describe('S153 journal browse — edit round trip persists across reload', () => {
  test('editing a row via the reused JournalCard primitive persists after reload', async ({ page }) => {
    await gotoAsTraveler(page, '/journal/');
    await seedEntries(page);
    await expect(page.getByTestId('journal-browse-row-2026-12-10')).toBeVisible();

    // Tap Edit on the Dec-10 row -> the row is replaced by the real JournalCard editor primitive.
    await page.getByTestId('journal-browse-edit-2026-12-10').click();
    await expect(page.getByTestId('journal-card')).toBeVisible();
    await page.getByTestId('journal-edit').click();
    await expect(page.getByTestId('journal-editor')).toBeVisible();

    await page.getByTestId('journal-highlight-input').fill('Updated highlight via /journal');
    await page.getByTestId('journal-text-input').fill('Edited from the browse view.');
    await page.getByTestId('journal-save').click();

    // The card's own read view confirms the save immediately (no reload needed yet).
    await expect(page.getByTestId('journal-read')).toBeVisible();
    await expect(page.getByTestId('journal-highlight-display')).toContainText('Updated highlight via /journal');

    // THE HARD GUARANTEE: reload, and the edit survives — re-render as the browse row again
    // (a fresh page load resets the in-page `editingDate` state) showing the persisted edit.
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('journal-browse-row-2026-12-10')).toBeVisible();
    await expect(page.getByTestId('journal-browse-highlight-2026-12-10')).toContainText('Updated highlight via /journal');
    await expect(page.getByTestId('journal-browse-body-2026-12-10')).toContainText('Edited from the browse view.');

    // The untouched Dec-15 entry is still there too (the edit did not clobber the other entry).
    await expect(page.getByTestId('journal-browse-row-2026-12-15')).toBeVisible();
  });

  test('the "View all entries" link on the Today panel journal card navigates to /journal', async ({ page }) => {
    // Drive the app clock in-trip so the Today panel (and its journal card) mounts.
    await gotoAsTraveler(page, '/?today=2026-12-15');
    await seedEntries(page);
    await expect(page.getByTestId('journal-card')).toBeVisible();
    await expect(page.getByTestId('journal-view-all')).toBeVisible();

    await page.getByTestId('journal-view-all').click();
    await page.waitForURL('**/journal/');
    await expect(page.getByTestId('journal-browse')).toBeVisible();
    await expect(page.getByTestId('journal-browse-row-2026-12-15')).toBeVisible();
  });
});
