// Delegate re-export. The trip's day-by-day plan content now lives in
// the framework-free content root `core/content/itinerary.ts` (the single authoring source),
// so `TRIP_CITIES` can be DERIVED from it without `core/` importing `lib/` at runtime
// This module keeps the identical public surface — `SAMPLE_ITINERARY` is the SAME
// object as `TRIP_ITINERARY` — so the Vault fallback wiring (`itinerary-storage.ts` →
// `VaultConfig.fallback`) and every caller are untouched (the delegate
// pattern). Edit the trip plan in core/content/itinerary.ts.
export { TRIP_ITINERARY as SAMPLE_ITINERARY } from '@/core/content/itinerary';
