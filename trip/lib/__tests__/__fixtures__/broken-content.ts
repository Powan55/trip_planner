// S122 — deliberately-BROKEN content fixtures. These are NOT valid content;
// they exist so `content-validation.test.ts` can prove the strict schemas + cross-content
// invariants actually REJECT each canonical breakage — the "red-proof inside a green suite"
// (the suite asserts each is rejected, so it stays green while demonstrating the teeth).
//
// Plain object literals on purpose — NO type annotations. Annotating with the real interfaces
// would make tsc reject them before Zod ever runs, defeating the point. They are consumed as
// `unknown` via `safeParse`.


// (1) Bad category — 'brunch' is not one of the 10 itinerary categories. → schema, path `category`.
export const badCategoryItem = {
  id: 'brk-1',
  title: 'Mystery brunch',
  category: 'brunch',
  time: '10:00',
};

// (2) Malformed date — not YYYY-MM-DD. → contentDayPlanSchema, path `date`.
export const malformedDateDay = {
  date: 'Dec 26',
  city: 'Kyoto',
  country: 'japan',
  items: [],
};

// (3) Unknown key — `foo` is not part of the itinerary item shape. → `.strict()` rejects it;
// the unrecognized_keys issue names `foo`.
export const unknownKeyItem = {
  id: 'brk-3',
  title: 'Has a stray key',
  category: 'food',
  foo: 'bar',
};

// (4) Missing required field — no `title`. → schema, path `title` (invalid_type / undefined).
export const missingTitleItem = {
  id: 'brk-4',
  category: 'food',
};

// (5) Duplicate id — two items share `dup-1`. → the global-uniqueness invariant flags `dup-1`.
export const duplicateIdItems = [
  { id: 'dup-1', title: 'First', category: 'food' },
  { id: 'dup-1', title: 'Second (same id)', category: 'sightseeing' },
];

// (6) A day OFF the 32 TRIP_DATES — '2026-12-08' is a valid ISO date but not a trip day.
// → the coverage invariant (itinerary must cover EXACTLY the 32 TRIP_DATES) flags it.
export const dayOffTripDates = [
  { date: '2026-12-08', city: 'Kathmandu', country: 'nepal', items: [] },
];
