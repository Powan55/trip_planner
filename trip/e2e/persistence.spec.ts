import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Persistence hard-guarantee E2E pack (slice S81, D-018) — E2E wave 1.
 *
 * Covers the acceptance centerpiece:
 *   - itinerary CRUD (create/edit/delete) on the `/plan` calendar survives `page.reload()`
 *   - a deliberately-emptied itinerary ([]) survives reload and is NOT re-seeded with
 *     sample data (the centerpiece of D-018's three-state contract)
 *   - the calendar empty-state renders for an unplanned day
 *
 * Storage key contract (lib/itinerary-storage.ts): `nepal_japan_itinerary`.
 *   - absent -> seed SAMPLE_ITINERARY
 *   - present & parses to an array (INCLUDING []) -> return verbatim
 *   - present but corrupt -> quarantine + fall back to sample
 * `hasStoredPlans()` === true iff the key is PRESENT (any array value, incl. []).
 *
 * ── Trap 1 (addInitScript re-runs on every reload) ──────────────────────────
 * The shared default fixture (`./fixtures`) seeds the signed-in identity keys
 * (`tripPlannerToken`/`tripPlannerUserName`) via `page.addInitScript`, which re-fires on
 * every `page.reload()`/navigation. That is safe because it only ever touches the identity
 * keys, never the itinerary/checklist data. For deterministic one-time seeding of
 * itinerary/checklist state we ALWAYS use `page.evaluate(() => localStorage.setItem(...))`
 * followed by `page.reload()` — never `addInitScript` — so the seed is written exactly once
 * and a reload reads whatever the app itself (or our evaluate calls) actually persisted,
 * never a clobbering re-seed.
 *
 * ── Trap 2 (sample fills every day; ids are generated) ──────────────────────
 * The default SAMPLE_ITINERARY has items on all 32 trip dates, so the empty-state /
 * delete-all specs seed a SMALL controlled fixture (one DayPlan, on a date with no
 * further significance, holding 1-2 items with known ids) via `page.evaluate` +
 * `page.reload()` instead of relying on the sample. New items added through the
 * editor get a generated id, so after saving we locate the created card by its
 * rendered TITLE TEXT within the day's agenda, then resolve its
 * `calendar-item-*`/edit/delete controls from that specific card — never by
 * guessing an id.
 *
 * ── A third, environment-specific quirk found while building this pack ──────
 * `/plan` lazy-mounts `CalendarPlanner` via `next/dynamic({ ssr:false })`
 * (app/plan/page.tsx) behind a `SectionSkeleton` fallback, and this app registers a
 * service worker. In this harness, opening the `ItemEditor` too early (before the
 * page's `networkidle` settles) can catch a brief remount window where the
 * in-progress interaction lands on an instance that gets replaced, closing the
 * dialog out from under the test. Separately, when the day-grid selection has
 * scrolled the page down far enough for the
 * (non-`Footer`-owned) `<footer>` to be in the viewport, Playwright's own
 * actionability check correctly reports the footer's DOM node as the topmost
 * element at the Save button's screen point — a real, reproducible stacking
 * interaction between the app-wide `<footer>` (a sibling of the animated route
 * wrapper) and the modal's in-flow `fixed z-50` backdrop. Both are pre-existing
 * production behaviors outside this slice's fence (production code is not touched
 * here) — worked around at the spec level by: (a) navigating with a bounded
 * `waitUntil: 'domcontentloaded'` and then blocking on a REAL readiness signal
 * (`waitForPlannerReady` — the lazy island's `calendar-day-*` grid is present, not
 * the skeleton), see FU-15 below; (b) typing into the editor's title field with
 * `pressSequentially` (real per-keystroke input) rather than `.fill()` (a
 * synchronous value-set) — `.fill()` was reproducibly implicated in the same
 * dialog-closes-early symptom in isolation; and (c) scrolling the footer out of the
 * viewport (`mouse.wheel` up) immediately before any click inside the editor panel.
 * `ItemEditor` now renders via `createPortal` (calendar-planner.tsx) — the
 * fast-follow this note used to flag — and #242 (merged) added a body scroll lock
 * (`body[data-dialog-open]`, globals.css) that keeps the page from scrolling behind
 * it while open, covering the in-editor instance of (c). See `typeEditorTitle`
 * below, which no longer needs the wheel workaround for that reason.
 *
 * ── FU-15 (S114): the D-093 CRUD-then-reload flake, de-flaked at the source ────
 * D-093 originally showed as `calendar-item-* resolved to 0 elements` right after a
 * reload — the freshly-hydrated card detaching in a remount window driven by the
 * service worker's first-install `clients.claim()` reload PLUS the `ssr:false`
 * lazy-mount. S113E (`4026d29`) removed the SW first-install reload (guarded by
 * `hadController`), shrinking that remount window. On the post-S113E tree the flake
 * no longer reproduces as a detach; it re-surfaced under load as a `page.goto ...
 * waiting until "networkidle"` TIMEOUT, because the production SW precaches ~80
 * entries on install + runs update checks, so `networkidle` is not a deterministic
 * settle for this app. The fix (above): drop `networkidle`, navigate to
 * `domcontentloaded`, then wait on `waitForPlannerReady` (the lazy island actually
 * mounted). Every assertion below is byte-for-byte unchanged (D-101). See
 * docs/ci-flake-policy.md.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';

// A real trip date (falls inside NEPAL_START..NEPAL_END) used for the CRUD-on-a-
// day-with-sample-data specs (create/edit/delete against the existing seed).
const KNOWN_DAY = '2026-12-11';

// A real trip date reserved for the small-controlled-fixture specs (empty-state /
// delete-all). Also inside the trip window so it's reachable via calendar-day-*.
const FIXTURE_DAY = '2026-12-20';

/**
 * Wait for the lazy `CalendarPlanner` island to be genuinely mounted — the
 * calendar day-grid (`calendar-day-*`) only renders once the
 * `next/dynamic({ssr:false})` island has hydrated and REPLACED the
 * `SectionSkeleton` fallback (the skeleton is `aria-hidden` and carries a
 * `data-loading` attr, never a `calendar-day-*`). This is the deterministic
 * readiness signal that replaces `waitUntil:'networkidle'` — see the FU-15 note
 * in the harness block above.
 */
async function waitForPlannerReady(page: Page) {
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'visible' });
}

/**
 * Navigate to a route and wait for the planner island to be mounted.
 * FU-15 (S114): navigation waits only for `domcontentloaded` (a bounded,
 * deterministic milestone) and then blocks on the real readiness signal
 * (`waitForPlannerReady`). It deliberately does NOT wait on `networkidle`: the
 * production service worker precaches ~80 entries on install and runs periodic
 * update checks, so the network never reliably goes quiet for 500ms under load —
 * `networkidle` was the actual source of the D-093 flake on the current tree
 * (a `page.goto ... waiting until "networkidle"` timeout), not a real defect.
 */
async function gotoSettled(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}

/** Reload and wait for the planner island to be mounted (same rationale as gotoSettled). */
async function reloadSettled(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPlannerReady(page);
}

/**
 * Type into the calendar editor's Title field with real per-keystroke input — see
 * the harness note above for why `pressSequentially` (not `.fill()`) is load-bearing.
 * No footer-scroll workaround needed here: the editor is portalled and #242's body
 * scroll lock keeps the footer out of the way while it's open.
 */
async function typeEditorTitle(page: Page, title: string) {
  const input = page.getByTestId('calendar-editor-title-input');
  await input.pressSequentially(title, { delay: 10 });
}

/** Seed a small, fully-controlled itinerary (bypassing the 32-day sample) and reload. */
async function seedSmallFixture(
  page: Page,
  items: Array<{ id: string; title: string; category?: string }>,
) {
  await page.evaluate(
    ({
      key,
      date,
      items,
    }: {
      key: string;
      date: string;
      items: Array<{ id: string; title: string; category?: string }>;
    }) => {
      const dayPlan = {
        date,
        city: 'Tokyo',
        country: 'japan',
        items: items.map((i) => ({
          id: i.id,
          title: i.title,
          category: i.category ?? 'sightseeing',
        })),
      };
      window.localStorage.setItem(key, JSON.stringify([dayPlan]));
    },
    { key: ITINERARY_KEY, date: FIXTURE_DAY, items },
  );
  await reloadSettled(page);
}

test.describe('D-018 persistence hard guarantee — itinerary CRUD x reload', () => {
  test('create an item, reload, it survives (hasStoredPlans becomes true)', async ({ page }) => {
    const uniqueTitle = `S81 create-reload check ${Date.now()}`;

    await gotoSettled(page, '/plan/');
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await page.getByTestId('calendar-add-item').click();
    await expect(page.getByTestId('calendar-editor')).toBeVisible();
    await typeEditorTitle(page, uniqueTitle);
    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);

    // Assert the item appears in the day's agenda (locate by rendered title, per
    // Trap 2 — the id is generated, so we never guess it).
    const card = page.locator('[data-testid^="calendar-item-"]').filter({ hasText: uniqueTitle });
    await expect(card).toHaveCount(1);

    await reloadSettled(page);
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    const cardAfterReload = page
      .locator('[data-testid^="calendar-item-"]')
      .filter({ hasText: uniqueTitle });
    await expect(cardAfterReload).toHaveCount(1);

    const hasStored = await page.evaluate(
      (key) => window.localStorage.getItem(key) !== null,
      ITINERARY_KEY,
    );
    expect(hasStored).toBe(true);
  });

  test('edit an item title, reload, the new title persists', async ({ page }) => {
    const originalTitle = `S81 edit-original ${Date.now()}`;
    const editedTitle = `S81 edit-edited ${Date.now()}`;

    await gotoSettled(page, '/plan/');
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await page.getByTestId('calendar-add-item').click();
    await typeEditorTitle(page, originalTitle);
    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);

    const card = page.locator('[data-testid^="calendar-item-"]').filter({ hasText: originalTitle });
    await expect(card).toHaveCount(1);
    const itemId = await card.getAttribute('data-testid');
    expect(itemId).toBeTruthy();
    const idSuffix = itemId!.replace('calendar-item-', '');

    await page.getByTestId(`calendar-item-edit-${idSuffix}`).click();
    await expect(page.getByTestId('calendar-editor')).toBeVisible();
    const titleInput = page.getByTestId('calendar-editor-title-input');
    await titleInput.selectText();
    await typeEditorTitle(page, editedTitle);
    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);

    await expect(page.getByTestId(`calendar-item-${idSuffix}`)).toContainText(editedTitle);
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: originalTitle }),
    ).toHaveCount(0);

    await reloadSettled(page);
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await expect(page.getByTestId(`calendar-item-${idSuffix}`)).toContainText(editedTitle);
  });

  test('delete an item, reload, it stays gone', async ({ page }) => {
    const uniqueTitle = `S81 delete-check ${Date.now()}`;

    await gotoSettled(page, '/plan/');
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await page.getByTestId('calendar-add-item').click();
    await typeEditorTitle(page, uniqueTitle);
    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);

    const card = page.locator('[data-testid^="calendar-item-"]').filter({ hasText: uniqueTitle });
    await expect(card).toHaveCount(1);
    const itemId = (await card.getAttribute('data-testid'))!.replace('calendar-item-', '');

    await page.mouse.wheel(0, -5000);
    await page.getByTestId(`calendar-item-delete-${itemId}`).click();
    await expect(page.getByTestId(`calendar-item-${itemId}`)).toHaveCount(0);

    await reloadSettled(page);
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await expect(page.getByTestId(`calendar-item-${itemId}`)).toHaveCount(0);
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: uniqueTitle }),
    ).toHaveCount(0);
  });

  // S127: delete → sonner Undo toast → click Undo → item reappears → reload → it persists.
  // Dormant `out/` build: restore is a same-id re-add (D-038), so the SAME card comes back and
  // survives reload exactly like any created item.
  test('delete an item, click Undo, it reappears and survives reload', async ({ page }) => {
    const uniqueTitle = `S127 undo-check ${Date.now()}`;

    await gotoSettled(page, '/plan/');
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await page.getByTestId('calendar-add-item').click();
    await typeEditorTitle(page, uniqueTitle);
    await page.getByTestId('calendar-editor-save').click();
    await expect(page.getByTestId('calendar-editor')).toHaveCount(0);

    const card = page.locator('[data-testid^="calendar-item-"]').filter({ hasText: uniqueTitle });
    await expect(card).toHaveCount(1);
    const itemId = (await card.getAttribute('data-testid'))!.replace('calendar-item-', '');

    await page.mouse.wheel(0, -5000);
    await page.getByTestId(`calendar-item-delete-${itemId}`).click();
    await expect(page.getByTestId(`calendar-item-${itemId}`)).toHaveCount(0);

    // The sonner toast renders an "Undo" action button — click it to restore.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: uniqueTitle }),
    ).toHaveCount(1);

    await reloadSettled(page);
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: uniqueTitle }),
    ).toHaveCount(1);
  });
});

test.describe('D-018 delete-all-stays-empty (THE centerpiece)', () => {
  test('storage-level: an itinerary explicitly set to [] survives reload and is NOT re-seeded with sample', async ({
    page,
  }) => {
    // Visit once first so the wall bypass/app scripts are established, then set the
    // key directly (Trap 1 — page.evaluate, one-time, NOT addInitScript) and reload.
    await gotoSettled(page, '/plan/');
    await page.evaluate((key) => window.localStorage.setItem(key, '[]'), ITINERARY_KEY);
    await reloadSettled(page);

    // The sample seeds an item on EVERY one of the 32 trip dates — if re-seeding
    // happened, KNOWN_DAY (which has 6 sample items) would show them. Assert instead
    // that selecting it shows the empty-state, proving no sample data reappeared.
    await page.getByTestId(`calendar-day-${KNOWN_DAY}`).click();
    await expect(page.getByTestId('calendar-empty-state')).toBeVisible();
    await expect(page.locator('[data-testid^="calendar-item-"]')).toHaveCount(0);

    // The key must still be present and still equal to the empty array — not absent
    // (which would mean the app never persisted it) and not populated (re-seeded).
    const raw = await page.evaluate((key) => window.localStorage.getItem(key), ITINERARY_KEY);
    expect(raw).toBe('[]');

    // Cross-check via the app's own day-cell aria-label, which reports "no activities
    // planned" once items.length is 0 — a second, independent signal (not just our
    // localStorage read) that the sample truly did not reappear on this date.
    await expect(page.getByTestId(`calendar-day-${KNOWN_DAY}`)).toHaveAttribute(
      'aria-label',
      /no activities planned/,
    );
  });

  test('UI-driven: deleting every item on a day stays empty across reload (no re-seed)', async ({
    page,
  }) => {
    await gotoSettled(page, '/plan/');
    // Seed a small controlled fixture (Trap 2) — one day, two known items — so we can
    // reach a genuine, deterministic empty state without fighting the 32-day sample.
    await seedSmallFixture(page, [
      { id: 's81-fx-1', title: 'S81 fixture item one' },
      { id: 's81-fx-2', title: 'S81 fixture item two' },
    ]);

    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s81-fx-1')).toBeVisible();
    await expect(page.getByTestId('calendar-item-s81-fx-2')).toBeVisible();

    await page.mouse.wheel(0, -5000);
    await page.getByTestId('calendar-item-delete-s81-fx-1').click();
    await expect(page.getByTestId('calendar-item-s81-fx-1')).toHaveCount(0);
    await page.getByTestId('calendar-item-delete-s81-fx-2').click();
    await expect(page.getByTestId('calendar-item-s81-fx-2')).toHaveCount(0);

    await expect(page.getByTestId('calendar-empty-state')).toBeVisible();
    await expect(page.locator('[data-testid^="calendar-item-"]')).toHaveCount(0);

    await reloadSettled(page);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-empty-state')).toBeVisible();
    await expect(page.locator('[data-testid^="calendar-item-"]')).toHaveCount(0);

    const raw = await page.evaluate((key) => window.localStorage.getItem(key), ITINERARY_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    // S90 (D-095): the UI deletes committed through savePlans(), which
    // now persists the Vault envelope, so the raw on-disk value is the envelope, not a
    // bare array. Assert the envelope shape and read the day plan from `.payload`. The
    // behavioral guarantee (fixture day has 0 items after delete-all + reload) is unchanged.
    // S96/D-104 → S124/D-139: CURRENT_ITINERARY_VERSION bumped 4→5 (structured-time migration),
    // so the on-disk envelope is now v5. Version-literal change-detector only — the behavioral
    // guarantee (fixture day has 0 live items after delete-all + reload) is byte-unchanged.
    expect(parsed.schemaVersion).toBe(5);
    const fixtureDayPlan = parsed.payload.find((p: { date: string }) => p.date === FIXTURE_DAY);
    // S97/D-106: in the SYNC-configured build a deleted item is retained as a TOMBSTONE
    // (deleted:true) in the raw payload so the delete can propagate to friends; the UI filters
    // tombstones (0 VISIBLE items already asserted at :271-:281 + across reload). The DORMANT
    // build physically removes (0 items at all). Assert zero LIVE (non-tombstone) items so the
    // D-018 delete-all-stays-empty guarantee holds for BOTH builds — the user-visible emptiness
    // above is the strict guarantee; this is the on-disk corollary.
    const liveItems = (fixtureDayPlan?.items ?? []).filter(
      (i: { deleted?: boolean }) => i.deleted !== true,
    );
    expect(liveItems.length).toBe(0);
  });
});

// S129 clear-whole-day: a confirm-gated "Clear day" that removes every item on the selected
// day in one action, shows the empty-state, and never re-seeds across reload (D-018). The undo
// toast restores the full list. Dormant `out/` build: clear physically empties, restore is a
// same-id re-add — the SAME cards come back and survive reload.
test.describe('S129 clear-whole-day (confirm + undo, D-018 no-reseed)', () => {
  test('clear a whole day via confirm → empty state → reload → still empty (no re-seed)', async ({
    page,
  }) => {
    await gotoSettled(page, '/plan/');
    await seedSmallFixture(page, [
      { id: 's129-a', title: 'S129 clear item A' },
      { id: 's129-b', title: 'S129 clear item B' },
      { id: 's129-c', title: 'S129 clear item C' },
    ]);

    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s129-a')).toBeVisible();
    await expect(page.getByTestId('calendar-item-s129-c')).toBeVisible();

    // Open the confirm dialog and confirm the clear.
    await page.mouse.wheel(0, -5000);
    await page.getByTestId('calendar-clear-day').click();
    await expect(page.getByTestId('calendar-clear-confirm')).toBeVisible();
    await page.getByTestId('calendar-clear-confirm-action').click();

    // Every item gone + the existing empty-state design shows.
    await expect(page.locator('[data-testid^="calendar-item-"]')).toHaveCount(0);
    await expect(page.getByTestId('calendar-empty-state')).toBeVisible();

    await reloadSettled(page);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-empty-state')).toBeVisible();
    await expect(page.locator('[data-testid^="calendar-item-"]')).toHaveCount(0);

    // On disk: the fixture day has ZERO live items after clear + reload (no re-seed).
    const raw = await page.evaluate((key) => window.localStorage.getItem(key), ITINERARY_KEY);
    const parsed = JSON.parse(raw as string);
    const fixtureDayPlan = parsed.payload.find((p: { date: string }) => p.date === FIXTURE_DAY);
    const liveItems = (fixtureDayPlan?.items ?? []).filter(
      (i: { deleted?: boolean }) => i.deleted !== true,
    );
    expect(liveItems.length).toBe(0);
  });

  test('clear a whole day → Undo → items return and survive reload', async ({ page }) => {
    await gotoSettled(page, '/plan/');
    await seedSmallFixture(page, [
      { id: 's129-u1', title: 'S129 undo item one' },
      { id: 's129-u2', title: 'S129 undo item two' },
    ]);

    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s129-u1')).toBeVisible();
    await expect(page.getByTestId('calendar-item-s129-u2')).toBeVisible();

    await page.mouse.wheel(0, -5000);
    await page.getByTestId('calendar-clear-day').click();
    await page.getByTestId('calendar-clear-confirm-action').click();
    await expect(page.locator('[data-testid^="calendar-item-"]')).toHaveCount(0);

    // The undo toast restores the full list (dormant: same ids).
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('calendar-item-s129-u1')).toBeVisible();
    await expect(page.getByTestId('calendar-item-s129-u2')).toBeVisible();

    await reloadSettled(page);
    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-item-s129-u1')).toBeVisible();
    await expect(page.getByTestId('calendar-item-s129-u2')).toBeVisible();
  });
});

test.describe('Calendar empty-state', () => {
  test('an unplanned day (no stored items) shows calendar-empty-state', async ({ page }) => {
    await gotoSettled(page, '/plan/');
    // Seed a fixture where FIXTURE_DAY has no DayPlan entry at all (getDayPlan
    // synthesizes an empty one) — the simplest, most direct "unplanned day" case.
    await page.evaluate((key) => window.localStorage.setItem(key, '[]'), ITINERARY_KEY);
    await reloadSettled(page);

    await page.getByTestId(`calendar-day-${FIXTURE_DAY}`).click();
    await expect(page.getByTestId('calendar-empty-state')).toBeVisible();
    await expect(page.locator('[data-testid^="calendar-item-"]')).toHaveCount(0);
  });
});
