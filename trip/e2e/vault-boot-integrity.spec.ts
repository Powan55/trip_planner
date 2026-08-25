import { test, expect } from '@playwright/test';
import type { ConsoleMessage, Page } from '@playwright/test';
import fs from 'node:fs';
import { seedLiveVault, PLACEHOLDER_DUMP_PATH } from './fixtures/live-v5-vault/loader';

/**
 * Issue #231 — vault boot integrity, CI-runnable half.
 *
 * `live-vault-acceptance.spec.ts` (S193) proves byte-identity across a boot +
 * two reloads, but only against the REAL captured dump — it `test.skip`s its
 * entire suite in CI (the dump is gitignored, local-only). `live-v5-vault-loader.spec.ts`
 * runs in CI on the committed PLACEHOLDER dump, but only proves the loader
 * mechanism plus ONE field surviving ONE reload.
 *
 * Neither one, in CI, proves a read-only boot leaves KEYS THE USER DID NOT
 * TOUCH byte-identical across multiple reloads, with zero console errors and
 * no falsely-triggered quarantine. This spec is that structural half — same
 * assertions as S193's byte-identity/quarantine/console-error checks, on the
 * committed PLACEHOLDER dump instead of the real one, so it actually runs on
 * every PR.
 *
 * The placeholder's `nepal_japan_itinerary` slot is seeded at
 * `CURRENT_ITINERARY_VERSION` (core/vault/migrations.ts) on purpose: a
 * read-only boot against an OLDER schema version would legitimately run the
 * migration chain and hand back an upgraded payload shape, which is correct
 * migration behavior, not a bug — but it would fail a byte-identity check on
 * that key for the wrong reason. Seeding at the current version keeps this
 * spec's byte-identity check meaningful (an untouched key changing would be a
 * real regression) without also asserting anything about migration output.
 */

const CORRUPT_KEY = 'nepal_japan_itinerary_corrupt';

const dump: { localStorage: Record<string, string>; sessionStorage: Record<string, string> } =
  JSON.parse(fs.readFileSync(PLACEHOLDER_DUMP_PATH, 'utf-8'));

/** Wait for the lazy CalendarPlanner island (persistence.spec.ts FU-15 idiom). */
async function waitForPlannerReady(page: Page) {
  await page.locator('[data-testid^="calendar-day-"]').first().waitFor({ state: 'visible' });
}

/** Assert every seeded localStorage key is still byte-identical to the dump. */
async function expectByteIdentity(page: Page, phase: string) {
  // Grace window so a debounced rewrite (a bug) cannot dodge the assertion.
  await page.waitForTimeout(1000);
  const actual = await page.evaluate(
    (keys: string[]) =>
      Object.fromEntries(keys.map((k) => [k, window.localStorage.getItem(k)])),
    Object.keys(dump.localStorage),
  );
  for (const [key, expected] of Object.entries(dump.localStorage)) {
    expect(actual[key], `[${phase}] key "${key}" changed`).toBe(expected);
  }
}

test.describe('vault boot integrity (CI, placeholder dump) — #231', () => {
  test('read-only boot + two reloads: every seeded key stays byte-identical, no quarantine, zero console errors', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err: Error) => pageErrors.push(err.message));

    await seedLiveVault(page, PLACEHOLDER_DUMP_PATH);

    // Placeholder already seeds `nepal_japan_first_run_tour_seen`, so the
    // Trip Token wall resolves straight through with no tour dialog.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    await page.goto('/plan/', { waitUntil: 'domcontentloaded' });
    await waitForPlannerReady(page);

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

    // D-096: quarantine must never be falsely triggered on a well-formed vault.
    const corrupt = await page.evaluate((key) => window.localStorage.getItem(key), CORRUPT_KEY);
    expect(corrupt, 'quarantine falsely triggered on a well-formed boot').toBeNull();

    expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
    expect(pageErrors, `uncaught page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });
});
