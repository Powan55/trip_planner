// Single source of truth for the Firebase web config and the remote-sync on/off gate.
//
// This config is PUBLIC by design. A Firebase web config (apiKey/appId/etc.) is NOT
// a secret — these values only *name* the Firebase project and are visible in any
// client bundle. The real authorization gate is server-side Firestore Security Rules
// (evaluated by Google) paired with Anonymous Auth; shipping these in the static
// bundle is correct, not a leak. (Contrast: a bearer token / PAT in client JS WOULD
// be a leak.)
//
// Mirrors the BASE_PATH / withBasePath single-source pattern in lib/utils.ts: the
// values and the on/off decision live in exactly ONE place, so the dormant-safe
// property is enforced structurally, not by scattered process.env checks. No other
// module should read process.env.NEXT_PUBLIC_FIREBASE_*.
//
// ABSENCE => local-only mode. When the essential web-config values are not present,
// isRemoteConfigured() returns false and the entire remote layer stays inert: the app
// behaves exactly as a localStorage-only client. This is the default state of the repo
// and of any fork/clone with no env configured.

import { getActiveTripId, DEFAULT_TRIP_ID } from '@/core/storage/gateway';

// All NEXT_PUBLIC_* so they are inlined at build time (static export safe — no server).
export const FIREBASE_CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
} as const;

/**
 * The single on/off gate for the entire remote-sync feature.
 *
 * Returns true when the minimal required web-config values are all present and non-empty
 * (at minimum apiKey, projectId, appId). Absence of any config value => false => the app is
 * dormant (localStorage-only, behaves exactly as today). Every remote code path (SDK init,
 * snapshot subscribe, push, presence) checks this gate and no-ops when it is false.
 *
 * NO PACK GATE: sync now activates for ANY active
 * pack once the Firebase web config is present — not just the default pack. "Once it holds a
 * valid token" is true for every pack by construction: the default pack's remote token comes
 * from the env var (`getTripId()`), and every non-default pack's remote token IS its local
 * pack id. An "invalid" pasted string simply resolves to an empty, harmless,
 * never-synced trip, so no extra token-validity check is needed. Never throws. SSR-safe.
 */
export function isRemoteConfigured(): boolean {
  const { apiKey, projectId, appId } = FIREBASE_CONFIG;
  return Boolean(apiKey && projectId && appId);
}

/**
 * Resolve the Firestore path segment for the ACTIVE pack — the trip's REMOTE capability token.
 * Dynamic, read per call (never cached at module scope) so a pack switch picks up the new id.
 *
 * - Default pack (id-equality with `DEFAULT_TRIP_ID`): returns `''` — the default pack has NO
 * remote path any more (#10). It is a LOCAL-ONLY SAMPLE. The old `NEXT_PUBLIC_TRIP_ID` env
 * read is retired: it was described as "a separately-minted secret", which was false — a
 * NEXT_PUBLIC_* value inlines into the public bundle at build time, so the "secret" shipped to
 * every visitor and the world-readable remote trip it named had to be retired with it (rotation
 * of the live remote id is an owner runbook step, not app code).
 * - Every other pack: the local pack id IS the capability token — return it verbatim.
 *
 * Never throws (getActiveTripId inherits the gateway's never-throw). SSR-safe: getActiveTripId
 * returns DEFAULT_TRIP_ID with no window, so SSR resolves '' (nothing remote server-side).
 */
export function getTripId(): string {
  const activeId = getActiveTripId();
  if (activeId === DEFAULT_TRIP_ID) {
    return '';
  }
  return activeId;
}

/**
 * #10 — the TRIP-scoped remote gate: is remote sync live for the ACTIVE pack?
 * `isRemoteConfigured()` (the web config) AND a non-empty remote trip id. On the default pack
 * `getTripId()` is `''`, so this is false in every build — the sample never syncs — while custom
 * trips behave exactly as before. Every module that composes `doc(db, 'trips', getTripId(), …)`
 * must gate on THIS, not on `isRemoteConfigured()`; account-scoped paths
 * (`trips/{userToken}/profile/*`) keep gating on `isRemoteConfigured()` alone.
 */
export function isTripRemoteConfigured(): boolean {
  return isRemoteConfigured() && getTripId() !== '';
}
