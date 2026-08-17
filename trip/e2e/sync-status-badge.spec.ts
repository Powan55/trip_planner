import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S229 — app-wide sync-status badge (`components/sync-status-badge.tsx`) E2E pack.
 *
 * ── WHAT THIS SANDBOX CAN PROVE FOR REAL ────────────────────────────────────────────────
 * The badge is gated by `hooks/use-sync-status.ts` → `core/sync/outbox.ts`'s `outboxSnapshot()`,
 * which is itself gated on `isRemoteConfigured()` (D-038/D-055/D-120) — a build-time-inlined
 * read of `NEXT_PUBLIC_FIREBASE_*`. This repo's `.env.local` is intentionally absent (see
 * `.env.local.example`), so the served static `out/` build exercised here is DORMANT:
 * `isRemoteConfigured()` is `false` on every navigation, regardless of what's seeded into
 * localStorage. That makes the "badge absent on a dormant build" case the one thing this
 * harness can prove with a REAL browser run — which is exactly what's below, on TWO routes.
 *
 * ── WHAT NEEDS A FIREBASE-CONFIGURED BUILD (documented, not faked) ──────────────────────
 * "Pending count appears after an offline-queued edit / clears after reconnect+flush", the
 * badge's own axe scan, and its reduced-motion transform-identity check ALL require
 * `isRemoteConfigured()` to read `true` in the SERVED build — impossible to fake from inside a
 * test (it's inlined at `next build` time, not a runtime toggle). These mechanics ARE already
 * proven for real, off-Firebase, at the unit level:
 *   - `lib/__tests__/core-sync-outbox.test.ts` (S229 block): `outboxSnapshot()` gating, the
 *     `lastAckAt` stamp on ack, the same-tab `SYNC_OUTBOX_CHANGED_EVENT` dispatch.
 *   - `lib/__tests__/use-sync-status.test.ts`: the hook goes pending>0 → 0 LIVE off a REAL
 *     `withOutbox`/`flushOutbox` enqueue→ack cycle (no mocked event), a real cross-tab `storage`
 *     event, dormant gating even with real bytes on disk, and the 4th-domain pending-sum
 *     tolerance S229 calls out by name.
 * The browser-only residue (axe + reduced-motion + live count on a REAL rendered pill) is a
 * MANUAL procedure, not a test. It used to sit here as a `test.describe.skip` with
 * `expect(true).toBe(true)` bodies, which inflated the spec count while asserting nothing;
 * it now lives in `docs/two-phone-sync-check.md` where a runbook belongs.
 */

async function goto(page: Page, path: string) {
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

test.describe('S229 · sync-status badge — dormant build (this sandbox, signed-in identity)', () => {
  test('absent on Home (dormant: no firebase env → isRemoteConfigured() is false)', async ({ page }) => {
    await goto(page, '/');
    await expect(page.getByTestId('sync-status-badge')).toHaveCount(0);
  });

  test('absent even with real dirty-shaped bytes seeded into the outbox slot key', async ({ page }) => {
    // Seed a plausible-looking dirty outbox slot BEFORE any app script — if the gate were
    // bypassed, the badge would render "1 pending" here. It must not: the gate is evaluated
    // first, independent of what's on disk (mirrors lib/__tests__/use-sync-status.test.ts's
    // DORMANT unit case, now proven against the real served build + real localStorage).
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'nepal_japan_sync_outbox',
        JSON.stringify({ version: 1, dirty: { itinerary: ['2026-12-09'] } }),
      );
    });
    await goto(page, '/');
    await expect(page.getByTestId('sync-status-badge')).toHaveCount(0);
  });

  test('absent on a second route too (mounted once at the root layout, same gate everywhere)', async ({
    page,
  }) => {
    await goto(page, '/plan/');
    await expect(page.getByTestId('sync-status-badge')).toHaveCount(0);
  });
});
