# V-FINAL DEVPLAN — the last version of this app

_Scope document for the final major version, written 2026-08-09 from eight research reports (S398–S405)
under `docs/plans/`. This file is the authority on the final wave's scope and slice numbering. Where it
disagrees with `S404-vfinal-backlog-proposal` or `S405-vfinal-risk-ranking`, this file wins: both were
written before the build phase claimed S406–S408, so their slice IDs are superseded. Section 0.3 carries
the mapping._

---

## 0 · What this is, and three things to read first

The rule for this version is that it is the final update: after this there will be no update. So the
question behind every row below is not "is this worth doing?" but "what happens between now and after
Jan 9 2027 if nobody ever touches this again?" An item with no unattended-failure mode was cut by
default; an item that decays silently was promoted.

The trip is Dec 9 2026 → Jan 9 2027 (Kathmandu, then Japan). The app has to serve it and then survive,
unmaintained, indefinitely.

### 0.1 · The finding that changes work already in flight

The mechanism, verified at source rather than relayed. `docToDayPlan` returns a hard four-field
whitelist, `{ date, city, country, items }` (`nextjs_space/lib/itinerary-remote.ts:123-129`), and it is
behaviour-frozen by S77. The write path does not filter: `sanitizeDayForWrite` is
`JSON.parse(JSON.stringify(day))` (`:164-166`), so a new per-day field goes up to Firestore intact.
Both read boundaries route through the whitelist, and there are exactly two, confirmed by grepping every
runtime call site: the transactional-push remote read (`:272`) and snapshot assembly (`:496`). The
file's own docblock names the same pair. Downstream of the second,
`persistAndDispatch(plans.map(defaultDayForMerge))` (`:415`) writes the already-mapped, verbatim remote
days over the local ones. A slice scoped to the snapshot path alone would leave the push-merge boundary
dropping the field on every push.

That is the mechanism by which a per-day field is written up and dropped on read back. S407 added a
per-day `countryLabel` to `DayPlan` and set it on the seed row for Day 1, and it closed that half
itself, at both read boundaries, before it shipped: `itinerary-remote.ts:135` now passes the field
through, and the transactional-push remote read (now `:280`) was rewritten from a four-field literal to
`{ ...localDay, items: [] }`. S407 landed as part of commit `4eea7de`, and it edited
`itinerary-remote.ts` directly (15 insertions). `countryLabel` is therefore no longer only on `TripLeg`
(`core/trips/model.ts:15`); it now lives on `DayPlan`, `contentDayPlanSchema` and `dayPlanSchema` as
well. Confirm that pass-through, do not re-do it.

What is still open is the leg coercion at `itinerary-remote.ts:125`:

```
const country = data.country === 'japan' ? 'japan' : 'nepal'
```

It silently re-legs every custom trip's `'main'` days to `nepal` on read-back, dragging NPR currency
and a +5:45 offset onto days that are neither. That is what S415 has to fix, and it is pinned as
correct behaviour by the S77 suite (`itinerary-remote.test.ts:42`, `country: 'atlantis'` → `'nepal'`),
so S415 has to amend that pin deliberately. This is why S415 is floor (section 2), and it is why the
write/read asymmetry above is kept on the record even though its own half is closed.

One caution on anchors: `:123-129`, `:164-166`, `:272`, `:496` and `:415` predate S407 and have drifted
8–15 lines, so re-derive them before use. The `:135`, `:280` and `:125` anchors are current.

### 0.2 · The floor — what the final version must not ship without

Six items. Everything else in this document is discretionary; these are not.

| # | Floor item | Lives in | Status |
|---|---|---|---|
| **F1** | The final gate executed in full, with the **eight** amendments in section 6 | **S420** | open |
| **F2** | The leg-coercion defect and the `countryLabel` sync-drop above | **S415** | open; carved out of S407 on purpose, and orphaned until this plan lands |
| **F3** | The claim rewrite ships only under the nine money invariants | **S408, landed** | mostly closed; see section 0.4 |
| **F4** | Scrub hardening + independent re-grep of every changed mirror file + the `EXCLUDE_DIRS` check | **S417 + S421** | open |
| **F5** | The service-worker update toast verified **during** the final deploy | **S421** | open |
| **F6** | **The NPR reference rate refreshed at deploy.** S419's surviving half, now that the concierge flag is already flipped (see S419 in section 2). Floor because the app is **already live** carrying `134.5` as-of `2026-07-24` against a December trip, and a half-satisfied S419 retires it silently | **S419** | open |

### 0.3 · Slice numbering — the collision, resolved

The build phase claimed S406 (ruling #1, map search), S407 (ruling #2, leg labels) and S408 (ruling #3,
names-only claim rewrite). The earlier proposal had independently numbered its fifteen final-wave
slices S406–S420. Three pieces of work carried six IDs, and `S408` meant two different things in two
live documents. The backlog had zero references to any of them, so the correction is free, and this was
the last moment that would be true.

Resolution: the three rulings are their own effort, a separate wave that goes live once this one is
done, and they leave the final wave entirely. The final wave is **S409–S421**, contiguous.

| Old ID (S404/S405) | Now |
|---|---|
| S406 gate honesty · S407 TD-01g | → **S409** · **S410** |
| S408 map search · S409 leg label · S410 claim rewrite | → **left the wave**: in-flight **S406 / S407 / S408** |
| S411 R6-res category guard | → **DROPPED** (section 4), an evidence overstatement confirmed independently |
| S412 · S413 · S414 | → **S411** · **S412** · **S413** |
| glyph self-host (was DEFER) | → **S414**, promoted |
| *(new, from the finding in 0.1)* | → **S415** |
| S415 landing · S416 scrub · S417 docs · S418 constants · S419 gate · S420 publish | → **S416 … S421** |

### 0.4 · Where the claim rewrite's money gate actually stands

S408 has landed, and the sharpest gap named below was found and closed during the build rather than
after it. The guard in that lane was a hand-listed "must touch only these fields" assertion, which by
construction covers only the fields whoever wrote it thought of: forcing `category` onto every claimed
row left it, the `settle()` invariance check and both merge proofs green. It was replaced with a guard
that derives the changed-key set by diffing the union of both objects' keys, so a newly-added field is
covered automatically. The money mutation was re-run independently and goes red for the right reason:
`split: ['Traveler','Powan'] → ['Powan','Powan'] → uniq → 1 member`, so a 3000 NPR bill divides by one
and a balance moves from −1500 to 0. The lesson generalises: prefer the key-diff form for every "touch
only X" assertion. What remains open is **preview honesty** and **fixture breadth**, and both are
carried as gate criteria in section 6.

The assessment as first written, kept because it is why the gate criteria exist. Measured against the
nine invariants at the time, two were instructed well (the field allow-list, and the `rev`/`hlc`
stamping, which had to be *proven* by a remote-merge round-trip rather than asserted), two were
instructed in part, two are satisfied by construction because the work pointed at code that already
behaves correctly (per-row selectivity, and tombstone skipping, where `hooks/use-itinerary.ts:134`
returns false for `deleted === true`), and three were genuinely uninstructed:

- **`expensesToSpent` equality**, which appeared in no instruction, and is now closed (above). It was
  not redundant with the `settle()` check: `settle()` reads `leg`/`deleted`/`split`/`paidBy`/`amount`
  (`core/budget/settlement.ts:71-79`) while `expensesToSpent` reads `leg`/`category`/`amount`
  (`core/budget/expenses.ts:169-187`), so a rewrite that corrupted `category` passed the shipped test
  green and moved every budget rollup. That was demonstrated, then fixed by the key-diff guard.
- **Preview honesty.** The shipped warning ended *"Expenses and documents are not changed."* S408 makes
  that sentence false, and nothing said what replaces it. The realistic failure is someone deleting it
  and writing nothing. Whoever owns the copy has to be told that Settle-up balances and the paid-by
  chips **keep the old name**, because that residue is deliberate.
- **Fixture breadth.** Tombstone rows, `paidBy`-absent rows and legacy rows without an `hlc` are not
  required in the test fixture.

Now that S408 has landed, the two survivors become explicit acceptance criteria at the final gate
(section 6, amendments 6 and 7) rather than a new slice. The gate is also where the existing
"no-blanket-bump test present and green by name" requirement has to be reconciled, since the build
instructions never asked for that test.

---

## 1 · The final-update contract

What "no more updates" commits us to, stated plainly so it can be checked:

1. **Nothing may depend on a human noticing something.** No renewals, no rotations, no re-baselining,
   no "refresh this when it drifts." Where a value expires, it is either refreshed at deploy and
   labelled as a reference figure, or the feature that reads it degrades honestly.
2. **Every external service is assumed to die eventually.** The test is not "will it survive?" but
   "what does a traveller see the day it doesn't?" A hard failure is a defect; a labelled degrade is
   acceptable.
3. **The last gate is the last one.** Whatever is not verified before the final tag is never verified.
   Manual checks that automation cannot reach have to be executed once, by a human, and recorded.
4. **The permanent record must be true.** Stale ledgers, over-claiming citations and shipped comments
   that describe protections which do not exist all become permanent on the final commit.
5. **Nothing lands in the last version that only pays off in the next one.** That is why the evaluation
   harness, the two-call model split and the cross-session memory are dropped in section 4: each is an
   investment in iterations that will not happen.

### The December test — what decays, with zero maintenance

Verified against the code and against provider terms retrieved 2026-08-08:

| When | What changes | What the traveller sees |
|---|---|---|
| Dec 9 → Jan 9 (the trip) | Nothing scheduled to break. **Zero of the ten network egress points hard-fail** — every one degrades in code. | Full app. Weather, currency and map tiles degrade to cached or labelled-stale values if signal or a service is out. |
| Any day, without warning | CARTO basemap tiles could be withdrawn — their current FAQ restricts basemaps to Enterprise licensees, which **contradicts this repo's own comment** at `nextjs_space/lib/map-style.ts:13` ("free basemaps, no token"). | Street artwork disappears. Pins, routes, day maps and the offline engine keep working — this is the already-shipped offline look. |
| Any day | The MapLibre **demo** glyph host (`map-style.ts:83`) stops serving font tiles. | Cluster markers lose their numbers. Nothing else. (S414 closes this if the fonts are small.) |
| Through 2027 | Groq retires the pinned models. `openai/gpt-oss-120b` enters the trip window ~16–17 months on-platform, inside Groq's historical 9–20 month retirement band. | The concierge fails with an honest sentence (S412). The rest of the app is untouched. |
| ~1 year+ | The community-run currency API stops. | JPY falls back to service-worker cache → last known → a labelled "unavailable". Never an error. |
| ~2028 at the earliest | If the Google account holding the Firestore project goes two years unused, Google's inactivity policy allows deletion of its content, which would take the project with it. | Group sync stops. The app is local-first, so each device keeps its own data. |

The NPR rate is the one value that is already stale: `134.5` as-of `2026-07-24`
(`nextjs_space/lib/currency-rate.ts:131`), hand-set, feeding a December trip. It is refreshed at deploy
in S419 and labelled a reference rate. After that it can never be right again, only honest.

---

## 2 · GO — the final wave, sequenced

Thirteen slices. The sequencing rules are baked in: the honesty slices come first so every later slice
builds under a real gate; S415 and S416 wait on the in-flight ruling slices; and the tail is
owner-coupled, running worker deploy → flag flip and rate refresh → gate → publish.

| # | Slice | Why it is in the last version | Size | Waits on | Risk |
|---|---|---|---|---|---|
| **S409** | Gate honesty: make lint run in the build (**errors only**) and widen the Vitest include-glob | Every later slice builds under a gate that currently ignores lint (`next.config.js:42`). Set `eslint.dirs` in the SAME edit: `ignoreDuringBuilds: false` alone lints only Next's default set (`app`/`pages`/`components`/`lib`/`src`, `node_modules/next/dist/lib/constants.js:291`), so `core/`, `hooks/`, `scripts/` and `e2e/` become permanently invisible to the only linter that will ever run again, and the final gate has no `npm run lint` step to backstop it (`grep -c lint` on the S401 gate doc = 0). Use `eslint: { ignoreDuringBuilds: false, dirs: ['app','components','lib','core','hooks'] }`. S411 edits `hooks/`, S415 edits `core/trips/` and S417 edits `scripts/`, so three of the remaining slices land in that blind spot, and `react-hooks/rules-of-hooks` is an **error**-level rule under `next/core-web-vitals`. Note the trap in "mutation-prove both halves": the 4 known errors live in `lib/__tests__/`, so a mutation proof performed where the errors are goes green and certifies the blind spot. Fix the 4 live errors in-slice or the flip reds its own first build, at `nextjs_space/lib/__tests__/s345-front-door.test.ts:23,32` and `s346-audit.test.ts:30,39` (re-measured 2026-08-09: **4 errors / 99 warnings**, not the 0/57 assumed) | S | — | M |
| **S410** | Add the `assertConciergeWired` guard to `e2e/place-import.spec.ts`, plus one wired re-run | Closes the last "green but proves nothing" hole in the concierge suite | XS–S | S409 | L |
| **S411** | Gate `/travel`'s live fetches behind the wall for signed-out visitors | The app will make these calls forever, unattended; free-tier hygiene is a standing rule | S | — | L |
| **S412** | Concierge end-state: reason codes on dropped ops, plus two fail-dark copy fixes | Today a dropped suggestion is silent, and a dead provider surfaces as a raw `Failed to fetch`. Both are permanent once frozen | S–M | — | L |
| **S413** | Offline phrasebook: static Nepali/Japanese cards. It has to join under LOCKED D-135's four-part contract (`DECISIONS.md:1046`): one data module + one **strict** schema + one validator case in `lib/__tests__/content-validation.test.ts` + one row in `docs/trip-content.md`. This is the only new content domain in the final version, and its structural twin `ETIQUETTE_TIPS` in the same module family is already schema-parsed | Chosen deliberately; used daily at zero connectivity; zero API, zero rot | S | — | L |
| **S414** | Glyph self-host: **measure first**, then self-host under `public/` or record the measurement and drop it forever | Removes the last no-SLA runtime host; ruling-#2 shape, where the byte count decides rather than taste | S | — | L |
| **S415** | **FLOOR.** The leg-coercion defect and the `countryLabel` sync-drop (section 0.1), at **both** read boundaries, `:272` and `:496`. Two constraints to carry: persisted bytes for **default-pack** trips stay unchanged (`core/trips/model.ts:11-12`), which is the one check that catches an edit altering real-trip bytes while every custom-trip test stays green; and it must not introduce multi-leg custom packs, which would reach the eastbound-only ceiling at `lib/trip-now.ts:158` | Without it, custom trips get silently re-legged on sync. Scope corrected 2026-08-09: the `countryLabel` half is closed, since S407 fixed both boundaries itself (`:135` and `:280`), so confirm it rather than re-doing it. What remains is the leg coercion alone, at `itinerary-remote.ts:125`, plus the deliberate amendment of the S77 pin at `itinerary-remote.test.ts:42` that asserts it. Re-derive every line anchor: the ones in section 0.1 have drifted 8–15 lines | S | S407 landed, unblocked | **M** |
| **S416** | Landing truth pass: re-shoot the third screenshot, re-read every caption and alt against the new pixels | The front door currently shows a map the app no longer has and claims an offline capability that was narrowed. Last content change before the push | S | S406 + S407, both landed at `4eea7de`, unblocked | L |
| **S417** | **FLOOR (part).** Scrub hardening: the gate-superset invariant test, delete the fossil scrubber copy, fix the marker-strip punctuation, and widen the marker set with the residue the S424 publish run actually found by independent re-grep: `TD-##` debt ids, references to `lib/__tests__/` and `e2e/` paths that are excluded from the mirror, and a **lowercase** `s345-` filename that the uppercase slice-id pattern misses (recorded in commit `18dc72f`; the gate itself did not catch these, only the human re-grep did) | Protects exactly one more scrub run, the permanent one. The scrub gate is circular by construction and has leaked before | S | before S421 | M |
| **S418** | Final docs pass: stale-pointer sweep · correct section 3 of **D-278**, which over-reads D-088 (`DECISIONS.md:2520`; **not** D-279, which an earlier note misattributed and which says nothing about geocoding) · fix the in-code comment at `nextjs_space/lib/map-style.ts:13` that calls CARTO basemaps "free, no token" · record S402's two proposed ADRs (the claim-rewrite invariant gate; the post-final "no internal fix required" durability posture) · banner **D-167/D-175** (push notifications) as GO'd-but-never-built. Corrected 2026-08-09: an earlier text said D-172, which is wrong and dangerous, because `DECISIONS.md:1228` D-172 is LOCKED, is *Trip Packs storage* ("grandfather, never migrate … one `keyFor()` in the gateway"), is built, and the backlog cites its byte-identity guarantee as load-bearing for the grandfathered sign-in path, so bannering it "never built" would falsify a LOCKED entry permanently. The morning-briefing GO is **D-167** (`:1206`, "BUILD if runway allows"), which no planning document names anywhere, and D-175 (`:1245`) is the Web Push protocol GO and is correctly cited · also banner **D-173** (PMTiles/OPFS offline map tiles) with "CLOSED NO-GO by D-197; the shipped answer is D-286 — engine precached, tiles are not", since its header carries no supersession marker and its live "If GO:" branch still reads as standing guidance, unlike D-003/D-168 which do carry one · and amend the in-repo carrier of the inspiration-hub clause, which is the founding contract document's project section: its Mission line and its definition-of-done list. *There is no "build spec" tracked in this repository (`git ls-files` has none), and the source lane's "amend the project section" was demoted in the merge to an unresolvable pointer. While in that section, correct three further clauses that are false against the shipped app: the map is a real MapLibre GL map (D-079 LOCKED supersedes D-003), a backend ships (`worker/`, deployed 2026-08-09), and itinerary data no longer persists only to localStorage (Firestore group sync).* · apply the ledger dispositions: rewrite the deferred-shortcut debt ledger from the verified 21-marker register; delete the old tech-debt register, the S364 handoff and `V4-DEVPLAN.md`; banner `V5-DEVPLAN.md`; keep the cleanup review until the owner actions land, then delete it post-publish | The ledgers become the permanent record on the final commit, and rule 4 in section 1 says that record has to be true | S | owner answers on 7.6 | L |
| **S419** | **Scope halved 2026-08-09.** Flipping the concierge flag after the worker deploy is already done, in slice S424 (`18dc72f`): the worker deployed live at v1.8.0 (Version ID `157ed2e0-2cfb-4044-af3e-ea80bc1b4ce6`), `CONCIERGE_ON_CUSTOM_TRIPS` is `true` at `lib/concierge-config.ts:45`, and the pin was amended and now asserts `toBe(true)`. The only surviving work is the **NPR rate refresh** (`lib/currency-rate.ts`, still `134.5` as-of `2026-07-24`) | **F6 floor.** The app is already live at v5.11.2 carrying the stale rate, so this is not deploy-eve hygiene but a live defect. The realistic failure is someone opening this row, finding the flag flipped and the pin amended, and marking it satisfied, which retires the one value section 1 names as already stale. NPR is the last code touch: anything landing after it re-dates `asOf` | XS | worker deploy satisfied; all code slices | M |
| **S420** | **FLOOR.** The final gate: the eight-step checklist plus the **eight** amendments in section 6, plus the manual device script. Includes the one live concierge round-trip against the deployed worker (the original "the AI can't modify my plans" complaint was never recorded as reproduced-and-cleared; the code residual ships in S412, but only a live round-trip closes it) and the three named sync residuals (same-item HLC tie-break, a non-itinerary domain, and the badge failure states), each named in the gate record, not just exercised | It is the last verification anyone will ever run | M | S409–S419 | **H** |
| **S421** | **FLOOR (parts).** The publish run: version bumps, release notes, full-marker scrub, independent re-grep of every changed mirror file, the mirror PII re-publish, final deploy, and the update toast verified during it | After this the repo freezes. The re-grep is not optional, because the scrub gate only proves the markers it already knows | M | S420 green; owner present | **H** |

---

## 3 · DEFER — not in the sequence unless a precondition fires

| Item | Precondition | If it fires |
|---|---|---|
| Sync **My Places** across devices | a yes on 7.2 | M slice, before S416; needs its own gate coverage and a manual sync step |
| Pre-trip **self-diagnostic** screen | a yes on 7.3 | M slice, scoped strictly to precache / storage / clock. The rot audit found zero hard-fail egress, which shrinks what it would catch |
| Wire the **duration** field (clash detection) | a GO on 7.4 | M slice after S409; otherwise dropped forever, and the badges stay inert rather than wrong |
| Concierge **clash warning** | a yes on 7.8 | S slice, warning-suffix only; client-side, so it can ride late |
| Registry tombstone cap in `importRemoteTrips` | only if a slice already passes through that file | One-line rider. Do not open a slice |

---

## 4 · DROP — the permanent record

Nothing here moves to a later backlog, because there is no later backlog. Twenty-nine items, each with
its reason.

**Product and UX (from the scope survey).** Takeout/KML/CSV place import: no owner signal, and the trip
works without it. Multi-trip scratch map: post-trip novelty. Group reactions and polls: adds Firestore
surface to freeze, and nobody asked. Day-route optimisation: re-litigates a settled ruling. "Leave by"
nudges: an unreliable nudge is worse than none, unattended. Paste-a-confirmation import and social-link
extraction: owner-gated worker scope, never signalled. Read-only trip token with a print stylesheet: the
print half was declined outright, and the token half needs a rules deploy nobody wants. Trip Reel video
export: the largest row, and pure novelty. Journal layout upgrades and expense breakdown lenses: polish
on shipped features. Map photo-markers and clustering: the revamp landed, and clusters already exist.
Thumb-zone, progressive-disclosure and accessibility "deepening" audits: each unbounded in shape, and
the shipped accessibility bar is held and gated. Haptics: iOS has no vibration API. Graceful-degradation
matrix: answered as the one-time report it should have been. Light theme: dark-only was re-affirmed, and
a theme fork doubles the frozen test surface. Storage quick wins: the 90%-quota toast already covers the
moment. CRLF normalisation: the repo freezes, so a tree-wide diff buys nothing lasting. Printable
itinerary: an explicit no. Joiner first-paint calendar flash: self-heals in one reload.

**Technical.** The `data-stop-count` attribute's four meanings: test-clarity only, and the in-file
comment already documents the split. The category-guard third site, dropped after independent
verification: `core/content/schema.ts` has exactly one importer in the whole tree (a validation test),
never runs on the read path, and fails loud in both drift directions, unlike the concierge path that
genuinely drops user data at runtime. The post-trip backup nudge: persistence, the install hint and a
photo-inclusive export already ship.

**AI.** The evaluation harness: a regression-catcher for iterations that will never happen, whose
baselines rot against a live model with nobody to re-baseline them. The two-call prose/ops split:
doubles the deprecation surface to save nothing. Question-scoped digest trimming: an untunable heuristic
in the hot path. Cross-session memory: contradicts the shipped "nothing is stored here" disclosure,
verbatim. Ladder observability: the model chip already is the observability, and logging is forbidden by
a locked decision. Search query rewriting: moot, since the search leg was deleted.

**Also dropped, recorded here because each was live somewhere and would otherwise rot:** the
context-aware home screen (the "Today" home shipped instead, and was the cut chosen at the time) and
push notifications, where the decision log carries two GO'd entries for a morning briefing and Web Push
that were never built, so S418 banners them as never-built rather than leaving a live GO in the
permanent record for a feature that will not ship.

**Pending your word, recommended for burial:** the four front-door / guest-mode rows (7.1).

---

## 5 · Rot register — what still decays, knowingly

The rot audit classified ten rows covering every runtime network egress, and the hard-fail count is
zero: nine degrade in code, and the tenth (a Wikipedia call) is build-time only, so it cannot fail at
runtime at all. The list below is the accepted-forever record. It groups those egress rows with three
non-network decay sources (a hardcoded rate, hosting survival, browser storage), so read it as
"everything that decays" rather than as the egress table itself. Each entry names its symptom, so a
future reader knows it was a decision and not an oversight:

- **Map tiles (CARTO).** The app has no documented right to them and may lose them any day. Degrades to
  the offline look. Their canonical terms are a Drive-hosted PDF that could not be extracted, so this is
  recorded as *unverified* rather than as "no contract exists"; their public FAQ is the stricter source,
  and it restricts basemaps to Enterprise licensees and grant recipients. The in-code comment at
  `lib/map-style.ts:13` that calls them "free basemaps, no token" is corrected in S418.
- **Glyph host (MapLibre demo).** No SLA. Cluster numbers only. S414 may close it permanently.
- **Currency (community API).** Triple fallback already shipped: cache → last known → labelled
  unavailable.
- **NPR reference rate.** Never fetched at all; a hardcoded constant, refreshed at deploy and labelled.
  It is currency-board-pegged to INR (stated band 133–136 through 2026), so a refreshed value should
  stay close for the trip. Drift is slow but unbounded after the peg's horizon.
- **Weather (Open-Meteo).** Hides rather than errors.
- **Firestore (Spark, free).** Survives on quota. The real cliff is the two-year account-inactivity
  policy, which is why item 6 in section 8 exists. The app is local-first regardless.
- **The worker (Cloudflare, free).** No policy exists on how long an un-redeployed worker lives, and
  absence of a clause is not a commitment. Two shipped features sit behind it, not one: the concierge
  (error row plus "Try again") and place-link import (the resolver returns null and the sheet falls back
  to manual entry). It is now deployed, v1.8.0, Version ID `157ed2e0-2cfb-4044-af3e-ea80bc1b4ce6`. That
  deploy date is the start of the unknown clock rather than the end of the risk, and it is the only
  deploy this worker will ever get.
- **Groq models.** Surviving the 31-day trip is likely: nothing is currently announced, and past
  retirements came with at least 30 days' notice. Surviving 2027 is not something to plan on. S412 makes
  the eventual death honest.
- **Time-zone badges are correct only for a December–January trip.** They map a UTC offset rather than a
  real zone id, so a summer-dated custom trip shows wrong badges. The app ships custom trips, so this is
  a live, user-visible ceiling: accepted, documented, and not fixed.
- **Hosting (GitHub Pages).** Nothing renews, nothing bills, and no inactivity policy is published.
- **Browser storage eviction.** Mitigated by the shipped persistence request, the install hint and a
  photo-inclusive export; the worst case is a never-installed browser after seven idle days. The
  consequence is worth stating plainly: journal entries and photos are single-device by design, so
  eviction or losing the device means permanent loss unless an export was taken.

Internal durability was audited separately and needs no code fix, but three of its findings were stated
too broadly in an earlier draft, and the corrected versions are the record:

- **Tombstones are capped in one store only.** The trip registry caps its forget-tombstones at 200
  (`core/trips/registry.ts:288`, applied at `:304`). Itinerary and expense tombstones are retained
  forever, since there is no cap in `core/sync/`. They are accepted on *headroom*, roughly 100× and 10×
  the 1 MB Firestore document ceiling, rather than on a cap. Separately, the registry's own sync path
  (`registry.ts:383`) writes the merged union uncapped; that one-line rider is in section 3.
- **The clock-skew clamp is production-dead code.** It is applied only in `hlcReceive`, which has zero
  production callers. The per-row ratchet handles *sequential* edits across drifting clocks. The
  accepted residual is narrower and real: a genuinely concurrent offline edit on a correct-clock device
  can lose to a device whose clock is hours wrong. That is the trusted-device ceiling, ruled and
  accepted.
- **The eastbound-only time model has no visible effect at all**, and is unreachable in every shippable
  configuration. The app flipping to "trip over" about fourteen hours early on Jan 9 is a different
  mechanism: the return leg is not in the pack, so the trip window simply ends while the clock is still
  anchored to JST. Cosmetic, and accepted.

---

## 6 · The final gate

The eight-step automated checklist and the five-part manual device script are specified in full in
the final QA gate notes. Eight amendments are mandatory, and without the first one
the checklist as written produces a false red.

> This count and the list below were changed together on 2026-08-09. They have diverged in this document
> before: the F1 row in section 0.2 and the backlog's S420 row both said "five" while this section said
> "seven". All three are corrected in the same pass.

1. **Step 5 must build wired.** No `.env.local` exists (only the example, and the pattern is
   git-ignored), and `lib/concierge-config.ts:13` is the sole reader, so a plain build bakes in nothing
   and eight concierge specs throw at the fixture guard (`e2e/fixtures.ts:172-186`, which throws rather
   than skips). Build with `NEXT_PUBLIC_CONCIERGE_URL` set.
2. **Re-baseline the counts per slice.** The recorded pass/test/precache numbers predate S409–S421, and
   also S406–S408, S423, S424 and S425, which have all landed since. The recorded baseline of 151 vitest
   files (`S401…:8`, and again at `:106`) is stale by three: enumerated at HEAD `cea4a08` on 2026-08-09
   it is **154 files / 95 e2e specs**. Update the literal, not just the instruction. An operator
   anchored to 151 faces an unexplained +3 attributable to no final-wave slice, and a reconciliation
   waved through cannot catch the deleted test it exists to catch.
3. **Name the money-invariant evidence** in the gate record, not just the counts, and reconcile the
   no-blanket-bump test, which the gate expects but the build instructions never asked for (section 0.4).
4. **Add the frozen S77 suite to the frozen-predicate list** once S415 lands, since S415 deliberately
   amends it.
5. **The skip count is 8 on a WIRED build only.** The earlier justification, that the new guard throws
   rather than skips, was falsified on 2026-08-09 by slice S425, which added a `test.skip()` to
   `e2e/custom-trip-gating.spec.ts` that fires with a machine-readable reason when
   `NEXT_PUBLIC_CONCIERGE_URL` is not baked in. There is now a skipping guard. Since amendment 1 already
   mandates a wired build, 8 still holds for the gate's own run, but record *which* build produced the
   number, and expect **9** on any unwired project. An unexplained 9 must not be waved through, and must
   not be treated as a red either.
6. **Preview honesty on the claim rewrite** (section 0.4). The premise was corrected on 2026-08-09: the
   sentence quoted there, *"Expenses and documents are not changed"*, no longer exists anywhere in the
   tree. S408 replaced it, so the feared failure ("someone deletes it and writes nothing") did not
   materialise, and an operator primed to expect an empty screen will tick a plausible-but-incomplete
   one. The copy that actually landed ends *"…who paid for a shared expense, and how it splits, are
   never touched"*, which is true, but it states the **data invariant** and never the **user-visible
   residue**. The requirement is unchanged and still unmet: the copy has to say that Settle-up balances
   and the paid-by chips keep the old name. This is a copy edit to a shipped component, and section 2
   puts S419 as the last code touch, so either fold it into S412 (which already edits user-facing copy)
   or accept the residue explicitly in the gate record. Do not let "record the exact copy" be satisfied
   by recording copy that omits the residue; that verb is why this criterion cannot fail for the reason
   it exists.
7. **Fixture breadth on the claim rewrite.** The money guard's fixture has to include a tombstone row, a
   `paidBy`-absent row and a legacy row with no `hlc`. The implementation is incidentally safe for all
   three, none of them is *proven*, and "incidentally safe" is not evidence. Sharpened 2026-08-09: the
   task is not "add three rows", it is "notice that two of the three you appear to have are one row, and
   that it is the wrong one". In the landed fixture the tombstone case is genuinely proven, but the only
   `paidBy`-absent row *is* that tombstone, which the rewrite deliberately skips before `paidBy` is ever
   read, so deleting the `paidBy` handling entirely would leave it green. And no row omits `hlc`; every
   seed row carries `SEED_HLC`. So one case of three has discriminating power. This last point is the
   one item here that was never independently double-checked, so re-read the fixture before acting; the
   claim is cheap to check and cheap to be wrong about.
8. **No console errors on load or interaction.** This is a named bullet of the founding acceptance
   contract that the final gate inherited not at all: the string "console" occurs zero times in
   the final QA gate notes, and only 25 of 95 e2e specs attach a
   `page.on('console')`/`pageerror` listener, with no guard in the shared fixture. Do not bolt a global
   listener into `e2e/fixtures.ts` at freeze time; that is a large, late, unproven change that would red
   on third-party noise. Instead, add one line to the manual device script ("open each route, DevTools
   console clean") and record the 25/95 split in the gate record as the accepted automated floor, so the
   gap is a decision and not an oversight. Playwright could not be run for this audit, so there is no
   claim here that any route errors today, only that nothing would tell us.

The two-client sync scenarios stay manual forever, because closing them automatically would bake network
access and credentials into the last gate anyone runs. They are executed once, on two real phones,
before the tag. That run also carries the items no automated lane owns: the cross-device expenses step,
and the naming of the three sync residuals it closes, which are the same-item concurrent-edit HLC
tie-break, a non-itinerary domain, and the sync badge's failure states. Naming them matters: if the gate
record only says "M1 passed", the residuals never actually close.

---

## 7 · Decisions only you can make

Nine. Each is one word, and none of them blocks the slices in section 2 that are already GO.

1. **The four front-door / guest-mode rows.** Bury them? A later locked ruling retired guest mode and
   the machinery was deleted, the rows predate it by three days, and every mechanism they modify is
   gone. *Recommendation: bury.*
2. **My Places sync.** Now or never. Either places sync across devices in the final version, or they
   stay per-device forever. Silent either way, not breaking.
3. **A pre-trip self-diagnostic screen.** "Am I still trip-ready?" on Dec 8. It is the one shelved idea
   the no-maintainer lens favours; against it, the rot audit found nothing that hard-fails, so there is
   less for it to catch than there would have been.
4. **The duration/clash-badge question.** Wiring the existing duration data paints about five false
   clash badges unless a nesting rule is decided first. Wire it with a rule, or leave the badges inert.
   *Inert is not wrong, just unused.*
5. **The mirror PII re-publish.** Confirm it rides the final push rather than happening earlier.
6. **The founding contract still promises a "travel-inspiration hub"**, and what shipped is a two-card
   weather panel, deliberately. Amend it, or restore a hub. *Recommendation: amend, one word.* The
   pointer was corrected on 2026-08-09: the in-repo carrier is the founding contract document's project
   section (its Mission line and its definition-of-done list), not "the build spec", since no build spec
   is tracked in this repository and that document was named by 0 of the 11 scoping documents. Whatever
   you answer, S418 edits it; the external build spec you hold is yours to amend or not.
7. **World-wide map search** stays unbuilt unless you say the word. Free keyless geocoders exist, but
   the main one forbids search-as-you-type, so it is a design decision rather than a switch.
8. **A concierge clash warning.** The one remaining AI idea worth considering. It adds a heuristic
   nobody will ever tune, and a wrong warning becomes permanent.
9. **The one worker deploy.** Superseded on 2026-08-09, because the deploy happened before you answered.
   The worker shipped exactly as built (v1.8.0, `18dc72f`). The question is now the harder one: the
   one-line prompt correction missed its ride, so it costs a **second** worker deploy or it is dropped
   forever. *Recommendation: drop it. A second deploy re-opens a surface this plan just closed, for one
   line of prompt text.* Still settled and needing nothing from you: the `vibe` descriptor field stays
   out, since the worker's own trip normaliser ignores it, so shipping it would cost a deploy for no
   behaviour.

---

## 8 · Actions only you can take

1. **Done 2026-08-09, deploy the worker.** Shipped v1.8.0 via `npm run deploy` from `worker/`, with the
   predeploy gate green (typecheck + 104/104), Version ID `157ed2e0-2cfb-4044-af3e-ea80bc1b4ce6`. The
   S419 flag flip followed it in the correct order, in slice S424. Both rulings that lived only inside
   the worker now reach users. *This was the only worker deploy budgeted; see 7.9.*
2. **Done 2026-08-09, deploy the app.** Live is v5.11.2, carrying v5.10.0, v5.11.0, v5.11.1 and v5.11.2
   in one push. This changes the risk posture of everything below: the final version is no longer
   "nothing reaches a user until you deploy", because the app is live now, so any defect still in the
   tree is live too. That is why the stale NPR rate is floor (F6) rather than deploy-eve hygiene. One
   more app deploy remains, in S421.
3. **Revoke the old Gemini key at Google.** Deleting the Cloudflare secret only made it unreachable.
4. **Enable zero-data-retention in the Groq console.** One click, free, and it closes the last
   human-review exposure.
5. **Re-publish the public mirror.** Your email address is still live in it.
6. **Sign in to the Google account at least once every two years.** This is the single recurring human
   dependency in the entire stack; everything else is free, renews itself, or degrades honestly.
7. **Set the mirror repo's `NEXT_PUBLIC_CONCIERGE_URL` Actions variable** to the deployed workers.dev
   URL. Without it the build bakes in nothing, `isConciergeConfigured()` is false, and the concierge
   renders null for every live user: the worker deploy you just spent is wasted, and the failure is
   silent. It is flagged in `18dc72f`'s own log ("Still owner-only…"), and the deploy log prints
   `concierge-url present: yes/NO`. Verify it before S421's final push, because after that there is no
   second chance. *This was never in the six; it surfaced only when the worker actually shipped.*
   (Superseded, issue #41: `deploy.yml` now fails the build outright when the variable is empty or
   carries a path, so this is enforced rather than checked by eye, and the silent-failure half of the
   warning no longer applies. The success path still prints `concierge-url present: yes`.)

---

## 9 · What ships

**Already built and green:** the nine sections; the live countdown; the itinerary planner with group
sync, an offline outbox and per-day maps; Travel Mode; the revamped map with a precached offline engine
(pins and routes work with no signal); expenses with splitting and currency; journal and photos, private
on-device by design; real time-zone badges; the trips hub; a marketing landing page; and an installable
app that keeps working offline.

**New in the final version:** map search that jumps to any place in your trip · one honest leg label
everywhere, and it now survives sync · your name instead of "Traveler" on old expenses and documents,
with a preview, and without touching a single number · custom trips no longer silently re-legged · an
offline phrasebook · a concierge that says *why* it ignored a suggestion and dies with an honest
sentence rather than a raw error · no hidden network calls behind the wall · a truthful front door · a
rate refreshed at deploy.

**Accepted forever, each a deliberate ruling:** dark mode only · journal and photos never leave the
device, which also means losing the device loses them unless an export was taken · the concierge can
retire with its provider · map artwork needs signal and rides a keyless CDN whose terms we could not
verify · weather and currency degrade to labelled stale values, never errors · the return flight flips
to "trip over" about fourteen hours early · the time-zone badges are right for a December trip and would
be wrong on a summer-dated custom one · no printing, no light theme, no push notifications · the Home
"Travel Essentials" weather panel has no schema and no assertion on its body, so the one e2e that
reaches it would pass against a bare heading stub, and its Japan card is headed "Japan (Tokyo/Kyoto)"
although the Japan leg opens in **Osaka** on Dec 19. That last one is accepted because the sibling Nepal
card is incomplete in exactly the same way ("Kathmandu, Nepal" for a leg that also covers Bhaktapur,
Lalitpur and Nagarkot), the figures are correct for Osaka too, and a strict schema over a frozen two-key
literal of eight strings would catch nothing that `tsc` and the two rendered cards do not.
**Zero paid dependencies. Zero renewals. One human act every two years.**

**Not yet decided, so not in the list above:** whether map search should reach places *outside* your
trip. That is 7.7, and it is still yours to answer. The app ships trip-scoped search either way, but
calling it "accepted forever" would be pre-empting you.
