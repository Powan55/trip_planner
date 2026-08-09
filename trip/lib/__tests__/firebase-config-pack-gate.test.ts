// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * S232 (D-205 amends D-172 item 5 / D-210) — the sync gate + dynamic trip id. This file
 * supersedes the S183 default-pack-gate test: D-205 REMOVED the `getActiveTripId() ===
 * DEFAULT_TRIP_ID` clause from `isRemoteConfigured()` so remote sync now activates for ANY
 * active pack once the Firebase web config is present. The former security choke point moved
 * to the capability-token Firestore path (`getTripId()`), proven here.
 *
 * We import firebase-config with a PRESENT config (env stubbed) so the only variable is the
 * active pack. resetModules + dynamic import gives a fresh FIREBASE_CONFIG bound to the env.
 */
async function loadConfigWithEnv() {
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'test-key');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'test-project');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_ID', 'test-app');
  vi.resetModules();
  return import('@/lib/firebase-config');
}

describe('firebase-config sync gate + dynamic trip id (S232 / D-205 / D-210)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('config present + default pack (pointer unset) ⇒ isRemoteConfigured() is true (sync ON)', async () => {
    const { isRemoteConfigured } = await loadConfigWithEnv();
    expect(isRemoteConfigured()).toBe(true);
  });

  it('config present + NON-default active pack ⇒ isRemoteConfigured() is now TRUE (D-205 removed the pack gate)', async () => {
    const { isRemoteConfigured } = await loadConfigWithEnv();
    localStorage.setItem('tripPlannerActiveTrip', 'hokkaido-2027');
    expect(isRemoteConfigured()).toBe(true);
  });

  it('config ABSENT ⇒ false regardless of pack (dormant local-only, unchanged)', async () => {
    // no env stubbed here → FIREBASE_CONFIG values undefined
    vi.resetModules();
    const { isRemoteConfigured } = await import('@/lib/firebase-config');
    expect(isRemoteConfigured()).toBe(false);
    localStorage.setItem('tripPlannerActiveTrip', 'nepal-japan-2026');
    expect(isRemoteConfigured()).toBe(false);
  });

  // ── getTripId() — the REMOTE capability token (D-205 fork 1) ───────────────────────────────
  describe('getTripId() resolves the Firestore path segment per active pack', () => {
    it('default pack, no NEXT_PUBLIC_TRIP_ID override ⇒ falls back to the default slug', async () => {
      const { getTripId } = await loadConfigWithEnv();
      expect(getTripId()).toBe('nepal-japan-2026');
    });

    it('default pack (pointer explicitly written) still uses the env-var token, NOT the local id', async () => {
      // The grandfathered LOCAL id stays nepal-japan-2026 (D-172); the REMOTE token comes from
      // NEXT_PUBLIC_TRIP_ID — a separately-minted secret, because the literal slug is public.
      vi.stubEnv('NEXT_PUBLIC_TRIP_ID', 'secret-remote-token-abc');
      const { getTripId } = await loadConfigWithEnv();
      localStorage.setItem('tripPlannerActiveTrip', 'nepal-japan-2026');
      expect(getTripId()).toBe('secret-remote-token-abc');
    });

    it('non-default pack ⇒ the local pack id IS the capability token (returned verbatim)', async () => {
      // Even with an env override set, a non-default pack ignores it — its own id is the token.
      vi.stubEnv('NEXT_PUBLIC_TRIP_ID', 'secret-remote-token-abc');
      const { getTripId } = await loadConfigWithEnv();
      localStorage.setItem('tripPlannerActiveTrip', 'a1b2c3d4-token');
      expect(getTripId()).toBe('a1b2c3d4-token');
    });
  });
});
