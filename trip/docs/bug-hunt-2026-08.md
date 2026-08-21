# Bug hunt, 2026-08: nine-area defect sweep

**Date:** 2026-08-21 · **Commit swept:** `f1619e3` ("the precache body guard threw on a response
with no headers (#136)"). **Baseline at that commit:** `npx tsc --noEmit` clean, `npm test` green —
187 files, 2383 tests. Every defect below is therefore something the type checker and the unit
suite both report as fine.

Nine areas were read independently, each end to end rather than by grep alone: **sync** (HLC
stamping, merge, outbox), **storage** (the vault, the gateway, backup/restore), **dates** (clocks,
countdowns, trip-day math), **money** (expenses, settlement, export), **pwa** (service worker,
caches, offline), **react** (hooks, effects, render correctness), **concierge** (the AI panel and
its ops path), **a11y**, and **content** (default-pack content leaking into custom trips). 53
findings, listed below, ordered S1 → S4.

Severities are impact-on-a-real-user, not effort:

| | meaning |
|---|---|
| **S1** | data loss, silent corruption of a shared trip, or a security boundary that is not there |
| **S2** | a feature is broken or unreachable for a whole class of user; no clean recovery |
| **S3** | wrong output, a self-contradicting screen, or a defence that does not run |
| **S4** | cosmetic, or a gap in a check rather than in the app |

Confidence is one of **confirmed** (reproduced, output pasted), **likely** (traced end to end in
source, not executed), or **speculative** (the shape is wrong; the trigger could not be
constructed).

## Checked and found clean

Recorded so these surfaces are not re-hunted:

- `computeCountdown` is correct. A 5-minute-step sweep of 37,428–37,452 instants from Aug 1 to the
  Dec 9 target, under each of `America/New_York, Asia/Kathmandu, Asia/Tokyo, Australia/Sydney,
  Australia/Lord_Howe, America/Santiago, Pacific/Chatham, Europe/Lisbon, Pacific/Auckland, UTC`,
  found **0** violations of negative-field, `hours < 24`, `weeks !== 4`, exact sum-back, or
  `totalDays` monotonicity. Nepal's `:45` offset, the 30-minute Lord Howe DST step and the Chatham
  `:45` zone all pass.
- `npm run contrast-check` → `ALL PAIRINGS PASS, ALL GUARDS HOLD` (exit 0).
- `npm run loop-check` → `2 INFINITE LOOP(S) ... ALL HARD-STOPPED UNDER REDUCED MOTION` (exit 0).
- A full-page axe-core 4.x scan at **all** impact levels, 390×844, signed-in seed, against the
  built `out/`: **zero violations on twelve routes** — the three no e2e pack visits (`/guides/`,
  `/more/`, `/trips/`) plus `/profile/`, and the eight gated only at serious/critical (`/packing/`,
  `/checklist/`, `/journal/`, `/safety/`, `/recap/`, `/settings/`, `/share/`, `/passport/`).
- `document.getAnimations()` polled under `reducedMotion: reduce` on 13 routes: `running=0`
  everywhere.
- Keyboard probes on the navbar More dropdown (focus returns to trigger on Escape, `aria-controls`
  wired) and the ⌘K palette (focus enters the input, 30 Tab presses never leave `[role=dialog]`,
  Escape restores focus). Both correct.
- Static scans for `div`/`span` with `onClick` and no role, icon-only buttons with no accessible
  name, `aria-hidden` wrappers containing focusables, and unlabelled `input`/`select`/`textarea`:
  **zero hits**. Calendar drag-and-drop has a `KeyboardSensor` with `sortableKeyboardCoordinates`
  and a labelled `<button>` handle.

## Summary

| id | finding | sev | conf | area | status |
|---|---|---|---|---|---|
| SYNC-1 | `?today=` stamps HLCs and the tombstone-GC horizon; the GC'd doc is written back to Firestore | S1 | confirmed | sync | fixed |
| STORAGE-1 | Expense restore accepts any `{schemaVersion, payload[]}` file and deletes every expense | S1 | confirmed | storage | fixed |
| STORAGE-2 | Whole-trip restore silently loses expenses/budget/docs/places on a synced trip, and reports success | S1 | confirmed | storage | fixed |
| DATES-3 | `?today=` mints HLC stamps months in the future that outrank every real edit (same defect as SYNC-1) | S1 | confirmed | dates | fixed |
| CONCIERGE-2 | The concierge's "this trip is yours" gate is client-only; the relay behind it enforces nothing | S1 | confirmed | concierge | NOT fixed |
| CONCIERGE-3 | Externally supplied place URLs reach a live `<a href>` with no scheme allow-list | S1 | likely | concierge | fixed |
| CONTENT-4 | Legacy itinerary-only restore bypasses the cross-trip guard and overwrites the active trip | S1 | confirmed | content | fixed |
| SYNC-2 | The HLC skew clamp is dead code: `hlcReceive` / `MAX_SKEW_MS` have no production callers | S2 | confirmed | sync | fix REJECTED |
| SYNC-3 | `budgetDocToFields` is unsanitized; one bad `hlc` wedges the outbox forever | S2 | confirmed | sync | fixed |
| SYNC-4 | Places was left out of the forward-field fix, so a peer's newer fields are erased on push | S2 | confirmed | sync | fixed |
| STORAGE-3 | Forgetting a trip deletes its photo index but leaves every blob in IndexedDB | S2 | confirmed | storage | fixed |
| STORAGE-4 | One malformed day in a pre-v5 vault quarantines the whole trip | S2 | confirmed | storage | fixed |
| DATES-6 | A custom trip's date span is unbounded: one wrong digit yields 65,744 dates and 4.3 MB of shells | S2 | likely | dates | fixed |
| PWA-1 | Offline, tapping any in-app link lands on the Home shell at a `/<route>/index.txt` URL | S2 | confirmed | pwa | fixed |
| PWA-2 | `activate` deletes every non-allowlisted cache on the whole origin | S2 | likely | pwa | fixed |
| REACT-1 | `?focus=` cleanup double-prefixes basePath and navigates the user to a 404 | S2 | confirmed | react | fixed |
| CONCIERGE-1 | `addItem` ops skip the content type check, so Confirm writes a row that vanishes | S2 | confirmed | concierge | fixed |
| CONCIERGE-4 | The 45 s abort ceiling misses the auth await, pinning the panel in `streaming` forever | S2 | likely | concierge | fixed |
| A11Y-1 | Reduced motion removes the camera offset that keeps map-popup controls reachable | S2 | confirmed | a11y | fixed |
| CONTENT-1 | `/map/` shows the 27 curated Nepal/Japan pins on every custom trip | S2 | confirmed | content | fixed |
| CONTENT-2 | `/safety/` serves Nepal/Japan emergency numbers as *your* trip's safety kit, un-gated | S2 | confirmed | content | fixed |
| CONTENT-3 | A custom trip with no destinations writes its NAME into the permanent lifetime visit record | S2 | confirmed | content | fixed |
| CONTENT-5 | `#constructor` as a legacy hash crashes Home into the error boundary | S2 | confirmed | content | fixed |
| CONTENT-6 | "Forget trip" is silently undone by any other device still sitting on that trip | S2 | likely | content | fixed |
| CONTENT-7 | `sanitizeTripConfig` validates date *shape* only: no real-date check, no span bound | S2 | confirmed | content | fixed |
| SYNC-5 | Four hooks gate tombstoning on the app-wide config, so the sample pack grows tombstones forever | S3 | confirmed | sync | fixed |
| STORAGE-5 | `readJson` has no shape gate, so a slot holding JSON `null` throws out of the never-throw gateway | S3 | confirmed | storage | fixed |
| DATES-1 | Two disagreeing "today" clocks: the trip day rolls at Nepal midnight, everything else at the device's | S3 | confirmed | dates | fixed |
| DATES-2 | `/travel`'s first paint reads its own sentinel as a clock: "Trip starts in 20797 days" | S3 | confirmed | dates | fixed |
| DATES-4 | The 7-day outlook labels rows by array position, so a cached forecast calls an old day "Today" | S3 | confirmed | dates | fixed |
| DATES-5 | Home's live cell reads "0 Days to go" for most of the day before departure | S3 | confirmed | dates | fixed |
| MONEY-1 | Day/leg spend is bucketed by the date's leg, so a cross-leg expense is summed in the wrong currency | S3 | confirmed | money | fixed |
| MONEY-2 | Settle-up transfers depend on who is signed in, so two travellers are told to pay different people | S3 | confirmed | money | fixed |
| MONEY-3 | The "settled" chip uses a hardcoded half-unit threshold, so a USD leg contradicts itself | S3 | confirmed | money | fixed |
| PWA-3 | RSC payloads are cached under per-navigation `?_rsc=` keys, growing the precache without bound | S3 | confirmed | pwa | fixed |
| PWA-4 | `trip-images-v1` is never versioned and shadows the precache, so a redeployed image is stale forever | S3 | confirmed | pwa | fixed |
| PWA-5 | `caches.match` sits outside the try/catch in the navigation and static branches | S3 | speculative | pwa | fixed |
| REACT-2 | The "Planned" filter list goes stale when a placement is added or removed | S3 | confirmed | react | fixed |
| REACT-3 | Concurrent place-link resolves have no request-id guard; a stale response overwrites the form | S3 | confirmed | react | fixed |
| REACT-4 | Editing a past day's journal entry is labelled "Today's journal" | S3 | confirmed | react | fixed |
| REACT-5 | The storage-full recovery toasts send the user to `/plan`, which has no backup control | S3 | confirmed | react | fixed |
| CONCIERGE-5 | A newline in a stored item title forges its own line in the model context | S3 | confirmed | concierge | fixed |
| CONCIERGE-6 | A 200 that is not the JSON envelope renders an empty bubble as a successful turn | S3 | confirmed | concierge | fixed |
| CONCIERGE-7 | Two identical ops share an `opKey`, so confirming one silently consumes both | S3 | likely | concierge | fixed |
| A11Y-2 | The concierge sheet's only close button renders 17×17 px | S3 | confirmed | a11y | fixed |
| A11Y-3 | Status regions are created at the same moment as their text, so nothing is announced | S3 | confirmed | a11y | fixed |
| A11Y-4 | The "New version available" toast is permanent and has no keyboard dismissal | S3 | confirmed | a11y | fixed |
| CONTENT-8 | `vibeFor` returns `Object` for a prototype-key vibe, and Home's hero dereferences it | S3 | likely | content | fixed |
| DATES-7 | Three date labels use the device locale while every other date is pinned to `en-US` | S4 | confirmed | dates | fixed |
| MONEY-4 | Expense CSV is written without a UTF-8 BOM, so non-ASCII notes mojibake in Excel | S4 | likely | money | fixed |
| PWA-6 | `apple-touch-icon.png` is generated, shipped and precached but referenced by nothing | S4 | confirmed | pwa | fixed |
| PWA-7 | `navigator.onLine` is treated as truth, so two surfaces claim "Online" on a dead connection | S4 | confirmed | pwa | fixed |
| A11Y-5 | `motion-loops.mjs` cannot see the sub-6 s infinite loops that ship from Tailwind's stylesheet | S4 | confirmed | a11y | fixed |

Paths below are relative to `trip/` unless stated. SYNC-1/DATES-3 and CONTENT-7/DATES-6 are written
as merged sections; see [Duplicates and out-of-repo items](#duplicates-and-out-of-repo-items).

## What was fixed, and what was deliberately not

The `status` column above is the state after the fix pass on this same list: **51 fixed, 1 not
fixed, 1 fix rejected**. The reasoning for each fix is in `DECISIONS.md`, D-378 through D-398 —
the section headings name the finding ids, so a finding here maps to its entry by search.

Two are open, and each for a different reason:

- **CONCIERGE-2 — NOT fixed, and not fixable here.** The membership gate exists only in a Worker
  version that was never deployed, so the live relay still verifies nothing and no client change can
  make it real. **Nothing client-side is a security boundary for this**, so nothing client-side was
  added: a gate written against a check that does not run reads as protection and is not. The
  in-code comment in `hooks/use-concierge-chat.ts` still asserts the Worker verifies membership —
  that assertion is wrong and is left flagged here rather than quietly reworded, because rewording
  it is the only part of this that could be done in this repo and it deserves to be decided
  deliberately. See D-385, "not done here".
- **SYNC-2 — the finding stands, the suggested fix is REJECTED.** See the amended Fix note in that
  section and D-380.

Three have closed since the first pass, and are recorded here because the reasoning for holding them
open is still worth having:

- **DATES-1 — `fixed`** (was `NOT fixed`; closed 2026-08-21). It was held open for the seam decision:
  treat the pre-departure window as origin-local, or move
  `TRIP_START`/`getFlightTiming`/`elapsedInclusiveDays` onto the destination offset. The first won, in
  a narrower form than this section proposed — `getTodayInTrip()` takes window MEMBERSHIP from the
  device calendar and the day NUMBER from the destination offset, rather than re-seeding
  `tripOffsetMinFor`. The second was rejected outright: `Journey.departDate` is authored in the
  departure airport's zone, so moving flight timing onto the destination offset would announce
  "Departing today" some sixteen hours early. Both write paths that default a new row's `date` from
  `getTodayInTrip()` inherit the fix. See D-396, which also records what is NOT covered.
- **PWA-1 — `fixed`** (was `partial`; the payloads landed 2026-08-21). Fix (a) went first:
  `normalizePath` strips the `.txt` suffix, so an offline link tap resolves to the correct route's
  shell instead of Home — but as a hard reload, with the address bar still reading the `.txt` URL.
  Fix (b) is in too: `buildPrecacheList` now emits all 19 `out/<route>/index.txt` payloads, so the
  offline click is a soft navigation. What re-decided it was the wire number rather than the raw one
  — +69.3 KiB gzipped as Pages actually serves it, not the +461 KB raw this section quotes — on an
  install already 1.48 MiB, with a steady-state device cost of zero because the runtime `cacheFirst`
  already deposits the same 19 keys on the first online browse. A second decision came with it: for a
  `.txt` key the WHOLE search is dropped, not just `_rsc`, or the palette's `/plan/?focus=<id>`
  navigation still misses the one entry that exists. See D-390, D-397 and D-398.
- **MONEY-1 — `fixed`** (was `partial`; the calendar seam closed 2026-08-21). The recap seam went
  first: `sumExpensesForDate` takes a `leg` and both recap surfaces pass the day's leg. The calendar
  seam is now closed too — `expensesByDate` skips a row whose `e.leg` is not
  `getCountryForDate(e.date)`, deriving the day's leg inside the function from the `e.date` it already
  holds, so the bucket equals `sumExpensesForDate(expenses, date, getCountryForDate(date))` with no
  argument, no shape change and no caller edit. The (date, leg) pair-keying this section proposed was
  rejected: it changes the shape `calendar-planner.tsx` and `calendar-day-picker.tsx` read and forces
  an undesigned answer to rendering two currencies in a 44px month-grid cell. Residual ceiling, named
  in the code and in the D-392 addendum: a cross-leg row is excluded from every day view rather than
  shown under its own symbol — it still counts in the leg total, the trip total and settle-up.

Of the three entries in "Gaps in the checks", two are closed and one is not. **A11Y-5** is closed:
`motion-loops.mjs` has a second pass over the source (D-394). **PWA-1**'s is closed: a spec in
`e2e/pwa-torn-update.spec.ts` now cold-loads offline and CLICKS `navbar-link-plan` — the first
offline navigation in the suite that is not a `page.goto`. What it asserts is a `window` marker set
before the click, not the `/plan/` title: the title and the shell-identity checks pass under the
hard-navigation fallback too, so only something that cannot survive a document navigation tells the
two apart. **A11Y-4**'s is unchanged: `e2e/fixtures.ts` still suppresses the toast layer for every
spec, so no axe scan runs against the state a first-time visitor is in, even though the toast itself
is now keyboard-dismissable.

The four tests named at the end of that section as pinning current rather than correct behaviour
were all rewritten to the new contract, not deleted.

---

# S1

## SYNC-1 / DATES-3 — the `?today=` demo clock reaches HLC stamps and the tombstone-GC horizon

Found independently by the sync and dates areas. Two halves of one root cause; recorded together.

- **Severity / confidence:** S1 · confirmed (both halves reproduced)
- **Where:** `lib/trip-now.ts:111-124` (`getNow` returns the override; `clock: ClockPort = { now:
  getNow }`) → the 25 stamp sites in `hooks/use-itinerary.ts` (`:176`, `:199`, `:222`),
  `hooks/use-expenses.ts` (`:144`, `:157`, `:174`, `:198`, `:219`, `:239`, `:251`),
  `hooks/use-docs.ts` (`:78`, `:130`), `hooks/use-budget.ts`, `hooks/use-my-places.ts` → 
  `core/sync/hlc.ts:138-143` → `core/sync/merge-items.ts:74-76`; and the GC half at
  `lib/itinerary-remote.ts:490` (`gcTombstones(mergeDay(...), clock.now().getTime())` then
  `tx.set`), `lib/itinerary-remote.ts:667`, `lib/expenses-remote.ts:95` and `:187`,
  `lib/places-remote.ts:73`.
- **What breaks:** `clock.now()` is the *simulation* clock, not the real one.
  - **Stamps.** `?today=2026-12-09` makes `getNow()` return local noon of Dec 9 for the whole page
    load. Every itinerary / expense / docs / places / budget write in that session is stamped
    `hlc.pt = 2026-12-09T17:00Z`. `resolvePair` picks the higher `pt`, so that row beats every
    genuine later edit from any device until the real clock passes the faked date. Because
    `hlcSendOrLocal` ratchets `pt` to the row's own last `pt`, the inflated stamp is sticky — it is
    inherited by every subsequent edit of that row on every device. The stamps go to localStorage
    and out through the outbox to Firestore. The mirror case is as bad: a past-dated override
    (`?today=2020-01-01`, or anything serializing to `pt <= 0`) mints stamps that *lose* every
    merge, so those edits are silently discarded.
  - **GC horizon.** `gcTombstones` / `gcTombstoneRows` run with `nowPt` = the faked date, so every
    tombstone older than `faked − 30d` is dropped from the **merged** result — which
    `pushDayMerged` / `pushChunkMerged` then `tx.set` back to Firestore. Any peer still holding the
    row live re-adds it on the next merge: deletes silently un-delete for the whole group.
- **Trigger:** the trip is Dec 2026 and the real date is Aug 2026, so the *intended* use of the
  switch is months in the future. Open `…/plan?today=2026-12-11` — the app persists it to
  `sessionStorage` so it stays on for the whole session (`lib/trip-now.ts:88-93`), and the switch
  "ships in ALL builds" (`lib/trip-now.ts:15`) — then edit or delete anything on a custom (synced)
  trip.
- **Evidence:** the two halves, each run against verbatim transcriptions of the real modules
  (`gcTombstones`, `mergeDay`, `stamp`, `hlcSendOrLocal`, `serialize`, `parse`, `compareHlc`,
  `resolvePair`, `localNoon`):

  ```
  horizon days = 30 | sim is 112 days ahead
  gcTombstones(day, realNow).items = [ 'ITEM7' ]
  gcTombstones(day, simNow).items  = []   <-- this is what tx.set() writes
  B merges the GC-ed remote        = [ { id: 'ITEM7', deleted: false } ]
  ```
  ```
  A.hlc = 001796835600000:000000:deviceA  pt -> 2026-12-09T17:00:00.000Z   (typed Aug 21 under ?today=)
  B.hlc = 001787580000000:000000:deviceB  pt -> 2026-08-24T14:00:00.000Z   (real edit, 3 days later)
  merge winner: Dinner (typed on Aug 21 under ?today=)   |  days A is ahead of B: 107.1
  ```

  Amplifier: `DATE_RE` at `lib/trip-now.ts:47` validates only the *shape*, so nonsense dates are
  accepted and become the clock —

  ```
  ?today=9999-12-31  regex=true  clock=9999-12-31T17:00Z  hlc=253402275600000:000000:A   (wins every merge until 9999)
  ?today=2026-13-45  regex=true  clock=2027-02-14T17:00Z
  ?today=0000-00-00  regex=true  clock=1899-11-30T17:00Z  hlc=000000000000000:000000:A   (loses every merge)
  ```

  The repo already knows the switch leaks: `lib/preflight.ts:255` renders a warning row for it —
  but it says only that *day numbers and countdowns are demo values*, never that edits are being
  written to the shared trip with a fake timestamp. The guard written for exactly this is dead code
  (see SYNC-2). And `lib/attribution.ts:38,62,88` proves the codebase already knows the two clocks
  differ: `updatedAt` is stamped from the real `new Date()` on the very same edit, so a row written
  under the override carries `updatedAt` = Aug 21 and `hlc.pt` = Dec 9.
- **Root cause:** one `ClockPort` serves two jobs with opposite requirements. `getNow()`
  deliberately resolves the demo override for *display* math (countdown, day-in-trip); the sync
  layer reuses the same port for *causality* (HLC `pt`) and for the *GC horizon*, where a faked
  instant is not a simulation but corruption written to the server.
- **Fix:** add an override-free reader next to `clock` in `lib/trip-now.ts` —
  `export const realClock: ClockPort = { now: () => new Date() }` — and point every sync-path caller
  at it: the five `clock.now().getTime()` GC/stamp sites in `lib/itinerary-remote.ts`,
  `lib/expenses-remote.ts`, `lib/places-remote.ts`, plus the `clock` import in the five hooks.
  `lib/preflight.ts:315` already does this by hand for the same reason ("the REAL clock, never
  `getNow()`"). Tighten `DATE_RE`'s consumer while there: `localNoon` should reject a parse that
  does not round-trip (`d.getMonth() !== mo - 1`).

## STORAGE-1 — expense restore accepts any `{schemaVersion, payload[]}` file and silently deletes every expense

- **Severity / confidence:** S1 · confirmed
- **Where:** `lib/expense-export.ts:57-80` (shape gate at `:66-77`, `sanitizeExpenses` at `:79`);
  consumed by `components/settings-panel.tsx:1539-1552`
- **What breaks:** `parseExpenseBackup` gates only on "is an object, has a numeric `schemaVersion`,
  has an array `payload`", then runs the payload through the *degrading* `sanitizeExpenses`. A file
  that satisfies the gate but contains no valid `Expense` rows parses to `[]` and returns
  `{ ok: true, expenses: [] }`. The UI then calls `restoreExpenses([])`, which under sync tombstones
  every live expense in one commit and propagates the deletion to every device — and reports
  "Expenses imported. Your logged expenses have been replaced with the backup."
- **Trigger:** Settings → "Restore expenses" → pick `nepal-japan-trip-backup.json`, the itinerary
  export, which sits in the same Downloads folder and is offered by the same file picker. Its
  envelope is `{schemaVersion:5, updatedAt, payload:[DayPlan,…]}` — numeric version, array payload
  — so it passes. No `DayPlan` has an `id`/`leg`/valid `category`, so `sanitizeExpense`
  (`core/budget/expenses.ts:151-160`) drops all of them.
- **Evidence:** probe against the real modules (`exportItinerary()` → `parseExpenseBackup`):

  ```
  itinerary export head: {"schemaVersion":5,"payloadIsArray":true,"payloadLen":2}
  parseExpenseBackup -> {"ok":true,"expenses":[]}
  ```

  The test that claims to cover this does not: `lib/__tests__/expense-export.test.ts:78` — *"rejects
  a recognized-but-foreign shape (e.g. an itinerary export)"* — feeds `payload: 'not-an-array'`,
  which a real itinerary export never is.
- **Root cause:** the two import trust boundaries were given opposite policies. The itinerary path
  deliberately uses the all-or-nothing `parseItineraryPayloadStrict` (`core/vault/schema.ts:201-221`)
  precisely because an array of garbage validates as `[]` and `restorePlans` then tombstones every
  live item (D-098). The expenses path was given the lenient per-row `sanitizeExpenses` while wiring
  up the *same* tombstone-replace restore (`hooks/use-expenses.ts:225-256`), reopening the hole
  D-098 closed.
- **Fix:** in `parseExpenseBackup`, reject when the payload contains rows `sanitizeExpense` could
  not salvage — compare `payload.length` to `expenses.length` and return the existing "missing or
  has malformed data" error (plus quarantine) when they differ. That is the D-098 rule expressed
  once, at the function both the Settings restore and any future caller route through. Keep
  `sanitizeExpenses` lenient for the on-disk read path, which has no second copy.

## STORAGE-2 — whole-trip restore silently loses expenses/budget/docs/my-places on a synced trip, and reports success

- **Severity / confidence:** S1 · confirmed
- **Where:** `core/vault/backup.ts:404-408` (generic domains committed with a raw `spec.write`) vs
  `:410-413` (itinerary uses the dual path). Reverted by `lib/expenses-remote.ts:173-182`. UI:
  `components/backup-restore.tsx:102-120`.
- **What breaks:** `importTripBackup` commits every non-itinerary domain with a bare gateway write
  (`expensesStore.set` / `budgetStore.set` / `docsStore.set` / `myPlacesStore.set`). Those writes
  bypass `commit()`, so nothing is enqueued in the outbox. The UI then reloads
  (`components/backup-restore.tsx:120`). On reload, `subscribeRemoteExpenses`' first server snapshot
  takes the "Authoritative: remote verbatim" branch for every leg present remotely and not in
  `outboxDirty('expenses')` — which is all of them — and overwrites the just-restored rows. Budget,
  docs and my-places are HLC-merged instead, so an older backup's rows lose every field where the
  remote has a later stamp. Only the itinerary (dual path → `restorePlans` → `commit()` → outbox)
  and the genuinely local-only domains survive. The success message says "Trip restored — itinerary,
  journal, photos and more are back."
- **Trigger:** on a custom (synced) trip with at least one expense already pushed: Plan → Back up →
  later, Plan → Restore that file → confirm. After the automatic reload the expense list is the
  remote's, not the backup's.
- **Evidence:** `lib/expenses-remote.ts:173-177`

  ```js
  if (first && !dirty.has(leg)) {
    if (presentLegs.has(leg)) {
      // Authoritative: remote verbatim incl. empty …
      result.push(...remoteLeg);
  ```

  and `core/vault/backup.ts:405-407` — `domainsBySlot[slot].write(cleaned)`, no sync, no outbox. The
  misconception is stated at `components/backup-restore.tsx:67`: "Drives ONLY which itinerary commit
  path importTripBackup uses — **every other domain is local-only regardless**", which contradicts
  `core/storage/gateway.ts` keys 10/11/25/31, all documented as synced.
- **Root cause:** the `CommitItinerary` dual-path seam (`core/vault/backup.ts:73`) was added for the
  itinerary only. Every other synced domain kept the pre-fix ingest-overwrite shape that the
  first-snapshot apply is designed to unwind.
- **Fix:** give `importTripBackup` the same injectable commit seam for the other synced domains —
  pass `restoreExpenses` and the budget/docs/places equivalents from `components/backup-restore.tsx`
  the way `commitItinerary` already is, so each restored domain lands through `commit()` and marks
  its chunk dirty. Cheapest partial: after the raw writes, mark the restored domains dirty in the
  outbox (`core/sync/outbox.ts`) so the first snapshot takes the merge branch instead of the
  authoritative one.

## CONCIERGE-2 — the concierge's "this trip is on your account" gate is client-only, and the relay it guards enforces nothing

- **Severity / confidence:** S1 · confirmed
- **Where:** `hooks/use-concierge-chat.ts:336-351` (the gate), `:274-280` (`statusMessage`),
  `lib/worker-auth.ts:5-10` and `:27-36`, `lib/concierge-config.ts:15`
- **What breaks:** three surfaces tell the user — and the next developer — that the concierge is
  access-controlled, and the server side is not. `lib/worker-auth.ts:5-10` states that the Worker
  moved from token possession to rules-verified membership and that failing closed is the Worker's
  half of that; `statusMessage` has a dedicated 401/403 sentence, "The concierge couldn't confirm
  this trip is yours. Sign in again"; and `send()` refuses with "This trip isn't on your account, so
  the concierge can't help with it." The deployed Worker enforces none of it — the membership gate
  was built in 1.9.0 and never shipped, which the file's own comment at `:341-346` records.
  Meanwhile `CONCIERGE_URL` is `process.env.NEXT_PUBLIC_CONCIERGE_URL`, i.e. inlined in plaintext
  into the shipped static bundle, and the deploy workflow hard-fails a build without it. So the
  client gate is a UI affordance in front of an unauthenticated relay to a free-tier LLM whose rate
  limiter fails open (D-338); quota can be drained by anyone, and the traveller's only signal is the
  generic "having trouble right now" copy.
- **Trigger:** the client attaches no credential when there is no session, and the deployed Worker
  requires none — so a request carrying no `Authorization` and no `X-Trip-Token` is a normal,
  expected request shape rather than a rejected one. Not probed: this sweep is source-only and does
  not exercise the live Worker.
- **Evidence:** `lib/concierge-config.ts:15` —
  `export const CONCIERGE_URL = process.env.NEXT_PUBLIC_CONCIERGE_URL || '';`.
  `hooks/use-concierge-chat.ts:347-351` — the whole gate is
  `if (!isDefaultTrip() && !getKnownTrip(getActiveTripId()))`, a read of the local trip registry.
  `lib/worker-auth.ts:28` — `if (!isRemoteConfigured()) return {};`, so the header is optional on the
  client. `lib/__tests__/use-concierge-chat.test.ts` asserts exactly that: *"#10 — attaches NO
  authorization header when there is no session"*.
- **Root cause:** the client half of #10 shipped ahead of the server half by design ("that is what
  lets the client ship first"), but nothing tracks that the server half is still missing, and the
  user-facing copy was written as if it had landed.
- **Fix:** server-side first — deploy the reconciled Worker (the membership gate merged onto the
  build that carries the rate-limit binding) before anything here changes. In this repo the honest
  interim change is to stop asserting a check that does not run: soften the `lib/worker-auth.ts`
  header comment and reword the 401/403 branch of `statusMessage` so it does not promise "we
  confirmed this trip is yours". Do not add more client-side gating — it cannot help.

## CONCIERGE-3 — the Worker's `finalUrl` becomes an `<a href>` with no scheme allow-list

- **Severity / confidence:** S1 · likely (traced across all four boundaries; not rendered in a
  browser, which is the only reason it is not confirmed)
- **Where:** `lib/place-resolve.ts:66` → `components/import-place-sheet.tsx:124` and `:168-169` →
  `core/places/model.ts:71-72` → `components/my-places-section.tsx:57` and `:102`
- **What breaks:** `resolvePlaceLink` passes the Worker's `finalUrl` through `cleanStr` (non-empty
  string, trimmed) and nothing else — no protocol check. The same card renders
  `const link = place.resolvedUrl ?? place.sourceUrl` straight into
  `<a href={link} target="_blank" rel="noopener noreferrer">`. `core/places/model.ts` types both as
  bare `z.string().optional()`, in contrast to `core/content/safety.ts:42`, which uses
  `z.string().url()`. `isGooglePlaceUrl` (`core/places/model.ts:238`) is a correct https-only
  allow-list, but its own comment calls that copy "a UX affordance" and `handleConfirm` never calls
  it — `sourceUrl: url.trim()` is stored whatever the user typed. So a `javascript:` string reaches
  a live anchor by two routes: a hostile `finalUrl` from the network boundary, or a `sourceUrl`
  typed or pasted by a peer. `places` is a **synced** domain (`lib/places-ports.ts:48`
  `placesSyncPort`), so the second route crosses devices: the other member of the trip taps the
  external-link icon and the script runs on the app origin, with the Firebase session and every trip
  key in localStorage. There is no CSP — the export is static Pages, `next.config.js` sets no
  headers, and there is no `http-equiv` meta.
- **Trigger:** save a place whose URL field holds a `javascript:` payload, let it sync, then tap the
  external-link button on that card from the other device. Also reachable without a peer if the
  Worker's `/resolve` ever returns a non-http `finalUrl`.
- **Evidence:** `lib/place-resolve.ts:25-27` —
  `function cleanStr(v: unknown): string | undefined { return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined; }`
  — the only filter applied to `finalUrl`. `components/import-place-sheet.tsx:168` —
  `sourceUrl: url.trim() || undefined,` inside `handleConfirm`, which contains no `isGooglePlaceUrl`
  call. `components/concierge-chat.tsx:32-33` proves the project already knows the rule and applies
  it to the *other* untrusted-URL source: `const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;`.
- **Root cause:** the href allow-list was written as a local constant inside the markdown renderer
  instead of at the URL trust boundary, so the second consumer of externally-supplied URLs never got
  it.
- **Fix:** export the `SAFE_HREF` test as a shared `isSafeHref(url)` and apply it at the two
  boundaries that produce the value — `cleanStr` for `finalUrl` in `lib/place-resolve.ts:66`, and
  `sourceUrl: url.trim()` in `components/import-place-sheet.tsx:168`. Belt and braces: tighten
  `sourceUrl`/`resolvedUrl` in `core/places/model.ts:71-72` to `z.string().url()` so anything
  already stored is dropped on read.

## CONTENT-4 — legacy itinerary-only restore bypasses the A-5 cross-trip guard and overwrites the active trip's itinerary

- **Severity / confidence:** S1 · confirmed
- **Where:** `core/vault/backup.ts:335-340`
- **What breaks:** `importTripBackup` refuses a full backup whose `tripId` is not the active trip
  (`:348`), but a file that is not a full backup falls into the legacy branch three lines earlier, is
  validated by `parseBackup` (envelope shape only — the itinerary-only envelope is
  `{schemaVersion, updatedAt, payload}` and carries no trip identity at all), and is committed into
  whatever trip is active. Under sync the injected `commitItinerary` is the store's `restorePlans`,
  which expresses this as a tombstone-replace merge — so a custom trip's entire itinerary is replaced
  by the Nepal×Japan days, *and the replacement propagates to every other member of that trip*.
- **Trigger:** hold an itinerary-only export (`exportItinerary()`'s envelope — the shipped export
  format before the full-backup container). Switch to a custom trip. Settings → Restore → pick that
  file. It is accepted, and 32 `country:'nepal'|'japan'` days dated Dec 9 – Jan 9 replace the custom
  trip's days.
- **Evidence:**

  ```
  backup.ts:335  if (!isTripBackup(parsed)) {
  backup.ts:336    const pr = parseBackup(text);
  backup.ts:338    commitItinerary(pr.plans);
  backup.ts:348  if (env.tripId !== getActiveTripId()) {   // ← only reached for a FULL backup
  ```

  `core/vault/export-import.ts`'s `parseBackup` does JSON parse → `detectVersion` → migrations →
  `parseItineraryPayloadStrict`. None of those four steps looks at a trip id, and
  `core/vault/schema.ts`'s `dayPlanSchema` accepts any non-empty `country` string and any `date`
  string, so nothing rejects out-of-span dates or a foreign leg id either.
- **Root cause:** the A-5 guard was attached to the envelope field (`tripId`) rather than to the
  *commit*, and the legacy format has no such field, so the branch that predates it has no guard to
  inherit.
- **Fix:** move the check to the one commit point. In the legacy branch, refuse when none of
  `pr.plans`' dates appear in the active trip's `TRIP_DATES` — that is the only trip identity a
  legacy file carries, it is cheap, and it costs a legitimate same-trip restore nothing.

---

# S2

## SYNC-2 — the HLC skew clamp is dead code: `hlcReceive` / `MAX_SKEW_MS` have zero production callers

- **Severity / confidence:** S2 · confirmed
- **Where:** `core/sync/hlc.ts:73` (`MAX_SKEW_MS`), `core/sync/hlc.ts:160-179` (`hlcReceive`)
- **What breaks:** nothing in the wired path bounds an implausible `pt`. `core/sync/hlc.ts` documents
  a 24 h clamp — *"a far-future peer is capped so it can't poison this device's future local
  stamps"* — but the only function that applies it is never called outside the test file. A device
  with a wrong system clock (or SYNC-1's `?today=`) writes a far-future `hlc` into the shared doc;
  every peer's `nextSyncStamp` then ratchets off that value (`hlcSendOrLocal`:
  `pt = Math.max(physicalNow, lastPt)`), so the row's `pt` is stuck in the future permanently and no
  real-time-correct concurrent edit can ever win it again.
- **Trigger:** one edit from a phone whose clock is set a year ahead permanently pins that item's HLC
  a year ahead on every device.
- **Evidence:** `grep -rn "hlcReceive\|MAX_SKEW_MS" --include="*.ts" --include="*.tsx" trip/ | grep -v __tests__`
  returns only the four lines inside `core/sync/hlc.ts` itself:

  ```
  ./core/sync/hlc.ts:73:export const MAX_SKEW_MS = 24 * 60 * 60 * 1000;
  ./core/sync/hlc.ts:160:export function hlcReceive(local: Hlc | null, remote: Hlc, physicalNow: number): Hlc {
  ./core/sync/hlc.ts:166:  const cappedRemotePt = Math.min(remote.pt, physicalNow + MAX_SKEW_MS);
  ```

  `lib/__tests__/core-sync-hlc.test.ts` covers `hlcReceive` thoroughly, which is why it reads as
  wired.
- **Root cause:** `hlcReceive` was written for a "receive" step the state-based design never grew:
  absorption happens implicitly, via `nextSyncStamp(prev, …)` reading the merged winner's `hlc`. That
  path ratchets but never clamps, so the defence that was designed and tested was left out of the
  only path that runs.
- **Fix as first suggested — REJECTED, DO NOT IMPLEMENT. It causes data loss.** The suggestion was:
  *move the clamp into the one function every stamp routes through — `hlcSendOrLocal`
  (`core/sync/hlc.ts:138`): `const lastPt = Math.min(last?.pt ?? 0, physicalNow + MAX_SKEW_MS)`,
  covering `firstSyncStamp` and `nextSyncStamp`, i.e. all five domains, in one line, leaving
  `compareHlc` on raw stored stamps untouched.* It is wrong because of what `last` is. In this
  state-based design `last` is **the row's own stored stamp**, not a device clock reading, so
  lowering it mints a new stamp that sorts BELOW the row being edited; `compareHlc` then keeps the
  stored row and **the user's edit is reverted by the next snapshot** — silently, on all five
  domains, from a one-line change. The invariant is pinned by the R5 monotonicity case in
  `lib/__tests__/core-sync-hlc.test.ts`, which drives `last.pt` a thousand years ahead. Ruled on in
  **`DECISIONS.md` D-380**, which also records that this move has now been proposed twice — both
  times from a correct reading of docstrings that described the clamp as a live defence of the merge
  path.
- **What was actually done.** The finding itself stands and is real: a documented guard with no
  production caller reads as a defence that runs. `MAX_SKEW_MS` and `hlcReceive` are unchanged and
  still unwired — D-228 kept them knowingly and D-309 named the residual that leaves — but both
  docstrings now say plainly that they have no production caller and that the "far-future peer is
  capped" sentence describes `hlcReceive`, not the shipped merge path. `hlcSendOrLocal` carries the
  matching note saying why the clamp must not move into it. The app's own way of manufacturing an
  implausible `pt` (SYNC-1/DATES-3's `?today=`) is closed separately, by D-378.

## SYNC-3 — `budgetDocToFields` is the last unsanitized remote read; a field entry with no `hlc` wedges the outbox forever

- **Severity / confidence:** S2 · confirmed (crash traced and reproduced; the input requires a doc
  written by something other than the current client)
- **Where:** `lib/budget-remote.ts:34-37` (bare cast) → `core/sync/merge-budget.ts:62`
  (`compareHlc(parse(a.hlc), parse(b.hlc))`) → `core/sync/hlc.ts:97` (`serialized.indexOf(':')`)
- **What breaks:** `budgetDocToFields` returns `data.fields as BudgetFields` with no validation.
  `mergeBudget` then calls `parse(entry.hlc)` unguarded, so a `fields` entry whose `hlc` is missing
  or non-string throws a `TypeError`. In `pushBudgetMerged` (`lib/budget-remote.ts:58-63`) the throw
  is *inside* `runTransaction`, so the transaction rejects → `pushBudgetChunk` rejects →
  `pushChunkOnce` swallows without acking (`core/sync/outbox.ts:217-220`) → the `'model'` chunk stays
  dirty and is re-attempted on every `online`, every `visibilitychange:visible` and every mount,
  forever, each attempt a real Firestore read+write on a free tier. In `subscribeRemoteBudget`
  (`lib/budget-remote.ts:155`) the same throw is swallowed to a `console.warn`, so budget sync goes
  silently dead for that trip.
- **Trigger:** any `trips/{tripId}/budget/model` doc containing e.g. `fields: { "rates.NPR": { v: 999 } }`
  or `{ v: 999, hlc: 12345 }` — a doc written by an older or otherwise different client, or by
  anything else holding the trip link, since the trip id is the capability.
- **Evidence:**

  ```
  --- P3: mergeBudget on a remote field entry with no hlc ---
   THREW: TypeError: Cannot read properties of undefined (reading 'indexOf')
   THREW: TypeError: serialized.indexOf is not a function
  ```

  Every sibling remote read already defends against exactly this: `chunkDocToRows` →
  `sanitizeExpenses` (`lib/expenses-remote.ts:64`), `docToRows` → `sanitizeItems`
  (`lib/docs-remote.ts:59`), `docToPlaceRows` → `sanitizePlaces` (`lib/places-remote.ts:50`),
  `docToDayPlan` → `sanitizeItineraryItems` (`lib/itinerary-remote.ts:331`) — each carrying the same
  comment about the cast being a lie about untrusted bytes, and about a poison row wedging the
  outbox. Budget is the one that never got it.
- **Root cause:** the #123 read-boundary sweep covered the four row-shaped domains and skipped the
  one field-map-shaped domain, which has no `sanitize*` function of its own. `fieldsToModel` *does*
  guard (`core/budget/flatten.ts:107`, `typeof entry.hlc !== 'string'`) — but it runs **after**
  `mergeBudget`, so it never sees the value.
- **Fix:** filter in `budgetDocToFields` (the single remote read, used by both the push and the
  subscribe): keep only entries that are objects with `typeof hlc === 'string'` and a `v` of
  `number | string | null`. Same guard `fieldsToModel` already spells out, moved one step earlier.
  Defence in depth: make `parse()` in `core/sync/hlc.ts:96` total for a non-string argument — it
  already returns the oldest-possible stamp for malformed input, so the branch exists.

## SYNC-4 — the places domain was left out of the #138 fix: a peer's forward fields are erased from Firestore on every push

- **Severity / confidence:** S2 · confirmed (path traced end to end; impact is against a
  future/newer client, so no user is losing data today)
- **Where:** `core/places/model.ts:101-131` (`sanitizePlace`), `lib/places-remote.ts:49-51`
  (`docToPlaceRows`), `lib/places-remote.ts:70-75` (`pushPlacesMerged`)
- **What breaks:** `sanitizePlace` is a strict declared-field rebuild — it starts from
  `const place: MyPlace = { id, name, legId, addedAt }` and copies only the declared optionals, so
  `.passthrough()` on `myPlaceSchema` buys nothing downstream. It is the sanitizer at **both**
  boundaries: the remote read (`docToPlaceRows`) and the local save. `pushPlacesMerged` then writes
  `merged` straight back (`tx.set(ref, { version: 1, items: merged })`), so an older client reading a
  place row written by a newer build strips the newer build's keys and pushes the stripped row up.
  The equal-HLC superset tie-break in `resolvePair` cannot rescue this the way it does for
  expenses/docs, because on this domain **both** sides are already stripped by the time they meet.
- **Trigger:** ship any new `MyPlace` field — the model's own docblock anticipates this ("a place
  written by a future build is never dropped wholesale") — then have one device on the older bundle
  open the trip and touch the places list. The new field is gone from `trips/{tripId}/places/list`
  for everyone, permanently.
- **Evidence:** `b641827` ("stop an older client erasing a newer one's fields on sync (#138, #139)")
  touched `core/budget/expenses.ts`, `core/docs/model.ts`, `core/vault/schema.ts`,
  `core/sync/merge-items.ts`, `lib/docs-remote.ts`, `lib/expenses-remote.ts`,
  `lib/itinerary-adapter.ts` — and no places file. `sanitizePlaces` has no `SanitizeOptions`
  parameter at all, unlike its two siblings:

  ```
  expenses-remote.ts:64  sanitizeExpenses(data.items, { keepUnknownKeys: true })
  docs-remote.ts:59      sanitizeItems(data.items, [], { keepUnknownKeys: true })
  places-remote.ts:50    sanitizePlaces(data.items)          <-- strict, both directions
  ```

- **Root cause:** #138 was scoped from the two domains its report named. Places has the same
  read→merge→write-back shape and the same strict-rebuild sanitizer, and was not swept.
- **Fix:** add the same `SanitizeOptions { keepUnknownKeys?: boolean }` to
  `sanitizePlace`/`sanitizePlaces` (`core/places/model.ts`) — spread `value` first, then assign the
  declared fields on top with the matching `else delete` branches the two siblings already use — and
  set the flag at the single remote read `docToPlaceRows` (`lib/places-remote.ts:50`). Keep the local
  callers (`loadMyPlaces`/`saveMyPlaces`, backup) strict, exactly as D-376 describes. Note
  `mergePlaces`' transient `updatedAt` seed (`core/places/merge.ts:47`) must still be stripped by the
  final `sanitizePlaces` call.

## STORAGE-3 — forgetting a trip deletes its photo index but leaves every photo blob in IndexedDB forever

- **Severity / confidence:** S2 · confirmed
- **Where:** `core/storage/gateway.ts:690-705` (`wipeTripData`), called from
  `core/trips/registry.ts:311`. Blob store: `core/photos/blob-store.ts:98-100` (a single app-scoped
  DB, `nepal_japan_photos`).
- **What breaks:** photo *metadata* is trip-scoped (`keyFor('photos')`), photo *bytes* are in one
  app-scoped IndexedDB with no trip dimension. `wipeTripData(id)` sweeps only `localStorage` keys
  under `trip:{id}:`, so it deletes the only index that names that trip's blob ids. The blobs stay
  in IndexedDB permanently: no code path can enumerate them back to a trip (`exportTripBackup`
  deliberately iterates meta ids, never `blobStore.list()` — `core/vault/backup.ts:252-259`), and
  nothing GCs them. They keep counting against the origin quota, which eventually makes new captures
  return `{ok:false, reason:'quota'}` (`hooks/use-photos.ts:80-81`) and trips the 90%-quota toast. On
  a shared or handed-down device the previous traveller's photo bytes also survive a "forget this
  trip".
- **Trigger:** custom trip → attach photos to journal days / expense receipts → Trips hub → Forget
  this trip → confirm. `navigator.storage.estimate().usage` does not drop; the bytes are unreachable
  from every UI.
- **Evidence:** `grep -rn "defaultBlobStore\.\|blobStore.clear"` over `components/ hooks/ core/ lib/`
  returns exactly four call sites — `hooks/use-photos.ts:80` (put), `hooks/use-photos.ts:106`
  (delete-one), `hooks/use-photo-object-url.ts:23` (get), `components/sign-out-confirm.tsx:71`
  (`clear()`, and only when the "forget this device" checkbox is ticked). Nothing on the
  `removeKnownTrip` → `wipeTripData` path touches IndexedDB. `core/storage/gateway.ts:637-639` names
  photo blobs as "Deliberately NOT cleared" for `wipeAllTripData`, but `wipeTripData` inherited that
  exclusion without the sign-out escape hatch that justified it.
- **Root cause:** blob lifetime is tied to the meta row only at three hand-written call sites
  (`removePhoto`, the expense-delete loop in `components/budget-panel.tsx:159`, the clear-journal
  loop in `components/settings-panel.tsx:1389`). Every other path that destroys meta rows —
  `wipeTripData` being the reachable one — orphans the bytes, because there is no shared "meta gone
  ⇒ blob gone" step.
- **Fix:** in `removeKnownTrip` (`core/trips/registry.ts:311`), read that trip's photo meta before
  `wipeTripData(id)` and `blobStore.delete(id)` each blob — the same read-meta-then-delete-blobs
  shape `components/settings-panel.tsx:1385-1391` already uses for clear-journal. Longer term the
  honest fix is a reconcile pass (`blobStore.list()` minus every known trip's meta ids) so no future
  meta-destroying path can leak again.

## STORAGE-4 — one malformed day in a pre-v5 vault quarantines the entire trip; the same data at v5 loses only that day

- **Severity / confidence:** S2 · confirmed
- **Where:** `core/vault/migrations.ts:53-57` (`(d.items ?? [])` on step 3→4) and `:83-90` (step
  4→5); ordering in `core/vault/load-save.ts:150-158`
- **What breaks:** the migration chain runs BEFORE the per-row-degrading validator.
  `days.map((d) => ({ ...d, items: (d.items ?? []) … }))` throws a `TypeError` on a `null` element
  (`{...null}` is fine, `null.items` is not), so `runItineraryMigrations` throws, `loadItinerary`
  quarantines the whole blob and returns the fallback — the 32-day `SAMPLE_ITINERARY`. The same
  payload stamped `schemaVersion: 5` skips migrations, reaches `parseItineraryPayload`, and loses
  only the bad row. So the #123 "partial beats nothing" rule protects current vaults but not any
  vault still on v2/v3/v4.
- **Trigger:** `localStorage['nepal_japan_itinerary'] = '{"schemaVersion":3,"updatedAt":"x","payload":[null,{"date":"2026-12-10","city":"Kathmandu","country":"nepal","items":[]}]}'`
  then load the app. Precondition: the vault is pre-v5 (a browser that has not opened the app since
  the v5 bump, or a v2/v3 export being imported) AND already carries one malformed row. Same result
  for a bare legacy array `[null, {…}]`, and for any day whose `items` is a non-array.
- **Evidence:** probe against the real `loadPlans()`:

  ```
  v5 -> 1 days; quarantined = false     [vault] itinerary read dropped 1 malformed row(s)
  v3 -> 32 days; quarantined = true     first day = "2026-12-09" New York   (= SAMPLE_ITINERARY)
  v2 -> 32 days; quarantined = true
  ```

- **Root cause:** `parseItineraryPayload` was hardened to degrade per row (#123), but the migration
  steps were left as whole-array `map`s that throw on the first unusable element, and they run first.
  The steps' own header claims "A pure spread-and-default `map` cannot throw on well-formed input" —
  true, and the input class that is not well-formed is exactly the one #123 exists for.
- **Fix:** make each step's `map` skip-safe at the day level —
  `days.filter((d) => d !== null && typeof d === 'object')` before the map in the shared runner
  (`runItineraryMigrations`, `core/vault/migrations.ts:117-134`) rather than in each step, so every
  current and future step inherits it. The dropped row still fails `dayPlanSchema` afterwards and is
  reported by the existing `[vault] itinerary read dropped N malformed row(s)` warning.

## CONTENT-7 / DATES-6 — a custom trip's date span is unbounded, and its dates are never checked for validity

Found independently by the content and dates areas, at the two ends of one chain: the create form
never bounds what it authors, and `sanitizeTripConfig` — the declared trust boundary for a config
block from *any* source — checks date *shape* only. Recorded together.

- **Severity / confidence:** S2 · confirmed for the validator half (CONTENT-7), likely for the
  create-form half (DATES-6, traced and measured but not driven through the UI)
- **Where:** `components/trips-hub.tsx:275-282` (validates only `end < start`) and `:608-638` (the two
  `<input type="date">` carry no `min`/`max`); `core/trips/registry.ts:55` (`ISO_DATE`) and `:64-66`
  (the only date checks) → `core/trips/custom.ts:190-201` (`dateRange`) and `:208-213`
  (`buildDayShells`) → `core/dates/trip-dates.ts:47-56` (`TRIP_DATES`)
- **What breaks:** two distinct downstream failures from one validator.
  - **(a) Unbounded span.** Nothing caps `end - start`. A trip created as `2027-01-05 → 2207-01-05` —
    one digit off in a hand-typed year, which the native date input accepts — makes `TRIP_DATES`
    65,744 entries long. `components/calendar-day-picker.tsx:36-52` renders one `<button>` per entry,
    so the planner tries to mount ~65,750 buttons; `buildDayShells` materialises 4.3 MB of `DayPlan`
    JSON as the itinerary load-time fallback, at or over a typical 5 MB localStorage origin quota
    shared with every other slot. About 15 components `TRIP_DATES.map(...)` into DOM
    (`components/calendar-day-picker.tsx:135`, `components/map-section.tsx:71`,
    `components/add-to-itinerary-dialog.tsx:689`, …), and `reconcileFirstSnapshot` seeds the remote
    with `pushPlans([], localPlans)` — **one Firestore document per day**, against a free-tier 20k
    writes/day ceiling. `core/trips/custom.ts:157` records that this same shell list is what the seed
    branch pushes.
  - **(b) Empty `TRIP_DATES`.** `/^\d{4}-\d{2}-\d{2}$/` accepts `2026-13-45`.
    `new Date('2026-13-45T00:00:00')` is Invalid Date, so the `TRIP_DATES` loop never runs and the
    array is `[]` — the precise state `core/trips/custom.ts:146-149` documents as impossible by
    design ("~15 consumers index `TRIP_DATES[0]` unguarded … a zero-day span would be a fresh crash
    of exactly the class SB-6 fixed").
- **Trigger:** (a) Trips hub → Create a trip → type a start date and an end date with a mistyped year
  → Create. (b) a config block reaching `setTripConfig` from a peer's trip-meta doc
  (`components/itinerary-provider.tsx:245`), the synced trip list, or a hand-edited
  `tripPlannerKnownTrips`, carrying `start: '2026-13-45'`.
- **Evidence:** verbatim `dateRange` + `buildDayShells` + the verbatim `TRIP_DATES` iterator, run
  against the verbatim sanitize gate:

  ```
  TRIP_DATES.length         = 65744
  buildDayShells JSON bytes = 4,339,105
  ```
  ```
  2026-09-01 .. 2226-09-01  accepted=true  days=73049
  2026-09-01 .. 9999-12-31  accepted=true  days=2912200
  2026-13-45: sanitize=true  TRIP_START=Invalid Date  TRIP_DATES.length=0  [0]=undefined
  calendar-day-picker firstDate on empty TRIP_DATES: Invalid Date
  ```

- **Root cause:** `sanitizeTripConfig`'s date rule is a regex plus a lexicographic `end < start`
  compare. It never asks whether the string denotes a real day, and it never bounds the span — while
  every consumer treats the span as a length it can iterate and render. `dateRange`'s `while (d <= end)`
  has no ceiling, and `TRIP_DATES` is computed eagerly at module load, so the cost is paid on every
  page load of that trip.
- **Fix:** two lines in `sanitizeTripConfig`, where all four sources already funnel: reject unless
  `new Date(c.start + 'T00:00:00')` and the same for `end` are valid dates (`!Number.isNaN(+d)`), and
  reject a span over a stated cap (a `TRIP_DAYS_MAX` of ~730 covers any real trip and keeps the
  day-doc seed inside the free tier). Both are drop-the-config, keep-the-entry, the policy this
  function already implements. Cap the span where it is *authored* as well — one guard in
  `components/trips-hub.tsx`'s `create` beside the existing `end < start` check, plus `min`/`max` on
  the two inputs, so the mistake is reported rather than absorbed. A defensive `.slice(0, MAX)` in
  `dateRange` would hide it instead.

## PWA-1 — offline, tapping any in-app link lands on the Home shell at a `/<route>/index.txt` URL

- **Severity / confidence:** S2 · confirmed
- **Where:** `scripts/gen-sw.mjs:930-936` (`normalizePath`) and `:1087-1112` (nav branch); precache
  list built at `scripts/gen-sw.mjs:694-742` — no `.txt` entry. The generated worker (`out/sw.js`, a
  build artifact) carries the same code at `:272-278` and `:429-459`.
- **What breaks:** every navigation in the app goes through `next/link`
  (`components/navbar.tsx:180,205,272`, `components/bottom-tab-bar.tsx:108`, the Home bento tiles).
  Offline, the App Router's RSC fetch for `/<route>/index.txt` fails, Next falls back to a **browser
  navigation to the `.txt` URL itself**, and the worker's nav handler cannot match it — so it serves
  `NAV_FALLBACK`, the Home shell. The user taps "Plan", the address bar reads `…/plan/index.txt`, and
  Home renders. Tapping again repeats it, so offline the UI can never leave Home. Direct
  `page.goto`/home-screen launch still works, which is why the suite is green.
- **Trigger:** install the PWA, load `/trip_planner/` online once, go offline (or launch cold-offline
  from the home screen), tap "Plan" / "Travel" / any bottom-tab item.
- **Evidence:** Next's shipped router chunk in the built output contains
  `(e=new URL(e)).pathname.endsWith("/")?e.pathname+="index.txt":e.pathname+=".txt"` and
  `catch(t){…console.error("Failed to fetch RSC payload for "+e+". Falling back to browser navigation.",t),{flightData:e.toString(),…}}`
  — `e` is already the `.txt` URL when the catch reads it, and a string `flightData` is Next's
  MPA-navigation signal. Running the generated `normalizePath` + `PRECACHE_URLS`:

  ```
  /plan/index.txt  -> normalized /plan/index.txt  precached? false
  /plan/           -> normalized /plan/           precached? true
  any *.txt in precache? false
  ```

  `DECISIONS.md:1423` already names this root cause verbatim ("offline the failed fetch made Next
  hard-navigate to the `.txt` URL, and the SW answered with the nav-fallback Home shell") — but the
  fix landed only for `travel-date-picker`'s `?date=` change, not for route-to-route navigation.
  Blind spot: every `setOffline(true)` navigation under `e2e/` is a `page.goto`
  (`e2e/pwa.spec.ts:727,832,948`, `e2e/pwa-torn-update.spec.ts:86`,
  `e2e/sw-shell-scope.spec.ts:180,254`). No offline test ever clicks a `<Link>`.
- **Root cause:** `buildPrecacheList` never emits the per-route RSC payloads (`out/<route>/index.txt`),
  and `normalizePath` bails on any path containing a `.`, so the `.txt` URL Next hard-navigates to
  matches nothing in the precache.
- **Fix:** two lines, both in `scripts/gen-sw.mjs`. (a) In `normalizePath`, strip a trailing
  `index.txt`/`.txt` before the trailing-slash rule, so the MPA fallback at least resolves to the
  right route shell. (b) Add `rel.endsWith('/index.txt')` to `buildPrecacheList` (+461 KB raw, 19
  files) **and** delete the `_rsc` search param before the `caches.match`/`cacheFirst` lookup in the
  static-asset branch (see PWA-3) — without (b) the soft navigation still hard-reloads even though
  the payload is on disk.
- **What was actually done.** Both halves, in two passes. (a) landed first (D-390, Decision 5) and
  (b) followed once the install cost was re-measured over the wire instead of raw: +69.3 KiB gzipped
  as Pages serves it, on a 1.48 MiB install, with no steady-state device cost because the runtime
  cache already held the same 19 keys after any online browse (D-397). (b) needed one more rule than
  this section names — the `_rsc` strip is not enough for a payload URL that carries a query, because
  Next mutates only the pathname, so a `.txt` key drops its whole search (D-398). The root route's
  payload is `out/index.txt`, which has no directory to end with, so the literal
  `rel.endsWith('/index.txt')` above is one entry short.

## PWA-2 — `activate` deletes every non-allowlisted cache on the whole origin, not just this app's

- **Severity / confidence:** S2 · likely (the code is unambiguous; the impact depends on a sibling
  app existing on the account)
- **Where:** `scripts/gen-sw.mjs:908-915`; generated worker `out/sw.js:252-255`
- **What breaks:** `caches.keys()` is scoped to the **origin**, not the service-worker scope. The live
  app is a Pages *project* page, so `https://powan55.github.io` is shared by every other Pages project
  on that account. On every activation — i.e. every deploy the user accepts — this worker deletes the
  Cache Storage of every sibling app on that origin whose cache name is not one of this app's three. A
  sibling PWA loses its precache with no way to rebuild it: its own worker already ran `install` and
  only repopulates on ITS next version bump.
- **Trigger:** any second Pages project at `powan55.github.io/<other>/` with a service worker; open
  the trip planner, accept an update, then open the other app offline.
- **Evidence:**

  ```js
  const allowlist = new Set([PRECACHE, IMAGES_CACHE, FRANKFURTER_CACHE]);
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => !allowlist.has(k)).map((k) => caches.delete(k)));
  ```

  The comment above it argues the allowlist replaced a "prefix-only filter" in order to garbage-collect
  renamed runtime caches — but the prefix was also the only thing confining the sweep to this app.
- **Root cause:** an allowlist over an origin-wide key space. Renaming a runtime cache is a this-app
  problem; the deletion set was widened to the whole origin to solve it.
- **Fix:** keep the allowlist but re-add the ownership predicate —
  `keys.filter((k) => k.startsWith('trip-') && !allowlist.has(k))`. That still collects a renamed
  `trip-images-v*`/`trip-frankfurter-v*` and still drops the previous `trip-precache-*`, while leaving
  other apps alone.

## REACT-1 — `?focus=` cleanup double-prefixes basePath and navigates the user off /plan to a 404

- **Severity / confidence:** S2 · confirmed
- **Where:** `components/calendar-planner.tsx:927-935`; the offending call is `:932`
- **What breaks:** picking a plan search result in the command palette pushes `/plan/?focus=<id>`. The
  effect that consumes and strips the param calls `router.replace(window.location.pathname)`.
  `window.location.pathname` already contains the basePath, and `next/navigation`'s `router.replace`
  prepends it again — so on the deployed build the app immediately navigates from `/trip_planner/plan/`
  to `/trip_planner/trip_planner/plan/`, which does not exist. The user is thrown off the planner onto
  a not-found page instead of landing on the highlighted item.
- **Trigger:** on the deployed site (`NEXT_PUBLIC_BASE_PATH=/trip_planner`): open the command palette
  (⌘K / Ctrl+K), type a word matching an itinerary item title, press Enter on the result.
  `components/command-palette.tsx:453` pushes `/plan/?focus=<id>`;
  `components/calendar-planner.tsx:932` then replaces to the doubled path. Same outcome whether you
  start on `/plan` or elsewhere.
- **Evidence:** `components/calendar-planner.tsx:932` — `router.replace(window.location.pathname);`.
  `next.config.js` takes `basePath` from `NEXT_PUBLIC_BASE_PATH`, and `.github/workflows/deploy.yml:87`
  sets `NEXT_PUBLIC_BASE_PATH: /${{ github.event.repository.name }}` in the deploy job only — which is
  why e2e and local dev are green: `BASE_PATH` is `''` there and the double-prefix is a no-op. Next's
  app router does `url = new URL(addBasePath(href), window.location.href)`. Every other navigation in
  the repo uses the right convention: `withBasePath(...)` with raw `window.location.*`
  (`components/token-gate.tsx:277,280`, `components/trips-hub.tsx:252`,
  `components/itinerary-provider.tsx:67`), or a basePath-relative literal with `router.*`
  (`components/legacy-hash-redirect.tsx:59`, `components/travel-exit-button.tsx:24`).
  `components/calendar-planner.tsx:932` is the only place that mixes them, and
  `components/travel-date-picker.tsx:117-124` documents this exact class already hit once ("TM-11 real
  defect: `router.replace` made this same-page param change fetch the RSC payload…") and fixed there
  with `window.history.replaceState`.
- **Root cause:** mixing two path conventions in one call — the raw History API path
  (basePath-inclusive) fed into the App Router, which adds basePath itself.
- **Fix:** strip the param without the router, matching `components/travel-date-picker.tsx` and the
  idiom in `components/share-inbox.tsx:90`:
  `window.history.replaceState(null, '', window.location.pathname + window.location.hash)`. That also
  avoids the RSC fetch on a same-page param change. Secondary, same effect: `plans` is missing from the
  dep array behind the `eslint-disable` at `:933` — if the store were ever not hydrated on the first
  `searchParams` value, the item is never found *and* the param is stripped, so nothing retries.

## CONCIERGE-1 — `addItem` ops skip the `notes`/`location` string check that `updateItem` applies, so Confirm writes a corrupt row and silently does nothing

- **Severity / confidence:** S2 · confirmed
- **Where:** `lib/concierge-ops.ts:155-161` (the `addItem` case) vs `:173` (the `updateItem` case); the
  write is `:221-230` (`contentPatch`) → `:238-246` (`itemFromAddOp`) → `:407-414` (`applyOp`)
- **What breaks:** `dropReason`'s `updateItem` branch rejects a non-string `notes`/`location` with
  `'unreadable'`. The `addItem` branch checks only `date`, `title` and `category` — `notes` and
  `location` are never type-checked on that verb. An op carrying `notes: {…}` or `location: 5` passes
  `validateOps`, renders a normal-looking chip, and on Confirm `applyOp` copies the value verbatim into
  the new `ItineraryItem`. `saveItinerary` (`core/vault/load-save.ts:179-195`) does no write-side
  validation, so the corrupt row lands in localStorage and is handed to `sync.push(prev, next)`
  (`hooks/create-reactive-store.ts:126-131`) for Firestore. The read boundary then drops it:
  `itineraryItemSchema` declares `notes: z.string().optional()` / `location: z.string().optional()`, so
  `sanitizeItineraryItem` returns `null`. Because `commit()` dispatches `itinerary:changed`
  synchronously right after `setValue(next)`, the store's own listener re-reads through
  `storage.load()` in the same tick and the item is gone before it ever renders. Net user experience:
  the undo toast says `Added "Ramen"`, and nothing is added, anywhere.
- **Trigger:** a reply of
  `{"reply":"…","ops":[{"type":"addItem","date":"2026-12-09","title":"Ramen","category":"food","notes":{"a":1}}]}`
  → press Confirm on the chip. A numeric `location` does the same.
- **Evidence:** run against the real modules:

  ```
  WRITTEN ITEM = {"id":"…","title":"Ramen","category":"food","notes":{"toString":1,"nested":[[1,2]]},"location":12345}
  TOAST = Added “Ramen”
  SANITIZED = null      // sanitizeItineraryItem(written)
  ```

  and the mirror case `dropReason({type:'updateItem', itemId:'live-1', notes:{a:1}}, PLANS) === 'unreadable'`
  passes. `lib/__tests__/concierge-ops.test.ts:219` covers the `updateItem` half only; there is no
  `addItem` equivalent.
- **Root cause:** the per-field content typing lives inside the `updateItem` loop over `CONTENT_KEYS`
  instead of running once for every verb that can carry content. `addItem` reaches `contentPatch`
  through a different branch that never runs that loop.
- **Fix:** hoist the `CONTENT_KEYS` type loop out of the `updateItem` case in `dropReason` and run it
  for both `addItem` and `updateItem`, keeping the `patchCount`/Rule-8 accounting inside `updateItem`.
  One guard in `dropReason` covers `validateOps`, `isValidOp`, `clashForOp` and `applyOp`, since all
  four route through it.

## CONCIERGE-4 — the 45 s abort ceiling does not cover the auth await, so a stalled token refresh pins the panel in `streaming` forever

- **Severity / confidence:** S2 · likely (traced; only reachable on a configured deployed build, which
  is also why no spec can catch it)
- **Where:** `hooks/use-concierge-chat.ts:378` (`const auth = await workerAuthHeader();`) vs `:393`
  (`signal: AbortSignal.timeout(CHAT_TIMEOUT_MS)`), `:352` and `:452-454` (`sendingRef`),
  `lib/worker-auth.ts:30-31`
- **What breaks:** `CHAT_TIMEOUT_MS` exists because "without it a hung upstream pinned the UI in its
  (misnamed) 'streaming' state forever with no way out" (`:92-99`). But the signal is constructed
  inside the `fetchImpl(...)` call, and two unbounded awaits run before it:
  `await import('./itinerary-remote')` (a lazy chunk fetch, with no timeout available on dynamic
  import) and `await auth.currentUser?.getIdToken()` (a token refresh when the cached token has
  expired, with no timeout). If either stalls rather than rejecting, `send()` never settles, so
  `finally` never runs: `status` stays `'streaming'`, `sendingRef.current` stays `true`, the send
  button stays disabled, `error` stays `null` so the "Try again" row never renders, and the assistant
  bubble stays on `…`. Only a reload recovers. This is the scenario the surrounding comments call the
  normal case — "foreign mobile data", "captive portal".
- **Trigger:** deployed build with Firebase configured, an expired ID token, and a connection that
  black-holes rather than resets (captive portal, dead cell handoff while `navigator.onLine` is still
  true). Open the concierge, send a message.
- **Evidence:** `hooks/use-concierge-chat.ts:371-394` —
  `try { const context = buildTripDigest(); const trip = buildTripDescriptor(); const auth = await workerAuthHeader(); const res = await fetchImpl(CONCIERGE_URL, { … signal: AbortSignal.timeout(CHAT_TIMEOUT_MS) });`.
  `lib/worker-auth.ts:29-35` catches rejections but cannot catch a pending promise.
  `lib/__tests__/use-concierge-chat.test.ts:44-50` mocks `workerAuthHeader` as an immediately-resolving
  async function, so the whole pre-fetch window is untested.
- **Root cause:** the abort ceiling was scoped to the `fetch` rather than to the turn.
- **Fix:** build one signal at the top of `send` (`const signal = AbortSignal.timeout(CHAT_TIMEOUT_MS);`),
  pass it to `fetchImpl`, and race it against the auth await — e.g.
  `const auth = await Promise.race([workerAuthHeader(), new Promise<Record<string,string>>((r) => signal.addEventListener('abort', () => r({})))]);`.
  Degrading to no header on a slow token is already the documented behaviour of `workerAuthHeader`'s
  catch, so an empty header is the correct fallback.

## A11Y-1 — reduced motion silently removes the camera offset that keeps map-popup controls reachable

- **Severity / confidence:** S2 · confirmed
- **Where:** `components/trip-map.tsx:618-625` (guard), call sites `:929` (marker click) and `:953`
  (itinerary-stop click); the correct form is 20 lines below at `:640-642`
- **What breaks:** a user with `prefers-reduced-motion: reduce` who taps a map pin near the top of the
  map shell gets a popup whose top controls — the favourite heart and MapLibre's close button — are
  clipped by the shell's `overflow-hidden` and/or sit under the fixed navbar band, where (per the
  code's own comment) they are click-intercepted. Every other user gets a camera nudge that guarantees
  the popup opens fully in-shell. This is not "less motion": the reduced-motion path loses
  functionality the default path has.
- **Trigger:** OS "Reduce motion" on → `/map/` → tap any pin drawn near the top of the map area (or
  `/plan/` → tap a drawn itinerary stop near the top). With Reduce motion off, the camera first eases
  the marker 150 px below centre.
- **Evidence:**

  ```
  618      if (!prefersReducedMotion()) {
  619        // seat the marker BELOW the container centre so the popup (anchored
  623        // heart) above the shell/under the navbar, where they were click-intercepted.
  624        map.easeTo({ center: [marker.lng, marker.lat], offset: POPUP_VIEW_OFFSET, duration: 400 });
  625      }
  ```

  The sibling `focusMarker` proves the right shape was known and applied there only: `:640` — "easeTo
  (duration:0) is an instant jump that ALSO honours offset (jumpTo does not), so the marker lands
  below-centre and the popup opens in-shell" → `:642`
  `map.easeTo({ ..., offset: POPUP_VIEW_OFFSET, duration: 0 })`.
  `grep -n "openPopup(" components/trip-map.tsx` → `643, 646, 929, 953`; `929` and `953` are the raw
  canvas click handlers, which reach `openPopup` with no camera move of their own.
- **Root cause:** `POPUP_VIEW_OFFSET` is a *layout* correction implemented inside a *motion* branch.
  Gating it on `prefersReducedMotion()` throws away the layout fix along with the animation.
- **Fix:** in `openPopup`, do not skip the call — pick the duration, exactly as `focusMarker` does:
  `map.easeTo({ center: [marker.lng, marker.lat], offset: POPUP_VIEW_OFFSET, duration: prefersReducedMotion() ? 0 : 400 })`.
  One line, and it fixes both click paths at once because both route through `openPopup`.

## CONTENT-1 — `/map/` shows the 27 curated Nepal/Japan pins (and flies the camera to them) on every custom trip

- **Severity / confidence:** S2 · confirmed
- **Where:** `components/map-section.tsx:278-284` (`visibleMarkers`), `:1315`
  (`markers={visibleMarkers}`), `:685` (masthead copy); `components/trip-map.tsx:119-127` (camera
  refits to `markers`)
- **What breaks:** `/map/` is one of only four primary tabs on a custom trip
  (`primaryItemsForActiveTrip()` yields Today · Plan · Map · Journal). It renders `MAP_MARKERS` — 27
  hard-coded Nepal/Japan places from `lib/map-data.ts` — with no trip gate, fits the camera to them,
  and captions the section "every place across the Kathmandu Valley and Japan". A user planning Peru
  opens their Map tab onto Kathmandu and Tokyo.
- **Trigger:** create a trip on `/trips/` (destinations "Cusco, Lima"), land on Home, tap the Map tab.
  All 27 pins are drawn and the initial fit spans Nepal→Japan.
- **Evidence:** no trip gate exists in either file —
  `grep -n "isDefaultTrip\|getActiveTrip" components/map-section.tsx components/trip-map.tsx` returns
  nothing. The filter is category-only:

  ```
  278:  const visibleMarkers = useMemo(() => {
  280:      filter === 'All' ? MAP_MARKERS : MAP_MARKERS.filter((mk) => mk.category === filter);
  ```

  `components/trip-map.tsx:119-121` states the camera behaviour: "the marker-fit effect below (deps:
  markers/mapReady/fitBounds, and `fitBounds` defaults true) refits the camera to the visible markers".
- **Root cause:** `MAP_MARKERS` is default-pack *content* consumed as if it were app chrome. Every
  other Nepal×Japan content surface got a gate (`DefaultTripOnly` on `/nepal/`, `/japan/`, `/guides/`,
  `/flights/`, Home's chapters and inspiration; `defaultTripOnly` in `lib/nav-items.ts`;
  `DEFAULT_TRIP_ONLY_ROUTES` in the command palette). The map was missed, and because Map is *not* a
  `defaultTripOnly` nav item it is still promoted to a primary seat on custom trips.
- **Fix:** gate the curated set at the one place it enters the component:
  `const CURATED = isDefaultTrip() ? MAP_MARKERS : []` behind the existing post-mount gate, which also
  empties `CURATED_HITS`/`savedCount`/the filter chips for free. `ALL_BOUNDS` already documents itself
  as the empty-marker frame, so a custom trip falls back to it and the itinerary-overlay stops (the
  only trip-real pins) still drive the camera.

## CONTENT-2 — `/safety/` serves Nepal/Japan emergency numbers and a Nepali/Japanese phrasebook as *your* trip's safety kit, un-gated

- **Severity / confidence:** S2 · confirmed
- **Where:** `lib/nav-items.ts:74`, `app/safety/page.tsx` (no `DefaultTripOnly`),
  `components/travel-safety-kit.tsx:35`
- **What breaks:** on a custom trip the More page still lists "Safety", and the page renders "Emergency
  and embassy numbers … works offline once loaded" over Nepal Police 100 / Japan 110 /
  Kathmandu-embassy switchboards and a Nepali/Japanese phrasebook. This is the one surface whose
  content is explicitly flagged safety-critical (`core/content/safety.ts:16-29`), and it is presented
  as belonging to the active trip.
- **Trigger:** active custom trip → `/more/` → "Safety" (or type `/safety/`). Every contact shown is
  `country: 'Nepal' | 'Japan'`.
- **Evidence:**

  ```
  lib/nav-items.ts:74:  { label: 'Safety', href: '/safety/', icon: ShieldCheck, primary: false },
  components/travel-safety-kit.tsx:35:  {(['Nepal', 'Japan'] as const).map((country) => (
  ```

  — no `defaultTripOnly: true`, so `navItemsForActiveTrip()` keeps it, and the kit hard-codes the two
  countries. `grep -rl DefaultTripOnly app components` lists only `flights`, `guides`, `japan`,
  `nepal`, `page.tsx`, `more-list`, `custom-trip-my-places` — `app/safety/` is absent.
- **Root cause:** the A-15/#102 sweep that gave the other Nepal×Japan templates a custom-trip path
  (`core/docs/model.ts:88-98` `UNIVERSAL_TEMPLATE`, `core/packing/storage.ts:20-24` universal-only
  fallback) did not reach `/safety/`, and `lib/nav-items.ts` never got the flag.
- **Fix:** two one-liners — add `defaultTripOnly: true` to the Safety entry in `lib/nav-items.ts`
  (which also drops it from `/more/` and the palette via the existing filters), and wrap `<SafetyKit />`
  in `DefaultTripOnly` in `app/safety/page.tsx` so a typed URL gets the honest empty state instead of
  another country's emergency numbers.

## CONTENT-3 — a custom trip created without destinations writes its NAME into the permanent lifetime "cities visited" record

- **Severity / confidence:** S2 · confirmed
- **Where:** `components/trips-hub.tsx:291` → `core/trips/custom.ts:105` →
  `lib/visit-autocount.ts:80-84,162`
- **What breaks:** the Destinations field is optional and documented as defaulting to the trip name.
  That name becomes `destinations[0]`, which becomes the leg's `fallbackCity`, which `getCityForDate`
  returns for every day of the trip, which `runVisitAutocount` writes into `tripPlannerLifetimeVisits`
  (gateway key 32) on the next page load. So a trip called "Kerala 2027" or "Mum's 60th" is recorded
  forever as a city the user has visited — in a record that sits outside the trip namespace and outside
  `wipeAllTripData()` by design (D-314), survives sign-out, and cannot be reconstructed once displaced.
- **Trigger:** `/trips/` → Create a trip, name it, leave Destinations blank, leave dates blank
  (defaults to today..today+30). Reload. `/profile/` and `/passport/` now list the trip name under
  cities. Removing it via `/profile/` does not stick while the trip exists.
- **Evidence:** the chain, verbatim:

  ```
  trips-hub.tsx:291        destinations: destinations.length > 0 ? destinations : [name],
  core/trips/custom.ts:105        fallbackCity: c.destinations[0],
  lib/visit-autocount.ts:80-84    const city = getCityForDate(date).trim(); … places.push({ city, country: countryLabelForDate(date) });
  lib/visit-autocount.ts:162      for (const place of tripPlacesThrough(today)) addVisit(place);
  ```

  The default span starts *today*, so `date <= throughISO` matches on the very first load after
  creation. `tidyPlaceName` does not reject it (name is capped at 40 chars, `PLACE_NAME_MAX` is 80).
  `core/places/visited.ts:220-224` states the removal ceiling: "a city or country the ACTIVE TRIP
  itself passes through comes back on the next visit count".
- **Root cause:** `destinations` is doing double duty — a display list *and* the per-day city identity
  — and the create form's convenience default silently promotes a trip title into the city slot. Same
  class as the A-28 defect `PLACEHOLDER_CITY` was introduced to stop
  (`core/trips/custom.ts:118-130` calls out stamping `'Somewhere'` into that permanent record as the
  bug); the *configured* path still does it.
- **Fix:** do not fall back to the trip name for `destinations` at `components/trips-hub.tsx:291` —
  leave the config's `destinations` empty and let `customTripConfig` use the same honest
  `PLACEHOLDER_CITY` stand-in it already uses for a config-less trip. `sanitizeTripConfig` currently
  rejects an empty `destinations` array, so the smaller change is to make the Destinations field
  required in the create form.

## CONTENT-5 — `#constructor` (or any `Object.prototype` key) as a legacy hash crashes Home into the error boundary

- **Severity / confidence:** S2 · confirmed
- **Where:** `components/legacy-hash-redirect.tsx:37-45` (`ROUTE_REDIRECTS` object literal), `:57-64`
  (bare index read and dereference)
- **What breaks:** `ROUTE_REDIRECTS[hash]` on a plain object literal returns a non-nullish value for a
  prototype key name, so the truthiness guard passes with a *function* (or `Object.prototype`) as
  `target`. `router.replace(target)` is called with a non-string, then `target.indexOf('#')` throws
  `TypeError: target.indexOf is not a function` inside Home's `useEffect` — the whole Home route falls
  to `app/error.tsx`, with no in-page recovery except editing the URL.
- **Trigger:** open the site with `#constructor` (also `#__proto__`, `#toString`, `#valueOf`,
  `#hasOwnProperty`). `LegacyHashRedirect` is rendered eagerly on Home (`app/page.tsx`), so no scroll
  or interaction is needed.
- **Evidence:** the exact literal and lookup, run out of the file:

  ```
  #constructor: truthy=true typeof=function | THROWS: TypeError: target.indexOf is not a function
  #__proto__:   truthy=true typeof=object   | THROWS: TypeError: target.indexOf is not a function
  #toString:    truthy=true typeof=function | THROWS: TypeError: target.indexOf is not a function
  ```

- **Root cause:** the D-307 defect class the repo has already fixed at five sibling sites with the
  own-key idiom (`core/trips/index.ts:53`, `core/dates/trip-cities.ts:88`, `lib/leg-label.ts:62-65`,
  `lib/city-coords.ts:63`, `core/budget/model.ts:165`). This lookup was never swept.
- **Fix:** same one-line idiom as the five siblings:
  `const target = Object.prototype.hasOwnProperty.call(ROUTE_REDIRECTS, hash) ? ROUTE_REDIRECTS[hash] : undefined;`.

## CONTENT-6 — "Forget trip" is silently undone by any other device still sitting on that trip

- **Severity / confidence:** S2 · likely (traced end to end in source, not reproduced against a live
  Firestore)
- **Where:** `core/trips/registry.ts:213-223` (`listKnownTrips` self-heal write), `:183-185`
  (`entryRecency`), `:360-366` (tombstone application); `lib/trips-remote.ts:417-435` (`pushTripList`
  reads through `listKnownTrips()`)
- **What breaks:** `removeKnownTrip` only moves the *local* active pointer off the forgotten trip. On a
  second device whose active pointer is still that trip, the incoming tombstone drops the entry from
  the stored list but leaves the pointer alone. The next `listKnownTrips()` call then self-heals it
  back in with a fresh `Date.now()` `joinedAt`, `entryRecency > removedAt`, and `mergeTripLists`
  responds by deleting the tombstone and re-pushing the trip — so the trip reappears on the device that
  forgot it. As a side effect the second device's entry is rebuilt as `'Shared trip'` with **no config
  block**, so until the trip-meta self-heal refetches it, that device's active trip resolves to the
  one-day 2099 placeholder (`customTripConfig` → `placeholderTripConfig`).
- **Trigger:** devices A and B both on trip X (same user token). B stays on X. On A: `/trips/` → Forget
  X → confirm. Reload B. Reload A: X is back in the list.
- **Evidence:** the resurrection is a write inside a read:

  ```
  registry.ts:215  if (active !== DEFAULT_TRIP_ID && !readStored().some((t) => t.id === active)) {
  registry.ts:216    upsertKnownTrip(active, SHARED_NAME); // self-heal: persist the pre-registry trip
  registry.ts:258    stored.push({ id, name: name_, joinedAt: Date.now() });
  ```

  and `pushTripList` feeds that result straight into the merge, where a fresher stamp discards the
  tombstone:

  ```
  registry.ts:364      if (entryRecency(entry) > removedAt) tombstones.delete(id); // re-join beats a stale tombstone
  trips-remote.ts:426  mergeTripLists(listKnownTrips(), docToTrips(data), listRemovedTrips(), docToRemoved(data))
  ```

- **Root cause:** the tombstone rule treats "a fresh `joinedAt`" as proof of a deliberate re-join, but
  `listKnownTrips`' self-heal mints one automatically whenever the active pointer names a trip the list
  lacks — which is exactly the state a remote forget creates. The pointer and the list are allowed to
  disagree.
- **Fix:** make the forget move the pointer wherever it lands. In `importRemoteTrips`
  (`core/trips/registry.ts:382-392`), after `writeStored`, if `getActiveTripId()` is no longer in the
  merged list *and* is tombstoned, `setActiveTripId(DEFAULT_TRIP_ID)` — the same thing `removeKnownTrip`
  already does locally. That removes the state the self-heal reacts to, so no second guard is needed.

---

# S3

## SYNC-5 — four of the five hooks gate tombstoning on the app-wide config, so the never-syncing default pack accumulates tombstones nothing collects

- **Severity / confidence:** S3 · confirmed
- **Where:** `hooks/use-itinerary.ts:106-108`, `hooks/use-expenses.ts:114-116`,
  `hooks/use-docs.ts:66-68`, `hooks/use-budget.ts` (all `syncEnabled() { return isRemoteConfigured(); }`)
  vs `hooks/use-my-places.ts:78-80` (`return isTripRemoteConfigured();`)
- **What breaks:** on the live build (Firebase env present) the DEFAULT pack has no remote path at all —
  `getTripId()` returns `''` and `isTripRemoteConfigured()` is false (#10,
  `lib/firebase-config.ts:67-84`). But `syncEnabled()` is true there, so on the sample trip:
  `removeItem`/`removeExpense` write **tombstones** instead of removing, `restoreItem` mints a **fresh
  id** and rewrites `createdBy` to the current user, and a cross-day `moveItem` mints a fresh id.
  Nothing ever collects those tombstones: the only two GC boundaries are `gcTombstones` inside
  `pushDayMerged`/`applyRemoteMerged` (`lib/itinerary-remote.ts:490`, `:667`) and `gcTombstoneRows`
  inside `pushChunkMerged`/`applySnapshot` (`lib/expenses-remote.ts:95`, `:187`) — all four sit behind
  `isTripRemoteConfigured()` and never run on the default pack. So the itinerary and expenses slots
  grow monotonically with every delete and never shrink.
- **Trigger:** on the live site with the default (sample) trip active: delete an itinerary item → it is
  still in `localStorage['nepal_japan_itinerary']` as `deleted:true` and will never be removed. Delete
  it and undo → the restored item has a different `id` and `createdBy` is now you.
- **Evidence:** `lib/firebase-config.ts:79-81` states the rule this violates verbatim: *"Every module
  that composes `doc(db, 'trips', getTripId(), …)` must gate on THIS, not on `isRemoteConfigured()`."*
  `hooks/use-my-places.ts:24` follows it; the other four do not:

  ```
  hooks/use-itinerary.ts:107:  return isRemoteConfigured();
  hooks/use-expenses.ts:115:   return isRemoteConfigured();
  hooks/use-docs.ts:67:        return isRemoteConfigured();
  hooks/use-my-places.ts:79:   return isTripRemoteConfigured();
  ```

- **Root cause:** these four hooks predate #10, which retired the default pack's remote id and split
  `isRemoteConfigured()` into an app-wide and a trip-scoped gate. `use-my-places` was written after the
  split and got the right one; the older four were never re-pointed.
- **Fix:** change the four `syncEnabled()` bodies to `isTripRemoteConfigured()` — one line each, same
  import module. That restores physical deletes and same-id undo on the local-only sample, and makes
  all five domains agree on one gate. Check `lib/__tests__/settings-clear-all.test.ts`'s DORMANT
  assertions while there; they already describe the intended behaviour.

## STORAGE-5 — `readJson` has no shape gate, so a slot holding JSON `null` throws out of the never-throw gateway and crashes Home's render

- **Severity / confidence:** S3 · confirmed (behaviour proven; the trigger requires a slot written by
  something other than the app)
- **Where:** `core/storage/gateway.ts:796-804` (`readJson`), dereferenced unguarded at `:931-941`
  (`weatherCache.get`/`set`) and at `core/sync/outbox.ts:84-93` (`loadSlot`, whose
  `typeof raw.dirty !== 'object'` guard passes for `null`)
- **What breaks:** `readJson` returns `JSON.parse(raw) as T` with no shape check — the `fallback` is
  used only for an absent key or a *parse* failure, so a stored literal `null` (or `5`, or `"x"`) is
  handed straight back typed as the caller's `T`. `weatherCache.get` then calls
  `Object.prototype.hasOwnProperty.call(null, city)` and `weatherCache.set` does `null[city] = value`,
  both `TypeError`. That violates the module's stated absolute invariant ("The gateway NEVER throws to
  a caller", `core/storage/gateway.ts:23-27`) and escapes: `getCachedForecastForDate`
  (`lib/weather.ts:392-396`) is unguarded and is called during render at `components/home-bento.tsx:92`,
  so Home hits its error boundary. `fetchWeather`'s catch block also calls `readCache`
  (`lib/weather.ts:437`), so the "total and never-throws" claim there fails too. `outboxDirty` /
  `saveSlot` have the same hole via `dirty: null`.
- **Trigger:** `localStorage.setItem('nepal_japan_weather_cache', 'null')` then load Home. No in-app
  writer for that value was found — `weatherCache.set` always writes an object and `writeString` never
  partially writes — so the realistic sources are devtools, another script on the origin, or a
  corrupted profile. The `core/sync/outbox.ts` sibling (`{"version":1,"dirty":null}`) has the same
  reachability profile.
- **Evidence:** probe against the real gateway:

  ```
  weatherCache.get err = TypeError: Cannot convert undefined or null to object
  weatherCache.set err = TypeError: Cannot set properties of null (setting 'Kathmandu')
  ```

- **Root cause:** the gateway's never-throw contract is enforced only around the storage call itself,
  not around the shape of what came back. Every other accessor happens to hand the parsed value to a
  domain sanitizer that is total; `weatherCache` and `outbox.loadSlot` are the two that dereference it
  directly.
- **Fix:** one guard in the shared primitive: in `readJson`, return `fallback` when
  `typeof parsed !== typeof fallback` or when `parsed === null && fallback !== null`. Both dereferencing
  accessors and any future one route through it, so no per-caller guard is needed.

## DATES-1 — two disagreeing "today" clocks: the trip day rolls over at Nepal's midnight while every countdown / flight / budget surface uses the device's

- **Severity / confidence:** S3 · confirmed
- **Where:** `lib/trip-now.ts:158-164` (`tripOffsetMinFor`) and `:178-181` (`getTodayInTrip`), against
  `core/dates/trip-dates.ts:37` (`TRIP_START = new Date(activeTrip.start + 'T00:00:00')` — **device**
  local midnight) and `lib/flight-phase.ts:36-41` (device-local day compare)
- **What breaks:** `getTodayInTrip()` derives the trip day at the destination leg's fixed offset (NPT
  +345 pre-trip, since `legs[0]` is Nepal), but `TRIP_START`, `getFlightTiming`,
  `elapsedInclusiveDays` and the story-recap gate all use the device's own calendar. For a traveller in
  New York the two answers differ by **10 h 45 min**. On 2026-12-08 at 13:15 EST the hero swaps its
  countdown grid for the "Day 1 — New York" panel, `home-stat-row` flips to "Day 1 / Day on trip",
  `/travel` jumps to Dec 9, the preflight clock row flips from "Phone is on home time" (ok) to **"Phone
  isn't on trip time" (attention)**, and `visit-autocount` starts asking for a geolocation fix — while
  the phone still reads Dec 8, the Flights card still says the JFK flight is 10 h away, and the budget
  panel still says the trip has not started. The same gap runs the other way at the end: at 10:00 EST
  on Jan 9, while the traveller is still mid-flight on Day 32, `getTodayInTrip()` goes null and
  `isPostTrip(getNowAtTrip().date)` goes true, so the hero flips to the post-trip state on the last day
  of the trip.
- **Trigger:** device TZ `America/New_York`, real clock, no `?today=`. Instant `2026-12-08T18:15:00Z`.
  Second instant: `2027-01-09T15:00:00Z`.
- **Evidence:** transcriptions of `legForDate`, `utcDayAtOffset`, `dayInTripFor`, `tripOffsetMinFor`
  and `getFlightTiming`, run under `TZ=America/New_York`:

  ```
  2026-12-08T18:14:00Z | device local: Dec 08, 13:14 | getTodayInTrip: null       | flightPhase(2026-12-09): upcoming | countdown: 0d 10h 46m
  2026-12-08T18:15:00Z | device local: Dec 08, 13:15 | getTodayInTrip: Day 1 (2026-12-09) | flightPhase(2026-12-09): upcoming | countdown: 0d 10h 45m
  2027-01-09T15:00:00Z | device local: Jan 09, 10:00 | getTodayInTrip: null       | flightPhase(2026-12-09): completed | countdown: PAST/zero
  ```

  The `?today=` boundary matrix in e2e cannot see this: `getTodayInTrip` passes `null` for the offset
  whenever an override is active (`lib/trip-now.ts:180`), so every frozen boundary spec runs the
  **device-local** branch, and the offset branch is only ever exercised by
  `lib/__tests__/core-clock.test.ts:181-208`, which calls `dayInTripFor` directly and never crosses it
  with `TRIP_START`.
- **Root cause:** two independent definitions of "today" with no shared seam. `dayInTripFor(now, offsetMin)`
  re-derives the calendar day at the *destination's* fixed offset even before departure, when the
  traveller is provably still at the origin — and `TRIP_START`/`getFlightTiming`/burn-rate never got the
  same treatment. The write paths inherit it: `components/expense-log-host.tsx:59` and
  `components/quick-add-fab.tsx:82` both default a new row's `date` to `getTodayInTrip()?.date`, so an
  expense logged at 1:15 pm on Dec 8 is **stored** as 2026-12-09.
- **Fix:** one predicate, not two. Either (a) seed `tripOffsetMinFor` with the *device* offset until the
  first leg's start day has actually begun on the device — treating the pre-departure window as
  origin-local, which is what `lib/preflight.ts:263-265` already asserts is the normal state — or (b)
  leave the day math alone and move `TRIP_START`/`getFlightTiming`/`elapsedInclusiveDays` onto the same
  offset, so at least nothing contradicts itself. `lib/trip-now.ts` is the single place all of it can
  route through; `TRIP_START` is the constant that has to stop being device-local for (b).
- **What was actually done.** (a), in a narrower form than proposed: the guard is in
  `getTodayInTrip()` rather than in `tripOffsetMinFor`'s seed. Window MEMBERSHIP comes from the device
  calendar and the day NUMBER from the destination offset, falling back to the device answer when the
  offset lands outside the window. Re-seeding `tripOffsetMinFor` was rejected because
  `lib/preflight.ts:316` is a third caller and a `null` from it turns a correct "Phone is on home
  time" row into a false "Couldn't compare — this trip has no time zone set". (b) was rejected
  outright: `Journey.departDate` is authored in the departure airport's zone, so moving flight timing
  onto the destination offset would announce "Departing today" roughly sixteen hours early. Ruled on
  in **`DECISIONS.md` D-396**.
- **Still present, and named there as a second copy:** `lib/preflight.ts:324` derives its own `onTrip`
  from `dayInTripFor(real, tripOffsetMin)` — the destination offset alone — so the preflight clock-row
  symptom listed above (it flips from "Phone is on home time" to "Phone isn't on trip time" at 13:15
  EST on Dec 8) is NOT covered by this fix. Whether preflight's "on trip" should mean the same thing
  as the hero's is its own decision and has not been taken.

## DATES-2 — `/travel`'s first paint reads its own "not yet loaded" sentinel as a real clock and renders "Trip starts in 20797 days"

- **Severity / confidence:** S3 · confirmed
- **Where:** `components/travel-date-picker.tsx:91` (`useState<number>(0)`), `:111-115`
  (`now: new Date(nowMs)`), `:174-180` (the notice) → `lib/travel-date.ts:68-83`
- **What breaks:** `nowMs` starts at `0` and is only filled by a post-paint effect. `resolveTravelDate`
  has no "unknown clock" state, so it reads `new Date(0)` (1970-01-01) as a legitimate reading, takes
  the `now < TRIP_START` pre-trip branch, and returns `date: TRIP_DATES[0]` with
  `daysUntilStart: 20797`. The first painted frame of `/travel` is therefore "Trip starts in 20797
  days" with Dec 9's hero, agenda, map and Essentials mounted underneath — and this happens *even
  mid-trip*, because `todayInTrip` also starts `null`.
- **Trigger:** navigate to `/travel` (no `?date=`) on any device, any clock. The island is
  `dynamic(..., { ssr: false })` (`app/travel/sections.tsx:14`), so its chunk resolves long after
  `ItineraryProvider` has flipped `hydrated`, which means the `if (!hydrated) return skeleton` guard at
  `:99` is already false on render 1.
- **Evidence:** `TZ=America/New_York`:

  ```
  now = Wed Dec 31 1969 19:00:00 GMT-0500
  now < TRIP_START ?  true
  daysUntilStart   =  20797
  ```

  No test can catch it: `lib/__tests__/travel-date.test.ts` only drives the pure function with real
  dates, and the e2e assertion is `toContainText(/Trip starts in \d+ days?/)`
  (`e2e/travel-date.spec.ts:114`) — which "20797 days" satisfies.
- **Root cause:** `0` is used as a sentinel for "the clock has not been read yet" but is passed to a
  function whose contract is "a real instant". `todayInTrip` has a proper `null` sentinel; `nowMs` does
  not.
- **Fix:** `useState<number | null>(null)` and hold the skeleton while `nowMs === null` — the component
  already returns a skeleton for `!hydrated`, so it is a one-line `if (!hydrated || nowMs === null)`.
  Cheaper alternative: seed the initializer with `getNow().getTime()`, the same lazy-initializer
  pattern `components/hero-section.tsx:173` and `components/home-stat-row.tsx:94` already use for
  exactly this reason.

## DATES-4 — the 7-day weather outlook labels rows by array position, so a cached forecast calls an arbitrarily old day "Today"

- **Severity / confidence:** S3 · confirmed
- **Where:** `components/weather-card.tsx:49-51`
  (`if (index === 0) return 'Today'; if (index === 1) return 'Tomorrow';`) and `:113-115` (`index={i}`),
  fed by `lib/weather.ts:378-383` (`readCache`) over `core/storage/gateway.ts:931-940`
- **What breaks:** `formatDayLabel(date, index)` receives the row's real ISO date and **ignores it** for
  rows 0 and 1. `readCache` returns whatever forecast window was last stored for that city with
  `stale: true`, and `weatherCache` has **no TTL** — `get`/`set` are a plain JSON map with no timestamp
  check. So the moment a fetch fails (offline, which is a designed-for state in this PWA; a non-200; or
  an unparsable body — all three funnel to `readCache` at `lib/weather.ts:437-438`) the outlook renders
  the last cached seven days with row 0 labelled "Today" and row 1 "Tomorrow" no matter how old they
  are. Rows 2-6 read their real weekday from `day.date`, so the same list is internally contradictory:
  "Today / Tomorrow / Sat / Sun …" where Saturday is three days *before* "Today".
- **Trigger:** load the app once with network (weather for the current city caches). Go offline. Come
  back one or more days later, open the Today panel / Travel Essentials, expand "7-day outlook".
- **Evidence:** the only staleness signal is at card level and never on the rows —
  `components/weather-card.tsx:89` renders "Offline — last updated {formatWeatherAsOf(data.fetchedAt)}"
  outside the `<details>`, and `ForecastOutlook`'s own `stale` prop is spent on an `sr-only` "(cached —
  offline)" in the summary (`:105`). Nothing reaches `ForecastRow`, whose props are `{ day, index }`
  only.
- **Root cause:** positional labelling of dated data. `index` is a proxy for "is this day today", and
  the proxy is only valid on a fresh response.
- **Fix:** label from the date, not the index. `formatDayLabel(day.date, todayISO)` where `todayISO` is
  the destination-local day the card already resolves (`getNowAtTrip().date`, or the `date` prop the
  Essentials card is given): `date === todayISO ? 'Today' : date === tomorrow ? 'Tomorrow' : weekday`.
  The `index` parameter then goes away and `ForecastRow` stops needing it.

## DATES-5 — Home's live cell reads "0 Days to go" for most of the day before departure

- **Severity / confidence:** S3 · confirmed
- **Where:** `components/home-stat-row.tsx:84-88`
  (`value: String(computeCountdown(TRIP_START, now).totalDays)`, caption `'Days to go'`), against the
  fix at `lib/travel-date.ts:73-81`
- **What breaks:** `totalDays` is a truncated whole-day count, so it drops to 0 as soon as fewer than
  24 h remain. Home's stat row therefore reads "**0** / Days to go" from just after midnight on Dec 8
  until `getTodayInTrip()` flips — while `/travel`, on the same device at the same instant, reads "Trip
  starts in **1** day". `lib/travel-date.ts:73-79` documents this precise reading as wrong and fixes it
  with `differenceInCalendarDays`; `components/home-stat-row.tsx` was never brought along. This is the
  A-23 defect, still live one file over.
- **Trigger:** device clock anywhere on 2026-12-08 after 00:00 local, Home screen. On an
  `America/New_York` device the window is 00:01 → 13:15 EST, ~13 h, after which DATES-1's early flip
  takes over and the cell shows "Day 1" instead.
- **Evidence:** both producers side by side:

  ```
  Dec 8 00:00  Home stat row: "1 Days to go"   /travel: "Trip starts in 1 day(s)"
  Dec 8 06:00  Home stat row: "0 Days to go"   /travel: "Trip starts in 1 day(s)"
  Dec 8 23:00  Home stat row: "0 Days to go"   /travel: "Trip starts in 1 day(s)"
  ```

- **Root cause:** `totalDays` answers "how many whole 24 h blocks fit before the target", which is not
  the question "how many sleeps until the trip". D-313 is explicit that `totalDays` does not reconcile
  with the calendar breakdown; this call site treats it as if it did.
- **Fix:** `differenceInCalendarDays(TRIP_START, now)` in `liveCell`, identical to
  `lib/travel-date.ts:81`. Do not touch `computeCountdown` — `totalDays` is correct for what it claims.
  If both call sites should share, the one-liner belongs in `lib/home-stats.ts` (already the pure
  trip-shape module) or beside `resolveTravelDate`.

## MONEY-1 — day/leg spend is bucketed by the DATE's leg, so a cross-leg expense is summed and labelled in the wrong currency

- **Severity / confidence:** S3 · confirmed
- **Where:** `core/budget/burn-rate.ts:163-215` (`expensesByDate`) and `core/recap/model.ts:116-132`
  (`sumExpensesForDate`). `expensesByDate` has exactly ONE consumer,
  `components/calendar-planner.tsx:748`, which formats it at `:1421` and passes it down as the
  `spendByDate` prop read at `components/calendar-day-picker.tsx:76`; `sumExpensesForDate`'s consumers
  are `components/trip-story-recap.tsx:110` and `components/trip-recap.tsx:162` — neither of those two
  calls `expensesByDate` (they only name it in comments). Line refs re-resolved 2026-08-21; the
  originals had drifted.
- **What breaks:** both per-day aggregators key **only** on `e.date` and drop `e.leg`; every consumer
  then formats the bucket with `legCurrency(getCountryForDate(date))` /
  `legCurrency(currentPlan.country)`. An expense whose `leg` differs from the leg that owns its `date`
  is rendered with the *other* leg's currency symbol — a ¥50,000 row shows as `Rs 50,000` — and if both
  legs have rows on the same date, NPR and JPY are added into one meaningless number.
  `components/trip-story-recap.tsx:112` goes further and adds the whole day's spend into
  `spendByLeg[getCountryForDate(date)]`, so the leg totals in the story recap contradict
  `components/wrapped-story.tsx:88` (which uses `expensesToSpent`, keyed on the expense's own leg) for
  the same data. Secondary: `sumExpensesForDate` has no `isLeg(e.leg)` guard at all, while
  `expensesByDate:184` and `expensesToSpent` both do — so a foreign-leg row the budget panel excludes
  is counted by the recap, breaking the invariant `core/budget/burn-rate.ts:185-187` states in its own
  comment ("the two views must not disagree about which rows count").
- **Trigger:** mid-trip in Nepal on 2026-12-10. Open the expense dialog (`presetDate` resolves to today
  = a Nepal date, `components/expense-log-host.tsx:59-61`), tap the **Japan** leg chip
  (`components/expense-dialog.tsx:352`, `onClick={() => setLeg(l)}`), enter `50000`, Save. `handleSave`
  writes `{ leg: 'japan', amount: 50000, date: '2026-12-10' }` — `date: presetDate` at
  `components/expense-dialog.tsx:171/181` is the prop captured at open time and is never re-derived
  when the leg changes.
- **Evidence:**

  ```
  core/budget/burn-rate.ts:193       byDate[date] = (byDate[date] ?? 0) + amount;   // no leg in the key
  components/calendar-planner.tsx:1401  {formatMoney(spendByDate[selectedDate] ?? 0, legCurrency(currentPlan.country))} spent
  components/trip-story-recap.tsx:106-112  const spend = sumExpensesForDate(expenses, date); … if (isLeg(leg)) spendByLeg[leg] += spend;   // leg = getCountryForDate(date)
  ```

- **Root cause:** `expensesByDate`'s header asserts "a single calendar day is one leg, so a day's bucket
  is a plain sum in that day's currency". That holds for the *itinerary*, not for expenses: the dialog
  exposes the leg as a free one-tap override while the date stays pinned to the open-time preset, so
  `e.leg` and `getCountryForDate(e.date)` are independent inputs.
- **Fix:** make the bucket carry its currency instead of inferring it. Smallest correct change is to key
  on the pair — have `expensesByDate` return `Record<string, Partial<Record<Leg, number>>>` (or
  `Record<'${date}|${leg}', number>`) and have the four consumers format each leg's sub-total with
  `legCurrency(e.leg)`. `sumExpensesForDate` is the one shared function behind both recap surfaces, so
  give it a `leg` argument (and the missing `isLeg` guard) there rather than patching
  `components/trip-recap.tsx` and `components/trip-story-recap.tsx` separately. Cheaper stop-gap if the
  pair-keying is too wide: make `components/expense-dialog.tsx` re-resolve `date` to the selected leg's
  own window when the leg chip is tapped — but that also removes the legitimate "paid for Japan while in
  Nepal" case.

## MONEY-2 — on a custom trip the settle-up transfers depend on WHO IS SIGNED IN, so two travellers are told to pay different people

- **Severity / confidence:** S3 · confirmed
- **Where:** `lib/token-auth.ts:156-177` (`rosterForActiveTrip`, esp. `:170`) →
  `components/budget-panel.tsx:135` → `core/budget/settlement.ts:143-161` (`minimalTransfers`'s
  `rank`/`byAmt` tie-break)
- **What breaks:** `settle(expenses, travelers)` uses `travelers` as the *deterministic tie-break* when
  two creditors (or two debtors) have equal magnitude (`core/budget/settlement.ts:149-150`,
  `b.amt - a.amt || rank(a.id) - rank(b.id)`). On a custom trip `rosterForActiveTrip` puts the
  **signed-in traveller first** (`lib/token-auth.ts:170`, `add(getActiveTraveler()?.name); // "me" first`).
  So the greedy pairing — and therefore the "A → B" instructions the Settle up card prints — differ per
  device for byte-identical expense data. This contradicts the function's own stated contract at
  `core/budget/settlement.ts:86-87`: "`travelers` … carries no identity … so the result is the same on
  every device." The default pack is unaffected (`lib/token-auth.ts:157` returns the fixed `TRAVELERS`
  list, identical everywhere).
- **Trigger:** custom trip (single `main` leg), four participants Ana/Bo/Cal/Dee. Two split expenses:
  `{amount: 200, paidBy: 'Ana', split: ['Ana','Bo']}` and
  `{amount: 200, paidBy: 'Dee', split: ['Dee','Cal']}` → balances
  `{Ana:+100, Bo:-100, Dee:+100, Cal:-100}`. Ana's phone builds roster `['Ana','Bo','Dee','Cal']`;
  Cal's builds `['Cal','Ana','Bo','Dee']` — same expenses, "me" first.
- **Evidence:** `minimalTransfers` run verbatim from `core/budget/settlement.ts:143-166` against those
  balances with each roster:

  ```
  Ana device: [{"from":"Bo","to":"Ana","amount":100},{"from":"Cal","to":"Dee","amount":100}]
  Cal device: [{"from":"Cal","to":"Ana","amount":100},{"from":"Bo","to":"Dee","amount":100}]
  ```

  `lib/__tests__/settlement.test.ts:157` ("who is looking cannot change a settlement") passes a FIXED
  `ROSTER` and varies only the identity used for the removed `paidBy` fallback — it never varies roster
  ORDER, which is the surviving leak.
- **Root cause:** D-333 removed the identity argument from `settle()` but left an identity-derived value
  flowing in through the `travelers` ordering argument, which was later repurposed from "stable display
  order" into an arithmetic tie-break. `rosterForActiveTrip` was written for the *dialog*, where "me
  first" is correct UX, and then reused for `settle()` at `components/budget-panel.tsx:135`.
- **Fix:** make the tie-break identity-free inside `core/budget/settlement.ts` — sort ties by `id`
  (lexicographic) instead of `rank(id)`, and keep `travelers` for display order only. One-line change in
  `byAmt` at `:149-150`; every caller routes through it. The larger alternative, giving
  `components/budget-panel.tsx:135` a device-independent roster, leaves the trap armed for the next
  caller.

## MONEY-3 — the "settled" chip uses a hardcoded half-unit threshold, so a USD leg shows everyone settled while listing a transfer

- **Severity / confidence:** S3 · confirmed
- **Where:** `components/settle-up-summary.tsx:46` vs `core/budget/settlement.ts:55` (`EPS = 0.005`) and
  `core/budget/settlement.ts:125` (`unit = currency === 'USD' ? 0.01 : 1`)
- **What breaks:** `const settled = Math.abs(net) < 0.5;` is a whole-unit threshold written for NPR/JPY.
  `settle()` rounds a USD leg to **cents** and emits a transfer for anything above `EPS = 0.005`. Any
  USD balance between half a cent and 49 cents therefore renders as "settled" on every participant chip
  while the transfer list directly underneath prints the payment still owed — the card contradicts
  itself. Every custom trip is a USD leg (`core/trips/custom.ts:88`, `currency: c.currency ?? 'USD'`,
  and nothing in the create form sets another currency), so this is the default state for custom trips,
  not an edge case.
- **Trigger:** custom trip, participants Ana and Bo, two split expenses on leg `main`: Ana pays `50.00`
  split `['Ana','Bo']`, Bo pays `50.60` split `['Ana','Bo']`.
- **Evidence:** `roundBalances` + `minimalTransfers` run verbatim at `unit = 0.01`:

  ```
  rounded balances {"Ana":-0.3,"Bo":0.3}
  transfers        [{"from":"Ana","to":"Bo","amount":0.3}]
    chip Ana: settled=true / chip Bo: settled=true   (settle-up-summary.tsx:46)
  ```

- **Root cause:** the display threshold was hardcoded to the NPR/JPY display unit and never revisited
  when custom trips introduced a USD (2-decimal) leg. It is derived neither from the unit `settle()`
  rounds with nor from `EPS`.
- **Fix:** `settle()` already guarantees a balance is either exactly 0 or ≥ one display unit, so the
  presentational threshold is redundant — replace `Math.abs(net) < 0.5` with `Math.abs(net) < EPS`
  (export `EPS` from `core/budget/settlement.ts`), or simply `net === 0`. One line in
  `components/settle-up-summary.tsx:46`; it is the only consumer.

## PWA-3 — RSC payloads are cached under per-navigation `?_rsc=` keys, growing the precache without bound

- **Severity / confidence:** S3 · confirmed
- **Where:** `scripts/gen-sw.mjs:1119-1128` (static-asset branch) and `:987-996` (`cacheFirst`);
  generated worker `out/sw.js:329-338`, `:462-470`
- **What breaks:** Next appends a cache-busting `_rsc=<digest>` to every RSC fetch, and the digest is
  computed from the *current router state tree* — so the same target route yields a different URL
  depending on which route you navigate from, and again for prefetch vs. real navigation. The
  static-asset branch caches each of those as a distinct entry in `trip-precache-<hash>`, which has **no
  size cap and no eviction** (only `trip-images-v1` is trimmed). Route payloads run 12–33 KB each; 19
  routes × ~19 source states × 2 prefetch kinds is ~700 entries ≈ 17 MB of near-duplicate JSON, against
  a whole shell that is 4.57 MiB raw. When the origin is evicted under storage pressure the *entire*
  Cache Storage goes, precache included — and nothing rebuilds it as a unit, because `install` already
  ran. Offline then works only for routes the user happens to revisit online afterwards.
- **Trigger:** online, navigate around the app for a few sessions without accepting an update; inspect
  `caches.open('trip-precache-…').keys()` — entries accumulate as `…/plan/index.txt?_rsc=<varies>`, one
  per (source route, target route, prefetch-kind) combination.
- **Evidence:** Next's router chunk computes `_rsc` from
  `computeCacheBustingSearchParam(prefetchHeader, segmentPrefetchHeader, NEXT_ROUTER_STATE_TREE_HEADER, NEXT_URL)`
  and pushes it onto `e.search` before `fetch(o,{credentials:"same-origin",…})`.
  `stat -c %s out/*/index.txt` → `461315 bytes across 19 routes`, largest `out/guides/index.txt` at
  33846 B. `cacheFirst` writes unconditionally for any ok/basic same-origin GET:

  ```js
  if (res && res.ok && res.type === 'basic') { const cache = await caches.open(cacheName); cache.put(request, res.clone()); }
  ```

  — no key normalization, no cap.
- **Root cause:** the static-asset branch keys by the full request URL, and Next deliberately varies that
  URL per navigation. Every miss writes a new permanent entry.
- **Fix:** normalize the lookup/store key once, in `cacheFirst` (the single function both the static
  branch and the glyph/lazy-chunk path route through): build
  `const key = new URL(request.url); key.searchParams.delete('_rsc');` and use `key.href` for both
  `caches.match` and `cache.put`. That collapses the duplicates to one entry per route and — combined
  with precaching `index.txt` (PWA-1) — makes offline soft navigation actually hit.

## PWA-4 — `trip-images-v1` is never versioned and shadows the precache, so a redeployed image is stale forever

- **Severity / confidence:** S3 · confirmed
- **Where:** `scripts/gen-sw.mjs:834` (`IMAGES_CACHE = 'trip-images-v1'`), `:910` (allowlisted through
  every activate), `:1044-1057` (image branch); generated worker `out/sw.js:7,252,386-398`
- **What breaks:** files under `/images/**` have stable, non-content-hashed names
  (`out/images/hero/hero.avif`, `hero-japan-1024w.avif`, …) and `public/images/**` is committed, not
  build-hashed. The image handler is cache-first against `trip-images-v1`, which survives `activate`
  unchanged and has no expiry and no revalidation. Re-encode any image without renaming it and every
  returning client keeps serving the old bytes indefinitely — including the D-335 hero rasters, whose
  *fresh* copy sits in the new precache but is never reached because
  `caches.match(request, { cacheName: IMAGES_CACHE })` is consulted first. The same ordering also means
  a precached hero is **never served from cache while online**: the handler always goes to the network
  for anything not already in `trip-images-v1`, so the 555 KiB (30% of the gzipped install) that D-335
  spends buys nothing on a first online paint, and the duplicate copy consumes one of the 80 FIFO slots
  it was added to escape.
- **Trigger:** change the bytes of `public/images/hero/hero.avif` (e.g. re-run `scripts/gen-images.mjs`
  at a different quality), deploy, accept the update on a client that has visited before. The old hero
  keeps rendering.
- **Evidence:**

  ```js
  const cached = await caches.match(request, { cacheName: IMAGES_CACHE });
  if (cached) return cached;                      // runtime copy wins over the fresh precache
  ```

  plus `const allowlist = new Set([PRECACHE, IMAGES_CACHE, FRANKFURTER_CACHE]);` — `trip-images-v1` is
  preserved across every deploy, and the literal has never moved off `v1`.
- **Root cause:** a durable, cache-first runtime cache keyed by URLs that are not content-addressed,
  checked ahead of the content-hashed precache.
- **Fix:** in the image branch, consult the precache before the runtime cache for anything the build
  precached (`await caches.match(request, { cacheName: PRECACHE })` first, then `IMAGES_CACHE`). That
  fixes hero staleness and the wasted online round-trip in one move. For the gallery images, either fold
  the precache hash into the images-cache name so it rolls with each deploy, or content-hash the emitted
  filenames in `scripts/gen-images.mjs`.

## PWA-5 — `caches.match` sits outside the try/catch in the navigation and static branches

- **Severity / confidence:** S3 · speculative (the trigger cannot be constructed from the app side; it
  requires a rejecting `CacheStorage.match`)
- **Where:** `scripts/gen-sw.mjs:1091` and `:1121`; generated worker `out/sw.js:433`, `:463`
- **What breaks:** both branches `await caches.match(...)` *before* entering their `try`. Every other
  Cache-API call in the file is guarded. If the Cache Storage backend rejects — a corrupted store, an
  eviction racing the read, iOS storage reclamation — the async IIFE rejects, `event.respondWith`
  rejects, and the browser renders a network error. For the navigation branch that is the browser's
  "site can't be reached" page for a page the precache is holding, and a reload takes the same path.
- **Trigger:** none constructible from the app. The asymmetry is the signal: `cacheFirst` is wrapped in a
  try that the `caches.match` two lines above sits outside of.
- **Evidence:**

  ```js
  const cached = await caches.match(request);          // unguarded
  if (cached) return cached;
  try { return await cacheFirst(request, PRECACHE); } catch (err) { return Response.error(); }
  ```

- **Root cause:** the guard was placed around the network call rather than around the whole handler body.
- **Fix:** move the opening `{` of the existing `try` above the `caches.match` line in both branches — no
  new code, the fallbacks are already written.

## REACT-2 — the "Planned" filter list goes stale when a placement is added or removed

- **Severity / confidence:** S3 · confirmed
- **Where:** `components/recommendation-section.tsx:309-324` (dep array on `:324`; `findPlacements` read
  on `:316`; the `eslint-disable-next-line react-hooks/exhaustive-deps` on `:323`)
- **What breaks:** `filtered` calls `findPlacements(i.id)` but does not list it as a dependency.
  `findPlacements` comes from `useItineraryContext()` and gets a new identity on every itinerary commit
  (`hooks/use-itinerary.ts:646-650`, `useCallback(..., [plans])`). With the "Planned" chip active,
  adding or removing an itinerary placement re-renders the section — the chip count (`:262`) and the
  per-card "Added" badge (`:610`) both update, because they are plain per-render expressions — but the
  memoized card list does not. The screen contradicts itself: the chip says "Planned 0" while a card is
  still listed under the Planned filter.
- **Trigger:** `/nepal` (or `/japan`): add a recommendation to the plan, turn the "Planned" filter chip
  on (the card is listed with an Added badge, chip count 1) → open that card → in the add-to-plan dialog
  press "Remove from &lt;date&gt;" (`components/add-to-itinerary-dialog.tsx:589`) → close. The card is
  still in the results grid, its Added badge is gone, and the chip count reads 0. It stays stale until
  any of `items / activeCategory / activeCity / q / sort / savedOnly / favorites / plannedOnly` changes.
- **Evidence:**

  ```
  :316  (!plannedOnly || findPlacements(i.id).length > 0) &&
  :324  }, [items, activeCategory, activeCity, q, sort, savedOnly, favorites, plannedOnly]);
  :262  const plannedCount = items.filter((i) => findPlacements(i.id).length > 0).length;   // unmemoized, so it DOES update
  ```

  The two sibling files with the same three `exhaustive-deps` disables
  (`components/nightlife-section.tsx:208/222/239`, `components/photography-guide.tsx:173/187/205`) only
  omit `matchesSearch`, whose sole free variable `q` *is* listed — so this is the one memo that
  genuinely drops a live store value, not a house pattern.
- **Root cause:** a blanket `eslint-disable-next-line react-hooks/exhaustive-deps` written to silence the
  `matchesSearch` closure also silenced a real missing dependency on store-derived state.
- **Fix:** add `findPlacements` to the dep array, and keep the disable only if `matchesSearch` still
  needs it — better, hoist `matchesSearch` into its own `useCallback` keyed on `q` and drop the disable
  entirely. All three memos in this file route through the same `matchesSearch` closure, so fixing that
  one function removes the need for all three disables.

## REACT-3 — concurrent place-link resolves have no request-id guard; a stale response overwrites the newer form

- **Severity / confidence:** S3 · confirmed (traced end to end; not executed)
- **Where:** `components/import-place-sheet.tsx:110-134` (`runResolve`), consumed at `:140`
  (auto-resolve on open), `:274` (Enter in the URL field) and `:285` (the "Look up" button)
- **What breaks:** `runResolve` awaits `resolvePlaceLink(u)` (8 s abort ceiling,
  `lib/place-resolve.ts:48`) and then unconditionally writes `setStatus`, `setResolvedUrl`, `setCoords`,
  `setName` and `setLegId`. There is no abort, no cancellation flag and no "is this still the current
  URL" check. Two overlapping resolves therefore apply in completion order, not request order, so the
  form can end up holding link B's `sourceUrl` alongside link A's `name`, `resolvedUrl` and `lat/lng`.
  Confirming saves that mismatched row through `useMyPlaces().addPlace` — persisted and, on a synced
  trip, pushed to Firestore. A late *failure* is worse: the `if (!hints)` branch (`:116-121`) sets
  `status:'notfound'` and clears `lastResolvedRef`, wiping a newer successful resolve's state.
- **Trigger:** two reachable paths, both with the sheet staying mounted
  (`components/share-inbox.tsx:178-179` renders it always and toggles the `open` prop, and the re-seed
  effect at `:89-104` exists precisely because the instance is reused):
  1. `/share`, inbox path — press "Import as place" on a Google-link row A → the auto-resolve at `:140`
     starts → press Cancel → press "Import as place" on row B → re-seed clears `lastResolvedRef` and
     starts resolve B. Whichever request finishes last wins.
  2. `/share`, paste path — paste link A into the URL field, press **Enter** (`:272-277`; the keydown
     handler is NOT guarded by `status === 'resolving'`, unlike the "Look up" button at `:288`), then
     edit the field to link B and press Enter again. `lastResolvedRef.current === u` only blocks a repeat
     of the *same* URL, so both requests run.
- **Evidence:** `:113` — `lastResolvedRef.current = u;`, a single-flight guard per URL, not per request
  generation. `:124-133` —
  `setStatus('found'); if (hints.finalUrl) setResolvedUrl(...); … setCoords({ lat: hints.lat, lng: hints.lng }); setName((prev) => …)`
  with nothing checking that `u` is still the URL the user is looking at. `:288` —
  `disabled={!isGooglePlaceUrl(url.trim()) || status === 'resolving'}` vs `:272-277`, which has no such
  gate: the two triggers for the same function disagree about re-entrancy.
- **Root cause:** an async handler that writes React state on completion with no generation token and no
  abort, in a component deliberately kept mounted across open/close cycles.
- **Fix:** one guard inside `runResolve` covers all three call sites — capture a generation counter in a
  ref (`const gen = ++resolveGenRef.current`) before the await and bail on
  `if (resolveGenRef.current !== gen) return;` after it; bump the same counter in the re-seed effect at
  `:103` so a reopen invalidates anything still in flight.

## REACT-4 — editing a past day's journal entry is labelled "Today's journal"

- **Severity / confidence:** S3 · confirmed
- **Where:** `components/journal-browse.tsx:109`
- **What breaks:** `JournalCard`'s `isToday` prop defaults to `true` (`components/journal-card.tsx:40`),
  which selects the heading "Today's journal" and the aria-label "Edit today's journal entry"
  (`components/journal-card.tsx:46-47`). `/journal`'s browse view mounts the card to edit an arbitrary
  past day but never passes `isToday={false}`, so every past-day editor claims to be today's. The
  heading is also the section's accessible name (`aria-labelledby="journal-heading"`), so this reaches
  the accessibility tree, not just the pixels — the exact defect the `isToday` prop was added for
  (`components/journal-card.tsx:42-44` cites it).
- **Trigger:** write a journal entry for a past trip day, go to `/journal`, press "Edit" on that row. The
  mounted card's heading reads "TODAY'S JOURNAL" instead of "&lt;date&gt; — journal".
- **Evidence:** `components/journal-browse.tsx:109` — `<JournalCard date={date} />`, against this file's
  own docblock at `:21`: "Edit swaps that ONE row for a mounted `<JournalCard date={date} isToday={false} />`".
  The documented contract and the call site disagree. `components/journal-card.tsx:40` —
  `export default function JournalCard({ date, isToday = true }: ...)`.
- **Root cause:** the prop was added to `JournalCard` and documented in the caller's comment but never
  wired into the caller's JSX.
- **Fix:** `<JournalCard date={date} isToday={false} />` at `components/journal-browse.tsx:109`. There is
  exactly one other mount, `components/today-panel.tsx:215`, which correctly wants the default.

## REACT-5 — the storage-full recovery toasts send the user to /plan, which no longer has any backup or export control

- **Severity / confidence:** S3 · confirmed
- **Where:** `components/storage-persistence.tsx:100-111` (near-quota warning) and `:141-150`
  (write-failure toast); the navigations are `:109` and `:147`
- **What breaks:** both toasts are the app's only recovery path when localStorage is full — "Back up now"
  and "Export now" — and both call `router.push('/plan')`. `BackupRestore` was moved off `/plan` into
  Settings, so `/plan` renders only the calendar, the activity feed and the budget panel. The user
  follows the one affordance offered at the moment their data is at risk and lands on a page with
  nothing to press. The description string is wrong too: "Back up your trip **from the Plan page**".
- **Trigger:** fill device storage past 90% of quota (or dispatch
  `window.dispatchEvent(new CustomEvent('trip:quota-exceeded'))`), then press the toast's action button.
  You arrive on `/plan` with no export UI.
- **Evidence:** `components/storage-persistence.tsx:109` and `:147` — `onClick: () => router.push('/plan'),`.
  `app/plan/sections.tsx:5-7` — "the BackupRestore island was removed from here (and from page.tsx) —
  backup now lives only in Settings"; that file exports only `CalendarPlanner`, `PlanActivity`,
  `BudgetPanel`. `BackupRestore` is imported and rendered in exactly one place:
  `components/settings-panel.tsx:57` / `:1411`. The unit tests pin the stale destination rather than
  catching it: `lib/__tests__/storage-persistence.test.ts:204` and `:301` both assert
  `expect(h.pushCalls).toContain('/plan')`.
- **Root cause:** the Backup & Restore island was relocated to `/settings` and this caller — plus its two
  tests and the toast copy — was not updated with it.
- **Fix:** point both actions at `/settings/` (matching the trailing-slash convention the rest of the app
  uses — `components/itinerary-provider.tsx:67` uses `/settings/`), reword the near-quota description to
  name Settings, and update the two assertions in `lib/__tests__/storage-persistence.test.ts`.

## CONCIERGE-5 — a newline in a stored item title forges its own line in the model context

- **Severity / confidence:** S3 · confirmed
- **Where:** `hooks/use-concierge-chat.ts:233` and `:236` (the digest line builder),
  `core/vault/schema.ts:26` (`title: z.string()`)
- **What breaks:** `buildTripDigest` emits one line per day, `` `${date} ${city}: ${entries}` ``, with
  items joined by `; ` and days joined by `\n`. Item titles are interpolated raw. Titles reach storage
  from paths that are not `<input>`-constrained — an imported or restored backup
  (`parseItineraryPayloadStrict`, whose per-item rule is `title: z.string()` with no newline or length
  bound) and a Firestore snapshot from the other member of the trip — so a title containing `\n` splits
  the digest and plants an arbitrary line that is indistinguishable, to the model, from a real one. The
  ops path is not the payoff (chips still require an explicit Confirm and re-validate against live
  plans); the reply text is. The injected line can steer the model into emitting a markdown link, which
  `renderInline` turns into a real `<a target="_blank">` because `https://` passes `SAFE_HREF` — so both
  destructive-looking proposals and a phishing link arrive inside the app's own trusted panel.
- **Trigger:** restore a backup (or have a peer sync a doc) containing an item whose `title` carries a
  `\n` followed by instruction-shaped text, then send any concierge message.
- **Evidence:** `parseItineraryPayloadStrict(plans)` accepts the payload, and the real
  `buildTripDigest()` over a seeded `ITINERARY_STORAGE_KEY` puts the forged text on its own row:

  ```
  2026-12-09 Kathmandu: food Momo lunch
  <forged line, indistinguishable from a real day row> #n1-1
  ```

- **Root cause:** the digest is a line-oriented format assembled by interpolation, with no escaping of
  the one delimiter it depends on.
- **Fix:** strip the delimiters where the line is built —
  `` `${time}${i.category} ${i.title.replace(/[\r\n;]+/g, ' ')} #${i.id}` `` at
  `hooks/use-concierge-chat.ts:233`. One place; every digest consumer routes through it. A per-title
  length bound there would also stop one hostile title from eating the whole `DIGEST_CAP`.

## CONCIERGE-6 — a 200 response that is not the JSON envelope renders an empty bubble as a successful turn

- **Severity / confidence:** S3 · confirmed
- **Where:** `hooks/use-concierge-chat.ts:399-430`, rendered at `components/concierge-chat.tsx:479-485`
- **What breaks:** the non-2xx branch is handled well, but a **2xx** whose body is not the
  `{reply, ops}` envelope is not: `await res.json().catch(() => ({}))` swallows the parse failure,
  `reply` collapses to `''`, `status` is set to `'idle'` and `error` stays `null`. The component then
  renders `turn.content ? … : status === 'streaming' ? '…' : ''`, i.e. an empty assistant bubble, and
  because `error` is null the error row and its "Try again" button never mount. The user gets a blank
  grey bubble and no way to retry except retyping. The canonical producer of a 200-with-HTML is a
  captive portal or an interposing proxy — the same "foreign mobile data" case this file's other
  comments treat as normal, not exotic. The empty turn is also appended to `historyRef` (`:429`) and
  shipped as context on every subsequent turn.
- **Trigger:** any 200 whose body is not JSON, or is JSON without a string `reply` — a captive-portal
  login page, a CDN interstitial, or a Worker answering `{"error":"…"}` with status 200.
- **Evidence:** `lib/__tests__/use-concierge-chat.test.ts` pins the behaviour deliberately — *"a
  malformed body (no reply/ops) degrades to an empty reply + empty ops, not an error"* asserts
  `h.status === 'idle'` and `h.messages[1].content === ''`. So this is a chosen contract, and the chosen
  contract renders a failed turn as a successful one.
- **Root cause:** "did the body parse into an envelope" is conflated with "was the request successful";
  the parse result is defaulted rather than branched on.
- **Fix:** in the same block, treat a non-string `data.reply` as a failure —
  `if (typeof data.reply !== 'string') { fail(statusMessage(0)); return; }`. The default branch of
  `statusMessage` already says "The concierge is having trouble right now. Try again in a moment.", and
  `fail` already pops the in-flight bubble and enables "Try again".

## CONCIERGE-7 — two identical ops in one reply share an `opKey`, so confirming one silently consumes both chips

- **Severity / confidence:** S3 · likely (traced in source, not rendered)
- **Where:** `components/concierge-chat.tsx:363` (`opKey`), `:527-529` and `:532` (the `key` and the
  `resolvedOps` skip), `:545` / `:554`
- **What breaks:** `` const opKey = (turnIndex, op) => `${turnIndex}::${JSON.stringify(op)}` `` is
  content-derived, deliberately, so that it survives `validateOps` re-running each render. But two ops
  in the same turn with identical JSON — a model repeating itself, a normal LLM failure mode — produce
  the **same** key. Both chips render with the same React `key` in one `valid.map(...)`, and
  `resolve(key)` in `confirmOp`/dismiss marks both at once, so `resolvedOps.has(key)` hides the second
  chip too. The user sees two proposals, presses Confirm on one, both disappear, and only one `applyOp`
  ran — the second proposal is dropped with no chip, no undo entry and no "didn't match the current
  plan" line (it is excluded from `dropped` for the same reason: `resolvedOps.has(opKey(i, op))` at
  `:513`).
- **Trigger:** a reply carrying the same `addItem` op twice, then Confirm on the first chip.
- **Evidence:** `opKey` has no positional component, and the chip's `key`, the `resolvedOps` membership
  test and the `dropped` filter all use that one value. None of
  `lib/__tests__/concierge-op-feedback.test.ts`, `lib/__tests__/concierge-op-conflicts.test.ts` or
  `lib/__tests__/concierge-ops.test.ts` sends two equal ops in one turn.
- **Root cause:** the key is content-only, on the assumption that content is unique within a turn;
  nothing upstream dedupes or enforces that.
- **Fix:** either dedupe on arrival — in the hook at `hooks/use-concierge-chat.ts:416`, drop ops whose
  `JSON.stringify` already appeared in the same array — or make the key positional-plus-content by
  carrying the raw index from `turn.ops` (`turn.ops.indexOf(op)` is stable because `valid` holds the
  same object references). Deduping is the smaller and more honest change: two identical ops are one
  proposal.

## A11Y-2 — the concierge sheet's only close button renders 17×17 px

- **Severity / confidence:** S3 · confirmed
- **Where:** `components/ui/sheet.tsx:67-70` (compare `components/ui/dialog.tsx:77`)
- **What breaks:** a user with a motor impairment, or on a phone, cannot reliably hit the close control of
  the trip-concierge panel — it is a 17 px square in the corner of a full-width sheet.
  `components/concierge-chat.tsx` renders no close of its own (the file ends
  `…privacy-note</p></SheetContent>`), so this is the panel's only visible close; the remaining exits are
  Escape and a scrim tap, neither of which is a labelled control.
- **Trigger:** open the concierge panel (navbar "Concierge" button, or the `/travel` mount) at
  phone-width and try to tap the X at the top right.
- **Evidence:** measured in a real Chromium against the shipped class strings, rendered on the built
  page:

  ```json
  { "sheetClose":  { "w": 17, "h": 17 },
    "dialogClose": { "w": 44, "h": 44 } }
  ```

  `components/ui/sheet.tsx:67` has no padding and no `min-h`/`min-w`; its child is
  `<X className="h-4 w-4" />`. `e2e/s157-a11y-close-targets.spec.ts` swept six close-X buttons to ≥44 px
  and its header enumerates them — `components/ui/sheet.tsx` is not among them, and the "sixth" it later
  fixed was `components/ui/dialog.tsx`.
- **Root cause:** the S157/FU-39 hit-area sweep enumerated close buttons by *dialog*, and the concierge is
  the app's only `Sheet` consumer, so its shared primitive was never on the list. It is also the one
  dialog no axe or target-size spec opens.
- **Fix:** copy `components/ui/dialog.tsx:77`'s hit-area-only change onto `components/ui/sheet.tsx:67` —
  add `inline-flex items-center justify-center min-h-[44px] min-w-[44px]`. The icon size and corner
  anchoring stay, so no visible pixels move, and one edit covers every future `Sheet` consumer.

## A11Y-3 — offline / sync-pending / presence status regions are created at the same moment as their text, so screen readers do not announce them

- **Severity / confidence:** S3 · confirmed (by trace; the pattern is the documented ARIA failure mode)
- **Where:** `components/offline-banner.tsx:38-48`, `components/sync-status-badge.tsx:41-58`,
  `components/presence-bar.tsx:37-48`, `components/photo-attach.tsx:198-201`
- **What breaks:** a screen-reader user is never told they went offline, never told their first edit is
  queued and unsynced, and never told a photo failed to save. A live region only announces a *mutation*
  of a region already in the accessibility tree; inserting a node that already carries `aria-live` is not
  a mutation of an existing region and is unreliable across NVDA/JAWS/VoiceOver. All three status pills
  are mounted once in the root layout, so this is app-wide.
- **Trigger:** with a screen reader running, go offline (DevTools → Network → Offline). `useOnline()`
  flips and `OfflineBanner` goes from `return null` to rendering
  `<m.div role="status" aria-live="polite">…Offline — showing cached content…`. Same for the first queued
  edit (`pending` 0→1) in `SyncStatusBadge`, and for a photo save error in
  `components/photo-attach.tsx`.
- **Evidence:**

  ```
  offline-banner.tsx:38    if (online) return null;
  offline-banner.tsx:46      role="status"
  offline-banner.tsx:47      aria-live="polite"
  sync-status-badge.tsx:41  if (pending === 0 && lastAckAt === null) return null;
  sync-status-badge.tsx:56-57  role="status" aria-live="polite"
  ```

  The repo already uses the correct idiom elsewhere — `components/settings-panel.tsx:485`
  (`<div aria-live="polite" className="mt-2 min-h-[1.25rem]">`) is always mounted with the message
  conditional *inside* it, as are `:731`, `:1591`, `components/backup-restore.tsx:209` and
  `components/sign-out-confirm.tsx:111`. This is an inconsistency, not an unknown.
- **Root cause:** the three pills were written as structural mirrors of each other — their doc comments
  say so — and all three inherited the `return null` early exit, which puts the region and its content in
  the same React commit.
- **Fix:** keep the wrapper mounted and move the emptiness inside it: render
  `<div role="status" aria-live="polite" className="…" />` unconditionally (empty, zero-height) and gate
  only the pill's children. Doing it once in a small shared `StatusPill` wrapper covers
  `offline-banner`, `sync-status-badge` and `presence-bar`, which already share the same markup;
  `components/photo-attach.tsx:198` needs the same empty-wrapper treatment.

## A11Y-4 — the "New version available" toast is permanent and has no keyboard dismissal

- **Severity / confidence:** S3 · confirmed
- **Where:** `components/service-worker-registrar.tsx:61-70` (`duration: Infinity`, one action, no
  cancel) and `components/ui/sonner.tsx:11-34` (`<Sonner>` rendered with no `closeButton`)
- **What breaks:** once a service-worker update lands, a toast pins itself to the bottom right of every
  route forever. Its only non-pointer exit is the "Refresh" action, which reloads the app — so a keyboard
  or screen-reader user who does not want to reload right now cannot get rid of it, and it stays in the
  tab order (sonner renders each toast as `<li tabindex="0">`). Dismissal is reachable only by the
  pointer-only swipe gesture, i.e. a function with no keyboard equivalent (WCAG 2.1.1, Level A).
- **Trigger:** ship any new build to an already-installed client (page already has
  `navigator.serviceWorker.controller`), reload once so the new worker reaches `installed`, then Tab
  around: the toast is focusable, Escape does not remove it, and there is no close control.
- **Evidence:** the shipped toaster DOM, captured live with the sibling infinite toast up — no close
  button, only the action:

  ```html
  <li aria-live="polite" role="status" tabindex="0" data-sonner-toast data-dismissible="true" …>
    <div data-content>…</div><button data-button data-action>Got it</button></li>
  ```

  sonner 1.5.0's only Escape binding collapses the stack, it does not dismiss:
  `Escape"&&(document.activeElement===H.current||…H.current.contains(document.activeElement))&&k(!1)` in
  its dist bundle — `k` is the expanded setter. `grep -rn "closeButton" components app` returns only
  `components/trip-map.tsx:603` (a MapLibre popup), never the `<Toaster>`.

  Related blind spot on the same surface: `e2e/fixtures.ts:75` sets
  `nepal_japan_install_hint_dismissed` for every spec with the comment *"duration:Infinity would poison
  every axe scan"*, so the toast layer is never scanned. With it up, a probe reports
  `[serious] list — <ol> must only directly contain <li>…` on `/` — sonner's own markup, low real harm,
  but a serious-impact finding the CI gate is structurally unable to see, on the state every first-time
  visitor is actually in.
- **Root cause:** `duration: Infinity` was chosen so the update prompt cannot be missed, but the Toaster
  it renders into was never given `closeButton`; and unlike the install-hint toast
  (`components/storage-persistence.tsx:126`, whose "Got it" action dismisses) this one's single action is
  destructive-ish (a reload), so there is no non-pointer way out.
- **Fix:** add `closeButton` to `<Sonner>` in `components/ui/sonner.tsx` — one prop, and it covers both
  `duration: Infinity` toasts plus any future one. Narrower alternative: give `promptUpdate` a
  `cancel: { label: 'Later' }`.

## CONTENT-8 — `vibeFor` returns `Object` for a prototype-key vibe, and Home's hero dereferences it

- **Severity / confidence:** S3 · likely (the UI never produces such a `vibe`; every reachable producer
  is remote or hand-edited storage)
- **Where:** `core/trips/custom.ts:66-68`, consumed at `components/hero-section.tsx:264` and `:329`
- **What breaks:** `VIBES[key ?? ''] ?? VIBES[DEFAULT_VIBE]` is a bare index on an object literal, so
  `vibeFor('constructor')` returns the `Object` function — non-nullish, so `??` never fires — typed as
  `Vibe`. Home then does `customVibe!.gradient.join(', ')`, and `.gradient` on a function is `undefined`,
  so `.join` throws and the whole Home route falls to `app/error.tsx`.
- **Trigger:** a custom trip whose config block carries `vibe: 'constructor'` (or `'toString'`,
  `'__proto__'`, `'valueOf'`). `sanitizeTripConfig` (`core/trips/registry.ts:72`) accepts any non-empty
  trimmed string, so the value survives from a peer-written trip-meta doc
  (`components/itinerary-provider.tsx:245`, `setTripConfig(activeId, remote.config)`), from the synced
  trip list, or from edited `tripPlannerKnownTrips`.
- **Evidence:** `core/trips/custom.ts:67` is `return VIBES[key ?? ''] ?? VIBES[DEFAULT_VIBE];` — no
  own-key guard. Same lookup semantics proved for CONTENT-5
  (`typeof VIBES['constructor'] === 'function'`, truthy). `components/hero-section.tsx:329`:
  `` `linear-gradient(180deg, ${customVibe!.gradient.join(', ')})` `` — the non-null assertion means
  TypeScript cannot catch it.
- **Root cause:** the fifth and sixth surviving site of the D-307 unguarded-object-index class; the
  `?? DEFAULT` idiom reads as total but is not.
- **Fix:** one line, same idiom as the five swept siblings:
  `return (Object.prototype.hasOwnProperty.call(VIBES, key ?? '') ? VIBES[key ?? ''] : undefined) ?? VIBES[DEFAULT_VIBE];`.
  Fixing it in `vibeFor` covers the hero and any future consumer.

---

# S4

## DATES-7 — three date labels use the device locale while every other date in the app is pinned to `en-US`

- **Severity / confidence:** S4 · confirmed
- **Where:** `components/weather-card.tsx:56`
  (`dt.toLocaleDateString(undefined, { weekday: 'short' })`), `lib/weather.ts:169`
  (`d.toLocaleString(undefined, …)`), `components/trips-hub.tsx:376`
  (`new Date(t.joinedAt).toLocaleDateString()` — no locale, no options)
- **What breaks:** `core/dates/trip-dates.ts:86,91` and `components/day-strip.tsx:44,46` all pass
  `'en-US'` explicitly, and `core/dates/trip-dates.ts:62-69` even hand-rolls `MONTH_NAMES` specifically
  so `TRIP_DATE_LABEL` is "independent of the runtime's Intl/locale data". These three sites opt out. On
  a phone set to Japanese — plausible for a traveller in Japan, and the default for a device bought
  there — the weather outlook renders `水 / 木 / 金` next to the app's English copy and its hand-rolled
  `6:42 AM` golden-hour times, and the Trips hub renders `2026/8/21` where the rest of the app renders
  `Aug 21, 2026`.
- **Trigger:** set the device or browser language to anything other than English (`--lang=ja-JP`), open
  the Today panel's 7-day outlook or the Trips hub.
- **Evidence:** direct read of the four `'en-US'` sites versus the three `undefined`/absent-locale sites;
  `node -e "console.log(new Date(2026,11,9).toLocaleDateString('ja-JP',{weekday:'short'}))"` → `水`.
- **Root cause:** no shared weekday/short-date formatter — each surface calls `toLocaleDateString` itself
  and three of them forgot the locale argument.
- **Fix:** route all three through `formatDate`/`formatDateLong` in `core/dates/trip-dates.ts`, or add a
  `formatWeekdayShort(dateStr)` there next to them. That module is already the single home for this and
  already carries the "anchor at local noon before formatting" rule these three sites also skip.

## MONEY-4 — expense CSV is written without a UTF-8 BOM, so non-ASCII notes and names mojibake in Excel

- **Severity / confidence:** S4 · likely (the file could not be opened in Excel from this environment)
- **Where:** `lib/expense-csv.ts:60-73` (`expensesToCsv`) and `components/settings-panel.tsx:1396-1399`
- **What breaks:** `expensesToCsv` returns bare UTF-8 text and `components/settings-panel.tsx:1397` wraps
  it as `new Blob([csv], { type: 'text/csv;charset=utf-8;' })`. Excel on Windows ignores the Blob MIME
  type when a `.csv` is opened from disk and decodes with the system ANSI codepage unless the file starts
  with a BOM, so any non-ASCII byte in `Note`, `Paid By` or `Split With` renders as mojibake. The other
  RFC-4180 handling in this file — quoting, doubled quotes, CRLF, the #115 formula-trigger
  neutralisation — is correct; this is only the encoding preamble. No BOM is emitted anywhere in the repo
  (`grep -rn 'feff' --include=*.ts --include=*.tsx` matches only
  `lib/__tests__/visited-manual-entry.test.ts:62`).
- **Trigger:** log an expense with a note in Japanese (or any accented traveller name), Settings → Export
  expenses, open `nepal-japan-expenses.csv` by double-clicking it in Windows Explorer.
- **Evidence:** `lib/expense-csv.ts:61` — `const rows = [CSV_HEADERS.map(csvField).join(',')];` … `:72` —
  `return rows.join('\r\n') + '\r\n';`. No `\uFEFF` prefix anywhere in the function or at the Blob site.
- **Root cause:** the exporter treats "valid UTF-8 plus a charset in the MIME type" as sufficient, but the
  download path hands the bytes to a desktop spreadsheet, not to an HTTP client that reads the
  Content-Type.
- **Fix:** prefix the BOM at the single Blob site rather than in the pure serializer, so the string stays
  clean for `lib/__tests__/expense-csv.test.ts`:
  `new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' })` in
  `components/settings-panel.tsx:1397`.

## PWA-6 — `apple-touch-icon.png` is generated, shipped and precached but referenced by nothing

- **Severity / confidence:** S4 · confirmed
- **Where:** `scripts/gen-icons.mjs:91` emits it; `scripts/gen-sw.mjs:712` (`rel.startsWith('icons/')`)
  precaches it; `app/layout.tsx:50-53` declares only `icon`/`shortcut`, both `favicon.svg`
- **What breaks:** no `<link rel="apple-touch-icon">` reaches any HTML. On iOS builds that predate
  manifest-icon support, "Add to Home Screen" falls back to `<origin>/apple-touch-icon.png` — outside the
  `/trip_planner` basePath — which 404s, so the home-screen icon becomes a screenshot of the page.
  Meanwhile the 7.5 KB file is fetched on every install as part of an atomic precache the repo otherwise
  polices to the kilobyte (V6-14 withheld 154 KiB of glyphs on exactly this argument).
- **Trigger:** `grep -o '<link[^>]*apple-touch-icon[^>]*>' out/index.html` → no output.
  `grep -rl "apple-touch-icon" out/` → the generated worker only.
- **Evidence:**

  ```
  === refs to apple-touch-icon in source ===
  scripts/gen-icons.mjs:15:// public/icons/apple-touch-icon.png 180x180 (iOS home-screen)
  scripts/gen-icons.mjs:91:  await writeStandard(svgBuffer, 180, 'apple-touch-icon.png');
  === refs in built out (excluding the file itself) === out/sw.js
  ```

- **Root cause:** `metadata.icons` in `app/layout.tsx` never got an `apple` entry when the icon generator
  did.
- **Fix:** add `apple: withBasePath('/icons/apple-touch-icon.png')` to `metadata.icons` in
  `app/layout.tsx:50`. One line, and it also makes the already-paid precache entry earn its bytes.

## PWA-7 — `navigator.onLine` is treated as the truth, so two UI surfaces claim "Online" on a dead connection

- **Severity / confidence:** S4 · confirmed
- **Where:** `hooks/use-online.ts:21-25`; consumed by `components/offline-banner.tsx:38-40` and
  `components/home-bento.tsx:58,219-222`
- **What breaks:** `navigator.onLine` reports only that a network interface exists, not that anything is
  reachable. On captive-portal wifi, a dead uplink, or a hotel AP that resolves nothing, it stays `true`:
  the offline banner never renders, and the Home "Connection" tile reads **"Online — Everything saves on
  this device"** while every network-dependent surface (weather, currency rate, Firestore sync,
  concierge) silently fails. The offline state the worker is actually serving from is invisible to the
  user, which is the one moment the banner exists for.
- **Trigger:** join a captive-portal wifi without signing in, open the app → banner absent,
  `home-bento-connection` reads "Online", while the concierge and weather cards fail.
- **Evidence:**

  ```ts
  setOnline(navigator.onLine);
  const goOnline = () => setOnline(true);
  const goOffline = () => setOnline(false);
  ```

  No reachability probe anywhere; `grep -rn "caches\." app components hooks lib` returns nothing, so the
  client never asks the worker what it is actually serving.
- **Root cause:** the single connectivity signal is the browser's link-layer flag, with no corroboration
  from an actual request.
- **Fix:** keep `navigator.onLine` as the fast negative — it is reliable when `false` — and corroborate
  the positive from traffic the app already makes. `useOnline` is the one shared place for this. Cheapest
  correct version: flip to offline when a same-origin/API fetch rejects, and back on the `online` event;
  the currency and weather clients already detect that failure and swallow it.

## A11Y-5 — `motion-loops.mjs` cannot see the sub-6 s infinite loops that ship from Tailwind's own stylesheet

- **Severity / confidence:** S4 · confirmed
- **Where:** `scripts/motion-loops.mjs:31` (`CSS_PATH` → `app/globals.css`, the only file it reads); live
  loop sites `components/journal-browse.tsx:256`, `components/photo-attach.tsx:279`,
  `components/trip-story-recap.tsx:418` (`animate-pulse`, 2 s infinite),
  `components/import-place-sheet.tsx:289`, `components/ui/button.tsx:66` (`animate-spin`, 1 s infinite)
- **What breaks:** nothing at runtime today, and that was verified: `document.getAnimations()` under
  `reducedMotion: reduce` returns `running=0` on all 13 routes polled, because the universal
  `animation-iteration-count: 1 !important` in the globals.css reduce block collapses them. The defect is
  in the *audit*: the script's whole premise is "the next sub-6 s loop is caught", and it is structurally
  blind to five that already exist, because they are emitted into Tailwind's stylesheet rather than
  `app/globals.css`. It also fails closed only on what it can parse, so the blind spot is silent.
- **Trigger:** `node scripts/motion-loops.mjs` prints exactly two loops (`.animate-shimmer`,
  `.animate-today-pulse`) and passes, while `grep -rn "animate-pulse\|animate-spin" app components`
  returns six sites, five of them unguarded by any `motion-safe:` prefix.
- **Evidence:**

  ```
  scripts/motion-loops.mjs:31  const CSS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../app/globals.css');
  components/trip-map.tsx:1199        <MapPin className="w-6 h-6 motion-safe:animate-pulse" />   ← the only guarded one
  components/journal-browse.tsx:256   <div className="h-full w-full animate-pulse bg-white/[0.04]" aria-hidden="true" />
  ```

  Six sites, one `motion-safe:` — the inconsistency shows the guard was a per-author decision, which is
  what the audit was written to stop being.
- **Root cause:** the script reads the CSS file rather than the built stylesheet, a choice its own header
  defends ("the CSS *is* the fact"). That holds for hand-authored keyframes and not for utilities Tailwind
  generates.
- **Fix:** cheapest correct move is a second grep pass in the same script over `app/` + `components/` +
  `lib/` for `\banimate-(pulse|spin|bounce|ping)\b` that fails unless the class carries a `motion-safe:`
  prefix or the selector is in `STATE_INDICATORS`. It keeps the one-script contract and needs no build
  step. Scanning `out/_next/static/css/*.css` instead would also work but couples the audit to a prior
  `npm run build`.

---

# Duplicates and out-of-repo items

## Duplicates

Two pairs describe one defect each. Both ids are kept in the table because they were found
independently and each half carries evidence the other does not; the write-ups above are merged.

- **SYNC-1 = DATES-3.** Same root cause, same file, same line: the `?today=` override reaches
  `ClockPort.now()` and therefore the HLC `pt`. The sync half additionally found the tombstone-GC horizon
  reading the same faked clock and the GC'd result being written back to Firestore; the dates half
  additionally found the `DATE_RE` amplifier that lets `9999-12-31` and `0000-00-00` through. One fix —
  an override-free clock on the sync path — closes both. Count this as one defect when triaging.
- **CONTENT-7 + DATES-6 = one defect, two halves.** A custom trip's date span is unbounded (DATES-6) *and*
  its dates are never checked for validity (CONTENT-7); both land on `sanitizeTripConfig`, which is the
  declared trust boundary for a config block from the create form, a peer's trip-meta doc, the synced
  trip list, or disk. The two halves disagree on nothing, but they differ in confidence — the validator
  half was run against the verbatim gate (confirmed), the create-form half was measured but not driven
  through the UI (likely). Fix them together in `sanitizeTripConfig`, and bound the span in the create
  form as well so the mistake is reported rather than absorbed.

Related but *not* duplicates, worth fixing in the same pass:

- **SYNC-2 is the missing defence for SYNC-1/DATES-3.** `hlcReceive`/`MAX_SKEW_MS` were written to clamp
  exactly the implausible `pt` that `?today=` mints, and they have no production callers. Wiring the
  clamp into `hlcSendOrLocal` bounds the damage from any far-future clock, faked or merely wrong; it does
  not remove the need for the override-free clock.
- **PWA-1 and PWA-3 share a fix surface.** Precaching `index.txt` without also stripping `_rsc` from the
  cache key leaves offline soft navigation still hard-reloading, so (a) and (b) of PWA-1 and the
  `cacheFirst` key normalization in PWA-3 are one change.
- **CONTENT-5 and CONTENT-8** are the fifth and sixth surviving sites of the D-307 unguarded-object-index
  class. Same one-line idiom, two files.
- **DATES-1 and DATES-5** are both "two producers of one number disagree"; DATES-5's fix is already
  written in `lib/travel-date.ts` and just needs copying, while DATES-1 needs the seam decision first.

## Not fixable in this repo

- **CONCIERGE-2** is server-side. The client half of #10 shipped; the membership gate exists in a Worker
  version that was never deployed, so no change in this repo can make the gate real. What *can* be done
  here is to stop asserting a check that does not run — see the fix note in that section. Any client-side
  gating added on top of it guards nothing.
- **PWA-2's** impact depends on a second Pages project existing on the same origin. The fix is in this
  repo (`scripts/gen-sw.mjs`), but the impact cannot be reproduced from this repo alone, which is why it
  is recorded as likely rather than confirmed.
- **PWA-5** cannot be triggered from the app at all: it needs a rejecting `CacheStorage.match`. The fix is
  a brace move, and the finding is kept only so the asymmetry is on record.
- **MONEY-4** was not confirmed because Excel was not available in the environment the sweep ran in. The
  code fact — no BOM is emitted anywhere — is confirmed.
- **CONCIERGE-3** was traced across all four boundaries but not rendered in a browser, so the anchor
  behaviour itself is inferred. The absence of validation at every one of those boundaries is certain.

## Gaps in the checks, not in the app

Three findings are about a gate that cannot see what it claims to cover. They are cheap and they are
what let the rest of this list survive a green suite:

- **A11Y-5** — `scripts/motion-loops.mjs` reads `app/globals.css` only, so five Tailwind-emitted infinite
  loops are invisible to it.
- **A11Y-4** — `e2e/fixtures.ts:75` suppresses the toast layer for every spec, so no axe scan ever runs
  against the state a first-time visitor is in.
- **PWA-1** — every offline navigation under `e2e/` is a `page.goto`; no offline test ever clicks a
  `<Link>`, which is the only path the defect takes.

Add to those the tests that pin current behaviour rather than correct behaviour, each named in its
section: `lib/__tests__/expense-export.test.ts:78` (STORAGE-1),
`lib/__tests__/settlement.test.ts:157` (MONEY-2),
`lib/__tests__/storage-persistence.test.ts:204,301` (REACT-5),
`lib/__tests__/use-concierge-chat.test.ts` (CONCIERGE-4 and CONCIERGE-6).
