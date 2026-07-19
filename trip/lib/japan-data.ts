// (v5 Phase 1, track b): this file is now a re-export FACADE over
// `core/content/registry.ts` ( pattern, same as `lib/trip-data.ts` over
// `core/dates`) — same exported names, same values (byte-identical data), so
// every existing consumer here is untouched. The literal guide data lives in
// the registry now, resolved there via `contentRef`/`contentKey`.
// Kept as a separate file (rather than deleted) for import-path stability.
export { JAPAN_ATTRACTIONS, JAPAN_FOOD, JAPAN_CATEGORIES } from '@/core/content/registry';
