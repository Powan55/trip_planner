# Multi-trip hydration mount-gate audit (S234)

Scope: every `dynamic(…, { ssr: false })` / mount-gated client island, audited for the assumption
that the **active pack is the default pack**: hardcoded storage literals, module-scope caches of
pack-derived values, and cross-tab `storage` listeners keyed on a fixed literal. Companion to the
`e2e/multi-trip-isolation.spec.ts` net and the `lib/__tests__/multi-trip-sync-path.test.ts` probe.

## How the island set was enumerated

```
grep -rn "ssr: false\|ssr:false" app/ components/ hooks/ lib/   # every ssr:false island
grep -rhn "dynamic(() => import" app/ components/                # the 38 dynamic component imports
```

Then, for each island, its trip-scoped storage touch-points were resolved by mapping the
trip-scoped domain hooks/stores to their consuming components:

```
for h in use-itinerary use-budget use-expenses use-journal use-favorites use-photos \
         use-packing use-docs day-anchor shareInbox weatherCache itinerary-storage; do
  grep -rln "$h" components/
done
```

38 dynamic islands were found (full table below). No island was found that (a) hardcodes a storage
key literal itself, (b) caches `getTripId()`/`keyFor()` at module scope, or (c) reads a
pack-derived value at import time. The only `getTripId()` reads in island code are inside `useEffect`
(mount-time, re-evaluated after the pack-switch reload): `trip-join-handshake.tsx` and
`settings-panel.tsx`'s `TripGroup`. So no island has a structural mount-gate defect of its own.

Pack-sensitivity is therefore inherited entirely from the **domain layer** (the gateway accessors +
reactive stores), not from any island. That surfaced the real finding below.

## Headline finding: S234-F1 (domain-layer, not island-layer)

`keyFor()` is called for **only** the itinerary Vault (`lib/itinerary-storage.ts`, via
`hooks/use-itinerary.ts`). Every other domain the gateway lists in `TripScopedSlot`
(`expenses`, `budget`, `journal`, `favorites`, `photos`, `packing`, `docsChecklist`, `dayAnchors`,
`shareInbox`, `weatherCache`, `syncOutbox`) is read/written by its gateway accessor
(`expensesStore.set → writeJson('local', STORAGE_KEYS.expenses, …)`), which uses the **default
literal key**, never `keyFor(slot)`. Being *in the `TripScopedSlot` union* only makes the slot
*eligible* for `keyFor`; it does not route the accessor through it.

Consequence: on a **non-default pack**, every one of those domains reads and writes the **default
pack's** localStorage key. That is a local-data bleed: the new pack shows the default's
budget/expenses/journal/packing/docs, and editing them overwrites the default pack's data. Only
itinerary is correctly isolated locally; the **remote** Firestore paths are all correctly isolated
(every `*-remote.ts` composes `doc(db, 'trips', getTripId(), …)` per-call, proven in
`multi-trip-sync-path.test.ts` Part A).

Proven deterministically in `lib/__tests__/multi-trip-sync-path.test.ts` Part B:
`setActiveTripId(token)` then `saveExpenses([…])` writes `nepal_japan_expenses` (the default literal)
while `savePlans([…])` writes `trip:{token}:itinerary` (correctly scoped).

This is structural: ≈11 accessors plus their `has()` seed-checks plus 6 reactive-store
`storageKeys` literals across ~15 files, all on live-synced domains, with a real data-loss risk if
it is done carelessly. It is reported here, not fixed. Proposed remediation is a dedicated slice
plus a decision, reserved as **D-214**. It also generalizes the D-212 note, which framed the literal
`storageKeys` as merely a cross-tab nicety. The literal is the **primary persistence key** for
these domains, so the bleed is same-tab and permanent rather than cosmetic.

### Sub-finding: cross-tab reactivity (D-212, confirmed narrow)

Independently of S234-F1, the `createReactiveStore` `storageKeys` for expenses/budget/journal/docs/
packing/photos/favorites are plain literals (only itinerary uses the `() => [keyFor('itinerary')]`
function form). The `storage` (cross-tab DOM) listener therefore matches on the default literal. But:
same-tab reactivity uses the `CustomEvent` path (unaffected), and **remote**-applied updates dispatch
that same `CustomEvent` (`saveExpenses()` + `dispatchEvent(EXPENSES_CHANGED_EVENT)` in
`expenses-remote.ts`), so cross-device updates are unaffected too. The literal only degrades the
narrow case of *two tabs of the same browser on the same non-default pack live-updating each other*.
Once S234-F1's fix moves these domains to `keyFor`, the same fix should convert their `storageKeys`
to the function form, folding this sub-finding into the same slice.

## Island audit table

Verdicts: **safe** = pack-agnostic or correctly pack-scoped; **inherits S234-F1** = correct at the
island level but reads/writes an un-scoped domain, so it displays/edits the default pack's data on a
non-default pack (fix belongs in the gateway, not the island).

| Island (`components/…`) | Route(s) | Trip-scoped storage touched | Pack-sensitivity / verdict |
|---|---|---|---|
| `calendar-planner` | /plan | itinerary (scoped ✓), expenses | itinerary **safe**; expenses **inherits S234-F1** |
| `today-panel` | / | itinerary (scoped ✓) | **safe** |
| `trip-dashboard` | / | itinerary via `loadPlans` (scoped ✓) | **safe** |
| `trip-timeline` | / | itinerary via `loadPlans` (scoped ✓) | **safe** |
| `quick-add-host` | all (chrome) | itinerary via provider (scoped ✓) | **safe** |
| `quick-add-fab` | all (chrome) | none (opens host) | **safe** |
| `itinerary-provider`¹ | all | itinerary + opens remote subscribe | **safe** (itinerary scoped; remote `getTripId()` per-call) |
| `budget-panel` | /plan | budget, expenses, photos | **inherits S234-F1** |
| `settings-panel` | /settings | budget, expenses, journal (+ the Trip group, correct) | Trip group **safe**; budget/expenses/journal **inherit S234-F1** |
| `expense-log-host` / `expense-dialog` | all (chrome) | expenses | **inherits S234-F1** |
| `trip-recap` | / | expenses, journal | **inherits S234-F1** |
| `trip-story-recap` | /recap | expenses, journal, photos | **inherits S234-F1** |
| `journal-browse` | /journal | journal, photos | **inherits S234-F1** |
| `map-section` | /map | favorites, dayAnchors | **inherits S234-F1** |
| `plan-day-map` / `trip-map` | /map, /plan | favorites, dayAnchors | **inherits S234-F1** |
| `packing-checklist` | /packing | packing | **inherits S234-F1** |
| `docs-checklist` | /checklist | docsChecklist (also synced) | **inherits S234-F1** |
| `share-inbox` | /share | shareInbox | **inherits S234-F1** |
| `nepal-section` / `japan-section` / `recommendation-section`² | /nepal, /japan | favorites | **inherits S234-F1** |
| `travel-essentials-card` | /travel | weatherCache | **inherits S234-F1** (low-harm: per-city cache) |
| `trip-join-handshake` | all (chrome) | none, reads `getTripId()` in `useEffect` | **safe** (pack-aware by design, D-212) |
| `hero-section` | / | none (content) | **safe** |
| `home-section-nav` | / | none (nav) | **safe** |
| `navbar` / `footer` / `bottom-tab-bar` | all (chrome) | none (identity/guest app-scoped) | **safe** |
| `flights-section` | /flights | none (static content) | **safe** |
| `photography-guide` | /nepal, /japan | none (static content) | **safe** |
| `country-essentials` | /nepal, /japan | none (static content) | **safe** |
| `nightlife-section` | /japan | none (`nightlifeVisible` app-scoped) | **safe** |
| `legacy-hash-redirect` | / | none (routing) | **safe** |
| `travel-date-picker` | /travel | none (`todayOverride` app-scoped, session) | **safe** |
| `travel-essentials` / `travel-safety-kit` | /travel, /safety | none (static content) | **safe** |
| `travel-exit-button` / `travel-mode-mounts` / `travel-legibility-toggle` | /travel | none (`travelMode`/`travelReturn`/`travelLegibility` app-scoped) | **safe** |

¹ `itinerary-provider` is an always-mounted client provider (not a `dynamic` import) included because
it owns the itinerary hydrate + remote-subscribe seam. ² `recommendation-section` is a child of the
nepal/japan section islands (favorites live there).

## Bottom line

- **No island-level mount-gate defect.** No hardcoded literal, no module-scope pack cache, no
  import-time pack read; the pack-switch reload correctly re-seeds every island.
- **One domain-layer defect (S234-F1)**, inherited by every island that touches a non-itinerary
  trip-scoped domain. Reported, not fixed: it is structural, with a live-synced-data blast radius.
  Reserved as **D-214**.
- Itinerary (local) and all remote Firestore paths are correctly pack-isolated today.
