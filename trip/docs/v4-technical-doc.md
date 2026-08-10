> **Historical: superseded by v5; kept for reference (2026-07-23).**

# v4 Technical Doc

_Companion to the v4 plan (repo root). Purpose: the technical treatment of the v4 plan, covering contracts, data-model changes, migration order, risk register, and test strategy, so review of the eventual M16 slices starts from a shared blueprint rather than re-derivation. Produced 2026-07-06 from the v4 audit: two independent codebase sweeps plus the S110 review lanes' findings._

---

## 1. Current-state summary (what v4 builds on)

- **Layering (post-M15):** pure framework-free `core/` (itinerary CRUD, vault envelope/migrations, HLC + per-day item-level merge, budget/expenses/journal models, dates/trip-cities, countdown) → thin React hooks (`use-itinerary` 342, `use-expenses` 146, `use-journal` 122) → components. Ports: `StoragePort`/`SyncPort` (`core/ports.ts`), production adapters in `lib/itinerary-ports.ts`.
- **Persistence:** typed storage gateway (`core/storage/gateway.ts`, ~400 lines, keys 1–13) over localStorage; itinerary rides the versioned Vault (currently `CURRENT_ITINERARY_VERSION = 4`) with ordered migrations + corruption quarantine (D-091).
- **Sync:** itinerary only. `lib/itinerary-remote.ts` (600) + `core/sync/{hlc,merge-day,stamp}.ts`; per-day Firestore docs, item-level HLC merge, tombstones; everything gated on `isRemoteConfigured()` so the dormant build is byte-identical (D-038). Per-item `done` rides the itinerary schema, so it syncs.
- **Not synced (per-device):** expenses (key 11), budget (key 10), journal (key 12), packing checklist (key 6).
- **Reactivity:** hand-rolled CustomEvent (`*:changed`) + native `storage` event, re-read-from-storage-on-event; the pattern is duplicated ~3× and budget bypasses hooks entirely (read ad hoc in `budget-panel.tsx`).
- **PWA:** hand-rolled SW (`scripts/gen-sw.mjs`, ~250 lines; D-073 update flow) coupled to the custom webpack `output.filename` contenthash scheme in `next.config.js`.
- **Test net:** Vitest 404 (pure core + hook sync suites), Playwright 117-equivalent (persistence, countdown fake-clock, interaction, budget/expenses/journal, PWA, axe ×2, 18 visual baselines), CI "No Green, No Deploy" (D-101). This net is the enabling asset for every risky change below.
- **Traceability convention:** D-NNN decision IDs inline in comments.

## 2. Time-model change (plan #2): the one schema change with app-wide display reach

**Today:** `ItineraryItem.time?: string` and `duration?: string` are free text (`"14:30"`, `"2pm-ish"`, `"morning"`). `lib/whats-next.ts` `nextUp()` parses lexicographic `HH:MM` and treats malformed values as untimed.

**Target model:**
- Additive fields: `startMinutes?: number` (0–1439, wall-clock minutes-from-midnight **in that day's city**) and optionally `durationMinutes?: number`. The legacy `time` string is retained and becomes a fallback display plus a migration source.
- **Semantics decision (record as a D-number):** a time is the *local wall-clock at the place*, not a UTC instant. No timezone conversion is ever performed for display; the NPT/JST badge is derived from the day's country (`getCountryForDate`), city via `core/dates/trip-cities.ts`. Nepal is UTC+5:45 and Japan UTC+9, but because times are wall-clock-at-place and each item belongs to exactly one dated day whose place is known, cross-TZ math only enters in one spot: the Up-Next rail's "is this item in the past" comparison, which must compare against the device clock *interpreted in the trip city's offset* when the device TZ differs (pre-trip demoing via `?today=`; during the trip the device is in-zone and this is a no-op). Keep that as a pure function in `core/` with explicit-offset injection, and no `Date` TZ tricks (the B-01 lesson).
- **Migration (Vault v4 → v5):** parse legacy `time` strings best-effort (`HH:MM` and common variants) into `startMinutes`; unparseable strings keep `startMinutes` undefined (item renders as untimed with the legacy text shown). Lossless: never drop or rewrite the original string. This is migration #3, on the same discipline as v3→v4: append-only, deterministic, no clock reads, full round-trip tests. The process rule from S97 applies: any Vault-version slice runs the full E2E, not just unit.
- **AM/PM presentation:** presentation-layer only (`formatTimeAmPm(startMinutes)`), custom touch-friendly picker component (hour/minute/AM-PM columns or a dial; must meet 44px targets, D-021 focus contract, reduced-motion). No native `<input type="time">` (inconsistent 12/24h rendering across platforms is the exact complaint).
- **What this enables:** stable sort-by-time within a day (untimed items sink, stable order preserved among them), per-day timeline view, and overlap warning `(a.start < b.start + b.duration) && (b.start < a.start + a.duration)`, warn-only UI, never blocking (free-text durations mean fuzzy reality).
- **Sync compatibility:** additive optional fields ride the existing per-item rev/hlc merge unchanged; old clients ignore unknown fields (mixed-fleet note D-107 applies: coordinate a friends' reload after deploy).

## 3. Planner overhaul contracts (plan #1/#3/#4)

**Inline quick-add (fast path):**
- A one-line input per day (calendar day view + agenda + Today panel): title → Enter → `addItem(date, {title, category: 'other'})` via the existing store; everything else editable later. Must not regress D-018 (four-state read, delete-all-stays-empty), and it writes through the same `commit()` choke-point.
- Full editor remains for detail edits; ItemEditor becomes a portal bottom-sheet on `<lg` (the `place-detail-sheet.tsx` idiom; portal-to-body already mandatory per FU-11/D-094).

**Undo (generalized deferred-commit):**
- Adopt the budget panel's proven pattern (`use-expenses.restoreExpense` restores same-id): destructive ops keep the removed payload in memory, show a sonner toast with Undo, and restore-by-same-id on click. **Sync-on nuance:** this is the S110 F1 lesson. A delete under sync is a tombstone, and `merge-day.ts`'s `resolvePair` (lines 54–81) only lets a same-id restore beat the tombstone if its HLC is **strictly greater**, biasing the tombstone on a tie. So undo must either re-insert with a **fresh id** (tombstone-source + fresh-id pattern, D-032 generalized) or re-stamp the same id with a strictly-later HLC. Spec the choice per operation; it is the #1 correctness trap in this tier. (Consistent with the S110 rider: Backup Restore stays local-mode-only until the tombstone-replace follow-up lands.)
- Applies to: item delete, clear-day, multi-select delete, drag mistakes (optional).

**Clear-whole-day:**
- `clearDay(date)` in `core/itinerary/crud.ts`: dormant = physical remove of all items; sync-on = tombstone every item (rev/hlc-stamped) in one commit/push (one per-day doc write, which is Spark-quota friendly, D-088). Confirm dialog + undo toast (restores the full item list, fresh ids under sync). D-018 guarantee: the cleared day is a legitimate empty state; never re-seeds.
- E2E: clear → reload → still empty; clear under fake sync harness → tombstones present in raw payload, zero live items (the S98 persistence-spec precedent for build-dependent assertions).

**Multi-select + copy-day:**
- Pure core ops: `moveItems(date[], targetDate)`, `deleteItems`, `copyDay(src, dst)`, where copy generates fresh ids (never reuses ids across days; dup-id dedupe note from TL-A). All compose through the existing chained-composition property (D-031 tests extend).

**Split map/list view (`/plan`):**
- Extract a reusable `<TripMap>` module from `map-section.tsx` (init, style, markers, polyline drawing). This is the #22 component split, done as the enabling refactor rather than a separate slice. `/map` re-composes it; `/plan` embeds a day-scoped instance.
- Live re-draw: subscribe to the itinerary store (`ITINERARY_CHANGED_EVENT`) and re-set the polyline source data on reorder. MapLibre `setData` is cheap; no camera move on reorder.
- **Pin-drop:** additive `lat?/lng?` on `ItineraryItem` (schema + Vault: additive-optional, no version bump needed, per the S98 `done` precedent where absent = un-pinned). Custom items with coords plot on both `/plan` and `/map` overlays; the silent name-match fallback stays for legacy items, but the overlay gains a "N of M stops shown" count so dropped items are no longer invisible.
- Budget: `/plan` first-load is 184 kB against the 220 budget. MapLibre must stay an interaction-lazy chunk (load on view-toggle/visibility, S107 island pattern) or the route blows its budget. This is a hard DoD line.

## 4. Sync Everywhere design (plan #6)

- **Scope:** expenses + budget sync; journal explicitly stays local (privacy-by-design, record the D-number); packing optional (cheap rider if wanted).
- **Shape:** expenses are id-keyed rows, so the itinerary merge generalizes: per-item `rev/hlc/deleted` stamps, `mergeItems` over an id-keyed collection (the existing `mergeDay` minus the day partition). Budget is a small singleton config doc, so LWW-per-field with HLC is sufficient (no tombstones needed; it's a struct, not a list).
- **Firestore layout (Spark math, D-088):** `trips/{tripId}/expenses/{chunk}`, chunked by month or leg (2 legs) rather than per-expense docs; budget = one doc. Reads on snapshot, transactional merged writes (the `pushDayMerged` read→merge→set pattern). Expected volume (3 friends × ~10 expenses/day × 32 days ≈ 1k rows) fits comfortably in 2–3 chunked docs.
- **Invariants carried over (each is a DoD line, not a hope):** dormant build byte-identical (all stamping/tombstoning gated on `isRemoteConfigured()`, D-038); echo-suppression (push only from `commit()`, never from snapshot-apply, D-039); first-snapshot-authoritative vs steady-state-merge split (D-091/D-018 empty-state parity); guest gate (`getActiveTraveler()` required before any push, the S110 F2 lesson, D-055).
- **Offline outbox (TL-A P2):** a gateway-keyed queue of pending pushes, flushed on `online`/visibilitychange/app-start; retry-safe because merged writes are commutative/idempotent by construction. Design once in `core/sync/outbox.ts` and share across all synced domains (itinerary adopts it too, which closes the P2). A blueprint slice is required before build, since this is a new subsystem.
- **Store factory prereq (#21):** `createReactiveStore<T>(key, coreOps, syncPort?)`, extracting the shared hydrate/listen/commit skeleton; migrate journal → expenses → budget (gaining its missing hook) → itinerary last, under its frozen nets. Event names, hydration gating, and the D-026 storage-key listener contract are frozen: byte-identical event strings, no consumer edits.

## 5. Design-system pass (plan #5): constraints, not vibes

- **`SectionHeading`:** one component consuming the display scale (`display-md/lg` + `eyebrow`), replacing the ~6 hand-copied `font-display text-3xl sm:text-4xl…` mastheads (`calendar-planner`, `recommendation-section`, `map-section`, `country-essentials`, `travel-essentials`, `photography-guide`). It must embed the one canonical reveal helper (below); the current per-file "slide-only, opacity pinned" axe workaround comments get centralized with it.
- **One reveal idiom:** a single `Reveal` helper (slide-only whileInView, opacity pinned at 1, reduced-motion → static) replacing both the inline framer variants and the underused CSS `.reveal-stagger` for section mastheads. Hard rules it must encode: D-100 (axe-deterministic reveals, no opacity-0 states that hide content from the scanner; the S110 F12 convention) and the house reduced-motion neutralization.
- **Glass depth hierarchy:** the adoption map is nav/tab-bar/modals = `glass-panel` (top layer), primary cards = `glass-card`, inset/secondary = `glass-subtle`. This is a class-swap pass; 18 visual baselines will regenerate. Regenerate once, deliberately, in the canonical CI environment, as its own commit, never mixed into a logic slice.
- **Micro-interactions inventory (all framer, all `useReducedMotion`-gated):** done-toggle spring tick; expense-save count-up (the `use-count-up` hook exists and is currently underused); add-to-plan flying chip (respect D-071 z-ladder); day-strip snap physics (CSS scroll-snap, already partial). Each must keep the contrast/44px/focus rules from the S110 sweep (F4/F7 fixes are the floor, not the ceiling).
- **Perf guard:** the design pass may not regress the S107 win. Home First Load JS stays ≤ 92 kB-ish, and any new shared component must not drag framer-motion into a route that lazy-loaded it.

## 6. Data-model changes (consolidated)

| Change | Mechanism | Vault version? | Sync impact |
|---|---|---|---|
| `startMinutes`/`durationMinutes` | additive optional + best-effort migration from `time` | **v4→v5** (migration #3) | rides item merge; old clients ignore |
| `lat`/`lng` pin-drop | additive optional | no bump (S98 `done` precedent) | rides item merge |
| Multi-day span (`endDate?` or `spanDays?`) | additive optional; render-layer expansion (item stays owned by its start day; do not multi-home one item across day docs, it breaks the per-day merge) | no bump | rides item merge |
| Favorites | new gateway key 14, `Record<placeId, true>` | n/a (not Vault) | local-only v4.0; sync candidate later |
| Expense `paidBy?`/`split?` | additive on expense rows | n/a (expenses aren't Vault) | part of #6's merge design |
| Photos | **IndexedDB via a new `BlobStorePort`**, not the localStorage gateway (quota); metadata (ids, captions, day-keys) stays in a gateway key | n/a | never syncs (D-038-style privacy; photos never leave the device) |
| Post-trip mode | pure derivation from the trip clock (`isPostTrip()` in `core/dates/`), `?today=`-overridable for demo/QA | n/a | none |

## 7. Platform-upgrade impact matrix (plan #23, gate G3)

- **Next 14.2.35 → 15/16:** the breaking surfaces in this codebase are: (a) `output: 'export'` + basePath, supported in 15, verify parity; (b) the custom webpack `output.filename`/`chunkFilename` override that `scripts/gen-sw.mjs` precache-hashing depends on, where the coupling must be re-proven or the SW regenerated approach revisited (Workbox/Serwist becomes viable if the constraint lifts); (c) S107's client-page lazy-island pattern (`app/page.tsx` is `'use client'` with component-reference props), so re-verify chunk splitting behaves the same; (d) fetch/caching default changes are server-side and largely moot for a static export. **FU-17 verification:** byte-hash `out/_next/static/chunks/polyfills-*.js` before/after. The win is only claimed if the chunk is gone from `out/` and the SW precache manifest (S106's honest-evidence precedent).
- **React 18.2 → 19:** ripple through Radix (43 `ui/` files), framer-motion (needs the 11/12 major anyway), `react-day-picker`-class deps are already gone (S109). Peer-dep sweep + full net.
- **Order:** upgrade first in v4 (Phase 0), one slice per major (Next, then React, then framer/maplibre), full frozen net between each, never bundled with feature work. Rollback = git revert per slice; the mirror only ever receives a green tree (D-101 gate).
- **eslint-config-next 15.3 vs next 14** is already mismatched; normalize as part of the same slice.

## 8. Risk register & test strategy

| Risk | Guard |
|---|---|
| Time migration mangles real trips | Migration #3 unit suite (round-trip, unparseable-preserved, idempotent) + full E2E per the S97 process rule + export/import spec updates |
| Undo-under-sync resurrects/duplicates (D-032 class) | Per-op fresh-id spec written into each slice spec; mutation-proof tests like S110 F1's (fail-while-mutated) |
| Clear-day nukes a friend's concurrent adds | Merge property tests: clear(dayA) ∥ add(dayA) converges to the add surviving iff its hlc > clear's; two-client spec extends `sync-two-client.spec.ts` (still live-QA-gated on the emulator/JDK ceiling, same skip-with-documentation pattern) |
| Split-view drags `/plan` over its 220 kB budget | MapLibre stays interaction-lazy (island); route-table budget is a DoD line per slice |
| Design pass breaks visual/axe nets | Baselines regenerated once, deliberately, own commit; D-100 encoded in the shared `Reveal`; axe pack must stay 0 serious/critical incl. the in-trip spec (S110 F19) |
| Platform upgrade destabilizes everything | Phase-0 sequencing, one-major-per-slice, frozen net between; FU-15/16 flake fixes land first so red means red |
| Sync Everywhere Spark-quota blowout | Chunked docs (see section 4), write-coalescing through `commit()`, quota math in the architecture blueprint with margins |
| New surfaces regress a11y | The S110 floor (contrast ≥4.5, 44px, focus mgmt, aria-live scoping) is in every slice's constraints section |

**New test nets needed:** time-picker + clash unit suite; clear-day/multi-select/undo E2E; split-view visual baselines (3 viewports); expenses merge property tests (commutative/idempotent, the S96 500-pair pattern); outbox flush/retry unit + offline E2E; IndexedDB quota + fallback tests; push-permission flows (gated track); post-trip mode flip via `?today=` (rides the S82 fake-clock harness).

## 9. Decision gates (what a slice must be held against)

| Gate | LOCKED decision(s) touched | Status required before build |
|---|---|---|
| G1 (#19/#20) | D-002/D-004 | Explicit owner greenlight; free-tier only (D-088) |
| G2 (#7) | D-002 (amend to local-first incl. IndexedDB) | Amendment recorded in DECISIONS.md |
| G3 (#23) | D-077 ("Next 15 rejected for now") | Revisit recorded; supersede properly |
| G4 (Trip Packs) | D-006 (+D-013 history) | Deferred to v5; reject any slice that smuggles it in |
| G5 (rules) | D-044 | Manual deploy, not a code slice |
| Everything else | D-018, D-021, D-026, D-031, D-038, D-039, D-055, D-071, D-088, D-091, D-100, D-102 | No gate needed, but each slice spec quotes the ones it binds |

_Review posture: every M16 slice cites the section of this doc it implements, and deviations are flagged explicitly rather than silently absorbed. A blueprint precedes build for section 2 (time model), section 4 (Sync Everywhere + outbox), and the G2 photo port._
