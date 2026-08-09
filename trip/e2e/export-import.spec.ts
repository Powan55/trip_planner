import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Whole-trip export/import E2E pack (slice S92, D-098) — E2E wave (Vault Phase B).
 *
 * Drives the real Backup & Restore panel on the served static `out/` build:
 *   - EXPORT produces a real browser download (`page.on('download')`) whose bytes are a
 *     valid v3 Vault envelope wrapping the current itinerary.
 *   - IMPORT of a known-good file (`setInputFiles` with an in-memory buffer) → the
 *     confirm dialog → the itinerary REFLECTS the imported data, and it SURVIVES reload.
 *   - IMPORT of a corrupt file → a safe error is shown AND the pre-import itinerary is
 *     untouched, surviving reload (the D-098 fail-safe, proven at the browser level).
 *
 * Harness notes (mirroring persistence.spec.ts):
 *   - S322 (A4): Backup & Restore moved OFF `/plan` into the Settings "Data management" group
 *     (`/settings`, `components/settings-panel.tsx`) — a native `<details>` group we expand before
 *     interacting. Navigate with `waitUntil:'domcontentloaded'` (FU-26/S167 — never `networkidle`,
 *     the SW precache defeats it), wait for the settings panel, then expand the Data group. The
 *     imported itinerary is verified on `/plan`'s calendar after the restore's auto-reload.
 *   - Itinerary state is seeded ONCE via `page.evaluate` + reload (NEVER addInitScript,
 *     which re-fires every navigation — Trap 1). The default fixture's addInitScript only
 *     ever seeds the signed-in identity, so it's safe alongside our one-time evaluate seeds.
 *   - The confirm dialog is a real in-page `role="dialog"` (not window.confirm), so it's
 *     driven with normal testid clicks.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const QUARANTINE_KEY = 'nepal_japan_itinerary_corrupt';

// A trip date inside the Nepal window, reachable via calendar-day-*.
const SEED_DAY = '2026-12-12';
// A second date used to prove imported data lands on the right day.
const IMPORT_DAY = '2026-12-14';

/** Expand the Settings "Data management" group (native <details>) so backup controls are reachable. */
async function expandData(page: Page) {
  const panel = page.getByTestId('backup-restore');
  // Idempotent: only click the summary if the group is currently collapsed (clicking an open
  // <details> summary would close it).
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByTestId('settings-group-data-toggle').click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });
}

async function gotoSettingsSettled(page: Page) {
  await page.goto('/settings/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
  await expandData(page);
}

async function reloadSettingsSettled(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
  await expandData(page);
}

/** Navigate to /plan and wait for the calendar island to be interactive (verifies imported items). */
async function gotoPlanCalendar(page: Page) {
  await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId(`calendar-day-${SEED_DAY}`)).toBeVisible({ timeout: 15_000 });
}

/**
 * S273: a SUCCESSFUL restore auto-reloads the page (~600ms) to re-hydrate every store (D-172). Set a
 * window sentinel, click Replace, and wait for it to vanish (i.e. the reload actually happened) before
 * asserting the post-restore UI — deterministic, no fixed sleeps. Lands back on /settings (re-expanded).
 */
async function confirmAndAwaitReload(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __s273Reload?: boolean }).__s273Reload = true;
  });
  await page.getByTestId('backup-confirm-import').click();
  await page.waitForFunction(
    () => !(window as unknown as { __s273Reload?: boolean }).__s273Reload,
    null,
    { timeout: 20_000 },
  );
  await expect(page.getByTestId('settings-panel')).toBeVisible({ timeout: 15_000 });
  await expandData(page);
}

/** Seed a fully-controlled itinerary (one day, known items) as a legacy bare array, then reload. */
async function seedItinerary(
  page: Page,
  date: string,
  items: Array<{ id: string; title: string; category?: string }>,
) {
  await page.evaluate(
    ({ key, date, items }) => {
      const dayPlan = {
        date,
        city: 'Kathmandu',
        country: 'nepal',
        items: items.map((i) => ({ id: i.id, title: i.title, category: i.category ?? 'sightseeing' })),
      };
      window.localStorage.setItem(key, JSON.stringify([dayPlan]));
    },
    { key: ITINERARY_KEY, date, items },
  );
  await reloadSettingsSettled(page);
}

/** Read the raw on-disk itinerary string (may be a v3 envelope or a bare array). */
async function readItineraryRaw(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), ITINERARY_KEY);
}

test.describe('S273 export — downloads the WHOLE trip as one backup file', () => {
  test('Export button produces a download that is a full-trip backup envelope nesting the v-current itinerary', async ({
    page,
  }) => {
    await gotoSettingsSettled(page);
    await seedItinerary(page, SEED_DAY, [
      { id: 's92-exp-1', title: 'Boudhanath at dusk', category: 'photography' },
    ]);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('backup-export-button').click(),
    ]);

    // S273: the export is now the whole-trip backup (gzip via CompressionStream in this real Chromium).
    expect(download.suggestedFilename()).toBe('nepal-japan-trip-backup.json.gz');

    // Read the actual downloaded bytes, gunzip with Node's own zlib (independent of the app), and
    // assert the S273 backup envelope with the itinerary nested as its own v-current Vault envelope.
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import('node:fs/promises');
    const zlib = await import('node:zlib');
    const rawGz = await fs.readFile(path as string);
    const raw = zlib.gunzipSync(rawGz).toString('utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.format).toBe('nepal-japan-trip-backup');
    expect(parsed.version).toBe(1);
    // The itinerary lives at domains.itinerary as the CURRENT (v5) Vault envelope (D-227) — the version
    // literal is a change-detector bumped in lockstep with each Vault migration.
    const itin = parsed.domains.itinerary;
    expect(itin.schemaVersion).toBe(5);
    expect(typeof itin.updatedAt).toBe('string');
    const seededDay = itin.payload.find((d: { date: string }) => d.date === SEED_DAY);
    expect(seededDay).toBeTruthy();
    expect(seededDay.items.some((i: { id: string }) => i.id === 's92-exp-1')).toBe(true);
    // The photos envelope is present (empty here — no photos seeded) proving the whole-trip shape.
    expect(parsed.photos).toBeTruthy();
    expect(Array.isArray(parsed.photos.meta)).toBe(true);

    // A success status is shown to the user.
    await expect(page.getByTestId('backup-status')).toBeVisible();
  });
});

test.describe('S92 import — known-good file replaces the trip and survives reload', () => {
  test('choosing a valid backup → confirm → the imported itinerary is reflected and persists', async ({
    page,
  }) => {
    await gotoSettingsSettled(page);
    // Start from one known day; we will import a DIFFERENT trip and expect it to replace.
    await seedItinerary(page, SEED_DAY, [
      { id: 's92-orig', title: 'Original stop that should be replaced', category: 'sightseeing' },
    ]);

    // Build a known-good v3 envelope file for a different day/item.
    const importedEnvelope = {
      schemaVersion: 3,
      updatedAt: '2026-07-05T00:00:00.000Z',
      payload: [
        {
          date: IMPORT_DAY,
          city: 'Kathmandu',
          country: 'nepal',
          items: [{ id: 's92-imported', title: 'Imported temple visit', category: 'cultural' }],
        },
      ],
    };

    await page.getByTestId('backup-import-input').setInputFiles({
      name: 'nepal-japan-trip-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(importedEnvelope), 'utf-8'),
    });

    // Confirm dialog appears, then confirm — the successful restore auto-reloads (S273).
    await expect(page.getByTestId('backup-confirm-dialog')).toBeVisible();
    await confirmAndAwaitReload(page);

    // After the auto-reload the itinerary is re-hydrated from localStorage (persistence proof); the
    // calendar lives on /plan (S322: backup is on /settings now), so hop over to verify it there.
    await gotoPlanCalendar(page);
    await page.getByTestId(`calendar-day-${IMPORT_DAY}`).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: 'Imported temple visit' }),
    ).toHaveCount(1);
    await page.getByTestId(`calendar-day-${SEED_DAY}`).click();
    await expect(
      page
        .locator('[data-testid^="calendar-item-"]')
        .filter({ hasText: 'Original stop that should be replaced' }),
    ).toHaveCount(0);

    // On disk it is the CURRENT (v5) envelope carrying the imported payload.
    const raw = await readItineraryRaw(page);
    expect(raw).not.toBeNull();
    const onDisk = JSON.parse(raw as string);
    // S96/D-104 → S124/D-139: savePlans() writes the v5 envelope now (CURRENT bumped 4→5).
    expect(onDisk.schemaVersion).toBe(5);
    const day = onDisk.payload.find((d: { date: string }) => d.date === IMPORT_DAY);
    expect(day.items.some((i: { id: string }) => i.id === 's92-imported')).toBe(true);
  });

  test('cancelling the confirm dialog leaves the trip unchanged', async ({ page }) => {
    await gotoSettingsSettled(page);
    await seedItinerary(page, SEED_DAY, [
      { id: 's92-keep', title: 'Stop that must remain', category: 'sightseeing' },
    ]);
    const before = await readItineraryRaw(page);

    await page.getByTestId('backup-import-input').setInputFiles({
      name: 'nepal-japan-trip.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({ schemaVersion: 3, updatedAt: 'x', payload: [] }),
        'utf-8',
      ),
    });
    await expect(page.getByTestId('backup-confirm-dialog')).toBeVisible();
    await page.getByTestId('backup-confirm-cancel').click();
    await expect(page.getByTestId('backup-confirm-dialog')).toHaveCount(0);

    // Nothing written — the on-disk value is byte-identical to before.
    expect(await readItineraryRaw(page)).toBe(before);
  });
});

test.describe('S92 import — corrupt file fails safe and the current trip survives', () => {
  test('choosing a corrupt file → confirm → safe error AND pre-import itinerary survives reload', async ({
    page,
  }) => {
    await gotoSettingsSettled(page);
    await seedItinerary(page, SEED_DAY, [
      { id: 's92-safe', title: 'Trip that must not be destroyed', category: 'sightseeing' },
    ]);
    const before = await readItineraryRaw(page);
    expect(before).not.toBeNull();

    await page.getByTestId('backup-import-input').setInputFiles({
      name: 'totally-broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ this is not valid json at all', 'utf-8'),
    });
    await expect(page.getByTestId('backup-confirm-dialog')).toBeVisible();
    await page.getByTestId('backup-confirm-import').click();
    await expect(page.getByTestId('backup-confirm-dialog')).toHaveCount(0);

    // A safe, user-facing error is shown — and NO success.
    await expect(page.getByTestId('backup-error')).toBeVisible();
    await expect(page.getByTestId('backup-status')).toHaveCount(0);

    // The live trip is byte-unchanged, and the corrupt bytes were quarantined (D-096).
    expect(await readItineraryRaw(page)).toBe(before);
    const quarantined = await page.evaluate((k) => window.localStorage.getItem(k), QUARANTINE_KEY);
    expect(quarantined).toBe('{ this is not valid json at all');

    // Survives reload: navigating fresh to /plan re-reads the itinerary from disk (S322: the
    // calendar lives there, backup is on /settings) — the original item is still there, no destruction.
    await gotoPlanCalendar(page);
    await page.getByTestId(`calendar-day-${SEED_DAY}`).click();
    await expect(
      page
        .locator('[data-testid^="calendar-item-"]')
        .filter({ hasText: 'Trip that must not be destroyed' }),
    ).toHaveCount(1);
  });
});

test.describe('S92 confirm dialog portals to body (D-094) — clickable when /settings is scrolled', () => {
  test('with /settings SCROLLED TO THE BOTTOM, the confirm button is topmost + reaches body, and Confirm imports', async ({
    page,
  }) => {
    await gotoSettingsSettled(page);
    await seedItinerary(page, SEED_DAY, [
      { id: 's92-scroll-orig', title: 'Pre-scroll original stop', category: 'sightseeing' },
    ]);

    // Scroll the app <footer> fully into the viewport — this is the exact FU-11 condition
    // under which an INLINE fixed modal's buttons get painted over / pointer-captured by
    // the footer (a sibling outside /plan's .animate-route-fade stacking context). If the
    // dialog were still inline, the click below would be intercepted by the footer and the
    // import would never fire. `scrollIntoViewIfNeeded` (Playwright's own scroll) is used
    // rather than a raw window.scrollTo in page.evaluate, which this app's scroll handling
    // resets back to 0. Assert the footer really is in view BEFORE opening the dialog so
    // this proof can never pass vacuously.
    await page.locator('footer').scrollIntoViewIfNeeded();
    const footerBeforeOpen = await page.evaluate(() => {
      const f = document.querySelector('footer');
      const r = f?.getBoundingClientRect();
      return !!r && r.top < window.innerHeight && r.bottom > 0;
    });
    expect(footerBeforeOpen).toBe(true); // genuinely scrolled to the footer

    // Open the import flow (drive the real hidden input) with a known-good file.
    const importedEnvelope = {
      schemaVersion: 3,
      updatedAt: '2026-07-05T00:00:00.000Z',
      payload: [
        {
          date: IMPORT_DAY,
          city: 'Kathmandu',
          country: 'nepal',
          items: [{ id: 's92-scroll-imported', title: 'Scrolled import stop', category: 'cultural' }],
        },
      ],
    };
    await page.getByTestId('backup-import-input').setInputFiles({
      name: 'nepal-japan-trip-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(importedEnvelope), 'utf-8'),
    });
    await expect(page.getByTestId('backup-confirm-dialog')).toBeVisible();

    // ── FU-11 document-level proof ──────────────────────────────────────────────────
    // At the confirm button's on-screen centre, the TOPMOST hit-test node must be the
    // confirm button itself (not the footer), and walking that node's ancestry upward
    // must reach <body> WITHOUT passing through the route-transition wrapper
    // (.animate-route-fade) — i.e. the dialog is a direct child subtree of body (portaled),
    // not trapped inside /plan's animated content. Mirrors the D-094 elementFromPoint proof.
    const proof = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="backup-confirm-import"]') as HTMLElement;
      if (!btn) return { found: false } as const;
      const r = btn.getBoundingClientRect();
      const topmost = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const topmostIsConfirm = !!topmost && btn.contains(topmost);

      // Ancestry from the dialog root up to (and including) <body>.
      const dialog = document.querySelector('[data-testid="backup-confirm-dialog"]') as HTMLElement;
      let reachesBodyDirectly = false;
      let passedThroughRouteWrapper = false;
      let node: HTMLElement | null = dialog;
      while (node) {
        if (node.classList && node.classList.contains('animate-route-fade')) {
          passedThroughRouteWrapper = true;
        }
        if (node.parentElement === document.body) reachesBodyDirectly = true;
        node = node.parentElement;
      }
      return {
        found: true,
        topmostIsConfirm,
        reachesBodyDirectly,
        passedThroughRouteWrapper,
      } as const;
    });

    expect(proof.found).toBe(true);
    expect(proof.topmostIsConfirm).toBe(true); // at the scrolled footer, the button (not the footer) is topmost
    expect(proof.reachesBodyDirectly).toBe(true); // portaled: dialog subtree is a child of body
    expect(proof.passedThroughRouteWrapper).toBe(false); // NOT trapped in .animate-route-fade

    // And prove it functionally: the click actually lands (Playwright actionability would
    // fail here for an inline modal because the footer would be the topmost element) — the
    // successful restore then auto-reloads (S273).
    await confirmAndAwaitReload(page);

    // The import applied — verify on /plan's calendar (S322: backup is on /settings now).
    await gotoPlanCalendar(page);
    await page.getByTestId(`calendar-day-${IMPORT_DAY}`).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: 'Scrolled import stop' }),
    ).toHaveCount(1);
  });
});
