import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Live-vault fixture loader (slice S172, M19 Phase 0). Seeds a REAL captured
 * localStorage/sessionStorage dump — or, until the real capture lands, the
 * clearly-marked synthetic placeholder — into a fresh Playwright browser
 * context BEFORE any app script runs, via `page.addInitScript` (the same
 * seeding idiom `e2e/fixtures.ts` already uses for the default-traveler /
 * first-run-tour seeds).
 *
 * Dump file format (must match S171's DevTools capture snippet output):
 *   {
 *     "localStorage": { "<key>": "<raw string value>", ... },
 *     "sessionStorage": { "<key>": "<raw string value>", ... }
 *   }
 * Keys/values are seeded EXACTLY as `core/storage/gateway.ts` (D-097 LOCKED)
 * reads them — raw strings only, no re-encoding. A dump may omit any key (an
 * absent key seeds nothing for that slot, matching a fresh-install app).
 *
 * This module is E2E-fixture-only: it is never imported by production code.
 */

export interface VaultDump {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

function readDump(dumpPath: string): VaultDump {
  let raw: string;
  try {
    raw = fs.readFileSync(dumpPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `live-v5-vault loader: dump file not found at "${dumpPath}" — ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `live-v5-vault loader: dump file at "${dumpPath}" is not valid JSON — ${(err as Error).message}`,
    );
  }

  const dump = parsed as Partial<VaultDump> | null;
  if (
    typeof dump !== 'object' ||
    dump === null ||
    typeof dump.localStorage !== 'object' ||
    dump.localStorage === null ||
    typeof dump.sessionStorage !== 'object' ||
    dump.sessionStorage === null
  ) {
    throw new Error(
      `live-v5-vault loader: dump file at "${dumpPath}" is malformed — expected ` +
        `{ localStorage: {...}, sessionStorage: {...} }, got: ${raw.slice(0, 200)}`,
    );
  }

  return { localStorage: dump.localStorage as Record<string, string>, sessionStorage: dump.sessionStorage as Record<string, string> };
}

/**
 * Seed `page`'s browser context from a vault dump file, before any app script
 * runs. Call this BEFORE `page.goto(...)`. Throws a clear error synchronously
 * if the dump file is missing or malformed (fails fast, never seeds a bad
 * dump silently).
 */
export async function seedLiveVault(page: Page, dumpPath: string): Promise<void> {
  const dump = readDump(dumpPath);
  await page.addInitScript((d: VaultDump) => {
    for (const [key, value] of Object.entries(d.localStorage)) {
      window.localStorage.setItem(key, value);
    }
    for (const [key, value] of Object.entries(d.sessionStorage)) {
      window.sessionStorage.setItem(key, value);
    }
  }, dump);
}

/** The NOT-ACCEPTANCE synthetic placeholder dump — keeps specs green pre-real-capture. */
export const PLACEHOLDER_DUMP_PATH = path.join(__dirname, 'PLACEHOLDER-synthetic-dump.json');
