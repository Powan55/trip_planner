// Delegate re-export of `TRIP_ITINERARY` from the framework-free content root
// `core/content/itinerary.ts`, which is the single authoring source. EDIT THE TRIP PLAN THERE,
// not here.
//
// This docblock used to justify the module by the Vault fallback wiring it kept untouched
// (`itinerary-storage.ts` -> `VaultConfig.fallback`). That is no longer why it exists (#439):
// `core/vault/storage.ts` imports `TRIP_ITINERARY` from the content root DIRECTLY, and
// `itinerary-storage.ts` does not mention the sample at all, so the Vault no longer routes
// through this file.
//
// ONE production consumer remains, `lib/leg-label.ts`. Everything else naming SAMPLE_ITINERARY
// either imports the content root itself or only mentions it in prose. Worth knowing before
// assuming this alias is load-bearing: it is a one-caller convenience, and the honest options
// when that caller next changes are to point it at the content root and delete this file, or to
// keep it deliberately rather than by inertia.
export { TRIP_ITINERARY as SAMPLE_ITINERARY } from '@/core/content/itinerary';
