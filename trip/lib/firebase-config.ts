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
 * Returns true ONLY when the minimal required web-config values are all present and
 * non-empty (at minimum apiKey, projectId, appId). Absence of any one => false => the
 * app is dormant (localStorage-only, behaves exactly as today). Every future remote
 * code path (SDK init, snapshot subscribe, push, identity prompt) checks this gate and
 * no-ops when it is false.
 */
export function isRemoteConfigured(): boolean {
  const { apiKey, projectId, appId } = FIREBASE_CONFIG;
  return Boolean(apiKey && projectId && appId);
}

// The fixed shared trip id — the group shares one trip document tree
// (trips/{TRIP_ID}/days/{date}). Overridable via env; defaults to the trip's slug.
export const TRIP_ID = process.env.NEXT_PUBLIC_TRIP_ID || 'nepal-japan-2026';
