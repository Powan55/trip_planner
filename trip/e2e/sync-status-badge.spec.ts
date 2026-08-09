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
 * ── WHAT NEEDS A FIREBASE-CONFIGURED BUILD (documented, not faked — mirrors
 *    e2e/sync-two-client.spec.ts's honesty pattern for the exact same sandbox constraint) ──────
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
 * The `test.skip` block below is the manual/integration-QA procedure for the browser-only
 * residue (axe + reduced-motion + live count on a REAL rendered pill), kept visible as SKIPPED
 * (not silently omitted) per the same policy `sync-two-client.spec.ts` documents in full.
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

test.describe.skip(
  'S229 · sync-status badge — LIVE proof against a firebase-configured build (integration-QA, see file header)',
  () => {
    test('pending count appears the instant an edit is queued offline, and clears on reconnect+flush', async () => {
      // Preconditions: a build WITH real NEXT_PUBLIC_FIREBASE_* env (so isRemoteConfigured() is
      // true) served over `out/`, signed in as a real Trip Token traveler.
      //   1. context.setOffline(true); make an itinerary edit (e.g. add a plan item on /plan).
      //   2. Assert `sync-status-badge` is visible, data-state="pending", text contains "1 pending".
      //   3. context.setOffline(false); wait for the app's flush trigger (online event / visible).
      //   4. Assert the badge either disappears (if `lastAckAt` was already null pre-edit — first
      //      ever sync) or flips to data-state="synced" with "Synced just now".
      expect(true).toBe(true); // placeholder body; test.describe.skip prevents execution
    });

    test('zero serious/critical axe violations on the rendered "N pending" pill', async () => {
      // Same offline-queue setup as above, then AxeBuilder(page).include('[data-testid="sync-status-badge"]').analyze()
      // → expect(results.violations.filter(v => ['serious','critical'].includes(v.impact ?? ''))).toEqual([]).
      expect(true).toBe(true);
    });

    test('reduced motion: the reveal transform is neutralized (animationName/transform identity)', async () => {
      // page.emulateMedia({ reducedMotion: 'reduce' }) BEFORE navigation, trigger the offline
      // queue as above, then assert getComputedStyle(badge).transform is the identity matrix (or
      // 'none') and animationName is 'none' — mirrors e2e/motion.spec.ts's pattern for
      // OfflineBanner's identical `m.div` reveal.
      expect(true).toBe(true);
    });
  },
);
