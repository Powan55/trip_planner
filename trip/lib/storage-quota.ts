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
 * LAYOUT's chunk graph. Importing this number from `lib/preflight.ts` pulled that whole module in
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
 * 0.9 (90% of the StorageManager quota). Still the same un-measured heuristic it always was:
 * headroom for one more journal/expense/photo write before the browser starts throwing.
 */
export const QUOTA_WARN_THRESHOLD = 0.9;
