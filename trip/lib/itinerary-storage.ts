/**
 * The itinerary localStorage contract — a delegate re-export.
 *
 * The implementation moved to `core/vault/storage.ts` (#158, D-099): `core/vault/export-import.ts`
 * needs `loadPlans()` at RUNTIME, and a `core -> lib` runtime edge points the dependency arrow the
 * wrong way. This module keeps the identical public surface — the same three functions and the same
 * two key constants, the SAME objects — so `hooks/use-itinerary.ts`, `lib/itinerary-remote.ts`,
 * every component and every test are untouched. The contract itself (key-presence three-state,
 * `[]`-survives, quarantine-before-fallback) is documented on the core module.
 */
export {
  ITINERARY_STORAGE_KEY,
  ITINERARY_QUARANTINE_KEY,
  loadPlans,
  hasStoredPlans,
  savePlans,
} from '@/core/vault/storage';
