// The itinerary-category vocabulary — ONE source of truth.
//
// ZERO-IMPORT LEAF, forever. This file must never gain an import. `worker/` takes a type-only
// `import type { ItineraryCategory }` of this file under a tsconfig with
// `noUncheckedIndexedAccess: true` and `lib: ["ES2022"]` (no DOM) — importing anything here, even
// another type-only import, drags whatever THAT import pulls in behind it, and the client's
// `core/` graph does not fit that tsconfig. One import added to this file breaks
// `worker npm run typecheck`.
//
// `lib/trip-data.ts` RE-EXPORTS this type rather than re-declaring the union inline. Re-declaring
// instead of re-exporting would silently DETACH the `Exclude` guard in `lib/concierge-ops.ts`
// (which is written against this exact type): two textually-identical unions would compile today
// and drift apart the first time only one of them is edited, with nothing to catch it. (This is
// the same prose-rot mechanism that produced the false `satisfies` comment concierge-ops.ts used
// to carry —: a claim needs a mechanism behind it, not just prose repeating it elsewhere.)
//
// Changes if: a category is added to or removed from the trip's itinerary vocabulary. Edit ONLY
// the union below — `trip-data.ts`'s re-export follows automatically (it's the same type), and
// `concierge-ops.ts`'s `Exclude` guard fails the build if `CATEGORIES` there isn't updated to
// match.
export type ItineraryCategory =
  | 'sightseeing'
  | 'food'
  | 'photography'
  | 'shopping'
  | 'nature'
  | 'cultural'
  | 'transportation'
  | 'hotel'
  | 'free'
  | 'nightlife';
