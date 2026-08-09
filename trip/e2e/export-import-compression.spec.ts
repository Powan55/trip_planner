import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import zlib from 'node:zlib';

/**
 * S228 — gzip transport for the whole-trip export/import (D-098: transport only, schema
 * untouched). Real-browser proof that `core/vault/compression.ts` is actually wired into
 * `components/backup-restore.tsx`:
 *   - EXPORT in a real Chromium (which supports CompressionStream) downloads a `.gz` file
 *     whose bytes carry the gzip magic header AND gunzip (via Node's zlib, independent of
 *     the app) back to the exact v-current Vault envelope.
 *   - IMPORT of that same compressed file round-trips through the UI into the live calendar.
 *   - BACKWARD COMPAT: an OLD plain-JSON file (pre-S228, no gzip magic, whatever its
 *     extension) still imports successfully — auto-detected by content, not filename.
 *
 * S322 (A4): Backup & Restore moved OFF `/plan` into the Settings "Data management" group
 * (`/settings`) — a native `<details>` we expand before interacting; the imported itinerary is
 * verified on `/plan`'s calendar after the restore's auto-reload.
 */

const ITINERARY_KEY = 'nepal_japan_itinerary';
const SEED_DAY = '2026-12-12';
const IMPORT_DAY = '2026-12-15';

/** Expand the Settings "Data management" group (native <details>) so backup controls are reachable. */
async function expandData(page: Page) {
  const panel = page.getByTestId('backup-restore');
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

/** S273: a successful restore auto-reloads (~600ms) to re-hydrate every store (D-172); wait it out. */
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

test.describe('S228 export is gzip-compressed in a real browser', () => {
  test('Export downloads a .gz file whose bytes are real gzip and gunzip to the v-current envelope', async ({
    page,
  }) => {
    await gotoSettingsSettled(page);
    await seedItinerary(page, SEED_DAY, [
      { id: 's228-exp-1', title: 'Everest flight at dawn', category: 'photography' },
    ]);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('backup-export-button').click(),
    ]);

    // Filename carries the .gz marker (a hint, not the detection mechanism itself).
    expect(download.suggestedFilename()).toBe('nepal-japan-trip-backup.json.gz');

    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(path as string);

    // Real gzip magic bytes.
    expect(raw[0]).toBe(0x1f);
    expect(raw[1]).toBe(0x8b);

    // Gunzip with Node's OWN zlib (independent of the app's CompressionStream usage) proves
    // the bytes are genuinely standard gzip, not a look-alike header. S273: the payload is the
    // whole-trip backup envelope with the itinerary nested at domains.itinerary.
    const gunzipped = zlib.gunzipSync(raw).toString('utf-8');
    const parsed = JSON.parse(gunzipped);
    expect(parsed.format).toBe('nepal-japan-trip-backup');
    const itin = parsed.domains.itinerary;
    expect(typeof itin.schemaVersion).toBe('number');
    const seededDay = itin.payload.find((d: { date: string }) => d.date === SEED_DAY);
    expect(seededDay.items.some((i: { id: string }) => i.id === 's228-exp-1')).toBe(true);

    await expect(page.getByTestId('backup-status')).toBeVisible();
  });
});

test.describe('S228 import round-trips a compressed file through the real UI', () => {
  test('importing a freshly-gzipped envelope (built with Node zlib) replaces the trip and survives reload', async ({
    page,
  }) => {
    await gotoSettingsSettled(page);
    await seedItinerary(page, SEED_DAY, [
      { id: 's228-orig', title: 'Stop that should be replaced', category: 'sightseeing' },
    ]);

    const envelope = {
      schemaVersion: 3,
      updatedAt: '2026-07-17T00:00:00.000Z',
      payload: [
        {
          date: IMPORT_DAY,
          city: 'Kathmandu',
          country: 'nepal',
          items: [{ id: 's228-imported', title: 'Imported via gzip', category: 'cultural' }],
        },
      ],
    };
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(envelope), 'utf-8'));

    await page.getByTestId('backup-import-input').setInputFiles({
      name: 'nepal-japan-trip-backup.json.gz',
      mimeType: 'application/gzip',
      buffer: gz,
    });

    await expect(page.getByTestId('backup-confirm-dialog')).toBeVisible();
    // The successful restore auto-reloads (S273) — this IS the persistence proof for the compressed path.
    await confirmAndAwaitReload(page);

    await gotoPlanCalendar(page); // S322: the calendar lives on /plan, backup is on /settings
    await page.getByTestId(`calendar-day-${IMPORT_DAY}`).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: 'Imported via gzip' }),
    ).toHaveCount(1);
  });
});

test.describe('S228 backward compat — an OLD plain-JSON export (pre-S228) still imports', () => {
  test('a plain (uncompressed) v3 envelope file, no gzip magic bytes, imports successfully', async ({
    page,
  }) => {
    await gotoSettingsSettled(page);
    await seedItinerary(page, SEED_DAY, [
      { id: 's228-bc-orig', title: 'Pre-compat original stop', category: 'sightseeing' },
    ]);

    // A REAL pre-S228 export: plain JSON bytes, no gzip magic — exactly what a user's
    // already-downloaded trip file looks like today. Given a misleading `.gz` extension on
    // purpose to prove detection is by CONTENT, not filename.
    const oldPlainEnvelope = {
      schemaVersion: 3,
      updatedAt: '2026-01-01T00:00:00.000Z',
      payload: [
        {
          date: IMPORT_DAY,
          city: 'Kathmandu',
          country: 'nepal',
          items: [{ id: 's228-bc-imported', title: 'Old plain-JSON import', category: 'food' }],
        },
      ],
    };
    const plainBuffer = Buffer.from(JSON.stringify(oldPlainEnvelope), 'utf-8');
    // Sanity: genuinely not gzip-magic.
    expect(plainBuffer[0]).not.toBe(0x1f);

    await page.getByTestId('backup-import-input').setInputFiles({
      name: 'old-backup-misleadingly-named.gz',
      mimeType: 'application/json',
      buffer: plainBuffer,
    });

    await expect(page.getByTestId('backup-confirm-dialog')).toBeVisible();
    // The successful restore auto-reloads (S273); the reload IS the persistence proof.
    await confirmAndAwaitReload(page);

    await gotoPlanCalendar(page); // S322: the calendar lives on /plan, backup is on /settings
    await page.getByTestId(`calendar-day-${IMPORT_DAY}`).click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: 'Old plain-JSON import' }),
    ).toHaveCount(1);
  });
});
