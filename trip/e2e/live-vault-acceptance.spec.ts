import { test, expect } from '@playwright/test';
import type { ConsoleMessage, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { seedLiveVault } from './fixtures/live-v5-vault/loader';

/**
 * S193 — real-dump byte-for-byte acceptance, on REAL captured user data.
 *
 * Seeds `fixtures/live-v5-vault/live-dump.json` (the REAL capture — schema
 * version 5, 32 days) and proves that on the shipping v5 build:
 *   1. the app boots past the Trip Token wall on the dump's real identity keys
 *      and RENDERS the real data (day 2026-12-09's first itinerary title);
 *   2. every seeded localStorage key survives BYTE-FOR-BYTE after boot settles,
 *      and again after two reloads (a read-only boot must never rewrite —
 *      D-097 never-throw gateway, D-172 legacy literal keys forever);
 *   3. `nepal_japan_itinerary_corrupt` is never created (quarantine not falsely
 *      triggered on real data, D-096);
 *   4. zero console errors / uncaught page errors across the whole run.
 *
 * Harness notes (both inherited from proven specs, not invented here):
 * - `seedLiveVault` seeds via `addInitScript`, which re-fires on every
 *   navigation (persistence.spec.ts "Trap 1"). So each byte check below is a
 *   PER-BOOT assertion — seed, let the app fully boot, then prove the bytes
 *   are untouched. The two reloads repeat that proof on fresh boots; a rewrite
 *   during any boot is caught by that boot's own check before the next re-seed.
 * - Expected bytes are read from the dump FILE at runtime — the real data is
 *   never copied into this spec (a privacy rule); the single rendered-title
 *   assertion is likewise derived from the dump, not hardcoded.
 * - Navigation waits on the planner island's `calendar-day-*` readiness signal,
 *   never `networkidle` (FU-15 — the SW precache keeps the network busy).
 */

const DUMP_PATH = path.join(__dirname, 'fixtures', 'live-v5-vault', 'live-dump.json');
const CORRUPT_KEY = 'nepal_japan_itinerary_corrupt';

interface VaultDump {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

/**
 * The dump holds a real capture from the owner's own device, so it is
 * gitignored and only exists on machines that have it locally. Read it only if
 * it is actually there: this parse runs at module load, so an unguarded
 * readFileSync would fail the whole file to load and take the entire run down
 * with it rather than skipping this one spec.
 *
 * Do not replace the missing file with a synthetic one. The reason this
 * fixture exists is that it contains bytes nobody would think to hand-write,
 * so a stand-in would make the assertions below pass without proving anything.
 */
const HAS_DUMP = fs.existsSync(DUMP_PATH);
const dump: VaultDump = HAS_DUMP
  ? JSON.parse(fs.readFileSync(DUMP_PATH, 'utf-8'))
  : { localStorage: {}, sessionStorage: {} };

/** Wait for the lazy CalendarPlanner island (persistence.spec.ts FU-15 idiom). */
async function waitForPlannerReady(page: Page) {
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'visible' });
}

/**
 * Assert every seeded localStorage key is byte-identical to the dump, after
 * giving any (illegitimate) deferred write a grace window to land. Reports the
 * exact key and a bounded diff on mismatch so a failure names the culprit.
 */
async function expectByteIdentity(page: Page, phase: string) {
  // Grace window: a read-only boot must write NOTHING to seeded keys; this
  // window exists so a debounced rewrite (a bug) cannot dodge the assertion.
  await page.waitForTimeout(1000);
  const actual = await page.evaluate(
    (keys: string[]) =>
      Object.fromEntries(keys.map((k) => [k, window.localStorage.getItem(k)])),
    Object.keys(dump.localStorage),
  );
  for (const [key, expected] of Object.entries(dump.localStorage)) {
    const got = actual[key];
    if (got !== expected) {
      const gotStr = got === null ? '<null (key deleted)>' : got;
      // Bounded diff: first divergent char index + a short window around it.
      let i = 0;
      while (i < Math.min(gotStr.length, expected.length) && gotStr[i] === expected[i]) i++;
      throw new Error(
        `[${phase}] byte-identity FAILED for key "${key}": ` +
          `expected ${expected.length} bytes, got ${got === null ? 'null' : `${gotStr.length} bytes`}; ` +
          `first divergence at index ${i}: ` +
          `expected …${JSON.stringify(expected.slice(Math.max(0, i - 20), i + 20))}… ` +
          `got …${JSON.stringify(gotStr.slice(Math.max(0, i - 20), i + 20))}…`,
      );
    }
  }
}

test.describe('S193 live-vault acceptance — real dump, byte-for-byte', () => {
  test.skip(
    !HAS_DUMP,
    'real captured vault dump absent (gitignored, local-only) — this acceptance cannot run in CI',
  );

  test('real dump boots, renders real data, and survives byte-identical across boot + two reloads', async ({
    page,
  }) => {
    // Sanity on the fixture itself: this is the REAL dump, not the placeholder.
    const itineraryEnvelope = JSON.parse(dump.localStorage['nepal_japan_itinerary']);
    expect(itineraryEnvelope.schemaVersion).toBe(5);
    expect(dump.localStorage[CORRUPT_KEY]).toBeUndefined();
    // The one permitted real-data probe: day 2026-12-09's first item title,
    // derived from the dump at runtime (never pasted into this file).
    const day9 = itineraryEnvelope.payload.find(
      (d: { date: string }) => d.date === '2026-12-09',
    );
    expect(day9?.items?.length).toBeGreaterThan(0);
    const realFirstTitle: string = day9.items[0].title;

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err: Error) => pageErrors.push(err.message));

    await seedLiveVault(page, DUMP_PATH);

    // Boot: the dump's real tripPlannerToken/tripPlannerUserName must satisfy
    // the Trip Token wall. The real capture has NO `nepal_japan_first_run_tour_seen`
    // key, so the first-run tour opens — and per itinerary-provider.tsx the tour only
    // shows ONCE THE GATE HAS RESOLVED, so its presence is itself proof the wall
    // accepted the dump's identity keys. Skip it (the real user path; writes only the
    // non-seeded tour key, so byte-identity of seeded keys is untouched) and then
    // assert no dialog remains.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.getByTestId('tour-dialog')).toBeVisible();
    await page.getByTestId('tour-skip').click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    // Render the REAL data: /plan, select 2026-12-09, the real first item
    // title from the real capture is visible in the day's agenda.
    await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);
    await page.getByTestId('calendar-day-2026-12-09').click();
    await expect(
      page.locator('[data-testid^="calendar-item-"]').filter({ hasText: realFirstTitle }),
    ).toHaveCount(1);

    // (a) Byte-identity after the boot settles.
    await expectByteIdentity(page, 'after boot');
    // (b) First reload — a fresh boot on the same bytes.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);
    await expectByteIdentity(page, 'after reload 1');
    // (c) Second reload — idempotence, not a one-off.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);
    await expectByteIdentity(page, 'after reload 2');

    // D-096: the corrupt-quarantine key was absent in the dump (asserted above)
    // and must NOT have been created by any of the three clean boots.
    const corrupt = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      CORRUPT_KEY,
    );
    expect(corrupt, 'quarantine falsely triggered on real data').toBeNull();

    // Zero console errors / uncaught page errors across the entire spec.
    expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
    expect(pageErrors, `uncaught page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });
});
