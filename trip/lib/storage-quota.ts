/**
 * The near-quota threshold, and nothing else. This module exists to be IMPORT-CHEAP.
 *
 * It used to live in `lib/preflight.ts`, moved there so the proactive near-quota TOAST
 * (`components/storage-persistence.tsx`) and the readiness ROW (`components/preflight-checks.tsx`)
 * could never disagree about what "nearly full" means. That guarantee is worth keeping and is
 * kept — both still read this one constant. What was wrong was WHERE it lived.
 *
 * 🔴 WHY IT IS ITS OWN FILE, AND WHY MOVING IT BACK BREAKS THE APP OFFLINE.
 * `StoragePersistence` is mounted in `app/layout.tsx`, so anything it imports lands in the ROOT
 * LAYOUT's chunk graph. Until #757, importing this number from `lib/preflight.ts` pulled that whole module in
 * — including the string `maplibregl`, which preflight carries as the marker it SEARCHES cached
 * chunks for. Two independent consumers read "chunk body contains that string" as "this chunk IS
 * the map engine": `scripts/gen-sw.mjs`'s isMaplibreChunk(), and `e2e/pwa.spec.ts`'s eviction
 * test. So the root layout's own chunk got classified as maplibre, the eviction test deleted it,
 * and `app/global-error.tsx` replaced EVERY route — the whole app, offline, not just the map.
 *
 * That is not merely a test artefact. A real storage-pressure eviction of the map engine would
 * have taken the root layout with it, which is the failure the boundary exists to prevent and the
 * one place a boundary cannot help.
 *
 * The rule this file encodes: nothing reachable from `app/layout.tsx` may import
 * `lib/preflight.ts`. `e2e/pwa.spec.ts:651` is what fails if that is ever undone.
 */

/**
 * 0.9 of `LOCAL_CAP_BYTES`: headroom for one more journal/expense write before localStorage
 * starts throwing.
 */
export const QUOTA_WARN_THRESHOLD = 0.9;

/**
 * The localStorage cap that actually refuses writes: ~5M UTF-16 chars, i.e. 10 MiB at 2 bytes
 * each. Not `navigator.storage.estimate()`, whose quota is the whole origin (GBs) and never
 * reads near full before localStorage does (#1130).
 */
export const LOCAL_CAP_BYTES = 10 * 1024 * 1024;

/** localStorage bytes in use (UTF-16: 2 per char, keys included), or null if it can't be read. */
export function localStorageBytes(): number | null {
  try {
    let chars = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      chars += key.length + (localStorage.getItem(key) ?? '').length;
    }
    return chars * 2;
  } catch {
    return null;
  }
}
