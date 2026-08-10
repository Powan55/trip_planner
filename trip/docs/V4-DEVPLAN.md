> **Historical: the M17/v4 plan, completed and superseded. v5 (`V5-DEVPLAN.md`) rebuilt this scope, and the final version's scope lives in `V-FINAL-DEVPLAN.md`. Its dependency pins are dead — line 487 reads next 14.2.35 / react 18.2.0 / framer-motion 10 / maplibre 4, against the shipped next 15.5.20 / react 19.2.7 / framer-motion 12.42.2 / maplibre-gl 5.24.0 — and section 7's gate G5 (the `firestore.rules` uid-allowlist, FU-18) was retired outright by D-205. Kept because DECISIONS.md, `photo-storage-blueprint.md`, `sync-everywhere-blueprint.md` and `V-FINAL-DEVPLAN.md` all cite it by name.**

# v4 Dev Plan

_Written 2026-07-07. This document revises the proposed the v4 plan (29 items, 3 tiers) into a slice-by-slice plan that is ready to build. It is grounded in `docs/v4-technical-doc.md`, which stays authoritative on contracts and migrations; any deviation from it is called out explicitly. At the time of writing, M16 is complete and nothing is in flight. Milestone label: **M17**. Slice numbering continues from S113, so **S114 onward**._

---

## 1. Executive summary of changes vs the v4 plan

Only deltas are justified; everything not listed here is kept as proposed.

1. **Added: trip-content layer consolidation** (new Tier-1 item #0; slices S121–S122). This is the direct answer to the standing pain point. S112 required hand-editing `lib/sample-itinerary.ts`, `core/dates/trip-cities.ts` and `lib/booking-data.ts` in lockstep for a pure content change. The fix is one schema-validated content source, the city map *derived* instead of duplicated, a validation script, and a runbook, so a future plan swap becomes a one-file content slice. This deliberately does not pull G4 (Trip Packs) forward; see section 3.3.
2. **Re-scoped: item #7 split in two.** The text-only post-trip story recap needs no IndexedDB and therefore no G2. It is pure derivation (`isPostTrip()`) plus composition of data the app already has: journal, plan-vs-actual, spend. It moves into ungated Phase 3 (S156). Only *photos* stay behind G2 (S159–S161). That removes the "app expires Jan 9 if a gate stalls" failure mode.
3. **Re-scoped: #22 component splits dissolved into their feature slices**, as section 3 of the technical doc itself directs. The `map-section.tsx` split becomes the `TripMap` extraction slice (S135, which enables the split view); the `calendar-planner.tsx` split rides the planner-overhaul slices; the `budget-panel.tsx` split rides expense split (S144). There is no standalone "split components" slice, which avoids double-touching files.
4. **Merged: Tier-3 items absorbed into concrete slices.** #24 absorbs FU-3 + FU-21 (S115); #25 absorbs FU-14/FU-15/FU-16 (S114, S119); #27's tombstone-replace Restore + gcTombstones become S145 plus a blueprint line-item; the sonner-override retirement stays a standing rider on any future sonner bump, with no slice of its own.
5. **Re-sequenced: Phase 0 internal order.** Flake source fixes (FU-15/16) land first so red means red for everything after. The dep prune lands before the majors: smaller upgrade surface, fewer peer-dep conflicts. FU-1, the DECISIONS.md archive split, is overdue past its size wall and is scheduled before the blueprint-heavy Phase 1, which will append many entries.
6. **Re-sequenced: design foundation before planner visuals, micro-interactions after.** `SectionHeading`, the canonical `Reveal` and glass adoption (S132–S133) land early in Phase 1 so every new v4 surface is born conformant to the token system. The micro-interactions pack (S134) lands after the planner overhaul so it animates final surfaces, not surfaces about to be rebuilt.
7. **Corrected: a stale dep claim.** FU-3 says `react-intersection-observer` has no importers. That is false, verified this pass: S107's `components/lazy-visible.tsx`, the Home lazy-island primitive on the hot path, imports `useInView`. The prune slice (S115) must replace it with a native IntersectionObserver hook first, exactly as the v4 plan #24 already said.
8. **Kept: G1/G2 tracks gated in Phase 4; G4 deferred to v5 (endorsed); G5 manual, done by the account owner, and independent.** One sequencing nuance is added: if G2 is approved, the photo-capture slices should land before Dec 9, because photos are taken *during* the trip. Only story-mode integration is post-trip work.
9. **Net shape:** 29 items become **53 slices** (Phase 0: 7 · Phase 1: 18 · Phase 2: 7 · Phase 3: 13 · Phase 4: 8). At demonstrated velocity (~110 slices/5 weeks across M0–M15) this is comfortable before Dec 9, with Phase 3 items individually droppable as schedule buffer.

---

## 2. Revised feature plan

### Tier 1: major (the headline)

**#0 (new). Trip-content layer consolidation, "edit the trip in one file."** One schema-validated content module owns the canonical trip content: day-by-day itinerary seed, per-day city map, guide cards, nightlife venues, bookings/journeys. `TRIP_CITIES` becomes a *derivation* of the itinerary content, retiring the parallel-map and anti-drift-test duplication. All content parses through Zod schemas via `npm run validate:content`, and `docs/trip-content.md` documents the swap procedure, including the honest caveat that a seed swap does not rewrite the friends' live synced trip: sync data is authoritative, and the seed governs fresh devices and guests. Slices S121–S122.

**#1. Planner CRUD overhaul, "the 5-second edit"** *(owner request #1)*. As proposed: inline quick-add row (title, then Enter, with no modal on the fast path), undo toast on every destructive action generalizing the budget panel's proven pattern, duplicate-item, swipe-to-delete on mobile, and ItemEditor as a portal bottom-sheet on `<lg`. The tombstone/fresh-id sync trap from section 3 of the technical doc is treated as the tier's #1 correctness risk. Slices S127, S128, S131, plus S129/S130 below.

**#2. Structured local time with AM/PM** *(owner request #3)*. As proposed, per section 2 of the technical doc: additive `startMinutes`/`durationMinutes`, Vault v4→v5 migration #3 (lossless, legacy string preserved), wall-clock-at-place semantics with an NPT/JST badge, offset injection confined to one pure function, a custom touch-friendly AM/PM picker (no native `input[type=time]`), sort-by-time, a per-day timeline view, and warn-only clash badges. Architecture blueprint required first. Slices S123–S126.

**#3. Clear-day + bulk actions** *(owner request #2)*. As proposed: `clearDay(date)` (dormant means physical remove; sync-on means tombstone-all in one commit and one per-day doc write), confirm plus undo, D-018 cleared-day-stays-empty; multi-select, hidden until explicitly entered, with move/delete; copy-day with fresh ids. Slices S129–S130.

**#4. Split map/list planning view** *(flagship)*. As proposed: `TripMap` extracted from `map-section.tsx` as the enabling refactor, a day-scoped instance beside the `/plan` list, click-stop to marker highlight both ways, drag-reorder with live polyline `setData`, mobile bottom-sheet peek, and manual pin-drop for custom items (additive `lat`/`lng`, no Vault bump) with an honest "N of M stops shown" count. Hard DoD line: MapLibre stays an interaction-lazy island and `/plan` stays ≤ 220 kB. Slices S135–S137.

**#5. Design language v3, layered depth.** As proposed: `SectionHeading` retiring the ~6 hand-copied mastheads, one canonical `Reveal` with D-100 encoded, a glass-tier adoption map with a single deliberate baseline regen, then a micro-interactions pack (extended inventory in section 3.4). Slices S132–S134.

**#6. Sync Everywhere.** As proposed per section 4 of the technical doc: store factory prereq, architecture blueprint (per-domain SyncPorts, chunked Spark-safe Firestore layout, offline outbox, journal-stays-local privacy decision), then expenses sync, budget sync (LWW-per-field singleton), and the outbox closing FU-19 for itinerary too. Slices S139–S143, plus S145 for sync debt.

**#7a. Post-trip story recap (text), ungated (moved out of #7).** Pure `isPostTrip()` derivation plus a scroll-storytelling recap weaving plan-vs-actual (S105), journal and spend. Ships in Phase 3 regardless of G2. Slice S156.
**#7b. Photos (IndexedDB), gate G2.** `BlobStorePort` over IndexedDB (never the localStorage gateway), journal photos and expense receipts, D-038-style privacy (never leaves the device), story-mode integration. Slices S159–S161.

### Tier 2: mid (companion features, with the user-friendliness fixes noted in section 3.5)

**#8 Search-within-plan** (S147) · **#9 Multi-day items** (S148, additive span fields, render-layer expansion only, never multi-homed across day docs) · **#10 Favorites** (S149, gateway key 14, local-only in v4) · **#11 Expense split "who owes whom"** (S144, additive `paidBy`/`split`, pure settlement math, fast path defaulting to "paid by me / no split") · **#12 Multi-day weather forecast** (S150, Open-Meteo daily, keyless, D-088-clean) · **#13 Map trip-mode upgrades** (S151, search behind an icon, location toggle default-off and permission-prompted, directions links, schematic caveat) · **#14 Settings page** (S146, grouped with progressive disclosure; the notification section exists only once Pulse exists) · **#15 Travel-safety kit** (S152, static and offline) · **#16 Journal browse + recap/budget tie-in** (S153) · **#17 Global offline UX** (S154) · **#18 First-run tour** (S155, max 5 stops, skippable at every step, shows exactly once) · **#19 Trip Concierge / #20 Trip Pulse** (gate G1, S162–S166, server-side work that starts only after the owner greenlights it; the G1 blueprint must pass the hard D-088 no-card check or Concierge re-scopes to a client-side rule-based suggester).

### Tier 3: low (hygiene riders, now concrete)

**#21 Store factory** (S140, pulled into Phase 2 as the prereq it is) · **#22 Component splits** (dissolved, see section 1.3) · **#23 Platform refresh, gate G3** (S116–S118, one major family per slice, FU-17 byte-hash proof) · **#24 Dep hygiene** (S115) · **#25 CI hardening** (S114 + S119) · **#26 Nightlife added-feedback** (S138) · **#27 Sync-debt riders** (S145 plus blueprint line-items plus the standing sonner rider) · **#28 A11y residue** (S157) · **#29 Governance and small wins** (S120 FU-1 split; S158 CSV export + Home sticky nav; FU-6 stays an owner decision, unscheduled).

---

## 3. The six requirements, explicitly addressed

### 3.1 Add / remove / update features as I see fit
Section 1 is the change list. Nothing was cut outright. All 29 items survive in some form, but two were structurally re-shaped (the post-trip work split so that mode is ungated; component splits dissolved into feature slices), one was added (the content layer), and Tier 3 was converted from a wish-list into dated, owned slices. The one thing explicitly declined: any multi-trip machinery, which is G4 territory.

### 3.2 Efficient, user-friendly, and stays free
The phase order was sanity-checked and kept in shape but re-ordered internally (sections 1.5, 1.6 and 6). Every external touchpoint in this plan was re-verified against D-088: **Open-Meteo daily** (keyless, no account, no card, the same API family as the shipped D-108 weather); **Firestore Spark** (existing project, with chunked-doc quota math as a blueprint DoD line); **browser APIs** (IndexedDB, geolocation, Web Push receipt, free by construction); **GitHub Actions** (free tier, with the private-repo minutes cap already a Watch item); and the **Cloudflare Workers free plan** for the G1 track. That last one carries a hard blueprint-time verification that account creation and the chosen AI/push path require no payment information under any circumstance; if that check fails, the item is re-scoped (section 5, S162). Everything else in the plan is static data or client code, free by construction.

### 3.3 Easy to update / add / remove the trip plan(s)
Recommendation: do not pull G4 forward. Ship the content-layer consolidation (S121–S122) in early Phase 1 instead. The actual S112 pain was not "we need multiple trips." It was that one trip's content lives in four hand-coupled TS files pinned together by an anti-drift test, so a content swap needs an engineer doing archaeology. Trip Packs (G4) solves a different, much larger problem, a multi-trip engine that reinterprets LOCKED D-006 (dates, countdown anchor and city map all become per-trip data). It costs XL and competes with pre-Dec-9 trip-critical work. The light version delivers the felt benefit now: after S122, "swap the Kyoto days" is a one-file, schema-validated content slice with a runbook, and a future v5 Trip Packs would build on the consolidated layer rather than fight the current duplication. G4 itself stays deferred to v5 per the existing recommendation, the owner's gate to confirm (section 7).

### 3.4 Features and UI/UX polish, concrete rather than "add animations"
The inventory in section 5 of the technical doc is kept (springy done-toggle tick; expense-save count-up via the existing underused `use-count-up`; add-to-plan flying chip on the D-071 z-ladder; day-strip CSS scroll-snap physics) and extended with: **drag-lift** (shadow plus a slight scale while dragging a stop, settling with a spring on drop); **live polyline draw-on** when a day's route first appears in the split view; an **undo-toast progress ring** so the toast visibly drains its restore window; a **calendar day-cell pulse** when a quick-added item lands; **glass-tier skeleton shimmer** for lazy islands, replacing blank reservation space; and a **clash badge fade-in** that is passive and never modal. Every one is `useReducedMotion`-gated, axe-deterministic per D-100, and bound by the S110 contrast/44px/focus floor. The perf guard is a DoD line: Home stays ≈91–92 kB, and no shared component drags framer-motion into a route that lazy-loads it.

### 3.5 Never surface more than the user asked for
Per-surface disclosure rules, baked into the relevant slices' DoD. **Quick-add** is one input; everything else lives in the editor (S128). **Multi-select** is invisible until explicitly entered via one "Select" affordance or long-press, and exits on done (S130). **Clash warnings** are a passive badge on the item row, never a blocking dialog (S126). **Split view** is the desktop default; mobile stays list-first with a map peek the user summons (S136). **Pin-drop** is an "Add pin" option inside the editor, not a default step (S137). **Settings** are grouped, collapsed sections with sane defaults, destructive actions nested behind confirmation, and the notifications group renders only when Pulse exists (S146). The **first-run tour** is max 5 stops, skippable at every step, shows exactly once and never re-prompts (S155); this was the item most at risk of violating the rule, and it is fixed by construction. **Pulse** categories are all default-off and opt-in per category (S166). **Concierge** is pull-based, has one entry point, and suggestions never auto-insert (S164). **Location tracking** is a toggle that is default-off, permission-prompted, and persists nothing (S151).

### 3.6 Clean, premium, professional UI
No parallel aesthetic is introduced anywhere in this plan. The design pass makes the existing v2 token system (display type scale, 5-tier glass hierarchy, spacing/motion tokens) actually visible (S132–S134). Every subsequent new surface (split view, settings, safety kit, recap, story mode) is required by its DoD to consume `SectionHeading`, the canonical `Reveal` and the glass-tier adoption map, with the 18-baseline visual net and the one-deliberate-regen discipline (section 5 of the technical doc) enforcing it.

---

## 4. Risk-tiering heuristic (stated once, applied throughout)

Correctness-risk work: Vault/schema migrations, sync/merge/HLC/tombstone machinery, the outbox, architecture-adjacent refactors (store factory, `TripMap` extraction, content-layer refactor), framework majors, and anything on the risk register. These slices need the tightest specs, the most test evidence, and the most careful review.

Routine work on established patterns: new UI screens and components, styling and token adoption, static content and data, additive fields following an existing precedent, and small fixes.

Each slice below carries a one-line **Risk** note saying which side it falls on and why. The heuristic itself is not restated.

---

## 5. Slice breakdown (the actionable core)

**Standing DoD for every build slice (the house net, implied by everything below):** tsc clean · full Vitest green · dormant `next build` green with the route-table/budget check · full Playwright pack on served `out/` · relevant frozen nets untouched unless the slice explicitly owns them · every slice is verified by an independent re-run, not by assertion (D-089). Slice-specific DoD lines below are *in addition*.

### M17-Phase 0: platform floor (S116–S118 blocked on **G3**; the rest ungated)

**S114 — Test-net flake source fixes (FU-15 + FU-16)**
- **Goal:** make the test gate deterministic. Root-cause and fix the D-093 `/plan` CRUD-reload E2E flake (`next/dynamic ssr:false` plus the SW remount settle window) and the S96 HLC fuzz-test under-load timeout.
- **Risk:** root-causing nondeterminism in the harness that every later slice depends on. A "fix" that merely hides the flake poisons the whole milestone.
- **Depends:** nothing. **Blueprint:** no.
- **DoD:** the previously-flaky specs pass a 20× repeat run with retries disabled; `retries:2` may remain in config but is demonstrably no longer load-bearing; `docs/ci-flake-policy.md` updated with the root cause.

**S115 — Dep hygiene: prune the dead prod deps (FU-21 + FU-3 fold-in)**
- **Goal:** remove the 13 TL-C dead deps (lodash, gray-matter, csv, cookie, react-hot-toast, @headlessui/react, @floating-ui/react, react-use, react-is, tailwind-scrollbar-hide, @radix-ui/react-toast, react-select, webpack) and the vestigial pins (`@next/swc-wasm-nodejs`). Replace `components/lazy-visible.tsx`'s `react-intersection-observer` `useInView` with a native IntersectionObserver hook, then prune that dep too.
- **Risk:** low. A mechanical prune with the full net as the guard (the S108/S109 precedent), and the one code change (the native IntersectionObserver hook) follows a documented pattern.
- **Depends:** S114, so a red run means a real break. **Blueprint:** no.
- **DoD:** lockfile regenerated; route table unchanged, with **Home staying ≈91.2 kB**. `lazy-visible` is on the S107 hot path, so that number is the trap line. Full net before and after. Note that FU-3's "no importers" claim is stale, verified this pass.

**S116 — Next 14 → 15 (gate G3)** 🔒 *do not start until G3 is approved*
- **Goal:** the Next major lands alone: `output:'export'` plus basePath parity, the custom webpack `output.filename` / `gen-sw.mjs` precache-hash coupling re-proven, S107 island chunk-splitting parity, eslint-config-next mismatch normalized (already at 15.3 against next 14), and **FU-17 verified by byte-hash**, with the ~112 KB `polyfills-*.js` chunk gone from `out/` and from the SW precache manifest.
- **Risk:** a framework major with three known coupling traps called out in section 7 of the technical doc.
- **Depends:** S114, S115, and G3 approved. **Blueprint:** no, since section 7 of the technical doc is the contract. But if the webpack/SW coupling cannot be re-proven under 15, stop and escalate: switching SW strategy (Serwist or Workbox) is an architecture decision, not an in-slice improvisation.
- **DoD:** full net green on the upgraded tree; FU-17 byte-hash evidence pasted, following S106's honest-evidence precedent; rollback is a single revert. Next 16 is explicitly out of this slice. If 15 lands clean, a follow-on may be proposed (open question in section 9).

**S117 — React 18.2 → 19 (gate G3)** 🔒
- **Goal:** the React major lands alone, with a peer-dep sweep across the 43 Radix `ui/` files, next-themes and the rest.
- **Risk:** a major with app-wide ripple. Subtle behavior changes (effects timing, ref semantics) show up only in the full net plus careful review.
- **Depends:** S116. **Blueprint:** no.
- **DoD:** full net green. Note: if React 19 hard-requires the framer-motion major via peer errors, framer may ride along and S118 shrinks to maplibre. Flag that, don't absorb it silently.

**S118 — framer-motion 10 → 12 + maplibre 4 → 5 (gate G3)** 🔒
- **Goal:** the animation and map majors land together, per the technical doc's grouping: motion API breaks fixed across the existing inline variants, map init/style/marker APIs re-verified.
- **Risk:** two majors touching the motion system, where reduced-motion and D-100 behavior must not drift, and the map subsystem.
- **Depends:** S117. **Blueprint:** no.
- **DoD:** full net plus 18 visual baselines green with 0 unexplained pixel drift; reduced-motion sweep re-run; map E2E green.

**S119 — CI hardening (FU-14 + lint gate)**
- **Goal:** the deploy workflow fails if `package.json` version is byte-identical to the previous `main` commit, a backstop for D-102 which never auto-bumps. `next lint` becomes a gating CI step, since builds ignore lint today.
- **Risk:** low. CI YAML plus a small version-compare gate.
- **Depends:** S116–S118 landed, or G3 declined; don't gate lint mid-upgrade churn. **Blueprint:** no.
- **DoD:** a deliberate no-bump test commit on a branch shows the gate failing; lint gate green on the current tree; private-repo minutes cap noted (free tier, D-088).

**S120 — FU-1: DECISIONS.md curated archive split**
- **Goal:** DECISIONS.md is past its size wall, appended through D-125. Split it: hot/LOCKED and active-contract entries stay, superseded and M8–M9-era history moves verbatim to an archive with a pointer stub, following the S58 document-split pattern. Verify and record the S75 D-069 addendum.
- **Risk:** low, but the archive must be verbatim or decision history is lost.
- **Depends:** nothing, but it must land **before Phase 1's blueprints**, which append many entries. **Blueprint:** n/a. Needs the owner's awareness first (courtesy flag, section 9).
- **DoD:** nothing lost (verbatim archive), pointer stub in place, and every D-number cited by this plan still resolvable.

### M17-Phase 1: content, planner overhaul and design (the headline; the three owner asks land here)

**S121 — Blueprint: trip-content layer**
- **Goal:** the architecture decision set for the single content source: module location respecting the framework-free `core/` layering (`core/` must not import `lib/`), the derivation direction for the city map, the Zod schema set (day plans, guide cards, nightlife, bookings/journeys), the validation mechanism, D-018 seed-semantics preservation, and the runbook outline, all recorded as DECISIONS entries.
- **Depends:** S120. **Blueprint:** this is it. New data shape, and it crosses the core/lib boundary.
- **DoD:** D-numbers recorded, with an explicit statement that seed swaps never rewrite live synced data.

**S122 — Build: content layer consolidation + validation + runbook**
- **Goal:** implement S121. One content module feeding `SAMPLE_ITINERARY`, a *derived* `TRIP_CITIES` (the anti-drift test becomes a derivation-identity test), schema'd guide/nightlife/booking data, `npm run validate:content`, and `docs/trip-content.md` with a worked example: "change the Dec 26 dinner" is one file edit.
- **Risk:** an architecture-adjacent refactor touching the seed/fallback seam (D-018) and the vault's fallback constant. A subtle mistake here corrupts first-run behavior for every fresh device.
- **Depends:** S121. **Blueprint:** S121.
- **DoD:** a snapshot test proves the produced `SAMPLE_ITINERARY` value is deep-equal before and after the refactor; the D-018 four-state read is untouched; the validation script fails on a deliberately-broken content fixture; runbook committed.

**S123 — Blueprint: structured time model**
- **Goal:** record the contract from section 2 of the technical doc as DECISIONS entries: wall-clock-at-place semantics (the D-number the doc asks for), the Vault v4→v5 migration contract, the one offset-injected pure comparison function for Up-Next, the picker interaction contract, and the D-107 mixed-fleet reload coordination note.
- **Depends:** S120 for file headroom; S122 recommended first, since the content layer settles what "the day's city" reads from. **Blueprint:** this is it. Schema change with app-wide reach, already flagged by the v4 plan.
- **DoD:** decisions recorded, migration test matrix enumerated.

**S124 — Time model core + Vault v4→v5 migration + Up-Next math**
- **Goal:** additive `startMinutes`/`durationMinutes`. Migration #3 parses legacy `time` best-effort and losslessly; unparseable values become untimed with the legacy text still shown. `nextUp()` compares via the explicit-offset pure function (NPT +5:45, JST +9), with no `Date` timezone tricks (the B-01 lesson).
- **Risk:** the plan's single riskiest change. A Vault migration over real trip data plus cross-timezone math, top of the risk register.
- **Depends:** S123. **Blueprint:** S123.
- **DoD:** migration unit suite (round-trip, unparseable-preserved, idempotent, no clock reads); a full E2E run per the S97 process rule, since any Vault-version slice runs the whole net; export/import specs updated; offset unit tests including the NPT :45 case; sync compat, meaning additive fields ride the item merge and old clients ignore them; the D-107 coordinated-reload note for the friends' devices recorded.

**S125 — AM/PM time picker + display + NPT/JST badge**
- **Goal:** the custom touch-friendly picker (hour, minute and AM/PM columns) in the ItemEditor, `formatTimeAmPm` display on item rows, and an NPT/JST badge derived from the day's country. Presentation layer only.
- **Risk:** low. A new UI component on established a11y patterns; the hard math already landed in S124.
- **Depends:** S124. **Blueprint:** no.
- **DoD:** 44px targets, the D-021 focus contract, reduced-motion; no native `input[type=time]`; E2E adds and edits a time and sees it AM/PM-rendered and persisted; axe clean.

**S126 — Sort-by-time, per-day timeline view, clash warnings**
- **Goal:** a view-level, non-destructive sort-by-time toggle where untimed items sink and stay stable among themselves and manual order remains the stored truth, a per-day timeline rendering, and the warn-only overlap badge (interval math per section 2 of the technical doc; items without duration never warn).
- **Risk:** low. Pure unit-testable helpers plus view composition, warn-only by contract, with no write path touched.
- **Depends:** S125. **Blueprint:** no.
- **DoD:** helpers unit-tested, including the stability property; E2E toggle; zero itinerary writes, so D-018 is untouched; clash badge passive per section 3.5.

**S127 — Undo engine (deferred-commit generalization) + item-delete undo**
- **Goal:** generalize the budget panel's proven restore pattern into one undo utility. A destructive op keeps its payload in memory and shows a sonner toast with Undo; restore follows the per-op sync spec. Under sync a restore must either re-insert with a **fresh id** (the tombstone-source pattern, D-032 generalized) or re-stamp a strictly-later HLC, because `resolvePair` biases toward the tombstone on an HLC tie. First consumer: item delete.
- **Risk:** the tier's #1 correctness trap (section 3 of the technical doc). Silent data resurrection or duplication is the failure mode.
- **Depends:** S124, so the schema is settled and restore payloads are current-shape. **Blueprint:** no; section 3 of the technical doc is the contract, and the per-op choice is specified per slice.
- **DoD:** mutation-proof tests in the S110-F1 style (fail-while-mutated, non-vacuous); a unit proof that restore-under-sync survives the tombstone bias; Backup Restore stays local-mode-only (D-121) until S145.

**S128 — Inline quick-add + duplicate-item**
- **Goal:** a one-line quick-add input per day (calendar day view, agenda and Today panel): type a title, press Enter, and `addItem(date, {title, category:'other'})` goes through the existing `commit()` choke-point. Plus a duplicate-item action, "same dinner, another day," generating a fresh id.
- **Risk:** low. Additive UI through the existing store, with no new persistence semantics.
- **Depends:** S127 so undo exists for the delete side of quick mistakes, and S124 for the settled schema. **Blueprint:** no.
- **DoD:** the D-018 four-state read stays intact, since quick-add writes through `commit()`; E2E types, presses Enter, sees the item appear, reloads and finds it persisted; duplicate carries content but never the id; one input only on the fast path (section 3.5).

**S129 — Clear-whole-day**
- **Goal:** `clearDay(date)` in `core/itinerary/crud.ts`. Dormant means physical remove; sync-on means tombstone every item, rev/hlc-stamped, in one commit and one per-day doc write, which is Spark-friendly. Confirm dialog plus undo toast (full-list restore, fresh ids under sync). A cleared day is a legitimate D-018 empty state and never re-seeds.
- **Risk:** tombstone semantics plus the concurrent-add merge property. A friend's simultaneous add must survive if and only if its HLC is greater than the clear's.
- **Depends:** S127. **Blueprint:** no; section 3 of the technical doc is the contract.
- **DoD:** E2E clears, reloads and finds the day still empty; fake-sync-harness assertion that tombstones are present in the raw payload with zero live items (the S98 precedent); merge property test for clear against a concurrent add.

**S130 — Multi-select + copy-day**
- **Goal:** pure core ops `moveItems`, `deleteItems` and `copyDay`, with fresh ids on copy so ids are never reused across days, and moves as tombstone-source plus fresh-id under sync per D-032. The selection mode UI is invisible until entered and exits on completion.
- **Risk:** bulk ops composed over the merge machinery; the D-031 chained-composition property tests extend here.
- **Depends:** S127, S129. **Blueprint:** no.
- **DoD:** composition property tests green; bulk ops are one commit per touched day; undo covers bulk delete; the selection UI follows section 3.5; E2E moves 3 items and round-trips a copy-day.

**S131 — Mobile editor bottom-sheet + swipe-to-delete**
- **Goal:** ItemEditor becomes a portal bottom-sheet on `<lg` using the `place-detail-sheet` idiom, portal-to-body per FU-11/D-094. Swipe-to-delete on item rows ships with a visible, non-gesture Delete affordance as the accessible alternative. Both are wired to the undo engine.
- **Risk:** low. Established idioms, and the gesture layer is additive.
- **Depends:** S127, S128. **Blueprint:** no.
- **DoD:** elementFromPoint proof that the sheet sits above the footer and tab bar (the FU-11 precedent); swipe has an a11y-equivalent path; reduced-motion respected; E2E on a mobile viewport.

**S132 — `SectionHeading` + the one canonical `Reveal`**
- **Goal:** one `SectionHeading` consuming the display scale replaces the ~6 hand-copied mastheads in `calendar-planner`, `recommendation-section`, `map-section`, `country-essentials`, `travel-essentials` and `photography-guide`. One `Reveal` helper (slide-only whileInView, opacity pinned to 1, reduced-motion falling back to static) retires the competing idioms, with D-100 encoded in the component.
- **Risk:** low. Mechanical consolidation with the rules pre-encoded.
- **Depends:** S118 if G3 is approved, since framer 12 should land first; don't write new motion code on the old major. **Blueprint:** no.
- **DoD:** grep proves zero surviving hand-copied masthead markup or stray reveal variants; the axe pack is deterministic across 10+ runs; expect ~0 baseline drift because the rest state is identical, and explain any drift pixel by pixel.

**S133 — Glass depth-hierarchy adoption pass**
- **Goal:** apply the adoption map. Nav, tab bar and modals use `glass-panel`, primary cards use `glass-card`, inset and secondary surfaces use `glass-subtle`. Class-swap only.
- **Risk:** low. A disciplined class-swap.
- **Depends:** S132. **Blueprint:** no.
- **DoD:** the 18 visual baselines are regenerated once, deliberately, in the canonical CI environment, as their own commit, never mixed with logic; the contrast floor (D-100/S110) is re-verified on swapped surfaces.

**S134 — Micro-interactions pack**
- **Goal:** the section 3.4 inventory: done-toggle spring tick, expense count-up (`use-count-up`), add-to-plan flying chip on the D-071 z-ladder, day-strip snap physics, undo-toast progress ring, drag-lift, day-cell pulse, skeleton shimmer.
- **Risk:** low. Pattern-based framer work with the constraints pre-stated.
- **Depends:** S127–S131 so it animates final planner surfaces, plus S132–S133. **Blueprint:** no.
- **DoD:** every interaction is `useReducedMotion`-gated and axe-deterministic (D-100); Home First Load stays ≤ ~92 kB; framer is not dragged into lazy routes; the 44px, contrast and focus floor holds.

**S135 — `TripMap` extraction (the #22 map split, as the enabling refactor)**
- **Goal:** extract a reusable `<TripMap>` module (init, style, markers, polyline) from the 1006-line `map-section.tsx`, and have `/map` re-compose it behavior-identically.
- **Risk:** a behavior-identical extraction from the largest component in the tree, under frozen nets. Regression risk is exactly why it is done alone.
- **Depends:** S118 if G3 is approved, so maplibre 5 lands first. **Blueprint:** no; section 3 of the technical doc defines the seam.
- **DoD:** route table unchanged; map E2E and visual baselines green with 0 drift; `map-section.tsx` reduced to composition.

**S136 — Split map/list planning view on `/plan`**
- **Goal:** on desktop, the itinerary list sits beside a day-scoped `TripMap`, with click-stop and marker highlight syncing both ways and drag-reorder redrawing the polyline live via `setData` with no camera move. On mobile it stays list-first with a bottom-sheet map peek.
- **Risk:** the flagship interaction. Two-way selection and drag sync against the store event, plus the hard bundle line the risk register flags.
- **Depends:** S135, and S130 so reorder/move semantics are settled. **Blueprint:** no.
- **DoD:** hard line, MapLibre stays an interaction-lazy island (the S107 pattern) and `/plan` first-load stays ≤ 220 kB (currently 184), with the route table pasted as evidence; E2E covers reorder to polyline redraw plus selection sync; new visual baselines at 3 viewports committed deliberately.

**S137 — Manual pin-drop + honest overlay count**
- **Goal:** additive `lat?`/`lng?` on `ItineraryItem` with no Vault bump (the S98 `done` precedent). "Add pin" inside the editor places a point via map tap; custom items with coords plot on `/plan` and `/map`; the overlay gains "N of M stops shown" so unplottable items are no longer invisible. The legacy name-match fallback stays.
- **Risk:** low. Additive optional fields on a documented precedent, plus contained map UI.
- **Depends:** S136. **Blueprint:** no.
- **DoD:** fields ride the item merge and old clients ignore them; pin-drop is opt-in inside the editor (section 3.5); E2E pins a custom item and sees it on both overlays; the count is accurate.

**S138 — Nightlife "Added" feedback fix (#26)**
- **Goal:** custom-added nightlife venues show planned-state feedback like every other guide surface.
- **Risk:** low. A small UI-state fix on an existing pattern.
- **Depends:** none; it can slot anywhere in Phase 1. **Blueprint:** no.
- **DoD:** E2E adds a venue and sees the "Added" state render; gate behavior (D-125) untouched.

### M17-Phase 2: collaboration (Sync Everywhere)

**S139 — Blueprint: Sync Everywhere + offline outbox + store factory**
- **Goal:** the architecture decision set per section 4 of the technical doc. Per-domain `SyncPort` generalization; the Firestore chunk layout with Spark quota math and margins (expenses chunked by leg and month, budget as one doc); the outbox (a gateway-keyed queue, flushed on `online`, visibilitychange and app-start, safe because merged writes are commutative and idempotent) including the undo-to-outbox interplay, where an undo commit issued while its delete is still queued means ordering and coalescing through `commit()` must be specified; the `createReactiveStore` contract (event strings byte-frozen, D-026 listener contract, migration order journal, expenses, budget, itinerary last); journal stays local, recorded as the privacy D-number; packing sync optional, an owner call; and the `gcTombstones` invocation policy (FU-23).
- **Depends:** S120, and the Phase 1 planner core landed so the merge surface it generalizes is stable. **Blueprint:** this is it. A new subsystem, and section 4 of the technical doc requires it.
- **DoD:** decisions recorded including the quota math; the invariant list (D-038 dormant-byte-identical, D-039 echo-suppression, first-snapshot vs steady-state, D-055/D-120 guest gate) restated as per-slice DoD lines.

**S140 — Store factory (`createReactiveStore`) + `use-budget`**
- **Goal:** extract the shared hydrate/listen/commit skeleton, then migrate journal, expenses, budget (which finally gains its missing hook, so budget-panel stops bypassing) and itinerary last, under its frozen nets.
- **Risk:** an architecture-adjacent refactor with a frozen event-string and behavior contract across four domains.
- **Depends:** S139. **Blueprint:** S139.
- **DoD:** event names byte-identical (grep-proven); zero consumer edits; hydration gating preserved; full frozen nets green after each domain migration, with itinerary migrated last.

**S141 — Offline push outbox (closes FU-19 / S110 TL-A P2)**
- **Goal:** `core/sync/outbox.ts` per S139, with itinerary adopting it, so offline edits survive reload and push on reconnect.
- **Risk:** retry, idempotency and ordering correctness. The failure mode is silent data loss.
- **Depends:** S140. **Blueprint:** S139.
- **DoD:** flush and retry unit tests; offline E2E editing offline, reloading, confirming edits survive, reconnecting and confirming a single idempotent push; dormant build byte-identical.

**S142 — Expenses sync**
- **Goal:** generalize the item-level merge to the id-keyed expense collection, where `mergeItems` is `mergeDay` minus the day partition. Chunked docs per S139, read-on-snapshot, transactional merged writes following the `pushDayMerged` pattern, and "logged by {name}" attribution stamped at the store layer.
- **Risk:** a new merge surface with quota, guest-gate, echo and first-snapshot invariants. The register's Spark-blowout risk lives here.
- **Depends:** S141. **Blueprint:** S139.
- **DoD:** property tests for commutativity and idempotency (the S96 500-pair pattern); guest gate before any push (D-055/D-120); dormant byte-identical (D-038); echo suppression (D-039); the two-client spec extends `sync-two-client.spec.ts`, skipped with documentation under the emulator/JDK ceiling as it is today.
- **Free-tier:** Firestore Spark only, with the chunk math from S139 pasted as evidence.

**S143 — Budget sync (singleton, LWW-per-field)**
- **Goal:** the budget config doc syncs, LWW-per-field with HLC. It is a struct, not a list, so there are no tombstones, and it is one Firestore doc.
- **Risk:** small, but it is still merge logic under the same invariants.
- **Depends:** S142. **Blueprint:** S139.
- **DoD:** per-field LWW unit tests including concurrent different-field edits converging to both; the same invariant lines as S142.

**S144 — Expense split, "who owes whom"**
- **Goal:** additive `paidBy?`/`split?` on expense rows riding S142's merge, a pure settlement function (pairwise netting) unit-tested in core, a settlement view, and a fast path defaulting to "paid by me / no split" (section 3.5). The 694-line `budget-panel.tsx` split into focused modules rides here as the enabling refactor.
- **Risk:** money math across three users on the sync surface. Wrong netting is a trust-destroying bug.
- **Depends:** S142, S143. **Blueprint:** no; it is additive per S139's shapes.
- **DoD:** settlement unit suite including three-way circular debts netting flat; attribution renders; zero extra input on the default logging path.

**S145 — Sync debt: tombstone-replace Restore + gcTombstones policy (FU-20 + FU-23)**
- **Goal:** Backup Restore is re-enabled under sync as a tombstone-replace merge, superseding the D-121 containment. The S139 `gcTombstones` policy is implemented, and the remaining TL-A P3s (getEntry memoization, dead port subscribe surface) ride along.
- **Risk:** direct tombstone-machinery work.
- **Depends:** S141 so the outbox seam is settled, and S142. **Blueprint:** S139 line-item.
- **DoD:** restore-under-sync E2E on the fake harness, where an import converges all clients to the imported state with no resurrection; D-121 formally superseded, recorded as a proposed decision.

### M17-Phase 3: companion features (each independently droppable if the calendar pinches)

**S146 — Settings page v1**
- **Goal:** one surface covering identity and sign-out (Trip Token), currency plus rate override (relocated from the budget panel, which keeps a link), and data management (export/import made discoverable, per-domain clears behind confirmation). Grouped and collapsed per section 3.5, with the notifications group deliberately absent until Pulse exists.
- **Risk:** low. A new screen built from existing pieces and patterns.
- **Depends:** S140, since per-domain stores make per-domain clears clean. **Blueprint:** no.
- **DoD:** reachable from nav without adding top-level nav noise; axe and mobile clean; route budget respected; destructive actions confirmed, with undo where feasible.

**S147 — Search-within-plan**
- **Goal:** answer "which day is the ramen shop on" with client-side search over item titles, notes and categories from `/plan` and the command palette. The result jumps to the day and highlights the item.
- **Risk:** low. Pure client search over in-memory data.
- **Depends:** the Phase 1 planner surfaces. **Blueprint:** no.
- **DoD:** unit-tested matcher; E2E search, jump and highlight; keyboard-accessible.

**S148 — Multi-day items**
- **Goal:** additive `endDate?` (or `spanDays?`) per section 6 of the technical doc. The item stays owned by its start day and is never multi-homed across day docs, which is the per-day merge invariant. Render-layer expansion shows span bands across days, and spans are excluded from clash warnings in v1.
- **Risk:** an additive schema whose render expansion sits adjacent to the merge and sort semantics. The multi-homing trap is a data-corruption class of bug.
- **Depends:** S124, S126. **Blueprint:** no; the section 6 row of the technical doc is the contract.
- **DoD:** merge-invariant unit test proving a span item appears in exactly one day doc; render expansion E2E; old clients ignore the field.

**S149 — Favorites/bookmarks on guides**
- **Goal:** star a place without committing it to a day. Gateway key 14 (`Record<placeId, true>`), a "Saved" filter chip on guides, saved pins on `/map`. Local-only in v4, a sync candidate later.
- **Risk:** low. A new gateway key on the established additive pattern (S101/S102/S104 precedents).
- **Depends:** none. **Blueprint:** no.
- **DoD:** persistence E2E (star, reload, still starred); the chip appears only once at least one favorite exists (section 3.5).

**S150 — Multi-day weather forecast**
- **Goal:** the Open-Meteo daily endpoint: a 7-day outlook per upcoming city plus golden-hour planning ahead, with cached-last-fetch and the stale indicator.
- **Risk:** low. It extends the shipped D-108 pattern.
- **Depends:** none. **Blueprint:** no.
- **Free-tier:** Open-Meteo is keyless, account-less and card-less, the same D-088 check S99 passed (D-108).
- **DoD:** offline renders cached data without fetch errors; stale indicator on the cached view.

**S151 — Map trip-mode upgrades**
- **Goal:** search-within-map (client-side over known places, behind a search icon); a live location toggle (browser geolocation, default off, permission-prompted, nothing persisted); directions links in popups (external maps URL, D-074 href discipline); and the honest "schematic line, not a route" caveat on the day overlay.
- **Risk:** low. Contained additions to proven MapLibre patterns.
- **Depends:** S135 (TripMap). **Blueprint:** no.
- **Free-tier:** geolocation is a browser API and directions links are plain URLs, so nothing new is external.
- **DoD:** the location toggle is proven off by default; byte-check on directions hrefs (D-074 precedent); the caveat is visible on the overlay.

**S152 — Travel-safety kit**
- **Goal:** embassy and emergency numbers for Nepal and Japan, insurance-notes fields, a 20-phrase Nepali/Japanese phrasebook, and a document checklist. Static data through the S122 content layer, offline by construction.
- **Risk:** low. Static content plus presentation.
- **Depends:** S122 for the content layer and schemas. **Blueprint:** no.
- **DoD:** numbers sourced from official sites with sources cited in content-file comments; renders offline; axe clean.

**S153 — Journal browse view + recap/budget tie-in**
- **Goal:** a dedicated journal list and browse view, and a per-day spend line on the day recap. Both are day-keyed and currently never reference each other.
- **Risk:** low. Composition of existing domains, read-only.
- **Depends:** none. **Blueprint:** no.
- **DoD:** journal stays local-only, citing S139's privacy decision; read-only over budget data with no writes.

**S154 — Global offline UX**
- **Goal:** an app-wide offline banner (`navigator.onLine` plus events), with map and guides adopting the weather card's stale-cache indicator pattern.
- **Risk:** low. Pattern replication.
- **Depends:** S141 is useful but not required; the banner can reflect outbox pending state if present. **Blueprint:** no.
- **DoD:** offline E2E showing the banner appear and disappear; no console errors offline.

**S155 — First-run experience**
- **Goal:** a one-time post-TokenGate coach-mark tour (Today, Plan, Budget, Journal, Map): max 5 stops, skippable at every step, shows exactly once (gateway-keyed), reduced-motion aware. It doubles as the portfolio demo path.
- **Risk:** low. A bounded UI flow.
- **Depends:** Phase 1 surfaces stable. **Blueprint:** no.
- **DoD:** never re-shows (reload E2E); skip works at every stop; axe clean; the section 3.5 constraints apply verbatim.

**S156 — Post-trip mode + text story recap (ungated, re-scoped out of G2)**
- **Goal:** `isPostTrip()` in `core/dates/`, pure and overridable via `?today=`. After Jan 9 the site flips to a permanent scroll-storytelling recap weaving plan-vs-actual (S105), journal and spend. Text only, no photos, no IndexedDB.
- **Risk:** low. The derivation is trivial and fake-clock-testable, and the recap composes existing views with the canonical Reveal.
- **Depends:** S153 for the browse and tie-in pieces, S132 for Reveal. **Blueprint:** no; the section 6 row of the technical doc calls it pure derivation.
- **DoD:** fake-clock E2E flips in and out (`?today=` / `?today=off`, the S82 harness); the countdown surfaces "Completed" gracefully; zero console errors post-trip.

**S157 — A11y residue sweep (#28 + FU-22)**
- **Goal:** a house-wide dialog close-X 44px sweep, the `/nepal` and `/japan` moderate heading-order fix, and widening axe gating beyond serious/critical on stable surfaces.
- **Risk:** low. Mechanical, verified per dialog at mobile viewports.
- **Depends:** late Phase 3, so surfaces are stable and the widened gate doesn't fight in-flight work. **Blueprint:** no.
- **DoD:** axe pack green at the widened level, deterministic across 10+ runs.

**S158 — Small wins: expense CSV export + Home sticky section nav**
- **Goal:** client-side CSV download of expenses (blob URL, no dependency) and a Home in-page sticky section nav. FU-6 PageHero parity is an owner decision and is not included.
- **Risk:** low. Small additive UI.
- **Depends:** none. **Blueprint:** no.
- **DoD:** CSV byte-checked against fixture data; sticky nav keyboard-accessible; Home holds at ≤ ~92 kB.

### M17-Phase 4: gated tracks 🔒 *(nothing starts until its gate is approved by the owner. If G2 opens, S159–S160 should be scheduled before Dec 9, because photos are captured during the trip.)*

**S159 — Blueprint: photo storage (`BlobStorePort` / IndexedDB)** 🔒 G2
- **Goal:** the G2 architecture. `BlobStorePort` over IndexedDB, not the localStorage gateway, because of quota; metadata (ids, captions, day-keys) in a gateway key; downscale and compression policy; quota strategy and fallback when IndexedDB is unavailable; the D-038-style privacy guarantee that photos never leave the device and never sync; and the export/import stance, with photos excluded from the JSON export and that stated explicitly.
- **Depends:** G2 approved and the D-002 amendment recorded. **Blueprint:** this is it.

**S160 — Photos: capture/attach on journal + expense receipts** 🔒 G2
- **Goal:** attach photos to journal entries and expenses per S159, with graceful quota handling.
- **Risk:** a new storage subsystem with quota and fallback correctness.
- **Depends:** S159. **DoD:** quota and fallback unit tests; persistence E2E (attach, reload, present); zero network egress for photo bytes proven; alt-text and caption prompts for a11y.

**S161 — Story-mode photo integration** 🔒 G2
- **Goal:** S156's recap gains per-day photos.
- **Risk:** low. Composition over S160's port into an existing view.
- **Depends:** S156, S160. **DoD:** the recap renders with and without photos; reduced-motion respected.

**S162 — Blueprint: Concierge + Pulse (the G1 backend track)** 🔒 G1
- **Goal:** the first-backend architecture. A Cloudflare Worker (free plan) design, key custody and rate caps. It carries a hard D-088 verification that the chosen AI provider and the Cloudflare account path require no payment information under any circumstance; if no provider qualifies, Concierge re-scopes to a client-side rule-based suggester with no backend, and that is reported rather than absorbed. Also: a schema-constrained suggestion contract grounded in the app's own guide data and inserted only through the existing store, and Pulse, meaning Web Push/VAPID design, a sender cron (Worker cron triggers or GitHub Actions cron, both free) and a per-category opt-in model.
- **Depends:** G1 approved. **Blueprint:** this is it.
- **Free-tier:** the whole slice is, in part, the free-tier proof.

**S163 — Concierge Worker** 🔒 G1
- **Goal:** the free-tier edge Worker per S162, holding the key and enforcing schema-constrained output plus rate caps.
- **Risk:** the first server-side slice, and it only starts once G1 is greenlit. Secret custody plus input and output validation on a public endpoint.
- **Depends:** S162. **DoD:** deployed on the free plan with evidence; malformed and oversized requests rejected; keys never in the client bundle.

**S164 — Concierge client UI** 🔒 G1
- **Goal:** the pull-based suggestion surface. One entry point, suggestions previewed and inserted only via explicit user action through the existing store, degrading to absent when unconfigured (dormant discipline).
- **Risk:** low. UI over a settled contract.
- **Depends:** S163. **DoD:** dormant build byte-identical without the endpoint configured; nothing auto-inserts (section 3.5).

**S165 — Pulse sender (push infra)** 🔒 G1
- **Goal:** morning digest, flight-day nudges, golden-hour alert and collaboration pings, per S162, from the free cron source with VAPID.
- **Risk:** server-side scheduled delivery infrastructure with per-user subscription state.
- **Depends:** S162, plus S163's Worker plumbing if it is shared. **DoD:** the send path proven end to end to a real subscribed test browser; free-tier evidence.

**S166 — Pulse client: SW push handling + opt-in UI** 🔒 G1
- **Goal:** push subscription and notification handling in the hand-rolled SW (`scripts/gen-sw.mjs`, where the D-073 update-flow coupling must not break), plus per-category opt-in in Settings with everything defaulting to off.
- **Risk:** modifying the hand-rolled SW is coupling-risk work, touching precache and the update flow.
- **Depends:** S146, S165. **DoD:** D-073 update flow re-proven (parks at `waiting`, shows the toast, one reload); PWA E2E green; opt-out verified to stop notifications.

---

## 6. Phase sequencing (and why)

```
G5 rules fix: manual, done by the account owner, now, independent of everything (FU-18)

Phase 0 — floor          S114 flakes → S115 deps → [G3: S116 Next → S117 React → S118 framer/maplibre] → S119 CI → S120 FU-1
Phase 1 — headline       S121–S122 content · S123–S126 time · S127–S131 planner CRUD · S132–S134 design · S135–S137 split view · S138
Phase 2 — collaboration  S139 blueprint → S140 factory → S141 outbox → S142 expenses → S143 budget → S144 split → S145 debt
Phase 3 — companion      S146–S158 (each droppable individually)
Phase 4 — gated          G2: S159–S161 (capture BEFORE Dec 9 if approved) · G1: S162–S166
```

**Why this order.** (1) Flake fixes precede the majors so a red during the upgrades means a real break, which is the technical doc's own "red means red" condition. (2) The dep prune precedes the majors to shrink the peer-dep surface. (3) The majors precede all feature work so nothing is built twice, one major family per slice with a full net between, per section 7 of the technical doc. The only hard dependency of Phases 1–3 on Phase 0 is hygiene, so if G3 stalls, Phase 1 proceeds on Next 14 and only FU-17's 112 KB stays unclaimed. Decide G3 fast to avoid re-verification churn later. (4) Content (S121–S122) leads Phase 1 because it is the named pain point, and other slices such as S152 build on its schemas. (5) Design foundation before planner visuals, micro-interactions after (see section 1.6). (6) Store factory, then outbox, then domain syncs is a strict prerequisite chain. (7) Phase 3 is deliberately the buffer: every slice is independent and droppable. (8) Hard dates: everything through Phase 3 before **Dec 9, 2026**; S156 (and S161 if G2 opens) by **Jan 9, 2027**; G2 capture slices before Dec 9 if approved.

---

## 7. Decision gates carried forward (all the owner's to pick; none resolved here)

| Gate | Decision | Blocks | Status | Recommendation / next step |
|---|---|---|---|---|
| **G1** | D-004, first backend (free-tier Worker/cron only, D-088 holds) | S162–S166 | OPEN | Greenlight **narrowly** if wanted; decide by end of Phase 2 so Phase 4 can start. Note that S162 contains a hard D-088 provider check with a stated no-backend fallback (a client-side rule-based Concierge), so a "no" to G1 doesn't have to mean zero Concierge value. |
| **G2** | D-002 amendment, local-first including IndexedDB | S159–S161 (photos only) | OPEN | Approve if photos are wanted, and note the re-scope: the post-trip story recap no longer waits on this gate, since S156 is ungated. If approved, schedule S159–S160 before Dec 9, because capture happens during the trip. *Flagged change vs V4-PLAN: needs the owner's sign-off on the narrowed gate scope.* |
| **G3** | D-077 revisit, Next 14 → 15 (plus optional 16 later) | S116–S118, FU-17's ~112 KB | OPEN | Approve and decide **first**; it is the safety floor under the UI wave. If declined: Phase 0 shrinks to S114/S115/S119/S120, features proceed on Next 14, FU-17 stays open, and S118's majors need a separate call, since framer 12 without React 19 may not be viable. Verify before starting. |
| **G4** | Trip Packs, a multi-trip engine that reinterprets LOCKED D-006 | — | **DEFER to v5** | Endorsed. The content layer (S121–S122) covers the real, immediate editability pain without touching D-006, and is the foundation Trip Packs would want anyway. |
| **G5** | firestore.rules uid-allowlist (D-044, FU-18, drafted at `firestore.rules:36-43`) | — | OPEN, manual (done by the account owner) | Do immediately; independent of v4 entirely. Any anonymous internet user can currently read, write or delete the shared trip. |

---

## 8. Risk register (section 8 of the technical doc carried forward, updated for this slicing)

| Risk | Guard |
|---|---|
| Time migration mangles real trips | S124: migration #3 unit suite (round-trip, unparseable-preserved, idempotent) plus a full E2E per the S97 rule plus export/import spec updates; S123 blueprint first |
| Undo-under-sync resurrects or duplicates (the D-032 class) | S127 per-op fresh-id/HLC spec; mutation-proof (fail-while-mutated) tests |
| Clear-day nukes a friend's concurrent adds | S129 merge property test: clear against add converges with the add surviving if and only if its hlc is greater than the clear's; two-client spec extension, skipped with documentation under the emulator ceiling |
| New: undo against the offline outbox, where an undo commit is issued while its delete is still queued | S139 blueprint must spec op ordering and coalescing through `commit()`; idempotent merged writes make convergence provable; explicit unit scenario in S141 |
| New: the content-layer refactor breaks seed semantics (D-018) or the city derivation | S122 deep-equal snapshot of `SAMPLE_ITINERARY` before and after; derivation-identity test replaces the anti-drift test; D-018 four-state suite frozen |
| Split view drags `/plan` over 220 kB | S136 hard DoD line: MapLibre stays an interaction-lazy island, route table pasted as evidence |
| Design pass breaks the visual or axe nets | S133 single deliberate baseline regen, own commit, canonical CI env; D-100 encoded in `Reveal` (S132); axe deterministic across 10+ runs |
| Platform upgrade destabilizes everything | S114 first (red means red); one major family per slice; full net between; per-slice git-revert rollback; the S116 SW-coupling stop-and-escalate rule |
| New: a G3 stall blocks Phase 0 | Phases 1–3 have no hard technical dependency on the majors; proceed on Next 14 if needed; churn cost flagged, not hidden |
| Sync Everywhere Spark-quota blowout | S139 chunk layout plus quota math with margins as a blueprint DoD; write-coalescing through `commit()` (D-088) |
| New surfaces regress a11y | The S110 floor (contrast ≥ 4.5, 44px, focus, aria-live scoping) is a constraint on every slice; S157 widens the axe gate at the end |
| New: mixed-fleet clobber after schema-bearing deploys (D-107) | S124 and S142 carry the coordinated friends'-reload note; additive-only fields throughout |
| New: 53 slices against the Dec 9 hard date | Phase order is value order; Phase 3 is individually droppable; Phase 4 gated tracks never start before Phases 1–2 land (unchanged rule) |
| The sonner override pins 1.5.0 internals | Standing rider: any future sonner bump slice must retire the globals.css override (D-119–D-122 note). Carried, with no slice until a bump happens |

**New test nets this plan requires** (unchanged from section 8 of the technical doc, plus): a content-validation fixture suite (S122); the settlement-math suite (S144); the post-trip flip E2E (S156, S82 harness); the outbox undo-interplay scenario (S141).

---

## 9. Open questions and decisions needing the owner's sign-off

1. **Gates G1, G2 and G3 need picks** (section 7). G3 first, since it sequences Phase 0; G2 next if photos are wanted before the trip; G1 by end of Phase 2. G4 defer and G5 do-now need only confirmation.
2. **G2 narrowing (flagged change):** the text-only post-trip recap was moved out of G2 and is now S156, ungated. This needs sign-off because it re-shapes a gate's blast radius. The strong recommendation is yes, since it de-risks the Jan 9 deadline.
3. **Next 16:** S116 targets 15 only. If 15 lands clean, is a follow-on 15→16 slice wanted, or do we stop at 15 for v4? Default: stop at 15.
4. **Packing-list sync:** a cheap rider once S142 lands, priced by S139. Wanted, or leave packing per-device?
5. **FU-1 courtesy flag:** the DECISIONS.md archive split (S120) proceeds only once the owner is aware, the same courtesy the earlier document split carried.
6. **FU-6 (Home PageHero parity):** still an open owner decision, deliberately not scheduled.
7. **FU-18 / G5:** the firestore.rules allowlist remains the one open P1 and is manual, done by the account owner. Re-flagged here because it predates and outranks all of v4.
8. **Concierge fallback:** if S162's D-088 check finds no card-free AI provider, do we accept the stated fallback of a client-side rule-based suggester with no backend? Pre-agreeing avoids a mid-phase stall.
9. **D-124 travel item (non-code, carried from M16):** the booked return flight lands at Haneda but the trip now starts in Osaka. Accept the honest transfer day, or rebook into Kansai? Unrelated to v4, but still open.

---

## Confidence flags

The things I am least confident about, in order.

1. **Four borderline risk-tier calls.** S136 (split view), S144 (expense split), S148 (multi-day items) and S122 (content build) are all tiered as correctness-risk work on adjacency, but each could plausibly be handled as routine work given a tight enough spec. If the careful-review budget needs to be spent more sparingly, S144 and S148 are the safest to downgrade and S136 the least safe.
2. **The content-layer derivation direction (S121).** I asserted `TRIP_CITIES` should derive from itinerary content without fully tracing the `core/` vs `lib/` import legality. The blueprint must settle module placement, and if the layering fight turns ugly, the fallback is keeping two files with a build-time generation step rather than a runtime derivation.
3. **S117/S118 peer coupling.** React 19 may hard-require the framer major in the same slice despite the one-major-per-slice rule. There is an escape hatch written into S117, but it may well get used.
4. **Phase 2's serialized chain.** S139 through S145 is strictly sequential merge-machinery work and is the schedule's real critical path if G1 or G2 open late. If the calendar pinches, cut from Phase 3, never from the Phase 2 chain's test rigor.

No builds or tests were run for this document; it is planning only. All codebase claims above come from reads and greps done 2026-07-07, including the corrected `react-intersection-observer` status and the current dep versions (next 14.2.35 / react 18.2.0 / framer-motion 10 / maplibre 4) from `nextjs_space/package.json`.
