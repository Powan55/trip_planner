// Delegate re-export. The trip's day-by-day plan content lives in the framework-free content root
// `core/content/itinerary.ts` (the single authoring source), so `TRIP_CITIES` can be DERIVED from
// it without `core/` importing `lib/` at runtime. `SAMPLE_ITINERARY` is the SAME object as
// `TRIP_ITINERARY`, not a copy — edit the trip plan in core/content/itinerary.ts.
//
// The Vault no longer routes through this alias: `core/vault/storage.ts` imports `TRIP_ITINERARY`
// from the content root directly, so the seed/fallback wiring does not depend on this file. ONE
// production consumer is left — `lib/leg-label.ts`, for its by-date `DAY_LABELS` map — plus the
// tests that assert against the seed.
export { TRIP_ITINERARY as SAMPLE_ITINERARY } from '@/core/content/itinerary';
