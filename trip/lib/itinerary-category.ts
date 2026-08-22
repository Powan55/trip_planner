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
// instead of re-exporting would silently DETACH the `_Missing` guard below (which is written
// against this exact type): two textually-identical unions would compile today and drift apart
// the first time only one of them is edited, with nothing to catch it. (This is the same
// prose-rot mechanism that produced the false `satisfies` comment concierge-ops.ts used to
// carry —: a claim needs a mechanism behind it, not just prose repeating it elsewhere.)
//
// Changes if: a category is added to or removed from the trip's itinerary vocabulary. Edit the
// union below AND `ALL_CATEGORIES` under it — `trip-data.ts`'s re-export follows automatically
// (it's the same type), and the `_Missing` guard fails the build if the two ever drift.
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

// The same vocabulary as a runtime, ORDERED array — every category picker in the app maps over
// this, so the order here IS the rendered order. It lives beside the union (no import needed, the
// type is right above) because a hand-copied list of the ten literals anywhere else drifts the
// moment only one side is edited, and nothing catches it: `as const satisfies` rejects an INVALID
// member but is silent on a MISSING one, which is the direction that actually breaks — a newly
// added category simply renders nowhere.
export const ALL_CATEGORIES = [
  'sightseeing',
  'food',
  'photography',
  'shopping',
  'nature',
  'cultural',
  'transportation',
  'hotel',
  'free',
  'nightlife',
] as const satisfies readonly ItineraryCategory[];
// Fails to compile — naming the offending category in the error — if `ItineraryCategory` gains a
// member absent from `ALL_CATEGORIES` (the direction the `satisfies` above misses). A comment
// claiming two lists stay in sync is only worth as much as a check that actually runs; this is
// that check.
type _Missing = Exclude<ItineraryCategory, (typeof ALL_CATEGORIES)[number]>;
const _assertNoMissingCategories: _Missing extends never ? true : _Missing = true;
