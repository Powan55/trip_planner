# Trip content runbook: how to change the trip plan

> The trip's editable content lives in one schema-validated **content layer** (S122; D-135 /
> D-136 LOCKED). Every kind of content change is a **one-file edit** with a validator and a
> runbook row. This is that runbook.

The layer is the content root **`core/content/itinerary.ts`** (the day-by-day plan, the one
file that was previously spread across the sample *and* the city map) plus the existing
per-domain **`lib/*-data.ts`** modules, unified by (a) strict authoring schemas in
**`core/content/schema.ts`**, (b) one command **`npm run validate:content`**, and (c) this
runbook. `TRIP_CITIES` is **derived** from the itinerary, so you never edit it by hand.

---

## 1. What lives where (the edit map)

| You want to change…                     | Edit this one file                          | Validated by                         |
| --------------------------------------- | ------------------------------------------- | ------------------------------------ |
| a day's activities / dinner / times     | `core/content/itinerary.ts`                 | `validate:content` + the seed golden |
| a day's **city** (day-trip / route)     | `core/content/itinerary.ts` (the `city`)    | derivation-identity test + weather check |
| Nepal / Japan guide cards               | `lib/nepal-data.ts` / `lib/japan-data.ts`   | `validate:content`                   |
| nightlife venues                        | `lib/nightlife-data.ts`                     | `validate:content`                   |
| photo spots                             | `lib/photography-data.ts`                   | `validate:content`                   |
| featured / foods / etiquette / weather  | `lib/travel-tips-data.ts`                   | `validate:content`                   |
| Home inspiration gallery                | `lib/inspiration-data.ts`                   | `validate:content` (+ bundled-image check) |
| flights / stays (all booked)            | `lib/booking-data.ts` (verbatim strings, see D-034) | `validate:content`          |
| emergency numbers / **phrasebook** / document checklist | `core/content/safety.ts`    | its own eager `.parse()` at import + `lib/__tests__/safety-content.test.ts` |

`TRIP_CITIES` in `core/dates/trip-cities.ts` is **derived** from `core/content/itinerary.ts`
(`TRIP_CITIES = deriveTripCities(TRIP_ITINERARY)`). Never edit it directly: change the day's `city`
in the itinerary and the map follows automatically.

**`core/content/safety.ts` is the one row that does not go through `validate:content`,** and that
is deliberate: it declares its own local `.strict()` Zod shapes and `.parse()`s its own data at
**module load**, so a malformed emergency number or phrase fails the *build*, not a separate
validate step. Read its header before editing — emergency contacts carry a `verified` flag and a
`sourceUrl`, and you may not flip `verified` to `true` without a live check. Two phrasebook rules
worth knowing before you add a row:

- Every phrase needs **four** language fields, not two: `nepali` / `japanese` (romanized, the
  read-aloud text) **and** `nepaliScript` / `japaneseScript` (Devanagari, kana/kanji). The schema
  enforces the script fields actually contain their script, so pasting the romanization into both
  fails loudly.
- **Never add a font for the native script.** The app self-hosts latin-only subsets; Devanagari and
  kana/kanji resolve from the operating system via per-glyph fallback, which is why the page works
  with the radio off. A webfont here would trade the offline guarantee for a download that can fail.

---

## 2. The invariants the validator enforces

`npm run validate:content` (a Vitest suite, `lib/__tests__/content-validation.test.ts`) checks:

- **Strict schema** for every content domain (`core/content/schema.ts`): correct field types, the
  10 itinerary categories as an enum, `YYYY-MM-DD` dates, `HH:MM` times, non-empty required
  strings, and **no stray keys** (`.strict()`, so a typo'd key fails loudly).
- **Exactly the 32 trip dates**, in order, no duplicates, no extras.
- Every **`DayPlan.country`** agrees with `getCountryForDate(date)`.
- **Unique ids:** itinerary item ids globally unique; guide/nightlife/photo/booking ids unique
  per collection.
- Every itinerary **city is weather-known** (`isKnownWeatherCity`).
- Every **guide/photo category** appears in its filter list (a typo'd category would otherwise
  make the card silently vanish from the filters).
- Every **inspiration `image`** is a real key of `lib/image-manifest.json` — i.e. an asset this
  repo already bundles and already credits in `public/images/CREDITS.md`. A typo'd path would
  otherwise render the card's gradient fallback and quietly stop being a photo. The same check
  is what keeps that gallery from acquiring a remote or unbundled image. Both countries must be
  represented, and no `alt` may be a copy of its own `title`.
- **Booking leg/layover shape:** each journey has exactly one fewer layover than legs (D-034:
  structure only; booking **time strings are never parsed or recomputed**).

Strict content schemas are the **opposite** of the Vault's lenient read schemas (which tolerate
unknown keys because they parse real user data that must never be destroyed). The two families
are deliberately separate; never point a strict schema at user data.

---

## 3. The edit workflow

```
edit the file  →  npm run validate:content  →  (if you changed core/content/itinerary.ts)
regen the seed golden  →  npm test  →  done
```

Regen the seed golden after any legitimate itinerary edit:

```
npx vitest run lib/__tests__/sample-itinerary-golden.test.ts -u
```

The golden (`lib/__tests__/__fixtures__/sample-itinerary.golden.json`) is the seed's
**deliberate-edit baseline**, not a frozen net: regenerating it is a normal part of an itinerary
edit, and its diff in review shows exactly what content changed. `TRIP_CITIES` follows your city
edits automatically, so never edit it.

---

## 4. Worked example: "change the Dec 26 dinner"

1. Open `core/content/itinerary.ts` and find the `{ date: '2026-12-26', city: 'Kyoto', … }` block.
2. Edit the evening food item (`id: 'j8-5'` is the nightlife close; the day's food item is
   `id: 'j8-3'`, the yudofu lunch). Change its `title` / `time` / `location` / `notes`.
3. `npm run validate:content` → green (the edited item still parses the strict schema and all
   invariants hold).
4. `npx vitest run lib/__tests__/sample-itinerary-golden.test.ts -u` → regenerates the golden;
   its diff shows exactly your one-line change.
5. `npm test` → green. One file touched; no other module knows or cares.

(This example was run for real once during S122, as edit → validate → revert, to prove the
workflow.)

---

## 5. Adding / removing a day-trip city

Change the day's `city` in `core/content/itinerary.ts`. If the city is **new** (not one of the
current 8: New York, Kathmandu, Lalitpur, Nagarkot, Bhaktapur, Tokyo, Kyoto, Osaka), add its
coordinates to `CITY_COORDS` in `lib/city-coords.ts` (`lib/weather.ts` imports the map from
there). The validator's weather-known-city invariant fails loudly until you do. `TRIP_CITIES`
picks up the new city automatically.

---

## 6. Danger zone (do not touch casually)

- **Trip dates and the countdown anchor** (D-006, LOCKED). The 32 dates are fixed. This layer
  changes what happens **on** days, never **which** days.
- **The five S82-frozen boundary cities:** Dec-9/12/18 → Kathmandu, Dec-19 → Osaka, Jan-9 →
  Tokyo. Changing one deliberately requires updating the frozen E2E specs
  (`e2e/countdown.spec.ts`) in lockstep (the S112 / D-124 precedent), so raise it before you start.
- **Booking time strings** are rendered verbatim (D-034). Never "correct"
  `totalDuration: '1d 15m'` (it crosses the date line and is right as written).
- **Anything under the user's storage keys.** The seed is only ever the Vault **fallback**
  (key-absent / post-quarantine). A content/seed change never rewrites live saved or synced
  data (D-018); a returning user with a stored plan sees no difference.

---

## 7. Adding a new content domain (e.g. a safety kit)

Add: one data module (`lib/<domain>-data.ts` or `core/content/` if `core/` consumes it) + one
strict schema in `core/content/schema.ts` + one validator case in `content-validation.test.ts` +
one row in the table in section 1.
