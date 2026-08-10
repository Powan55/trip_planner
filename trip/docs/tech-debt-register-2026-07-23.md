# Tech Debt + Improvements Register — 2026-07-23

Basis: a full read of the app source under `trip/{lib,core,components,hooks,app,scripts,e2e}`, plus the concierge Worker source.

Path note (added 2026-08-10): this audit was written against a `nextjs_space/` tree that is not part of this repo. The app lives at `trip/` — read every `nextjs_space/…` path below as `trip/…`. The concierge Worker is developed and deployed outside this repo entirely (`.github/workflows/deploy.yml` does not build or deploy it; it ships by a manual deploy), so the `worker/src/…` citations below have no file a reader of this repo can open.

Runs behind the original audit (2026-07-23):

- npx tsc --noEmit → exit 0, zero errors
- npx vitest run → 119 files / 1336 tests passed (19.5s)
- npm run lint → did not run; no ESLint config existed (TD-02, since RESOLVED)

Re-verification (2026-08-10): the Vitest suite has grown to **154 files** — `lib/__tests__/**/*.test.ts` 152 plus `components/__tests__/**/*.test.tsx` 2, per the `include` globs at `trip/vitest.config.ts:39`. The 1336 figure above is the 2026-07-23 count and must not be quoted as current; the most recent recorded run on this branch is 1755/1755 (commit `4c0613e`). Re-run `cd trip && npm ci --legacy-peer-deps && npm test` to refresh it.

Constraints honored: free-tools-only, Spark-only, no Firestore-rules change, client-side-only, D-073 no skipWaiting, no version bump, ports/core sync layer untouched, date-fns stays.

Severity counts as audited (2026-07-23): CRITICAL 0 · MAJOR 4 · MINOR 6 · NICE-TO-HAVE 2 · SKIP 10, plus TD-13, filed later the same day and carrying no severity heading.

**Status as of 2026-08-10: no item in this ledger is open.** All 13 now carry a recorded resolution, including the four that had no `Status:` line when this file was written (TD-02, TD-10, TD-12, TD-13) and therefore still read as outstanding. TD-08 is the one to read in full rather than by its status line: it was resolved in S258 and then deliberately re-opened and re-ruled.

---

## CRITICAL

None found. Type-check clean, full unit suite green, all audited trust boundaries hold:
- Firestore doc reads sanitized: `lib/itinerary-remote.ts:123` (`docToDayPlan`), `lib/trips-remote.ts:99,176,181` (`sanitizeTripConfig`, `docToTrips`, `docToRemoved`).
- Every localStorage `JSON.parse` is try/caught with a fallback: `core/storage/gateway.ts:619-627` (`readJson`, parse at :623), `core/trips/registry.ts:126,158`, `lib/currency-rate.ts:58`, `core/vault/load-save.ts:129`, `lib/expense-export.ts:57`.
- The Worker validates origin/method/token-shape/body-size/JSON, and `fetchChatCompletion` is total: every provider fetch is caught. (Worker source lives outside this repo — see the path note above.)

---

## MAJOR

### TD-01: Trips can never be removed, locally or via Sync Code (resurrection ceiling)
- Verified: `core/trips/registry.ts` has no remove/forget function (only upsert/rename/join, lines 176-208). `components/trips-hub.tsx` has zero delete UI (grep for remove/delete/forget: 0 hits), and `mergeTripLists` is documented additive-only (`registry.ts:213-215`, "a merge never removes"). Net effect: the known-trips list grows forever on every device, and any local removal would resurrect via the `trips/{code}/profile/tripList` union (`lib/trips-remote.ts:105-118`).
- Change: (1) new gateway key 29 `tripPlannerRemovedTrips` = `[{id, removedAt}]` (raw transport; shape logic in registry per D-097); (2) `removeKnownTrip(id)` in registry, which refuses DEFAULT_TRIP_ID and, when removing the active trip, switches to default first (D-172 reload by caller); (3) `mergeTripLists` takes removed-sets, so a tombstoned id is dropped from the union unless the entry updatedAt > removedAt (a re-join beats a stale tombstone); (4) the profile doc becomes `{version:1, trips, removed?}`, which is additive, so old clients ignore it and can re-add until they update, and that is acceptable; (5) a "Forget this trip" action per row in `trips-hub.tsx`, which does not touch the trip's Firestore data and whose copy has to say so. No Firestore rules change (same `trips/{id}/**` path).
- Size: M. Risk: medium (merge semantics), though mergeTripLists is pure and already unit-tested, so tombstone rules are cheap to prove.
- Proof: extend `lib/__tests__/sync-code.test.ts` and the registry tests (remove then no-resurrect; re-join-after-remove; default never tombstoned); e2e `e2e/trips-hub.spec.ts` plus `e2e/sync-code.spec.ts` (forget, reload, row stays gone).
- Proposed DECISIONS.md entry: trip removal = local forget + profile tombstone, never deletes remote trip data.
- **Status: RESOLVED in S269 (D-222).** Gateway key 29 `tripPlannerRemovedTrips` = `RemovedTrip[]` (`{id, removedAt}`, raw transport; shape and policy in `core/trips/registry.ts`). `removeKnownTrip(id)` refuses `DEFAULT_TRIP_ID` and switches the pointer to default when forgetting the active trip. `mergeTripLists` now folds both removed-sets LWW-by-`removedAt` and drops a tombstoned id from the union unless the entry's recency (later of `updatedAt`/`joinedAt`) beats `removedAt`, so a re-join or a post-forget rename revives it and discards the stale tombstone; default is excluded in both directions. The profile doc is now `{version:1, trips, removed?}` (additive, old clients ignore `removed`), and `pushTripList`/`subscribeTripList`/`importRemoteTrips` carry `removed`. "Forget this trip" is a per-row action in `trips-hub.tsx` (reused Radix AlertDialog, copy states it does not delete cloud data, hidden on the default-pack row). No Firestore rules change. Merge tombstone rules and `removeKnownTrip` are unit-tested in `sync-code.test.ts`, the forget → reload → stays-gone e2e is in `trips-hub.spec.ts`, and the isolation allowlist grew by 1.
  - **Deviation flagged.** The register spec says "unless the entry's `updatedAt > removedAt`", but a plain re-join goes through `upsertKnownTrip`, which stamps a fresh `joinedAt` and deliberately no `updatedAt` (stamping `updatedAt` on join would wrongly win name-LWW and clobber a better remote name). So the implemented signal is `max(updatedAt, joinedAt) > removedAt`, a superset that honors both the intent ("re-join beats stale tombstone") and the literal `updatedAt` case, since a post-forget rename also revives. Flagged for sign-off.

### TD-02: Lint is not runnable, `npm run lint` hangs on an interactive prompt
- Verified: there is no `.eslintrc*` or `eslint.config.*` anywhere in nextjs_space. `npm run lint` prints the next-lint deprecation and then blocks on the "How would you like to configure ESLint?" prompt, so lint has never gated anything, while 5 eslint devDeps sit unused (`nextjs_space/package.json:17-24`).
- Change: add a flat `eslint.config.mjs` (eslint-config-next + TS), repoint the script to the ESLint CLI (next lint is removed in Next 16, and the official next-lint-to-eslint-cli codemod exists), fix or explicitly disable the findings, then drop the unused eslint devDeps.
- Size: S config plus bounded findings. tsc is already strict-clean, so expect style and hooks findings only. Risk: low.
- Proof: `npm run lint` exits 0 non-interactively; paste the output.
- **Status: RESOLVED.** `trip/eslint.config.mjs` is a flat config (`next/core-web-vitals` + `next/typescript` via `FlatCompat`, plus four narrow rule carve-outs), and `trip/package.json:10` invokes the ESLint CLI directly (`"lint": "eslint ."`) rather than `next lint`, so the script exits non-interactively. The plan's last step was reversed deliberately: the ESLint devDependencies were **kept**, not dropped, because the config extends `eslint-config-next` (`trip/package.json:25-26,28-30`). The gate now runs as its own CI step on pull requests into `dev`/`main` (`.github/workflows/ci.yml:55-56`), which is where the four errors it had been hiding were fixed.

### TD-03: Hardcoded 3-friend TRAVELERS roster leaks into every custom trip's expense split
- Verified: `lib/token-auth.ts:87-91` (Powan/Sushil/Uttam; the comment at :84-86 flags it as out of that slice's scope to make dynamic, see S233), consumed unconditionally by `components/expense-dialog.tsx:80-81,432,458`, `components/budget-panel.tsx:121`, `components/settle-up-summary.tsx:22`, `hooks/use-presence.ts:48`. A wizard-created custom trip still offers the three N-x-J friends in the split UI.
- Change: one `rosterForActiveTrip(expenses): string[]` helper. The default trip returns TRAVELERS names (pixels unchanged); a custom trip returns the distinct union of (current traveler, paidBy, split[], createdBy) across that trip's expenses. Accents come from the existing `accentForName` (`token-auth.ts:73-78`), so no new colors. Thread it through the 3 components; use-presence's gold fallback already handles unknown names.
- Size: M. Risk: low-medium (settlement already takes a string[] roster, `budget-panel.tsx:121`).
- Proof: unit-test the helper (default vs custom, dedupe, me-included); `e2e/expenses.spec.ts` and `e2e/budget.spec.ts` unchanged on the default trip; one custom-trip roster assertion added to `e2e/custom-trip-gating.spec.ts`.
- Proposed DECISIONS.md entry: roster = fixed TRAVELERS on the default pack, derived from expense history + self on custom trips.
- **Status: RESOLVED in S266 (D-223).** `rosterForActiveTrip` + `rosterAccent`, 3 consumers threaded; the sibling leg-toggle leak is filed as TD-13.

### TD-04: gen-sw.mjs ROUTE_HTML is hand-maintained, so a forgotten route silently drops from offline precache
- Verified: `nextjs_space/scripts/gen-sw.mjs:43-63`. Its own comment records that it already bit once ("found + fixed for S153's /journal"). The list is currently complete (checked against out/: all 15 route dirs covered), but every new route re-arms the footgun.
- Change: derive the list by walking out/ for route index.html files plus 404.html. The `walk()` helper at :67-80 already exists, so this just replaces the literal array.
- Size: S. Risk: low; behavior-identical today and diffable.
- Proof: `npm run build`, then diff the emitted out/sw.js precache array against the current build's. They must be identical, and the existing SW e2e specs stay green.
- **Status: RESOLVED in S265.** ROUTE_HTML literal deleted; route HTML is now discovered inside `buildPrecacheList` by walking out/ (top-level `index.html`, every `<route>/index.html`, and `404.html`, excluding the redundant `404/index.html`). Precache identity proven: 164 → 164, arrays byte-identical after normalizing Next's per-build `_next/static/<buildId>/` path, which was the only raw diff and is unrelated to this change.

---

## MINOR

### TD-05: /trips has no per-route title/description
- Verified: `nextjs_space/app/trips/page.tsx:1-16` is 'use client', and its comment at :7-9 concedes "no metadata export; the root layout's default title applies". The split pattern to copy is `app/settings/page.tsx:7-13` plus `app/settings/sections.tsx`.
- Change: convert `app/trips/page.tsx` to a server component exporting metadata, and move the `dynamic({ssr:false})` island into `app/trips/sections.tsx`.
- Size: S. Risk: none.
- Proof: `npm run build`; `e2e/trips-hub.spec.ts` green with an added document.title assertion.
- **Status: RESOLVED in S264.** page.tsx is now a Server Component exporting `title: 'Trips · Nepal × Japan Journey'`, the island moved to app/trips/sections.tsx, and a document.title assertion was added to the spec.

### TD-06: S253 known gap, hero CTA row below the fold on xs (~360x740) viewports
- Verified: `components/hero-section.tsx` stacks quote (:385-390, mb-10), a 6-unit countdown grid (:438-447), a progress ring (:451-464) and 4 CTA buttons (:468-508). S253 flagged the CTA below the fold at 360x740, and the recorded candidate fix is to hide the quote and ring on xs.
- Change: add an xs cut (e.g. hidden min-[420px]:block) to the quote and the CountdownRing wrapper, keeping the total-days digit visible. CSS-only.
- Size: S. Risk: none (countdown math untouched).
- Proof: a Playwright 360x740 in-viewport assertion on the first CTA (extend `e2e/countdown.spec.ts` or `e2e/polish-bundle.spec.ts`); countdown specs green.
- **Status: RESOLVED in S258.** Quote + CountdownRing (including its digit; the 2×3 grid stays) hidden below 420px, plus a <420px padding trim to clear the last 4px. One declared baseline regen (home-hero-mobile), all 23 others proven untouched.

### TD-07: FU-17, the 112KB nomodule polyfill chunk ships in out/ and the SW precache
- Verified: `out/_next/static/chunks/polyfills-42372ed130431b0a.js` = 112,594 bytes, referenced with noModule from every route HTML (out/index.html). `gen-sw.mjs` precaches all of _next/static/**, so every installed client downloads 112KB it will never execute, since any SW-capable browser is a module browser. That is ~2.5% of the 4.5MB static precache.
- Change: a post-build step inside `gen-sw.mjs` (it already runs after next build) that deletes polyfills-*.js and strips its script tag from each route HTML. It then falls out of the walked precache list automatically.
- Size: S. Risk: low. It drops pre-ES-module browser support the app never really had; note that in the script header.
- Proof: `npm run build`, then assert no polyfills- file under out/; serve out/ and load with zero console errors; SW specs green.
- **Status: RESOLVED in S265.** `stripPolyfills()` added to gen-sw.mjs, running before the precache walk: it deletes `out/_next/static/chunks/polyfills-*.js` and strips the `<script ...polyfills-...></script>` tag from every HTML file, and the header comment notes the pre-ES-module-browser drop. It fails soft with a stdout WARN when the glob matches nothing (Next-rename drift). Verified: deleted 1 chunk, stripped 17 HTML files; 0 polyfills-* files under out/; 0 route HTML references `polyfills-`; precache 164 → 163, with only that one entry removed; the home page served from out/ loads with 0 console and page errors; `pwa.spec.ts` SW pack green.

### TD-08: Concierge speaks the hardcoded Nepal-x-Japan boys-trip persona on custom trips
- Verified: `worker/src/providers.ts:32-36` SYSTEM_PROMPT is N-x-J-specific ("Kathmandu Dec 9-18... boys trip"), and `components/navbar.tsx:441` mounts ConciergeChat unconditionally even though the navbar already computes the custom-trip flag for branding (:289, :304).
- Change: a client-side gate only, no Worker redeploy. Render the concierge trigger on the default pack alone, from the same source as `navItemsForActiveTrip` (`lib/nav-items.ts:81`). A trip-aware Worker prompt is a separate later slice if it is ever wanted.
- Size: S. Risk: none.
- Proof: an assertion in `e2e/custom-trip-gating.spec.ts` (trigger absent on a custom trip, present on the default).
- **Status: RESOLVED in S258; the trip gate has since been deliberately re-opened.** S258 landed the client-side gate as `{isDefault && <ConciergeChat />}`. That rule now lives in exactly one helper — `isConciergeAllowedForActiveTrip()` (`lib/concierge-config.ts:55-57`) — called by both mounts (`components/navbar.tsx:60,336` and `components/travel-concierge.tsx:32-34`) so the two cannot drift. The constant it reads is `true` (`concierge-config.ts:45`), because the precondition recorded there was met: `concierge-config.ts:22-28` states the owner deployed `trip-planner-concierge` v1.8.0 on 2026-08-09 with its Version ID, making the live system prompt trip-aware, and `lib/__tests__/travel-concierge-gating.test.ts` pins both the constant and that deploy record. The original defect — an N×J persona answering a custom trip — is therefore addressed in the Worker's own prompt (source outside this repo), not by hiding the panel. The gate is still exercised on a concierge-enabled test build (`.github/workflows/ci.yml:65,92` bake `NEXT_PUBLIC_CONCIERGE_URL=https://concierge.test`), and the panel remains inert in any deploy where the `NEXT_PUBLIC_CONCIERGE_URL` repository variable is unset (`.github/workflows/deploy.yml:80-84`, which echoes `concierge-url present: yes/NO`).

### TD-09: Stale firebase/auth vi.mock blocks in 4 test files after auth removal
- Verified: D-209/D-205 removed Firebase Auth entirely (`lib/itinerary-remote.ts:56-60`, "the whole firebase/auth module ... removed"), but `lib/__tests__/budget-remote-sync.test.ts:57-62`, `docs-remote-sync.test.ts:55-57`, `expenses-remote-sync.test.ts:53` and `itinerary-remote-sync.test.ts` still mock a module that is never imported. They are no-op mocks plus comments describing flows that no longer exist.
- Change: delete the mock blocks and their comments in the 4 files.
- Size: S. Risk: none.
- Proof: `npx vitest run` stays 1336/1336.
- **Status: RESOLVED in S264.** Mock blocks and comments deleted from all 4 files; vitest 1336/1336 unchanged.

### TD-10: tsconfig.tsbuildinfo is tracked in git
- Verified: `git ls-files` lists `nextjs_space/tsconfig.tsbuildinfo` (out/ is properly ignored), a machine-generated cache creating diff churn on every tsc run.
- Change: `git rm --cached nextjs_space/tsconfig.tsbuildinfo` plus a .gitignore entry.
- Size: S. Risk: none.
- Proof: `git status` clean after a tsc run.
- **Status: RESOLVED.** No `tsbuildinfo` is tracked (`git ls-files` returns no match) and the root `.gitignore:12` carries `*.tsbuildinfo`, so a `tsc` run leaves the tree clean.

---

## NICE-TO-HAVE

### TD-11: Banner historical docs as historical
- Verified: `docs/v4-technical-doc.md` (last commit 2026-07-10, "Produced 2026-07-06", written for a review flow that no longer exists) reads as current guidance. The blueprints (sync-v2, data-core, etc.) are living contracts, so leave those alone.
- Change: a one-line "Historical — superseded by v5; kept for reference" header on v4-technical-doc.md, and on the v4 plan at the repo root if it is the same vintage.
- Size: S. Proof: n/a (docs-only).
- **Status: RESOLVED in S264.** Banner added to docs/v4-technical-doc.md, the v4 plan and V4-DEVPLAN.md. Blueprints untouched.

### TD-12: Repo-root housekeeping, an untracked trip-summary file
- Verified: at audit time `git status` showed an untracked plain-text trip summary at the repo root. Commit it or delete it; one minute either way.
- **Status: RESOLVED.** No such file is present here, tracked or untracked: `git status --porcelain` is empty and the repo root holds only `.firebaserc`, `.github/`, `.gitignore`, `DECISIONS.md`, `README.md`, `firebase.json`, `firestore.rules`, `rule.md` and `trip/`.

---

### TD-13: (filed at S266, 2026-07-23) expense-dialog leg toggle hardcoded nepal/japan
- Surfaced during S266: `components/expense-dialog.tsx` hardcoded the leg toggle to `['nepal','japan']`. A custom trip has one synthesized leg, so the toggle was N×J-specific — a cosmetic leak on custom trips, since the roster itself was already fixed by TD-03/D-223.
- **Status: RESOLVED.** The toggle maps `LEGS`, which `core/budget/model.ts:54` derives from the active trip (`getActiveTrip().legs.map((l) => l.id)`), and renders each entry through `legLabel`/`legCurrency` (`components/expense-dialog.tsx:347,363-364`; the rule is stated in the comment at `:344-346`). A custom trip now shows its own single leg with its own label instead of two foreign countries.

## SKIP (evaluated, deliberately not doing; reasons on record)

1. Fire-and-forget pushTripMeta/pushTripList (deferred item b). The mitigations are verified in code: the joiner self-heal one-shot fetch (`components/itinerary-provider.tsx:288-316`, session-guarded) and the subscribe's seed/push-back (`lib/trips-remote.ts:143-171`). An outbox for trip metadata would duplicate D-150 machinery for a value that self-heals on the next rename or subscribe. Correct ceiling, keep it.
2. pushTripList read-merge-write is not transactional (`lib/trips-remote.ts:105-118`). Two racing devices lose at most an addition until the next snapshot merge round-trips it back, and the additive union converges. A Firestore transaction buys nothing user-visible on a personal profile doc.
3. data-vibe accent tokens (deferred item d). Zero data-vibe refs exist, and the vibe accent and gradient already flow inline from `core/trips/custom.ts` VIBES into `components/hero-section.tsx:192-218`. Tokenizing adds indirection with no consumer. YAGNI.
4. calendar-planner.tsx at 1636 lines (settings-panel.tsx 1281). Big but cohesive, tsc-clean, covered by the heaviest e2e suites in the repo. Splitting is churn risk with no bug behind it. Revisit only when a slice forces entry.
5. A shared stripUndefined helper for the 5 duplicated one-line JSON round-trip sanitizers (`budget-remote.ts:41`, `docs-remote.ts:46`, `expenses-remote.ts:48`, `itinerary-remote.ts:173`, `trips-remote.ts:76,207-208`). Each is one commented line, and a shared helper couples five locked-pattern modules to save ~5 lines.
6. lib/currency-rate.ts raw localStorage (:45-66). A documented, flagged D-097 exception (file header :10-15), fully try/caught. A recorded decision, not debt.
7. The shortcut note at use-card-tilt.ts:69, gyro calibration. Untunable without a physical device and explicitly parked for the real-iPhone field test. It cannot be paid down at a desk.
8. The shortcut notes at core/budget/settlement.ts:21 and :106-107, even-split greedy. Correct and effectively optimal at n=3; a weighted split or exact solver has no user.
9. The shortcut notes at app/globals.css:837 (iOS Safari overscroll, where no CSS upgrade exists), globals.css:568 (sheet-open view-transition groundwork, which needs a design slice rather than paydown), reveal.tsx:38 (behavior note) and search-plan.ts:16 (no fuzzy search; deterministic ordering has no complaint behind it). All honest notes or platform limits.
10. Worker hardening beyond current. index.ts already validates origin/method/token/size/JSON, and fetchChatCompletion cannot reject. Nothing real left to add.

---

## Sequencing recommendation

1. TD-02 first (lint). It changes the definition of green for every later slice, so land it before code churn.
2. TD-10, TD-09, TD-05, TD-12: zero-risk cleanups, batchable into one slice.
3. TD-04 then TD-07, both of which live in gen-sw.mjs. Do 04 (behavior-identical, diffable) before 07 (behavior change) so each is independently provable.
4. TD-03, TD-06, TD-08, TD-11: independent, any order.
5. TD-01 last. It is the only slice touching sync-merge semantics plus a new gateway key, so land it on an otherwise-quiet tree with the full Vitest and trips/sync e2e set run separately, outside the implementation task, because the long single-worker net trips the watchdog when run inline.

---

## APPROVED BUT NEVER BUILT

Two features cleared their approval gates and have no implementation. Neither is debt in the sense the items above are — nothing in the code is wrong — but both are approved scope with no code, recorded here so the gap between a standing decision and the tree is visible in one place.

### AB-01: Web Push morning briefing (D-167; protocol locked by D-175) — approved, never started
- Approved at the v5 plan lock (D-167, 2026-07-16) as a runway-permitting build, slices S201/S202, sequenced strictly after the concierge Worker exists **and** after FU-18's deployed Firestore rules, which D-167 and D-175 both name as a hard precondition for `pushSubs` (`docs/V5-DEVPLAN.md:110` says the same). The S197 spike then returned an explicit **verdict GO** on the protocol (D-175: raw Web Push + VAPID rather than FCM, Worker-signed, iOS 16.4+ installed-PWA supported, free and card-free). The Worker half of that precondition has been met since 2026-08-09 (`lib/concierge-config.ts:22-28`).
- Proof of absence (`trip/`, checked on `main`, `dev`, `lax`, `uttam` and `trip-access-control-lax`): grep for `pushManager`, `PushSubscription`, `applicationServerKey`, `VAPID`, `Notification.requestPermission`, `showNotification` and `notificationclick` across `*.ts`/`*.tsx`/`*.mjs`/`*.js` returns **zero hits in source**. Every match in the repo is in the planning docs — `docs/V5-DEVPLAN.md:41` and its Phase 4 table at `:110-119`, the Badging note at `:187`, `docs/v5-ai-concierge-feasibility.md:79-119`, and `docs/V4-DEVPLAN.md:387,402` — all of which still describe S201/S202 as planned work. `scripts/gen-sw.mjs` registers only `install`, `activate`, `message` and `fetch` handlers (`:764,794,815,883`) — no `push` and no `notificationclick`, precisely the pair D-175 said would be merged in. The `pushSubs` slot D-175 names does not exist in `core/storage/gateway.ts`'s key registry.
- D-167's own "Changes if" clause permits a clean cut ("runway runs out … nothing else depends on it"), and nothing in the code does depend on it. But no `DECISIONS.md` entry records that cut, so on paper it is still approved work. **Action: rule it — build or retire — rather than leave it approved and silent.**

### AB-02: The passport page and the S422 visual direction (D-294, D-291) — ruled, no code
- D-294 (2026-08-09, decided after three rendered variants were compared as real pixels) specifies a passport page as a parchment material: `--paper: #DCCDAE` with its own ink tokens, a narrow named exception to D-009's dark-only rule, all six ink pairings measured at 5.34–9.86:1 by a `parchment-verify.mjs` harness. D-291 (same session, owner-ruled) supersedes D-235 and retires D-269: interactive accent marigold `#FFC43D`, country gradients driving real chrome (Nepal `#FF8A3D → #FFC43D`, Japan `#FF8FC7 → #C08CFF`), and the canvas moving from charcoal `#0b0c0e` to aubergine `#100C1A`, with 69 pairings measured by a `contrast-4.mjs` harness.
- Proof of absence (`trip/`, checked on `main`, `dev`, `lax`, `uttam` and `trip-access-control-lax`): there is no passport route — `app/` holds 17 `page.tsx` files and none is it. Grep for `parchment`, `--paper`, `DCCDAE`, `FFC43D`, `marigold`, `100C1A`, `aubergine`, `FF8A3D` and `C08CFF` across `*.ts`/`*.tsx`/`*.css` returns **zero hits**, and `git grep -iE "FFC43D|marigold|parchment"` over `trip/` returns nothing on any of those branches. `scripts/` contains neither `parchment-verify.mjs` nor `contrast-4.mjs`, the two verification harnesses those entries cite.
- Both entries are dated 2026-08-09, one day before this pass, so this is plausibly work in flight rather than work abandoned. It is recorded because D-294 is written in the present tense about a surface that does not exist, and a reader of `DECISIONS.md` alone would conclude it shipped.
