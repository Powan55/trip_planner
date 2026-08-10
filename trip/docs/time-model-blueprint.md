> **Built — S124/S125/S126 shipped; section 0 is a snapshot of the pre-build state (2026-07-10).**
> The chain is now `[v2→v3, v3→v4, v4→v5]` and `CURRENT_ITINERARY_VERSION = 5` (`core/vault/migrations.ts`).
> Three parts of the design were later amended: the per-item zone override and the badge rule
> (D-137 amendment, S393), the deletion of `isPastAtPlace` (TD-05), and the move from wall-clock
> minutes to absolute instants in sort and clash (TD-07). Current behaviour lives in the code and
> in `DECISIONS.md`.

# Time-Model Blueprint — Structured Item Times, Vault v5 & Place-Clock Comparison (M17 Phase 1)

> **Status:** blueprint (S123, doc-only). Turns section 2 of `docs/v4-technical-doc.md` into decisions, and governs build slices **S124** (core + migration + Up-Next), **S125** (picker + display), **S126** (sort/timeline/clash).
> Drafted 2026-07-10.
> **Scope:** this document is a contract to build against, not code. It ships zero runtime. The `## Proposed DECISIONS.md entries` section at the end (D-137–D-143) is drafted for the decision log; nothing else in the repo changes because of this slice.

The hard external facts this design bends around: the site is live and sync-enabled with real users' data on disk; the itinerary rides the versioned Vault (`CURRENT_ITINERARY_VERSION = 4`, D-095/D-096 LOCKED); the fleet is mixed after any deploy (D-107); and the one prior timezone bug on this project (B-01) came from `Date`-parsing date strings at a negative UTC offset. Everything here is additive (D-012), append-only (D-095), and confines cross-TZ arithmetic to one pure function with explicit injected offsets.

---

## 0. Grounding — what exists today (verified)

- `lib/trip-data.ts`: `ItineraryItem.time?: string` / `duration?: string` are free text. The additive fields land here.
- `core/vault/migrations.ts`: the chain is `[v2→v3, v3→v4]`, `CURRENT_ITINERARY_VERSION = 4`. Migration #3 is v4→v5, appended, never reordered.
- `core/vault/schema.ts`: lenient read schemas (`z.string()` categories, `.passthrough()`); `parseItineraryPayload` validates the current payload. `core/vault/load-save.ts` holds the four-state read. State A (key absent) returns the seed fallback without running migrations; forward versions read leniently and are never down-converted; a throw or parse failure quarantines (D-096).
- `lib/whats-next.ts`: `nextUp(items, nowHHMM)` compares zero-padded 24h strings lexicographically. Its sole consumer is `components/today-panel.tsx`, which builds `nowHHMM()` from `getNow()` (the D-075 clock adapter, including the `?today=` override, which resolves to local noon of the override day).
- `core/dates/trip-dates.ts` (`getCountryForDate`, lexicographic, the B-01 fix) and `core/dates/trip-cities.ts` (`getCityForDate`, derived from the content root per D-136) are the day's place source.
- `core/content/schema.ts` holds the strict authoring schemas (D-135); seed `time` is strict `HH:MM`. `core/content/itinerary.ts` is the seed, and note that seed minutes like `07:02` and `13:20` exist, so not every value is `:00` or `:30`.
- Sync seam: Firestore per-day docs ingest items without running Vault migrations (`docToDayPlan` is lenient), so a mixed fleet can hand the runtime items that have `time` but no `startMinutes` at any moment. This fact drives the shared-parser rule in section 3.

## 1. Semantics — wall-clock-at-place (D-137)

`startMinutes` (integer 0–1439) is minutes from midnight, local wall-clock at the day's place. It is not a UTC instant, and it is never timezone-converted for display. The place is the item's day: country via `getCountryForDate(dayDate)`, city via `getCityForDate(dayDate)`. The time badge was originally derived from the day's country (`nepal → "NPT"`, `japan → "JST"`) and is presentation-only. **Amended (D-137 amendment, S393, 2026-08-06, owner-signed, recorded in `DECISIONS.md`):** an item whose effective offset differs from its day's — i.e. one carrying a `tzOffsetMin` override — is badged with its OWN zone instead, resolved by `zoneAbbrevForOffset` over a closed five-entry table (`NPT` 345 / `JST` 540 / `EST` -300 / `IST` 330 / `CST` 480, `core/dates/item-time.ts`). An offset the trip does not know badges `null`, i.e. no badge, never a fabricated label. Every item with no override still takes the day-country path byte-identically (`lib/item-time-display.ts`). The time itself is still never TZ-converted; only the label changed.

`durationMinutes` (integer > 0) is an elapsed length in minutes, with no wall-clock meaning of its own. `start + duration` may exceed 1439 for an item running past midnight. It is compared as raw minutes and never wrapped; the item still belongs solely to its start day.

Explicitly out of scope: a mid-day timezone change. Every item belongs to exactly one dated day whose country is a total function of the date (Nepal ≤ Dec 18, Japan ≥ Dec 19). The Nepal→Japan handover happens across the Dec 18/19 day boundary, so no day in this trip has two offsets. An item on a travel day uses that day's offset: Dec 18 depart-KTM items are NPT, Dec 19 arrival items are JST. If a future trip ever has a same-day border crossing, that forces a per-item place override, which is a new decision rather than a quiet patch. **That decision was taken (D-137 amendment, S393, recorded in `DECISIONS.md`):** `ItineraryItem.tzOffsetMin?: number` (`lib/trip-data.ts:108`) is the per-item override, resolved by `effectiveOffsetMin(item, dayOffsetMin)` in `core/dates/item-time.ts`. Every item without it falls straight through to the day's offset, byte-identically. It exists because the trip's last day, 2027-01-09, is a date-line crossing that genuinely holds items in two zones — the Tokyo departure at 17:35 (JST, the day's offset) and the Detroit layover it produces at 15:35 (`tzOffsetMin: -300`, EST).

Offsets are injected explicitly, never inferred. They are **derived from the active trip pack's legs** (`TripLeg.utcOffsetMin`) and surfaced by exactly one core module (section 4) and nowhere else: for the default pack that is NPT = UTC+5:45 = +345 min and JST = UTC+9:00 = +540 min, authored once in `core/trips/packs/nepal-japan-2026.ts`.

## 2. Field contract — additive, `time` retained (D-138)

```ts
// lib/trip-data.ts — ItineraryItem (additive, D-012)
startMinutes?: number;    // 0–1439, wall-clock-at-place (D-137)
durationMinutes?: number; // elapsed minutes, > 0
// time?: string and duration?: string are RETAINED — fallback display,
// migration source, and the mixed-fleet display surface (D-107).
```

Where each schema learns the optionals:

- Vault lenient read schema (`core/vault/schema.ts`): yes, now. `startMinutes: z.number().optional()` and `durationMinutes: z.number().optional()` on `itineraryItemSchema`, in the declared-surface style already used for `done`. Deliberately plain `z.number()`, with no `.int().min().max()` on the read path: an out-of-range value from a buggy client must degrade to "untimed" rather than quarantine a whole vault. Range validation happens at one runtime point, `effectiveStartMinutes` (section 4). Add the `itineraryPayloadV5` / `itineraryEnvelopeV5` pair mirroring the v3/v4 style; `parseItineraryPayload` targets v5.
- S122 strict content schema (`core/content/schema.ts`): deliberately no. The seed stays `time`-only (strict `HH:MM`), and `.strict()` keeps rejecting `startMinutes` in authored content. Dual-authoring (`time: '06:00'` plus `startMinutes: 360`) is a drift bug waiting to happen, and the seed fallback path (load-save state A) bypasses migrations anyway. The runtime fallback parser (section 4) makes seed items behave identically to migrated ones. One authored source of truth per item.

Editor dual-write rule (S125): a user edit through the picker writes both `startMinutes` and a canonical 24h `time = "HH:MM"`, and clearing the time clears both (`undefined`). This is a user write, not a migration rewrite, so D-012's "migration never drops/rewrites `time`" is untouched. The dual-write is load-bearing for the mixed fleet: old clients display only the `time` string, so a new-client edit has to stay visible to them. Without clearing `time`, a cleared item would zombie-display its legacy text.

## 3. Vault v4→v5 — migration #3 (D-139)

Appended step `{ from: 4, to: 5 }`; `CURRENT_ITINERARY_VERSION` becomes 5. Same discipline as v3→v4:

- Pure map, no clock, cannot throw on well-formed input. For each item:
  - if a `startMinutes` is already present, keep it verbatim (never clobber);
  - else if `time` is present, `startMinutes = parseTimeString(time)` (may be `undefined`);
  - else leave it unchanged.
- Never touches `time`, `duration`, or any other field, and never sets `durationMinutes`. Legacy `duration` free text (`"2h"`, `"1h 32m"`, `"1.5h"`, day-spanning labels) is not parsed by this migration. That is a decided gap, flagged: clash warnings initially fire only for durations set through the new editor, and a best-effort duration parse can be a later additive migration if wanted.
- Lossless invariant (the S124 hard acceptance): for every item, the JSON of all pre-existing fields is byte-preserved, and the only possible change is the *addition* of `startMinutes`.
- Idempotent: re-running on already-v5-shaped data is an identity. This is what makes the D-073 service-worker-lag loop safe. An old build reads a v5 envelope leniently (the forward-compat branch), preserves the fields through `.passthrough()` plus spread, and saves a v4 envelope; the next new-build load re-runs migration #3, which keeps the existing `startMinutes` and re-parses only items that lack it.
- Quarantine: unchanged runner semantics, so a throwing step quarantines (D-096). The step itself is total, and genuinely malformed payloads are caught by the lenient Zod read as today.
- Export/import: zero new code. `export-import.ts` reuses the same runner and schema. Exports become v5 envelopes, and a v4-era export file imports through migration #3.

### 3.1 `parseTimeString` — the one parser (shared, core)

One parser, used by both migration #3 and the runtime fallback (section 4). This is mandatory rather than stylistic: the sync ingest path bypasses Vault migrations, so items with only `time` reach the runtime forever in a mixed fleet. Migration-time parsing and runtime fallback parsing have to agree, or the same item renders differently depending on how it arrived.

`parseTimeString(raw: string): number | undefined` takes trimmed input, matched case-insensitively:

| # | Format | Examples → minutes | Rule |
|---|---|---|---|
| 1 | 24h colon `H:MM` / `HH:MM` | `06:00`→360 · `6:00`→360 · `23:59`→1439 | H 0–23, MM 00–59 |
| 2 | 24h dot `H.MM` / `HH.MM` | `14.30`→870 | same ranges |
| 3 | 12h am/pm `h(am|pm)`, `h:mm am/pm`, `h.mm am/pm` — optional space, optional periods (`a.m.`) | `2pm`→840 · `2:15 PM`→855 · `12am`→0 · `12:30 p.m.`→750 | h 1–12, mm 00–59; 12am→0h, 12pm→12h |

Everything else returns `undefined`: the item stays untimed and its legacy text is shown verbatim. That covers bare numbers (`14`, `1430`, both ambiguous), ranges (`14:00-16:00`), words or trailing text (`morning`, `2pm-ish`), and out-of-range values (`24:00`, `12:60`, `0pm`). Best-effort means these three shapes exactly. Resist widening in S124; widen later, additively, with tests, if real quarantine-free data shows a missed common shape.

## 4. The one offset-injected comparison — `core/dates/item-time.ts` (D-140)

One new framework-free module (D-099; type-only `lib` imports). All time helpers live here, and nothing else in the codebase does offset math:

```ts
export const NPT_OFFSET_MIN: number;                // the 'nepal' leg's utcOffsetMin (345 for the default pack)
export const JST_OFFSET_MIN: number;                // the 'japan' leg's utcOffsetMin (540 for the default pack)
export function offsetForCountry(c: string): number; // leg id → offset; unknown id falls back to NPT

export function parseTimeString(raw: string): number | undefined;      // section 3.1
export function effectiveStartMinutes(item: ItineraryItem): number | undefined;
//   = valid startMinutes (integer 0–1439) ?? parseTimeString(item.time) — the ONE
//   range-validation point (out-of-range/non-integer startMinutes ⇒ fall through/untimed).
export function formatTimeAmPm(minutes: number): string;               // 0→"12:00 AM", 720→"12:00 PM", 855→"2:15 PM"

export function placeWallClockToUtcMs(dateStr: string, minutes: number, offsetMin: number): number;
//   = Date.UTC(y, mo-1, d, 0, minutes - offsetMin) — pure arithmetic on UTC fields.
//   B-01-safe: the ISO date is split, never `new Date(string)`-parsed; no local-TZ
//   getters are involved anywhere. Date.UTC is deterministic on every machine.

// `isPastAtPlace(dateStr, startMinutes, offsetMin, nowUtcMs)` was built here and later
// DELETED (TD-05): its one-line body — `placeWallClockToUtcMs(...) < nowUtcMs` — is inlined
// at its single call site in `lib/whats-next.ts`, which now uses that same instant as BOTH
// the past-gate and the ranking key. The strictness it encoded (an item exactly at "now" is
// NOT past) lives on there.
```

This is an instant comparison rather than a minutes-of-day comparison, on purpose: it stays correct across a day boundary. A viewer far from the trip zone during the trip gets a place-accurate "past", where today's lexicographic compare is device-wall-clock and silently wrong for them. That is a small, deliberate behavioral improvement.

### 4.1 The clock seam — where "now" comes from (`lib/trip-now.ts`)

The `?today=` override policy already lives in exactly one adapter (D-075 LOCKED, untouched: same key, same sessionStorage, same local-noon Date). It gains one derived read:

```ts
export function getNowUtcMsForPlace(dayDate: string, placeOffsetMin: number): number;
```

- Override active (`?today=` / sessionStorage): the synthetic Date's wall-clock face is the demo's place wall-clock by declaration, so `placeWallClockToUtcMs(dayDate, hours*60+minutes of getNow(), placeOffsetMin)`. Since the override Date is local noon, demo "now" is noon at the place. That is byte-identical behavior to today's `"12:00"` compare, and now deterministic regardless of the demo machine's timezone, so the frozen `?today=` E2E specs keep passing.
- No override: `getNow().getTime()`, the real instant. In-zone, during the trip, the whole design is a no-op, because device wall-clock equals place wall-clock and the instant compare equals the old string compare.

### 4.2 How `nextUp()` consumes it

`lib/whats-next.ts` keeps its home and its purity (D-016, still no clock read); the signature changes:

```ts
export function nextUp(items: ItineraryItem[],
  ctx: { dayDate: string; placeOffsetMin: number; nowUtcMs: number }): ItineraryItem | null;
```

Skip `done === true`; skip items where `effectiveStartMinutes` is `undefined`; skip items whose start instant is `< nowUtcMs`; return the smallest effective minutes, first-in-array on ties (stable, as today). The sole caller `components/today-panel.tsx` replaces its local `nowHHMM()` with `offsetForCountry(todayInTrip.country)` plus `getNowUtcMsForPlace(todayInTrip.date, offset)` on the same 1s tick. `lib/__tests__/whats-next.test.ts` is rewritten to the new signature, carrying every behavioral case forward, plus the offset cases in section 7.

## 5. Picker + display contract — S125 (D-141)

- Hand-rolled three-column picker, no dial: Hour `12,1..11` presented `1–12`, Minute `00–59` (the full list, so no 5-minute grid, and migrated values like `07:02` are representable with zero special cases), AM/PM. No native `<input type="time">`, since the inconsistent 12/24h platform rendering is the complaint being fixed. No new dependency (D-088/D-118).
- Lives in the existing `ItemEditor`. The trigger shows `formatTimeAmPm(effectiveStartMinutes(item))` or "Add time". A Clear time affordance sets both `startMinutes` and `time` to `undefined` (the section 2 dual-write; save writes both).
- Accessibility floor, from the S110 sweep: every option ≥ 44×44 px; columns keyboard-operable (arrow keys within a column, Tab between columns, Home/End; a `radiogroup`/`listbox` pattern with labeled options); visible focus states; the D-021 focus contract, where focus moves into the picker on open and returns to the trigger on close; `useReducedMotion` means no snap/momentum animation and instant positioning; contrast ≥ 4.5.
- Display rule, everywhere times render: if `effectiveStartMinutes` is defined, show `formatTimeAmPm(...)` plus the day-country badge `NPT`/`JST`; else show the legacy `time` text verbatim and unbadged, since free text has no asserted zone; else untimed. Duration entry (setting `durationMinutes`, dual-writing canonical `duration` text) is in S125 scope. The widget shape is decided when S125 is built; the write rule is fixed here.

## 6. Sort / timeline / clash — S126 (D-142)

- `sortItemsByTime(items, dayDate, dayOffsetMin)` is pure, view-level and non-destructive. Stable sort by the item's absolute **instant** — `placeWallClockToUtcMs(dayDate, effectiveStartMinutes(item), effectiveOffsetMin(item, dayOffsetMin))` — not by raw wall-clock minutes, because a day can hold items in two zones (the 2027-01-09 date-line crossing) and a wall-clock key rendered the traveller arriving before they left. Untimed items sink to the bottom preserving their relative order; equal keys preserve array order. The stored manual order remains the persisted truth, and the toggle is UI state only, with zero itinerary writes (D-018 untouched). The timeline view renders from the same sorted projection. Accepted cost on such a day: the displayed times are correctly ordered but visually non-monotonic.
- Overlap predicate: warn-only, never blocking. A pair `(a, b)` warns iff both have a defined `effectiveStartMinutes`, both have `durationMinutes > 0`, and:
  `(a.start < b.start + b.dur) && (b.start < a.start + a.dur)`
  Intervals are half-open, so touching endpoints (10:00–11:00 vs 11:00–12:00) never warn. Items without a duration never warn, because free-text reality is fuzzy. Compared as absolute **instants**, not raw minutes (`clashingItemIds(items, dayDate, dayOffsetMin)` in `lib/sort-items-by-time.ts`, TD-07): two items on one day can sit in different zones, and a raw wall-clock comparison answers "when" in a frame that does not exist — two 09:00 items 14 hours apart would read as a clash. Past-midnight spill therefore falls out of the epoch arithmetic for free. Multi-day spans (items carrying an `endDate`) are dropped before the pairwise check: clash v1 has no cross-day semantics. Pure helper, unit-tested including the stability property.

## 7. Migration + offset test matrix (S124 implements — enumerated)

Mirror the structure of `lib/__tests__/vault-v4-migration.test.ts` in a `vault-v5-migration.test.ts` sibling:

1. **Append-only chain:** `itineraryMigrations` maps to `[[2,3],[3,4],[4,5]]`; `CURRENT_ITINERARY_VERSION === 5`.
2. **Each parseable format** maps to the correct `startMinutes`: `"06:00"`→360, `"6:00"`→360, `"23:59"`→1439, `"14.30"`→870, `"2pm"`→840, `"2:15 PM"`→855, `"12am"`→0, `"12pm"`→720, `"12:30 p.m."`→750, `"05:45"`→345 (the NPT boundary value exists as data).
3. **Unparseable-preserved:** `"2pm-ish"`, `"morning"`, `"14:00-16:00"`, `"1430"`, `"24:00"`, `"12:60"`, `""` leave `startMinutes` as `undefined`, and the original `time` string is byte-preserved.
4. **Lossless:** for a realistic item with every legacy field populated, post-migration `toMatchObject` on the full original item (nothing dropped or rewritten; `duration` untouched; `durationMinutes` not set).
5. **Never clobbers:** an item already carrying `startMinutes`, and one carrying a *conflicting* `startMinutes` against its `time` text, both keep their existing value verbatim.
6. **Idempotent:** running v4→v5 twice is the same as running it once, and a v5-shaped payload re-entering at 4 (the old-build-overwrite loop from section 3) is an identity.
7. **Deterministic, no clock:** two runs are `toEqual`, and the step source contains no `Date.now` (same purity discipline as #2; assert via deterministic-output tests).
8. **Empty cases:** `[]` and a day with `items: []` survive unchanged.
9. **Full round-trip through `loadItinerary`/`saveItinerary`:** a legacy bare `DayPlan[]` (v2) walks v2→v3→v4→v5, gains `startMinutes` where parseable, saves as `schemaVersion: 5`, reloads byte-identical, and the quarantine key stays empty.
10. **Export/import across versions** (`export-import.test.ts` updates): export emits a v5 envelope; a v4-era export string imports through migration #3 losslessly; a corrupt import still writes nothing.
11. **Offset function cases** (`item-time` unit suite): `placeWallClockToUtcMs('2026-12-10', 345, NPT_OFFSET_MIN) === Date.UTC(2026, 11, 10, 0, 0)`, the NPT `:45` boundary where 05:45 NPT is exactly midnight UTC; `isPastAtPlace` at now == item is false, and at +1 min is true; the same wall-clock minutes on the same date differ NPT-vs-JST by exactly 195 min; a JST evening item against a "now" past the place's midnight is past (day-boundary correctness); and the `?today=` branch, where override "now" is place noon, so items < 720 are past and ≥ 720 upcoming (parity with the old `"12:00"` behavior).
12. **`nextUp` behavioral parity:** every existing whats-next case (earliest upcoming, skip done/untimed/past, ties stable, null cases, purity) re-asserted under the new signature, plus one case where an item has only legacy `time` and no `startMinutes` and is still picked via the fallback parser.
13. **Process rule (S97), an S124 done-criterion:** any Vault-version slice runs the full E2E net (persistence, countdown fake-clock, interaction, axe, visual), not only unit tests, plus a green `next build`.

## 8. S124 build order (the risky slice)

1. `lib/trip-data.ts` fields + `core/vault/schema.ts` optionals + the v5 schema pair (a compile-only step).
2. `core/dates/item-time.ts` (parser, `effectiveStartMinutes`, `formatTimeAmPm`, offsets, `placeWallClockToUtcMs`) plus its unit suite. Land the pure math green *before* the migration exists.
3. Migration #3 append + `CURRENT_ITINERARY_VERSION = 5` + the section 7 migration suite (items 1–9).
4. `export-import` spec updates (item 10).
5. `lib/trip-now.ts` `getNowUtcMsForPlace` + the `nextUp` signature change + `today-panel.tsx` wiring + the whats-next suite rewrite (items 11–12).
6. Full E2E + `next build` (item 13). The D-107 friends'-reload note (D-143) ships with it.

## 9. Risks & seams (accepted / guarded)

- **Migration over live data.** Guarded by a total parser (returns `undefined`, never throws), never-clobber, lossless `toMatchObject` tests, quarantine-on-throw, and idempotence, which guards the service-worker-lag old-build-overwrite loop. The riskiest failure left is a parser bug mis-reading a parseable string, hence the exhaustive format table in section 3.1 and section 7 item 2, rather than a fuzzy "best effort".
- **Seed/fallback bypasses migration** (load-save state A). Deliberate: the runtime `effectiveStartMinutes` fallback covers it. Do not "fix" it by migrating the fallback.
- **Sync ingest bypasses migration.** Permanent, because the Firestore docs are per-day; the shared-parser rule in section 3.1 is the mitigation. Do not add migration logic to the ingest path.
- **Mixed-fleet skew (D-107/D-143).** An old client editing the free-text `time` does not update `startMinutes`, so new clients show a stale structured time until the item is re-touched on a new client. Bounded by the coordinated friends' reload after deploy, and accepted.
- **Wall-clock-at-place edge honesty.** Past-midnight duration spill is un-wrapped (a warn-only feature, accepted); a mid-day border crossing is explicitly out of scope for this trip (section 1); and the at-home viewer's Today panel still keys its *day* off the device-local date (`dayInTripFor`, frozen), so only "is this item past" becomes place-accurate. That asymmetry is accepted and documented rather than hidden.

---

## Proposed DECISIONS.md entries

### D-137 · PROPOSED LOCKED (S123 blueprint) · Item times are wall-clock-at-place — `startMinutes` 0–1439 local to the day's place, never TZ-converted for display
**Decision:** `startMinutes` (int 0–1439) = minutes-from-midnight local wall-clock at the item's day's place (country via `getCountryForDate`, city via `getCityForDate`); `durationMinutes` (int > 0) = elapsed minutes, which may spill past 1439 un-wrapped. The NPT/JST badge is derived from the day's country only. Offsets are explicit constants: NPT +345, JST +540. Mid-day border crossings are out of scope, since no such day exists in this trip and a travel day's items use that day's offset.
**Why:** a trip itinerary is authored and read in place-local time. UTC instants would force conversion everywhere and reintroduce the B-01 bug class. One dated day = one place = zero ambiguity.
**Changes if:** a trip ever has a same-day timezone change, which forces a per-item place override. **This happened — see the D-137 amendment (S393) recorded in `DECISIONS.md`:** `tzOffsetMin?` per item, resolved by `effectiveOffsetMin`, badged with its own zone.

### D-138 · PROPOSED LOCKED (S123 blueprint) · Additive time fields: `startMinutes?`/`durationMinutes?` on `ItineraryItem`; `time?`/`duration?` retained; lenient Vault schema learns them, strict content schema deliberately does not; user edits dual-write
**Decision:** both fields are optional-additive (D-012). The Vault read schema adds them as plain `z.number().optional()`, with the range enforced only at `effectiveStartMinutes`, so an out-of-range value degrades to untimed and never quarantines, plus a v5 payload/envelope schema pair. The S122 strict content schema stays `time`-only, and `.strict()` keeps rejecting the new fields in seed content: a single authored source, with the runtime fallback parser covering the seed. User edits via the picker write both `startMinutes` and a canonical 24h `time`, and clearing clears both. That is a user write, not a migration rewrite, so D-012 stays intact, and it keeps old clients' display current in the mixed fleet.
**Why:** additive-only protects live data; lenient-read protects against buggy writers; a single-source seed prevents dual-value drift; dual-write prevents mixed-fleet display skew and zombie legacy text after a clear.
**Changes if:** the fleet is confirmed single-version post-trip (dual-write could then be dropped), or seed content ever needs durations for clash demos (the content schema would then learn the fields).

### D-139 · PROPOSED LOCKED (S123 blueprint) · Vault migration #3 (v4→v5): best-effort `time`→`startMinutes` — three formats, lossless, idempotent, never-clobber, no clock, duration not parsed
**Decision:** append `{from:4,to:5}` and set `CURRENT_ITINERARY_VERSION = 5`. Pure item map: keep an existing `startMinutes` verbatim, else `startMinutes = parseTimeString(time)`. `parseTimeString` is one shared core parser, also used as the runtime fallback, and it accepts exactly 24h `H:MM`/`HH:MM`, 24h dot `H.MM`/`HH.MM`, and 12h `h(:mm|.mm)? am/pm` (optional space and periods; 12am→0, 12pm→720). Everything else (bare numbers, ranges, words, out-of-range values) returns `undefined`, and the legacy text is shown verbatim. The migration never touches `time`, `duration` or any other field, and never sets `durationMinutes`, because legacy duration text is not parsed. That is a flagged gap, decided: clash warnings start editor-set-only. Quarantine-on-throw is unchanged (D-096), and export/import reuse the runner, so v4 exports import cleanly.
**Why:** lossless plus idempotent plus never-clobber is what makes a migration over live synced data safe, including the D-073 service-worker-lag loop where an old build re-saves a v4 envelope over v5 fields. One parser is mandatory because the sync ingest bypasses migrations forever in a mixed fleet.
**Changes if:** quarantine-free real data shows a common missed format, in which case widen the parser additively, with tests. Never by reordering or renumbering shipped steps (D-095).

### D-140 · PROPOSED LOCKED (S123 blueprint) · One offset-injected pure comparison: `core/dates/item-time.ts` `isPastAtPlace` via `placeWallClockToUtcMs` (Date.UTC arithmetic, no `Date` TZ tricks); clock seam `getNowUtcMsForPlace` in `lib/trip-now.ts`
**Decision:** all time helpers (parser, `effectiveStartMinutes`, `formatTimeAmPm`, NPT/JST constants, `placeWallClockToUtcMs`, `isPastAtPlace`) live in one framework-free core module (D-099). `isPastAtPlace(dateStr, startMinutes, offsetMin, nowUtcMs)` is an instant compare, `itemUtc < nowUtc`, so at-now is upcoming and today's strictness is preserved. ISO dates are split, never `new Date(string)`-parsed; only `Date.UTC` field arithmetic, which is B-01-safe. "Now" comes from one adapter read, `lib/trip-now.ts getNowUtcMsForPlace(dayDate, offsetMin)`: with the override active, the synthetic clock's wall-clock face is re-interpreted at the place offset, so demo "now" is place noon, byte-parity with today's `"12:00"` behavior and TZ-deterministic; with no override it is `getNow().getTime()`, an exact no-op in-zone. `nextUp(items, {dayDate, placeOffsetMin, nowUtcMs})` consumes it, and the sole caller `today-panel.tsx` is rewired. D-075 storage and precedence are untouched.
**Why:** exactly one place does cross-TZ math, with injected offsets and a pure instant compare that stays correct across day boundaries, and the override rule keeps the frozen `?today=` E2E net green.
**Changes if:** a second comparison site appears, in which case route it through this module rather than writing a second implementation.
**Built, then amended in code (TD-05):** `isPastAtPlace` shipped as designed and was later DELETED — its one-line body (`placeWallClockToUtcMs(...) < nowUtcMs`) is inlined at its single call site in `lib/whats-next.ts`, which now uses that instant as BOTH the past-gate and the ranking key (the two disagreed once a day held items in different zones). The decision's substance is unchanged: one offset-injected instant compare, at-now still counts as upcoming. Only the named helper is gone; `DECISIONS.md` D-140 still names it and has not been amended.

### D-141 · PROPOSED LOCKED (S123 blueprint) · Hand-rolled AM/PM picker: three columns (hour 1–12 / minute 00–59 / AM-PM), 44px targets, D-021 focus, reduced-motion, Clear-time; no native `input[type=time]`, no new dependency
**Decision:** per section 5 of the time-model blueprint. A full 0–59 minute column, with no 5-min grid, so migrated values like `07:02` stay representable with zero special cases. Display everywhere: `formatTimeAmPm(effectiveStartMinutes)` plus the NPT/JST day-country badge, while legacy-only items show their `time` text verbatim and unbadged. Saves dual-write per D-138.
**Why:** the native control's inconsistent 12/24h rendering is the complaint being fixed, and the column pattern is the boring, keyboard-friendly shape that meets the S110 accessibility floor without a picker library (D-088/D-118).
**Changes if:** usability testing on-device shows the 60-row minute column is too heavy, in which case a 5-min grid plus an inject-current-value variant, as an amendment.

### D-142 · PROPOSED LOCKED (S123 blueprint) · Sort/timeline/clash: view-level stable sort (untimed sink), warn-only half-open overlap requiring both start and duration
**Decision:** `sortItemsByTime` is pure, view-level and non-destructive: stable by `effectiveStartMinutes`, with untimed items sinking while preserving relative order. The stored manual order stays the persisted truth (zero writes, D-018), and the timeline renders the same projection. Overlap warns iff both items have `effectiveStartMinutes` and `durationMinutes > 0` and `(a.start < b.start + b.dur) && (b.start < a.start + a.dur)`. Half-open, so touching never warns; raw minutes, so spill is un-wrapped; a warn-only badge, never blocking.
**Why:** sorting must never mutate user order (undo-free, sync-safe), and fuzzy free-text reality makes blocking or duration-less warnings noise.
**Changes if:** durations become near-universal on items, in which case a "gap view" could be more than warn-only, which is a new decision.
**Shipped differently (TD-07):** the overlap is judged on absolute instants, not raw minutes — `clashingItemIds(items, dayDate, dayOffsetMin)` in `lib/sort-items-by-time.ts` — so a two-zone day is correct and past-midnight spill falls out of the epoch arithmetic; multi-day `endDate` spans are excluded from clash v1. Half-open and warn-only are unchanged.

### D-143 · PROPOSED (process note, S123) · D-107 mixed-fleet coordination for the S124 deploy: friends reload right after; old-client `time` edits can leave stale `startMinutes` until re-touched
**Decision:** after S124 deploys, coordinate the travelers' reload (the D-073 update flow). Known bounded skew: old clients preserve but ignore `startMinutes`, and an old-client free-text `time` edit does not update it, so new clients may briefly show a stale structured time. Old-build v4-envelope re-saves over v5 data are safe by migration idempotence (D-139).
**Why:** additive fields ride the per-item rev/hlc merge unchanged, and the only exposure is display skew in the reload window, so coordination is the right fix rather than code.
**Changes if:** the skew window proves painful in practice, in which case a `timeRev` tiebreak would be the code fix. Not now.
