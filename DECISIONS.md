# DECISIONS — decision log (ADR-lite)

_Each entry records one decision, why we made it, and what would force us to revisit it. Entries marked **LOCKED** are settled: treat them as constraints and don't re-open them casually, because something downstream almost certainly depends on them._

_Older entries (D-001 to D-234) live in [DECISIONS-older.md](DECISIONS-older.md), unchanged._
_Each has a one-line stub here at its original spot, so a grep for the D-number lands in both files._

**Format:** `ID · status · decision · rationale · what would force a change`

---

### D-001 · LOCKED · moved to DECISIONS-older.md

### D-002 · moved to DECISIONS-older.md

### D-003 · Superseded by D-079 · moved to DECISIONS-older.md

### D-004 · moved to DECISIONS-older.md

### D-005 · LOCKED · moved to DECISIONS-older.md

### D-006 · LOCKED · moved to DECISIONS-older.md

### D-007 · LOCKED · moved to DECISIONS-older.md

### D-008 · Superseded · moved to DECISIONS-older.md

### D-009 · LOCKED · moved to DECISIONS-older.md

### D-010 · LOCKED · moved to DECISIONS-older.md

### D-011 · LOCKED · moved to DECISIONS-older.md

### D-012 · LOCKED · moved to DECISIONS-older.md

### D-013 · Superseded by D-070 · moved to DECISIONS-older.md

### D-014 · LOCKED · moved to DECISIONS-older.md

### D-015 · LOCKED · moved to DECISIONS-older.md

### D-016 · Superseded by D-306, revived in part by D-313 · Countdown decomposition vs. total-days
**Superseded by D-306 (issue #11, 2026-08-11, owner-ruled), revived in part by D-313 (issue #60, 2026-08-13, owner-ruled).** D-306 reversed both halves below: a month became fixed-length instead of calendar-accurate, and the fields reconciled with `totalDays` by construction. D-313 reverses the first half back — months are calendar-accurate again — but NOT the second: `totalDays` and the breakdown still do not reconcile, exactly as this entry originally said, and this entry's non-reconciliation text is correct again, not merely "the reasoning D-306 had to answer." What stayed binding through both reversals: `computeCountdown` stays pure with no internal clock, and the D-006 target is untouched. D-313 is not a byte-for-byte return to this entry's original implementation — it carries a correction (the `differenceInMonths`/`addMonths` overshoot guard) that this entry's own original code never had and never needed to defend against, because that defect was found only while reviving it.

The hero countdown's display fields (`months`/`weeks`/`days`/`hours`/`minutes`/`seconds`) are a calendar-accurate decomposition of the time-to-target, computed in the pure `lib/countdown.ts` `computeCountdown(target, now)` via `date-fns`. `totalDays` is a separate flat whole-day count (`differenceInDays(target, now)`) shown as the "total days" headline. By design these do not arithmetically reconcile (`totalDays ≠ months*30 + weeks*7 + days`), because `weeks` is a sub-month residue. Do not "fix" the apparent mismatch.
**Why:** calendar months vary in length, and a flat `floor(days/30)` (the old approach) was inaccurate. `computeCountdown` is pure, with no internal clock, so it is deterministically testable.
**Changes if:** the design wants a single reconciled unit scheme, or a fixed display timezone (currently local-time per D-006).

### D-017 · Superseded · moved to DECISIONS-older.md

### D-018 · LOCKED (implementation note) · moved to DECISIONS-older.md

### D-019 · LOCKED · moved to DECISIONS-older.md

### D-020 · LOCKED (implementation note) · moved to DECISIONS-older.md

### D-021 · LOCKED (implementation note) · moved to DECISIONS-older.md

### D-022 · LOCKED (implementation note) · moved to DECISIONS-older.md

### D-023 · LOCKED (implementation note) · moved to DECISIONS-older.md

### D-024 · LOCKED (implementation note) · moved to DECISIONS-older.md

### D-025 · LOCKED · moved to DECISIONS-older.md

### D-026 · LOCKED · moved to DECISIONS-older.md

### D-027 · LOCKED · moved to DECISIONS-older.md

### D-028 · LOCKED · moved to DECISIONS-older.md

### D-029 · LOCKED (implementation note) · moved to DECISIONS-older.md

### D-030 · LOCKED (implementation note) · moved to DECISIONS-older.md

### D-031 · LOCKED (implementation note) · moved to DECISIONS-older.md

### D-032 · Superseded by D-119 · moved to DECISIONS-older.md

### D-033 · LOCKED (process note) · moved to DECISIONS-older.md

### D-034 · LOCKED · moved to DECISIONS-older.md

### D-035 · LOCKED · moved to DECISIONS-older.md

### D-036 · Superseded · moved to DECISIONS-older.md

### D-037 · Superseded · moved to DECISIONS-older.md

## M9 — Cross-friend itinerary sync (Firebase Firestore). Greenlit 2026-06-27.

> M9 reopens D-002/D-004 scoped to the itinerary only (see the annotations on those entries) and builds the cross-device sync that M8 researched look-only (`docs/cross-friend-sync-research.md`). The overriding mandate is dormant-safe (D-038): with no Firebase configured, the app builds and runs exactly as it does today (localStorage-only, D-018/D-026 intact). The research did the option analysis and chose Cloud Firestore (Spark free tier) plus silent Anonymous Auth, called directly from the static client. D-038–D-046 turn that into a buildable blueprint.

### D-038 · LOCKED · moved to DECISIONS-older.md

### D-039 · LOCKED · moved to DECISIONS-older.md

### D-040 · LOCKED · moved to DECISIONS-older.md

### D-041 · LOCKED · moved to DECISIONS-older.md

### D-042 · LOCKED · moved to DECISIONS-older.md

### D-043 · LOCKED · moved to DECISIONS-older.md

### D-044 · LOCKED · moved to DECISIONS-older.md

### D-045 · LOCKED · moved to DECISIONS-older.md

### D-046 · Superseded · moved to DECISIONS-older.md

### D-047 · LOCKED (implementation note) · moved to DECISIONS-older.md

### D-048 · Superseded by D-049 · moved to DECISIONS-older.md

### D-049 · LOCKED · moved to DECISIONS-older.md

### D-050 · Superseded · moved to DECISIONS-older.md

### D-051 · Superseded · moved to DECISIONS-older.md

### D-052 · Superseded · moved to DECISIONS-older.md

## M10 — UI/UX redesign + Trip Token gate. Greenlit 2026-06-29.

> M10 adds a Trip Token front door (a token identifies the traveler so edits are attributed to Powna/Sushil/Uttam) and a UI/UX glow-up (LazyMotion-based motion system, scroll-driven accents, ⌘K palette, identity-aware features including presence). The headline architectural insight: an identity system already exists (`lib/identity.ts` + `lib/attribution.ts` + `components/name-prompt.tsx`), so the token gate is a swap-in on top of it. It reuses rather than rebuilds: attribution, the calendar, the timeline, and the sync layer need zero changes to start attributing edits. D-053–D-057 lock the seams (token→identity contract, the always-on landing's reconciliation with D-038, the guest = local-only subscribe-gate, the reduced-motion contract for the new motion types, and the presence data model + free-tier budget) before any M10 code is written. Hard rule carried in: Firebase stays free Spark, never Blaze.

### D-053 · LOCKED · moved to DECISIONS-older.md

### D-054 · moved to DECISIONS-older.md

### D-055 · moved to DECISIONS-older.md

### D-056 · LOCKED (extends D-007) · moved to DECISIONS-older.md

### D-057 · LOCKED · moved to DECISIONS-older.md

### D-057 · moved to DECISIONS-older.md

### D-058 · LOCKED · moved to DECISIONS-older.md

### D-053 · moved to DECISIONS-older.md

### D-054 · moved to DECISIONS-older.md

### D-059 · LOCKED · moved to DECISIONS-older.md

### D-060 · LOCKED · moved to DECISIONS-older.md

### D-061 · Superseded · moved to DECISIONS-older.md

### D-062 · LOCKED · moved to DECISIONS-older.md

### Governance note (2026-06-30) · Archived · Code review skipped for the S47–S54 build wave

### D-063 · Superseded · moved to DECISIONS-older.md

### D-064 · Superseded · moved to DECISIONS-older.md

### D-065 · Superseded · moved to DECISIONS-older.md

### D-066 · LOCKED · moved to DECISIONS-older.md

### D-067 · Superseded · moved to DECISIONS-older.md

### D-068 · LOCKED · moved to DECISIONS-older.md

### D-069 · LOCKED · moved to DECISIONS-older.md

### Note (S56) · Archived · Bug 3 "no Dec 9 plan" was stale localStorage, not a code defect (D-018 upheld)

---

## M14 — v2 multi-page rebuild ("laptop to plan, phone during the trip"). Approved 2026-07-02.

> v2 splits the single page into 5 routes with a mobile bottom tab bar, a full visual redesign, PWA/offline, a Today travel mode, a custom add flow, and map/guide upgrades, built in parallel worktree lanes. D-013 (single-page) is superseded by D-070, and approval of the v2 plan is the sign-off. Everything else carries forward unchanged: D-010 (static export, GitHub Pages), D-018 (key-presence persistence), D-026 (shared reactive store), D-038/D-047 (dormant-safe Firebase), D-062 (authored RGB literals), D-069 (portal overlays). Hard rules carried in: Firebase stays free Spark; free-only APIs, no paid map/places.

### D-070 · LOCKED · moved to DECISIONS-older.md

### D-071 · LOCKED · moved to DECISIONS-older.md

### D-072 · LOCKED · moved to DECISIONS-older.md

### D-073 · LOCKED · moved to DECISIONS-older.md

### D-074 · LOCKED · moved to DECISIONS-older.md

### D-075 · LOCKED · moved to DECISIONS-older.md

### D-076 · LOCKED · moved to DECISIONS-older.md

### D-077 · Superseded · moved to DECISIONS-older.md

### D-078 · LOCKED · moved to DECISIONS-older.md

### D-079 · LOCKED · moved to DECISIONS-older.md

### D-080 · Superseded · moved to DECISIONS-older.md

### D-081 · Superseded · moved to DECISIONS-older.md

### D-082 · Superseded · moved to DECISIONS-older.md

### D-083 · Superseded · moved to DECISIONS-older.md

### D-084 · Superseded · moved to DECISIONS-older.md

### D-085 · LOCKED (implementation note) · moved to DECISIONS-older.md

### D-086 · LOCKED (extends D-073) · moved to DECISIONS-older.md

### D-087 · Superseded · moved to DECISIONS-older.md

### D-088 · LOCKED · moved to DECISIONS-older.md

### D-089 · Superseded by D-129 · moved to DECISIONS-older.md

### D-090 · Superseded · moved to DECISIONS-older.md

### D-091 · Superseded · moved to DECISIONS-older.md

### D-092 · Superseded · moved to DECISIONS-older.md

### D-093 · Superseded · moved to DECISIONS-older.md

### D-094 · Superseded · moved to DECISIONS-older.md

### D-095 · LOCKED (blueprint note) · moved to DECISIONS-older.md

### D-096 · LOCKED (blueprint note) · moved to DECISIONS-older.md

### D-097 · LOCKED (blueprint note) · moved to DECISIONS-older.md

### D-098 · LOCKED (blueprint note) · moved to DECISIONS-older.md

### D-099 · LOCKED (blueprint note) · moved to DECISIONS-older.md

### D-100 · LOCKED (implementation note) · moved to DECISIONS-older.md

### D-101 · Superseded · moved to DECISIONS-older.md

### D-102 · LOCKED · moved to DECISIONS-older.md

### D-103 · moved to DECISIONS-older.md

### D-104 · moved to DECISIONS-older.md

### D-105 · moved to DECISIONS-older.md

### D-106 · moved to DECISIONS-older.md

### D-107 · moved to DECISIONS-older.md

### D-108 · moved to DECISIONS-older.md

### D-109 · moved to DECISIONS-older.md

### D-110 · moved to DECISIONS-older.md

### D-111 · moved to DECISIONS-older.md

### D-112 · Superseded · moved to DECISIONS-older.md

### D-113 · moved to DECISIONS-older.md

### D-114 · Superseded · moved to DECISIONS-older.md

### D-115 · Superseded · moved to DECISIONS-older.md

### D-116 · moved to DECISIONS-older.md

### D-117 · Superseded · moved to DECISIONS-older.md

### D-118 · Superseded · moved to DECISIONS-older.md

### D-119 · moved to DECISIONS-older.md

### D-120 · LOCKED (S110-FIX, 2026-07-06) · moved to DECISIONS-older.md

### D-121 · LOCKED (S110-FIX, 2026-07-06) · moved to DECISIONS-older.md

### D-122 · moved to DECISIONS-older.md

### D-123 · moved to DECISIONS-older.md

### D-124 · LOCKED (S112, 2026-07-07) · moved to DECISIONS-older.md

### D-125 · LOCKED (S113, 2026-07-07) · moved to DECISIONS-older.md

### D-126 · LOCKED (S113C, 2026-07-10) · moved to DECISIONS-older.md

### D-127 · Retired · moved to DECISIONS-older.md

### D-128 · Retired · moved to DECISIONS-older.md

### D-129 · LOCKED (2026-07-10) · moved to DECISIONS-older.md

### D-130 · moved to DECISIONS-older.md

### D-131 · moved to DECISIONS-older.md

### D-132 · moved to DECISIONS-older.md

### D-133 · moved to DECISIONS-older.md

### D-134 · moved to DECISIONS-older.md

### D-135 · moved to DECISIONS-older.md

### D-136 · moved to DECISIONS-older.md

### D-137 · moved to DECISIONS-older.md

### D-138 · moved to DECISIONS-older.md

### D-139 · moved to DECISIONS-older.md

### D-140 · moved to DECISIONS-older.md

### D-141 · moved to DECISIONS-older.md

### D-142 · moved to DECISIONS-older.md

### D-143 · moved to DECISIONS-older.md

### D-144 · Superseded · moved to DECISIONS-older.md

### D-145 · Superseded · moved to DECISIONS-older.md

### D-146 · Superseded · moved to DECISIONS-older.md

### D-147 · moved to DECISIONS-older.md

### D-148 · moved to DECISIONS-older.md

### D-149 · moved to DECISIONS-older.md

### D-150 · moved to DECISIONS-older.md

### D-151 · moved to DECISIONS-older.md

### D-152 · moved to DECISIONS-older.md

### D-153 · moved to DECISIONS-older.md

### D-154 · moved to DECISIONS-older.md

### D-155 · Superseded · moved to DECISIONS-older.md

### D-156 · (S145, recorded 2026-07-12) · moved to DECISIONS-older.md

### D-157 · moved to DECISIONS-older.md

### D-158 · Amended by D-320 · moved to DECISIONS-older.md

### D-159 · moved to DECISIONS-older.md

### D-160 · moved to DECISIONS-older.md

### D-161 · moved to DECISIONS-older.md

### D-162 · Superseded · moved to DECISIONS-older.md

### D-163 · Superseded · moved to DECISIONS-older.md

### D-164 · moved to DECISIONS-older.md

### D-165 · moved to DECISIONS-older.md

### D-166 · moved to DECISIONS-older.md

### D-167 · moved to DECISIONS-older.md

### D-168 · Superseded by D-205 · moved to DECISIONS-older.md

### D-169 · moved to DECISIONS-older.md

### D-170 · moved to DECISIONS-older.md

### D-171 · moved to DECISIONS-older.md

### D-172 · moved to DECISIONS-older.md

### D-173 · CLOSED NO-GO by D-197 · moved to DECISIONS-older.md

### D-174 · moved to DECISIONS-older.md

### D-175 · moved to DECISIONS-older.md

### D-176 · (S174, recorded 2026-07-16) · moved to DECISIONS-older.md

### D-177 · (S177, recorded 2026-07-16) · moved to DECISIONS-older.md

### D-178 · (S178, recorded 2026-07-16) · moved to DECISIONS-older.md

### D-179 · (S180, recorded 2026-07-16) · moved to DECISIONS-older.md

### D-180 · (S198, proposed) · moved to DECISIONS-older.md

### D-181 · (S198, proposed) · moved to DECISIONS-older.md

### D-182 · (S184, 2026-07-16) · moved to DECISIONS-older.md

### D-183 · (S200, 2026-07-16) · moved to DECISIONS-older.md

### D-184 · (S185, 2026-07-16) · moved to DECISIONS-older.md

### D-185 · (S185, 2026-07-16) · moved to DECISIONS-older.md

### D-186 · (S186, 2026-07-16) · moved to DECISIONS-older.md

### D-187 · (S186, 2026-07-16) · moved to DECISIONS-older.md

### D-188 · (S187, 2026-07-16) · moved to DECISIONS-older.md

### D-189 · (S188, 2026-07-16) · moved to DECISIONS-older.md

### D-190 · (S188, 2026-07-16) · moved to DECISIONS-older.md

### D-191 · (S188, 2026-07-16) · moved to DECISIONS-older.md

### D-192 · (S189, 2026-07-16) · moved to DECISIONS-older.md

### D-194 · (S190, 2026-07-17) · moved to DECISIONS-older.md

### D-193 · (S229, Session B, 2026-07-16) · moved to DECISIONS-older.md

### D-196 · (S221, Session B, 2026-07-17) · moved to DECISIONS-older.md

### D-197 · (S209, Session B, 2026-07-17) · moved to DECISIONS-older.md

### D-198 · (S207, Session B, 2026-07-17) · moved to DECISIONS-older.md

### D-199 · (S228, Session B, 2026-07-17) · moved to DECISIONS-older.md

### D-195 · (S191, 2026-07-17) · moved to DECISIONS-older.md

### D-200 · (S226, Session B, 2026-07-17) · moved to DECISIONS-older.md

### D-201 · (S206, Session B, 2026-07-17) · moved to DECISIONS-older.md

### D-202 · (S192, 2026-07-17) · moved to DECISIONS-older.md

### D-203 · (S192 follow-up, 2026-07-18) · moved to DECISIONS-older.md

### D-204 · (S224, 2026-07-18) · moved to DECISIONS-older.md

### D-205 · SIGN-OFF (2026-07-18) · moved to DECISIONS-older.md

### D-206 · (S215, 2026-07-18) · moved to DECISIONS-older.md

### D-207 · (S218, 2026-07-18) · moved to DECISIONS-older.md

### D-208 · (S220, 2026-07-18) · moved to DECISIONS-older.md

### D-209 · (2026-07-18) · moved to DECISIONS-older.md

### D-211 · (S222, survey, 2026-07-18) · moved to DECISIONS-older.md

### D-210 · (S232, 2026-07-18) · moved to DECISIONS-older.md

### D-212 · (S233, 2026-07-18) · moved to DECISIONS-older.md

### D-213 · (S217, 2026-07-18) · moved to DECISIONS-older.md

### D-215 · (S219, 2026-07-18) · moved to DECISIONS-older.md

### D-214 · (S234, 2026-07-18) · moved to DECISIONS-older.md

### D-218 · (S235, 2026-07-19) · moved to DECISIONS-older.md

### D-216 · (S203/S204/S205, 2026-07-19) · moved to DECISIONS-older.md

### D-217 · (S211/S212, 2026-07-19) · moved to DECISIONS-older.md

### D-219 · (v5 cutover, 2026-07-19) · moved to DECISIONS-older.md

### D-221 · (S236, 2026-07-19) · moved to DECISIONS-older.md

### D-223 · (S266, 2026-07-23) · moved to DECISIONS-older.md

### D-222 · (S269, 2026-07-23) · moved to DECISIONS-older.md

### D-224 · (S274, 2026-07-24) · moved to DECISIONS-older.md

### D-225 · (S275, 2026-07-24) · moved to DECISIONS-older.md

### D-282 · (S389, 2026-08-06) · An inverse must address the identity the store returns, and a call-recorder fake may not be its sole guard

**Decision:** `ItineraryStore.moveItem` returns the id the item actually landed on (`string | undefined`). Anything constructing an inverse — undo, redo, a reorder that re-lists ids — must address that returned id, never the id it passed in. Under sync (D-248) the target is a `freshCopyOf` mint, so the original id no longer resolves. The test half is part of the rule, not a suggestion: an operation whose store mints, tombstones or re-keys may not be guarded solely by a call-recorder fake, because such a fake asserts routing and can never observe behaviour. Its guard must assert resulting state, on the branch where the defect exists.

**Why:** `applyOp`'s `moveItem` inverse dispatched by the original id, so under sync the undo toast appeared and did nothing — live in production since before v5.7.0. An in-code comment described the defect correctly and sat three lines above the broken line, and it still shipped, because `concierge-ops.test.ts`'s guarding test asserted `store.calls[1]` against a `fakeStore()` that holds no state: it would pass identically on broken and fixed code. The dormant-mode test passed on the old code too, because the branch the old test modelled was the branch that worked.

**Changes if:** the sync model stops re-keying on move (then the returned id is always the input, and the rule is inert but harmless).

### D-283 · (S390, 2026-08-06) · A rename records the previous name; identity matching is by current-or-prior name, and stored stamps are never rewritten

**Decision:** renaming the local traveller appends the old name to a prior-names list (`STORAGE_KEYS.priorNames`), and author matching (`itemMatchesAuthor` / `filterItemsByAuthor` / `distinctAuthors`) resolves *"my edits"* against current or prior names, collapsing priors into the current name for display. Stored `createdBy`/`updatedBy`/`doneBy` stamps are not rewritten. `itemMatchesAuthor` additionally honours `doneBy`, so a traveller who ticked items but authored none is no longer filtered to empty (this closes the D-230 gap).

**Why:** stamps are per-device, sync-replicated data. Rewriting them is a mass mutation across every synced device and is the owner's call, not ours. **Explicit non-decision:** no heuristic may infer that a stored name "is" the current user. `DEFAULT_TRAVELER_NAME` was rejected as exactly that heuristic wearing a constant's clothes, since every signup-door user was `Traveler` first, so seeding from it would fold a fellow traveller's items into the owner's identity on a shared trip.

**Ceiling, stated:** this prevents future splits. It cannot repair a rename that already happened, because no record of the old name exists. The owner's existing `Traveler` → `Powan` split persists until the open-questions doc Q3 is answered (REWRITE or LEAVE).

**Changes if:** the ruling is REWRITE, which adds a one-time migration and supersedes the non-rewrite half.

### D-226 · (S271, 2026-07-24) · moved to DECISIONS-older.md

### D-227 · (S273, 2026-07-24, proposed) · moved to DECISIONS-older.md

### D-228 · (S278, 2026-07-24, proposed) · moved to DECISIONS-older.md

### D-229 · (S284/S285, 2026-07-24) · moved to DECISIONS-older.md

### D-230 · (S316, 2026-07-25, proposed) · moved to DECISIONS-older.md

### D-231 · (S320, 2026-07-25, proposed) · moved to DECISIONS-older.md

### D-232 · (S330, 2026-07-25) · moved to DECISIONS-older.md

### D-233 · (S326, 2026-07-25, proposed) · moved to DECISIONS-older.md

### D-234 · moved to DECISIONS-older.md

### D-235 · (S323 / Lane A "A5 token pass", proposed 2026-07-26 in the planning notes; **LOCKED 2026-07-26 via the A5 checkpoint**) · One gold chrome accent + country tints demoted to content-wayfinding; 17px body with a full overflow re-check; amends/retires D-058, D-072, D-178. **Section 1's hue is superseded by D-269: the chrome accent is cyan (S353), not gold. The one-accent rule and sections 2–3 stand.**
**Context.** The 2026-07-25 "iOS-like simplicity" directive drives A5, the token-layer visual pass and the last Lane-A slice. The plan's "one accent" target collided with three LOCKED accent decisions: D-058 (sakura interactive-fill), D-072 (route-driven accent) and D-178/FU-40 (palette). Shown the blueprint at the A5 checkpoint, we chose the middle path and the full 17px change. This entry records that sign-off so S323 executes without re-litigating the locked entries it changes.
**Decision — LOCKED (sign-off 2026-07-26):**
**1) One gold *chrome* accent.** All interactive chrome (buttons, focus rings, links, active states, the command-palette/cmdk composite) uses a single gold accent, everywhere, route-independent. This retires the accent-behavior clauses of **D-058** (sakura as interactive-fill), **D-072** (accent switches by route: himalaya on Nepal, sakura on Japan) and **D-178/FU-40** (the two-accent palette composite). Those three entries are amended: their accent *rules* no longer govern chrome. **[Superseded in part — S353, 2026-07-30. Authority: locked wave scope call #3, "Full visual overhaul, chosen over the researched 'evolve, your tokens are already good' recommendation." The word *gold* in this clause is dead: the single chrome accent is now cyan `189 90% 60%` (`--primary`/`--accent`/`--ring`/`--accent-scroll`), and gold is a warning colour only (`globals.css:98`). Everything else in this clause is unchanged and still binding: one accent, all interactive chrome, everywhere, route-independent, and the retirement of D-058/D-072/D-178's accent rules. See D-269. Don't "restore" gold chrome on the strength of this entry's LOCKED status.]**
**2) Country tints survive as content wayfinding only.** himalaya (Nepal) and sakura (Japan) are kept, but demoted from interactive chrome to content and wayfinding color: page-section tints, guide-card identity, map-leg coloring. The two-country visual identity is preserved; only the *interactive* accent unifies to gold. **[Hue dead, see D-269. The "unifies to one accent" half of this sentence is live and binding; the word *gold* in it is superseded by cyan `189 90% 60%`. Section 2's country-tint rule itself is unaffected and remains load-bearing.]** (This is why D-058/D-072/D-178 are amended rather than deleted: the tints they defined live on in a content-only role.)
**3) Body 17px + mandatory overflow re-check.** The base body rises to 17px for iOS-native density. Because the whole rem scale derives from the base, this shifts spacing and sizing app-wide and risks **D-022** layout overflow at mobile breakpoints. S323 has to re-run the full D-022 overflow matrix at every breakpoint and declare every moved baseline. This is the biggest baseline mover of the wave.
**Mechanical scope carried into S323 (not sign-off-gated; blueprint direction, minimalist deletions):** 6 glass tiers → 1 (de-glass content surfaces at the token layer; the 5 content-only tiers gut with roughly zero component edits, since the nav layer hand-rolls its own `backdrop-blur`, and `.glass-card-dark` is the one shared tier, which splits into the FU-41 Sheet primitive); 3 fonts → 1 (a tailwind alias, dropping 2 downloads, with `tabular-nums` for numerals); 6 shadow tiers → 2 (glow kept as a separate effect); ~13–15 type sizes → ~6; and a new `--hairline` separator token. **FU-41:** hand-roll one dark `Sheet` primitive (props `open/onClose/onExitComplete/labelledBy/side`, keeping the LOCKED **D-021** focus contract) and refit all three hand-rolled sheets (place-detail, import-place, FilterSheet). **[Corrected at S323 execution 2026-07-26:** the blueprint's premise that `components/ui/sheet.tsx` (radix) is *dead* was factually wrong. `components/concierge-chat.tsx` actively imports it (`Sheet/SheetTrigger/SheetContent/…`, radix `onOpenChange` API), so it was not deleted, because deleting it breaks the build. The new hand-rolled primitive lives at `components/ui/sheet-dark.tsx`, and radix `ui/sheet.tsx` is preserved for its one live consumer. Fully retiring radix means migrating concierge-chat to the dark primitive, which is **FU-43, a separate slice** (different surface, different API). Recorded so the "delete the dead radix" clause is not treated as unmet.]**
**Constraints (S323 stays in-bounds):** install nothing (Konsta is a markup reference only); token-layer and shared-primitive only, so it must not re-open S317's /travel layout or any A1–A4 IA; de-glassed content surfaces must stay at or above AA contrast, and prove it; re-run the sheet-open axe; respect reduced-motion. Declare the full re-baseline set in the report, since the standing re-baseline watch points hardest here.
**Why.** Unifying interactive chrome to one accent is the iOS-simplicity win, while keeping himalaya and sakura as content color keeps the Nepal-versus-Japan identity that makes the app *this* trip's app. 17px is the density we asked for, accepted with its overflow cost gated by the D-022 re-run. The de-glass is an Apple-HIG correction (glass belongs on nav and overlay, not content) done cheaply at the token layer.
**Changes if:** the de-glassed content surfaces can't hold AA (then keep a faint tint and re-check); 17px forces unfixable overflow on a real surface (then fall back to 16px and re-run the matrix); or country accent chrome is wanted back later (that reverts D-072's route-switch, but the choice was a unified gold **[hue dead, see D-269; read "unified accent", not "gold"]**).
**AA text-floor (S323 finding, deliberate, do not revert):** de-glassing content surfaces removed the gradient background-*image* that had been making axe return "incomplete" and silently skip contrast on roughly app-wide text. Solid surfaces are evaluable, which exposed that low-alpha white text (`text-white/25..60`) composites to grey and cannot reach 4.5:1 on any dark navy fill. No surface darkening fixes it, so the text was floored to `rgb(255 255 255 / 0.62)` in `globals.css @layer utilities` (hover:text-white still wins by specificity, TM legibility `!important` still overrides, and border and variant tokens are untouched). Net effect: tertiary and secondary text is uniformly brighter, which is more iOS-like. This is the "can't hold AA" clause landing text-side rather than tint-side. These must not be lowered back, because the app was silently failing AA before S323.

**Clause status at 2026-08-01** _(verified in `nextjs_space/app/globals.css`, so a reader gets the whole verdict without leaving this entry):_ **Section 1's one-accent rule is live** (`globals.css:29-32`, S353 kept it deliberately). **Section 1's hue "gold" is dead, now cyan** (`:23/:33/:44/:98/:123`, see **D-269**). **Section 1's retirement of D-058/D-072/D-178 is live and now stronger** (`route-accent-engine.tsx` was deleted entirely at S354, `globals.css:179-182`). **Section 2's country tints as content wayfinding are live and load-bearing** (`:99-100` cite this entry by name; `.glass-nepal`/`.glass-japan` at `:300-312`). **But section 2's own trailing clause, "only the interactive accent unifies to gold", carries the dead hue: read it as "unifies to one accent." See D-269.** **Section 3's body 17px is live** (`:250-256`, `font-size: 106.25%`). **Mechanical scope: 6 glass → 1 is live** (`:279-281`); **6 shadow → 2 is live but re-valued** (`:147-151`, the resting tier is now a hairline ring); **3 fonts → 1 is amended by D-245** (`tailwind.config.ts:47` now reads `var(--font-display)`). **The AA text-floor paragraph above is live; see the correction on D-246, which asserts it was deleted.**

---

## D-236 · Superseded by D-241 · Guest = full-roam sandbox on the showcase content

## D-237 · Superseded by D-239 · Front door v2 = three-path wall + post-login routing

## D-238 · Guest conversion = "Keep this trip" prefix-scan adoption; capability secrets and trip-mutating actions require an identified traveler
_(S337, proposed 2026-07-27)_
**Decision:** (1) **Conversion (S340):** a persistent quiet CTA while `isGuest` opens one dialog (nickname required, trip name defaulted), then synchronously runs `id = crypto.randomUUID()` → `adoptSandbox(id)` → `signIn(nickname)` → `clearGuest()` → `joinTrip(id, tripName)` → full reload to `/`. `adoptSandbox` is a new gateway helper (D-097, raw storage stays in `gateway.ts`) that prefix-enumerates every localStorage key beginning `trip:guest-sandbox:`, copies each to `trip:{id}:{suffix}`, then deletes the sandbox keys. The key list is the scan, not a hardcoded enumeration; today that is at most the 14 `TripScopedSlot`s, of which only edited slots exist on disk, and a future slot can never be forgotten. Photo blobs (IndexedDB, id-keyed, app-scoped) need no copy, because the copied metadata resolves them. It is lossless: the sandbox becomes a normal capability-token trip (its id is its Trip Key) and the default pack is untouched. A companion `wipeSandbox()` clears the namespace on fresh guest opt-in. (2) **Secret confinement (S339), a new invariant full-roam makes necessary:** the Trip Key display (`getTripId()` in Settings' Trip group), the `?trip=` copy-link builders (Settings and trips-hub), the Sync Code group, and every trip-mutating registry action (create, join, switch, rename, forget) require an identified traveler. A guest sees a sign-in or "Keep this trip" affordance instead, gated via the existing `useActiveTraveler()`. Without this, full-roam would hand every anonymous visitor the default pack's live-trip write capability. Full-roam means routes and showcase content, not full features: sync, push, presence, concierge (Worker quota) and travel mode (D-164) stay identity-gated.
**Why:** the prefix scan is the only conversion spec that stays complete as slots are added, and the secret gate preserves D-205's entire security model (unguessable, unenumerable tokens) under the widened guest surface.
**Changes if:** conversion ever needs to merge into an existing trip (a new decision, since adoption currently only mints), or guests should be able to share the demo itself (a demo-specific, non-secret link, and a separate design).

---

## D-234 · moved to DECISIONS-older.md

## D-239 · Two-token account model: User Token (account) ≠ Trip Token (per-trip); supersedes D-237's door shape, amends D-238 section 1, D-205 naming amended
_(S337B, proposed 2026-07-28; the 2026-07-27/28 two-token directive is the sign-off)_
**Decision:** two capabilities, never mixed (blueprint the planning notes). **User Token** is the promoted Sync Code: the same on-disk key `tripPlannerSyncCode` (key 28, zero migration, so every device that already minted a Sync Code is automatically an account), the same `crypto.randomUUID()` mint, the same remote doc `trips/{userToken}/profile/tripList` (mergeTripLists LWW union plus tombstones, zero Firestore-rules change). Only the UI and docs name changes. It grants the account (the cross-device trip list), is minted at account creation, and is never shareable: copy exists only for "your other device", and the copy warns never to share it. **Trip Token** is the trip id, unchanged (the old "Trip Key"). It grants one trip, is minted at trip creation, and sharing a trip is sharing its Trip Token. **State model:** authenticated means a traveler is present (nickname slots, with every D-055/D-057/D-120 identity gate untouched); account-complete means a traveler and `getSyncCode()!==null`; nothing but the upgrade affordance gates on completeness, for grandfathering compat. **Front door v3** (`token-gate.tsx`, wall always-on per D-054, firebase-free in all builds, with no push or lookup at the door; `subscribeTripList`'s absent-first-snapshot seed and present-snapshot merge do the remote work after reload): (a) **"Log in"** is "Enter your token" (the user token) plus nickname → `setSyncCode` → `signIn` → full reload (D-172, and this sequencing retires the mount-once-subscribe hazard) landing on `/trips/`; the form may offer the device's stored key-28 token (D-053 soft security), which prevents orphan accounts after an unsaved-token sign-out. (b) **"Create an account"** is nickname → mint → `setSyncCode` plus `signIn` → a show-once screen (prominent token, copy, "save this, only way back in", explicit confirm) → reload landing on `/trips/`; the door no longer creates trips, since account creation and trip creation are separate acts. (c) **"Explore the demo"** is unchanged (D-236). D-237's nickname-only door path is deleted. **/trips (login-gated per D-238 section 2, which the login rule strengthens):** select a trip, create one (minting its Trip Token; per-trip share is the token plus a `?trip=` link), or add by Trip Token (the old join). The `?trip=` handshake is unchanged when identified; unidentified or guest holds the pending token, completes door path (a) or (b), then calls `joinTrip(pending)` before the reload, landing on `/`, since the join is the selection. **Conversion (D-238 section 1 amended):** "Keep this trip" now means create an account and adopt: mint userToken → `setSyncCode` → `adoptSandbox(newId)` → `signIn` → `clearGuest` → `joinTrip` → show-once → reload `/`; adoptSandbox, wipeSandbox and the prefix-scan are unchanged. **Sign-out:** `signOut()` is unchanged and clears the identity pair only; key 28, the registry and trip data stay on disk (D-053-consistent and lockout-safe), and a returning signed-out user sees the wall. **Grandfathered friends (D-209 item 3):** no lockout, since sessions keep working (authenticated means a traveler). A one-time "Finish your account" affordance (`traveler && !getSyncCode()`, on /trips and Settings) mints their User Token plus show-once; minting touches only key 28, so identity slots, knownTrips, the pointer and all trip-scoped bytes are untouched by construction. **The never-mix guard is labels and flow, not validation (accepted residual risk):** both tokens are UUIDs and the door has to stay firebase-free, since dormant builds can't look up anyway. A Trip Token pasted at login yields a working-but-empty account, recoverable losslessly (sign out, log in right; local data isn't keyed by user token). A synced-build stray seed of `trips/{tripId}/profile/tripList` is accepted: reserved subcollection, self-inflicted, recoverable. Carried over intact from D-237: wall always-on (D-054), guest-route mode deleted, the D-021 a11y contract, and `joinTrip`/`upsertKnownTrip` refusing `GUEST_SANDBOX_ID`.
**Why:** the Sync Code already is the account credential in all but name, being a high-entropy capability owning the cross-device trip list, so promoting it is a rename plus a door rather than a new subsystem. Keeping key 28 makes every existing synced device an account for free, and the seed and merge already living in `subscribeTripList` let the door stay firebase-free in every build.
**Changes if:** token-format discrimination is wanted (prefix future mints `user-`/`trip-` and grandfather bare UUIDs); real users hit the paste-confusion residual; account-level identity ever syncs (nickname-per-account would need a profile field, which is a new decision); or a real backend arrives (D-205's zero-backend premise).

**D-205 naming — amended (S337B, the directive is the sign-off):** qualified token names are now the rule. The account credential is the **"User Token"** and the per-trip capability the **"Trip Token"**, always qualified; unqualified "token" stays banned in UI copy. **"Trip Key" and "Sync Code" are retired names**, and every copy site updates. The identity remains a plain "name" or "nickname", never a token. Code-level identifiers (`Traveler.token` holding the nickname, `getSyncCode`/`setSyncCode`) are internal misnomers: keep them with comments, no rename churn.

**D-237 — superseded by D-239** in its door and credential shape (Trip Key as the door credential, the three-path door, the nickname-only path). Its carried-over parts (wall always-on D-054, guest-route mode deleted, the D-021 contract) are restated inside D-239.
**D-238 section 1 — amended by D-239** (conversion now mints a User Token plus show-once). D-238 section 2 survives verbatim; its "Sync Code group" phrase now denotes the "User Token group".

**Login is token-only — amended (2026-07-30, direct directive = sign-off):** door path (a) "Log in" now asks for the User Token only. The name field is removed from login and is collected only on path (b) "Create an account". The display name is still required by the identity model (`signIn` writes it to the identity slot `getActiveTraveler` reads, and it is what dismisses the wall and attributes edits), so on login it is reused from this device's saved name if present, and otherwise defaults to **"Traveler"**. New: **Settings → Identity** carries a rename field (re-running `signIn` with the new name) so the default isn't permanent; this is the app's only standalone display-name editor. Everything else in D-239 (the create path, show-once, the `?trip=` hold, sign-out, guest, the never-mix guard) is unchanged.

---

## D-240 · impl-note · `signOut()` is reload-free; any app-root subscription must teardown on `identity:changed`
_(S346, proposed 2026-07-30)_
**Decision:** `signOut()` (`lib/token-auth.ts`) clears the identity pair and fires `IDENTITY_CHANGED_EVENT` without a reload, and all three callers (navbar, settings-panel, more-list) invoke it directly. So any live subscription or heartbeat opened from an app-root mount (for example `itinerary-provider.tsx`) that gates on identity (D-055) has to re-evaluate reactively on `IDENTITY_CHANGED_EVENT`. A mount-once subscription (`[]`, no listener) outlives the session and keeps syncing for a signed-out user. The four domain sync effects and the presence heartbeat already do this; S346 fixed the sync-code trip-list effect, which did not, and which was dormant behind a Firebase gate and therefore latent. Pattern: `activate()` (re-checking all gates) on mount plus `teardown()→activate()` on the event, with an import-invalidation token so a late lazy `import()` can't re-subscribe after teardown.
**Why:** it captures the bug class, a mount-once identity-gated subscription, so a future such subscription isn't written the same broken way.
**Changes if:** `signOut()` is ever made to reload, in which case mount-once teardown is automatic and the reactive listener is redundant, though harmless.

---

# Wave (S347–S361) — D-241 … D-250

_Recorded 2026-07-30 at wave kickoff, ahead of implementation, so everyone working the wave carries them. Source: the plan authored after a 7-lane research wave. **Four of these are locked scope calls, each chosen against a researched counter-recommendation. Don't re-argue them.**_

## D-241 · LOCKED · There is no guest mode; supersedes D-236, retires the D-127/D-128 lineage
_(S351, a direct scope call 2026-07-30 is the sign-off)_
**Decision:** a logged-out visitor sees a marketing landing page and an auth form. Nothing else. Every sandbox mechanism is deleted: `sessionGate.setGuest/clearGuest/isGuest`, `wipeSandbox`, `adoptSandbox`, the `keyFor` guest branch, `GUEST_SANDBOX_ID`, `STORAGE_KEYS.guest`, `components/guest-convert.tsx`, and the two guest e2e specs. That removes roughly 400 LOC and 2 specs. `isDefaultTrip()` semantics and its 9 call sites are unchanged.
**Why:** D-236's sandbox was a *render* gate that never controlled what shipped, the same category error D-242 fixes. Deleting it is a smaller, more honest surface than maintaining a two-identity storage namespace. The counter-argument ("this kills the try-before-signup funnel") was on the table and we chose deletion anyway; on a private site for a friend group the funnel has no value.
**Changes if:** the app ever becomes publicly marketed and needs a try-before-signup path, in which case it wants a real demo trip, not a storage-namespace fork.

## D-242 · LOCKED (impl note) · The content pack is public by construction
_(S347, recorded 2026-07-30)_
**Decision:** `core/content/*` and `lib/booking-data.ts` compile into eagerly-loaded chunks on a public origin and must contain no PII: no real flight numbers, seat assignments, booking refs, personal addresses, or the party's real names. Realistic *fictional* equivalents only. Real booking detail belongs in a user-created itinerary item in localStorage. This is a standing content rule rather than a one-time scrub, and every future content edit is bound by it. **Ruling on the seam (S347):** prose in `core/content/` takes generic descriptors and all seat strings are deleted outright; `lib/booking-data.ts` keeps its *structure* and takes fictional same-shape values so the flights page and the FlightRadar24 tracker code path stay exercised; the hotel drops to area level, with no street and no postcode. The tracker URL encodes the flight number (`'Meridian Air 4471'` → `.../flights/ma4471`), so the deep link is the PII in URL form and must be regenerated from fiction, not merely hidden.
**Why:** verified empirically. `grep "Meridian Air 4471" out/_next/static/chunks/8167-*.js` matched, and that chunk is in the eager `<script>` set of `out/index.html`. `TokenGate` decides what to *render*, never what to *download*, so no client-side gate can ever fix this. Real flight numbers plus seat rows plus a street address next to exact travel dates is a machine-readable 32-day empty-house notice. What the fiction removes is the *actionable* part (which airport when, which seat row, which bed); the dates themselves are deliberately kept.
**Changes if:** never for the public build. If a private, authenticated build is ever added, real detail may live there, but not in `core/content/`.
**Residual, stated honestly:** the data has already been public. A scrub does not un-publish it.

## D-243 · LOCKED (impl note) · `GET /resolve` follows redirects and parses the final URL only
_(S348, recorded 2026-07-30)_
**Decision:** the Worker's `/resolve` endpoint follows redirects and parses `res.url` only; the response body is never read. The Google host allow-list is duplicated server-side and never trusted from the client (anchored regex `^(www\.|maps\.)?google\.(com|co\.[a-z]{2}|[a-z]{2,3})$` plus the literal set `{share.google, goo.gl, maps.app.goo.gl}`, `https:` only). Coordinates parse in precedence order: `!3d/!4d` from `data=`, then `@lat,lng`, then `?q|query|destination=lat,lng`. No Google API key, ever.
**Why:** the Places API requires billing, which free-tools-only forbids. The share-link flow (`maps.app.goo.gl/…` → `google.com/maps/place/<Name>/@lat,lng,z/data=!3d<lat>!4d<lng>`) puts everything needed in the redirect target. Not reading the body eliminates response-size, consent-interstitial and HTML-parsing risk at once, and pins outbound fetches to Google hosts, so there is no SSRF surface.
**Changes if:** Google changes the share-redirect format. Three independent patterns in precedence order are the hedge, and a parse miss degrades to `{ok:true, finalUrl}` with no coords, which the client already handles as a name-only prefill.

**Amended at implementation (S348, 2026-07-30, live-verified): the ruling stands, but its rationale was partly wrong.** The premise above, that the redirect target puts *everything needed* in the final URL, does not hold for the dominant share form. A real `share.google/<id>` link resolves live to `https://www.google.com/search?…&kgmid=/m/028h3l&q=Arashiyama`: no `/maps/place/` segment, no `!3d/!4d`, no `@lat,lng`, no coordinates anywhere. Only the desktop address-bar `/maps/place/…` form carries a pin. Consequences, all accepted:
- **`share.google` links yield a name only.** The name parser therefore takes a second shape, `?q=`/`?query=`, after `/maps/place/`, rejected if it looks like a coordinate pair. Without it the dominant share form pre-fills nothing and the feature ships dead. (The older in-repo plan the planning notes:50` did anticipate the `google.com/search?...` target; the wave plan did not.)
- **Coordinates for that form are unobtainable without a paid Places API**, which free-tools-only forbids. Name-only prefill is the honest ceiling and not a bug, and the user completes the pin manually via S357's "Drop a pin".
- **Two additions the wave plan's brief omitted but the import plan:62,186` require, now implemented:** (a) the final URL's host is re-checked after the redirect, because `goo.gl` is a general-purpose shortener, and without this the Worker would follow a redirect to any host and echo that URL back; a redirect off-Google returns 502 and the foreign URL is never echoed. (b) `access-control-allow-methods` gained `GET`, because `X-Trip-Token` makes the client's GET non-simple so a browser preflights it. The route alone would have stayed broken in a browser while curl worked fine.
- Parsed values are untrusted third-party input: coordinates are range-checked (|lat|≤90, |lng|≤180) and the name is capped at 120 chars.

## D-244 · impl-note · The marketing landing renders inside `TokenGate`'s logged-out branch at `/`
_(S355, recorded 2026-07-30)_
**Decision:** no new route, no layout split, no app-home URL move. The design spec's "<120 KB gzip, no providers" landing budget is explicitly not met and is deferred. The landing carries the full app bundle.
**Why:** in the App Router, `app/layout.tsx` wraps *every* route including any `(marketing)` group, since a route group nests inside the root layout rather than replacing it. Escaping the providers requires splitting the root layout and moving the app home off `/` (both cannot own `/`), churning the SW precache list, `lib/nav-items.ts`, `bottom-tab-bar.tsx` and around 30 specs. Zero acquisition value on a private site does not justify that refactor.
**Changes if:** the site ever needs real acquisition performance. **Upgrade path (named, not taken):** thin the root layout to `<html><body>{children}</body></html>` and move the app under `app/(app)/`.

## D-245 · Amends D-235 · A second family is admitted, for display only
_(S353, recorded 2026-07-30)_
**Decision:** `--font-sans` is **Geist** (variable, OFL, `next/font/google`), and a new `--font-display` is **Instrument Serif** 400 latin, `preload:false`, about 14 KB. `--font-mono` stays an alias of `--font-sans` plus `tnum`, so there is no third download; Geist has real tabular figures, so the 42 `font-mono` numeral sites keep aligning. This ships only if the 84-site `font-display` audit shows no serif leakage onto non-display text; otherwise `tailwind.config.ts:20` reverts to `var(--font-sans)` and the wave is Geist-only. The audit verdict is a required report line either way.
**Why:** D-235's one-family rule existed to avoid a second download and a heterogeneous type surface. A `preload:false` 14 KB latin-subset display face costs nothing on first paint and is the whole visual identity. The revert is one line, so this is a cheap experiment with a real gate.
**Changes if:** the audit fails (revert line 20), or a third family is ever proposed (it is not).

**Amendment: the audit ran twice, and the revert-only binary is replaced by repair-then-flip.** _(S353, recorded 2026-07-31)_ Two independent audit sessions ran the gate above. The persisted one is the planning notes; its numbers are verified against source and are canonical.

**Canonical numbers — cite these, not the plan's 84 or this entry's own 85.** There are **80** live `font-display` class sites, not 84 and not 85. Composition: 46 leaves plus 30 containers; of those, 4 leaks and 0 unknown. A raw `grep -rn "font-display"` from `nextjs_space/` returns about 100 hits across 62 files; reconciled, that is 80 real plus 4 comment/JSDoc mentions (`tailwind.config.ts:14`, `tailwind.config.ts:62`, `app/layout.tsx:29`, `components/section-heading.tsx:8`) plus 16 build-artifact hits (3 in `node_modules`, 2 in `out/`, 2 in `.next/`, none of them source). Both `tailwind.config.ts:14`'s own comment ("all 85 `font-display`…") and the planning notes:37` ("85× across 56 files") are wrong: the same stale S323-era number, propagated and never corrected.

**The ruling:** the revert-on-any-leakage gate above is amended to repair-then-flip. 76 of the 80 sites are clean, and the entire defect is four one-token `className` edits:
– `components/token-gate.tsx:490` — `font-display` → `font-mono` (live countdown digit grid; already requests `tabular-nums`)
– `components/budget-panel.tsx:457` — `font-display` → `font-mono` (currency grand total, `aria-live="polite"`)
– `components/weather-card.tsx:235` — drop `font-display` (temperature digits; the serif abuts the sans "C" sibling span at `:239`)
– `components/flight-journey-card.tsx:83` — drop `font-display` (flight-number identifier in list content)
Dropping the whole visual identity over a four-token defect works against LOCKED scope call #3 (full visual overhaul, chosen explicitly over "evolve"), and this entry's own **Why** calls the display face "the whole visual identity." Sequence: make the four edits, then flip `tailwind.config.ts:20` to `var(--font-display)`. Neither had landed as of this amendment: `tailwind.config.ts:20` still read `var(--font-sans)` and Instrument Serif was not yet imported in `app/layout.tsx`, so this records the decision, not its execution. **[Corrected 2026-08-01 — "Neither has landed" is false; both landed. The flip is live at `tailwind.config.ts:47` and reads `display: ['var(--font-display)', 'Georgia', 'serif']`. The cited anchor `:20` is stale too. Verified at source.]**

**Standing rule (durable beyond the four fixes): `font-display` is for headings, never for a value.** All four leaks are the same anti-pattern: reaching for `font-display` for *weight* on a data value instead of a heading. The test is not "does it contain a numeral" — a numeral inside a heading phrase (the "Day N — City" masthead pattern, a formatted date used as a heading) is heading typography, not a leak. The test is "is this a value, something that changes, must align, or is read for precision?"

**Fix-direction rule:** all four leaks are *direct*, meaning the class sits on the element rendering the value, so removing or swapping it there is correct. If a future leak instead has `font-display` on an ancestor with the value in a descendant, the fix is the opposite: leave the ancestor and add an explicit `font-sans`/`font-mono` to the value's own span, or the serif strips off the surrounding heading words too.

**Not established, don't cite as fact:** whether Instrument Serif 400 ships a `tnum` OpenType feature table. One audit session asserted it does not; the persisted audit explicitly declines to assert it ("I cannot confirm… the font is not on disk", since Instrument Serif was not yet wired into `app/layout.tsx` to inspect). **[Corrected 2026-08-01 — this premise is stale and the blocker it states no longer holds. Instrument Serif is wired: `app/layout.tsx:1` imports it, `:38` configures it, `:42` sets `variable: '--font-display'`, and `tailwind.config.ts:47` consumes it. The font is inspectable now, so the `tnum` question is answerable by whoever next needs it. The "not established" verdict on `tnum` itself stands; only its stated reason is dead. Verified at source.]** The ruling above does not depend on the answer: leak 3 (the mixed-family seam) and leak 4 (a serif data field in list content) are font-feature-independent and stand on their own.

**Attribution:** the persisted audit walks all 30 container subtrees to a verified child and reports 0 unknown; the other session's walk covered 21 of the 30. Both found zero container leaks, so 21 subtrees are double-covered and 9 rest on the persisted audit alone, and no `font-display` sits on a page, section or card wrapper. The two sessions differ on whether `PageHero` (`components/page-hero.tsx`) has 7 or 8 callers: the persisted audit lists 7 file paths but states "8" in prose. **Resolved (2026-07-31):** it is 7. Three independent `grep -rn "<PageHero" --include=*.tsx app components` runs agree, all landing in `app/` (flights, guides, japan, map, more, nepal, plan); "8" traces only to conversation and never appeared in any persisted document. It is immaterial regardless, since every caller passes a plain-string `title` with no numeral either way. **Provenance:** only Session B's audit exists as a file (the planning notes). Session A's was produced in-session and never persisted, so its "21" is transcribed from conversation rather than from a verifiable artifact. Don't go looking for a Session A document, there isn't one. The load-bearing half (Session B walked all 30 with 0 unknown) is on disk and verifiable.

## D-246 · Amends/fixes D-100 · Reveals use a floored fade, not opacity pinning. **The floor is `FADE_FLOOR = 0.95` in `lib/motion.ts`, not this entry's `--fade-floor: 0.7` in `globals.css`. Corrected twice (2026-08-01, 2026-08-02); the ruling stands, several of its stated specifics did not.**
_(S354, recorded 2026-07-30)_
**Decision:** ~~`opacity 0.7 → 1` + `y 12 → 0`, with a new `--fade-floor: 0.7` documented in `globals.css` as the source of truth.~~ **[Corrected 2026-08-02 (S366): both the value and the location are wrong. The struck text is kept only so the error stays readable; don't implement it.** The floor is `FADE_FLOOR = 0.95`, and it is a TypeScript constant in `lib/motion.ts`, not a CSS custom property. `--fade-floor` exists nowhere in `globals.css` and never did; its only occurrence in the source tree is inside `motion.ts`'s own header comment explaining why it *cannot* be a CSS var. Every one of the eight consumers is a framer-motion `initial={{ opacity: … }}`, which takes a number and cannot read a `var()`. Declaring it in CSS would have produced a token with zero CSS consumers plus a duplicated JS literal free to drift from it, the dead-token defect this codebase already documents at `--radius-sm`. `lib/motion.ts` → `FADE_FLOOR` is the single source of truth. Cite the symbol, never a number copied out of this entry.]** Replaces `initial={{opacity:1}}` at `reveal.tsx:96`, `hero-section.tsx:90`, `trip-dashboard.tsx:107`. The AA-floor `!important` block (`globals.css:356-367`) becomes dead code and is **deleted**. **[Corrected 2026-08-01: the final sentence is false; that deletion never happened.** The AA-floor block is live at `globals.css:348-375`, and the rejection is recorded in the file itself at `globals.css:342-347`: S354 proposed deleting it and the proposal was rejected, all three of its premises being wrong. The block uses no `!important` (it wins by `@layer utilities` source order), it is S323/D-235 rather than D-100, and it protects static, animation-independent sub-AA text that the floored fade has no bearing on. D-235's *"these must not be lowered back"* stands.]**
**Why:** D-100 pinned opacity so axe never sampled a mid-fade frame, which meant the reveal never actually revealed. ~~Under the new ramp, secondary text at α=0.7 measures 4.9:1 — **AA at every frame** — so the pin is unnecessary.~~ **[Corrected 2026-08-02 (S366): the 4.9:1 figure is false, and it was falsified by measurement rather than by argument.** α=0.70 measures 3.23:1 against the binding pair (`text-muted-foreground` on `bg-card`, the app's worst muted-on-light-surface combination) and broke five axe specs: `/`, `/plan/`, `/nepal/`, `/japan/` and nepal-filters-open, all `color-contrast [serious]`. The mechanism, recorded in `lib/motion.ts` and confirmed against axe's own reported colour, is that a wrapper `opacity` multiplies every descendant's alpha. So the S323/D-235 AA-floor block's `rgba(255,255,255,0.62)`, calibrated to clear 4.5:1 at opacity 1 with a thin margin, becomes an effective 0.434 and composites to `#757577` on the page field. Axe reported exactly `#757577`, and the arithmetic reproduces it byte-for-byte. It is also not a transient: `whileInView` never fires for content below the fold, so a floored masthead rests at the floor indefinitely and axe scans it there. The floor therefore has to be AA-safe on its own, not "safe on average". Measured sweep: 0.70 → 3.23:1 · 0.85 → 4.14:1 · 0.90 → 4.49:1 (still under) · 0.95 → 4.85:1, the first passing value. Hence 0.95. The pin was unnecessary for a different reason than this entry gave.]**

**Be honest about what 0.95 buys (recorded so nobody re-tunes the number hoping for a visible fade):** at 0.95 the opacity change is close to imperceptible. The reveal a user actually sees is the `y` slide. A wrapper-opacity floor cannot deliver a visible fade in this app without re-breaking the AA floor. If a real fade is ever wanted, it needs a different mechanism, fading a decorative layer rather than the text container, not a different number here. Lowering `FADE_FLOOR` to make the fade visible re-opens the five axe failures; that path is closed, not untried.
**Changes if:** ~~the token ramp moves such that α=0.7 drops below 4.5:1 (then re-floor higher, do not re-pin).~~ **[This trigger already fired, during the implementing slice itself, and the entry was not amended for eleven days.** α=0.7 did not "drop below 4.5:1" later; it was never above it. The trigger was written as a future hazard when it was in fact a present falsehood. **Restated for the live value:** re-measure if the token ramp, `--card`, or the D-235 AA-floor block moves such that α=0.95 drops below 4.5:1 against `text-muted-foreground` on `bg-card`. Then re-floor higher (0.96–1.0 is the whole remaining range), don't re-pin, and don't lower it.]**
**Trap to avoid (named):** under `prefers-reduced-motion` a floor that never animates would leave content permanently at ~~70%~~ **95% (S366: the struck figure was the D-246 value that never shipped)**. Reduced-motion has to show reveals at full opacity, asserted in `motion.spec.ts`. Live mechanism: every consumer forks on `useReducedMotion()` and lands reduced-motion users at `opacity: 1`. This is not applied to `.reveal-view-css` (the `@supports (animation-timeline: view())` path), which stays transform-only, because a view-timeline animation re-plays on every re-entry, so an opacity fade there would flicker on each scroll-by instead of revealing once.

**Why this entry has now gone stale twice, and what the actual defect is (S366, 2026-08-02).** This is the second correction to D-246. On 2026-08-01 its claim that the AA-floor block "is deleted" was found false, and today its floor value, the floor's *location*, and its contrast figure were all found false. Two independent corrections to one entry is not bad luck, it is a shape. The shape is that D-246 was written as a plan and filed as a record. Every falsified sentence describes something the slice *intended* at brief time (delete the block, use 0.7, put it in CSS, and the 4.9:1 that would have justified 0.7), and every one was overturned during the implementing slice by someone who measured, chose correctly, and flagged the deviation in the write-up. `lib/motion.ts` says so in its own header: *"the value is 0.95, not D-246's 0.7 — measured, not chosen. Flagged as a D-246 amendment."* The information was never missing. The write-back never happened. **The rule this entry now carries for every future entry: a decision recorded before its slice lands is a prediction, and a prediction that ships unamended becomes an instruction.** This log is loaded into the context of every piece of work that follows, so a stale prediction here does more than mislead a reader: it directs one, with the authority of the log behind it. Record the ruling before the build if you must, but the entry is not finished until it has been reconciled against what shipped. And note which half of this entry survived: the ruling (floor, don't pin) was right every time, and every falsified sentence was a supporting number, location or mechanism. Judge an amendment by whether the ruling still holds, and correct the specifics without re-litigating the ruling.

## D-247 · Re-bases D-047 / D-116 · The tracked perf number is measured eager transfer, not Next's "First Load JS"
_(S359, recorded 2026-07-30)_
**Decision:** the tracked metric is the measured eager transfer of `out/index.html`. Baseline: 28 requests, 877.5 KB raw / 266.1 KB gzip. The budget is ≤150 KB gz, so we are currently 1.77× over. `@next/bundle-analyzer` is added as a devDependency behind `ANALYZE=1` so the normal build stays byte-identical.
**Why:** D-116's "91 kB / 107 kB" is Next's CLI bucket, which excludes the three big eager vendor chunks (54 + 46 + 26 KB gz) and the CSS. The tracked metric has understated reality by roughly 2.5× since S107. D-047 is not overturned: it is exactly what keeps 456 KB of Firebase out of `index.html` even after D-248.
**Changes if:** the app stops being a static export, or Next's reporting changes to include eager vendor chunks.

## D-248 · LOCKED · Firestore sync is ON in production
_(S358, decided 2026-07-30)_
**Decision:** The six `NEXT_PUBLIC_FIREBASE_*` GitHub secrets are populated (`deploy.yml:153-158` already reads them, so this is a secrets-only action with no workflow edit). `firestore.rules` gains a document-size cap (`request.resource.size() < 1048576`) plus a field-count ceiling on the day/expense subcollections. The capability-token model (D-205/D-219) does not change, and no auth check is added: D-205 deliberately has no user identity, and adding one breaks every existing token. Resolves the long-open B1 keep/delete/finish question as **finish**.
**Why:** ~3,000 LOC of HLC/outbox/tombstone/merge code, unit-tested, never run in production, while the UI advertises User Tokens, Trip Tokens, share links and a sync badge that do nothing. Spark cannot be billed, so worst-case abuse is an outage, not a charge.
**Honest trade (R4):** sync-on swaps a "nothing works remotely" guarantee for "remote might be DoS-able by anyone who reads the bundle", since the project id is baked into the client. An attacker cannot read or destroy a specific trip without its unguessable capability id. Mitigations: the size cap, a private friend group on an unadvertised URL. App Check is the named upgrade path.
**Changes if:** real abuse appears (→ App Check), or the trip ever goes public.
**Non-negotiable regression check:** `grep -c firebase out/index.html` must remain 0 after the config is live. A single static import anywhere pulls 456 KB into first load and roughly triples the payload (R6).

**The parenthetical above is superseded by D-251.** `request.resource.size() < 1048576` is a no-op in Firestore. `request.resource` is a `Resource` of `{data, id, __name__}`, so `.size()` is a constant 3 regardless of document contents; the byte-size reading is Cloud **Storage** syntax, not Firestore's. It compiles clean (HTTP 200, empty issue list), so nothing warns you, and a guard written this way on every `write` would also have denied every delete (`request.resource` is null on a delete). D-251 is the authoritative source for the shipped guard shape: `boundedWrite()` on `create`/`update` only, `delete` left unguarded. The LOCKED ruling above, that Firestore sync is ON in production, is unaffected.

## D-249 · impl-note · Sign-out is a full local teardown
_(S352, recorded 2026-07-30. Note that this reverses D-239's "sign-out keeps data on disk".)_
**Decision:** `signOut()` clears identity **and** `activeTrip`, `syncCode`, `knownTrips`, `removedTrips`, and every `trip:*` key, reusing the collect-then-delete prefix scan from the deleted `wipeSandbox` (generalized to `trip:`; collect first, because removing while iterating re-indexes `key(i)`). Behind a confirm naming the irreversibility: with no email and no password, sign-out on the only device really is irreversible. A separate "Forget this device" in Settings additionally clears the IndexedDB photo store. Plain sign-out never clears photo blobs, but wipes their metadata indexes in both namespaces, leaving the files inaccessible. Photos never sync; signing back in cannot restore them. The confirm counts indexed photos across all swept trips and advises exporting each trip before teardown. Forget this device additionally deletes the blobs.
**Why:** today's `signOut` leaves the token's sibling state on disk, so a second person on a shared laptop sees the first person's trip names and dates. D-239 chose lockout-safety over privacy. With D-241 removing the guest namespace the prefix-scan needs a new home anyway, and the shared-device nuance was raised in Session 8 without objection to closing it.
**Changes if:** an account-recovery path (email/password) ever exists, at which point sign-out stops being irreversible and the confirm can soften.

**Amended 2026-07-31:** implementation found the mechanism above defective on two counts and extends it on a third. This block is binding on top of the unchanged decision above, and is recorded so a future reader does not "restore" any of the three original shapes.

**(a) The `trip:` prefix scan clears zero keys on the pack that matters. The fix is to clear both namespaces.** `core/storage/gateway.ts:431-434`:
```ts
export function keyFor(slot: TripScopedSlot): string {
  const id = getActiveTripId();
  return id === DEFAULT_TRIP_ID ? STORAGE_KEYS[slot] : `trip:${id}:${slot}`;
}
```
carries its own docstring stating this as **D-172 LOCKED**: the default pack grandfathers the legacy literal key, byte-identical, forever. So on the default pack (the seeded Nepal × Japan trip, i.e. every browser that never explicitly switched trips, the common case) all 14 `TripScopedSlot` domains live at bare `nepal_japan_*` keys with no `trip:` prefix. A bare `trip:` sweep therefore clears zero of them: sign-out would pass its own unit tests and still leave the previous person's itinerary, budget, journal, and photos on a shared laptop. **Fix:** `wipeAllTripData()` clears both namespaces, the `trip:*` prefix scan and the 14 bare `STORAGE_KEYS[slot]` literals, driven by a single canonical `TRIP_SCOPED_SLOTS` array exported from `gateway.ts`. That array also replaces the two hand-maintained duplicate copies of the list that exist today at `lib/__tests__/gateway-trip-scope.test.ts:23` and `lib/__tests__/multi-trip-sync-path.test.ts:156`. **The test rule, recorded because it is the part that would silently rot:** the unit test must seed the default pack's bare keys and assert they are cleared. A test that seeds only `trip:*` keys reproduces the defect inside the suite instead of catching it.

**(b) The quarantine-key exclusion is overturned: `itineraryCorrupt` is cleared by the teardown.** This reverses an earlier scout recommendation, which said `wipeAllTripData()` must exclude `:itineraryCorrupt` to protect the D-096 migration safety net. It is recorded plainly so nobody re-litigates it or "fixes" it back. Reasoning: `itineraryCorrupt` holds the original bytes of the user's own itinerary, written write-once-if-absent when a migration throws, and is never read back by anything (verified). Excluding it from the teardown therefore leaves a verbatim copy of the previous person's plan on the device, exactly the data D-249 exists to remove, sitting in the one slot nothing ever reads. Post-wipe there is also nothing left to restore *into*, so the retained copy is orphaned as well as leaky. The "independent lifecycle" clause protects the migration net during migration; it was never a rule about a deliberate, user-initiated device teardown. So: quarantine remains untouched by every other code path (that guarantee stays, and stays tested), and is cleared only by `wipeAllTripData()`.

**(c) `travelMode` joins the wipe set** (storage key `nepal_japan_travel_mode`), though it is not in D-249's original named list above. It is the same class: device-local state belonging to the previous session. Two concrete consequences are worth recording. It removes at the source the stale-flag trigger state that made the S351 redirect loop (D-253) reachable by ordinary use, and it eliminates a UX surprise where a traveler logs in, expects `/trips/`, and is instead bounced into Travel Mode by the boot-once relaunch acting on the previous session's flag.

**Why:** each of (a)/(b)/(c) surfaced only once implementation tried to build D-249 as originally written. The stated mechanism didn't achieve the decision's own stated goal, or left an easy-to-miss leak beside it. Recording the reasoning, not just the fix, is what stops a future reader from quietly "restoring" the D-172-faithful `trip:`-only scan or the quarantine exclusion, both of which look like reasonable readings of the unamended text above.
**Changes if:** never for (a)/(b). Both are correctness fixes to a mechanism that didn't do what D-249 already decided, not new scope calls. (c) reopens only if we want Travel Mode's armed state to deliberately survive a sign-out, and there is no known reason to want that today.

**Premise correction (same ruling):** the brief that produced this amendment asserted that D-249 above "contains a clause that the quarantine keys' independent lifecycle must NOT change." It does not. D-249 was read in full, and no such clause exists in this entry or in D-096. That phrase came from a scout recommendation made outside the decision log and never committed to it. Part (b) is therefore written to overturn *a scout recommendation*, not any literal text above. Recorded because a future reader chasing the "independent lifecycle" wording would otherwise hunt for text that was never here.

## D-250 · impl-note · Concierge output contract lives in the Worker prompt; rendering stays hand-rolled
_(S348 + S350, recorded 2026-07-30)_
**Decision:** The Worker `SYSTEM_PROMPT` gains a ~230-char formatting clause (plain sentences for 1–2 items; `- **Name** -- why, under 14 words` for 3+, 2–5 items; never headings/tables/code blocks/sub-bullets/numbered lists). `renderAssistantContent` is rewritten to emit real `<ul>/<ol>/<li>` with CSS markers. No markdown library. `renderInline` is untouched: it is the injection-safety boundary (href allow-list, no `dangerouslySetInnerHTML`).
**Why:** react-markdown + remark-gfm ≈ 44 KB gz. marked + DOMPurify ≈ 27 KB gz and requires `dangerouslySetInnerHTML`, reopening an injection surface the current regex→React-element renderer is structurally immune to. The hand-rolled renderer is ~110 lines.
**Changes if:** the concierge ever needs tables or nested structure, at which point re-evaluate. The prompt currently forbids both.
**Honest limit:** the prompt half is unverifiable without a live model key. The renderer is the deterministic half and carries the readability fix on its own.
**Amendment (2026-09-25):** models ignore parts of the clause, so the renderer now also tolerates `•`/`–` bullets, a whole list run onto one line (split only at two or more ` - **` or counting-up ` N. **` markers outside code spans), `---` rules, and pipe-table rows, which fall back to one line per row with cells joined by ` · `. ` -- ` in plain text becomes an em dash. Tables and nesting are still not rendered, and "Changes if" still holds.

## D-251 · impl-note · `request.resource.size()` is a constant in Firestore rules: never use it as a size guard
_(S358, recorded 2026-07-31. The wave plan specified this exact no-op and it nearly shipped.)_
**Decision:** In Firestore security rules, `request.resource.size()` must not be used as a size or abuse guard. It is Cloud **Storage** syntax, where it means bytes. In Firestore, `request.resource` is a `Resource` of `{data, id, __name__}`, so `.size()` returns the member count of that wrapper: a literal constant 3 for every document. `request.resource.size() < 1048576` is `true` wearing a costume, and it compiles clean (HTTP 200, empty issue list), so nothing warns you. The charitable rewrite `request.resource.data.size()` at least reads the document, but counts top-level keys, so a `< 1048576` ceiling on it can never fire either. Firestore rules have no byte-size function at all, and a byte cap would also be redundant, since Firestore enforces ~1 MiB per document at the API level. Guard **shape** instead: top-level field count plus `.size()` on each known container field (`.size()` is entry-count for a map, element-count for a list, character-count for a string, so a hostile scalar in a container slot is bounded too).
**Corollary: `delete` must stay out of any `request.resource`-based guard.** `write` ≡ create + update + delete, and on a delete `request.resource` is null, so a guard touching it errors and denies. The plan's literal "add a size guard to every `write`" was proven in the emulator to break `deleteDoc`, which would have silently stalled day-removal (`itinerary-remote.ts:241`) and presence teardown in production. Split the ops: `allow get, list, delete: if true;` + `allow create, update: if boundedWrite();`.
**Why:** measured against the rules engine rather than reasoned about. `request.resource.size() == 3` allowed both a 3-field and a 300-field document, and `< 1048576` waved a 10,000-field hostile write straight through. Had it shipped, a security review would have seen a size cap where there was none. That is worse than shipping no guard at all.
**Also recorded, so these do not read as covered:** rules cannot mitigate R4 quota burn. 20K tiny valid-shaped writes/day exhausts the Spark free-tier quota and stalls sync (outage only; Spark cannot be billed). Nor do they block one field holding one huge string. Both need App Check, the named upgrade path, not more rules.
**Set ceilings loose, deliberately:** a denied write does not surface to the user. It leaves the chunk dirty in the outbox and stalls sync silently. A guard that fires on the owner's real 32-day trip is worse than no guard (R5). Ceilings are ~10× the measured heaviest real payload.
**Changes if:** Firestore ever ships a real byte-size function in rules, or App Check lands, at which point the quota-burn residual closes and the shape guard can tighten.
**Verified by:** `scripts/rules-check.mjs`. It is manual, needs the Firestore emulator, and is not in CI (backlog follow-up). Run from the repo root: `firebase emulators:exec --only firestore --project demo-rules "node scripts/rules-check.mjs"`. It is a three-phase suite whose phase 4 is a negative control: it derives a guard-removed variant *from the file under test* (`if boundedWrite();` → `if true;`) and re-runs the same 9 hostile writes, which must all flip DENIED→ALLOWED. Do not "simplify" that derivation back to a frozen copy or to `git show HEAD:firestore.rules`. HEAD stops being the pre-guard file the moment the guard is committed, which silently turns phase 4 into a second copy of phase 3 and reports green forever. The script throws if the substitution matches nothing, so renaming or restructuring `boundedWrite()` fails loudly instead of quietly disarming the control.

## D-252 · impl-note · The Worker's `POST /chat` handler must accept both `/` and `/chat`
_(S348B, recorded 2026-07-31)_
**Decision:** The bare-origin branch in `worker/src/index.ts:131`, `const isChat = request.method === 'POST' && (url.pathname === '/' || url.pathname === '/chat')`, is deliberate, not legacy debt. Do not narrow it to `/chat`-only without the client-side precondition in **Changes if** below.
**Why:** `NEXT_PUBLIC_CONCIERGE_URL` (`lib/concierge-config.ts`) is provisioned and documented as a path-less `…workers.dev` origin. `hooks/use-concierge-chat.ts:125` posts chat straight to `CONCIERGE_URL` with no path suffix, while `lib/place-resolve.ts:52` builds `${base}/resolve?url=…` from the same variable. The variable must therefore stay bare, and chat always arrives with pathname `/`. This was a live-breaking regression in slice S348 (`0a6756c`): that slice added path routing (`pathname === '/chat'`) ahead of the pre-existing bare-origin behaviour, which would have 405'd every chat request in production. Worker `v1.5.0` was never released, and S348B (`9d9cba5`, worker `v1.5.1`) restored the bare-origin branch before it shipped. Worker deploys are also decoupled from and faster than the Pages/client deploy, so narrowing this to `/chat`-only would break every already-deployed client in the window before the next Pages rebuild, even if the client were fixed in the same commit.
**Changes if:** the client is ever changed to append `/chat` explicitly **and** every deployed build is confirmed to have picked that up. Then the bare-origin branch can be dropped.

## D-253 · impl-note · Two `replace`-based redirects must never form a complementary pair
_(S351, recorded 2026-07-31. S351 is uncommitted in the working tree as of this entry.)_
**Decision:** when two components can each navigate via a `replace`-style call (`router.replace` or `window.location.replace`) gated on the *same* piece of persisted state, their guard conditions must be co-designed. If one side's identity condition changes, the other side's guard must be restored in the same change, never deferred as a follow-up.
**Why:** S351 flipped `components/travel-date-picker.tsx:86-88` from fail-open (an `isGuest` check → redirect) to fail-closed (`if (!traveler) window.location.replace(withBasePath('/'))`, gated on `useActiveTraveler()`), while in the same change deleting `components/travel-mode-relaunch.tsx`'s `sessionGate.isGuest()` guard. The component now runs only `isTravelRoute(pathname)` and `travelModeGate.isActive()` (`components/travel-mode-relaunch.tsx:26-27`; verified no identity check remains in the file at all). Boot any non-`/travel` route with `travelMode === 'active'` (armed by any earlier Travel Mode entry) and no traveler → `TravelModeRelaunch` fires `router.replace('/travel/')` → `TravelDatePicker` sees `traveler === null` → `window.location.replace(withBasePath('/'))`, a full page load, which re-runs the boot-once relaunch effect on remount → repeat. Both hops are `replace`, so no history entry is created and Back cannot escape. The app is bricked until site data is cleared.
**Triggering state is ordinary, not exotic:** `signOut()` (`lib/token-auth.ts:188`) calls only `identityStore.clearIdentity()`, which removes just the token + name keys (`core/storage/gateway.ts:572-575`). Verified: no code path clears `travelMode`. `travelModeGate.exit()` is the only function that touches the key (it downgrades `'active'` → `'seen'`, `core/storage/travel-mode-store.ts:36-38`) and has exactly one caller, `components/travel-exit-button.tsx:22`. So `travelMode='active'` surviving a sign-out is the normal case, not a crafted edge case.
**Related invariant:** the `!traveler` redirect in `travel-date-picker.tsx` is safe from a hydration mismatch only because the component is mounted via `dynamic(() => import(...), { ssr: false })` (`app/travel/sections.tsx:14-15`). Under SSR the stale `{traveler: null}` server snapshot would bounce every signed-in traveler off `/travel` on a hard load. Load-bearing and undocumented at the call site.
**Detection note:** a full chromium Playwright net did not catch this. The coverage that would have caught it did not vanish as a deleted file. `guest-convert.spec.ts` and `guest-route-gate.spec.ts` (the two files actually deleted this slice) never reference `/travel` at all, and `guest-route-gate.spec.ts`'s own `ROAMABLE` list is `['/plan/', '/flights/', '/nepal/', '/japan/', '/map/', '/trips/', '/settings/']`, with no `/travel/`. What actually vanished is a `guestTest.describe('S190 · guests are blocked', …)` block removed from inside the still-existing, still-modified `e2e/travel-entry-exit.spec.ts`, which drove the nav button into `/travel` and asserted the gateway flag (`TRAVEL_KEY`) stayed unarmed after a guest bounce. A file-level `git status` scan for the lost coverage finds nothing; the loss is a describe-block inside a surviving file. No remaining spec seeds `travelMode='active'` together with an absent traveler.
**Changes if:** the `!traveler` redirect in `travel-date-picker.tsx` is removed in favour of `TokenGate`'s wall instead. That is `components/token-gate.tsx`, mounted unconditionally at `components/itinerary-provider.tsx:478` inside the root layout (`show = mounted && (held || !traveler)`, no pathname term, so it already covers `/travel` along with every other route). That removes the pair, and the rule no longer applies at this site.

## D-254 · impl-note · `/travel` has no route-local identity redirect: the app-wide wall is the only gate
_(recorded 2026-07-31)_
**Decision:** `components/travel-date-picker.tsx` does not redirect on `!traveler`, and `components/travel-mode-relaunch.tsx` carries no identity check of its own. Coverage for an unidentified visitor landing on `/travel` comes solely from `TokenGate`: `components/token-gate.tsx:88`, `show = mounted && (held || !traveler)`, no pathname term, rendered as an opaque `fixed inset-0 z-[70]` panel over the route.
**Why it is safe, and why the ordering runs the safe direction:** `TokenGate` is a static import mounted in `components/itinerary-provider.tsx`, so it is present in the first client commit and its `setMounted(true)` fires in the first effect flush. `TravelDatePicker` is `dynamic(…, { ssr: false })` (`app/travel/sections.tsx:14`), so its chunk resolves on a later tick. The picker cannot render before the wall. There is exactly one `layout.tsx` in the app (no `app/travel/layout.tsx`, no route groups), and a sweep of `z-[7x]`/`z-[1xx]` across `components/` and `app/` finds nothing stacked above the wall.
**The operative rule: at most one of the two sites may ever navigate.** This pairs with D-253 (two `replace`-based redirects must never form a complementary pair). If a future slice adds an identity guard to `travel-mode-relaunch.tsx`, that is fine on its own, but re-adding a redirect to `travel-date-picker.tsx` while the relaunch also navigates recreates the exact loop class D-253 records.
`signOut()` historically did not clear `nepal_japan_travel_mode`, so a tokenless boot bouncing to `/travel` was an expected, benign state under this entry. Cross-reference the D-249 amendment above, which changes that by folding `travelMode` into the sign-out teardown.
**Changes if:** the wall ever becomes pathname-conditional (then `/travel` needs its own explicit coverage check), or `/travel` gets its own layout that renders outside `ItineraryProvider` (then `TokenGate`'s mount guarantee above no longer holds and must be re-verified).

### D-255 · AMENDS D-180 (not D-152) · (S362B, proposed 2026-07-31) · The Worker may log a search leg's outcome class and nothing else
**Decision:** `worker/src/` may emit one observability signal per grounded-search attempt, carrying only two things: that the search leg was attempted, and its outcome class — `ok` / non-2xx (with the status code) / `timeout` / `quota-exhausted`. Nothing else.
**Still forbidden, unchanged and explicitly restated so the carve-out cannot be widened by inference:** the user's message · the search query derived from it · the search results · the reply · the `ops[]` · the trip digest · any provider key or token. The `{reply, ops[]}` chat path keeps its bare `return null` failure contract untouched. This entry does not license logging anywhere in the chat ladder.
**Why the query in particular is named:** the search query is derived from the user's own message, so "log what we searched for" would leak user content through the back door while looking like diagnostics. That is the precise temptation an engineer meets when told to make a failure debuggable, so it is excluded by name rather than left to judgement.
**Why this amends D-180 and not D-152.** The distinction decides who is allowed to approve it. It was raised as a D-152 conflict, and directionally that was right that a recorded decision constrains it, but the specifics differ in a way that matters:
- D-152 is LOCKED and is about the journal never syncing (gateway key 12 stays device-local). Its body says nothing about the Worker, and amending it would require explicit sign-off from the owner.
- The clause that actually binds here is D-180 (*"stateless relay… no logging of message bodies or tokens anywhere… no chat content is ever written to any log/store"*), marked *(S198, proposed)*. It is not LOCKED, so it can be amended without escalation.
- **No test guards the Worker's logging.** The pin cited, `nextjs_space/lib/__tests__/concierge-ops.test.ts` (*"logs nothing (D-152)"*), is client-side: it spies on `console` around `validateOps`/`applyOp`, and its own comment scopes it to *"this module."* A grep of `worker/test/` for logging pins returns nothing. So no test changes, and the amendment is materially cheaper than the conflict first appeared.
**Why the carve-out is justified on the original decision's purpose rather than on convenience.** This is the load-bearing argument. D-152's premise is privacy, and D-180 extends it structurally so no chat content reaches a log. A search leg that failed does not need to name any chat content to be observable. A carve-out justified by the original decision's own rationale survives review; one justified by *"we needed it"* gets deleted by a future cleanup pass, and that deletion is the worse outcome, because the observability disappears months later with a green test suite behind it.
**Why the requirement exists at all:** graceful degradation must not mean undetectable degradation. The concierge already fails invisibly by design, since every provider returns `null` rather than throwing. That is the same shape as the Gemini leg silently falling through to Groq with nobody seeing it. A search leg that quiets down when its monthly credits run out, with no signal anywhere, is how a feature stops working three weeks before anyone notices.
**Changes if:** we ask for zero Worker output whatsoever (then the degraded path needs a different observability channel, not none), or the outcome class is ever widened to include anything derived from user input, which this entry forbids by construction.

### D-255a · AMENDS D-255 · (S362B, 2026-08-01, raised in one session and ruled in another, recorded on `main` by the first) · The licensed signal is one per search-leg decision, not per attempt
**Amends its own scope:** the licensed signal is one per search-leg *decision*, not per attempt. The class list becomes `ok` / non-2xx (with the status code) / `timeout` / `quota-exhausted` / `skipped-by-gate` / `no-key`. The two added classes describe cases where no search was attempted at all, and they are licensed deliberately, not by extension: a relevance gate that is too narrow means the search leg never fires, answers silently stay ungrounded, and nothing turns red. That is the same undetectable-degradation failure this entry exists to prevent, arriving one step earlier in the path. The privacy argument is unchanged and strictly stronger for these two, since a skipped search never derived a query from the user's message, so there is even less user-derived content in play than on a failed one. Everything in D-255's forbidden list stands unchanged.

**Why this amendment exists at all, recorded because the failure mode is the interesting part and it is not obvious from either entry alone: D-255 as originally written would have licensed deleting the check it was written to guarantee.** S362B's design makes `skipped-by-gate` mandatory, correctly, since a too-narrow gate is its headline failure mode. But D-255's scope line reads *"one observability signal per grounded-search **attempt**"*, and every class it names (`ok`, non-2xx, `timeout`, `quota-exhausted`) describes a search that happened. `skipped-by-gate` and `no-key` are not-attempted cases and fell outside the carve-out as literally written. D-255's own strongest paragraph then becomes the weapon: it argues that a carve-out justified by *"we needed it"* gets deleted by a future cleanup pass, and that the deletion is the worse outcome because the observability disappears months later behind a green test suite. A future reader applying D-255 literally and rigorously would therefore find the skip signal unauthorized and remove the one signal that reveals a silently-never-firing search gate. The transferable shape: an exception carved by enumerating cases silently forbids the case nobody had thought of yet. D-255's own preferred form, justify by the original decision's purpose rather than by convenience, is also the form that survives a case you did not enumerate, and this entry is that argument applied to itself.

**Process note, recorded because it is the reusable part:** this was raised by one session and ruled by another, and the amendment text was deliberately landed on `main` by whoever held `main` rather than appended on the feature branch. The decision log is append-only and actively curated, which makes a branch-side append the classic conflict on exactly this shape of file: the same class of blocked merge that already cost this round time when untracked branch-side files stopped a `git merge`. Append shared append-only records where they will live, not where the work happens.

**Changes if:** the class list is ever widened to include anything derived from user input (still forbidden by construction, unchanged from D-255), or we ask for zero Worker output at all.

## D-256 · impl-note · (S353B/S353C + S355, 2026-08-01) · A post-sweep grep returning survivors is expected and is not, by itself, evidence of an incomplete sweep
**Decision:** for any tree-wide sweep (a repaint, a rename, a prose pass), the residual count is not a defect measure until the deliberately-retained population has been subtracted first. A raw grep answers *"how many occurrences remain"*, which is not the question *"did the sweep miss anything."* Anyone auditing a sweep by its residual count must first classify, and the classification, not the count, is the finding.

**Two independent instances this round, which is why this is a decision and not an anecdote:**
- **The palette repaint.** A post-merge `grep -rn "gold-"` returned ~55 surviving sites, including apparent focus rings and button fills, and it was read as *"the merge dropped repaints."* It had not. Each site was in one of three categories with completely different responses: (A) the merge dropped a repaint, a real defect that blocks · (B) never swept, because the file did not exist when the 843-site inventory was built (`sign-out-confirm.tsx` is the known-certain case) · (C) deliberately gold, a sanctioned status colour under the ruling. Only (A) blocks. The count could not distinguish them; only `git show <pre-merge>:<path>` vs the working tree could.
- **The "User Token" → "your key" rename.** A raw `grep -c "User Token"` across the four rename files returns 42. The UI-copy population is 24. The 18-site gap is JSDoc and JSX comments citing D-239's formal term, and those must not be renamed: "User Token" is the correct name of the *decision*; "your key" is what the *user* sees. Renaming them breaks traceability from the code back to the decision log. A future audit greping that file and reading 18 survivors as an incomplete rename would be wrong in exactly the way the gold audit was wrong.

**The general rule this encodes: a sweep and its verification must be scoped to the same population.** A sweep scoped to *user-visible copy* verified by a grep scoped to *every occurrence of a string* will always report a gap, and the gap is an artifact of the mismatch, not a defect in the work. This is the wave's standing *"scope your probe to your claim, not to where you expect the answer to be"* applied to sweep verification.

**Recorded with the miscount that produced it, because the miscount is the better evidence:** the S355 enumeration reported `user-token-show-once.tsx` as 5 UI sites by counting `:81`, which is a *Trip Token* line, a different concept it had itself just finished warning must never be conflated. A careful read-only pass conflated the two terms inside the document warning against conflating them. If that can happen there, it can certainly happen to an engineer doing bulk edits, which is why `trips-hub.tsx` (whose `:667` carries both terms in one sentence) is edited site-by-site with no bulk find/replace at all.

**Changes if:** a sweep is ever genuinely exhaustive over every occurrence (no retained population), in which case the raw count *is* the measure. That must be stated at brief time, not assumed at audit time.

### D-255b · AMENDS D-255a · (S362B, 2026-08-01) · `error` joins the class list, and the enumeration stops being load-bearing because the privacy property is now enforced structurally
**Decision (1), the seventh class:** `error` is added to the licensed outcome classes, alongside `ok` / non-2xx (with status) / `timeout` / `quota-exhausted` / `skipped-by-gate` / `no-key`. It covers a non-timeout throw: DNS or TLS failure, or a 200 whose body is not JSON. Folding it into `timeout` or `non-2xx` misreports the failure, and omitting it restores the silent-degradation hole D-255 exists to close. It carries the class name only, with identical privacy posture to the other six.

**Decision (2), and this is the part that matters more than the class:** the class list is no longer the mechanism that enforces the privacy constraint, so adding a future class does not require amending this entry. As built, S362B enforces it two ways that do not depend on anyone having enumerated correctly:
- a template-literal union type on the log function, so passing a query into `log()` does not typecheck; and
- a structural grammar test that fails on any line that is not exactly a class token, which catches payload shapes no blocklist would have anticipated.

**The forbidden list stands unchanged** (user message · derived search query · results · reply · `ops[]` · trip digest · any key or token). What changes is *what guarantees it*: the guarantee now lives in the type and the grammar test, not in the completeness of a list. A future class may be added without amending, provided it carries a class name only and the grammar test still passes.

**Why this second decision exists, and it is the entry's whole point: D-255a's own thesis landed on D-255a within the hour.** D-255a documented that *"an exception carved by enumerating cases silently forbids the case nobody had thought of yet"*, and was itself an enumeration of six classes. The seventh appeared on contact with the code, exactly as its own argument predicted. Patching the list a second time would have been treating the symptom of a defect the previous entry had already correctly diagnosed. The fix is to stop making the list load-bearing: enumerate outcomes for *documentation*, and enforce the *privacy invariant* structurally, so the two can no longer drift apart. Generalisable: when an enumeration has been wrong twice, the answer is not a longer list. It is to find the invariant the list was standing in for and enforce that instead.

**Changes if:** the structural enforcement (union type + grammar test) is ever removed or weakened, at which point the list becomes load-bearing again and every addition needs an amendment.

## D-257 · impl-note · (S362B, 2026-08-01) · A pure-function gate test cannot tell you the gate is wired: the vacuity class at the integration seam
**Decision:** for any feature whose behaviour is decided by a pure predicate and then acted on elsewhere, the predicate's unit tests and the integration's tests are both individually insufficient, and the negative control must be run against the pair. Recorded because S362B measured it directly rather than reasoning about it.

**The measurement (S362B proof 12):** removing the search wiring entirely puts 23 tests red and leaves 11 green, and the 11 are exactly the pure `shouldSearch` unit rows. They pass happily inside a Worker that never calls the function they test. So a green gate table is consistent with a feature that is completely unwired.

**The counterpart (proof 11):** drop the search results from the system text while the log still reports `ok`, and the entire D-255 logging block stays green. The observability says the search succeeded, and the model sees nothing.

**Together:** *"neither the gate tests nor the logging tests can carry this alone; only the pair does."* Each half is a check that runs, passes, and cannot detect the failure everyone assumes it covers. That is this project's signature defect, appearing at the seam between a predicate and its consumer rather than inside either one.

**The rule this encodes:** a negative control must delete the wiring, not the unit. Deleting the unit proves the unit's tests work; deleting the wiring proves the *feature* is tested. Ask of every gate: "how many of these stay green if the feature is never called?" If the answer is not zero, name which ones and why.

## D-258 · impl-note · (S359, 2026-08-01) · The service-worker cache name is a change-detector, not an invariant: never assert it unchanged
**Decision:** no brief may assert that `sw.js`'s cache name is unchanged across builds. The name is a digest that churns on every build via two independent mechanisms: build-id-bearing relative paths feed `h.update(rel)`, and all 20 route HTMLs embed the build id in the RSC flight payload (37 files under `out/` contain it). Thirteen builds produced thirteen names. To assert build invariance, use the precache count plus a build-id-normalized recomputation of gen-sw's own digest and a per-entry hash list. Those hold still; the name cannot.

**Recorded because an unsatisfiable Definition of Done was approved.** The S359 revised DoD required *"precache still 175 and `sw.js` cache name still `trip-precache-e3abb929ae66`, modulo the churn floor."* The second clause cannot be satisfied by any slice, ever. `e3abb929ae66` was never reproduced and is not reproducible; the delivered tree measured `trip-precache-253558130c88`. The contradiction was reported against the DoD rather than the check quietly widened, which is the behaviour we keep asking for, actually delivered.

**The instrument it substituted, and the A/B it ran** (`git checkout --` to the base, rebuild, restore):
```
CONTROL   base tree, no analyzer         buildId id_hAT4xCwQLuuwbGQ7Aq   175   da16906fc3a645b1
CHANGE    analyzer wired, ANALYZE unset  buildId mNVFD5H5OXKtj4TWVXoRm   175   da16906fc3a645b1
DELIVERED final tree                     buildId JMb278siTSHAmI6SYHPoz   175   da16906fc3a645b1
per-entry diff CONTROL vs CHANGE / vs DELIVERED : exit 0, identical
```
**Churn floor: 2 entries** (`_next/static/<buildId>/_{build,ssg}Manifest.js`); precache delta 0, below the floor. And D-247's byte-identity clause turns out to be structurally guaranteed rather than merely observed: disabled `@next/bundle-analyzer` is a literal identity function (`if (!enabled) return nextConfig`), and `BundleAnalyzerPlugin` only reads stats.

**The generalisation, and it is the same family as D-256: the instrument must be able to hold still for the claim being made.** A value that changes for reasons unrelated to the property under test cannot evidence that property. It can only ever detect *that something changed*, never *that nothing did*. Pairs with the standing `generateBuildId` rule: `next.config.js` sets none, so Next generates a random build id per build. Measure the churn floor by building the same tree twice before attributing any filename-level delta.

## D-262 · (S362B, 2026-08-01) · The Tavily search leg must not ship, and shipping it is the default unless the secret is actively deleted
**Decision:** Worker 1.5.3 must not go live with the Tavily search leg enabled. Tavily's Terms of Service are disqualifying for this app's use, and the use is not marginal: it is the central case the terms describe.

**The clauses, verified at source (<https://www.tavily.com/terms>, fetched 2026-08-01) by two independent readers:**
- **Section 1.3** — *"'Customer Input' means any and all text, materials, information, data, **queries** and other input submitted or provided by Customer, Users, Customer Application **and/or an end-user of the Customer Application**, to the Services…"* Drafted for exactly our shape, not stretched to it.
- **Section 6.5** — Tavily and its third-party AI providers *"may use, process, analyze, and **retain** Customer Input… **for purposes of training, improving, developing, and enhancing artificial intelligence models**."*
- **Section 9.2** — a *"worldwide, royalty-free… **sublicensable (through multiple tiers), perpetual, and irrevocable** license to… **create derivative works of**… Customer Input."*
- **Section 7** — Tavily *"may share Customer Input with its affiliates and vendors."*
- Opt-out is GDPR-scoped. A US free-tier user has none.

**Why it bites rather than being theoretical, verified in code:** `worker/src/search.ts` sends `query: message.trim().slice(0, MAX_QUERY_LENGTH)`, the user's raw message, verbatim, with no rewriting or templating. So the perpetually-licensed, sublicensable, training-eligible "Customer Input" is a real person's own sentence about their own trip.

**The operational clause, and it is the one most likely to be missed: not shipping the search leg is an action, not an omission.** The leg gates solely on `TAVILY_API_KEY` being present at runtime (`search.ts` → `log('no-key')` → `return null`). The secret is already provisioned on the live Worker. It was added ahead of the build and currently sits unused because the deployed Worker predates the search code. Deploying 1.5.3 therefore activates search immediately and silently. To ship the rest of 1.5.3 safely, `wrangler secret delete TAVILY_API_KEY` must be run first. Everyone agreeing "we won't ship search" and nobody deleting the secret ships search.

**Exposure today is zero and stays zero if nobody deploys.** Nothing has ever been sent. There is nothing to unwind, only something not to start. The `no-key` path is a shipped, tested degradation to an ungrounded reply, so this does not block the rest of 1.5.3.

**Lesson 1: an unvetted dependency that has not shipped is not the same finding as one that has, even when the exposure is identical in kind.** Gemini and Tavily were filed as one "unvetted provider" finding. They are not one finding. Gemini's damage is a stock that does not grow while we deliberate; Tavily's is a flow that has not started, and the deploy is the tap. One still has a decision point in front of it; the other only has an unwind behind it. Separating them by what can still be prevented is what converted a retrospective note into a caught deploy. It generalises to any pre-deploy third-party integration.

**Lesson 2: a vendor's marketing or docs page is not evidence about its terms, and where they disagree, the disagreement is the finding.** `docs.tavily.com/faq` advertises *"SOC 2 certified, zero data retention."* Section 6.5 permits retention for training. The S362B research pinned endpoint, auth and credit model from the docs: it read the wrong artifact, and the wrong artifact was the reassuring one. The research was not sloppy; it was pointed at the surface designed to reassure.

**Replacements, with evidence strength stated rather than rounded up.** LLM → Cloudflare Workers AI is strongest because it is *contractual*, not docs: *"Cloudflare does not use any Customer Content to train generative AI tools"*. Note that a separate clause still permits use *"as needed to provide and improve the Services"*, which is narrower than training and is not nothing; state both. Groq is second (Services Agreement section 4.2 bars training; zero-data-retention free to all customers). Search → Brave (90-day retention cap, *"does not collect any identifiers that can link a search query to an individual"*), but no training clause was found either way, and absence of a clause is not a commitment. That is materially weaker evidence and must be recorded as weaker. Exa is rejected on its own instruction, *"you should not input personal information… as Query Data"*, which our design does by construction.

**Lesson 3: a feature that gates on runtime configuration cannot be disabled by a decision, only by changing the configuration.** A deploy gate held by consensus, against a leg that self-arms on the presence of a secret already provisioned on the live Worker, is not a gate. It is a shared intention. The secret is the switch, and it is currently on. It was provisioned by hand, so it has to be deleted by hand: this is a manual action with a hard ordering constraint, not a preference to be agreed on. It must be executed *before* the deploy, and it must be ordered *ahead of* the provider choice, because the provider choice has no such constraint.

**Addendum 2026-08-01: two independent preconditions ride on one `wrangler deploy`, and doing either one alone still ships the problem.** The provider-ladder change (removing the Gemini leg) and `wrangler secret delete TAVILY_API_KEY` are both gates on the same deploy. Shipping the ladder fix without deleting the secret still ships search; deleting the secret without the ladder fix still sends the whole trip digest to the unpaid Gemini tier. They are not alternatives and they are not sequential: they are a conjunction on one action. This addendum is written *inside* D-262 rather than as a new entry on purpose. A deploy precondition recorded in a different entry from the deploy gate is the dangling-pointer class (R11, D-265), and the person reading this at deploy time is reading *this* entry.

**The ladder change has a verified compatibility floor that makes it safe, recorded because a lucky compatibility is still worth knowing you got lucky on.** Groq's strict `json_schema` constrained decoding is supported only on the `gpt-oss` model ids, and `worker/src/providers.ts:38` reads `GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']`. Both qualify, so the schema-forced `{reply, ops}` envelope, which is the entire plan-editing mechanism, keeps working. Had the ladder used any other Groq model, this would have silently degraded ops from strict-schema to best-effort JSON, and the first symptom would have been proposals quietly failing `validateOps`: the *"N suggested changes didn't match the current plan"* counter ticking up with no other signal, on exactly the editing/adding/removing path the non-regression fence names.

**Demotion is not a fix, and the reason generalises: a fallback leg still receives the entire digest every time it fires, so demoting a provider changes the frequency of an exposure, not its nature.** Worse, it makes it unobservable. `grep -c "log(" worker/src/providers.ts` returns 0; there is no logging in that file at all. So a demoted provider is an intermittent exposure nobody can measure, which is harder to reason about than a constant one. Today we cannot tell whether Gemini answers everything; after a demote we could not tell whether it answers plenty. Removal costs the same ~3 lines as reordering and is a net deletion.

**Changes if:** Tavily's terms change materially (re-read at source, not the docs), or the query stops being the user's raw message. A rewritten, entity-stripped query is a different submission and would need its own assessment.

## D-261 · impl-note · (S355, 2026-08-01) · No brief asserts a fixed precache integer: assert the count plus attribution for any delta
**Decision:** the precache entry count is never a pass/fail constant in a brief. A slice reports the number, and any delta must be attributed: which entries, and why. `175` is retired as a checkable value.

**Why:** the count is a property of the *tree*, not of the *app*, and it moves for legitimate reasons on most slices. Measured: `175` at `c93e8e2` · `178` after S355 · and S356 adds images, so it moves again. The S355 delta is +3 `_next/static/chunks/*.js`, with no new routes, no new HTML and no new assets: webpack re-partitioning when `landing-page.tsx` entered the wall's module graph. That is a benign, explicable change that a constant would have flagged as a failure.

**The failure mode a constant creates is worse than the one it prevents:** a check that goes red every slice for legitimate reasons trains people to edit the expected value, and an expectation that gets edited on sight has stopped being a check. The attribution requirement is what keeps the signal. An unexplained +3 is still a finding; an explained +3 is evidence.

**Method for establishing a base, and it is the standard now** (S355, applying D-258 one slice later): build the unmodified base yourself, via a scratch `git archive` extraction of the base commit, built and measured, rather than trusting a remembered number from another tree. `base 7b0667c → 175` and `S355 → 178` were both measured in the same session, on the same box, by the same command.

**Pairs with D-258** (the cache *name* is a change-detector, never an invariant) and the standing `generateBuildId` rule (Next generates a random build id per build, so measure the churn floor by building the same tree twice before attributing any filename-level delta).

## D-260 · impl-note · (S353C, 2026-08-01) · The visual net does not observe most of the app: a green visual run is not evidence a repaint is correct
**Decision:** `e2e/visual.spec.ts` may never be cited as evidence that a visual change is correct, complete, or absent. Its 24 tests are 8 element-scoped surfaces × 3 viewports, and the elements are: `section#hero` (home, countdown digits masked) · `page.locator('header').first()` on nepal/japan/plan/map · a `dl` inside the place-detail sheet · the command-palette dialog · the footer. Everything else in the app is unobserved. Any claim about a visual change must name the instrument that actually saw it.

**The measurement that forced this: S353C's baseline pass was a no-op, and the reason is not that the repaint was clean.** S353C changed 10 files and six itinerary categories, four going from invisible to fully coloured for the first time. The visual net returned 24/24 green with zero baselines moved. Two independent causes, both verified rather than inferred:
1. **Coverage, the dominant one.** S353C touched the navbar, itinerary category chips, the flight-journey card, map pins and badges, backup/restore, the more-list and the sign-out dialog. Not one of those appears in any visual spec. The overlap between "surfaces S353C changed" and "surfaces the net captures" is empty.
2. **Threshold, the secondary one, and it has a named case now rather than being a general worry.** The countdown ring *is* in frame: `hero-section.tsx:436` renders it inside `section#hero`, and its wrapper is `hidden min-[420px]:flex`, so it is visible at tablet 768 and desktop 1280 (hidden only at mobile 390). Its gradient changed from bespoke `#f4c46b`/`#f48fb1` to the `--accent-scroll` token, gold/pink to cyan, and the baselines still passed, because a thin ring stroke is under `maxDiffPixelRatio: 0.02` of a full hero box. The digit mask covers the numerals, not the ring.

**Consequence: this amends the wave-close rule that said to run every baseline pass with `--update-snapshots=all`.** That rule was written to defeat cause 2 (mode `changed` will not rewrite a baseline that still passes). It does not defeat cause 1 at all, since there is no baseline of an unobserved surface to refresh, and applied blanket it is actively harmful. Measured: re-running all three home-hero viewports with `=all` rewrote 3 PNGs, but only 2 were real. The mobile file was pure re-encode churn: reverting it and re-running plain, it passed against the original. Blanket-updating 24 files would have buried 2 genuine changes under ~22 noise diffs and destroyed the attribution the separate passes exist to provide.

**The rule that replaces it:** run the pass plain first to enumerate what moved; then `--update-snapshots=all` scoped to only those tests; then verify on disk which files actually changed and revert any that pass against their original. Attribution is the product of a baseline pass, not the refresh.

**The generalisation, and it is the same family as D-256 and D-257: an instrument's silence is only evidence if you have shown the instrument was pointed at the thing.** *"24 passed"* and *"the repaint is correct"* are unrelated statements here. The layer-3 bespoke-hex population was already ruled to need a visual pass rather than a grep because no mechanical detector exists; this entry establishes that the automated visual net is not that detector either. That pass has to be a human looking at the running app.

## D-259 · impl-note · (S359 half B, deferred — 2026-08-01) · Precache scoping may trim `_next/static`, but never the route HTMLs
**Decision:** when the deferred service-worker precache-scoping work runs, *"app shell + `/`'s own chunks"* means trim `_next/static` entries only. The 20 route HTMLs stay precached. Two independent things forbid dropping them:
- `scripts/gen-sw.mjs:73-75` records *"every route MUST be precached"* as the D-073 contract, a bug already fixed once, for S153's `/journal`.
- `e2e/pwa-torn-update.spec.ts` Part A pins the S271 invariant that `/travel/` and `/plan/` resolve offline to their own shells, asserted by exact `<title>`.

**Why this is recorded now rather than at brief time: the deferred slice's own brief contains the trap.** Its section 6.5 says *"visit a route that is no longer precached"*, which reads as licence to drop route HTML and would break both guarantees above. That was caught before the work started. Cancelling half B was right for a stronger reason than the one given at the time: the stated reason was that scoping redefines the precache count five other briefs assert against, and this is a second, independent reason.

**Changes if:** D-073 is ever consciously retired *and* the S271 torn-update invariant is re-specified. Both, not either.

**Related and independently valuable: the clean measurement was the misleading one.** S362B built *both* candidate gate fixes rather than arguing for one. Candidate B looked clean across all 59 corpus messages, and was then killed by three targeted probes showing it broke *"where are we eating tonight?"* and *"where are we drinking after the game"*. The corpus contained no first-person discovery phrasing at all, so B's clean sweep was an artifact of the corpus's own blind spot, not evidence about B. A measurement instrument's gaps are invisible in its output, and a *clean* result is the one most likely to be reporting the gap rather than the truth.

## D-263 · impl-note · (S363/R6, 2026-08-01) · The category vocabulary gets one source of truth and a compile-time seam guard, and the guards it already had were pointed at the harmless half

**The measured state, which inverts the recorded one.** The itinerary category vocabulary lives at 14 sites: 1 source of truth (`nextjs_space/lib/trip-data.ts:27`) plus 13 copies, of which 6 are compiler-exhaustive and 8 are silent. The record said "nine, three guarded"; both numbers were wrong.

**The finding that matters more than the count: `tsc` guards exactly the copies whose divergence is cosmetic, and none of the copies whose divergence loses data.** Every guarded site is a `Record<ItineraryCategory, X>` display map (colours, icons). Every unguarded site is a list: validation gates and pickers. Proven with the repo's own `tsc` against a union that gained an 11th member: only `Record<Cat,X>` errors, while `Cat[]`, `readonly Cat[]`, `as const satisfies readonly Cat[]` and bare `as const` all compile clean. The split is not arbitrary. It is backwards.

**A live vacuous check sat on the drop gate, and its own comment is what kept anyone from re-checking it.** `nextjs_space/lib/concierge-ops.ts:45` reads *"a `satisfies` tie keeps the two from drifting silently."* That is false. `as const satisfies readonly ItineraryCategory[]` catches an *invalid* member but is silent when a category is added, which is the only direction this row is about, and it guards the exact function that drops AI ops.

**Both directions traced; the recorded one is the louder of the two.** Worker-adds-first: `worker/src/providers.ts:144` → `concierge-ops.ts:65` `isCategory` → dies at `:119`/`:130` → the user sees exactly `"N suggested changes didn't match the current plan."` (`concierge-chat.tsx:451-452`, pinned at `lib/__tests__/concierge-op-feedback.test.ts:123`). Client-adds-first is silent in a way nothing can observe: the model is schema-constrained and cannot emit the category at all, so there is no dropped op, no message, no signal, and the category is simply unreachable through the concierge forever.

**Decision, the shape: ~8 lines across 4 files, proven bidirectional by three real runs.** A zero-import leaf file `nextjs_space/lib/itinerary-category.ts` holds the type; `trip-data.ts:27` re-exports it (zero call-site churn); `worker/src/providers.ts:144` takes a type-only import plus `satisfies readonly ItineraryCategory[]` and a 2-line `Exclude` guard; `concierge-ops.ts:57` takes the same `Exclude` guard. Mutation A (client-only add) and mutation B (worker-only add) each fail `tsc`, naming the offending category.

**Why a type-only import is permitted across a seam where a value import is not:** `import type` is erased by esbuild, so the wrangler bundle gains no runtime dependency. "The Worker cannot import the client" is respected in the only sense that binds a deployed artifact. And the naive broad version genuinely fails, verified with a mechanism rather than assumed: importing from `trip-data.ts` drags the client `core/` graph into the worker's program, which sets `noUncheckedIndexedAccess: true` and `lib: ["ES2022"]` (no DOM), producing errors in `core/dates/trip-dates.ts` and `core/storage/gateway.ts`. The packages are not typecheck-compatible. The leaf file's zero-import property is what makes the narrow version work, and that property is load-bearing forever.

**The blocking condition, and it is the reason this entry is not just "add a guard": nothing in CI typechecks the worker.** `.github/workflows/ci.yml:44` sets `working-directory: nextjs_space` for every step, and there is no worker job in either workflow. `worker/package.json`'s `typecheck` and `test` scripts run only when a human runs them locally. So a compile-time guard in `worker/src/providers.ts` would be real but unenforced: this round's signature defect, reintroduced by the fix for it. A guard nothing runs is worse than no guard, because it reads as coverage.

**And the independent discovery that outweighs R6 itself: `worker/test/*.test.ts` has never run in CI either**, including every one of S362A's five mutation-proven repairs of the vacuous `expect()`-inside-a-swallowed-callback tests. The single most valuable verification work of this round is enforced by nothing.

**Ruled:** the worker CI job (~10 lines of YAML, typecheck and test) rides with the guard, gated on a pre-check: run the worker's typecheck and tests locally first. Green → add both. Red → do not add the CI job in this slice, since a red job at wave tail blocks the close; add the guard plus a client-hosted Vitest mirror, and file the redness as its own row. Scope is bounded to the 2 silent sites that lose data. The 6 picker/budget lists stay silent because their divergence shows up in a dropdown, not in lost user data.

**The blocking condition is *not* closed by the CI job, and this entry must not be read as saying it is. The job executes in zero repositories.** Raised in the second pass, then measured two levels further:
1. `ci.yml` is report-only by design and says so (`:8` — *"THIS WORKFLOW DOES NOT GATE DEPLOY"*; the enforcing gate lives in `deploy.yml`, S88).
2. It has never run here at all (`:15` — *"NOT EXECUTED IN DEV: the private dev repo has no git remote and no Actions runner"*). Confirmed independently: `git remote` returns empty in this repo.
3. It is never mirrored. `scripts/sync-mirror.mjs:17` sets `APP_DIR = 'nextjs_space'` and `:295` scopes the sync to it, so `worker/` is outside and never leaves this machine.
4. And the gap the second pass explicitly could not close, now closed: the mirror has no `ci.yml` at all (its `.github/workflows/` contains only `deploy.yml`) and no `worker/` directory. So even the "maybe the mirror's workflows are maintained separately" escape hatch is shut.

`deploy.yml` is not the fix and was rejected on evidence: it does not deploy the worker (its only worker references are the `NEXT_PUBLIC_CONCIERGE_URL` public-URL variable), because the worker ships by a manual `wrangler deploy`. Putting the job there would gate the *app's* deploy on *worker* checks, coupling two independent artifacts, while a human still bypasses it entirely.

**And the shape is this entry's own sentence coming true inside the fix it authorised:** *"A guard nothing runs is worse than no guard, because it reads as coverage."* We built a CI job that reads as coverage and runs nowhere: the signature defect, one layer up, wearing the fix's clothes. The register row, the commit message and this decision all read as if R6 were enforced.

**Ruled:** keep the job (it is correct, costs nothing, and becomes live the day a remote exists), and enforce at the point the artifact actually ships. `worker/package.json` gains `"predeploy": "npm run typecheck && npm test"` alongside a `"deploy": "wrangler deploy"` script. npm runs `pre<script>` automatically, so `npm run deploy` cannot ship a red worker. Native tooling, two lines, no CI infrastructure, and it works in a repo with no remote, which is the binding fact everything else foundered on. (Ceiling stated rather than hidden: a human running `npx wrangler deploy` directly still bypasses it. This converts "enforced nowhere" into "enforced at the documented ship command", not into "airtight".)

**The honest ledger line, kept verbatim from the second pass:** *"the guard exists and is proven bidirectional; the CI job that would enforce it is written but executes in no repo we currently push to."*

**And D-263's specified guard shape does not compile in the worker package.** `worker/tsconfig.json:10` sets `noUnusedLocals: true`, so the `_assertNoMissingCategories` const the client uses is rejected: `TS6133: declared but its value is never read`. The obvious way to make `tsc` green is to delete the guard, which is exactly what this decision exists to prevent. Resolved by exporting the declaration, with the divergence from `concierge-ops.ts` commented in place and cited to the tsconfig line.

**The pre-check ran and it is green, so the conditional above is resolved.** Recorded here so no future reader re-runs it or re-argues it. Measured in `worker/`, 2026-08-01: `npm run typecheck` → exit 0; `npm test` → 5 files / 101 tests passed, 572 ms. So: add both. Build no client-hosted Vitest mirror. File no redness row. Written into the decision rather than left in a session log, because *"gated on a pre-check"* is the kind of clause that outlives the memory of whether the check was ever run, and an unresolved conditional in a LOCKED-adjacent entry reads as open work forever.

**Syntax correction to the shape above. The design is unchanged; the one-statement version of it does not compile.** The leaf-file re-export needs both `import type { ItineraryCategory }` and `export type { ItineraryCategory }` in `trip-data.ts`. A bare `export type { X } from './itinerary-category'` re-exports the name without binding it locally, and `trip-data.ts` *uses* the type internally, so the single-statement form fails with `TS2304`. Recorded because the failure mode is misleading, not merely annoying: the next reader hits a "cannot find name" error on a file that visibly exports that very name, and the natural conclusion is that the zero-import-leaf re-export design is wrong. It is not. It is two statements, not one.

**Changes if:** the worker is extracted to its own repo (the sibling-path `import type` breaks `npm run typecheck`, loudly and cheaply, and the *build* is unaffected), or someone re-declares the union inline in `trip-data.ts` instead of re-exporting it, which silently detaches the guard. The leaf file's comment must say so, noting without irony that this is the same prose-rot mechanism that produced the false `satisfies` comment being replaced.

**The sub-question below is ruled: see `D-266`.** Answer: `schema.ts` is correctly excluded, being a fail-closed authoring gate rather than a data path. But the ruling found that D-263's own excluded set contains a real data-loss site, and it is not the one anybody was asking about. The phrase *"the 6 picker/budget lists stay silent because their divergence shows up in a dropdown, not in lost user data"* in the paragraph above is wrong twice, and is corrected by D-266: `schema.ts` is neither a picker nor a budget list (right call, wrong reason), and the budget list is not harmless, because it silently discards money records. Left standing above rather than rewritten, so the correction is legible.

**Open sub-question, raised during S363A and not yet ruled. Do not treat R6 as closed until it lands.** R6's evidence column names two sites as having "no tie at all": `worker/src/providers.ts:131-142` and `core/content/schema.ts:28-40`. The decision shape above guards `providers.ts:144` and `concierge-ops.ts:57`, so `schema.ts` is not in it, and it carries a parallel `itineraryCategories` const wired to neither `CATEGORIES` nor the new guard. Either R6's evidence text overstates it (it is one of the 6 harmless picker lists) or it is a third silent site that fell out between the register row and this ruling. It was left alone as out of scope, which was correct. Flagged rather than guessed, and flagged loudly, because closing R6 without an answer marks a row DONE on a site nobody re-checked, and this entry's own history is that its site inventory was already wrong once in both directions (9→14 sites, 3→8 silent). It is being ruled on now.

## D-264 · impl-note · (S363/R7, 2026-08-01) · `--legacy-peer-deps` is forced by three React-18 peer pins, D-090 is not the reason, and the `.npmrc` only works in one directory

**Three pins, not one.** `cmdk@1.0.0` (peer `react ^18.0.0`), `next-themes@0.3.0` (`^16.8 || ^17 || ^18`), `sonner@1.5.0` (`^18.0.0`). Proven: `npm install cmdk@1.1.1 --dry-run` does not resolve, it moves the error to `next-themes`. The recorded candidate "bump cmdk" is one third of a fix; cmdk is merely the first name npm happens to print.

**The `@radix-ui/react-dialog` "ships twice" lead is false, and the correction kills the incentive that made the bump attractive.** It is present twice on disk: `cmdk@1.0.0` pins it at an exact `1.0.5` with no caret, which is why npm cannot dedupe it against the top-level `1.1.1`. But the bundle carries one copy. A signature string occurring once in 1.1.1's dist and twice in 1.0.5's occurs exactly once across the whole built `out/` tree. The nested copy is tree-shaken: `CommandDialog` is defined at `components/ui/command.tsx:28` and imported nowhere. Non-vacuousness was checked, because a "0 copies" result would have proven nothing. cmdk *is* in the bundle (`cmdk-list-sizer` in `out/_next/static/chunks/`), and no source file is newer than the build. There was never a second thing to close.

**The D-090 citation in both workflow headers is wrong.** `.github/workflows/ci.yml:21` and `deploy.yml:27` assert the flag is required *"(a real, pre-existing peer-dep pin, D-090)"*. D-090 is *"Vitest is the unit-test runner; tests live in `lib/__tests__/*.test.ts`…"*, a test-runner decision. Its only mention of the flag is an incidental sandbox caveat blaming a `@typescript-eslint` parser/plugin pin mismatch that no longer exists. Two consequences: we are not constrained by D-090, and the cause the comment names is not the cause.

**Decision.** `nextjs_space/.npmrc` (2 lines: one comment, one `legacy-peer-deps=true`). The location is load-bearing and was measured: npm reads the per-project file from the package root only, so a repo-root `.npmrc` reads as `false`. A root file would look like the fix, pass review, commit, and the next cloner would still hit ERESOLVE. The comment must name which three deps forced it and state that removing them is the exit condition, or the mute becomes permanent by forgetting. The false D-090 citation in both workflow headers is corrected; the explicit `--legacy-peer-deps` flags stay (redundant, harmless, and they keep CI green if `.npmrc` is ever lost). The three bumps file forward as their own slice. `sonner 1.5.0 → 2.0.7` is a major, and a persistent Sonner toast already trips this repo's axe net, so it needs the full a11y suite re-run. "Delete cmdk" is rejected: `command-palette.tsx` is ~520 lines with a custom scorer and two e2e specs pinning its keyboard semantics.

**Changes if:** all three deps are bumped to their React-19 lines (`cmdk@1.1.1`, `next-themes@0.4.6`, `sonner@2.0.7`), then `.npmrc` comes out. **Known cost, stated rather than hidden:** `legacy-peer-deps=true` changes resolution for every install forever, including making `npm ci` skip peer validation. It trades a loud, bounded, one-hour failure for a quiet, unbounded one. The peer range is the only automated signal that a dependency has not been checked against a React major. No test detects the loss and there is no expiry.

## D-265 · impl-note · (S363, 2026-08-01) · A comment that cites an authority is more dangerous than one that doesn't — it transfers trust to a source the reader will not open

**Both of the day's rulings turned out to be defended by a false citation, and in both cases the citation is *why* nobody re-checked.** `concierge-ops.ts:45` cites a `satisfies` tie as the thing preventing drift, proven silent on exactly the direction that matters (D-263). Both workflow headers cite D-090 as the reason `--legacy-peer-deps` is required, and D-090 is a Vitest decision naming a conflict that no longer exists (D-264).

**The mechanism, stated generally:** an uncited comment invites the reader to verify. A comment that names a decision id, a language feature, or a prior slice spends the reader's trust on a source they will not open, and the more precise the citation looks, the more completely it substitutes for checking. This is why both false comments survived multiple reviews on a project that has otherwise spent an entire wave hunting checks that cannot fail.

**Related and already on record, now recognisable as the same shape:** R3's four stale *"brand primary"* comments (prose describing a colour the code no longer uses, indistinguishable by grep from code that still *is* that colour), and R11's `"see Blockers"` pointer to a section that does not exist. A cross-reference is a pointer with no compiler behind it. Four instances, one shape: an assertion that reads as authoritative while pointing at nothing, or at something that does not say what the pointer claims.

**Standing practice:** when a comment cites a decision, a type-system feature, or a prior slice as the reason something is safe, the citation is the thing to verify first, not the thing that lets you skip verifying. Where a citation is load-bearing for a *guarantee* rather than merely explanatory, the guarantee needs a check that fails. Prose is not a mechanism.

**Changes if:** never. This is a reading habit, not a policy with a trigger.

---

## D-266 · impl-note · (S363/R6, 2026-08-01) · `schema.ts` is correctly excluded — and the exclusion list D-263 waved through contains a site that silently destroys money records

**The question asked:** is `nextjs_space/core/content/schema.ts:28`'s `itineraryCategories` a third silent `ItineraryCategory` divergence site that fell out of D-263, or one of the harmless lists? Ruled harmless: D-263's scope stands and R6's evidence text is what needs correcting. The finding that outranks the question is in the second half of this entry.

**Why `schema.ts` is genuinely safe, traced rather than assumed.** `itineraryCategories` has exactly one consumer, `z.enum(itineraryCategories)` one line below it at `:57`, and the module's only importer repo-wide is `lib/__tests__/content-validation.test.ts:28`. It validates repo-committed authored seed (`TRIP_ITINERARY: DayPlan[]`), never user data; the runtime read path is deliberately permissive by design (`core/vault/schema.ts:24` is `category: z.string()`, not `z.enum`, under D-095/D-018, because it parses user data that must never be destroyed). On an added union member it is fail-closed: `tsc` silent, runtime unaffected, and `npm test` goes red in CI the moment seed content actually uses the new category, in the same edit that introduces it. That is the opposite of D-263's data-loss mechanism, which is silent-and-unreachable-forever.

**D-263's 14 / 6 / 8 inventory is confirmed exactly, by mutation rather than by re-reading.** An 11th member (`'wellness'`, reverted) produced exactly 6 `tsc` errors, every one a `Record<Cat,X>` display map, and `schema.ts:28` was not among them.

**The finding that outranks the question: `BUDGET_CATEGORIES` is a data-loss site, and D-263 dismissed it in a subordinate clause.** D-263 says *"the 6 picker/budget lists stay silent because their divergence shows up in a dropdown, not in lost user data."* True for the 4 pickers. True for `schema.ts`. False for the budget one. `core/budget/model.ts:65` feeds `isCategory` at `core/budget/expenses.ts:85-87`, which gates `sanitizeExpense` at `:102` (`if (!isCategory(v.category)) return null;`), discarding the whole expense. That runs on four user-data paths: `storage.ts:41` (read), `storage.ts:50` (sanitizes on write, so the loss is persisted), `core/vault/backup.ts:118` (restore-from-backup), and `lib/expense-export.ts:76` (import). A money record, silently destroyed, including on the restore path where the user's expectation of losing nothing is strongest. The repo's own `lib/__tests__/expenses-core.test.ts:173` proves the mechanism. Separately `core/budget/flatten.ts:50` iterates the list, so an unknown category's budget is omitted from the sync leaf-path set. The threat model is one R6's evidence already accepted, *"an unknown category from a sync peer or an older build"*, and Firestore sync is ON (locked call #4).

**And it carries a live vacuous check, the sixth instance, inside the family of the decision written to kill the class.** `lib/__tests__/budget-model.test.ts:257` is named *"BUDGET_CATEGORIES is exactly the 10 ItineraryCategory values (D-012)"*, inside a `describe` block named *"constants — the canonical shape stays in sync."* It compares against a hardcoded literal list with no tie to `ItineraryCategory` whatsoever, and was observed green while the union carried 11 members. Verified independently at source. Its name states the exact guarantee it cannot provide.

**Ruled: fix it this round, in S363C.** Bounded to one file plus its test, it is the root-cause form of a decision already taken, and leaving the vacuous test in place is worse than the hazard itself, because it reads as coverage. Severity stated honestly: not a live defect today, since all 10 members agree everywhere. It is a hazard that arms the moment anyone adds a category, identical in status to the two sites D-263 does guard but with a worse payload.

**The trap inside the fix, and it is why this entry exists rather than a one-line ticket: applying D-263's `Exclude` guard here verbatim produces a permanently vacuous guard.** The declaration is `export const BUDGET_CATEGORIES: readonly ItineraryCategory[] = [...] as const`, and the `: readonly ItineraryCategory[]` annotation widens the type, so `typeof BUDGET_CATEGORIES[number]` is `ItineraryCategory` rather than the literal union, making `Exclude<ItineraryCategory, typeof BUDGET_CATEGORIES[number]>` unconditionally `never`. The annotation must be dropped to `as const` (or `as const satisfies readonly ItineraryCategory[]`) first or the guard can never fire. `schema.ts:28`, `providers.ts:145` and `concierge-ops.ts:46` are all bare `as const`/`satisfies` and do not have this problem, which is exactly why a copy-paste of the working guard fails silently here. Copying the fix without this change would reintroduce this round's signature defect inside the fix for it.

**And the trap is a property of the file, not of `BUDGET_CATEGORIES`.** It was raised in a second pass, then widened by a scan of the whole file. `CURRENCIES` (`core/budget/model.ts:62`) carries the identical widening shape two lines above the site just ruled on. Scanning for the pattern rather than the instance found a third: `LEGS` (`:54`). Three consecutive exported consts in one file, all annotated `: readonly X[]`. So this is local house style, not a one-off slip, and anyone who later adds a compile-time guard to any of them inherits the same silent `never`. Not fixed here: `CURRENCIES` and `LEGS` have no data-loss path today, and widening the slice at wave tail to chase a style is how a bounded fix stops being bounded. Recorded so the next reader inherits it instead of rediscovering it. *(`LEGS` is computed via `.map()` rather than a literal, so a guard there would be inert for a second, independent reason.)*

**Changes if:** the widening annotation is ever restored to `BUDGET_CATEGORIES` (the guard silently stops binding, and the comment at the guard must say so), or `sanitizeExpense` stops being the choke-point for expense reads/writes/restores/imports.

**The reusable shape, and it is about how the earlier decision was written, not about the bug:** D-263's exclusion was a bucket phrase, *"the 6 picker/budget lists"*, that lumped five harmless sites and one dangerous one under a single justification, and the justification was true of the majority, so it read as true of the set. Nobody re-checked the members, because the sentence sounded like it had already checked them. An exclusion stated as a category rather than as an enumerated list with a reason each is an unaudited claim wearing a summary's clothes. Unlike D-255b's enumeration trap, which fails by *forbidding* the unlisted case, this one fails by *silently absolving* it.

---

## D-267 · process · (S363D, 2026-08-01) · A prohibition in prose beside a runnable command that violates it — and the fix that created the command was mine

**The near-miss.** The S363D instructions said, in one section, *"never run wrangler in any form."* Four paragraphs later, another section said to break something, run `npm run deploy`, show it halt, then revert and *"show green"*, with `npm run deploy` still the named command. Post-revert `predeploy` passes, so that second run proceeds straight into `wrangler deploy`, against a worker where 1.6.0 is explicitly `NOT DEPLOYED` and gated, and `TAVILY_API_KEY` is still provisioned on the live Worker. The deploy would have silently activated the Tavily search leg, the exact thing `D-262` forbids, on terms licensing perpetual, sublicensable, training-eligible use of the user's raw message.

**It did not fire, and this is verified rather than assumed.** Whoever ran it refused to reconcile the contradiction silently. They ran `npm run predeploy`, the literal command npm chains as the pre-hook, and raised the contradiction, taking the explicit, repeated, unqualified hard rule over the more implicit one. A second person re-ran the proof the same way. Confirmed independently on the trunk: no deploy artifacts (`worker/.wrangler/tmp` holds only `bundle-*` and `dev-*` from 02:23, ten hours prior, and `dev-*` is a `wrangler dev` artifact), `74c116d` is on the branch not `main`, and `main`'s `worker/package.json` has no `deploy` script at all.

**The shape, and it is this project's own lesson turned on its author: the prohibition was in prose, the violation was in a copy-pasteable code block, and the code block is what gets executed.** Both written by the same author, in one pass, four paragraphs apart. We repeatedly tell ourselves that *prose is not a mechanism*; a safety rule stated only in prose, sitting next to a runnable command that breaks it, is that failure in our own handwriting. Rule: a hard prohibition must be enforced by the command, or the document must contain no runnable command that can violate it. Two prose sentences disagreeing is a document bug; prose disagreeing with a code block is a loaded gun.

**And the second-order part: the ruling that created the guard also created the gun.** Before we ruled *"add `predeploy` + `deploy` to `worker/package.json`"* (see D-263's amendment), this repo had no `deploy` script at all. The worker shipped by a raw human `wrangler deploy`, and no instruction could have said *"run `npm run deploy`"* because the command did not exist. The fix for an enforcement gap manufactured a one-word path to a deploy that D-262 forbids, and instructions reached for it within the hour. And the guard requires the gun: npm's `pre<script>` hook only fires for `npm run deploy`, so removing the `deploy` script would disable the very enforcement it enables. The hazard is structural, not a drafting slip.

**Ruled: the mitigation is one line of documentation, not more machinery.** the worker README and `docs/RELEASES.md` already carry the honest ceiling (*"enforces at the documented ship command only, not airtight — a direct `wrangler deploy` still bypasses it"*, plus the zero-repository CI fact). They must also state that `npm run deploy` is now a one-command path to shipping the D-262-gated 1.6.0, and that `wrangler secret delete TAVILY_API_KEY` is a precondition, not a follow-up. Deliberately not automated: chaining the secret deletion into the deploy script would make an irreversible external change to a live service run as a side effect of a build command, a worse hazard than the one being closed, and not ours to automate.

**Changes if:** the Tavily leg is removed from the Worker source (the D-262 gate closes and the warning becomes stale, so delete it then rather than leaving a lying comment), or a CI runner ever exists for `worker/`, at which point the local guard stops being the only mechanism.

---

## D-268 · process · (S363 net triage, 2026-08-01) · A ≤3-sample bisect cannot attribute an intermittent failure — and "it reproduced in isolation" is also one sample

**What happened.** The wave-close net failed one test (`e2e/map-favorites-offline.spec.ts`, console-error guard, `TypeError: Failed to fetch`). We re-ran it isolated (failed), then bisected across three real wired builds: pre-wave pass, S357A-only pass, S363-merged fail, and attributed the regression to S363. The attribution was wrong. Then someone ran the control we had skipped: the pre-S363 tree at `--repeat-each=10` fails identically (1 failed / 9 passed), in its own detached worktree on a distinct `PLAYWRIGHT_PORT`. The defect predates the wave.

**The reasoning that produced it, quoted so it is not repeated:** *"A transient does not appear on exactly one side of a bisect, three builds running."* False. Measured rate ~10–20%; at `p=0.15`, `P(pass, pass, fail) = 0.85 × 0.85 × 0.15 ≈ 0.11`, about one bisect in nine. A statistical claim asserted without doing the statistics, and stated as a law. No rate measurement was even needed to see the shape: *any* intermittent produces that pattern at a frequency nobody should call impossible.

**And "it reproduced in isolation" carries no more weight than one run, because it is one run.** The isolated re-run (6 pass / 1 fail) was treated as confirming the failure was real and attributable. A second isolated run on the same tree was 7/7 green. Two people quoted a single isolated run to each other as corroboration.

**Ruled — the procedure, in order:**
1. **Measure the rate first** with `--repeat-each=10` (or more) on the tree where it failed. A rate, not a verdict.
2. **Control on the parent tree at the same repeat count**, in an isolated worktree with a distinct `PLAYWRIGHT_PORT` (`reuseExistingServer` will otherwise serve the other tree's `out/`).
3. **Only then attribute.** If the rate is below ~90%, a 1-sample-per-tree bisect has no power and must not be run at all. It will produce a confident wrong answer roughly as often as it produces a right one.
4. **Pin every build-time variable across all arms** (`NEXT_PUBLIC_CONCIERGE_URL` above all). A variable that moves alongside the commits survives the method and inverts its conclusion.

**The strongest single call of the day was a refusal, on statistical grounds, to run a proposed "discriminating test":** revert one constant, rebuild, run the spec once. It was declined because against a ~15% intermittent, one sample passes ~85% of the time regardless of the truth, so the test's most likely outcome was a confident false story. A test whose most probable result is a false confirmation is worse than no test. The proposer had attached a careful caution about not letting a green result become the fix, guarding the conclusion while leaving the instrument unexamined. That is the vacuous-check shape, authored inside a discussion about vacuous checks.

**Second-order lesson, from the theory that was abandoned: four verified facts assembled into a wrong causal story still read as evidence.** The manifest and 5 icons genuinely are precached, the SW genuinely does route `frankfurter.dev`, and the cache name genuinely churned three times. All true. All irrelevant, because `api.frankfurter.dev` is never requested on `/map`, measured. The person who flagged the hole in their own theory (*"cache-name churn happens on EVERY build including S357A's, yet that tree passed"*) was the one who made it falsifiable. A named gap beats a tidy story.

**Changes if:** never. This is a measurement habit, not a policy with a trigger.

---

## D-269 · SUPERSEDES D-235's HUE (the one-accent rule survives) · The chrome accent is winter-neon cyan; gold is demoted to a semantic warning colour
_(S353 token/type/motion pass, shipped 2026-07-30; recorded 2026-08-01. This entry records an already-made call, it does not make one. The authority is our own locked wave scope decision #3: *"Full visual overhaul — chosen over the researched 'evolve, your tokens are already good' recommendation"* (the wave plan, the wave plan).)_

**Status: awaiting a one-line confirmation, deliberately not marked LOCKED.** The substance shipped three slices ago and is in production code; only the record was missing. If the cyan chrome is what was intended, confirm D-269 and it becomes LOCKED as-is.

**Decision — as shipped, verified in `nextjs_space/app/globals.css`:**
1. **The single chrome accent is cyan `189 90% 60%`**: `--primary` (`:23`), `--accent` (`:33`), `--ring` (`:44`), `--accent-scroll` (`:123`, mirror `--accent-scroll-rgb: 61, 217, 245` at `:124`). D-235's "one accent for all interactive chrome, route-independent" rule is unchanged and still binding. S353 re-pointed the hue and kept the rule.
2. **Gold is a semantic warning/attention colour only**: `--gold: 38 95% 60%` (`:98`), *"no longer chrome."* The Tailwind `gold-*` scale (`tailwind.config.ts:101-103`) was deliberately left untouched. S353B sorted the 843 gold/sakura/himalaya class sites (cyan = interaction, gold = status, ink = decoration) rather than repainting wholesale, because one config edit would have repainted all 843 at once under a class name carrying two different intents. `gold-400` surviving at ~40 sites is expected and correct: D-256 category (C), "DELIBERATELY GOLD."
3. **`--accent-foreground` stays the darkest surface step** (`220 12% 5%`, `:38`). Cyan is *lighter* than the gold it replaced, so dark-on-accent contrast rises; every `bg-accent` consumer stays ≥AA and D-178's root-token fix survives the hue change (`:34-37`).
4. **D-235's country tints (content wayfinding) and its 17px body rule are untouched and remain LIVE.** This entry supersedes one word of the accent rule and nothing else.

**Why:** we chose the full overhaul over "evolve", and its headline is the field going near-neutral charcoal and the accent going winter-neon. Moving `--primary`/`--accent`/`--ring` while leaving `--accent-scroll` gold would have meant the chrome accent never actually moved. Before S353 all six vars were the identical literal `44 80% 61%`, one accent expressed six times, and `--accent-scroll` is the copy that paints `:focus-visible`, every eyebrow, the tab-bar active tint, the `h2` underline, `--shadow-glow`, today-pulse and the drag overlay (40 sites, vs 5 for `ring-ring`, `globals.css:115-122`). Moved as one unit.

**Recorded because the gap was dangerous, not untidy:** this file is the first thing anyone reads, and for three slices D-235 has told every fresh reader, under a LOCKED banner, to use gold chrome. That is an authority whose whole effect is to stop the next person checking, and unlike the other instances found this round, this one *instructs* rather than merely misleads.

**OPEN — escalated to the owner, no ruling made here. [UPDATED 2026-08-02 by S366: the four entries below are no longer "untouched". Each now carries an in-place header annotation stating that its hues or mechanism are dead. Those annotations state measured fact and are not rulings; the escalation below is still open and still the owner's call.]** Four LOCKED entries still assert the retired identity and are ~~**untouched**~~ **annotated but not withdrawn** by this entry: **D-062** (the engine writing authored gold `240, 199, 96` at every settled endpoint, whose subject file `route-accent-engine.tsx` was deleted at S354, and nothing writes `--accent-scroll` any more), **D-058** (`--accent-scroll` default gold `44 80% 61%`; shadcn `--accent` "sakura"), **D-072** (`every other route → gold 240, 199, 96`), and **D-178's ambient contract** (the `html[data-trip-phase]` contract, stamped by the same deleted component, re-colouring an aurora S354 also deleted). D-058/D-072/D-178's accent *rules* were already retired by D-235; what remains stale is their stated hues and, for D-062 and D-178's ambient contract, their entire mechanism.

**Changes if:** cyan is rejected (revert the five token values; the one-accent rule is independent of the hue and stands either way), or gold is ever wanted back as chrome (that re-opens D-235's rule as well as this entry).

---

## D-270 · impl-note · (R4 repo-wide audit, 2026-08-01) · The swallowed-assertion class was measured and is confined to one file — the house style already runs the other way, on habit alone

**This entry is for the measurement, not the rule.** The rule is one sentence and demonstrably self-propagating; the audit cost three depth-matching detectors, four controls and a mutation pass over 244 test files, and nothing else on record says it was run. Report: the planning notes, with the residual repair written up beside it in the planning notes. Repair committed `9cdc670`.

**Measured, repo-wide, both packages: 0 vulnerable · 13 safe rows · 0 unresolved.** The class is confined to `worker/test/providers.test.ts`; the S362A repairs (`d3056e6`) held, and the detector rediscovered all five pre-repair instances at `d3056e6^` and reports them gone from the current file. The house style runs the other way, enforced by habit alone: 53/53 `page.on(...)` listeners (console/pageerror/request/download) push to an array, 17/17 `page.route(...)` handlers fulfil without asserting, and 12/12 sibling worker fetch mocks (resolve 9, index 2, search 1) return data only. `worker/test/search.test.ts`, written *after* S362A, opens by naming the hazard and uses its own capture helper, with no decision entry, no lint rule and nobody enforcing it.

**"0 vulnerable" is not "no assertion sits inside a swallowing context."** It means every one that does was *observed* to go red under mutation: at audit time 11 assertions across 3 frames, all in `providers.test.ts`, each rescued by a trailing top-level pin. A rescue is not an absence. Delete the rescuer and the frame re-arms silently. This integer was misread by three independent readers before anyone checked it against the report, including in a draft of this entry. The report was never wrong; every reader compressed it in the reassuring direction, which is what summarisation does by default. Verify a headline figure against the artifact, never against a summary of it.

**The rule, once:** callbacks collect; assertions run at test top level after the `await`, on the captured value. Production `try/catch` or `.catch()` catches a thrown `expect()`, scores it as "that attempt missed", and the test passes regardless of whether the assertion held. Reference implementation: the `capture()` helper in `worker/test/providers.test.ts`, with its doc comment directly above it. Deliberately no lint rule, no CI check, no review-checklist item. The convention propagated once already with none of them; the load-bearing artifacts are `capture()` staying discoverable plus the in-place warnings at the two production swallow sites (`nextjs_space/lib/presence.ts`, `nextjs_space/core/storage/gateway.ts`).

**The two residuals were call-count pins, and they failed in opposite ways, which is why an audit could flag one and not the other without being inconsistent.** Both sat beside the real assertion and both read as a second guard. The 20b pin (`toHaveBeenCalledTimes(3)`) was a pure decoy: the 20b is the last leg, so a swallowed miss has nothing to fall through to and the count cannot move. It passed under the very mutation that broke its own test. The 120b pin (`toHaveBeenCalledTimes(2)`) did move, which made it worse than useless: an accidental detector that misnamed every defect it caught. Measured, not reasoned: dropping the `Bearer ` prefix from the Groq auth header surfaced as *"expected vi.fn() to be called 2 times, but got 3"*, a malformed credential reported as a leg-count mismatch. Both are deleted, both deletions are recorded in-file beside where they sat, and both sites now fail at an assertion naming the real problem. The trap that makes this recur: the plausible, reviewer-approving refactor of the assertion a decoy shadows, swapping a wire check for the newer `model` stamp, reads as an improvement and silently re-creates the S362A defect, because `model` is stamped from the ladder's own loop variable and never round-trips the wire.

**The register's prior predicted the opposite, and it was the load-bearing premise.** R4 was called the wave's signature defect class with "unbounded" value, on the reasoning that the pattern was *"very unlikely to have been copied only there."* Sound in general, false here. A finding that closes green after predicting red must say that it predicted red, otherwise the next register writes the same prior.

**If you re-measure, the instrument is the expensive part.** Match brace/paren depth, never a line window. A brace-less single-line arrow (`page.on('pageerror', (e) => errors.push(e))`) opens and closes on one line, and a window-based scan reads every following top-level `expect()` as enclosed. That artifact produced a ~150-candidate false cloud for a parallel run at this same question. And positive-control every empty result: two probes in this audit returned a confident zero because they grepped symbol names that do not exist, and the zero-hit positive control is what exposed both. No line anchors are quoted above, on purpose, because `capture()` moved 11 lines within a day of the audit. Anchor on symbol names.

**Changes if:** a swallowed assertion turns up outside `worker/test/providers.test.ts` (the "confined" finding is falsified, so re-audit rather than trusting these ratios), or the in-code carriers of the rule are deleted (self-propagation stops and enforcement becomes a real question again).

---

## D-271 · impl-note · (S359B `e65b6b2`, recorded 2026-08-02) · The installed PWA no longer carries the map engine — the offline pin-and-route view is gone until you open `/map/` online once, and the basemap was never there at all. Read this header before citing this entry (S366, 2026-08-02): its ruling stands, its blast-radius premise and half its remedy do not

> **The three-way split. Cite the first line; do not cite the second or third without the correction beside it.**
> **① The ruling — stands, unchanged.** maplibre's engine chunks stay out of the precache. ~1008 KiB for a route many users never open, on an atomic install, and an offline map engine with no cached tiles renders a blank canvas anyway. Nothing below weakens this. The S365 notes' "D-271 · STANDS" is a correct citation of this line only.
> **② The blast-radius premise — false, and measured false.** This entry says the failure is *"one pane on one route."* It was every route, and the cause was not maplibre. See the correction inline below.
> **③ The remedy — half valid, half void. Be precise about which half.** The `.catch` half is real: `trip-map.tsx` awaits `import('maplibre-gl')` in an async IIFE with no `.catch`, and that is a genuine, fixable defect. The `error:`-on-`dynamic()` half is void: in the App Router that option is accepted, merged, and never read, so there is no error path in the implementation to hook. See the correction inline below. The fix is a React error boundary (`components/map-island-boundary.tsx`), never a `dynamic()` option.

**Status: not LOCKED. Nobody has seen this trade, let alone signed off on it.** It shipped as a side effect of a perf slice whose stated goal was *"know what actually ships"*. The byte win was intended; this consequence was never written down. This is the kind of call an owner may want to overrule, and the ruling below is neither "keep" nor "revert", because both are wrong.

**In user terms, first.** Someone installs the app, boards a plane, and opens the map having never opened `/map/` while online. Before S359B they got a usable spatial view of their trip (category-coloured pins, the numbered itinerary polyline, clustering, pan/zoom, tappable popups) on a blank field. After S359B that pane fails, because the map engine is no longer on the device. ~~The route still resolves and the rest of the app is untouched: this is one pane on one route.~~ **[CORRECTED 2026-08-02 (S366) — false, and measured false. It was never a pane, and it was never confined to `/map/`.** Evidence: the planning notes. The cause was not maplibre at all. `eagerStaticAssets` scrapes `_next/static/…` strings out of route HTML, and a `dynamic(ssr:false)` island is by construction absent from that HTML, so the root layout's own chrome islands (`app/chrome-islands.tsx`: `Navbar`, `Footer`, `BottomTabBar`, `QuickAddFab`, `QuickAddHost`, `ExpenseLogHost`, `TripJoinHandshake`) were dropped from the precache alongside maplibre's. A root-layout throw is the one crash `app/error.tsx` cannot catch, so a cold-offline install landed on `app/global-error.tsx`: a bare crash card, no navbar, no footer, no hero, on `/`, `/plan/`, `/map/` and a never-precached bogus route alike.
> **The generalising mechanism — this is the durable part, keep it even after the precache is fixed: blast radius is set by where the island is declared, not by how big the island is.** Every `dynamic()` in this app is given a `loading:` and no working error path, so a rejecting chunk throws past the island's own slot to the nearest route-or-app-level boundary. Declared in the root layout → `app/global-error.tsx` → the whole app. Declared in a page's sections → `app/error.tsx` → the whole route, hero included. Neither outcome is "a pane".
> **And it is a delayed reap, not a paint failure.** With the layout warmed, cold-offline `/nepal/` paints correctly (`h1: ["Nepal", …]`) and ~2 s later `app/error.tsx` eats the entire route segment. The SW nav handler is fine and the route *is* served; the island reaps it afterwards. A screenshot at t+0 shows a working page.
> **The class has two sub-modes with different repairs, and writing it as one leaves the second live.** (a) Rejection (measured): the chunk rejects, shell and hero are destroyed. (b) Never-triggered (the `e2e/interaction.spec.ts` "only the hero rendered" symptom): shell and hero survive, slot empty, no error at all, because `components/lazy-visible.tsx` gates mounting behind an `IntersectionObserver` + idle-callback latch that never fires. No error boundary fixes (b). The latch is the thing. Sub-mode (b) is not investigated and not fixed.
> **And the recovery path that looks like it covers this is dead:** `components/chunk-load-error-handler.tsx` listens on `window` `'error'`. React catches the lazy rejection, so it never becomes a window `ErrorEvent` and the handler never fires; `sessionStorage` is empty after the crash. A recovery mechanism that cannot observe the failure it was written for.
> **STATUS:** the root-layout half was repaired by S364 (precache 80 → 94, route bodies restored), and the guard that hid it (`e2e/pwa.spec.ts`'s offline test, which asserted only that an `h1` was visible and non-empty and therefore passed on the crash screen) was repaired in the same slice. The precache lever was the fix. This entry's "it is not a precache change" is the opposite of what shipped.]

**The framing that matters most: the basemap has never worked offline, before or after.** Tiles are `basemaps.cartocdn.com` and glyphs are `demotiles.maplibre.org` (both in `lib/map-style.ts`), and the SW's first routing rule returns every cross-origin request untouched, deliberately, to keep Firebase/gstatic/font hosts out of the SW's hands (D-073/D-038). `api.frankfurter.dev` is the single hand-added exception. No tile and no glyph has ever entered a cache this app controls. **[Historical as of D-319 (issue #8, 2026-08-14): true when written, and the reasoning above still holds for TILES, but glyphs are now self-hosted and precached, so a glyph HAS entered a cache this app controls.]** So S359B did not remove "the offline map". It removed the pin-and-route layer over an empty field, which is real navigational value (relative geography survives without a basemap, and the marker, cluster and itinerary layers are `circle`/`line` types with no external dependency), but it is not a map. Weigh the trade against that, not against a working map.

**The app tells the offline user something untrue, and S359B makes it worse.** `map-section.tsx` renders, on every offline visit, "You're offline — showing cached map tiles." directly beneath a comment asserting *"The SW caches the map tiles"*. It does not, and cannot under the cross-origin rule. The string was already false; it now sits on a pane where the engine that would draw those tiles is absent too.

**The install win is accepted and should stand.** ~1008 KB of maplibre on every device, for a route many users never open, is a poor thing to buy at install time, and the loss is recoverable: the SW's nav backfill (in the `request.mode === 'navigate'` branch) and its static-asset `cacheFirst` handler each write what install missed into the precache on the first successful online fetch. Open `/map/` online once, ever, and the device keeps the engine. The single non-recoverable condition is the whole risk: install, never open `/map/` online, then lose signal. For an app built for Nepal and Japan, that user is not hypothetical, but they are one online visit away from being safe, over a trip planned for months.

**A second argument that does not depend on bytes at all:** the install is atomic. One non-OK fetch throws, the `waitUntil` rejects, the worker never activates and the last good precache keeps serving. 177 → 80 entries removes 97 fetches that can each fail an install across a non-atomic GitHub Pages deploy. That argument survives even if the byte case is rejected.

**What falls out is a class, not a chunk: every `dynamic(ssr:false)` island.** `eagerStaticAssets` scrapes `_next/static/...` references out of route HTML (plus `url()`s in the CSS it finds). A `next/dynamic` island is by construction absent from that HTML, so maplibre is the heaviest instance of the rule rather than a special case; `map-section`, `trip-map` and `plan-day-map` sit on the same footing. This is why "just whitelist the maplibre chunk" is not a fix: the graph is `map-section → trip-map → maplibre`, and precaching the leaf without the islands that import it restores nothing.

**The defect is not the missing megabyte. It is that the failure is undesigned.** `trip-map.tsx`'s init effect awaits `import('maplibre-gl')` inside an async IIFE with no `.catch` *(still true: a real, fixable defect; fix it)*, ~~and `MapSection` is a `dynamic()` with a `loading:` skeleton and **no `error:`**~~ **[CORRECTED 2026-08-02 (S366) — the missing `error:` is not a defect, because `error:` does nothing in this app. Adding it would have closed the row without changing anything.** Verified by reading the control flow in next@15.5.20, not by grepping for identifiers. The option is forwarded correctly and then never consulted: `next/dist/shared/lib/app-dynamic.js` spreads the caller's options through (`{ ...loadableOptions, ...options }`) so `error:` does reach `Loadable()` intact, but `Loadable`'s `defaultOptions` has no `error` key, and its body is `React.lazy` + `Suspense` with no error branch anywhere. `opts.error` is never read. *(The `error: null` visible in `lazy-dynamic/loadable.js` is a prop passed to the loading component, the legacy react-loadable `{error?, isLoading?, pastDelay?, retry?, timedOut?}` signature, not an override of a caller option. Do not cite it as the reason.)*
> **Why the precise reason matters more than the verdict.** "A line hardcodes it" invites the next engineer to believe a different call shape, a prop spread, or a Next upgrade could route around it. There is no error path in the implementation to hook. That is what tells you the repair must be a React error boundary, or `.catch` on the import returning a fallback component, and never an option on `dynamic()`.
> **The signature defect of this project, in its worst form yet.** This is not a check that cannot fail. It is a fix that cannot work: `error: () => <Fallback/>` type-checks, builds green, ships, and does nothing. That is strictly worse than a vacuous check, because the row gets marked DONE and the hazard is thereafter believed handled. Standing rule: no `error:` key on any `dynamic()` call in this app. It is dead configuration that reads as coverage.
> **The shipped fix, and the trap inside it:** a class error boundary, `components/map-island-boundary.tsx` (S365 `6bef10c`), which deliberately re-throws `BAILOUT_TO_CLIENT_SIDE_RENDERING`. An `ssr:false` island throws that sentinel on every server render, so under `output: 'export'` a boundary that swallowed it would bake the fallback into the static HTML, shipping the error state to every visitor as the prerendered page. Any future island boundary in this app must re-throw that sentinel.
> **On method, because this correction had to be made twice:** the first mechanism recorded for this finding was wrong, and it was "verified" with `grep -o "loader\|error\|modules" … | sort | uniq -c` returning `loader 1, modules 2`, read as *"only loader and modules are forwarded."* A spread does not name the keys it forwards, so that grep could not have distinguished the two stories: an instrument with no discriminating power, pointed at a question about absence. When a claim is about what code does *not* do, a grep for identifiers cannot establish it. Read the control flow.]** A cold-offline `/map/` therefore lands on an unhandled rejection or a throwing lazy component, so either an error boundary or a permanently blank pane, and nobody has run it to find out which. That code path could not fail before S359B because the chunk was always present; the slice withdrew a guarantee that had been standing in for absent error handling. ~~Recorded as UNVERIFIED: which of the two it is has not been observed.~~ **[ANSWERED 2026-08-02 (S366) — it was observed, and it was neither of the two options this entry offered.** Not an error boundary in the pane, and not a permanently blank pane. On a cold-offline install it was `app/global-error.tsx`, the root boundary, with the whole document replaced by a crash card. On a warmed-layout profile it was `app/error.tsx` eating the whole route segment ~2 s after a correct paint. The framing of the question was the error: both offered outcomes assumed the failure was contained to the pane, so no answer to it could have surfaced the real defect. A binary "which of these two" recorded as UNVERIFIED is only as good as its option list, and this one had no cell for the outcome that actually happened.]

**~~Ruled — the repair is ~5 lines, and it is not a precache change.~~ [CORRECTED 2026-08-02 (S366) — it was exactly a precache change, and ruling the precache lever out is what kept a ship-blocker filed as a papercut.** The repair that actually fixed it was S364's precache restoration (80 → 94 entries, route bodies back), the one lever this sentence excluded. The exclusion followed directly from the false premise above ("one pane on one route"): if the blast radius really were a single pane, a pane-local fix would indeed have been the whole job. A wrong scope produced a wrong lever, and the ruling read as confident either way. What survives of this paragraph, unchanged and still worth doing: "catch the failed import" is real, and `trip-map.tsx`'s un-`.catch`ed `await import('maplibre-gl')` is still the right target; "replace 'showing cached map tiles' with a sentence that is true" is real, and still unshipped (see the trigger list at the end of this entry). What does not survive is the `error:`-on-`dynamic()` mechanism, corrected in the undesigned-failure paragraph above.]** Catch the failed import, render the existing offline slot, and replace "showing cached map tiles" with a sentence that is true. That is strictly cheaper than precaching the island graph and it fixes a lie the precache change did not create. Precaching maplibre "to be safe" costs ~1 MB on every install, does not work without also precaching the islands, and leaves the false string in place. It is the worse of the two repairs.

**OPEN — escalated to the owner, no ruling made here.** Two things this finding should actually put to the owner. **(1)** If the offline pin-and-route view matters, the cheap fix is not precaching. It is prefetching the map island in the background on any online visit to any route, which keeps the install small, adds nothing to the atomic set, and closes the exact gap (the failure condition is "never had the chunk while online", and the app is online plenty before the trip). **(2)** A genuinely usable offline map, one with a basemap, is delivered by neither keeping nor reverting S359B. It needs same-origin tiles the SW is permitted to cache (a bundled PMTiles/MBTiles extract for Kathmandu and the Japan cities, or a same-origin proxy): a real feature with a byte budget and a free-tools constraint, not a cache-config tweak.

**On the plan's fence — checked, not violated.** The wave plan (the wave plan) has an S359 section that fences *"the maplibre interaction-lazy boundary"*, i.e. D-047's: maplibre stays out of the shared/eager bundle and loads only when a user opens a map (`showMap` defaults `false` on `/plan`; `/map` mounts the island on visit). S359B touches no import, no `dynamic()` gate and no First Load JS, only which built files the installer copies. But the fence did not check this either: it guards a bundle axis, and S359B moved an availability axis it never named. "We respected the fence" and "the fence covered this" are different sentences; only the first is true.

**The slice correctly exceeded its own instruction.** The plan said restrict the precache to the app shell plus `/`'s own chunks; S359B precaches every route's eager chunks. Followed literally, the plan's recipe would have shipped a worse bug: index.html-only scraping was measured to fail `e2e/pwa-torn-update.spec.ts` 6 runs out of 8, passing only when a `<Link>` prefetch happened to win a race. The reasoning is recorded in `gen-sw.mjs` beside `eagerStaticAssets`.

**~~Unverified, and worth one check by whoever touches this next:~~ [CLOSED 2026-08-02 (S366) — the check was run and the answer is no. Do not spend the check again.** `maplibre-gl@5.24.0`, all six shipped `dist/*.js` bundles: zero occurrences of `caches`. The only three hits anywhere in the package are English prose inside `-dev` bundle comments. Positive-controlled: the same grep for `function` returns 1191 hits in the same file, so the instrument can find things and the zero is real. maplibre keeps no Cache API tile store, so the SW's `activate` sweep destroys nothing of maplibre's. The struck paragraph below is kept for its reasoning only; its instruction is spent.]** the SW's `activate` handler deletes every cache key not in `[PRECACHE, IMAGES_CACHE, FRANKFURTER_CACHE]`. If maplibre-gl 5.24 keeps its own Cache API tile store (mapbox-gl's tile-request-cache lineage does), this app destroys it on every SW activation, i.e. every build update. Not confirmed; do not act on it without checking the installed package.

**Changes if:** offline tiles or a same-origin tile proxy land (the map becomes genuinely offline-capable, so re-argue this whole trade from scratch, and the island graph probably *should* be precached); or the cold-offline `/map/` failure is observed and takes down the route rather than the pane (the availability cost is higher than recorded, so fix the handling, then re-decide); or the owner rules that the map must work on the plane (this reverses, and OPEN item (1) becomes the work); or `eagerStaticAssets` is ever extended to follow `dynamic()` chunks (the class described here dissolves, and the atomic-install argument shrinks with it).

**Still open as of 2026-08-02 (S366) — the one item in this entry that nothing has repaired.** `components/map-section.tsx` still renders "You're offline — showing cached map tiles." directly beneath a comment asserting "The SW caches the map tiles". Both are false and cannot become true under the SW's cross-origin passthrough rule (tiles are `basemaps.cartocdn.com`, glyphs are `demotiles.maplibre.org`, both in `lib/map-style.ts`; the SW's first routing rule returns every cross-origin request untouched by design, per D-073/D-038, with `api.frankfurter.dev` the single hand-added exception). This string predates S359B, survived S364 and survived S365. It is a user-facing false statement, it is two lines, and it has now outlived three slices that each touched the file next to it.

---

## D-274 · (S359B's unstated consequence, drained from the running notes by S366 2026-08-02) · The map is the one route the installed PWA does not guarantee offline — stated as a trade, because it shipped as a side effect

**Status: not LOCKED. This is a behaviour change that shipped without ever being written down as one, and nobody has ruled on it.** It was flagged inside a perf write-up, recorded in the running notes as *"queued for a decision entry and the owner's awareness"*, and no artifact drained it for two days. "Intended trade, never stated" is how a regression gets discovered by a user instead of by a ledger. That is the whole reason this entry exists, not any new ruling.

**In user terms, first.** Someone installs the app, boards a plane, and opens `/map/` having never opened it while online. The route resolves, the shell renders, the rest of the app is untouched, and the map pane degrades, because maplibre's ~1008 KiB engine is deliberately not on the device. Every other route works fully offline. This is the trade, stated plainly: the app's offline guarantee covers every route except the map pane, and only on that one profile.

**Decision:** accept it, and stop calling it a side effect. maplibre stays out of the precache (D-271 ①, unchanged). The loss is recoverable: the SW's nav backfill and its static-asset `cacheFirst` handler each write what install missed into the precache on the first successful online fetch, so opening `/map/` online once, ever, keeps the engine on the device permanently. The single non-recoverable condition is the whole risk: install → never open `/map/` online → lose signal.

**Why the trade is defensible:**
1. **The basemap has never worked offline, before or after. Weigh the trade against that, not against a working map.** Tiles and glyphs are cross-origin and the SW returns every cross-origin request untouched by design. No tile and no glyph has ever entered a cache this app controls. **[Historical as of D-319 (issue #8, 2026-08-14): true when written, and the reasoning above still holds for TILES, but glyphs are now self-hosted and precached, so a glyph HAS entered a cache this app controls.]** What is lost on the cold profile is the pin-and-route layer over an empty field: real navigational value, since relative geography survives without a basemap, but it is not a map.
2. **The install is atomic.** One non-OK fetch throws, the `waitUntil` rejects, the worker never activates. Carrying maplibre's chunks re-adds fetches that can each fail an install across a non-atomic GitHub Pages deploy. This argument survives even if the byte case is rejected.
3. ~1008 KiB on every device, for a route many users never open, is a poor thing to buy at install time.

**The honest counter-argument, recorded because it is the owner's call and not mine.** The shipped landing copy promises "Works on the plane… No signal needed." For an app built for Nepal and Japan, the user who installs at home and opens the map for the first time in the air is not hypothetical. They are the archetype. This entry accepts a trade that the product's own marketing copy contradicts. Either the trade is right and the copy needs a qualifier, or the copy is right and the trade is wrong. Both cannot stand, and that is the open question.

**Named upgrade path, not taken (and it is not precaching):** prefetch the map island in the background on any online visit to any route. The failure condition is precisely "never had the chunk while online", and the app is online plenty in the months before the trip. This keeps the install small, adds nothing to the atomic set, and closes the exact gap. It is strictly better than precaching and was never costed.

**What this entry does not cover.** A genuinely usable offline map, one with a basemap, is delivered by neither keeping nor reverting this trade. It needs same-origin tiles the SW is permitted to cache (a bundled PMTiles/MBTiles extract for Kathmandu and the Japan cities, or a same-origin proxy). That is a real feature with a byte budget and a free-tools constraint, not a cache-config tweak.

**Binding on whoever implements or touches the degraded pane: the degradation must be rendered, and there is exactly one mechanism that works.** The fallback is a React class error boundary that re-throws `BAILOUT_TO_CLIENT_SIDE_RENDERING` (`components/map-island-boundary.tsx`). The re-throw is load-bearing: an `ssr:false` island throws that sentinel on every server render, and under `output: 'export'` a boundary that swallowed it would bake the fallback into the static HTML for every visitor. An `error:` key on `dynamic()` is dead configuration in the App Router: forwarded, then never read, because `Loadable` is `React.lazy` + `Suspense` with no error branch. It type-checks, builds green, ships, and does nothing. See D-271 ③. A degraded pane implemented with `error:` will look done and will not be.

**Changes if:** the owner rules the map must work on the plane (→ the prefetch upgrade path becomes the work, *not* a precache change); or same-origin tiles land (→ re-argue this whole trade from scratch, and the island graph probably *should* be precached); or the degraded pane is ever observed taking down the route rather than the pane (→ the availability cost is higher than recorded; fix the handling, then re-decide).

_[Numbered **D-274**, not the patch's proposed D-272: `D-272` and `D-273` were claimed by `1ff5f57` from another session while this patch was being authored, the exact append-only collision the patch warned about, caught by grepping `^## D-27` on the merge tree before applying.]_

## D-272 · LOCKED · (decided 2026-08-02 after a parallel technical and planning consult; no slice yet) · Concierge clash detection is **WARN-shaped, never DROP-shaped**, and its duration default is **imported from `DEFAULT_NOW_BLOCK_MIN`, not declared anew**

**The notes that proposed this work framed it as wiring `clashingItemIds` into `validateOps`, i.e. a 9th drop-rule. That framing is rejected, and the reason is a regression it would have caused rather than a preference.** The app's own clash semantics are already shipped and they are warn-only, in two places: `docs/test-ids.md` documents `calendar-item-clash-<id>` as a badge that "never blocks save/drag" and `timeline-item-clash-<id>` as one that "never blocks anything (no modal, no disabled state)." A validator that dropped a clashing op would make the concierge stricter than the hand editor: a user could add an overlapping lunch by dragging it, but not by asking for it. That is a regression against the non-regression fence (*"editing plans, adding plans, removing plans… should still work if not better"*), produced by the fix written to serve that fence.

**And warn-shaping makes the fence risk zero by construction, which no amount of testing achieves: no op that survives validation today is dropped tomorrow.** The change is additive, a suffix on the proposal chip and a token in the digest. `validateOps`' 8 rules are untouched.

**The default is `DEFAULT_NOW_BLOCK_MIN` (120), imported from `lib/travel-hero.ts`. Not a new constant, and not a silent one.** It is the app's one shipped answer to *"how long does an open-ended item occupy?"*; a second number would let the travel hero and the concierge disagree about the same item while both look right. The digest sentence that teaches the model the rule must interpolate the same symbol, so copy and code cannot drift apart.

**The projection applies only in the concierge path.** Defaulting inside `clashingItemIds` itself would paint warn badges across the entire seed calendar. Measured 2026-08-02: `durationMinutes` occurs 0 times in `core/content/itinerary.ts` against a `time:` positive control of 158. Every seeded item is duration-absent, so a defaulting checker would mark the shipped itinerary as one long conflict. That is the visible regression hiding behind "just wire it up."

**Changes if:** the app's own clash badges become blocking (then the concierge should match them, and this inverts); or seed data gains real durations (the projection stops being load-bearing, though the default still governs user-added open-ended items).

## D-273 · LOCKED · (decided 2026-08-02, same consult) · The concierge eval harness is the **gate for model-shape changes**, not a prerequisite for machinery changes — it goes **last** of Tier 1

**The notes promoted the harness to Tier 1 on the argument that the non-regression fence is *"unfalsifiable without it."* That claim is true in a narrower sense than it reads, which is this repo's signature defect appearing in the doc that catalogues it.** The fence has two halves. The machinery half is already falsified-on-break: `nextjs_space/lib/__tests__/concierge-ops.test.ts` exercises all 8 `validateOps` rules by name (9 `it('Rule` cases, rule 6 twice), alongside `applyOp`/undo and drop-count coverage. What is genuinely unfalsifiable is model behaviour, and only that.

**Two costs decide the ordering.** A harness that means anything must call the live ladder, which spends roughly a full day of the derived ~40-turn TPD budget per run (Groq free is 200,000 TPD against a ~5,000-token prompt, a *derived* figure, still owed a real `x-ratelimit-*` reading). And it re-baselines after every digest change. So building it before the Tier-1 digest changes means paying for it twice and throwing the first baseline away.

**Ruled: build it after the clash pair, the date line and reason codes; build it before any change to model shape** (the two-call split, any provider swap, any prompt restructuring). That is the point at which it is the cheapest instrument available rather than the most expensive one.

**A frozen-output harness is not a substitute and must not be built as one.** Recording expected model outputs and diffing against them produces a suite that stays green with the model never called: mechanism 6, on the one instrument bought to detect it.

**Changes if:** a measured `x-ratelimit-*` reading shows the TPD ceiling is far higher than derived (the per-run cost argument weakens); or a free provider with a genuinely unmetered evaluation path enters the ladder.

## D-275 · LOCKED · (S369 `09dc1b9`, 2026-08-02) · Disabling a provider leg means **deleting its env binding**, not un-listing it — a leg that reads a secret **self-arms**

**The generalisation of D-262, learned twice now.** `tryGemini` had no key guard: it interpolated `env.GEMINI_API_KEY` straight into the request URL and called `fetch` unconditionally, so the full trip digest and the user's messages left the edge even when the key was absent. A missing key bought an HTTP rejection, not a skipped request. A leg in that shape cannot be disabled by a decision, a config value, or an unset secret. Only deleting the code disables it. This is the identical mechanism D-262 records for the Tavily search leg, which self-arms on `TAVILY_API_KEY` and therefore requires `wrangler secret delete` as an action rather than an omission.

**The acceptance test, and it is the durable part: re-arming the leg must require a code change, not a provisioned secret.** S369 satisfies it. `GEMINI_API_KEY` no longer appears in either `Env` interface, in `.dev.vars.example`, in `wrangler.toml`'s comment, or in `README.md` (which carried a literal `npx wrangler secret put GEMINI_API_KEY`: an instruction to re-arm by secret, in the documentation). A repo-wide grep across `worker/` returns nothing.

**This supersedes a standing claim in the D-004-exception entry above** (the `worker/` relay decision), which states *"All provider secrets (`GEMINI_API_KEY`, `GROQ_API_KEY`) are Worker secret bindings … read only inside `src/providers.ts`."* `GEMINI_API_KEY` is no longer a binding and no longer read anywhere. The rest of that entry stands.

**Enforced, not merely asserted:** `worker/test/providers.test.ts` pins `urls[0]` positionally to the Groq endpoint, asserts the removed host absent, and pins the call count, so a leg re-inserted ahead of Groq fails the suite. A count alone would not have caught that, which is why the positional assertion is the one that matters.

**The credential itself is a separate, still-open owner action.** A real `GEMINI_API_KEY` was pushed to the live Worker in July. It is inert against this code, but it remains a live Google credential until `wrangler secret delete GEMINI_API_KEY` runs *and* it is revoked at Google. Code removal is not credential revocation; see the deploy preconditions in `docs/RELEASES.md`.

**Changes if:** a future leg is added that genuinely must gate on a secret at runtime (then it needs an explicit early return on an absent key, and that guard needs a test proving no request is made, the thing `tryGemini` never had).

---

## D-276 · impl-note · (S369, found in a second pass, recorded 2026-08-02) · Reconcile a pattern-based check against an independent instrument — never against a second copy of the same expression

**Decision:** where a check's detector and its remedy are the same expression (scrubbers, linters, codemods, marker gates), a clean result is only evidence if it has been reconciled against a separately-authored pattern set, ideally run through a different engine. The script's own green does not count as verification of the script.

**Why, and it is measured rather than argued.** `scripts/sync-mirror.mjs`'s `slice` rule used `(?!\s*\()`. It spared `the slice()`, the JS method, exactly as designed, and it also spared every `slice (…)` in prose. Five real marker lines survived a run the gate reported CLEAN. The script could not have revealed this at any verbosity setting, because the checker and the checked carried the identical lookahead. It surfaced only under a separately-authored pattern set run through ripgrep rather than JS `RegExp`.

**The generalisation: when a fix and its verification derive from the same expression, a green result carries no information about the class that expression is blind to.** The independent instrument is not redundancy. It is the only thing with discriminating power over the author's own blind spot.

**And the shape is worth naming, because this file has now recorded it four times in one day in four different costumes: the defect appeared inside the repair for the defect.** S369 existed to fix a marker gate that could not see what it claimed to check (`S\d{1,3}\b` cannot match `S357B`, because the `\b` falls between two word characters, hiding 74 lines across 28 files, 64 of them added by the very wave that shipped the gate). Its own first patch then reproduced the same class one level up. A repair is not exempt from the defect it repairs.

**Scope limit, stated so this does not become a ritual nobody can afford.** This does not mean every check needs a second implementation. It applies where the pattern *is* the fix. A behavioural test that exercises real code through a real interface already has an independent instrument: the code. The rule is for detectors that are themselves regexes, AST queries or config predicates, where "does it work" and "does it match" are the same question asked twice.

**How to satisfy it cheaply:** run the two instruments, report both counts, and explain every difference. S369's reconciliation is the model: script 7 → 0 against independent 176 → 3, with all three residuals explained (`re-slices` prose, `slice()` the method, and the deliberate `footer.tsx` site credit, which is a named exception carrying a self-test asserting any *other* occurrence still fails). Agreement is not required; an unexplained difference is what fails the gate.

**Related:** a self-validating gate proving only what it already models is the same family as an `h1`-visibility assertion that the crash screen satisfies, and as a headline "0 VULNERABLE" that means *none observed red* rather than *none exist*. Consolidate patterns into one shared source (S369's `ID_FAMILIES`) so three copies cannot drift apart again, but note that consolidation makes this rule more necessary, not less: one shared expression means one shared blind spot.

**Changes if:** a check's detector is ever genuinely separable from its remedy (then the remedy's own tests are the independent instrument and a second pattern set is waste); or a linting layer with its own conformance suite replaces the hand-rolled patterns (then that suite is the second instrument, provided it was not authored from the same regexes).

**Measured coda (a repo-wide sweep after the repair), and it says the opposite of what we both predicted.** Raw 13 hits for stray one-off `D-\d{3}` / `S\d{1,3}`; real: 3, all in `sync-mirror.mjs`'s `PROSE_REWRITES` (targeted line-rewrites at the `Testids per D-###` and two `Vault read boundary` clauses). All three are suffix-blind: a comment saying `D-135a` slips past every one.

**But they are fail-safe, and that is the finding.** The stripper and the gate are now different mechanisms with different blindness. If a `PROSE_REWRITE` misses `D-135a`, the text survives into the mirror, and the gate's `decision-id` family (`D-\d{3}[a-z]?`) catches it and turns the run red. The failure mode is a red gate a human fixes, not a silent leak. That is precisely the property the old scrubber lacked: stripper and gate shared `S\d{1,3}`, so one blind spot held in common meant what the stripper missed the gate could not see either. This sweep is a live demonstration that the repair broke the shared blindness rather than merely widening one pattern, which is the whole point of this entry.

**The caveat that keeps it honest, and it is the only thing protecting the above: this holds only while the gate is strictly wider than every stripper. Nothing enforces that today; it is true by inspection, not by construction.** A future narrowing of `ID_FAMILIES`, or any stripper widened past it, silently restores shared blindness and no test would notice. Filed as its own row.

**And of the 13 raw hits, 10 were prose describing the bug.** The running notes read *"Strip and gate both use `S\d{1,3}`…"*, `sync-mirror.mjs`'s own repair comment quotes the old pattern, and the audit reports quote it again. The sweep matched its own documentation. That is the third instance in one day of an instrument measuring its own text, after a self-falsifying `grep -c "S359B"` and a `D-[0-9]{3}` collision-check that manufactured three phantom duplicates by truncating `D-053 addendum` / `D-255a`. When a pattern is also the subject of prose, its raw count is not a finding until the prose is excluded.

**One fossil, not a leak, worth deleting:** a leftover worktree under the worktrees directory still holds its own `scripts/sync-mirror.mjs`, the pre-repair scrubber, old `['slice-ref', /\bS\d{1,3}\b/g]` intact. It ships nowhere, but someone grepping *"how does the scrubber work"* can find the broken one.
---

## D-277 · (S376 Lane A / A0, proposed 2026-08-05) · Implements D-239's own `Changes if` ("account-level identity ever syncs") · The display name is an attribute of the account, in its own `profile/identity` doc, written and adopted only from pages that do not navigate, so the S375 shape is unreachable rather than mitigated

**The condition D-239 pre-declared has fired.** D-239's `Changes if` names this exact case:
*"account-level identity ever syncs (nickname-per-account would need a profile field — **new
decision**)"*. A live reported defect root-causes to it: the display name reverts to "Traveler" on any
device without this browser's localStorage. It was reported from private mode deliberately, to test
the sync path. The cause is that the name is device-local only. `signIn()` writes two localStorage
slots and nothing else, the door hard-codes `stored || 'Traveler'` under a comment stating the design
outright (*"The door no longer collects a name"*), and no account-scoped document anywhere carries a
person's name: the account doc is `{version, trips, removed}`. Nothing reads a remote name because
nothing writes one. This is not the S375 write-dies-in-flight race. The rename handler issues zero
network calls and does not navigate, so there is no write to kill. That is why it needed a decision
and not a bug fix.

**Section 1: Shape.** One new document `trips/{userToken}/profile/identity` =
**`{ version: 1, name: string }`**. Owned by `lib/trips-remote.ts`, which already owns the only other
document in that subtree (`profile/tripList`) and whose module header already reserves `profile` for
this. Two new functions mirroring `pushTripMeta`/`fetchTripMeta` verbatim: best-effort, total, never
rejecting, `console.warn` on failure. Read sanitiser: non-string/blank gives `undefined`, else
`trim().slice(0, 24)`, the cap `RenameIdentity`'s input already enforces. **No timestamp field:**
nothing reads one under section 3, and it would invite client-clock LWW (the hazard D-228 bounds).

**Why not a `name` field on the existing `profile/tripList`.** This is the load-bearing rejection.
`pushTripList` writes with a bare `setDoc` and no `{merge:true}`, a full-document overwrite (verified
at source; `merge: true` does appear in `lib/presence.ts`'s heartbeat write, so its absence there is a
measurement, not a broken grep). A `name` on that doc has two independent deleters: (1) any client on
an older cached bundle, and this app precaches its own bundle in a service worker, so a stale client
is a routine state here rather than a hypothesis; (2) `subscribeTripList` itself, which re-pushes on a
present snapshot with local extras and seeds on an absent one, both through that same bare `setDoc`.
The symptom of either deletion is the defect being fixed, returning intermittently. That is strictly
worse than the defect, because it stops being reproducible on demand. Carrying the field forward by
spreading the pre-read snapshot would rely on a spread forwarding a key it does not name (a shape that
has burned this repo before) and still would not reach deleter 1. Cost did not decide this: the
tripList option costs zero extra reads and the separate doc costs one per page load. Both are
negligible on Spark. Correctness decided it.

**Section 2: Write path.** The contract is structural rather than a discipline: no identity write is
ever issued from a code path that navigates. Exactly two writers, both on pages that stay put. **(a)**
The Settings rename (`RenameIdentity`'s submit in `components/settings-panel.tsx`): `signIn(trimmed)`
as today, then a best-effort publish. Fire-and-forget is correct here for the reason
`lib/trips-remote.ts`'s header already gives for `saveRename` (the page does not unload). **(b)** The
backfill inside the section 3 reconciler, which also does not navigate. Explicitly not writers:
`token-gate.tsx`'s `handleLogin` and `handleCreate` (both reach `finish()` → `window.location.replace`)
and `settings-panel.tsx`'s `createTrip()` (→ `window.location.reload()`). Two things follow, and both
are the point. **(i)** The S375 failure mode is unreachable rather than mitigated: no `settleWithin`,
no budget constant, no timeout branch. That matters concretely, because S375's own 5 s fallback is
recorded as unexercised even at 400 kbit/s + 300 ms RTT, and adding a second such branch would add a
second unfalsifiable path. **(ii)** The door stays firebase-free, which D-239 requires verbatim and
which is **LOCKED**: *"Front door v3 (`token-gate.tsx`, wall always-on per D-054, **firebase-free in ALL
builds — no push/lookup at the door**…)"*. An account's chosen name still reaches Firestore promptly,
on the very next page load, via (b), with nothing pending.
**Rejected: the outbox.** `core/sync/outbox.ts`'s `SyncDomain` is a closed four-member union driven by
a `ChunkSync` decorator over a reactive store's `commit()`, needing a `chunkDiff` and a merge-aware
`pushChunk`. A scalar has no chunk diff; wiring it in means a fifth domain plus a synthetic store for
one string. The reconciler re-running every page load is the cheaper equivalent of a retry queue,
and it is a pattern `itinerary-provider.tsx` already contains twice.

**Section 3: Read path and precedence.** A one-shot `getDoc` on provider mount in
`components/itinerary-provider.tsx`, beside `runTripMetaSelfHeal` and `createSyncCodeTripListSync`,
with the same gates (`isRemoteConfigured()` ∧ `getSyncCode()` ∧ `getActiveTraveler()`), the same lazy
`import('@/lib/trips-remote')`, and the same cancellation shape. Not a subscribe: nobody asked for a
name to change live on a second device mid-session. Ordered rule:
1. **remote present ∧ ≠ local ⇒ adopt via `signIn(remoteName)`.** It must be `signIn` and never a bare
   `setUserName`. `getActiveTraveler()` reads the token slot while `lib/attribution.ts` stamps from
   `getUserName()`, the name slot, and they agree only because `signIn` writes both. Writing one
   slot alone makes the app display one name and stamp another. This is the easiest way to break the fix.
2. **remote absent ∧ local is not the placeholder ⇒ backfill** (publish local). This is the migration,
   section 4.
3. **remote absent ∧ local is the placeholder ⇒ do nothing.** Never publish `'Traveler'`.

**Conflict case, ruled explicitly.** Device holds "Sora", remote says "Powan": remote wins, and the UI
shows Powan. The account is the source of truth for the account's name; a device-local disagreement is
either stale (renamed elsewhere since) or the login default.
And note why a naive "local wins if set" would be a vacuous fix: `handleLogin` always writes a name
into the local slot before the reload (`signIn(stored || 'Traveler')`), so the local slot is never empty
by the time anything reads it. Any "prefer local if present" rule preserves the defect exactly while
looking like a fix.
**Accepted ceiling, stated not hidden:** an offline rename whose publish failed reverts on the next
load, and it will not silently recover, because `getRemote()` calls plain `getFirestore(app)` with no
offline persistence configured, so a `setDoc` issued offline does not survive a reload. **Upgrade path
if it bites:** a persisted "last published name" marker, giving *"remote wins unless the local name is
unpublished"*. Not built now: it costs a gateway key (D-097 registration plus the sign-out wipe
inventory) and a success-conditioned write, to protect a rare act that self-corrects by renaming again.
**Cold case (hotel wifi):** yes, the local name paints first and swaps when the read lands. Accepted,
because it is self-limiting. The adopt writes through to localStorage via `signIn`, so the flash
happens at most once per device, on the first load after a fresh login, exactly the moment the user
already expects to be new. No skeleton, no gate on first paint. Named residual: an item created inside
that window is stamped with the pre-adopt name, and section 5 means that stamp is permanent.
**Sign-out safety: D-240's bug class in a new costume.** The read is one-shot, so it has nothing to
tear down and is deliberately not wired to `identity:changed`. But its `.then` has to re-check that
the account and traveler are unchanged and that the effect has not been cleaned up before calling
`signIn`. A late resolve landing after `signOut()` would resurrect a signed-out session. Same
`cancelled` shape as `runTripMetaSelfHeal`.
**The nudge becomes conditional in the same slice.** `consumeNameHint` toasts *"You're signed in as
Traveler — rename yourself in Settings"* from its own mount effect, which fires before the read
lands. Post-fix it would tell a user their name is Traveler moments before it becomes Powan. It fires
only on branch 3. Full retirement is a separate product call.

**Section 4: Migration.** Existing accounts have no identity doc. The first read returns `undefined`
(total, never throws) and branch 2 backfills the device's current name once, on the first load after
the fix. The hazard branch 3 exists to close is not theoretical: two devices, no doc yet, and
whichever loads first wins. A device that had already defaulted to "Traveler" would publish "Traveler"
to the account, and the other device would then adopt it. The migration would re-create the very
defect it migrates away from, and make it sticky. Cost of the corner cut: a user who genuinely
*renames* to "Traveler" is never backfilled by inference. A rename still publishes, though, because
intent is the discriminator (the backfill infers; the rename is told). The literal must become one
exported constant shared by the door and the reconciler, or the two copies drift.

**Section 5: Attribution is immutable (the cross-lane ruling).** `createdBy` / `updatedBy` / `doneBy`
are historical facts and are never rewritten: not by a rename, not by this reconciler, not by a
backfill. Display-name resolution, where wanted, happens at read time in the view layer. Reasons,
decisive in order: (1) "Traveler" is a merged identity, since every fresh-device login defaults to it,
so those stamps may belong to several different humans, and rewriting them would attribute other
people's edits to whoever renames first (this alone settles it); (2) a rewrite is a mass mutation of
every item in every trip pushed from one device through the D-106 per-item HLC merge, colliding with
peers' concurrent edits; (3) it is already the house position, D-230: *"two additive **immutable**
fields `doneBy?`/`doneAt?` … NOT `updatedBy` (which every edit overwrites)"*.
**Consequences for the filter lane (INTAKE-07), so it is not surprised:** `distinctAuthors` derives its
options from stamp strings rather than a roster, so "Traveler" is a legitimate chip and one human
legitimately appears as two chips after a rename. That is not a filter bug and must not be "fixed" by
mutating data. The sharper half, which a user will notice: `"My edits"` resolves against the live
name, so after a rename it stops matching your own older items. If that is fixed, the shape is a
read-time alias set (a device-local list of names this device has signed in as, matched in
`itemMatchesAuthor`'s `mine` branch): non-destructive, no schema change, no sync, separate slice.
Whether the shared "Traveler" may be claimed as "mine" is still an open call, and the safe default is no.
Live seam this decision creates for that lane: `hooks/use-author-filter.ts` refreshes `myName` on
`ITINERARY_CHANGED_EVENT` and `storage` but not on `IDENTITY_CHANGED_EVENT`, so after an adopt or a
rename the filter keeps the old name until an unrelated itinerary edit fires. One listener.

**Section 6: The test that pins the defect is not obsoleted, and that is the trap.**
`lib/__tests__/s346-audit.test.ts`'s *"a token-only login with NO stored name sets the name-hint flag
(real handleLogin)"* asserts `getUserName()` is `'Traveler'`. The door is unchanged by this decision,
because the account layer corrects the name *after* the reload, on a different surface. So the
assertion stays literally true and the suite stays green while describing behaviour the product no
longer has. Required: re-scope it deliberately. Rename it to say it pins the door's local placeholder,
and comment that the placeholder is transient, with the end-to-end guarantee living in the new
reconciler test. Its sibling `consumeNameHint` cases need a branch-3 case. Do not contort the door
to satisfy a new assertion there: the door is deliberately not where this is fixed, and forcing a name
lookup into it violates D-239's LOCKED firebase-free clause.
**Amended 2026-08-30 by D-486: the last two sentences no longer govern.** D-296 (2026-08-10) already
put a lazy read of `profile/identity` inside `handleLogin` and narrowed the firebase-free clause to
*statically* firebase-free, so the door now takes the name off that same read. The rest of this
section — re-scoping the assertion rather than deleting it — still stands.

**Section 7: No rules change, no owner action, stays on Spark.** Verified at source:
`firestore.rules`'s `match /trips/{tripId}` → `match /{sub}/{document=**}` recursive wildcard already
covers `trips/{userToken}/profile/identity`, and `boundedWrite()`'s `request.resource.data.size() <= 32`
plus its four container caps pass trivially for a 2-field document carrying none of
`items`/`trips`/`removed`/`fields` (each `len()` reads 0 via `get(field, [])`). No rules edit, no
`firebase deploy`, no Worker change, no owner action. Free-tier: +1 doc per account (~100 bytes), +1
document read per page load per device, +1 write per rename, +1 backfill write per account lifetime,
well under 1% of Spark's 50K reads/20K writes per day for a private friend-group site. Never Blaze,
never billing.
**Never-mix residual (D-239):** a Trip Token pasted at login would create
`trips/{tripToken}/profile/identity`. D-239 already accepts exactly this stray for `profile/tripList`
(*"reserved subcollection, self-inflicted, recoverable"*) and the new doc rides the same accepted
residual, narrower still, since branch 3 means a mis-paste that never renames writes nothing at all.
No leak in the normal flow: the User Token is never shared, and nothing under a shared Trip Token
ever carries the account name.

**Why:** login is token-only by the signed-off amendment of 2026-07-30, so the door cannot ask for a
name and the account must therefore remember it. Making the name an account attribute is the only fix
that survives to a *third* device; re-adding a name field to the login form is a symptom fix that also
overturns that amendment. The separate document is chosen over the cheaper shared field because the
shared field's failure mode is the original defect returning intermittently. Both the write and the read
are placed on non-navigating surfaces so the S375 class is closed by construction rather than by a
timeout nobody can exercise.

**Changes if:** a real backend/auth arrives (D-205's zero-backend premise); the display name ever needs
to be authoritative rather than display-only (that needs a server, not a document); the section 3
offline-rename ceiling actually bites a user (then build the persisted last-published marker); or a
second account-level scalar is wanted (then this doc grows fields rather than spawning documents, and
the moment it has two writers, section 1's clobber analysis must be redone from scratch).

Nothing here amends a LOCKED entry. D-239's login-token-only amendment stands untouched (the door
still does not collect a name); D-239/D-054's firebase-free door is honoured structurally; D-241 (no
guest mode) is untouched; D-248 (sync ON in production) is what makes this possible at all.


## D-278 · (S376 Lane B, proposed 2026-08-05, on the B1 ruling) · Implements D-012's `Changes if` · Every itinerary item gets a map position from a **five-rung precedence ladder resolved at read time**; `location` stays optional and a derived position is **never written to `lat`/`lng`**

**The ruling, settled and not re-litigated here:** location is optional with a derived fallback. An
item with no real coordinate is placed from the text it already carries, so it still appears on the map.
No migration, no required-on-create, no existing data breaks. This entry decides only the *mechanism*.

**Section 1: No schema change is needed for the coordinate.** `ItineraryItem` (`lib/trip-data.ts`)
already carries `lat?`/`lng?`, added by S137 under this exact clause of D-012. Its own docblock states
the contract: *"Absent = un-pinned … When BOTH are defined the item plots at these exact WGS84 coords
instead — a pin always beats a fuzzy name match"*, *"rides rev/hlc for free like every other field
here"*. `stopMarkerFor` (`lib/itinerary-map.ts`) already branches on it. D-012, D-018, D-135 and D-149
are untouched by this entry: no field is added, no field becomes required, no stored data is rewritten,
no `mergeItems` key changes.

**Section 2: The ladder.** One pure function, `resolvePlacement(item, day) → Placement`, is the single
answer to "where does this item sit on the map". Precedence, highest first:

| # | Rung | Source | Result |
|---|---|---|---|
| 1 | **Explicit pin** | `item.lat` **and** `item.lng` both numbers | `exact`, `via:'pin'` |
| 2 | **Source join** | `item.sourceId` ∈ `MARKER_BY_ID` (the 27 curated markers) | `exact`, `via:'source'` |
| 3 | **Name join** | full curated marker name appears in `title`/`location` | `exact`, `via:'name'` |
| 4 | **Area join** | normalised `item.location` matches a curated marker's `area` string | **`approximate`**, `via:'area'` |
| 5 | **Day city** | `CITY_COORDS[day.city]` | **`approximate`**, `via:'city'` |
| — | none | city unknown (custom trips only) | `none` |

Rung 3 assumes the in-flight fix to `NAME_INDEX`'s place-type strip has landed. The strip turns
`"Osaka Castle"` into the key `"osaka"`, which is why "Check out of Osaka hotel" plots at Osaka Castle
today. If that fix does not land, rung 3 manufactures `exact` placements that are wrong, and an
`exact` placement is the one thing this design does not label. This ladder must not ship before it.

**Section 3: Where the derived tables live.** No new table is authored, and no geocoder is added.
D-088 (free-tier-only, **LOCKED**, *"the biggest requirement, ahead of feature scope"*) disqualifies
any geocoding service that wants a paid tier, a card on file or an ongoing cost. That is every
serious one, and none is needed here anyway:

> **Corrected 2026-08-10 (S418).** This sentence used to read *"D-088 … forbids a geocoding service"*.
> It does not. D-088 forbids **paid, card-requiring or ongoing-cost** dependencies of any kind; the
> category "geocoder" appears nowhere in it, and a genuinely free, card-free geocoder would clear it
> on D-088's own terms and then be judged on its merits. The over-read mattered because it turned a
> cost constraint into a permanent technical ban that nobody had actually decided, and it was cited
> that way. The real reason no geocoder is added is the one already stated below: rungs 4 and 5 need
> no new data, so there is nothing to geocode. Both rungs stand unchanged. (An earlier note put this
> correction on D-279; that is the wrong entry. D-279 is the approximate-pin rule and says nothing
> about geocoding or about free-tier constraints.)

- **Rung 4 has no table at all.** It is an index built at module scope from `MAP_MARKERS`' existing
  `area` strings (`lib/map-data.ts`), the same 27 records that already carry `lat`/`lng`. Zero new data.
- **Rung 5 reuses a table that already exists and is already guaranteed total.** `CITY_COORDS` in
  `lib/weather.ts` holds coordinates for **12 trip cities**, and `lib/__tests__/content-validation.test.ts`'s
  *"every itinerary city is weather-known"* case fails the content validator if any day's `city` is
  missing from it. Ruling: extract `CITY_COORDS` verbatim into its own pure module `lib/city-coords.ts`
  (data plus a `cityCoord(city)` lookup) and have `lib/weather.ts` import it, so the map does not pull
  the Open-Meteo fetch client into its bundle and there is still exactly one city table. A second copy
  of these coordinates is forbidden.

**Section 4: The coverage claim, and its exact limit.** For the **default trip pack**, rung 5 alone
places every item, because the content validator already proves every `DayPlan.city` is in
`CITY_COORDS`. The "every plan appears on the map" requirement is satisfied by an existing build-time
invariant, not by hope. For a **custom trip** a user may type any `city`, so `kind:'none'` is reachable
there and has to be handled: that row renders with a "no location yet" affordance that opens the
already-shipped S357B pin picker (`calendar-planner.tsx`'s `Drop a pin` → `PlanDayMap` pick mode). No
new picker is built.

**Section 5: A derived position is never persisted. This is the load-bearing rule of the entry.**
Rungs 4 and 5 produce a runtime projection only. Nothing writes them into `item.lat`/`item.lng`, into
the Vault, or into Firestore. Why this is not a preference: `lat`/`lng` mean *"this exact point was
asserted"*. If a derived city centroid were written there, it would (a) become indistinguishable from a
real pin, which makes D-279's honesty rule unenforceable one write later, (b) sync to every other
traveler under rev/hlc LWW as if it were a deliberate edit, and (c) violate D-135's hard invariant that
content never rewrites live data, since a content edit to `CITY_COORDS` would silently be a user-data
edit. A user's own pin (rung 1) and an authored curated coordinate are persisted; a derived one never is.

**Section 6: Home and sequencing.** `resolvePlacement` lives in **`lib/itinerary-map.ts`**, the module
that already owns the item→coordinate join, rather than a new parallel module, so there is never a
second join to drift. It is sequenced after the in-flight `NAME_INDEX` fix in that same file
(section 2). `DayStop` gains the resolved `placement` and the originating `item`.
`buildItineraryStops` becomes **item-keyed**; today it drops any item whose marker was already seen
that day (*"one stop per marker per day"*), which is a second, quieter reason the map shows fewer items
than exist. **Pin dedupe moves from per-marker to per-coordinate:** every item keeps a row, and items
resolving to the same point render as one pin whose popup lists them.

**Section 6, amended in part by S381 (2026-08-06). The paragraph above is left as written because it is
the record of what section 6 decided; this line records what the data then forced.** Per-**coordinate**
dedupe applied to the **exact** path **broke `/plan`**: `e2e/pin-drop.spec.ts` failed **3/3**, because
the S357B picker's *"use centre"* lands on the fitted curated marker, so a user's own dropped pin was
merged into that marker and `/plan`'s stop counter then under-reported an item that was actually
plotting. **Shipped shape: approximate placements dedupe by coordinate; exact placements dedupe by
marker.** This was measured, not preferred. It was found by running the existing spec, and it is the
mechanism half of section 6 failing contact with real data, not a change to the ladder or to what the
user sees on `/map`. The rest of section 6 stands: `buildItineraryStops` is item-keyed, and that
re-keying immediately surfaced a real plan the old per-marker dedupe had been silently dropping
(`data-mapped-count` for Day 2 moved 1 → 2).

**Section 7: Scope, added by S381: the ladder runs on `/map` only.** `/plan` and `/travel` keep the
exact-only join. The reason is D-279's own: placing every item on those surfaces makes *their* stop
counters `N === M` by construction, exactly the vacuity D-279's section 4 exists to prevent. So
extending the ladder there is only legal together with re-pointing those counters at exact-vs-total.
Follow-up slice, counters included.

**Why:** the coordinate field already exists, the city table already exists and is already proven total,
and the marker `area` vocabulary already exists, so the whole of the ask is reachable with one pure
function and one file move: no new data, no new service, and no LOCKED entry touched. The one genuinely
new idea is that the *provenance* travels with the coordinate, which is what makes D-279 possible at all.

**Changes if:** a real geocoder is ever greenlit (a D-088 exception, and it would replace rungs 4–5);
custom trips gain a validated city vocabulary (rung 5 becomes total there too and `kind:'none'` becomes
unreachable); or someone proposes writing a derived coordinate to disk. That last one is a change to
this entry, not an implementation detail, and it re-opens D-279.

---

## D-279 · (S376 Lane B, proposed 2026-08-05, on the B3 ruling) · An approximate pin is visibly and semantically distinct, and "approximate" is the return value of the resolver, never a stored flag

**Ruling (settled):** approximate pins have to be distinguishable from exact ones, in the styling and in a
note in the popup. The trade was stated plainly before the call: visual uniformity would look more polished,
and polish is our own INTAKE-06 goal. We chose honesty anyway.

**1 — The mechanism: no flag exists to drift.** `resolvePlacement` (D-278) returns a discriminated union:

```ts
type Placement =
  | { kind: 'exact';       lat: number; lng: number; marker: MapMarker; via: 'pin' | 'source' | 'name' }
  | { kind: 'approximate'; lat: number; lng: number; marker: MapMarker; via: 'area' | 'city'; derivedFrom: string }
  | { kind: 'none' };
```

`kind` is produced by the same call that produced the coordinate, from the same inputs, on every render.
There is no `isApproximate` field on `ItineraryItem`, nothing persisted, nothing to migrate, and no way
for the label to disagree with the position it describes. A stored boolean would be this repo's signature
defect: a value that can survive the edit that falsified it.

**2 — `derivedFrom` carries its own evidence.** It is the verbatim text the coordinate came from: the
matched `area` string, or the day's `city`. The popup renders that string, not invented prose: *"Approximate
— placed from 'Shinjuku, Tokyo'."* The user can therefore check the claim. This repo has already shipped one
map surface asserting something untrue (D-271's *"showing cached map tiles"*, when the SW caches no tiles).
A claim that quotes its own source cannot repeat that failure silently.

**3 — What has to be distinct.** (a) The pin: an approximate pin is a different mark from an exact one. The
low-confidence treatment (hollow ring, no solid core) reads as *"around here"*, and reduced-motion and
contrast rules apply as before. (b) The popup: the `derivedFrom` note, plus the affordance to fix it
(the S357B picker). (c) The day-order row: an approximate row is marked, so the INTAKE-05 fly-to never
silently promises precision. Colour alone is not enough. The distinction has to survive greyscale, per
the project's contrast floor.

**4 — It replaces a number that is about to go vacuous.** The map today reports `· N of M stops shown`
(`map-section.tsx`, `data-stop-count`/`data-total-count` on `map-itinerary-toggle`). Under D-278 every item
is placed, so that ratio becomes N === M, always: a badge that can no longer fail. The badge is re-pointed
at `exact vs total`, which stays falsifiable and states the honest thing, how much of your plan is really
located. The existing testids stay; their meaning changes, and `docs/test-ids.md` (D-092) is updated in the
same slice.

**Why:** the honesty cost we accepted is only actually paid if the distinction is impossible to lose. Making
`kind` a derived return value rather than stored state means no future edit path can strip it.

**Changes if:** the B3 ruling is reversed and uniform pins are wanted. Then the resolver is unchanged and only
the styling collapses, so this is cheaply reversible (deliberately). If an approximate coordinate is ever
persisted, this entry is void; see D-278.

---

## D-280 · (S376 Lane B, proposed 2026-08-05) · Coordinates on `Recommendation` / `PhotoSpot` are Deferred, with the shape pre-approved so no second ADR is needed

**Decision:** DECISION-B2 — add `lat?`/`lng?` to `Recommendation` (`lib/nepal-data.ts`) and
`PhotoSpot` (`lib/photography-data.ts`) and author them for the ~98 curated records — is not taken now.

**Why defer:** it is not required by the ask. Under D-278 a card-created item already resolves. A map
card resolves via rung 2 (`toItineraryDraft`'s `'map'` branch writes `sourceId: marker.id`, and those 27 ids
are in `MARKER_BY_ID`), and a recommendation/photo item via rung 4 or 5. B2 would upgrade *some* items from
`approximate` to `exact`; it would not change what appears on the map. Against that: it is ~98 hand-authored
coordinates (content labour, the largest single cost in Lane B) whose benefit cannot be sized until the
approximate share is measurable, and `lib/itinerary-adapter.ts` has no coordinate field, so it also needs
`ItineraryDraft` extended and every add path touched. Shipping the ladder first tells us how much of this
is worth doing, per record, from a real number.

**Pre-approved shape, so this needs no second ADR when it happens:** `lat?`/`lng?` optional on both
interfaces is a D-012-legal additive extension (the same clause D-026/D-041/S137 already exercised);
`ItineraryDraft` gains the same optional pair; `toItineraryDraft` copies it; the created item persists it.
That persistence is consistent with D-278: an authored curated coordinate is an *asserted exact point*,
not a derived one, so it is `exact` and carries no approximate marking. Records naming no single
physical place (a food *style*, a district crawl) are left without coordinates. Do not invent a point to
make a column full.

**Changes if:** the measured `approximate` share after D-278 ships is high enough to draw an objection, or a
slice needs exact photo-spot pins (the photography guide's own map view would). Then this is a content slice,
not a design question: the shape is already settled above.

---

## D-371 · Amends D-205/#10 in part (2026-08-20) · The built-in sample pack is gated on having a session, not on trip membership

**1 — What is amended.** Issue #10 moved the concierge from token possession to Firestore
membership, and added a matching client-side refusal for the built-in pack. That refusal is
deleted. Membership was never an answerable question for this one pack: #10 also made it a
local-only sample with no Firestore trip document, so a membership read can only ever answer no.
The client half shipped in v6.0.0 and the server half (worker v1.9.0) never deployed, so what
reached users was a refusal with nothing behind it, on the trip a first-time visitor lands on.

**2 — What replaces it, when the worker half eventually ships.** A `SAMPLE_TRIP_ID` var routes that
ONE id through a signed-in check (`accounts:lookup`) instead of a membership read. Every other trip
id keeps the membership path unchanged. Unset or empty, the var is inert and every id takes the
membership path, so the allowance is opt-in rather than a default.

**Why this is not a new hole:** the deployed Firestore rules already allow any signed-in user to
`create` a trip naming themselves owner, so the relay was already reachable by anyone willing to
mint an anonymous session. The sample pack's digest is the built-in itinerary, it never syncs
(`getTripId()` returns `''` for it), and no traveller identity is in it.

**3 — The coupling, and it is load-bearing.** The allowance and the IP rate limiter (D-338) are one
access decision. A signed-in check is a floor an anonymous session clears for free, so the limiter
is what actually bounds abuse. Whatever deploys next must carry `[[ratelimits]]` and
`[observability]`; shipping the allowance without the limiter is the failure mode, on free tiers
with no rollback.

**Changes if:** the sample pack gains a real Firestore document (then membership answers for it and
the special case goes), or the rules stop allowing self-owned trip creation (then the "not a new
hole" reasoning above needs re-deriving before this stands).


## D-281 · Amends D-204 in part (informed ruling, 2026-08-05) · Time order is the one ordering on every surface including the map; `orderByProximity` is deleted, and the day anchor survives as the day's base point, not as a sort key

This is an informed amendment, not an oversight. The question said up front that ordering the
map's day list by time costs the day-anchor walking-route feature its point: the whole reason the S224
anchor existed was to answer *"what's nearest to where I'm standing"*. The call was time order everywhere,
no exceptions, made with that in hand. Record it that way. Do not re-argue it, and do not quietly rewrite
D-204 as though it always said this.

**1 — What is superseded.** Exactly one clause of D-204: *"the day's stops then re-order nearest-first by
client-side haversine"*. The map's day-order list, the drawn day line, and every other item list now sort
by `sortItemsByTime(items, day.date, dayOffsetMin)` (`lib/sort-items-by-time.ts`), the helper
`trip-timeline.tsx` already uses, with untimed items sinking stably to the end, as that helper already
guarantees. One sort function, no second implementation on the map.

**2 — What survives of D-204, unchanged.** (a) Assigning a map pin to a day still adds it through the
existing `addItem` CRUD: the one synced write, idempotent on re-anchor. (b) The anchor is still local-only,
non-synced, self-healing on stale ids (gateway key 22 `dayAnchors`) and still never persisted into the
itinerary array. (c) No schema change; `mergeItems` (D-149) untouched. (d) The keyboard/touch assign path
(popup day-`<select>` + button) and the desktop drag handle are untouched. The anchor keeps a real job:
it is the day's base point, the map's focus/centre for that day, and the origin of the per-row distance
label the panel already renders via `haversineKm`. *"How far is each stop from my hotel"* is still useful
information; it simply no longer reorders anything.

**3 — Dead code, counted before deleting.** `orderByProximity` (`lib/day-anchor.ts`) has exactly two
production call sites, both in `components/map-section.tsx` (inside `applyAnchorOrdering` and the
`selectedDayStops` memo), plus its own unit tests. Both call sites are removed by point 1, so `orderByProximity`
and its tests are deleted, not left inert. Positive control on the instrument: the same repo-wide search
found `haversineKm` at a third site in `map-section.tsx` (the distance label) and `MAP_PIN_DND_TYPE` in
`trip-map.tsx`, so it does find production call sites in both files. `haversineKm` is kept for the distance
label in point 2, with its tests. `lib/day-anchor.ts` survives as haversine plus the DnD MIME type.

**4 — The copy has to stop claiming the old behaviour**, otherwise this repeats D-271's class of defect
(a surface asserting a behaviour the code no longer has). At minimum: the day-strip header's *"drag a pin
here… the day's stops then re-order by distance"* comment and helper text, the `assignPinToDay` toast
*"stops re-ordered by distance"*, the panel heading *"ordered by distance from X"*, the day-strip
`aria-label`, and `docs/test-ids.md`'s day-anchor note. The schematic-line caveat under the map
(`map-route-caveat`, *"Lines are schematic connections between stops — not driving or transit routes"*)
has to be re-read in this slice. The drawn line now means *chronological order*, which is arguably a
stronger claim than before, and this entry does not settle its wording sight-unseen.

**Why:** the product call is the owner's, and one ordering across every surface is the simpler system to
explain and to test. The anchor's remaining job (base point plus distance) is real, so the feature degrades
rather than dying, and the code that no longer has a caller is removed rather than kept "just in case".

**Changes if:** a per-surface ordering override is wanted (then it is a user-facing toggle, not a hidden
per-surface rule), or a real routing provider is ever greenlit. That re-opens D-204's own `Changes if`
clause, not this amendment.

---

## Session 20 (2026-08-06): all 8 parked owner questions were answered

_Every entry carries explicit owner sign-off; three change or retire previously
LOCKED text, which is why the authority is stated in each rather than assumed._

### D-137 · moved to DECISIONS-older.md

### D-285 · (S393, 2026-08-06, owner-ruled) · Dec 9 is Syracuse, and `country` stays `nepal`

The default pack's first day (`2026-12-09`) has `city: 'Syracuse'`: the traveller spends it in Syracuse, JFK and the air, reaching Kathmandu on Dec 10. `country: 'nepal'` is unchanged, because it is the leg id driving currency and the day offset, not a display label.

**Consequence accepted, not overlooked:** the day header now reads "Syracuse, Nepal", an accurate leg with odd prose. Parked for now; fixing it properly means separating "leg" from "displayed region", which is larger than this slice.

**Hard dependency:** `CITY_COORDS` has to carry `Syracuse`, or three weather-coverage assertions fail. Verified by deleting the row and observing exactly those three fail, which also proves those assertions are not vacuous. The frozen boundary assertions (`core-clock.test.ts`, `trip-cities.test.ts`, `trip-cities-scoped.test.ts`, `e2e/countdown.spec.ts`, `e2e/concierge.spec.ts`), the `sample-itinerary.golden.json` snapshot and the two digest-size constants moved in the deliberate S112/D-124-style lockstep.

**Changes if:** the trip's first day changes, or "leg" and "displayed region" are ever separated.

### D-271 · Superseded by D-286 · Superseded by D-286 (S394, 2026-08-06, owner-ruled)

### D-286 · (S394, 2026-08-06, owner-ruled) · The map engine is precached; tiles are not, and the copy must say so

`scripts/gen-sw.mjs` unions every maplibre-bearing built chunk into the precache, found by content (`isMaplibreChunk`, marker `maplibregl`, `.js` only) across the whole `react-loadable-manifest.json`. The engine hangs off the bare specifier `components/trip-map.tsx -> maplibre-gl`, so the render-path walk cannot reach it and it has to be unioned in explicitly: relaxing the content exclusion alone gets only the 23 KB chunk. Measured: 2 chunks, 1,056,033 B (1.01 MiB), precache 156 → 158.

**Why:** under the old rule `/map/` worked offline only if opened online first, a ritual no user knows about, and the landing copy had to spend a clause apologising for it. The bar was "under 2 MB"; it clears by ~2x.

**What this does not buy, and every user-facing string is bound by it:** basemap tiles. They are `basemaps.cartocdn.com`, cross-origin, and the SW passes cross-origin through uncached. Offline the map paints the navy underlay, marker circles and the day route line with no street imagery. **[Corrected by D-319 (issue #8, 2026-08-14): this sentence used to continue "and no marker/cluster numbers (the `glyphs` endpoint is cross-origin too)". That is no longer true — the glyphs are self-hosted and precached, so the numbers DO survive offline. The tile half of this paragraph stands unchanged, and so does the copy rule: never "the map works offline".]** Bulk-caching a free keyless CDN is out of bounds under the free-tools-only rule. Copy says pins and route, never "the map works offline".

**What survives the reversal:** `MapIslandBoundary` and the `assertMapIslandsWrapped` build gate. Precached does not mean present (cold cache, failed precache fetch, storage eviction). The gate's input is now derived from *"renders a maplibre island"*, never from *"we withheld its chunk"*, and `islandAssets()` throws if either the chunk set or the call-site set is empty, since an empty list would make the gate pass by inspecting nothing.

**Correction of a premise this repo had written down as fact.** D-271's remedy, `map-island-boundary.tsx`'s docblock and the pwa spec's own comment all said the boundary catches the missing ~1 MB engine. It never did and could not. The engine is loaded by `await import('maplibre-gl')` inside a `useEffect`, a promise path: the async IIFE rejects and no error boundary sees anything. What the boundary actually catches is the `React.lazy` throw from the 23 KB chunk. Verified at the source, not relayed. Consequence for future maintainers: an eviction test narrowed to "the big one" goes green on a broken map.

**Changes if:** a keyed or self-hostable tile source is greenlit (offline tiles become possible), or the engine grows past the 2 MB bar.

### D-287 · (S392/S395, 2026-08-06, owner-ruled) · The concierge may serve any trip, but the client gate opens only after the Worker deploy

We greenlit the concierge on other trips. The Worker's `SYSTEM_PROMPT` is now built per-request from an optional `{ label, start, end }` descriptor (`buildSystemPrompt`, `normalizeTrip`); absent or malformed input degrades to the default-trip prompt and never 400s.

**The ordering is part of the decision, not an implementation detail.** Deploys are manual and owner-run, so the trip-aware prompt cannot reach anyone until someone runs `npm run deploy`. Lifting the client gate first makes the concierge appear on a custom trip still speaking as the Nepal x Japan guide with the 2026-12-09 → 2027-01-09 date fence, and every op it proposes is silently dropped (`validateOps` rule 4 checks `TRIP_DATES` membership). The gate therefore stays closed behind one owner-flipped constant, `CONCIERGE_ON_CUSTOM_TRIPS` in `lib/concierge-config.ts`, documented with its exact precondition. Two lanes reached this conclusion independently with no contact.

**And the descriptor is sent only for non-default trips, which is the subtle half.** `buildSystemPrompt(null)` selects the *better* prompt: it keeps `LOCAL_KNOWLEDGE` (Thamel, Shibuya, the last-train fact), which the trip-aware branch deliberately drops because it cannot be written for an arbitrary trip. So sending a perfectly correct descriptor for the default trip would have silently downgraded the only trip that has a concierge. `buildTripDescriptor()` returns `null` there, the key is omitted, and the default body stays byte-identical. The defect lived only in the seam between two correct lanes.

**Budget:** 14,469 B worst case against `MAX_BODY_BYTES` 16,384 (1,915 B headroom); the 413 is raw-byte-checked before any parse, so the client-side size test is the only guard.

**Changes if:** the digest grows, or a `vibe` field is added. Both eat the headroom, so re-measure rather than assume.

### D-262 / D-275 · Amended (S392, 2026-08-06, owner-ruled) · The search leg is deleted; its standing deploy precondition is retired

We greenlit deleting the inert web-search leg. `worker/src/search.ts` (200 lines), its 456-line / 34-test suite, the `TAVILY_API_KEY` field on both `Env` and `ProviderEnv`, the prompt paragraph, and every mention in `wrangler.toml`, `.dev.vars.example` and `README.md` are gone (net -656 lines).

**What this changes about D-262.** Its operational clause, *"not shipping the search leg is an action, not an omission"*, held only while the leg gated on a runtime secret. It no longer does, because there is no leg. The standing pre-deploy precondition and the addendum's two-precondition conjunction are retired, and the README text carrying them is deleted rather than left as a lying comment, which is what D-262's own `Changes if` instructed.

**The durable half: D-262 lesson 3 was right and incomplete.** It said a feature gating on runtime configuration *"cannot be disabled by a decision, only by changing the configuration."* True, but a config value is itself only a state, restorable by one command from a dashboard, silently, forever. The complete rule: a decision is the weakest form of "off"; a config value is the second weakest; deleted code is the only one that survives people forgetting.

**And the cost of the weaker form was measurable, not theoretical.** For four months every deploy carried a precondition `npm run deploy` could not check, which D-262 itself called *"not a gate, a shared intention"*, with a near-miss on record (D-263). When a decision produces a standing precondition, that precondition is a recurring cost estimate for not deleting the code. Price it that way at the time, not four months later.

**Enforced, not asserted, by two mutation-proved tests that are deliberately not one test written twice:** a wire test (provisioned `tvly-`shaped secret on a message that cleared the old gate, and the outbound URL set is exactly Groq's) and a `readdirSync`-driven source grep (no file under `src/` names the provider, host or key, comments included). A mutation re-arming to a different host with the key name concatenated at runtime fails the first and passes the second. Neither subsumes the other.

**Changes if:** a search provider with acceptable terms is greenlit. That is new code and a new decision, which is exactly the point.

### D-288 · (S396, 2026-08-06, owner-ruled) · Claiming an old name is owner-initiated with a count preview, never an automatic migration

The call on the pre-rename stamps was rewrite. Implemented as `claimAuthorship` (`hooks/use-itinerary.ts`) driven by a Settings card, not a Vault migration step.

**Why not a migration: the hazard the parked question did not contain.** `DEFAULT_TRAVELER_NAME` is the literal string `'Traveler'`, which is also the login placeholder for a token that does not resolve to a roster name. A stored stamp reading `'Traveler'` is therefore ambiguous by value between "the owner before the rename" and "another traveller on a placeholder login". A Vault step runs unattended on every device, the blind mass mutation, and the vault syncs, so the misattribution would propagate everywhere. The count preview is the whole safety mechanism: it hands the ambiguity to the one person who can resolve it. The old name is an *input* prefilled with `'Traveler'`, never hardcoded.

**The safer non-mutating alternative was considered and rejected, and the reason should stop it being re-proposed:** seeding `priorNames` alone fixes the *filter*, but `by {item.updatedBy}` renders literally in two places, so the old items would still read "by Traveler". That is not "become yours".

`updatedAt` is deliberately preserved; only the three name fields change. `activity-feed.tsx` sorts on `updatedAt` alone, so a `stampUpdated` rewrite would dump every claimed item into the top of "Recent changes" and make each card read "just now". Under sync, `rev`/`hlc` are advanced (`stampSyncUpdated` touches only those two), or a peer's unrewritten copy wins the LWW and the next snapshot unwinds the claim.

**Ordering is load-bearing:** `addPriorName` runs before `claimAuthorship`, because `commit()` dispatches `itinerary:changed` synchronously and `use-author-filter.ts` re-reads prior names on exactly that event. The reverse order leaves "My edits" one event behind.

**Scope stated so it is not mistaken for complete:** itinerary items on the active trip pack only. `Expense.createdBy`/`updatedBy`/`paidBy`/`split[]` and `DocItem.updatedBy` are not rewritten, and `paidBy`/`split[]` are worse than attribution: they are settlement inputs, so a silent rewrite would re-point who owes whom. The card's own copy tells the user this. `addPriorName` is app-scoped, so the *filter* is repaired everywhere immediately; only the rendered name on other packs lags.

**Deferred with reason:** no Undo on the claim. A correct inverse needs a per-item record of which field matched (rewriting all three back corrupts a `doneBy`-only item), which is a stored change-set, not a closure.

**Changes if:** expenses/docs gain a migration mechanism, or a rename is recorded with enough provenance to make the ambiguity disappear.

### D-289 · (S396, 2026-08-06) · `moveItems` returns its landed ids, and every inverse must address those

`moveItems` now returns `string[]`, the landed id per item, captured inside the commit updater, with refused targets (same-day, missing original, pre-hydration no-op) omitted. `ItineraryStore` updated.

**Why:** under sync (D-032) `moveItems` tombstones the source and adds a fresh-id copy at the target, so an inverse addressed by the original id hits a tombstone and does nothing: the Undo toast appears and the data does not move. This is D-282 generalised, and it is the exact defect S389-A removed from `moveItem`. The docblock had warned about it in advance.

**Enforced:** `use-itinerary-bulk-sync.test.ts` drives `bulkMoveWithUndo`, the production inverse the UI actually calls, against the real store with sync on, so it fails on a wrong *caller* rather than merely a wrong store. Flipping the inverse to original ids produces `expected [...] to have a length of +0 but got 2`.

**Honest limit, recorded rather than glossed:** `e2e/multi-select.spec.ts` cannot discriminate this defect. The e2e build is dormant and ids are preserved, so an original-id inverse passes there. It proves the visible round trip; the vitest test proves the mechanic. Both docblocks say so.

**Changes if:** the sync branch stops minting fresh ids on move. The two branches then converge and the return becomes redundant, but delete it deliberately, with a test, not by assumption.

### D-290 · (S395, 2026-08-06, owner-ruled) · The concierge disclosure drops "search"; a second privacy label carries its own a11y association

With the search leg deleted (D-262 amendment), the `SheetDescription` claim *"third-party AI and search services"* became false and is reworded to a single AI provider. We also wanted a small privacy label: **"Sent to a third-party AI — nothing stored here."**, `id="concierge-privacy-note"`, with `aria-describedby` on the message input. A second label does not inherit the Radix `SheetDescription`/`aria-describedby` wiring, so it needs its own. The test reads the attribute off the input, resolves the id, and asserts exactly one node, so a dangling reference fails rather than passing quietly.

**The error row is now axe-scanned, and the zero is worth something.** `e2e/concierge.spec.ts` previously scanned only the panel's steady empty state, with no error-state test at all. It now scans the error row, and the scan is mutation-proved: an unlabelled `<img>`+`<input>` injected into the row produced `2 critical` on the error scan while the healthy control stayed at 0, and neutering the 502 made the test fail at `toBeVisible()` *before* axe ran.

**A predicted finding that did not reproduce, kept because the reason is a trap.** The predicted shape (`role="alert"` / `aria-hidden` wrapping a focusable control) was mutated in and axe scored it a pass: `aria-hidden-focus` carries a `focusable-modal-open` exemption, so inside a Radix Dialog that rule is unreachable. Stopping at "my predicted mutation didn't fire" would have supported either wrong conclusion. **Declined deliberately:** no `aria-describedby` from the retry button to the error text. No violation exists, and the button sits *inside* the live region, so it would re-announce the message.

**Changes if:** the provider list grows back beyond one, or the panel stops being a Radix Dialog (which re-arms the `aria-hidden-focus` rule).

---

### D-291 · (S422, 2026-08-09, owner-ruled) · The chrome accent is route-aware; the single-cyan rule is superseded and the unconfirmed cyan dies unconfirmed

**Owner brief, 2026-08-09:** *"current prod version is boring and does not look good. its bland and boring. its a travel planner website it should be fun as traveling not boring… make it so they can change front end design to look fun that pops out and looks like wowww not boring. this is high priority since first look is all that takes for user to decide if they want to use our platform or not."*

**Supersedes D-235** (*"one … chrome accent … everywhere, route-independent"*) and **retires D-269**. Note the difference: D-269 was never LOCKED. It shipped carrying a status of *awaiting a one-line confirmation*, and that confirmation never came, so it dies unconfirmed rather than being overturned. The cyan `189 90% 60%` leaves the palette.

- **Interactive accent: marigold `#FFC43D`.** Country gradients now drive real chrome on destination surfaces: Nepal `#FF8A3D → #FFC43D`, Japan `#FF8FC7 → #C08CFF`.
- **This also partly overturns S353's rule** *"all warmth/identity now comes from content"* (`globals.css` header). Recorded explicitly so a future reader does not re-derive S353 and revert this as a regression. S353's reasoning was sound for the palette it served; the goal has since changed.
- **Canvas moves from neutral charcoal `#0b0c0e` to aubergine `#100C1A`:** the near-black stays, the deliberate desaturation does not.

The bland look was not a failure of execution. It was this project's own prior ruling. The flat `bg-white/5` system is the full visual overhaul chosen on 2026-07-30 over the design lane's researched *"evolve, your tokens are already good"*, shipped complete across S353/S353B/S353C/S354/S355/S356/S357. What made it bland was the four rules it was built to, not the build. That was said plainly before any redesign work started, and the ruling was to proceed anyway.

**Evidence:** three full directions prototyped, rendered headlessly and shown as real pixels before any production code moved; the owner picked a combination. 69 contrast pairings measured by harness (`contrast-4.mjs`, exits non-zero on failure), all ≥ AA, including four guards that must fail and do.

**Changes if:** a return to a single-accent system is wanted, which re-opens every route's chrome and the whole per-country gradient set.

> **RULED, NO CODE. Recorded 2026-08-10 (S418).** The ruling above stands; none of it has shipped. This entry is written in the present tense (*"the accent **is** marigold"*, *"the canvas **moves** to aubergine"*) about chrome the app does not have, so a reader of this file alone would conclude it landed.
>
> **Proof of absence** (`trip/`, checked on `main`, `dev`, `lax`, `uttam` and `trip-access-control-lax`): grep for `FFC43D`, `marigold`, `100C1A`, `aubergine`, `FF8A3D` and `C08CFF` across `*.ts`/`*.tsx`/`*.css` returns **zero hits**. `scripts/` does not contain `contrast-4.mjs`, the harness this entry cites for its 69 measured pairings.
>
> This entry is dated 2026-08-09, one day before the check, so this is plausibly work in flight rather than work abandoned. It is recorded because "in flight" and "shipped" read identically in a decision log, and only one of them is true.

---

### D-292 · (S422, 2026-08-09) · The loudness gradient: three tiers, and the working screens are the strictest

We want a loud front door and *"calmer inside the app."* This is that decision, written as a checkable rule rather than taste, because "calm" is easy to hold on one screen and hard to hold across eleven.

- **Tier 1 · Stage:** `/` (logged out + hero block), `/recap/`, passport/profile, `/trips/` hero. **Permits:** full-bleed duotone photography · country gradient fills · **one** ambient loop per surface · scroll-reveal entrances (first view per session) · celebration up to *burst* · display type ≥2.5rem · glow. **Forbids:** more than one loop visible at once · any animation while a text input is focused.
- **Tier 2 · Gallery:** `/guides/`, `/nepal/`, `/japan/`, `/map/`, `/journal/`, `/flights/`. Photography, editorial serif, numbered chapters and the country gradient are permitted in the page header band only. Below the header a Tier-2 route follows Tier 3. The header is the whole allowance. **Forbids:** ambient motion anywhere · celebration above *pop* (except a stamp unlock) · glow.
- **Tier 3 · Desk:** `/plan/`, `/packing/`, `/checklist/`, `/settings/`, `/more/`, `/safety/`, `/share/`, `/travel/`, every budget/expense surface, and every dialog, sheet and form in the product regardless of which route opens it. **Forbids outright:** photography of any kind · gradient fills on content · anything that loops · scroll-reveal entrances (content is simply present) · glow · button lips · confetti/pops/bursts. **Permits:** solid surfaces, hairline separators, **one** accent per screen plus category dots, the *tick* celebration only (≤200ms).

**Why it is a decision and not a style note:** it is the rule that stops a redesign from making daily use worse. Tier 1 and Tier 3 share the same canvas, type, tap targets and tokens. Tier 3 is the same system with its permissions revoked, not a second design.

Colour never carries meaning alone (D-007 lineage): itinerary category is a 9px dot plus an uppercase word.

**Known weak point, recorded rather than hidden:** only one Tier-3 screen was built and proved (the day planner). `/map/` is asserted into Tier 2 without being designed (a map is inherently photograph-like and may fight a header photo), and `/recap/` was placed in Tier 1 without being designed at all; a recap is the "memory" mood and may need its own tier.

**Changes if:** a route cannot do its job under its tier's permissions. That is a reason to re-tier the route, never to quietly break the tier.

---

### D-293 · (S422, 2026-08-09) · The motion budget: nine rules, and S354's blanket deletion is superseded

The goal, in one line: *"I want more motion and celebration but not too much that it becomes annoying."* This supersedes S354, which deleted every infinite animation in the app and floored the scroll-reveal fade at `0.95` opacity (its own comment concedes the result is *"close to imperceptible"*).

1. **One loop per surface.** ≤1 infinitely-looping animation visible in a viewport, Tier 1 only; Tiers 2/3 zero. Grep-checkable: `infinite` appears at most once per Tier-1 surface, never in Tier-2/3 CSS.
2. **Loop floor 6s.** Anything repeating cycles ≥6s so it reads as ambience, not a blink. Faster must be finite.
3. **Longest single animation 900ms.** Exactly two exceptions: the stamp unlock (1200ms, rule 6) and ambient loops.
4. **Nothing animates under the cursor or the caret.** No animation may start on a focused element, while any text input in the same form is focused, or while a dialog/sheet is open. Reading and typing are motion-free.
5. **A celebration fires once per real transition, never on load.** Reuse `nextjs_space/lib/celebration.ts` verbatim: `crossedIntoComplete()` fires only on an observed `false→true` edge and `prev === null` seeds without firing. Plus: once per session per entity.
6. **Escalation is earned, not repeated.** *tick* ≤200ms, all tiers, unlimited · *pop* ≤500ms, Tiers 1–2, **max 3 per session** · *burst* ≤1200ms, **Tier 1 only**, one per event, never twice for the same stamp.
7. **The tenth visit is quieter than the first.** Entrances run on first view of a surface per session (`sessionStorage`); on re-entry content is present at its end state with no transition. Ambient loops are exempt, since ambience is not a greeting.
8. **Every animation forks to its end state, never to nothing.** No reduced-motion path leaves content invisible, half-drawn or at a floored opacity. The state change always still happens: under reduced motion a stamp unlock still stamps the city and still moves the counter; only the particles are withheld.
9. **Motion never carries information alone.** If a thing pulses to say "live", it also says it in text or a static mark.

**Evidence:** clicking unlock twice produces 44 confetti particles, not 88 (rule 5 holds). Under `prefers-reduced-motion: reduce`, `document.getAnimations()` running = none, and the counter still reaches its new value (rule 8 holds).

D-007 is untouched and still gates everything: every animation carries a `prefers-reduced-motion` fork. This decision adds rules; it removes none.

**Changes if:** a rule blocks something genuinely worth doing. Amend the numbered rule explicitly, never by exception.

---

### D-294 · (S422, 2026-08-09) · The passport page is a parchment material, a narrow named exception to D-009 rather than a light theme

D-009 (dark-only) stands. This is a single scoped exception, decided on 2026-08-09 after seeing three rendered variants (cream, dark, toned parchment) rather than a description.

- **Scope: the passport page surface only.** `--paper: #DCCDAE` with its own ink tokens. No toggle, no theme, no `next-themes` change, nothing else in the app changes. `forcedTheme="dark"` stays; the provider stays (D-009's standing warning: `components/ui/sonner.tsx` calls `useTheme()`).
- **Why a material and not a theme:** it is what makes a stamp read as ink pressed into paper rather than as an achievement badge. The dark variant was built and measured too. It passes AA (inks 8.39–11.38:1), but the `screen` blend turns stamps into glowing rings, so the page ends up a dimmer copy of the collection grid beneath it.
- **The measurement that actually decided it:** the dark page separates from the canvas by only 1.06:1, so it reads as an object *purely* by its drop shadow. This app is used one-handed, outdoors, in December daylight, and a soft shadow on a near-black screen is the first thing to disappear. The parchment does not depend on a shadow to read as a page.
- **Toned down from the first cream:** `#F4EDE0 → #DCCDAE` drops page-vs-canvas from 16.55:1 to 12.29:1. Inks were deepened in step (`--paper-lo #524563`, nepal `#8E0E30`, japan `#223C7C`, green `#0C5849`) because darkening the page eats `--paper-lo`'s headroom first: it had only 5.27:1. All six pairings were re-measured at 5.34–9.86:1, all clear AA (`parchment-verify.mjs`).

**Changes if:** we decide D-009 takes zero exceptions. The dark variant is already built and measured, so the revert is a token swap plus one blend-mode flip.

> **RULED, NO CODE. Recorded 2026-08-10 (S418).** The ruling above stands; the surface it describes does not exist. This entry is written in the present tense about a passport page that was never built, and a reader of this file alone would conclude it shipped.
>
> **Proof of absence** (`trip/`, checked on `main`, `dev`, `lax`, `uttam` and `trip-access-control-lax`): there is **no passport route**: `app/` holds 17 `page.tsx` files and none is it. Grep for `parchment`, `--paper` and `DCCDAE` across `*.ts`/`*.tsx`/`*.css` returns **zero hits**. `scripts/` does not contain `parchment-verify.mjs`, the harness this entry cites for its six measured ink pairings.
>
> Dated 2026-08-09, one day before the check, so this is plausibly work in flight. Recorded because the exception this entry carves out of D-009 (dark-only) is a real, narrow one, and a live carve-out for a surface that does not exist is the kind of thing a later reader honours by mistake. See D-291, ruled in the same session and in the same state.


---

### D-295 · (PR B / issue #10, 2026-08-10) · Issue #10 is the greenlight D-055's soft posture was waiting on — access control is now enforced, not labelled

D-055 (and the D-053/D-239 lineage under it) deliberately shipped *soft* access control: identity was a display name, the door's never-mix guard was "labels + flow, not validation", and the unspoofable-credential question was parked as a separate, greenlight-only concern. Issue #10 is that greenlight. The approved redesign's Tier 1 lands hard enforcement at four seams: the door validates the pasted User Token (D-296), the world-readable default-trip remote id is retired (D-297), the concierge refuses trips that are not on the account, and the app no longer renders behind the wall for logged-out visitors (D-298).

**The posture that survives:** enforcement fails OPEN everywhere a network is involved. A validation layer on a free-tier, offline-capable, token-only app must never be able to lock a real user out of their own data; only a server-confirmed negative ever rejects.

**Changes if:** a real backend or per-user auth ever arrives (D-205's zero-backend premise), which would allow fail-closed enforcement and re-open every decision below.

---

### D-296 · (PR B / issue #10, 2026-08-10) · The door validates a new User Token via ONE lazy server read of `profile/identity`; stored sessions are never re-gated; offline admits

Supersedes D-239's "the never-mix guard is labels and flow, not validation … there is nothing to validate against" clause, and amends D-053/D-054's firebase-free door to its real invariant: the door is **STATICALLY** firebase-free only. `handleLogin` dynamically imports `probeAccountIdentity` (lib/trips-remote), which races one `getDocFromServer` of `trips/{code}/profile/identity` against an 8s timer. Tri-state, and the mapping is the security posture: **'missing'** (the server answered, no doc) rejects with "This user does not exist. Check your key, or create an account." and writes ZERO state — no key stored, no sign-in, no held wall; **'exists'** admits; **'unavailable'** (dormant build, blank code, timeout, any error — including a rules change that denies the read, which logs loudly) ADMITS, because offline must never lock a real user out. `getDocFromServer`, never a cached read: a cold cache reports absence, and a cached absence rejecting a real user is the one wrong the fail-open design cannot tolerate. The key already stored on the device skips the probe entirely — a live session credential is never re-gated, which is also what keeps the seeded-storage e2e suites and every returning offline device working unchanged.

**What makes the probe meaningful:** the create path now pushes BOTH `profile/identity` and `profile/tripList` at account creation (and the show-once confirm awaits them under a 5s budget before its reload — the S375 navigation-kills-the-write lesson), and `subscribeTripList`'s absent-first-snapshot auto-seed is DELETED. That seed was the mechanism that manufactured a working account doc for any pasted string; without it, an invented key has nothing behind it and the probe's 'missing' answer is true.

**Accepted residual (inherited from D-239, now narrower):** a *Trip Token* pasted at login can still resolve to 'unavailable' (or, for a trip that grew a `profile/identity` doc, to 'exists') and yields a working-but-empty account, recoverable by signing out. The class of key that no longer works is the *invented* one.

**Changes if:** the identity doc moves or gains an auth requirement (the probe and the rules must move together — the permission-denied warn is the tripwire), or token-format discrimination (`user-`/`trip-` prefixes) ever lands, which would let the door reject a Trip Token *before* any network.

---

### D-297 · (PR B / issue #10, 2026-08-10) · The default pack is a LOCAL-ONLY SAMPLE — `NEXT_PUBLIC_TRIP_ID` is retired; rotating the exposed remote id is an owner runbook step

Amends D-205/D-210. The default pack's remote path was supplied by `NEXT_PUBLIC_TRIP_ID` and documented as "a separately-minted secret". That was false by construction: a `NEXT_PUBLIC_*` value inlines into the public bundle at build time, so the "secret" shipped to every visitor, and under the capability-token rules the remote trip it named was world-readable *and world-writable*. No env var can fix that shape — the fix is that the default pack has no remote path at all. `getTripId()` returns `''` for it; a new `isTripRemoteConfigured()` (= `isRemoteConfigured() && getTripId() !== ''`) is the entry gate for every module composing `trips/{getTripId()}/…` (itinerary/expenses/budget/docs remote, presence, and the sync outbox — whose default-pack enqueue would otherwise retry an invalid empty path forever). Account-scoped paths (`trips/{userToken}/profile/*`) keep gating on `isRemoteConfigured()` alone. Net effect: on the default pack nothing syncs, nothing is shareable (trips-hub and Settings say "sample" instead of rendering an empty token), and the deploy workflow no longer injects the var; custom trips are byte-identical to before. D-172's localStorage grandfather is untouched — the default pack's LOCAL keys stay the legacy literals forever. The `?trip=` handshake now compares against `getActiveTripId()` (the remote/local id distinction it was built on no longer exists).

**Owner runbook (not app code):** the previously-injected remote id is burned — delete `trips/{that id}/**` in the Firebase console, and treat the live shared trip as a custom trip whose freshly-minted id is shared person-to-person. `docs/trip-key-migration.md` carries the retirement note.

**Changes if:** the sample ever needs to be shareable again, which under this model means it simply becomes a custom trip like any other — never a build-time env var again.

---

### D-298 · (PR B / issue #10, 2026-08-10) · `{children}` render only for an identified traveler — the wall withholds the app instead of covering it

Supersedes D-054's "content stays mounted behind the wall (the wall is an overlay, not a replacement of children)" clause. `ItineraryProvider` renders `{children}` only when mounted AND `useActiveTraveler()` resolves a traveler; TokenGate, the tour, presence and the toaster stay mounted as before. This closes the S355 finding that login.spec.ts spent months logging without asserting: the home dashboard — trip name included — sat in every logged-out visitor's DOM under a mere overlay, readable via view-source. That log-only test is now a hard assertion (no headings, no content outside the wall), and the static export's prerendered HTML is likewise content-free (the SSR snapshot is the signed-out one).

**D-244 is intact, checked before writing this:** D-244's ruling is about ROUTING — no new route, no root-layout split, no app-home move for the landing. None of that changed; the withholding happens inside the provider D-244 left in place. What D-054 bought with the always-mounted children — hydration warm-up behind the wall — is deliberately traded away: hydration for a logged-out visitor was warming a page they must never see. Sign-in mounts the app live via `identity:changed` (the wall's `held` flag covers the one-frame seam), sign-out unmounts it at once.

**Changes if:** first-paint-after-login latency ever measurably regresses (the traded warm-up is the suspect), or a route genuinely needs logged-out content — which is D-244's named upgrade path (root-layout split), not a re-widening of this gate.

---

### D-299 · (PR C / issue #10, 2026-08-10) · Anonymous Firebase Auth returns — lazily, inside `getRemote()`, as part of the handle; Google linking is POPUP-ONLY

Reverses D-209 item 2, which stripped Firebase Auth as "fully vestigial" because the rules of the day never read `request.auth`. They do now: every trip operation sits behind an auth floor, and a trip carrying a `members` map is gated on membership — so a session is a precondition for sync rather than decoration. `lib/itinerary-remote.ts`'s `getRemote()` — the ONE lazy seam every remote module already awaited — now also imports `firebase/auth`, awaits the FIRST `onAuthStateChanged` resolution, signs in anonymously only when that resolution is null, and returns `uid` and `auth` on the handle. Awaiting the observer before signing in is load-bearing: `auth.currentUser` is null for a beat on every load, and signing in during that beat mints a SECOND anonymous uid and orphans this device's entry in every roster. Failure rejects and clears the cached promise, so a cold start while offline retries instead of poisoning the session.

`lib/presence.ts`'s duplicate init is DELETED as part of this. It had its own `initializeApp`/`getFirestore` promise, deduped from the main one only by `getApps()`, and therefore did not await the sign-in — on a cold start its first heartbeat could be issued before the floor was satisfied and be denied, which under D-300's stop-on-denied rule would kill presence for the whole session over a pure race. One seam, awaited by everything, is the fix.

The uid is DEVICE identity, not account identity. The app's own `signOut()` deliberately does not sign out of Firebase — dropping the uid would orphan the device's roster entry — and linking Google is offered precisely because it PRESERVES the uid (a fresh Google sign-in would produce a different one, still in nobody's roster). Linking is `linkWithPopup`, **never `linkWithRedirect`**: this is a static export served from a GitHub Pages origin against a different Firebase `authDomain`, so the redirect flow must persist its pending credential cross-origin, and under Safari's storage partitioning it is not there on return — the user taps, leaves, comes back, and nothing has happened, with no error to show them. `credential-already-in-use` is treated as the lost-device path (adopt that identity here via `signInWithCredential`, drop the cached handle because the uid just changed, re-run enrolment); a blocked or closed popup says so in words; anything else leaves the device anonymous and unchanged.

**Changes if:** the app ever gains a real per-user backend, which would make the anonymous uid a migration problem rather than the identity itself — or if Firebase ever ships a redirect flow that survives partitioned storage, which would let a popup-blocked browser fall back instead of failing.

---

### D-300 · (PR C / issue #10, 2026-08-10) · The member lock is OPT-IN per trip, with `owner`/`member` roles — and a member can mint an owner, which is accepted, not overlooked

A trip document MAY carry `members: { <uid>: 'owner' | 'member' }`. Its PRESENCE is what switches that trip from D-205's capability model (whoever holds the unguessable id may read and write it) to membership. Opt-in is not timidity: a rules deploy is instant and global and lands on data that already exists, so a mandatory roster would permission-deny every trip minted before it and every `?trip=` link already pasted into a chat, with no migration window and no way for a user to grant themselves a membership they were never written into. `createTripDoc` mints the map at creation time naming the creator `owner` (the rules accept a members map only on the create, and only one that names the creator owner); `ensureMembership` runs once per load for the active trip and adds exactly one entry — this device's — through a FIELD-PATH update, because the only edit the rules accept from a non-owner is a diff whose affected keys are exactly `members` and which removes and changes nothing. `owner` may remove and re-role; `member` may add. A refusal is not an error state: it dispatches `trip:access-pending`, which becomes one toast telling the user to send their device code to someone who is already in.

**Two ceilings, both named rather than fixed.** (1) Rules can prove a members edit is add-only, but cannot inspect the VALUE of an added key — there is no map comprehension in the rules language, and the added keys are uids unknown when the rule is written — so a `member` can add a third uid as `owner` and manufacture an owner. The client never offers it, which is the whole guard. The upgrade path is members as a SUBCOLLECTION (`members/{uid}` → `{ role }`), where the value becomes a document whose own write rule can check the role; that is a data migration, not a rules edit, which is why it is not done now. (2) The first device to open a grandfathered members-less trip takes `owner` and thereby ARMS the lock on that trip — the other travellers are then outside it until their device codes are added. That is the migration, and it is deliberate, but it means the first load after this ships is when a shared trip becomes exclusive; the access-pending toast and the Settings "Trip access" surface exist to make that recoverable in about a minute rather than mysterious.

**One consequence worth recording, because it cost a real defect on the way in:** the trip document is also the first-snapshot reconciliation MARKER ("has this group ever synced"), and creating it at trip-creation time made a brand-new trip look, to its own creator's first snapshot, like a group that had synced and then deleted everything — which applied an empty remote authoritatively over the day shells just derived from the trip's dates, so the trip rendered no day cells at all. The seed branch now additionally requires that the remote hold zero day documents AND that this device has never persisted an itinerary for the trip. Every other path is unchanged, and whole-day removal is not a user-reachable operation, so a completely empty remote means "never pushed to", never "deliberately emptied".

**Changes if:** a fourth traveller or a stranger ever gets a trip link, which is the point at which "a member can mint an owner" stops being three friends and starts being a real escalation — the subcollection migration above is the answer, not more rules.

---

### D-301 · (PR C / issue #10, 2026-08-10) · The Worker verifies MEMBERSHIP via a Firestore REST read as the caller, fails closed, and the client ships first

The Worker treated possession of a trip id as authorization, which is exactly as strong as that id being unguessable and no stronger — and the id travels in chat messages and share links. It now requires `Authorization: Bearer <Firebase ID token>` on both routes and verifies the caller by GETting the trip document from the Firestore REST API AS THAT USER. The check is therefore the SAME rules the client is subject to, evaluated by Google, with no second copy of the access model to keep in step: if the rules would refuse the read, the Worker refuses the request. It fails CLOSED — a missing or unverifiable token is a refusal, not a downgrade — which is the opposite of the client's fail-open posture (D-295) and correct for the same reason: a refused concierge answer costs a user one retry, while a locked-out itinerary costs them their trip.

**Ordering is a hard constraint, not a preference.** The client half ships first and attaches the header ONLY when a session exists (`lib/worker-auth.ts`), so a build with no firebase configured — the default state of this repository, and every browser test run — sends a byte-identical request to the one that shipped before. The Worker's requirement can only be switched on after a client that satisfies it is actually live; enabling it first would take the concierge down for everyone, including the owner's own deployed build.

**Changes if:** the Worker ever needs to act on a trip nobody is currently holding open (a scheduled digest, a webhook), which has no user token to borrow and would need a service account and its own rules exemption.

---

### D-302 · LOCKED · (PR #46 / issue #40, 2026-08-11) · `deploy.yml` gates the deploy by CALLING `ci.yml`; that makes ci.yml a published interface and puts it on the deploy critical path

**Decision.** `deploy.yml` no longer carries its own copy of any check. `ci.yml` gains a bare `workflow_call:` trigger and `deploy.yml` declares `checks: uses: ./.github/workflows/ci.yml`, with `build: needs: [version-gate, checks]`. The standalone `markers` job is deleted: repository hygiene survives as the first step of `ci.yml`'s `checks` job, still ahead of `setup-node`, so it still fails in about twenty seconds. This closes D-101's arc — `ci.yml` stops being the report-only sibling of an enforcing gate and becomes the gate. D-134's version gate and success-only tag are untouched.

Before this, the branch that deploys was gated by `version-gate` and a marker scan and nothing else. No typecheck, no lint, no unit tests ran on `main`, ever: `ci.yml` triggers on pull requests and on pushes to `lax`/`uttam`/`dev`, and a pull request runs against the merge ref, not `main`'s own commit. A direct push to `main` reached the live site essentially unchecked.

**Why calling and not copying.** Duplicating the steps into `deploy.yml` would make a second copy of three things that are each non-obvious enough to carry a comment today: `--legacy-peer-deps` (three dependencies pin React 18 peers against React 19), `NEXT_PUBLIC_CONCIERGE_URL: https://concierge.test` (a deliberately non-resolving origin, so the chat component mounts), and hygiene-before-install. D-136 already settled this shape for data — deriving is strictly safer than duplicating-plus-testing, because the drift class is eliminated by construction — and a deploy gate is the last place to accept a second copy that can quietly fall behind.

**What `./` buys, stated exactly, because the looser version of this claim is false.** A same-repo reusable workflow referenced with `./` resolves from the caller's own commit, so the deploy of commit X runs `ci.yml` as it exists at commit X. That eliminates VERSION SKEW and nothing else. It does not make the two files semantically compatible: an edit to `ci.yml` that is right for the pull request and wrong for the deploy lands atomically and takes effect on the next push to a live site, reviewed as a CI change. Co-versioning makes the files change together; it does not make the person editing them notice they are editing the deploy. Hence the contract.

**The contract `ci.yml` now owes its callers.** A caller may assume `checks` is callable with no inputs and no secrets, needs only `contents: read`, and is a complete gate. `ci.yml` must therefore never:

1. **Add an input without a `default`.** The call site passes none, so a required input fails the deploy at parse time.
2. **Come to depend on a secret.** The call has no `secrets: inherit`, so a called workflow receives none. Today this is harmless — `ci.yml` reads zero `secrets.*` and zero `vars.*`. The day a step reads one, it resolves normally on the pull-request path and to the EMPTY STRING WITH NO ERROR on the deploy path: one file, two call paths, silently different configuration.
3. **Require a write permission.** A called workflow can only reduce what the caller granted, and `deploy.yml` grants `contents: read` at workflow level, so such a step passes on the pull-request path and fails on the deploy.
4. **Share `deploy.yml`'s `pages` concurrency group.** A deploy would then wait on itself. This cuts both ways: `pages` carrying `cancel-in-progress: false` is also what makes the cancellation analysis below hold, so changing the concurrency of *either* file invalidates the reasoning in the other.
5. **Loosen `e2e`'s `if: github.event_name == 'pull_request'`.** That single line is the only thing keeping thirteen minutes and an advisory visual step off every deploy. It is now load-bearing on two paths.
6. **Mistake `ci.yml`'s `build` step for the artifact that ships.** It compiles the tree with a placeholder concierge origin and no Firebase configuration; the bytes that reach Pages are built separately by `deploy.yml`'s own `build`, with the real Actions variable and the six Firebase secrets. A green `checks` does not mean the shipping configuration was ever exercised. That is a coverage gap, not a fail-open — `deploy` still needs `build` — but it means this gate structurally cannot catch a misconfiguration of the deployed environment, which is the defect class issues #41 and #44 live in.

**The browser suite deliberately stays on the pull request, and the honest reason is not the easy one.** Inside `workflow_call` the `github` context is the caller's, so `event_name` is `push` and `e2e` skips on the deploy path. For a deploy that came from a merged pull request that is pure economy: the `pull_request` event tested the merge commit, so browser evidence already exists for that exact tree. For the path this issue exists to close — a direct push to `main`, or a `workflow_dispatch` — no pull request ever ran and the browser suite does not run at all. That hole is ACCEPTED, not covered. On that path the gate's duty is the irreversible and the cheap: a personal detail published to a public site cannot be recalled once Pages has served it, while a type error or a broken build costs seconds to catch. Re-qualifying an unreviewed tree in a browser would cost thirteen minutes on every legitimate deploy, and D-260 bounds what that would even prove. The answer to a direct push is branch protection that prevents it, not a longer gate that inspects it. Do not add conditional "run e2e only if this was not a pull-request merge" logic: that is clever branching in the one workflow that has to stay legible at three in the morning.

**Concurrency, since the obvious worry about it is wrong.** `deploy.yml` declares workflow-level `concurrency: group: pages` with `cancel-in-progress: false`, which gates the RUN. A second push to `main` therefore sits pending and dispatches no jobs at all — `checks` included — until the first run finishes, so a later run's `checks` cannot cancel an earlier one's, and the first deploy completes normally. This holds either way on the one question the repository cannot answer, namely whether a callee's workflow-level `concurrency` is honoured on the `workflow_call` path: if it is, the `pages` queue keeps `ci-refs/heads/main` uncontested; if it is not, the group never applies on the deploy path. Two residuals, both fail-closed. GitHub keeps one pending run per group, so a third push discards the queued second — pre-existing, and harmless because `main` is linear, so the newest tree still ships. And `workflow_dispatch` from a personal branch is the one case where the callee's `ci-<ref>` group genuinely collides with that branch's own CI runs, so a push to `lax` can cancel a dispatched deploy's `checks`; an unmet `needs` then ships nothing.

**Two ceilings, named rather than fixed.** First, `ci.yml` is now on the deploy critical path: a broken or red `ci.yml` means you cannot ship, including a forward hotfix. A revert is unaffected, since it restores a tree that was already green. There is deliberately NO bypass input — a `skip_checks` knob would be used the first bad night and normalised the second — so the break-glass is: revert, or fix the check. Second, the gate is per-ref, because it lives in the workflow file of the ref being deployed. `lax` and `uttam` still carry the markers-only `deploy.yml`, so a `workflow_dispatch` from one of them deploys under the old gate until this propagates.

**Changes if:** the contract above is violated once in practice, at which point the steps move into a composite action under `.github/actions/` called by both workflows — which makes the e2e asymmetry structural rather than conditional, and drops both the inherited concurrency and the borrowed `event_name`; or branch protection makes a direct push to `main` impossible, which retires the accepted hole above and turns the deploy-side `checks` into belt-and-braces; or `ci.yml` genuinely comes to need a secret, which forces `secrets: inherit` at the call site and a re-reading of clause 2.

---

### D-305 · LOCKED · Amended by D-337 · (issue #40 follow-up, 2026-08-11) · Release preconditions are asserted on the pull request INTO `main`, not only on the push to it — one script, two call sites, both needing a tag-visible checkout; and `workflow_dispatch` is removed

**Decision.** A dependency-free `scripts/release-gate.mjs` asserts three things about a tree aimed at `main`: (1) `trip/package.json`'s version carries no `v<version>` tag, i.e. it has never been deployed; (2) `trip/docs/RELEASES.md` carries a `## v<version> ` heading; (3) on the pull-request path only, the source branch is `dev`. All three run even after one fails, so a single run reports everything wrong rather than making you rediscover the next problem on the next push.

It has two call sites. `deploy.yml`'s `version-gate` job keeps its name, its checkout and D-134's `build: needs: [version-gate, checks]` wiring; only its `run:` becomes the script. `ci.yml` gains a job guarded by `if: github.base_ref == 'main'`, passing `HEAD_REF: ${{ github.head_ref }}`. Separately, `workflow_dispatch` is deleted from `deploy.yml`.

**The boundary this fixes.** There are two moments where someone decides to publish: the merge of a pull request into `main`, and the push to `main`. Only the second was checked, and the second is not a decision, it is a consequence. The decision was made at the merge button, and by then it is irreversible under this repo's own ban on a direct push: `main` sits ahead of the live site with the fastest fix forbidden. **A precondition asserted after the act it is a precondition of is not a gate, it is a diagnosis.** This was not hypothetical when written — `dev` stood at `5.14.0` with tag `v5.14.0` already pushed, so the next `dev` → `main` pull request would have gone green and then failed to deploy.

**Both call sites, not one.** Dropping the deploy-side copy was rejected: D-302 accepts a direct push to `main` as an open hole and names `deploy.yml`'s own jobs as what covers it, so removing `version-gate` there would delete the only gate that survives the case it exists for. It would also break D-134's LOCKED wiring. The two sites also ask genuinely different questions, because the pull-request answer can go stale if another deploy claims that version in between.

**One implementation, because D-302 already settled this.** Duplicating the predicate into both workflow files is the second copy D-302 refused for the checks, citing D-136: deriving beats duplicating-plus-testing because the drift class is eliminated by construction. Accepting a second copy in the same file pair days later would be incoherent.

**Why `github.base_ref` and not `github.ref`.** `base_ref` is populated only on `pull_request` and is empty on every push, independent of how the `github` context is inherited through `workflow_call`. The `ci.yml` job is therefore *structurally* absent from the deploy path, which is why `deploy.yml` must keep its own. The tempting alternative — condition on `github.ref == 'refs/heads/main'`, let one job serve both paths, delete `deploy.yml`'s job — fails in the wrong direction: if the context inheritance is not what we assume, the gate silently never runs on the deploy. `base_ref` fails the other way, into a redundant twenty-second job. **When the hinge rests on a fact the repository cannot confirm, pick the one that fails toward running.**

**THE TRAP, and it is the reason this entry exists at all.** `actions/checkout@v4` defaults to `fetch-depth: 1` with **no tags**. Assertion 1 decides by looking for a tag. Under the default checkout it finds none, passes, and the gate reports green **on a version that is already live** — verified by running the script under both checkout shapes, not reasoned about. `ci.yml`'s existing `checks` job uses a bare `- uses: actions/checkout@v4`, so an engineer copying the house pattern into this job ships security theatre that always passes. Both call sites therefore pin `fetch-depth: 0` and `fetch-tags: true`, and any third caller must too. This is also why the `ci.yml` job carries its own checkout rather than sharing `checks`'.

**`workflow_dispatch` is removed, and this half was found while auditing the other half.** Dispatch registers from the default branch but **runs the chosen ref's own copy of `deploy.yml`**. Six branches sat at an untagged `5.12.0`, each carrying the pre-#46 markers-only job graph and each still injecting the `NEXT_PUBLIC_TRIP_ID` that #10 retired. Dispatching any of them **passed** `version-gate` — D-134 asserts inequality only, and `5.12.0` had genuinely never shipped — then published a tree predating the entire access-control release with no typecheck, lint, unit or browser run, and tagged `v5.12.0` as if it were a release. Worse than a bad build: that client predates the membership model and would write against v5.14.0-shaped Firestore data, on every installed device via the service-worker update, which deploying forward does not undo.

Deleting the trigger closes the class rather than the six instances, and because dispatch registers from the default branch, removing it on `main` de-registers it repo-wide without merging into the stale branches. Nothing real is lost: the one case it served, re-running a deploy that failed at the same version, is served by **Re-run all jobs**, which replays the same workflow at the same commit. Pushing the missing `v5.12.0` tag to defuse the gate was rejected outright — D-134's tag means "genuinely live", and writing a lying tag corrupts the one signal the whole gate rests on.

**Checked against all six of D-302's clauses: no violation.** No `workflow_call` input (1); zero `secrets.*` and `vars.*`, and the two-path difference is structural rather than a value silently resolving empty (2); `contents: read` suffices (3); the job inherits `ci.yml`'s `ci-<ref>` group and is skipped on the deploy path, leaving D-302's concurrency reasoning untouched (4); `e2e`'s condition is not edited (5); nothing touches the shipping artifact (6). D-134 is extended, not contradicted: same tag predicate, same job, same wiring, one added caller.

**Successor rule to D-302 clause 5.** That clause protects `e2e`'s `if:` specifically; its reason generalises. A conditional job in `ci.yml` must be conditioned on a property well-defined on **both** call paths, and must fail toward running rather than skipping. `base_ref` satisfies both; `event_name` satisfies only the first and is grandfathered by D-302's explicit acceptance of the hole it leaves.

**The `trip/docs/RELEASES.md` assertion is enforced here and deliberately NOT in `marker-check.mjs`.** That script runs on every branch and every pull request into `dev`, where a release note must not be required; its failures mean "this must never reach a public repo", and a missing release note is not a leak. One red meaning two different things is how a check gets switched off.

**Three accepted ceilings, named rather than papered over.** The release-note assertion proves an entry EXISTS, never that it is honest — this file has claimed DEPLOYED before deploying, and no presence check catches that. The `## v<version> ` fixed string does not match a heading carrying the NOT-DEPLOYED prefix, which is correct behaviour and must not be "fixed" with a laxer pattern, since such a release is one you have explicitly said must not ship. And assertion 3 makes a pull request red but **cannot prevent a merge** — only a required status check does that, and that is a repository setting, not a file here. The rule is checked in; the enforcement toggle is not; the checked-in rule at least makes the missing toggle visible in a diff. `head_ref == 'dev'` is also a proxy: it proves the merge base is `dev`'s tip, not that every commit was reviewed there.

**Amended by D-337.** Two clauses above are false as written and are corrected there rather than here. Assertion 2 is no longer *"carries a `## v<version> ` heading"* — it scans `## ` heading lines and REFUSES one carrying a hold marker; the ceiling paragraph's claim that the fixed string already declined a NOT-DEPLOYED heading was never true of the code, which is how the gate reported `v6.0.0` clear to ship on an entry whose own body says it must not be. The monotonicity deferral in `Changes if` below is spent too: assertion 1b now compares the version against the newest `v*` tag as a numeric triple. Everything else in this entry — both call sites, the tag-visible checkout, `base_ref`, the removal of `workflow_dispatch` — is unchanged and still binding.

**Changes if:** branch protection is enabled and this job is added to the required checks, which promotes assertion 3 from advisory to enforced · or `dev` becomes the repository's default branch, which removes the accidental-bypass path this was partly written for · or a rollback is genuinely wanted, which needs a monotonicity check (deferred here: correct semver ordering is not a four-line job, and with dispatch gone the only remaining path into `main` is a pull request from `dev`) · or a hotfix path into `main` is needed, which is one more clause and an explicit branch-prefix convention, never a quiet exception.

---

### D-306 · LOCKED, in part · Superseded in part by D-313 · (issue #11, 2026-08-11, owner-ruled) · The countdown carries maximally over FIXED 28-day months, the parts reconcile with the total, and zero units are dropped by the renderer; D-016 is superseded

**Decision.** `core/clock/countdown.ts` decomposes the time to the target by carrying every unit as far up the ladder as it will go: 7 days become 1 week, 4 weeks become 1 month. A month is therefore a fixed 28 days and does not track calendar month lengths. The whole-day count is `differenceInDays(target, now)` and the three calendar fields are that number divided by 28, then by 7. `29 days` reads "1 month 1 day", `16 days` reads "2 weeks 2 days", `63 days` reads "2 months 1 week". `WEEKS_SUPPRESSED_AT` and its `suppressWeeks` branch are deleted, and with them `differenceInMonths`, `addMonths`, `startOfDay` and the hand-rolled borrow. The producer still REPORTS every field including the zeros; dropping a zero unit is the renderer's job, and every surface that shows units now does it.

**The defect this closes.** Weeks was pinned to 0 at a remainder of 28 days or more, so that "4 weeks" could never be rendered. At 29 days the hero read "29 days, 0 weeks": a literal zero sitting on screen for a fortnight, because the producer was shaping output for a display rule instead of stating the interval. Suppression at the source is the wrong layer. A unit that carries can never reach 4 weeks in the first place, so the bucket the old rule was afraid of is unreachable by construction rather than by a guard, and nothing has to be zeroed to keep it away.

**A month is no longer a calendar month, and that is the price, paid knowingly.** D-016 chose calendar accuracy precisely to get away from a flat `floor(days/30)`, and a fixed 28-day month is the same class of approximation. Issue #11 asks for it anyway and states the consequence in its own words. What it buys is that the parts reconcile with the whole: `months*28 + weeks*7 + days` IS `totalDays`, so the unit grid and the "days to go" ring, which the hero renders in the same frame, can no longer contradict each other. D-016 said not to "fix" that mismatch. This entry fixes it, on the issue owner's ruling, and accepts that "4 months" now names a date 112 days out rather than a date four calendar months out. Anything that needs real calendar months must compute them itself and must not read these fields.

**The sum-back invariant is re-expressed, never relaxed.** It was `now + months + (weeks*7 + days) days + h:m:s === target`, with `months` walked by `addMonths`. It is now `now + (months*28 + weeks*7 + days) days + h:m:s === target`, still exact to the second, still swept over 2,928 instants across a year in `lib/__tests__/countdown-sum-back.test.ts` plus 12,000 more against twelve non-trip targets. Tolerance was not widened, no case was deleted, and the maximality companion assertion is strengthened rather than dropped: one more day still overshoots, and additionally `days < 7` and `weeks < 4`, which is what stops the same interval from having several spellings. The month-walk maximality check went with `addMonths` because there is no month walk left to be maximal.

**Superseded in part by D-313 (issue #60, 2026-08-13, owner-ruled).** Only the first paragraph's fixed-28-day-month scheme and its reconciliation payoff (paragraph 3, "the parts reconcile with the whole") are reversed. Still binding, unchanged by D-313: zero units are dropped by the renderer, never the producer (paragraph 1's last sentence); `WEEKS_SUPPRESSED_AT` stays DELETED from this entry's own history but is REINSTATED by D-313 for an unrelated reason D-313 states itself — read D-313, do not assume this paragraph's deletion still holds. `computeCountdown` purity and the D-006 target were never in question. The sum-back invariant survives in a weaker, re-expressed form under D-313; it does not survive as written in the paragraph above, because a calendar month is not a fixed day count and the flat `*28` walk this paragraph describes no longer exists.

**DST survives because the walk is still date-fns field math.** The day count is `differenceInDays` and the residual is measured from `addDays(now, totalDays)`, both of which work in local calendar fields rather than epoch milliseconds. `differenceInDays` truncates, and that truncation IS the borrow the old code hand-rolled: the day you are standing in counts as a whole day only while the target's time of day is still ahead of you. That is what keeps `hours` under 24 without clamping. Proved by mutation: swapping `addDays(now, totalDays)` for `now + totalDays*86400000` fails six tests, including one reporting `24h`, exactly the DST failure mode. The DST case locates the runtime's own transitions rather than hardcoding US dates, because the suite pins no TZ and a UTC runner has none.

**Zero-suppression is per surface, and the clock is exempt.** The hero (`hero-section.tsx`) and the boarding pass (`token-gate.tsx`) drop a months/weeks/days cell that reads zero, so the tile row now holds 3 to 6 cells instead of always 6. Hours, minutes and seconds always render, zero or not: they tick, so a cell reading 00 corrects itself within the minute, whereas dropping it would reflow the row every minute and a running clock showing 00 is a clock, not the stale zero the issue is about. The hero's container classes are deliberately unchanged, so `grid-cols-3` still puts three per row on mobile and `sm:flex-wrap justify-center` still centres above it: a short row wraps, and the six-cell layout that ships today is byte-identical. The boarding pass's grid was `grid-cols-6`, which would have left dead columns, so its column count is now derived from the number of cells.

**Ceilings, named.** The 28-day month will read as wrong to anyone who checks it against a calendar, and no code comment reaches that person. Sub-second remainder is still truncated, so the sum-back holds to the second and not to the millisecond, unchanged from before. `hours < 24` rests on the truncating day count rather than a clamp, which means it can be broken by a future edit that computes the residual any other way, which is why the sweep asserts it directly. And the visual pack's frozen clock (`?today=2026-11-15`) now yields 0 months, so `home-hero-{mobile,tablet,desktop}` show five cells rather than six and need a re-baseline; that pack is advisory in CI (Windows-generated baselines on a Linux runner) and blocks nothing.

**Changes if:** the design wants real calendar months back, which reopens D-016 and forfeits the reconciliation, and needs both the sum-back and every unit fixture rewritten in the same commit · or a surface appears that must render a zero unit, which belongs in that surface and never in the producer · or the hero's unit row is redesigned, at which point the variable cell count is a layout input rather than a footnote.
### D-303 · Amended by D-511 · (S423, 2026-08-10, owner-ruled) · `docToDayPlan` passes a leg id through; the frozen `country` assertion is re-pointed

`DayPlan.country` stopped being a `'nepal' | 'japan'` union when custom trips landed — it is a **leg id**, and a custom trip's single leg is `'main'` (`core/trips/custom.ts`). `core/vault/schema.ts` was widened to `z.string().min(1)` for exactly that reason. The Firestore mapper was not, and still read `data.country === 'japan' ? 'japan' : 'nepal'`.

**What that actually did.** Every authoritative first snapshot rewrote a synced custom trip's days from `'main'` to `'nepal'` — and it did not stop at the local view. `pushDayMerged` does `mergeDay(remoteNow, localDay)`, and `mergeDay` takes day-level fields from its **first** argument, which is `docToDayPlan(<the remote doc>)`. So the first local edit after sync wrote the coerced id **back into Firestore**, permanently. Steady-state merges do not do this (local is `mergeDay`'s first argument there and `'main'` survives), which is why it hid: the corruption rides the first-snapshot path only, and re-lands on every reload.

**Amended by D-511 — the argument order above is history.** `pushDayMerged` now passes the LOCAL day first, so day metadata is local-authoritative at both sync boundaries and the first-snapshot path described here no longer writes a coerced leg id back. The defect, and the reasoning for why it hid, are unchanged as the record; only that call's argument order has moved. Read D-511 for what the reversal costs and when that cost expires.

**The impact was measured before deciding, and it is smaller than it first looked — all three claims were run, not reasoned:**

- **UTC offset: no impact.** A custom leg hardcodes `utcOffsetMin: 0`, and `offsetForCountry`'s unknown-id fallback resolves to `NPT_OFFSET_MIN`, which on a custom pack is *itself* `legs[0].utcOffsetMin`. Both ids yield 0. An earlier note claiming "wrong time-zone offset" was wrong.
- **Currency: real but unreachable today.** `legCurrency('nepal')` misses the custom pack's `LEG_CURRENCY` and returns `'USD'`; `legCurrency('main')` returns the configured currency. But no code writes a custom trip's `currency` — the create wizard omits it (`components/trips-hub.tsx`) and nothing in `trip/` or `worker/` sets it — so both sides are `'USD'`. It diverges only for a config carrying `NPR` or `JPY` (`normalizeCurrency` collapses everything else to USD anyway), which today only a remote-authored trip-meta doc could supply.
- **Day label: no impact.** Single-leg trips append no country label at all (`lib/leg-label.ts`).

**So why fix a latent bug at all:** the leg id is silently wrong in Firestore *now*, and that data outlives the latency. The moment custom trips get a currency picker or a real per-leg offset, every trip synced before the fix is already carrying `'nepal'`. Fixing costs one expression while nothing depends on the old behavior; fixing later costs a data migration.

**The rule now mirrors the Vault's own:** any non-empty string passes through; missing, blank, or wrong-typed still defaults to `'nepal'`. The mapper stays a pure shape-mapper under the contract's original intent — the default fills **absent** input, it never rewrites input that is present.

**Unfreezing.** The mapper's contract comment declared it pinned by `lib/__tests__/itinerary-remote.test.ts` with zero assertion edits. That freeze held a bug in place, so it was broken **once, deliberately, with owner sign-off**: the `country` case (`{ country: 'atlantis' } → 'nepal'`) is re-pointed to assert pass-through. Nothing else in the suite moved — re-measured on `dev`'s tip, 158 files / 1817 tests green before the change and the same 158 / 1817 green after, with only that one case rewritten (it gained assertions; it did not become a new test). Treat that pair as *equal*, not as a stable count: the suite is load-flaky on a busy machine (vitest fork-pool timeouts, and `lib/__tests__/remote-auth.test.ts` is not isolation-safe), which predates this change and shows up on an unmodified `dev` too. The nepal/japan rows are asserted unchanged on purpose: this is a **widening**, not a behavior swap. Treat the suite as frozen again from here.

**Safe on an unknown id** because every consumer is already total: `legCurrency → 'USD'`, `offsetForCountry → NPT`, `legLabel →` the capitalized raw id, and budget roll-ups iterate the pack's `LEGS` rather than day values, so a stray id cannot invent a phantom leg row.

**Rebasing #45 (issue #42) on top of this — the resolution is not free-form.** #45 rewrites the same two lines: the four-field literal becomes `{ ...data, date, city, country, items }` so unknown day keys survive, and the `countryLabel` guard flips from *set-when-string* to `if (typeof data.countryLabel !== 'string') delete day.countryLabel`. The two changes are independent in intent and collide only textually, so the resolution keeps **both**: this entry's `country` expression **and #45's `delete` form**. Carrying the pre-#45 positive guard over onto #45's spread is the wrong resolution and it is not a harmless one — with `...data` in place a wrong-typed `countryLabel` is already on the object, and a guard that only ever *assigns* never removes it, so a number reaches `compose`'s `label.includes(city)` through `dayPlaceLabel` (`lib/leg-label.ts`) and throws a `TypeError` on any day with a non-empty city. The negative form is what deletes it; that is why it is written as a delete and not as a copy.

**Known, pre-existing, and deliberately not fixed here:** roughly a dozen surfaces still branch `country === 'nepal' ? … : …` as a binary (`calendar-day-picker`, `day-strip`, `trip-timeline`, `map-section`, `travel-essentials-card`, …), so a custom trip falls into the Japan-styled else branch. That is not introduced by this change — an *unsynced* custom trip already held `'main'` and already rendered that way. This fix makes synced and unsynced custom trips agree, which is the direction that makes the wart fixable later instead of masking it.

**Changes if:** custom trips gain multiple legs or user-chosen currencies, at which point those binary ternaries stop being cosmetic and need a real per-leg lookup — the same treatment `legCurrency`/`offsetForCountry` already got.

**Addendum · (issue #294, 2026-08-25) · The `remote-auth.test.ts` isolation claim above was checked and did not reproduce.** Read the full file: all mutable shared state lives in two `vi.hoisted()` objects, `beforeEach` resets every field on both, every test calls `vi.resetModules()` before importing the module under test, and Vitest's `forks` pool defaults to `isolate: true` — a fresh module registry per test file regardless of which worker runs it. No order-dependence and no cross-file mock collision found. The load-flakiness half of this entry stands (fixed separately by tuning `vitest.config.ts`'s `testTimeout`/`maxWorkers`), but the specific "not isolation-safe" claim about this one file is not reproducible as written — treat it as resolved or as never having been precisely diagnosed, not as a live defect to keep chasing.

---

### D-511 · Amends D-303 · (issue #408, 2026-09-22) · Day metadata is LOCAL-authoritative at both sync boundaries; `pushDayMerged` passes the local day first

**Decision.** `pushDayMerged` (`lib/itinerary-remote.ts`) calls `mergeDay(localDay, remoteNow)` instead of `mergeDay(remoteNow, localDay)`. `mergeDay` resolves day-level fields to its FIRST argument, so the push now matches the snapshot path's `mergeDays(loadPlans(), remoteDays)` and both boundaries take `date`/`city`/`country`/`countryLabel` from the local side. The `#42` union is unchanged — a key present on only one side still survives from whichever side has it — and items are untouched, because the `mergeItems` join is commutative.

**What the asymmetry actually produced.** It is not merely that a wrong value could not be corrected: the two copies could permanently DISAGREE. Local's day metadata could never be overwritten by remote on either path, and remote's could never be overwritten by local on the push, so each side was write-once and the divergence was stable. A content-pack change to a date's city took effect on a device with no stored day and silently did not on one that had it. This is the property that made D-303's leg-id coercion self-perpetuating; D-303 fixed the coercion in `docToDayPlan` and left the property, which is why every trip synced before that fix still carries `'nepal'` in Firestore with nothing able to write over it. Reproduced on a real run before the change (`itinerary-remote-sync.test.ts`): pushing a local day with `city: 'Pokhara'` against a remote doc holding `city: 'Kathmandu'` for the same date wrote `'Kathmandu'` back — `expected 'Kathmandu' to be 'Pokhara'`.

**Why LOCAL and not REMOTE is the side that wins.** Remote-authoritative would make both call sites take the remote value, which freezes the server copy permanently: nothing on any device could ever change it, and D-303's stranded leg ids would be unrecoverable by design rather than by accident. Local-authoritative restores per-day last-write-wins, which is the conflict policy D-042 (LOCKED) already declares for the day doc, and it is the direction the code was already leaning — `pushDayMerged`'s absent-remote branch spreads the local day precisely so `countryLabel` is not erased, and `docToDayPlan`'s defaults (`city → ''`, `country → 'nepal'`) were being written over a live local value whenever the remote doc simply lacked the field.

**It also gives D-303's stranded rows their only route back, and that is part of what is being bought here.** A device holding the corrected leg id now writes it over the remote doc on its next push; before this change no client could reach that value at all. Anyone reconsidering the direction is reconsidering that repair as well, so re-check it first.

**The cost, named rather than hidden.** Two devices that genuinely disagree now take turns overwriting the remote doc instead of the first writer holding it forever. Each device stays locally stable, no items are affected, and no data is lost — the trade is a flapping server value in exchange for a correctable one. That is acceptable today because no live surface mutates a persisted day-level field: day metadata is derived from the date and the content pack, so a disagreement means two different packs or two different builds, and each device showing its own pack's label is the correct outcome for that state. If a surface ever does let a user set one of these fields, that reasoning expires and the flapping becomes a real defect rather than an accepted trade.

**This is an engineering call, and the reasoning is recorded because the fix reads as a bug at either call site alone.** It changes no policy — D-042 already specifies per-day LWW — it stops a boundary from silently opting out of one. **Known ceiling:** precedence is positional, not stamped. The moment a surface lets a user EDIT a day-level field, positional precedence stops being adequate and the answer is a per-field HLC as in `merge-budget.ts`, which `mergeDay`'s own doc comment already points at for the unsetting case. Do not re-derive the direction from one call site: `merge-day.ts` states that all three call sites pass local first and why.

**Changes if:** a day-level field becomes user-editable (per-field HLCs, as above), or the content pack becomes authoritative over stored days — in which case the re-seed, not the merge, is where the correction belongs.

---

### D-307 · Amended by D-339 · (issue #14 follow-up, 2026-08-11) · A map keyed by stored or imported data is read through an own-key check, at the read site — never by constructing the map prototype-less

`?? fallback` and `!== undefined` are both defeated by an `Object.prototype` key name. `MAP['toString']` returns a **function**, not `undefined`, so the fallback never fires and the function is handed onward in a slot typed `string` or `CurrencyCode`. Three sites **on the day-line and currency paths** read a lookup map with a key that comes from stored or imported data, and all three were wrong. They are not the only instances of the class in the codebase — see the follow-up at the end:

- **`core/budget/model.ts:145`** — the worst of the three, and not a crash. `legCurrency('toString')` returned a function, which is none of `'USD' | 'NPR' | 'JPY'`, so `ratePerUsd`'s ternary chain fell through to **the JPY rate 155 instead of the USD anchor 1**. The amount rendered **155× too small** — `convert(1000, …, 'USD')` gave `6.45` instead of `1000` — and with an empty symbol, so `formatMoney` printed a bare `1,000` rather than `$1,000`. Silent wrong money, in a module whose header promises every function is TOTAL and whose doc comment on that very line says "Total." (An earlier draft of this entry said "155 instead of 138". That was wrong and the correction matters: the fallback is `'USD'`, whose rate is the anchor `1`. A leg that really is NPR is an **own** key and shadows the prototype, so it was never broken — `legCurrency('nepal')` returns `'NPR'` in both the old and new code.)
- **`lib/leg-label.ts:58`** and **`core/dates/trip-cities.ts:83`** — both reached by a *single* call, `placeLabelForDate(d)` → `compose(getCityForDate(d), dayLabel(d, …))`, so fixing either alone leaves the other throwing on the same input. `compose` calls `label.includes(city)` on the function and throws `TypeError: label.includes is not a function`.

**Reachable, not theoretical.** `core/vault/schema.ts` is `date: z.string()` (no format check) and `country: z.string().min(1)`, and `findPlacements` (`core/itinerary/crud.ts:257`) hands `DayPlan.date` straight to `placeLabelForDate` from the add-to-itinerary dialog. The live route is **Vault import**, not sync — `DAY_LABELS` is consulted only when the active trip is the default pack, and the default pack never touches Firebase (D-297). Do not let the framing imply the concierge or a Firestore doc is the way in.

**Read-site, and that is load-bearing.** Building the maps prototype-less would be the tidier-looking fix and it is refused: `TRIP_CITIES` is locked as `deriveTripCities(TRIP_ITINERARY)` by **D-136** and D-232's preserved-LOCKED list, precisely to stop a future slice decoupling the derivation — and wrapping the derivation's output *is* that decoupling. Worse, it would not go red: the identity assertion in `trip-cities.test.ts:29` uses `toEqual`, which **passes** against a null-prototype object — only `toStrictEqual` fails, and its diff is the unhelpful kind that prints "no visual difference". So the construction-site version would violate a LOCKED entry while its own guard test stayed green.

**`Object.prototype.hasOwnProperty.call`, not `Object.hasOwn`.** `tsconfig.json` is `target: es2020` / `lib: [… es2020]`; `Object.hasOwn` is ES2022 and raises TS2550, which fails the **build**, not just a test. Bumping `lib` to es2022 for nicer syntax is a wider blast radius than the bug. The chosen form already appears three times in this repo — `core/storage/gateway.ts:758`, `lib/city-coords.ts:55`, `lib/weather.ts:431` — so this is the house pattern, not a new one, and no shared helper was added for three one-line call sites.

**Deliberately not touched:** `legBudgets` and `categoryBudgets`. Both are only ever written and read through `for (const leg of LEGS)` loops (`rollUp`, `normalizeModel`), so a poisoned key never enters, and `safeAmount(fn)` → `Number(fn)` → `NaN` → `0` regardless.

**Amended by D-339 — the paragraph above is no longer true.** Its premise was that both maps are built by `for (const leg of LEGS)` loops, so a stored key can never reach an assignment. D-339 makes `normalizeModel` preserve unknown leg keys, which is exactly such an assignment, and the write half behaves differently from the read half this entry is about: assigning `'__proto__'` hits the setter rather than defining a key, so a primitive is silently swallowed and an object **replaces the target's `[[Prototype]]`**. Both loops now skip the key explicitly at the assignment site — the same choice this entry argues for, applied to writes.

**The checks that pin it:** one `it` in `lib/__tests__/budget-model.test.ts` and one in `lib/__tests__/leg-label.test.ts` (the latter covers both date-keyed maps in one call). Verified in both directions — with the guards removed they fail with `expected [Function toString] to be 'USD'` and `TypeError: label.includes is not a function`. Note `vitest.config.ts` only includes `lib/__tests__/**` and `components/__tests__/**`, so a test placed under `core/**/__tests__/` would silently never run.

**Changes if:** validation moves to the trust boundary (`core/vault/schema.ts` narrowing `date` to an ISO shape, or `docToDayPlan`), which would make all three guards redundant · or `lib` reaches es2022 and `Object.hasOwn` becomes the house form.

**The class is wider than these three, and the rest is deliberately NOT fixed here** — this slice was scoped to the day-line and currency paths, and the remaining sites were found by the gate on it. In descending severity, all confirmed by probe rather than by reading:

- **`core/trips/index.ts:39`** — `TRIP_PACKS[id] ?? customTripConfig(getKnownTrip(id)) ?? NEPAL_JAPAN_2026`, where `id` is `getActiveTripId()`: a raw, unvalidated `localStorage` string. With the pointer set to `'toString'`, `getActiveTrip()` returns a **function**, and importing `core/budget/model` or `core/dates` then throws at MODULE LOAD (`Cannot read properties of undefined (reading 'map')`) — a white screen, not a wrong label. This is the **root the other three hang off**: `activeTrip` and `activeIsDefault` in both files guarded above are computed from it. It needs its own issue and is higher severity than anything fixed here.
- **`lib/itinerary-adapter.ts:142`** — `CATEGORY_MAP[…] ?? 'sightseeing'` on the **import** path. `.trim().toLowerCase()` happens to filter most prototype names, but `'constructor'` is already lowercase and survives.
- **`core/trips/custom.ts:67`** — `VIBES[key ?? ''] ?? VIBES[DEFAULT_VIBE]`, keyed by the stored `TripConfigBlock.vibe`. Its doc comment says "TOTAL — never returns undefined", which is true and beside the point.
- **`CATEGORY_COLORS[item.category] ?? …`** (`components/calendar-planner.tsx:1449`, `components/calendar-sortable-item.tsx:118`) and **`PIN_CATEGORY[item.category] ?? 'Attraction'`** (`lib/itinerary-map.ts:151,226`). Reachable from the same Vault import named above, because `core/vault/schema.ts:24` is `category: z.string()` and deliberately not `z.enum`.

Checked and **not** siblings: `travel-safety-kit.tsx:38` (key iterates a `const` tuple), `core/dates/item-time.ts:67` (numeric key), `core/sync/outbox.ts:119,156` (code-controlled domain), `components/budget-panel.tsx:100,513` (keys from `LEGS`).

**Also spotted, not fixed here:** **D-012 is stale.** It still declares `DayPlan.country: 'nepal' | 'japan'`; the shipped model widened to `string` in `core/budget/model.ts:47` and `core/vault/schema.ts:86`, and D-303 widened the Firestore mapper to match. The decision log now contradicts the code in two places.

---

### D-308 · (proposed S402, recorded 2026-08-10 by S418) · A "touch only these fields" guard derives its changed-key set by diffing both objects' keys; a hand-listed field allow-list is not a gate

> **Renumbered.** Drafted as D-295 on this branch; `dev` had meanwhile issued D-295 to issue #10's access-control ruling. Renumbered on merge — if you are looking for S402's D-295, it is this entry.

**Decision:** any bulk-rewrite invariant gate in this app, the name-claim rewrite (D-288) and anything shaped like it, asserts "this operation changed only what it was allowed to change" by **computing** the changed-key set: diff the union of the before and after objects' keys and compare that set against the allowed one. A hand-written list of fields to check is not acceptable as the gate. New fields are then covered the day they are added, with no edit to the guard.

**Why: this was demonstrated, not theorised.** S408's first guard was the hand-listed form. Forcing `category` onto every claimed row left the guard, the `settle()` invariance check and both merge proofs green, because no listed field had moved. The two readers do not overlap: `settle()` reads `leg`/`deleted`/`split`/`paidBy`/`amount` (`core/budget/settlement.ts:71-79`), while `expensesToSpent` reads `leg`/`category`/`amount` (`core/budget/expenses.ts:169-187`), so a corrupted `category` moves every budget rollup while the shipped test stays green. Replaced with the key-diff form, the money mutation goes red for the right reason: `split: ['Traveler','Powan'] → ['Powan','Powan'] → uniq → 1 member`, so a 3000 NPR bill divides by one and a balance moves from −1500 to 0. A guard whose coverage is the set of fields its author happened to think of is the project's signature defect: a check that reads as coverage and cannot fail.

**Changes if:** an operation genuinely has an unbounded or data-dependent key set, in which case the exception is named explicitly in the test, never left implicit by writing a list instead.

### D-309 · (proposed S402, recorded 2026-08-10 by S418) · Post-final durability posture: no internal fix is required, and the three known residuals are accepted with their real ceilings named

> **Renumbered.** Drafted as D-296 on this branch; `dev` had meanwhile issued D-296 to issue #10's User Token ruling. Renumbered on merge — if you are looking for S402's D-296, it is this entry.

**Decision:** after the final release the app runs unmaintained through the Dec 9 2026 → Jan 9 2027 trip and indefinitely after it. Internal durability was audited against that and **needs no code fix**. Three findings were stated too broadly in an earlier draft; these corrected versions are the record, and each is accepted with its ceiling named rather than closed:

- **Tombstones are capped in one store only.** The trip registry caps forget-tombstones at 200 (`core/trips/registry.ts:288`, applied at `:304`). Itinerary and expense tombstones are retained forever: there is no cap in `core/sync/`. They are accepted on **headroom**, roughly 100× and 10× the 1 MB Firestore document ceiling, not on a cap. The registry's own sync path (`registry.ts:383`) writes the merged union uncapped.
- **The clock-skew clamp is production-dead code.** It is applied only in `hlcReceive`, which has zero production callers. The per-row ratchet handles *sequential* edits across drifting clocks. The accepted residual is narrower and real: a genuinely concurrent offline edit on a correct-clock device can lose to a device whose clock is hours wrong. That is the trusted-device ceiling, ruled and accepted.
- **The eastbound-only time model has no visible effect** and is unreachable in every shippable configuration. The app flipping to "trip over" about fourteen hours early on Jan 9 is a *different* mechanism: the return leg is not in the pack, so the trip window ends while the clock is still anchored to JST. Cosmetic, and accepted.

**Why:** "no fix required" is only a safe thing to write down if the residuals it covers are written down with it. Recorded as a decision rather than a note because the alternative (a silent clean bill of health) is what lets a later reader treat an accepted ceiling as an unknown, or as a bug to chase in a codebase nobody is maintaining. The single external residual, browser storage eviction, is out of scope here: it is mitigated by the shipped persistence request, the install hint and a photo-inclusive export, and journal entries and photos remain single-device by design.

**Changes if:** a residual above is observed in the wild during the trip window, which makes it a live defect rather than an accepted ceiling; or the app leaves unmaintained status, which re-opens the whole posture.

---

### D-310 · (issue #54, 2026-08-12) · A total, never-throwing fetch client carries an abort ceiling at its own fetch site — "never throws" is not "always settles"

**Decision:** every `lib/` client that promises a total result over an external HTTP call passes `signal: AbortSignal.timeout(...)` to its injectable `fetchImpl`, inside the module that owns the fallback. Today that is `lib/weather.ts` (`WEATHER_TIMEOUT_MS`) and `lib/currency-rate.ts` (`RATE_TIMEOUT_MS`); it binds any future third. The signal is constructed PER CALL — `AbortSignal.timeout` is single-use, so a module-scope one is already expired on the second load. 8000ms reuses the precedent at `lib/place-resolve.ts:47` and `lib/trips-remote.ts:180` rather than inventing a number; `CHAT_TIMEOUT_MS = 45_000` is explicitly NOT the precedent, because a human waiting on a language model is a different class and that constant's own comment says so. A timeout is an ordinary failure: it falls through each module's existing `catch` to cached-stale, else `unavailable`, per D-108 and D-190. No new result state, no new `data-state`, no change to `WeatherResult`.

**Why: this was observed, not theorised.** D-108 promised `fetchWeather` never throws, and the card's `unavailable` state was designed against that promise. But `unavailable` is only reachable from a SETTLED rejection. A stalled connection — one that neither routes nor rejects — settles nothing, and the card renders `data-state="loading"` forever. CI run 31641098716 is the proof: `e2e/a11y-intrip.spec.ts` timed out at 30s on three consecutive attempts, to the tenth of a second, because the runner has no route to `api.open-meteo.com`. `travel-essentials-card.tsx` carries the same permanent-loading surface from the same root. The guard belongs in the module, not the caller: `readCache` is private, so a caller-side race would hold a rejection with no way to construct the cached result without leaking the contract out of the module — and there are multiple callers, so the caller-side fix is several guards where one does.

**The covering test inspects the fetch init, and that is load-bearing.** Every pre-existing case passed with and without the signal, because a rejecting mock and an aborted fetch are indistinguishable to them; only `calls[0][1].signal instanceof AbortSignal` turns red when a refactor drops it. The keyless-URL assertion is unaffected — the signal lives in `init`, so the URL is untouched.

**Changes if:** field reports show `unavailable` on genuinely slow in-trip mobile links, which argues for raising the constant — the cost of a short ceiling is one page-load of `unavailable` before the cache fills, which the next navigation repairs. Or a client appears whose upstream legitimately takes minutes, in which case it justifies its own constant the way the chat ceiling does; it does not widen this one.

---

### D-311 · (issue #54, 2026-08-12) · Above-the-fold height is a budget: a hero sized `100svh` under other chrome over-commits the fold, and the clearance assertion runs at the narrowest supported width with a declared margin

**Decision:** a full-height hero that is NOT the first element on its page sizes to the space it actually occupies — on Home the strip and the hero share one `min-h-[100svh] flex flex-col pt-16` wrapper and the hero is `flex-1 min-h-0`, never a bare `min-h-[100svh]`. The fold assertion in `e2e/countdown.spec.ts` asserts `ctaBottom <= viewport - FOLD_MARGIN_PX` with `FOLD_MARGIN_PX = 12`, and runs at an explicit **320** as well as 360.

**Why:** CI put the CTA bottom at 744.375 against a 740 fold, deterministically across three retries, while the same commit passed locally. The cause was a classic 15px Linux scrollbar making the layout width 345, where the hero badge's date label wraps to two lines; the block is vertically centred, so the CTA moved half of 21.25 = 10.625px. The scrollbar was not the bug — it revealed one. **At 320px the CTA was 19.25px below the fold on every platform.** The hero reserved `100svh` while sitting at y=129, so 129px of that was structurally below the fold and the last child was left with 6.25px of accidental slack. Because everything inside a vertically-centred block moves at half rate, padding tweaks are a 2:1 losing trade; sizing the hero to its real container is the only fix that scales. Measured slack after: +45.250 at 320, +60.125 at 345/352, +70.750 at 360/375/390, +85.625 at 414.

**Rejected:** a tolerance bump (asserts the CTA MAY sit below the fold, which is the negation of what the test proves, and encodes no principle so the next drift buys another bump) · `whitespace-nowrap` on the badge (trades a fold defect for horizontal overflow at 320) · branching the assertion on `clientWidth` (an assertion that asserts less on Linux is a rubber stamp). `docs/ci-flake-policy.md` does not apply: 3/3 identical failures at 744.375 is deterministic, not intermittent, so retries and quarantine are unavailable by construction.

**Also required:** any fold assertion waits for `[data-lazy-visible="pending"]` to reach 0 before reading geometry. A one-shot `boundingBox()` outside `expect` has no web-first retry, which is why this spec was order-dependent — cold it read 1431.25, warm it passed.

**Changes if:** the hero stops being preceded by chrome, in which case it can own the viewport again · or the supported minimum width drops below 320.

---

### D-312 · (issue #54, 2026-08-12) · A lazy placeholder reserves the box it declares — `SectionSkeleton`'s `height` is an exact box, and its padding lives on the inner div

**Decision:** `components/section-skeleton.tsx` sets `height` + `maxHeight` and clips its overflow; the `px-gutter py-section` padding sits on an INNER div. Declaring too much is as wrong as declaring too little. Accepted consequence: a call site declaring less than the intrinsic content clips its shimmer to eyebrow + title + the top of row 1 — the tree is `aria-hidden` decoration, and a truncated decoration is fine where a lying reservation is not.

**The padding placement is load-bearing, not style.** A border-box can never be shorter than its own padding. With `py-section` (`clamp(4rem,8vw,7rem)`, so at least 128px top+bottom) on the outer element, a declared 61px still rendered 136px — clipping alone does not fix it. Moving the padding inside the clipped box is what makes the declared height true at any value, down to 0. Anyone moving it back re-breaks 27 call sites silently.

**Why:** `height` used to be `minHeight` only, which made it a floor that never bound. Every one of Home's six placeholders rendered **826.5px** regardless of declaring `0px`, `56px`, `444px`, `340.4px` or `666px` — reserving ~697px more than the island that replaced it, against a real strip height of 129px. On a cold mobile load the hero painted at y=826.5 with the CTA off-screen, then jumped to y=0 (momentarily under the fixed navbar) before settling at y=129. `lazy-visible.tsx` documents "no CLS" as the design intent; the code did the opposite at mobile width, worst at the narrowest viewport because the skeleton rows are `grid-cols-1` below `sm`.

**Two corollaries found while fixing it, both required:**
- A `dynamic({ssr:false})` island rendered through `LazyVisible` needs BOTH a `LazyVisible` height and a matching `loading:` slot. They cover different gaps — pre-mount versus chunk-fetch. Home had three islands with both and two with neither.
- An island whose first render can return `null` must have its box reserved by its PARENT, not itself. `HomeTripStrip` returns `null` until its mount effect reads storage, so a self-reserved box collapses to 0 and re-expands. For the same reason the fixed-navbar clearance (`pt-16`) must never live inside a lazily-mounted island — that is why the hero briefly painted under the navbar.

**The gate is the deterministic one.** `e2e/polish-bundle.spec.ts` holds the chunks via the existing `throttleChunks` helper and asserts no placeholder exceeds its declared reservation; against the unfixed build it failed `expected <= 61, received 826.5`. A cold-CLS ceiling of 0.1 sits beside it, but it is explicitly the WEAKER gate: on a loopback server the swap lands inside one frame batch, so it passes on the broken build too. Keep the height check as the real guard and never let the CLS number stand in for it.

**Changes if:** the skeleton gains a genuinely variable-height variant, which would need its own component rather than making `height` a floor again.

---

### D-313 · LOCKED · Supersedes D-306 in part, revives D-016 in part · (issue #60, 2026-08-13, owner-ruled) · The countdown returns to calendar-accurate months; the reconciliation with `totalDays` D-306 bought is given back up; a latent defect in the revived algorithm is fixed, not just restored

**Decision.** `core/clock/countdown.ts` computes `months`/`weeks`/`days` from a calendar walk again — `differenceInMonths` + `addMonths` for whole months, `differenceInCalendarDays` for the sub-month residue, anchored on `startOfDay` with the same borrow of the partly-spent current day the hour computation already used. `WEEKS_SUPPRESSED_AT = 28` is REINSTATED: a residue of 28 days or more reads as raw days, never carried into a fourth week. `totalDays`, `hours`, `minutes` and `seconds` are UNTOUCHED — still `differenceInDays(target, now)` and the `remMs` residual anchored on `addDays(now, totalDays)`, exactly as D-306 left them. This was verified, not assumed: splicing the revived calendar walk onto the unmodified hour/totalDays half was checked by direct equivalence sweep (20,806 date pairs) plus a 132,000-pair boundary sweep once the guard below was in place, zero disagreements.

**Why.** The owner ruled on issue #60 that D-306's fixed-28-day month reads visibly wrong: Aug 13 → Dec 9 is 117-118 days, which a calendar reads as "3 months, 3 weeks, 4-5 days" and D-306's scheme read as "4 months, 5 days" — correct under D-306's own rule, but not what a calendar means by "month," and the remainder landing on exactly 0 weeks made it look like weeks had silently stopped being computed (it hadn't; issue #60 itself is a legible symptom of D-306 working as designed, not a code defect — see the investigation on issue #60 before this entry, kept for the record). The owner's ruling reopens exactly what D-016 originally chose and D-306 reversed.

**What is reinstated and why it does not reopen D-306's actual defect.** D-306's own text is explicit that the bug it fixed was the RENDERER showing a literal zero on screen ("29 days, 0 weeks" sitting there for a fortnight) — a display decision baked into the producer. That is fixed permanently and independently, at the renderer layer, in `hero-section.tsx`, `token-gate.tsx` and `flight-journey-card.tsx`, and D-313 does not touch it: those surfaces still filter zero-valued units before rendering, regardless of which month scheme the producer uses. `WEEKS_SUPPRESSED_AT` was never the defect — it is what stops "4 weeks" (a real, calendar-legal remainder once months vary in length) from being displayed as a bucket that reads like a month nobody carried. Reinstating it is restoring a correct rule that D-306 deleted only because it became structurally unreachable under a fixed 28-day month, not because it was wrong.

**A genuinely new defect was found reviving this, and D-313 is not a byte-for-byte restoration of D-016's original code because of it.** `differenceInMonths` and `addMonths` are not exact inverses: walking `anchor` forward by `differenceInMonths(walkTarget, anchor)` months can overshoot `walkTarget` by a day when the anchor's day-of-month (29, 30 or 31) does not exist in the month landed on. Concretely: `now` on the 29th–31st of some month, `target` on Feb 28 of a leap year — `addMonths` clamps the missing day-of-month down, and the clamp can land one day past `walkTarget`, producing a negative `dayRem` and from there negative weeks/days and `hours >= 24`. This is not exotic: a swept sample found the boundary is crossed on the order of 1 day in 10 across ordinary date ranges, and a target-focused sweep of 2025-2028 found 18,044 raw occurrences of the underlying `dayRem >= 28` condition, of which the overshoot specifically hits whenever `now`'s day-of-month exceeds the days in the month `addMonths` lands on. This defect was latent in D-016's original code the entire time it shipped and was never caught — it did not surface as a visible bug before D-306 replaced the algorithm for an unrelated reason, and it was found only because reviving the algorithm for D-313 prompted testing it against boundaries nobody had swept before. The fix: after computing `months` and `cursor = addMonths(anchor, months)`, a `while (cursor > walkTarget) { months -= 1; cursor = addMonths(anchor, months); }` guard walks back until the overshoot is corrected. A single `if` was verified insufficient as defense-in-depth (not proven necessary, but not proven safe either, and a `while` costs nothing extra against the swept cases). Do not delete this guard as "redundant" — it is the only thing standing between this file and a third countdown defect, from the opposite direction of D-306's.

**The reconciliation D-306 bought is given back up, on purpose, and this is the real cost of the ruling.** `months*28 + weeks*7 + days === totalDays` cannot hold for any fixed multiplier once months vary 28-31 days in length. This is visible on screen, not just an arithmetic footnote: `hero-section.tsx` renders the month/week/day grid and a separate ring reading `totalDays` ("days to go") in the same component frame, and they will generally disagree under calendar-accurate months (never in the owner's own cited example, generally elsewhere). This is accepted as ships-as-is — it is the exact tradeoff D-016 named and accepted the first time, the owner's ruling on issue #60 is understood to accept it again, and the ring's "days to go" caption is self-explaining, not silently misleading: it is a second, honestly-labeled number, not one number claiming to be another.

**A new accessibility defect the revert would otherwise have introduced, found and fixed in the same change.** `token-gate.tsx`'s `CompactCountdown` had `aria-label={\`Departure in ${cd.totalDays} days\`}` wrapping a `role="status"` region whose only VISIBLE content is the zero-suppressed months/weeks/days/h/m/s grid — there is no on-screen `totalDays` text anywhere in that component, unlike the hero's self-labeled ring. Once months stopped reconciling with `totalDays`, a screen reader would announce a figure that appears nowhere on screen and disagrees with what a sighted user reads, silently, on every render. This was not a defect under D-306 (grid and `totalDays` reconciled, so the announced number and the displayed grid always agreed) — it is new, introduced by this revert, caught before shipping. Fixed by deriving the `aria-label` from the same `units` array the grid renders (`units.map(u => \`${u.value} ${u.label}\`).join(', ')`), so the announced and rendered content are structurally the same data and cannot diverge again.

**The sum-back invariant survives, in a different shape, alongside a second, weaker, still-true property that must not be confused with the reconciliation given up above.** The invariant is now `now + addMonths(months) + addDays(weeks*7+days) + h:m:s === target` — the flat single `addDays` D-306 used cannot express a calendar month, so the month walk and the day/hour walk are separate steps again. Swept in `lib/__tests__/countdown-sum-back.test.ts` at 2,928 instants across a year, plus the leap-day boundary case specifically (200+ instants, 2027-11-29 through 2028-02-27 against a Feb 28 2028 target) and a 12,000-instant sweep across all twelve calendar month lengths. Separately, one D-306-era test survives on its own merits, not by oversight: `totalDays` still equals `differenceInDays(walkOnly(now, c), now)` — the whole-day distance from `now` to the date the breakdown's own walk claims to have reached. This is NOT the retired `months*N + weeks*7 + days === totalDays` multiplication; it is a self-consistency check that the breakdown's walk and the flat `totalDays` count apply the identical borrow to the identical target, and it holds because both are derived from the same `target`/`now` pair, not because a calendar month has a fixed length. Verified across the full sweep, a further 12,000-instant sweep, and the runtime's actual DST transitions before being kept rather than deleted under a literal reading of "remove the reconciliation."

**Changes if:** the design wants the reconciliation back, which reopens D-306 a second time and gives up calendar accuracy again — that pattern has now happened twice in the same ~140-line module in under a week, and a third reversal should look hard at whether the two properties (calendar accuracy, arithmetic reconciliation) can ever both hold and pick one durably rather than reverting again. Or a third distinct defect surfaces in this file, in which case sweep the boundary that found it the way this entry's leap-day guard was found, rather than patching the symptom.

---

### D-399 · LOCKED · Amends D-044 · (issue #39, 2026-08-14) · The release publishes `firestore.rules`; the live ruleset is the one in the tree of the last successful deploy; and it ships INERT until the owner arms it

> **Renumbered from D-314 (collision).** Issue #29's lifetime-visit ruling had also taken 314 and is cited from two dozen places under `trip/`; that entry keeps the number and this one moved.

**Decision.** `deploy.yml` gains a `publish-rules` job with `needs: build`, and `deploy` moves to `needs: publish-rules`. It runs `npx --yes firebase-tools@14 deploy --only firestore:rules --non-interactive` against the project named in the committed `.firebaserc`, authenticated by a service-account JSON written from repo secret `FIREBASE_SERVICE_ACCOUNT` to `$RUNNER_TEMP/sa.json` — never the workspace, which is the directory that gets uploaded to Pages. `ci.yml` gains an unconditional `rules-check` job that runs `scripts/rules-check.mjs` under `firebase emulators:exec --only firestore,auth --project demo-rules`. D-044's clause "we deploy it via the Firebase console or `firebase deploy --only firestore:rules`" is amended in place: the by-hand command is break-glass now, not the route.

**The contract, which is the actual deliverable and is worth more than the automation.** The live ruleset is the `firestore.rules` in the tree of the most recent successful deploy tag. That sentence is answerable offline, in one command, with no console and no credentials: `git show v<version>:firestore.rules`. It holds because D-134's `v<version>` tag is pushed only after `deploy-pages` succeeds and `publish-rules` is upstream of that job, so the existence of the tag implies the publish of that exact file. **It holds only once the secret is set, and not before** — read this paragraph together with the INERT section and ceiling 2 below, because until then the tag implies nothing about the live ruleset and this is the paragraph people will quote out of context. Before this change the honest answer to "what rules are live" was "whatever somebody last pasted into the console, probably", and no artifact in the repository could improve on it.

**Coupled to the RELEASE, never to `paths:` file-change detection, and the difference is not efficiency.** A `paths: ['firestore.rules']` trigger answers "did this file change in the repo". Everyone reads that answer as "is the live ruleset current". The two diverge silently in at least three ordinary ways: somebody edits a rule in the console, so the live ruleset changes while the file does not; an earlier publish fails and the next commit does not touch the file, so nothing ever retries; a release is cut from a branch that never carried the change, so the file is old in the tree that ships and unchanged relative to it. Each of those leaves a repository that looks correct and a project that is not. Publishing on every release costs one API call and makes that divergence unrepresentable.

**The two-sided invariant that decides WHEN a rules change may ship, and it is not symmetric.** The live ruleset must never be NARROWER than what any still-reachable client requires. Reachable is the operative word: this is an installed PWA with a service worker, so a device that has not opened the app since an earlier release is still running that release's bundle and still writing under it. A WIDENING change — one that permits everything the old rules permitted and more — may ship in the same release as the client that uses it, in either order, because no client is broken in the window. A NARROWING change must ship ONE RELEASE AFTER the client that satisfies it, so that every reachable client already writes the shape the tighter rules demand before the rules start refusing the old shape. Getting this backwards is not a degraded feature; it is a data-writing client that starts failing on a device nobody can reach to update.

**Why publish sits BEFORE deploy rather than after it.** A failed publish then ships nothing: the live client and the live ruleset stay the matched pair they already were, which is the same fail-closed idiom as `build: needs: [version-gate, checks]` (D-302, D-134). Ordered the other way, a failed publish leaves a NEW client running against OLD rules — the exact mismatch the invariant above exists to prevent, arrived at by an infrastructure hiccup rather than by a decision.

**The credential lives in `deploy.yml` and can never move into `ci.yml`, by D-302 clause 2.** A called workflow receives no secrets, and the `checks:` call passes no `secrets: inherit`. A `secrets.*` read in `ci.yml` therefore resolves normally on the pull-request path and to the EMPTY STRING WITH NO ERROR on the deploy path. For a publish step that is not a broken build, it is a silent no-op on exactly the path that matters, discovered whenever somebody next wonders why the live rules are stale. The split is structural: `ci.yml` proves the rules against an emulator and holds no credential, `deploy.yml` publishes them and is the only file that can read one.

**The publish is an unconditional overwrite, and the console drift it corrects is corrected SILENTLY.** There is no diff, no confirmation, no "rules unchanged" branch. Whatever is in the tree becomes what is live. The direct consequence is that the Firebase console is read-only for rules from here on: an emergency edit made there survives exactly until the next release and then vanishes, with no notification to whoever made it. That is stated in `README.md`, in `rule.md` and in the D-044 amendment, because an undocumented silent revert is a trap rather than a policy.

**It lands INERT, and that is a deliberate half-step rather than an unfinished one.** The `secrets` context is not readable from a job-level `if:` but is readable in `env:`, and `env` is readable from a step-level `if:`; the job therefore reads the secret into job-level `env` and branches in its steps. With no secret set it emits a `::warning::` and a `$GITHUB_STEP_SUMMARY` line saying the rules were NOT published and that the live ruleset is whatever was last deployed by hand, then exits 0 — nothing about today's behaviour changes. This is required, not tidiness: the v5.14.0 client has been live since 2026-08-10 writing member rosters into Firestore under the OLD permissive rules, so publishing the members-gated ruleset today could permanently lock out a traveller whose device has not opened the app since. Arming is an owner decision taken after looking at the live data — the narrowing half of the invariant above, applied to the one release that is already in flight.

**Proving the rules is a required CI job now, and its exit code is not the CLI's.** `rules-check` carries no `if:` at all: a condition on `github.event_name` would inherit the caller's event inside `workflow_call` and skip on the deploy path, which is D-302 clause 5's failure mode and D-305's successor rule ("fail toward running"). `deploy.yml` blocks on it through the existing `checks:` call rather than by naming it — a caller's `needs` may only name jobs declared in the caller's own file, so `needs: [version-gate, checks, rules-check]` is a parse error rather than a stricter gate, and it does not need to be one, because a called workflow succeeds or fails as a unit. One measured hazard is wired around: `firebase emulators:exec` returns exit code 2 even when the inner script exits 0 (measured twice locally, including with a trivial `node -e ''`; it logs "Script exited successfully (code 0)" and then errors while tearing the emulator down on SIGINT). The job therefore runs `node scripts/rules-check.mjs && touch "$RUNNER_TEMP/rules-ok"`, discards the CLI's exit code and asserts the sentinel file. Do not simplify that away: the bare command is a RED gate on GREEN rules, and a gate that fails on correct input is a gate that gets deleted.

**Owner action required to arm it, in order.** (1) BEFORE anything else, inspect the live `trips/{id}.members` rosters and confirm every real traveller's uid is present, because after the publish only an existing member can add anyone — a missing uid is not a support ticket, it is a person locked out of their own trip with no in-app route back in. (2) Create a service account on the `nepalxjapan` project and grant it `roles/firebaserules.admin`, that role and nothing wider; it needs no Firestore data access. (3) Store the JSON key as repository secret `FIREBASE_SERVICE_ACCOUNT`. The next release publishes.

**Five ceilings, named rather than fixed.** First, Google's Firebase Rules API is now on the critical path of EVERY client deploy: an outage there blocks shipping a UI fix that has nothing to do with the rules. Accepted for the same reason D-302 accepted `ci.yml` on the critical path, and with the same answer — there is deliberately no bypass knob, because it would be used the first bad night and normalised the second. Second, the inert path is green-with-a-warning, and a warning nobody reads is a gate nobody has: until the secret exists, this job proves only that the workflow runs. Third, `rules-check` proves the rules against the EMULATOR, never against the live project, so it structurally cannot catch a publish aimed at the wrong project — `.firebaserc` is the only thing standing there, which is why the publish step passes no `--project` and the target stays in one reviewable file. Fourth, if Pages fails after a successful publish, the live ruleset is ahead of the live client for one job's width; that window is safe only for a widening change, which is the invariant above restated as an operational risk instead of a rule. Fifth, `FIREBASE_SERVICE_ACCOUNT` is a long-lived Google credential sitting in a public repository's secret store, readable by any workflow this repository ever runs. A `firebase login:ci` token was considered and rejected as strictly worse: it is deprecated in the installed CLI and it carries full-account scope, where the service account can be held to `roles/firebaserules.admin` on one project.

**Why:** the rules ARE the authorization gate (D-044), and they were the last part of the security model that depended on somebody remembering. Issue #39 delivered the file and the eleven-phase harness and left the publish manual, which meant the repository could be right and the live project wrong with nothing in either able to detect it. Tying the publish to the release makes the deploy tag a truthful record of the live ruleset, and the emulator gate makes "green" mean something before it is published.

**Changes if:** a second Firebase project appears (a staging project), which turns `.firebaserc`'s single default into the wrong shape and needs an explicit per-environment target · or a narrowing rules change is wanted in the same release as its client, which this entry forbids and which would need a genuine two-phase release rather than an exception · or the service-account credential is judged too much standing risk for the payoff, in which case the fallback is not the console but Workload Identity Federation, which removes the long-lived key at the cost of setup this project has so far had no reason to carry.

### D-315 · Amends D-285 · (issue #6, 2026-08-14, owner-ruled) · Day one is NAMED New York; the airport data still says Syracuse, and `country` is still `nepal`

**Decision.** The default pack's first day (`2026-12-09`) has `city: 'New York'`. D-285 picked `Syracuse` on 2026-08-06 from the same facts and is amended, not corrected: the facts did not change, the owner's reading of them did. Issue #6's words are the ruling — *"That day is Syracuse, JFK and a plane, and most of it is the airport and the air."* The day leaves SYR at 05:30, sits at JFK T4 from 07:02, and is airborne out of JFK at 11:55, so New York is where the larger part of it is spent and it is the name a reader recognises. This entry is the amendment; D-285 is left in place unedited, per this file's convention.

**What D-285 decided that this does NOT touch, and it is the more load-bearing half.** `country` stays `'nepal'`. It is the LEG ID that drives `legCurrency` (`core/budget/model.ts`) and `offsetForCountry` (`core/dates/item-time.ts`), never a display label, and nothing about renaming a city gives it a reason to move. `countryLabel: 'USA'` stays, and the display-vs-leg separation D-285 flagged as unfinished — delivered since by `lib/leg-label.ts` — is what makes the day line read "New York, USA" rather than the "New York, Nepal" that the old hand-rolled `country === 'nepal' ? 'Nepal' : 'Japan'` ternary would have produced. A city rename is a one-field content edit precisely because that separation already exists.

**The boundary, which is the whole risk in this change: `Syracuse` meant two things and only one moved.** The day's displayed CITY is a label and it is now New York. The flight and airport DATA is fact and still says Syracuse: `lib/booking-data.ts` in full (`SYR`, `Syracuse Hancock Intl`, `fromSummary: 'Syracuse (SYR)'`, `'Outbound — Syracuse to Kathmandu'`, `'Flight home — Tokyo to Syracuse'`), the itinerary ITEM titles/locations/notes on Dec 9 and on the Jan 9 return, and `core/dates/item-time.ts`'s `EST` comment. The traveller really does board at SYR, and a repo that renamed those would be lying about a boarding pass to keep a header tidy. The Rome2Rio and Google-Flights deep links were verified to read `journey.fromSummary` (booking data) and not the day city, so `e2e/travel-essentials.spec.ts`, `e2e/flights-page.spec.ts` and `lib/__tests__/flight-deep-links.test.ts` keep their `Syracuse` URLs unchanged — checked at the call site (`components/travel-essentials-card.tsx`, `components/flight-journey-card.tsx`), not assumed.

**The `Syracuse` row in `CITY_COORDS` is KEPT, deliberately.** It is no longer a trip city, so nothing in the default pack reads it, and D-285's hard dependency (delete it and exactly three weather-coverage assertions fail) no longer binds. It stays anyway, and the custom-trip rule in `lib/city-coords.ts` is the WEAKER of the two reasons — the load-bearing one is stale saved data. **This rename is a no-op for anyone who has already planned on Dec 9.** Day-level fields come from the LOCAL side of `mergeDay` on snapshot ingest (`lib/itinerary-remote.ts:623`) and a seed swap never rewrites live saved data, so any device holding a saved or synced `2026-12-09` day doc keeps `city: 'Syracuse'` until that doc is rewritten. Nothing breaks for them — the header reads "Syracuse, USA", weather resolves, the pin resolves, and the digest size is unchanged because both names are eight characters — but the row is what keeps that true. Deleting it later on "nothing reads it any more" grounds would silently drop those devices' Dec-9 weather (`isKnownWeatherCity`) and their derived map pin (rung 5, `lib/itinerary-map.ts`). The table is also the one authored copy of these coordinates. `'New York'` is ADDED at JFK's coordinates (40.6413, -73.7781) rather than Manhattan's, because the weather and the derived map pin should both sit where the traveller physically is that day. The table goes 13 rows to 14; the canonical trip-city count stays 8.

**Everything downstream is a label pin and moved in the same commit, in the D-124/S112 lockstep this repo uses for a frozen boundary city:** the `sample-itinerary.golden.json` snapshot (`city` only — the item titles in it still say Syracuse), `core-clock.test.ts`, `trip-cities.test.ts`, `trip-cities-scoped.test.ts`, `leg-label.test.ts`, `itinerary-remote-sync.test.ts`, and `e2e/countdown.spec.ts`, `concierge.spec.ts`, `weather-tag.spec.ts`, `map-day-assign.spec.ts`, `map-trip-mode.spec.ts`. The two digest-size constants in `concierge-digest-s327.test.ts` did NOT move and are unchanged at 6610 / 9426, measured rather than assumed: the digest prints the bare `city`, and `"New York"` and `"Syracuse"` are both eight characters.

**`e2e/map-trip-mode.spec.ts` needed re-aiming rather than a string swap, and the reason is worth recording.** Its premise is "a trip city with NO curated marker is findable by name", which held for Syracuse only while Syracuse was a trip city. It is not one now — `cityHits` is derived from the days themselves — so the spec is re-pointed at New York, testid `map-search-result-city-new-york`. Its sanity assertion that the load frame is nowhere near the target still holds by a wide margin: the frame is over Nepal→Japan at positive longitude and JFK is at -73.8°, with the nearest other searchable place at 83°E. One incidental consequence: the query `New York` now also matches two Day-1 plan titles, where `Syracuse` matched one (`n1-1`, whose title names both airports), and the spec addresses the city row by testid because `cityHits` sort ahead of `stopHits`.

**Why:** the app named day one for a place the traveller passes through in the first ninety minutes of a nineteen-hour day. D-285 fixed the worse error (it used to say Kathmandu, a city the traveller does not reach until Dec 10) and stopped one step short.

**Changes if:** the booked outbound stops routing through JFK, which would make New York as wrong as Kathmandu was · or the first day changes · or a `DayPlan` ever needs to name more than one city, which is the real shape of "Syracuse, JFK and the air" and which no amount of picking between them expresses.
---

### D-317 · (issue #9, 2026-08-14) · A spec for a gracefully-degrading path asserts the wiring POSITIVELY and never branches on it — `e2e/place-import.spec.ts` is wired-only, and a bare local build now fails it instead of passing hollow

**Decision:** a spec covering a path that degrades gracefully must not be written as `if (wired) { assert } else { fallback }`. `resolvePlaceLink` is TOTAL — it returns `null` on an unconfigured origin, a 404, a rejected fetch and a non-JSON body alike (`lib/place-resolve.ts:50`, `:62-64`, `:71-73`) — so a disconnected build and a broken one render the identical benign UI: `Couldn't read this link`, manual entry, feature still works. A branch on that state makes the spec green on exactly the builds it exists to catch.

`e2e/place-import.spec.ts` had that shape, and worse: the assertion that the resolver stub was hit lived INSIDE the `if (found)` branch, gated on the very thing it was meant to prove, and the S349 lat/lng pin check — the file's strongest assertion — sat behind the same gate. The 500-degradation test asserted `found === false`, which is what a dormant build produces anyway, so it passed strictly more easily unwired than wired. The file's own header documented the branching as deliberate dual-build support; it was the receipt.

**Both halves are now asserted positively:** the configured endpoint was actually requested (`hits.count > 0`) AND the answer was parsed and applied (`found === true`), with distinct failure messages, because "no request went out" is a build-config bug and "request went out, answer discarded" is a client bug.

**The unit half closes a second, different hole.** Every fetch double in `lib/__tests__/place-resolve.test.ts` ignored its URL argument, so the suite was satisfied by any double answering any address. It now asserts the exact address. Note precisely what that does and does not buy, because the first draft of the comment overstated it: it does NOT catch a misconfigured `NEXT_PUBLIC_CONCIERGE_URL` — the test injects `origin` directly and never reads the env var, and `deploy.yml:120` is what hard-fails a path-carrying value. What it catches is drift in the URL SHAPE, which matters because `deploy.yml:118-119` justifies its own guard by asserting that `lib/place-resolve.ts` builds `<value>/resolve`. Change the shape and that guard's rationale goes stale silently.

**Cost, accepted deliberately:** the e2e file is now build-config-dependent. A bare `npm run build` without `NEXT_PUBLIC_CONCIERGE_URL` fails four tests rather than passing hollow. That is safe while every CI build sets it (`ci.yml:86`, `ci.yml:201`) and the deploy hard-fails an empty or path-carrying value (`deploy.yml:112`, `:120`); the e2e job runs only on the PR into `dev`, which is wired. The dormant deploy-time build is no longer a legitimate state, so the branch this removes was defending something that can no longer ship.

**Why:** a test that cannot fail is worse than no test, because it reports safety it never checked. The unit half was falsified before landing — breaking the endpoint left all six other assertions green and only the new one red, and removing the trailing-slash strip that `deploy.yml:123` explicitly relies on turned exactly one test red. The e2e half has NOT been run and is not claimed as proven; it must be exercised on `dev`.

**Changes if:** a legitimate reason appears to ship or test a build with the concierge deliberately unconfigured, which would need a separate dormant-build spec asserting the manual path on purpose — not a branch reintroduced into this one.
---

### D-319 · Supersedes the glyph clause of D-079 (LOCKED) · Corrects D-286 · (issue #8, 2026-08-14) · The map's SDF glyphs are self-hosted and precached; the numbered day markers now survive offline, and tiles still do not

**Decision:** `glyphs` is `withBasePath('/font/{fontstack}/{range}.pbf')`, served from `trip/public/font/`, and the two PBFs are precached with the app shell. `demotiles.maplibre.org` is off the runtime path entirely.

**What this does to D-079, which is LOCKED and named that URL explicitly.** D-079's hard rule is "free and keyless only". That rule is untouched and is now satisfied with no third party at all — this is a tightening, not a loosening, which is the only reason a locked entry can be superseded in part without a fresh owner ruling. Its glyph URL clause is superseded and its "self-hosting tiles and glyphs is a possible future slice, not built" note is discharged FOR GLYPHS. **Tiles are unchanged, still `basemaps.cartocdn.com`, still cross-origin, still uncached** — bulk-caching a free keyless CDN remains out of bounds.

**Measured, because the issue said the byte count decides and not taste.** Both map label fields are numeric — `point_count_abbreviated` (`components/trip-map.tsx:712`) and `day` (`:783`) — so range 0-255 of two stacks is the entire request surface the map can reach. Item titles contain em-dashes and arrows but render in HTML popups, never as SDF glyphs. Regular 76,580 B + Bold 81,170 B = **157,750 B (154.05 KiB)**, downloaded and weighed rather than estimated.

**Why it went beyond the byte count.** `scripts/gen-sw.mjs:903` returns every cross-origin request untouched as its FIRST routing rule, so the demotiles glyphs could never be cached. Offline, the numbered day markers rendered blank — the app was shipping the pin-and-route layer D-286 promises with its numbers missing. Self-hosting is therefore a defect fix, not only a supply-chain preference, and that is what settled a decision the byte count alone would have left arguable.

**The path shape looks wrong and is not.** MapLibre substitutes `{fontstack}` with a raw `String.replace` and no `encodeURIComponent` (`loadGlyphRange` in the installed `maplibre-gl` dist — verified in the dependency, not assumed), so the on-disk directories carry LITERAL SPACES. The browser percent-encodes on the wire because space is in the WHATWG path encode set; `scripts/serve-out.mjs:87` decodes, and GitHub Pages serves the `upload-pages-artifact` tar byte-verbatim with `.nojekyll` present, so the CDN resolves it the same way. **Renaming those directories without renaming `text-font` in `trip-map.tsx` breaks the map silently, as unlabelled markers.**

**Corrects D-286 (owner-ruled), whose text asserted the opposite in three places.** Its "no marker/cluster numbers (the `glyphs` endpoint is cross-origin too)" clause is now false and has been struck in place with a pointer here; the two "no tile and no glyph has ever entered a cache this app controls" sentences are annotated as historical. Precache goes 158 → 160 entries. **The copy rule survives intact and is the important half: user-facing strings may now say the numbered pins survive offline, and still may NOT say the map works offline.** Tiles are what that rule was always about.

**Why:** an entry left asserting the opposite of shipped behaviour is the dangling-pointer failure this file has already been burned by once, and D-079 being locked is exactly why the supersession is written rather than the clause quietly edited.

**Changes if:** a symbol layer ever renders a non-numeric `text-field`, which makes 0-255 insufficient — the answer is to add the range, never to go back to a third-party host · or a multi-font `text-font` stack is introduced, which needs its own comma-named directory · or tiles are ever self-hosted, which is a different decision with a different cost and is NOT authorised by this one.
---

### D-318 · (issue #20, 2026-08-14) · The night-before readiness check is a machine-checked block on `/checklist`, not a new route — it never touches the network, never reports a pass it did not verify, and its map row says "map shell", never "offline map"

**Decision:** issue #20's "ready to go?" screen ships as a second island on `/checklist` rather than a route of its own. That page's eyebrow already reads "Before you fly" and it already carries the 8-item human-attested day-zero list (`core/docs/model.ts:67-76`); this is the machine-checked complement of exactly that list, in the same user moment. A new route would have needed registering in `app/more/more-list.tsx`'s `GROUPS` and would have split "am I ready?" across two surfaces, against D-231's fixed 5-tab mobile IA.

**Nothing here touches the network, which is the issue's own requirement and not merely a nicety.** All four checks read local facts: Cache Storage for the offline install, `navigator.storage.estimate()` for room, `Intl`/`Date` against the trip's own leg offsets for the clock, and `outboxSnapshot()` via `useSyncStatus()` for unsent changes. `hasPendingWrites` was deliberately NOT used — it is per-snapshot and per-domain and exists for own-echo suppression; the outbox count is the durable, reload-surviving, cross-domain fact (D-193).

**The map row is bound by D-286 and says "map shell".** There is no offline map and there is not going to be one: basemap tiles are cross-origin and the service worker returns cross-origin requests untouched, so tiles are never cached, and offline PMTiles is a CLOSED NO-GO (D-197 — 180 MB–3.7 GB against a 100 MB cap). What is precached is the map ENGINE. The row therefore reports whether the engine is in the offline install, and its passing copy says the map background still needs a connection. A test pins this: the passing string must contain "pins and your route" and "needs a connection", and must not contain "offline map", "map works offline" or "map tiles". Without that test this is a style note; with it, "improving" the copy fails a PR.

**No branch returns `ok` on missing information.** `caches` absent, `keys()` throwing, `navigator.storage` absent, `estimate` not a function, `estimate()` rejecting, an unusable `{usage,quota}`, or a trip with no geography all render "couldn't check". A readiness screen that reports a pass it never verified is worse than no screen at all, because it is consulted precisely when there is no time left to discover otherwise. Each of those paths is asserted, and the component test runs under jsdom — which has neither the Cache API nor StorageManager — and asserts the tally reads "couldn't be checked" rather than passing.

**The `?today=` simulation gets its own row, and the zone check reads the REAL clock.** `lib/trip-now.ts`'s override makes `getNow()` return local noon of a faked day, so a readiness screen built the obvious way would confidently report a correct clock while the clock is deliberately fake — the one failure mode this surface must not have. The comparison uses `new Date()` directly, and when the override is set a separate visible row says so and names the escape.

**A product call, recorded because it is one and not an implementation detail:** a phone on home time is `ok` before the trip window and `attention` inside it. The night before flying, a phone on home time is the normal state; failing every traveller for it trains them to ignore the screen, which costs more than the case it catches.

**One ceiling, stated in the UI itself rather than only here: absolute clock correctness is not locally answerable.** A device forty minutes slow but on the right zone reads as "on trip time". Detecting that needs a trusted time source, i.e. a network, which this issue forbids. Every clock variant's copy ends by saying offline we can only compare time zones. The HLC skew clamp is NOT a clock check and was not touched — it absorbs a peer's clock, per D-228.

`QUOTA_WARN_THRESHOLD` moved to `lib/preflight.ts` and `components/storage-persistence.tsx` now imports it, so the 90% toast and the 90% readiness row cannot drift apart.

**Numbered 318 because 315, 316 and 317 are claimed by unmerged branches** — D-315 by `day-one-new-york-lax` (#6), D-316 by BOTH `overlap-guard-lax` (#18) and `design-tokens-lax` (#23), which was a genuine double-claim; the palette entry is D-400 now, and D-317 by `assistant-test-guard-lax` (#9).

**Why:** the things worth confirming the night before are exactly the things that cannot be confirmed once you are airborne, so the check has to work with no network and has to be honest about what it does not know.

**Changes if:** a real offline basemap ever ships, which would make the map row's careful wording wrong in the other direction and reopens D-197 · or a trusted local time source appears (a signed timestamp riding an existing payload), which would let the clock row answer absolutely rather than by zone · or `persisted()` is judged worth a fifth row, which is a different fact from storage room and was deliberately left out.
---

### D-400 · Implements D-291 · Amends D-292 and D-293 in part · (issue #23, 2026-08-14) · The merged palette lands as a token layer only: 516 accent sites and 122 glass sites repaint from two files, and the "RULED, NO CODE" note on D-291 is retired for the tokens alone

> **Renumbered from D-316 (collision).** Issue #18's overlap-guard ruling had also taken 316 and is cited from about forty places under `trip/`; that entry keeps the number. Nothing outside this file cited the palette entry, so this is the side that moved.

**This entry originally took D-316 and not D-315 deliberately.** D-315 was claimed the same day by the issue #6 day-one ruling, in flight on another branch when this landed. The gap closes when that merges; a duplicate id carrying unrelated content would have been worse than a hole.

**What shipped.** The token layer D-291 ruled and never got: canvas moves from the neutral charcoal `#0b0c0e` to aubergine `#100C1A`, the chrome accent moves from cyan `189 90% 60%` to marigold `#FFC43D`, the country gradients become real tokens (Nepal `#FF8A3D → #FFC43D`, Japan `#FF8FC7 → #C08CFF`), the radius range is un-flattened, the type scale's three downward re-points are removed, and the shadow, glow and motion variables are re-valued. Two files carry almost all of it: `trip/app/globals.css` and `trip/tailwind.config.ts`.

**The leverage is the reason this went first, and it is measured, not asserted.** `ring-ring` (304 sites), `bg-primary` (128) and `text-primary` (84) all resolve through `--primary`/`--ring`, so one token edit repaints **516 sites** of rendered UI — counted across `app/`, `components/`, `lib/`, `hooks/` and `core/`, deliberately excluding `e2e/`, where a couple of the same strings appear as test selectors rather than as anything a user sees. The glass recipes carry **122 consumers** (`.glass-card` 67, `.glass-card-dark` 18, `.glass-panel` 18, `.glass-subtle` 8, `.glass-nepal` 5, `.glass-japan` 5, `.sheet-surface` 2), so seven class bodies repaint all of them. Those counts were recounted twice and disagreed the first time — an earlier pass reported 105 and it was wrong; the figures here are the ones that survived a third count. **No component's markup or class names were edited.** That property is what D-078 and the S323 de-glass bought, and it still holds. The non-token files that did change are value mirrors of the palette, not components: `lib/token-auth.ts` (a hand-synced copy of the six brand hexes), `hooks/use-presence.ts`, two unit tests that pin those hexes, and the five places that hardcode the canvas outside the token layer — three for the PWA chrome (`app/layout.tsx`, `scripts/gen-sw.mjs`, `scripts/gen-icons.mjs`, which `layout.tsx`'s own comment requires to agree), the root error boundary's inline `background` (`app/global-error.tsx`), and the map's surface copies (`lib/map-style.ts`'s `BRAND.navy900`, plus a `BRAND.navy800` still carrying `#111640` from the palette *before* the charcoal, painting the attribution pill). **`scripts/gen-icons.mjs` is a manual one-off, not part of the build**, so the committed PNGs under `trip/public/` keep the retired hex until it is re-run — a maskable icon pads with the background, so until then an installed app shows a charcoal square inside an aubergine splash. That re-run is owed on `dev`, where the image toolchain is installed.

**`/map`'s pin palette is the one thing this slice found and deliberately did not fix.** `lib/map-style.ts`'s `CATEGORY_COLOR` mirrors the Tailwind brand scales, and `lib/__tests__/map-category-mirror.test.ts` enforces that mirror by hex equality, plus a rule that a category hue must sit at least 30 degrees from the interaction accent. That second rule is **narrower than it sounds and the `/map` slice should not misread it**: the hue test at `map-category-mirror.test.ts:71-87` is applied to `Day Trip` alone, not to all seven categories. The retired `gold-500 #d4a843` and marigold `#FFC43D` are **both hue 41.8 — a delta of exactly 0.0**, measured, so under the merged palette the `Attraction` pin lands precisely on top of the interaction signal. That is true whether or not the 500 step moves, because the retired gold was already sitting on the hue the new accent occupies; freezing the step neither causes the collision nor avoids it. The guard does not catch it: it compares against a hardcoded `189`, the hue of the cyan this entry retires, so it will keep passing against a colour that no longer exists. **The 400 steps therefore carry the merged palette (the chrome — 118 occurrences across the three families: `gold-400` 37, `sakura-400` 45, `sakura-300` 2, `himalaya-400` 34) and the 500 steps are frozen at their retired values**, which keeps the mirror true and every test green. The cost, named rather than hidden: 13 `gold-500`, 13 `himalaya-500` and 5 `sakura-500` sites pair a retired-palette wash with marigold text until the `/map` and badge slices sweep them. Fixing the guard honestly would make it fail, and the only fix for that failure is a `/map` palette decision — which D-292 already records as an open question, `/map` being a route it asserted into a tier without designing. It is not resolved inside a token change.

**The full `/map` inventory, because "the Attraction hue" understates it and a later slice will start from this paragraph.** `lib/map-style.ts` has two *surface* copies, which this slice DID fix because a canvas copy needs no design decision: `BRAND.navy900` and the pre-charcoal `BRAND.navy800`. It also has **brand hues that this slice deliberately froze** alongside the 500 steps — `BRAND.gold400 #f0c760` driving the route line, stop stroke, label and marker stroke (6 paint sites), and `BRAND.sakura400 #f7a0b3` — consumed across `components/trip-map.tsx`. The rule the `BRAND` object now carries in a comment: **surfaces follow the canvas, brand hues wait for the `/map` palette decision.** A second instance of the same collision lives outside `/map` entirely and is recorded here so it is not rediscovered: `components/flight-journey-card.tsx:25-33` argues in its header comment that content hues must sit 30 degrees or more from an interaction signal at hue 189, then picks a 60–160 degree band. The signal is now hue 42, and its `bg-amber-500` (hue 45) is three degrees off it, driving the "Departing today" and tight-layover vocabularies. Component edit, so out of scope here; it belongs with the badge sweep.

**The names all survive; only the values move.** `--navy-900/-800/-700` keep their names on an aubergine ramp, which makes them a misnomer for the second time (S353 made them one first, in the other direction) — renaming is still forbidden, because `--surface*`, `.home-nav`, the MapLibre attribution pill and the reduced-transparency nav fallback all reference them. One channel is genuinely new, `--navy-850`/`--surface-low`, because the merged palette has four surface steps where the old ramp had three, and `.glass-subtle` is what needed the fourth.

**THE INK RULE, and it is the one a later change is most likely to break.** Never white text on a saturated fill, always `--on-accent` `#140F20`. White on marigold measures **1.59:1**. This is why `--primary-foreground` and `--accent-foreground` both move to the near-black ink rather than staying light, and it is why `trip/scripts/contrast-tokens.mjs` carries four INVERTED guards that must keep failing — a harness asserting those stay below 4.5 is what makes the rule enforceable instead of a style note.

**The type scale was authored against a 16px root and this app runs 17px** (`html { font-size: 106.25% }`), so every `rem` renders 6.25% larger here than in the evidence the direction was picked from. Two options existed: keep the values and re-run the overflow matrix, or divide every `rem` by 1.0625 to preserve the rendered pixel sizes. **Option one was taken** — the larger scale serves the goal the ruling was written for, and the 17px root is a deliberate prior decision that should not be silently undone by a type change. The cost is real and is not paid yet: **21 bare sites change at 360px** (`text-xl` 9, `text-3xl` 11, `text-5xl` 1 — every responsive use of the three is `sm:`-prefixed and cannot fire at that width; a twelfth `text-3xl` match is the doc comment at `components/section-heading.tsx:8` and renders nothing), and the 0-overflow matrix at 360/390/414 is owed on `dev`.

**The passport and photo-engine tokens are declared with no consumers, on purpose.** `--paper`, `--on-paper`, `--paper-lo`, the three inks, the binding edge and the duotone/scrim set have zero call sites today; issues #5 and #3 are what will read them. F-4 in the source direction is the reason they are declared rather than deferred: the prototype's only ink consumer read `var(--ink-nepal, #B3123C)` against a variable that was never declared, so the fallback painted, and the fallback carried the **pre-D-294** red. A `var()` fallback that silently ships a superseded value is worse than no fallback. Consumers must not carry one.

**The no-consumer set is much wider than those two groups, and the reason matters more than the list.** Also at zero call sites today: `--radius-sm`, `--border-ui`, `--tap`, `--shell`, `--stack`, all six accents and all six lips, all three text tiers, `--on-accent`, all four `--grad-*`, `--glow-japan`, `--glow-live`, `--shadow-paper`, `--duration-draw`, `--duration-loop-kb`, `--ease-inout`, the three brand HSL vars, and `--hairline`, which this slice emptied by moving all six glass recipes onto `--border`. Keeping them is the name-stability rule plus the F-4 trap above. **The sharp edge is not the dead tokens, it is the live duplicates they create:** `--primary: 42 100% 62%` and `--marigold: #FFC43D` are the same colour declared twice in the same file with nothing tying them together, and the same is true of `--foreground`/`--text-hi`, `--muted-foreground`/`--text-lo` and `--secondary`/`--navy-850`. This file warns about hand-synced copies three times and then makes six more. It is unavoidable in plain CSS — a hex cannot be fed into an `hsl()` triplet slot — so the mitigation is that `contrast-tokens.mjs` prints a hex-to-HSL table for exactly these pairs, and it must be re-read whenever one side moves.

**The radius range is un-flattened at the top and slightly MORE flattened at the bottom**, which the phrase "restored radius range" hides. Before: 4.5 / 6.5 / 8.5 / 12px across `rounded-sm/md/lg/xl` — four distinct steps. After: 8 / 10 / 12 / 12 — three, because `rounded-lg` and `rounded-xl` now both land on 12px, the ruled chip and input radius. Moving `--radius` was unavoidable: `rounded-lg/md/sm` derive from it by `calc`, so the only alternative was editing 225 class names, which is the one thing this slice may not do. Recorded so nobody reads the top-end change and assumes the whole ramp got its steps back. A related trap left standing: `--radius-sm` is now both dead and *contradictory* — declared at 6px while `rounded-sm` resolves through `calc(var(--radius) - 4px)` to 8px, where the old comment justified the token's existence precisely by the two never being able to disagree.

**What did NOT ship, so a reader does not conclude the redesign is done.** The `text-white/NN` sweep (716 sites, issue #27) is untouched and its AA floor block stays exactly where it is — verified survivable on the new canvas, worst realistic case dropping 6.28:1 to **5.67:1**, still clear of AA, which is what makes deferring it safe rather than lucky. The motion *system* — D-293's session ledger, the one-loop-per-surface counter, the tier gate — is issue #24; only the variables land here. The loudness gradient of D-292 is not enforced anywhere yet. The front door (#25), home and hero (#26), page headers (#3) and the passport page (#5) are all still to come. D-291's "RULED, NO CODE" annotation is therefore retired **for the token layer only** and remains accurate for everything else it describes.

**F-8 is accepted with its ceiling named.** `--shadow-sm` and `--shadow-lg` return to black blurs on a near-black canvas — the exact thing S353 replaced with a hairline ring, and the exact thing D-294's own reasoning calls the first thing to disappear outdoors. They are kept because they are in the locked direction and they do add a little depth under a raised card, but they carry almost no separation alone. `--border` (1.99:1) and `--border-ui` (4.94:1) are what actually define an edge, so **every glass recipe keeps a border** and no surface may ever separate by shadow alone.

**Evidence:** `trip/scripts/contrast-tokens.mjs`, dependency-free and exiting non-zero on failure, measures 71 pairings plus the 4 inverted ink guards, and is wired into `ci.yml` beside `marker-check`, ahead of `npm install`, because both are dependency-free — a pinned mirror of the token values that nothing runs would enforce nothing. The three text tiers measure 19.27 / 11.75 / 7.43 on the canvas, with the tightest pair in the whole system at 5.59:1 on `--surface-3` — 24% of headroom on the worst case. Marigold on the new canvas measures 12.13:1 against the retired cyan's 11.59:1, so the 516 repainted sites gain contrast rather than lose it. The tightest number anywhere in the palette is `himalaya-600 #C2692E` at **4.91:1**, 9% over the floor, which is why it and the other two shades asserted only in prose (`gold-600` 6.00, `sakura-300` 11.50) were added to the harness rather than left as comments.

**Why:** doing the token layer once, first, is what stops the dozen surfaces still to be designed from each inventing their own values — which is exactly how the palette this one replaces ended up with gold copy-pasted as `rgba(240,199,96,…)` into eight page files and a drifted `#f4c46b` in two more.

**Changes if:** the 0-overflow matrix at 360/390/414 fails on `dev`, which re-opens the type-scale choice above and makes option two (divide by 1.0625) the fallback rather than a new decision · or a return to a single route-independent accent is wanted, which re-opens every country gradient · or `--paper` is ever re-valued, in which case `--paper-lo` must be re-measured first, because it is the ink with the least headroom and it binds before the others · or `/map` gets its palette decision, which unfreezes the three 500 steps, updates the `CATEGORY_COLOR` mirror in the same commit, and should re-point `map-category-mirror.test.ts`'s hue guard at the live accent token instead of the hardcoded `189` it still carries.
---

### D-316 · LOCKED · Amends D-142 (retires one clause, widens another) · (issue #18, 2026-08-14, owner-instructed) · Overlapping plans are refused at the intent layer: the free-text duration is derived at read, one predicate feeds both the badge and the block, and the guard is scoped to the write that moves an item's time footprint

**Taken under two authorities, and they are not the same authority.** The first is D-142's own `Changes if:` trigger — "durations become near-universal on items". They are: all 158 `duration` strings in `core/content/itinerary.ts` parse under the grammar below, 158/158, asserted in `lib/__tests__/sort-items-by-time.test.ts`. That trigger authorizes REVISITING the clause and nothing more; D-142 named a gap view as the example consequence, not a block, so citing the trigger alone to justify blocking would overclaim it. The second is the owner instruction of 2026-08-14 on issue #18: **no two plans may collide**, stated as a MUST. That is what authorizes refusing a write. Both are needed and both are recorded here separately, because a later reader who finds only one of them will misjudge how much of this entry was a design choice and how much was a ruling.

**One clause of D-142 is retired outright — "a warn-only badge, never blocking" — and one more is widened rather than retired.** Everything else in D-142 stays LOCKED and is untouched. Its sort/stability half — `sortItemsByTime` pure, view-level, non-destructive, untimed items sinking stably, stored manual order remaining the persisted truth with zero writes (D-018) — is unchanged. Its overlap RULE keeps its SHAPE — half-open, so touching edges never collide, judged on the absolute instant (S377/S391), requiring both a start and a positive duration — but its INPUT is widened from `durationMinutes` alone to the duration derived from the free text (Part 1), which is a behavioural widening of the badge and is why this amends a clause and a half rather than exactly one. The amber clash badge is not replaced by the block; it stays, and it now has something to show — before this change `clashingItemIds` read `item.durationMinutes` directly, which 0 of the 158 seed items carry, so the badge warned about nothing and could not fire at all. From here it is the surface that reports the overlaps this guard deliberately lets live.

**Part 1 — derivation at READ, no migration, no seed re-authoring.** `core/dates/item-time.ts` gains `parseDurationText` and `effectiveDurationMinutes`, the latter mirroring `effectiveStartMinutes` exactly: a valid positive-integer `durationMinutes` wins, else the free-text `duration` is parsed, else `undefined`. The grammar is exactly what the data holds and what `lib/time-picker-format.ts::formatDurationText` emits, nothing wider — `<h>h` with an optional decimal and an optional trailing `<m>m` ('1h', '1.5h', '3.25h', '14h 55m'), or bare minutes ('45m', '30min') — case-insensitive and trimmed. Anything else, including anything resolving to zero or less, returns `undefined`: that item then has no span, can never clash, and can never block. Permissive failure, never a throw, never a log, never a default — the same choice D-139 made for `time`. There is deliberately NO v5→v6 migration and NO hand-authored `durationMinutes` on 158 items: D-139 locks "the migration never sets `durationMinutes`" and D-095 forbids reordering shipped steps, and a derived value cannot drift from the text the way a backfilled one can. `parseTimeString` was NOT widened — it is shared with the v4→v5 migration and both call sites must keep agreeing.

**Part 2 — one predicate, one truth.** The interval construction is extracted into a file-local `toInterval` in `lib/sort-items-by-time.ts`, and BOTH `clashingItemIds` (the badge) and the new `firstClashWith` (the block) call it. This names an abstraction that already existed rather than adding one. Two predicates would eventually disagree, and a badge that contradicts the refusal the user just hit is worse than either behaviour on its own. `firstClashWith` skips the candidate's own id (an edit-in-place must not collide with its own stored row) and tombstones, and returns `undefined` for an untimed candidate, one with no duration, or a multi-day span.

**Part 3 — hard refuse, no override, DELTA-SCOPED.** The guard runs only when the write moves the item's time footprint: `nextStart !== prevStart || nextDuration !== prevDuration || nextDate !== prevDate || nextEndDate !== prevEndDate` — `endDate` is in there because it decides whether the item participates in the predicate at all, so turning a multi-day span OFF converts an exempt span into a plain interval while leaving every other field untouched — compared on the EFFECTIVE values so that re-saving a legacy-text item through the picker (which dual-writes `startMinutes`/`durationMinutes` beside text that already said the same thing) does not count as a change. That one boolean is the entire grandfathering mechanism: every overlap already on disk survives and stays editable, while every new collision is impossible. This is not a nicety — the shipped content itself contains three DELIBERATE containments (lunch inside the Universal Studios day, lunch inside the Shinsekai flex block, the countdown inside the New Year's Eve club block), and a literal "no two intervals overlap" ban would make the app's own content illegal to edit. A new item has no previous footprint and is therefore always guarded. Five surfaces are guarded: the calendar's `ItemEditor` save, the add-to-plan dialog's confirm (both its add branch and its move-to-another-day branch), duplicate-to-day, bulk move and copy day; the last two are all-or-nothing, naming the first offender, which preserves `moveItems`' single-commit semantics and its undo inverse. Quick-add is NOT guarded (it structurally cannot write a duration) and drag/drop is NOT guarded (reorder writes only `orderedIds`, and the cross-day branch is unreachable). **There is no "Save anyway".** The escape hatch already exists in the data model and the refusal copy names it: clear the item's duration and it stops participating.

**The guard lives at the INTENT layer, never in `commit()`, and that is load-bearing rather than stylistic.** Putting it in `hooks/use-itinerary.ts::commit` is the smaller diff and is the trap: that path also carries sync merge, `restorePlans`, `restoreDay` and vault import, where a refusal would silently drop a peer's data. A guard that protects an invariant by deleting somebody else's write is not a guard.

**The known ceiling, stated plainly: this meets the MUST for every local authoring path and CANNOT meet it for sync merge or vault import.** Two devices offline can each write an item that is legal where it was written and collides once the two sets merge; the same is true of an imported vault. Refusing an inbound item there would lose data, which is strictly worse than the overlap, so those land and show the amber badge — which is the second reason the badge is kept rather than replaced. "No two plans may collide" is therefore enforced at every authoring surface this slice guards, and reported rather than prevented at the two points it does not. That second ceiling is temporary and is NOT the same as the one above: `components/concierge-chat.tsx::confirmOp` is a point where a person authors a write, and `lib/concierge-ops.ts::applyOp` writes `startMinutes`/`durationMinutes` on `addItem`/`updateItem` and changes the day on `moveItem`, so three of its four verbs can still mint a collision through the concierge's Confirm. That is a scope boundary of this slice, deferred to issue #19, where the sync-merge/vault-import ceiling is permanent and by design.

**Addendum (issue #19, 2026-08-14): the temporary ceiling above is now closed. One permanent ceiling remains.** The concierge's Confirm is guarded: `confirmOp` (`components/concierge-chat.tsx`) runs a new pure `clashForOp` (`lib/concierge-ops.ts`) before `applyOp`, and on a clash it applies nothing, leaves the chip unresolved, and names the item and window it collides with. This addendum is written *inside* D-316 rather than as a new entry deliberately, following D-262's reasoning: a ceiling closed in a different entry from the one that declares it is the dangling-pointer class, and the person reading about the ceiling is reading *this* entry.

**The guard is at `confirmOp` and NOT in `isValidOp`, which was the first design and was wrong.** `validateOps` filters at chip-render time and drops failing ops SILENTLY — the contract at `concierge-ops.ts:6-7` requires it, so that one bad op cannot nuke a good reply. A conflict rule there would make the conflicting suggestion simply vanish from the chat, which is the exact inverse of what issue #19 asks for: *"it should say so, ask how you want to resolve it … and not add anything until that's settled."* Silence is the one behaviour that requirement forbids. `isValidOp`'s eight rules and the silent-drop contract are untouched.

`clashForOp` reuses `firstClashWith` and `timeFootprintChanged` rather than adding a predicate, so the concierge, the badge and the five surfaces above can never disagree about what an overlap is. `applyOp`'s `addItem` construction was extracted into a shared `itemFromAddOp` so that the interval CHECKED is the item WRITTEN — without it the two could drift on `endDate`, which is the field deciding whether an item participates at all. `updateItem` is footprint-scoped through `timeFootprintChanged` rather than merely testing whether the patch carries time fields: a patch that re-states the time an item already effectively has must stay editable, or the three deliberate containments in the shipped seed become unpatchable by the assistant, which would contradict Part 3 above.

**What this does NOT deliver, stated rather than implied: the resolution UI issue #19 describes.** The assistant refuses and explains; it does not yet offer "move the new one" or "change the existing one" as actions. Both are slice-sized, not one-liners — `ItemEditor` is a non-exported component bound to the calendar page's own `selectedDate` and save handler, and re-timing a proposal in place needs an inline picker plus a mutated-op path with re-validation, and raises an unanswered attribution question (is an edited op still the model's proposal, for undo?). What ships instead points at the resolution channel that already exists and costs nothing: the chip STAYS, so the proposal remains confirmable once the clash is settled by any means, including simply asking the assistant for a different time.

**A trap found while building this, worth recording because it is not local to the concierge:** `useItinerary().plans` has a new array identity on every render (`hooks/use-itinerary.ts:644`, `visiblePlans(plans)` unmemoized). So the obvious "clear the refusal when the itinerary changes" effect, `useEffect(() => setClashByOp({}), [plans])`, is an infinite render loop rather than a nicety. Any consumer keying an effect on `plans` has this bug. The refusal therefore persists until that chip is confirmed again — which re-checks against live plans — or dismissed. It cannot go stale-and-blocking, because the re-check happens on the next press.

**One content fix rode along, owner-approved:** `j1-4` (hotel check-in, 18:15) carried `duration: '1h'` and ran 15 minutes into the 19:00 Dotonbori walk — a genuine authoring error, not a containment. It is now `'45m'`. The other three overlaps are intentional and stay. The seed golden snapshot (`lib/__tests__/__fixtures__/sample-itinerary.golden.json`) was regenerated for that one line, per its documented deliberate-edit lifecycle. **(Superseded by D-327, same issue, 2026-08-15: "the other three overlaps are intentional and stay" did not survive contact with the issue text, which requires the pre-existing overlaps corrected and says containment counts. All three are now corrected in content and the seed holds zero overlaps. Every "three deliberate containments" clause in this entry — here, in Part 3 and in the concierge paragraph — reads as history from that date; the delta-scoped guard itself is UNCHANGED and still LOCKED, for the reason D-327 restates.)**

**Why:** the owner's MUST cannot be met by a badge, and the trigger D-142 wrote for itself had genuinely fired. Deriving instead of migrating keeps the 158 shipped strings as the single source of the value. Sharing one predicate keeps the warning and the refusal from ever contradicting each other. Scoping the guard to the footprint delta is what makes a hard block compatible with content that intentionally overlaps — without it, the strict reading of the MUST would have made the app's own itinerary unmaintainable.

**Changes if:** users hit the containment case often enough that "clear the parent's duration" is not an acceptable answer — then an explicit container exemption, recorded as an amendment to this entry, and never a "save anyway" override; an override re-opens the MUST the day it ships. Or the sync-merge ceiling above stops being acceptable, which is a merge-time reconciliation design (a real one, with a rule for which side yields), not a guard in `commit()`.

**Addendum (A-14, v6 session B / V6-8, 2026-08-19): the multi-day-span exemption had itself gone stale.** `toInterval`'s escape hatch read `if (item.endDate) return null` — ANY `endDate` exempted the item from clash detection, forever, on the reasoning this file's own comments stated as fact: `endDate` "is only ever written strictly after the item's start day, so its presence means genuine span." That reasoning does not survive a span moved or copied past the day its `endDate` names — the field is written once, at creation or extension, and nothing revisits it on a later move. A span dragged three days forward without its `endDate` following it keeps the exemption on every day it now touches, including days its `endDate` no longer reaches, so it can never clash with anything again, on the badge or the block, in either direction — the "a stale `endDate` exempts an item from clash detection forever" defect A-14 names. Fixed at the one shared predicate: `if (item.endDate && item.endDate > dayDate) return null` — the exemption now holds only while `endDate` still covers `dayDate`, i.e. the span still genuinely reaches forward from the day being checked; once `dayDate` has passed it, the item is a plain timed interval, checked like anything else. This matches the read the band renderer already applies to decide whether to keep drawing a span (`components/calendar-planner.tsx`'s `item.endDate <= plan.date`, same comparison, opposite sense), so the two readings of "is this still a genuine span" cannot disagree. No new predicate: `clashingItemIds` (the badge) and `firstClashWith` (the block) still both route through `toInterval` alone, agreeing by construction exactly as Part 2 requires. Covered by a new case through each function, in `lib/__tests__/sort-items-by-time.test.ts`'s "D-316 addendum (A-14)" block.
---

### D-314 · (issue #29, 2026-08-15) · Lifetime visit history is stored OUTSIDE the trip namespace and outside the sign-out teardown — it is a third scope, not an app-scoped key

**Decision:** the set of cities and countries a person has ever visited persists at `tripPlannerLifetimeVisits` (`STORAGE_KEYS.lifetimeVisits`, key 32), a `{ cities: string[]; countries: string[] }` JSON value whose shape and unique / idempotent / insertion-order policy are owned by `core/places/visited.ts`. It is **lifetime-scoped**: a third scope beside trip-scoped (namespaced by `keyFor`, cleared by `wipeAllTripData()`) and app-scoped (a device or account fact, most of which that same teardown also clears). Three properties make that structural rather than a comment. It is absent from the `TripScopedSlot` union, so `keyFor('lifetimeVisits')` is a compile error and the key can never be namespaced under a pack. It does not carry the `trip:` prefix, so the teardown's prefix sweep cannot match it. It is not among the teardown's explicit removals. The `tripPlanner*` spelling is deliberate and load-bearing for the same reason: `nepal_japan_*` is the default pack's *grandfathered trip-data* namespace (D-172), and a key spelled that way reads as trip data at a glance to the next person editing the wipe.

**Why:** this record is not the trip's, it outlives every trip, and nothing else on disk can reconstruct it. The obvious implementation files it beside `myPlaces` as one more trip-scoped slot, and D-249's teardown then erases a permanent travel history on a routine "clear this trip / sign out of this device" — an action whose confirm copy promises only that *this trip's* data goes. The failure would also be silent and total: no export carries it, no remote copy exists, and the person who lost it would have no way to notice until they went looking for a city that was there last week. D-249a is the precedent that makes this a live risk rather than a theoretical one — the first version of that teardown swept only `trip:*` and therefore reached none of the default pack's bare literals, which is exactly the class of near-miss a key filed in the wrong namespace produces.

**The covering test calls the real wipe, and that is the part that would otherwise rot.** `lib/__tests__/visited-lifetime.test.ts` drives `wipeAllTripData()` itself, and separately the whole user path `signOut()`, seeding every slot in `TRIP_SCOPED_SLOTS` in BOTH namespaces plus the app-scoped pointers first and asserting they are gone before asserting the visit set is still there. A test that re-implemented the sweep by hand would assert against a copy of the teardown rather than the teardown, and would keep passing after someone added `lifetimeVisits` to `TRIP_SCOPED_SLOTS` — which is precisely the change it exists to catch.

**Two honest residuals, both named rather than fixed here.** (1) **Not synced, so "for life" means "for this browser's life".** The value is local-only on the D-002 localStorage floor, so a visit confirmed on a phone is absent on a laptop and a lost device loses the history — a record that survives sign-out but not a dropped phone is only half of what the feature's name promises. If that is worth closing it rides the account path (`trips/{syncCode}/profile/…`, the User Token's own subtree) and never a trip document, because it is not trip data; that is a slice, not a footnote. (2) **A handed-down device keeps the previous person's travel history.** Plain sign-out leaves it by construction — that is the decision — and today nothing writes the key (the recording surface is issue #30, the reading surfaces are issue #31), so there is nothing to leak yet. When there is, the place to resolve it is "Forget this device", the strictly-more-destructive path that already clears photo blobs for exactly this reason, and never plain sign-out.

**Changes if:** the history ever genuinely becomes per-trip — which would mean the feature had turned into something else, since "everywhere you have been" has no trip to belong to. Moving the key into the trip namespace, adding it to `TRIP_SCOPED_SLOTS`, or adding it to `wipeAllTripData()`'s removals are the same change wearing three hats, and each one silently converts a permanent record into data a routine teardown deletes; any of them needs an owner ruling and a migration that copies the existing lifetime value forward first, because there is no other copy of it anywhere. Adding it to "Forget this device" is the one clearing path that does NOT reopen this entry — residual (2) above anticipates it.

**Changes if:** the design wants the reconciliation back, which reopens D-306 a second time and gives up calendar accuracy again — that pattern has now happened twice in the same ~140-line module in under a week, and a third reversal should look hard at whether the two properties (calendar accuracy, arithmetic reconciliation) can ever both hold and pick one durably rather than reverting again. Or a third distinct defect surfaces in this file, in which case sweep the boundary that found it the way this entry's leap-day guard was found, rather than patching the symptom.

---

### D-321 · Exercises D-278's `Changes if` in part, and does NOT replace rungs 4–5 · (issue #22, 2026-08-15) · World place search is a keyless Nominatim lookup behind an explicit submit; trip places still win, the placement ladder is untouched, and every failure is a typed state with plain words

<!-- Renumbered from D-320 at the dev merge: issue #30 landed in the same batch and had also
     taken 320, for the unrelated D-158 geolocation amendment below. That entry keeps 320 (it is
     cross-referenced from eleven places in the tree, this one from none), and this became the next
     free id. Ids ARE reused deliberately in this file for addenda and amendments to the SAME
     decision — two different decisions under one number is the case that is not allowed. -->


**Decision:** `/map`'s search resolves places that are not in the trip at all, through `lib/world-search.ts` — a client-side `fetch` to `nominatim.openstreetmap.org/search` (`format=jsonv2`, `limit=5`). Free, keyless, no signup, no card, so it clears **D-088** on D-088's own terms, the same way Open-Meteo (D-108) and Frankfurter (D-189) already do. No route handler, no server, no secret, no npm dependency.

**1 — What this is NOT.** It is not a geocoder for the placement ladder. D-278's `Changes if` names *"a real geocoder is ever greenlit … and it would replace rungs 4–5"*; this does not, and rungs 4 and 5 are byte-unchanged. Nothing here resolves an `ItineraryItem`, nothing writes `lat`/`lng`, and D-278 section 5 (a derived position is never persisted) is untouched — a world result is never persisted at all. The lookup answers one question, *"where in the world is this name"*, for the camera only.

**2 — The provider's usage policy is a design input, and it is what shapes the UI.** Nominatim forbids autocomplete / search-as-you-type outright, and a debounce is **not** a compliant substitute — it still turns keystrokes into queries, just fewer of them. So the world lookup has exactly one caller, a form **submit**. The trip half of the search is unchanged and still filters live on every keystroke, because it is in-bundle data with nothing to wait for. The pre-existing *"the query never reaches the network"* E2E is **re-aimed rather than retired**: it now asserts that a *keystroke* never reaches the network, which is the clause that still binds and the one a later `useEffect([query])` would breach. Two further clauses are honoured in code rather than in a comment: at most one request per second (a module-scope gate that makes a second request wait out the remainder, plus a per-session memo so a repeated query issues nothing at all), and application identification via the `Referer` the browser sends automatically — `User-Agent` is a forbidden header name that `fetch` silently drops, and Nominatim's other hook, the `email=` parameter, is deliberately unused because this repo is public.

**3 — Trip places win, structurally.** Trip hits are computed from the bundle and render first in the DOM, in their own labelled list; the world group is a second list under its own heading carrying the OpenStreetMap attribution. A world row whose name matches a trip hit is dropped (`dropTripDuplicates`). That dedupe is by **name only, never by proximity**: two different temples 400 m apart are two places, and a distance merge would silently delete the second — a false duplicate costs one row, a false merge costs a result the user asked for.

**4 — A world result moves the camera and claims nothing else.** `TripMapHandle.flyToPoint(lat,lng)` is new: camera only, no marker, no popup. A synthesized `MapMarker` was rejected on two independent grounds, both readable in the existing code rather than speculative. `MapMarker.country` is `'Nepal' | 'Japan'` and `trip-map.tsx` renders it verbatim as *"{area} · {country}"*, so a marker for Reykjavík would print *"· Japan"* under its name — D-271's defect class in one line. And that same popup offers *"Add to plan"*, while `ItineraryDraft` still carries no coordinate (**D-280**, deferred), so the point the user just picked would be dropped on the way into the itinerary and the item would re-place itself at the day's city centroid. The ceiling is therefore stated to the user, in the map's own note: the place is shown, and there is no pin for it because it is not part of the trip. **Pinning a world place, and adding it to a day, is a follow-up that needs D-280's pre-approved `lat`/`lng`-on-draft shape first** — a content/adapter slice, not a search one.

**5 — It degrades, and the degradation is the normal path.** This app is used on foreign mobile data. `searchWorldPlaces` is total: it resolves, never rejects, and every failure is a typed state — `offline` (reported *without* issuing the doomed request, since `navigator.onLine === false` is the one reliable direction of that signal and a doomed cross-origin fetch prints a console error no application code can suppress, per D-189's finding), `rate-limited` (HTTP 429, its own state), and `failed` (any other non-2xx, network error, timeout, or unparsable body). The words the user reads live in one exported table beside the states that produce them, so a raw error string cannot reach the UI, and each one names what still works: **the trip search is unaffected by all three**. Failures are not memoised, so the retry after the wifi comes back really retries.

**Why:** the ask was *"find any place in the world"*, and the only honest way to do that under D-088 is a genuinely free keyless provider whose terms are then actually followed. The submit-button shape is not a compromise around the provider — it is the provider's requirement, and it happens to match what the two halves of this search really are: one instant and local, one deliberate and remote.

**Changes if:** the lookup is ever wanted for *placement* rather than for the camera — that is D-278's `Changes if` proper, and it replaces rungs 4–5 rather than sitting beside them. Or a world result needs to become a real pin and a real plan, which is D-280's deferred shape and reopens section 4 above. Or Nominatim's terms change, or a self-hosted / alternative free instance is wanted: the provider is one constant and one parser in `lib/world-search.ts`, deliberately.
### D-320 · AMENDS D-158 · (issue #30, 2026-08-15) · The zero-persistence location stance becomes a zero-COORDINATE stance: a one-shot fix may resolve to a place name, and only the name and the instant are stored

**What was promised, and where.** D-158 (S151, recorded 2026-07-12) is the entry that made the promise: the `/map` live-location toggle is "the built-in maplibre `GeolocateControl` (permission-gated, **nothing persisted**)". `trip/docs/V4-DEVPLAN.md` says the same thing twice — "**Location tracking** is a toggle that is default-off, permission-prompted, and **persists nothing**" (section 4's per-surface disclosure rules) and "a live location toggle (browser geolocation, default off, permission-prompted, **nothing persisted**)" (the S151 goal) — and D-211 parked the geolocation destination-switch partly on the same instinct. The guarantee was ENFORCED, not merely written down: `trip/e2e/map-trip-mode.spec.ts`'s live-location case snapshots `Object.keys(localStorage)` before and after the map settles and asserts the two are byte-identical, plus that no key is geo-shaped. That test is the contract, and issue #30 cannot ship underneath it.

**Decision — the amendment, stated as narrowly as it can be.** A device position may now be READ once per trip day and RESOLVED in memory against coordinates the app already holds; **the position itself is still never persisted, never transmitted, and never logged.** What may be written is the resolved place name and the instant it was confirmed. Concretely, and these are the boundaries rather than a summary of them:

1. **No coordinate reaches disk, in any form.** `lib/visit-autocount.ts`'s `matchPlace(lat, lng, candidates)` is the only function in the app that sees a device fix. It is pure, it returns a `{ city, country }` drawn from the trip's own city list, and its two number arguments are unreachable the moment it returns. The store it feeds (`core/places/visited.ts`, gateway **key 34** `tripPlannerVisitConfirmations`) holds `{ checkedOn, confirmed: { city, country, at }[] }` — a shape with nowhere to put a latitude. Not the fix, not a rounded fix, not an accuracy radius, not a geohash.
2. **One shot, on day change only.** `getCurrentPosition`, never `watchPosition`, never a timer, never a background stream. The trip-clock day is written to `checkedOn` BEFORE the request, so the second page load of the same day asks nothing. "Day" is `getNowAtTrip().date` — the destination-local, `?today=`-aware trip clock every other trip-day surface already reads — because the device's own midnight is the wrong midnight for a traveller, which is the standing warning in `trip/docs/time-model-blueprint.md`.
3. **Every failure is a non-event.** `PERMISSION_DENIED`, `POSITION_UNAVAILABLE`, `TIMEOUT`, no `navigator.geolocation` at all, and a `getCurrentPosition` that throws outright: each returns quietly, leaves the planned count standing, and surfaces nothing. No error state, no toast, no retry, no second ask. Someone who never grants location gets the entire feature minus one timestamp, and nothing else about the app is degraded for them.
4. **Offline and free.** The match is haversine arithmetic (`lib/day-anchor.ts`) against `lib/city-coords.ts`, the coordinate table this app already ships. No reverse geocoder, no lookup service, no network call — the D-088 free-tier floor, and the same "in-bundle data or nothing" rule map search already runs on.
5. **It is never asked for outside the trip.** The check is gated on `getTodayInTrip() !== null` and on a signed-in traveller, so a visitor at the front door and a person reading the app at home in August are never prompted at all. The prompt exists only for someone actually on the trip, at most once per trip day.

**The hybrid, and why the halves are deliberately asymmetric.** The itinerary counts a city when its day arrives; the location check only ever CONFIRMS. Nothing removes a visit. A check that did not fire, was refused, or matched nothing is indistinguishable from one that was never asked, so "you were not in Kyoto" is not a claim a missing fix can support — the planned credit stands and the confirmation is the stronger statement layered on top of it. That asymmetry is the design, not an unfinished half.

**Why amend rather than build around it.** The alternatives are worse and were considered. Keeping "nothing persisted" literally would mean re-asking for a position on every page load to rebuild in-memory state: more prompting, more radio, weaker result. Storing the fix "temporarily" to re-match later against a better table is precisely the thing the original guarantee forbids, and a temporary location store is a permanent one after the first bug. Doing the resolution server-side is out under free-tiers-only and would move a position off the device, which is strictly worse than any of this. The remaining honest option is to narrow the promise in public and pin the new boundary with tests, which is this entry.

**How the new boundary is held.** `trip/lib/__tests__/visit-autocount.test.ts` dumps the WHOLE of localStorage after a granted fix and asserts that the fix's own latitude and longitude appear nowhere in it, that no coordinate-shaped field name appears anywhere, and that a stored confirmation has exactly the three fields `city` / `country` / `at`. It also covers the denied, unavailable, timed-out, unsupported and throws-outright paths, one-shot-per-day, re-asking on day change, and never asking off-trip. `trip/e2e/map-trip-mode.spec.ts`'s live-location case was AMENDED in the same change rather than deleted: the two keys #30 owns are excluded from the key-set snapshot (whether they exist at all depends on the date CI runs at), the "no geo-shaped key" assertion is unchanged, and a new assertion sweeps #30's own values for coordinate-shaped fields. That sweep is deliberately NOT global — `myPlaces` and an item's own pin legitimately hold `lat`/`lng` (D-278/D-280), authored or dropped by the user rather than read off the device, and that distinction is the entire content of what changed here.

**Storage scope.** Key 33 is **lifetime-scoped**, riding key 32's scope for key 32's reason (D-314): a confirmation is an attribute of a lifetime visit, not of a trip, so it sits outside `TripScopedSlot` and outside `wipeAllTripData()`. It is a SEPARATE key rather than a third field on key 32 so that #29's on-disk `{ cities, countries }` stays exactly two fields for anything written against D-314. Note the consequence honestly: what survives a sign-out here is a city name and a timestamp, never a position, and D-314's residual (2) — "Forget this device" is the clearing path for a handed-down device, never plain sign-out — now covers two keys instead of one. D-314's own "today nothing writes the key" clause is superseded by this slice: #30 is the recording surface it named.

**One reuse worth recording, because getting it wrong would have written a false fact permanently.** The country stored is `countryLabelForDate` (a one-line addition to `lib/leg-label.ts`, THE one place a leg id becomes a human label), never `legForDate(...).countryLabel`. Dec 9 is a `'nepal'`-LEG day spent at JFK (D-315), so the raw leg label yields "New York / Nepal" — the exact bug `lib/leg-label.ts` exists to kill, except aimed at a permanent lifetime record instead of at a page header. The authored per-day label gives 'USA'. A single-leg custom trip has no country label worth recording and yields `''`; `addVisit` drops a blank half, so that records the city alone, which is honest.

**Known ceiling, stated rather than hidden.** The trigger is a boot-once island (`components/visit-autocount.tsx`, mounted inside the existing `TravelModeMounts` lazy boundary so it costs no new split point and no First Load bytes), so **a day that turns over while the app is left open is not noticed until the next load.** Closing that gap needs a timer watching a clock, which is the shape of thing rule 2 exists to forbid; the next launch backfills every arrived day anyway, so only the confirmation stamp waits. Planned counting is a backfill over the whole arrived prefix on every boot rather than a per-day event — both the smaller implementation and the self-healing one, since `addVisit` is idempotent and there is therefore no "days I have already counted" bookkeeping to drift.

**Changes if:** a location-derived value beyond a known place name and an instant is ever wanted on disk. That reopens this entry and needs its own owner ruling, because the residual promise after this amendment is exactly "the app never keeps where you were, only which of its own places you reached" — and that sentence is the whole of what is left of D-158's stance. A `permissions.query` pre-gate was considered and SKIPPED: a denied permission already fails `getCurrentPosition` immediately with no prompt, so it buys an async branch and a browser-support guard for no behavioural change; add it only if a real browser is observed prompting someone who has already refused. D-158's other three clauses (destination-only directions URL, search-select filter reset, `focusMarker` moveend-then-popup) are untouched, and so is its own `Changes if`.

---

### D-322 · Amends D-293 rules 1 and 2, and D-292's Tier-3 "anything that loops" · (issue #24, 2026-08-15, owner-ruled) · A state indicator is not ambience: the 6s loop floor binds decoration only, and the exemption is a two-entry allowlist with an audit under it

**What was found, and it was found by building the enforcement rather than by re-reading the rule.** Issue #24 built D-292's tier gate and D-293 rule 7's entrance ledger. It did **not** build rule 2's floor check — the rule calls itself "grep-checkable" and nobody had ever gripped it — and building the rest of the system surfaced two live loops that break it. `.animate-shimmer` runs at **1.6s** (the skeleton sweep; `components/section-skeleton.tsx`, reached from ten routes across all three tiers). `.animate-today-pulse` runs at **2.4s** (the calendar today-cell ring; `components/calendar-day-picker.tsx` → `calendar-planner.tsx` → `/plan/`), which is a **Tier-3** route, so that one also breaks rule 1's *"Tiers 2/3 zero"* and D-292's Tier-3 *"forbids outright: anything that loops"*. Both predate the motion budget. Neither was noticed when the budget was written, and `app/globals.css` has argued since the decorative-loop deletion that these two are *"a DIFFERENT category — both are state indicators"* — an argument sitting in a comment with no rule behind it.

**Decision (owner): both loops stay, at their current timings, and the RULE moves rather than the code.** The general direction the owner gave with it — design and frontend have free rein on the visual system in this version, and the goal is the best product for retention and repeat use — is context, not a blanket exemption. What is ruled here is narrow and is this: **a busy/state indicator is a distinct category from ambient decoration, and rule 2's 6s floor binds ambience only.** The floor exists so that decoration cannot blink at a reader; an indicator's whole job is to be noticed *now*, and slowing one to 6s does not calm it, it breaks what it is for — a skeleton sweep whose cycle outlasts most of the fetches it reports on has stopped reporting anything.

**The line, stated so the next case can be decided without another ruling.** A **state indicator** reports a condition the app or one element is in *at this moment*, and it stops when the condition does: the shimmer says "still loading" and dies with the skeleton; the today ring says "this cell is today" and only ever attaches to that one cell. **Ambient decoration** says nothing, stops for nothing and exists to be pretty — the four loops S354 deleted (`ambient-drift`, `float`, `pulse-glow`, `aurora-shift`) are the reference set. Rule 9 still binds both: the today cell is labelled as well as ringed, so the motion never carries the fact alone.

**The exemption is an allowlist under an audit, and that is the substance of this entry.** `trip/scripts/motion-loops.mjs` (`npm run loop-check`; dependency-free, wired into `ci.yml` in the same slot as `marker-check` and `contrast-tokens`, before `npm ci`) parses `app/globals.css` for `infinite` animations, resolves `var()` durations against the file's own custom properties, and **fails any sub-6s loop that is not one of its two allowlisted selectors** — each carrying a one-line reason. So this ruling covers these two and **the next sub-6s loop is caught**, which is the only version of "the motion stays" worth writing down. Three further failure modes are covered because a check that silently passes is worse than none: an `animation-iteration-count: infinite` longhand (the parser reads the shorthand only, so it fails rather than skips), a duration it cannot resolve, and a **stale allowlist entry** — an entry matching nothing means either the rule was deleted or the parser stopped seeing it, and in the second case every assertion above it would be vacuously true.

**The reduced-motion hard stop is unchanged and is now machine-checked rather than assumed.** Both selectors are named in the `@media (prefers-reduced-motion: reduce)` block with an explicit `animation: none !important`, which they need because the block's universal `animation-duration: .01ms` rule would otherwise leave an infinite animation running one ultra-fast iteration forever. The audit re-derives this for **every** loop it finds, exempt or not, and fails when a loop is not named there — so the exemption can never become a loop nobody can turn off. `e2e/motion-reduced-audit.spec.ts` and `e2e/motion.spec.ts` still prove the same thing in a real browser; this is the static half.

**The tier-gate half.** `lib/motion.ts`'s `MotionKind` gains `'state'`, permitted on tiers 1, 2 and 3 — the working screens are exactly where "still loading" and "this is today" have to be sayable. `'loop'` is **unchanged at Tier 1 only**, and `lib/__tests__/motion-budget.test.ts` gained a case asserting that, because the shortcut this ruling must not be implemented as is relaxing `loop` to cover indicators.

**Changes if:** a third loop wants the exemption. That is a decision, not a fix — argue it against the line in paragraph three, and if it is really ambience, meet the floor. If the allowlist ever needs a fourth entry the category has stopped being a category.

---

### D-323 · Amends D-292 (Tier 3's "confetti/pops/bursts") and D-293 rule 6 · (issue #24, 2026-08-15, owner-ruled) · A one-shot completion burst is earned feedback and is legal on every tier; `pop` and `burst` are not widened

**What was found.** `components/celebration-burst.tsx` is a ~600ms pop that fires on the last packing item (`components/packing-checklist.tsx:70`, `/packing/`) and the last document (`components/docs-checklist.tsx:143`, `/checklist/`). Both routes are **Tier 3**, which D-292 says *"forbids outright: … confetti/pops/bursts"*, and D-293 rule 6 caps a pop at Tiers 1–2. It has shipped for a long time and `e2e/polish-bundle.spec.ts` asserts it is visible on `/packing/` — so the rule was being violated by tested, deliberate, live behaviour, which is the case where quietly deleting the feature to satisfy the rule is the wrong repair.

**Decision (owner): the burst stays, and rule 6 gains a category rather than an exception.** A **one-shot completion burst** — fired once, on a `false→true` edge the user themselves caused, for a thing they finished — is legal on **any** tier. It is neither of the things the Tier-3 prohibition is aimed at: it is not ambience (it happens once and is over) and it is not a greeting (it cannot fire on load). D-292's Tier 3 exists to keep the working screens calm while you use them one-handed, outdoors, in the cold; the moment you tick the last item off is the one moment on that screen when you are not working, and rewarding it is the difference between a checklist and a form.

**The code now says the same thing, without saying more.** `MotionKind` gains `'completion'`, permitted on tiers 1, 2 and 3. `'pop'` stays `[1, 2]` and `'burst'` stays `[1]` — **byte-unchanged**, and `lib/__tests__/motion-budget.test.ts` gained a case whose only job is to fail if someone later implements this as `burst: [1, 2, 3]`. The distinction is the ruling: this is a one-shot, user-earned completion pop, not a general permission for pops on a working screen. D-293 rule 5 is untouched and is what keeps "one-shot" true — `crossedIntoComplete()` fires only on an observed `false→true` edge and `prev === null` seeds the baseline without firing, which is why an already-complete list does not celebrate on load.

**Reduced motion is unchanged, deliberately and verifiably.** `celebrationVisible(active, reducedMotion)` still returns `false` under `prefers-reduced-motion`, and the component renders **nothing** — no static substitute, by design, since the real state change already has its own accessible feedback in the progress text. `polish-bundle.spec.ts`'s case asserting the burst is ABSENT under reduced motion (and absent for the full ~800ms window, not merely at the instant it looks) is untouched and must stay green. Nothing in this entry relaxes D-007 or rule 8.

**What was NOT done, and why it is not an omission.** `CelebrationBurst` does **not** call `isMotionAllowed('completion', tier)`. The permission is universal, so the call could never change an outcome — it would mean threading `usePathname()` into a leaf component to compute a constant `true`, which is dead code that reads like a guard. The gate is the written table; the component is downstream of a ruling that admits it everywhere.

**Changes if:** a completion moment wants particles, sound, or a second fire for the same entity — that is `burst` again (rule 6, Tier 1, one per event) and this entry does not cover it. Or a Tier-3 screen starts celebrating something the user did not finish, which is where the "earned" half stops being true and the prohibition should bite.

---

### D-324 · Records a deferral of D-293 rule 7's implementation · (issue #24, 2026-08-15) · The entrance ledger resets when the TAB closes and at no other moment — reload, client route change, remount, sign-out and a reduced-motion toggle all keep the greeting spent

The reset semantics of the once-per-session entrance ledger were written down beside gateway **key 33** (`core/storage/gateway.ts`, `motionEntranceSeen`) and nowhere in this file, which makes them a code comment rather than a decision — and they are exactly the kind of thing a later reader "fixes" by moving the store.

**The rule, as implemented.** `sessionStorage`, a comma-joined set of surface ids, appended to at most once per surface. It therefore does **not** reset on a reload (sessionStorage survives a refresh in the same tab), on a client-side route change, on a component remount, on a reduced-motion toggle, or on sign-out. It **does** reset when the tab closes. A **duplicated tab inherits the set**, because browsers copy sessionStorage into the duplicate — accepted and named rather than overlooked. `localStorage` was rejected because a returning visitor tomorrow *should* get the greeting again; a per-page-load reset was rejected because it makes the ledger a no-op.

**The two things that do not spend a greeting.** `entranceFor()` checks reduced motion **first** and the tier gate second, and neither consumes the ledger — so a reduced-motion visit never spends a greeting the user was not shown, and a route that is later re-tiered still owes its first visit. Storage that is disabled or throwing degrades to *always animate*, never to *always hidden* (rule 8's direction: a re-greeted surface is a cosmetic miss, a surface stuck at its start state is a blank screen).

**Known ceiling, carried from the code.** The in-memory memo behind `entranceFor()` holds **one** surface at a time, so two surfaces rendered simultaneously — a route transition that cross-fades the outgoing page — would thrash it. Key it by surface in a `Map` if that ever ships.

**Changes if:** a greeting should survive a tab close (that is `localStorage` and a different promise to the user), or two surfaces are ever mounted at once, which is the ceiling above and not a bug in this entry.
---

### D-328 · New · (issue #33, 2026-08-15) · A test that asserts a converted-currency figure pins its own FX rates; a test that asserts the on-disk model reads SEED_RATES

Refreshing the NPR reference rate broke two different test layers in one afternoon, in two different ways, and the fix for each is the opposite of the fix for the other. Writing that down because the confusion is what produced both failures.

`SEED_RATES` (`core/budget/model.ts`) is the build-time default a traveller budgets against until they override it. It is data, and it moves — NPR drifted about 13% between 2026-07-24 and 2026-08-15, and it will drift again.

**Unit tests: spread `SEED_RATES`.** `settings-clear-all` and `use-budget-sync` spell out the whole on-disk budget model, seed rates included, and assert byte-identity against it. Their subject IS the model, so a hardcoded `{ NPR: 138, JPY: 155 }` is a second copy of the seed that silently rots the moment the first one changes. Both now spread `SEED_RATES`, and the next refresh cannot touch them.

**E2E specs: pin your own rates, and never read `SEED_RATES`.** `budget`, `burn-rate` and `expenses` assert a rendered USD figure derived from an NPR/JPY input — "13,800 NPR is $100". Their subject is the arithmetic and the surface, not the seed. Seeding a budget model that carries its own `rates` makes them true at any seed. `settings.spec.ts` and `home-bento.spec.ts` already did this, which is exactly why they were the two rate-coupled specs that did NOT go red.

Reading `SEED_RATES` from an e2e spec would be the worst of both: it can only assert the app agrees with itself, and no e2e spec resolves the `@/` alias.

**The trap in the fixture, found the hard way.** `addInitScript` re-runs on `page.reload()`, so an unguarded rate seed rewrites the budget back to zero mid-test and turns every "survives a reload" assertion into a test of the harness — green, and proving nothing. The seed fires on first navigation only, behind a `sessionStorage` marker, the same guard `settings.spec.ts` uses.

**Changes if:** the budget ever reads a live FX feed, at which point the seed stops being a constant and both halves of this need re-deriving. Note NPR cannot: Frankfurter does not carry it (see `lib/currency-rate.ts`), which is why a hand-set reference rate exists at all.
---

### D-325 · Implements the three halves of D-292/D-293 that #24 had conceded · (issue #24, 2026-08-15) · The overlay tier is a pin on the PRIMITIVE, not a route lookup; a celebration is claimed from a session ledger; and R4 is a `:focus-within` transition rule, not an `animation-play-state` one

Three enforcement gaps were left open when the tier gate and the entrance ledger landed, each recorded honestly at the time. This closes them, and the shape of each answer is the decision.

**1 · The overlay pin is a constant, and it lives with the primitive.** D-292 places *"every dialog, sheet, popover and form in Tier 3 regardless of which route opens it"*, and the design system repeats it as the one red line in its per-route table. `lib/motion.ts` used to concede this in a comment, because a route path cannot tell you a dialog is open. The answer is that a dialog's tier is **not a lookup at all**: `OVERLAY_TIER = 3` and `overlayMotion(kind, loud, calm)` return the calm value whenever `isMotionAllowed(kind, OVERLAY_TIER)` is false, which is what every overlay primitive now calls (`components/ui/dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, plus the framer variant pair `overlayPanelMotion()` used by `sheet-dark.tsx` and by the two hand-rolled dialogs that predate it, `expense-dialog.tsx` and `add-to-itinerary-dialog.tsx`). `tierForPath()` would have answered **1** for a dialog opened on Home, which is precisely the wrong answer.

**What that actually changed, concretely:** the shadcn default `zoom-in-95` / `zoom-out-95` on the two Radix dialogs, the 500ms-in/300ms-out sheet timing, and the `scale: 0.9` spring on all four framer modals are gone, replaced by the design system's overlay budget (≤200ms opacity + an 8px rise in, ≤160ms opacity out). **Calm is not silent** — R8 still binds, every overlay forks to its end state, and the `tick`/`completion` rows of the permission table still answer `true` inside a dialog, so checking a box in one still marks itself. The `loud` branch is kept and spelled out at each call site although it is unreachable today: it is what the gate is refusing, and deleting it would turn a mechanism back into a hard-coded class list.

**2 · A celebration is CLAIMED, and the claim is a session ledger keyed by `<weight>:<entity>`.** D-293 rule 5's second clause (*"a celebration id fires at most once per session per entity"*) and rule 6's caps (*"pop: 3 per session"*) were not implemented: `lib/celebration.ts` only had the false→true edge, whose baseline is a **ref**, and a ref does not survive leaving a route and coming back. `claimCelebration(id, weight)` now spends a claim key against gateway **key 36** (`motionCelebrationsFired`), which is `motionEntranceSeen`'s slot shape verbatim — same session store, same comma-joined set, same reset semantics as D-324 — and the weight prefix is what makes one key carry both rules: a cap is *how many entries start with `pop:`*, so there is no counter to drift out of step with the set. The degrade direction is the entrance ledger's, for the same reason: unreadable storage means **always celebrate**, never silence.

**Where the claim is made is part of the decision.** It is in `components/celebration-burst.tsx` — the single component all six call sites already route through — and **behind** the reduced-motion guard, so a user who is shown nothing is never charged for it (the rule `entranceFor()` follows for greetings). `celebrationId` is a **required prop**, which is what stops a seventh call site from opting out by forgetting. The per-window ref in that component is load-bearing: it is what keeps a React StrictMode double-invoke from spending a claim twice and hiding the burst it just granted.

**What is NOT claimed, and why it is not an omission:** no call site currently asks for a `pop`. The three live weights are `completion` (packing, docs, hero arrival) and `burst` (milestone, wrapped, passport stamp). Rule 6's numeric cap is therefore machinery ahead of its consumer — deliberately, because it is the rule the next celebration will be written against, and `lib/__tests__/celebration.test.ts` exercises it. `burst` and `completion` have **no numeric cap**: their rule is "once per entity", which every claim already gets from the ledger, and the per-screen budget (a device fed a dozen new countries at once) stays where it was, in `passport-stamps.tsx`'s `FLOURISH_CAP`.

**3 · R4 is a transition rule, and stopping keyframes was rejected on R8 grounds.** *"Nothing animates under the cursor or the caret"* is now `:is(form, fieldset, [role="dialog"], [role="alertdialog"]):focus-within` (and its subtree) at `transition-duration: 1ms`, in the motion layer of `app/globals.css`. The dialog half comes free with the form half because every dialog in this app **traps focus**, so `[role="dialog"]:focus-within` is true for as long as one is open.

**The rejected version matters more than the shipped one.** A blanket `animation-play-state: paused` over the same subtrees would satisfy R4 more literally and would break rule 8: a keyframe caught at 0% freezes there, so any entrance starting at `opacity: 0` would hold its content **invisible** for as long as the caret sat in the form. A removed transition always lands on its target value, so the shipped version cannot do that. The two keyframe loops that would otherwise be in range are D-322's state indicators (`.animate-shimmer`, `.animate-today-pulse`) — a form that freezes the spinner reporting its own save is not calm, it is broken, and both carry their fact in text besides. The one ambient loop R4 explicitly requires to pause behind an open form is the front door's Ken Burns, and it is paused from the motion layer via `body:has(form:focus-within) .door-kb` rather than by editing `.door-kb`'s own rules, which belong to issue #25.

**Known ceilings, named rather than discovered later.** (a) Transitions on the page **behind** an open dialog are not stopped — only the dialog's own subtree and the focused form's. Covering the rest needs `body:has([role="dialog"]:focus-within) *`, a universal selector under `:has()`, which was not worth the invalidation cost for what a scrim already hides. (b) R4 is CSS, so it does not reach framer-driven JS animation; the overlay pin in part 1 is what keeps that half calm. (c) Gateway key **36** was the next free number at the time of writing — parallel branches have collided on both key numbers and D-numbers in this batch, so reconcile it at the merge rather than assuming.

**Changes if:** overlays are ever re-tiered (change `OVERLAY_TIER`, and all six modals follow), or a celebration wants to fire twice for one entity in a session — that is not a bug in the ledger, it is a rule-5 argument and belongs here.

**Changes if:** a greeting should survive a tab close (that is `localStorage` and a different promise to the user), or two surfaces are ever mounted at once, which is the ceiling above and not a bug in this entry.
**Changes if:** a greeting should survive a tab close (that is `localStorage` and a different promise to the user), or two surfaces are ever mounted at once, which is the ceiling above and not a bug in this entry.

---

### D-331 · Extends the #27 mapping block, does not amend it · (issue #27, 2026-08-15) · Six recurring role calls the three-tier sweep needs, read off the already-swept files rather than re-derived per route

The mapping block in `app/globals.css` fixes the RULE (the role, first hit of three questions, never the nearest alpha). It does not answer the half-dozen SHAPES that recur in every route, and three concurrent shares of one sweep each re-deriving them is how the tiers drift apart. Everything below is read off files that are already swept and already reviewed — `docs-checklist`, `hero-section`, `home-stat-row`, `visited-places-panel`, `landing-page`, `token-gate` — which is why this is recorded as a finding rather than as new policy.

1. **An unselected option in a control is `ink-mid`, not `ink-lo`.** `token-gate`'s login/create toggle is the precedent. "Inactive" in question 3 means *done* — a checked item, a settled balance — not *not-currently-chosen*: an unselected tab is a live destination, and its selected sibling is already carried by the accent fill, the hairline and `aria-current`. Applies to the mobile tab bar, the author filter, the map's category chips, the budget tabs and the leg/category radios.
2. **A control's own label follows the control's rank.** The primary action of its container is `ink-hi` (`visited-places`'s two form buttons); a secondary affordance sitting BESIDE the subject it acts on is `ink-mid` — Edit next to a journal entry, Cancel next to Save, a deep link out of a panel. Icon-only auxiliary controls (close, remove, fullscreen, search toggle) are `ink-mid`, matching `visited-places`'s chip remove.
3. **A decorative glyph sits one tier below the text it accompanies.** `visited-places` puts an `ink-mid` icon inside an `ink-hi` heading, so a status line's icon, under `ink-mid` text, is `ink-lo`. A pure separator — an em-dash, a middot — is `ink-lo` regardless; `hero-section` already writes that one.
4. **A caption that NAMES the value beside it is `ink-lo` — and the test is the role, not the type size.** Eyebrow, field label, the unit under a stat, a group heading in a search list. `home-stat-row` is the measured precedent: its caption is `ink-lo` and the code records the ratio, 6.89:1. **Corrected during assembly:** this was first written as "an uppercase micro-caption is `ink-lo`, five for five", which is both a typography rule — precisely the smuggled fourth rule the mapping block exists to prevent — and not actually five for five. `hero-section`'s 9px uppercase "days to go" is `ink-mid`, and the reason is CONTRAST, not role: over photography `--text-lo` measures 3.55:1 and fails AA, which `scripts/contrast-tokens.mjs` carries as a standing guard. So the rule is role, the exception is the surface, and the exception is measurable rather than a matter of taste. A caption's own type size decides nothing: `trip-dashboard`'s `text-sm` sentence-case stat label is the same role as `home-stat-row`'s 10px uppercase one and takes the same tier. A line that is a STATEMENT rather than a name ("You're on the trip") is not a caption at all and stays `ink-mid`.
5. **An empty-state SENTENCE is `ink-mid`; the follow-on HINT under it is `ink-lo`.** `visited-places` paints its empty message `ink-mid`, so question 3's "a hint standing in for absent content" is the PLACEHOLDER case — route 1's own example — plus fine print, not every empty state. "No journal entries yet." is mid; "Write about a trip day from the Today panel" beneath it is lo.
6. **User-typed text is `ink-hi` when it is the subject and `ink-mid` when it qualifies one.** A journal body, a highlight, a photo caption and an input's value are subjects. An itinerary item's NOTE under its title qualifies the title and is mid: the mapping's "the text the USER TYPED" clause is scoped by its own tie-break sentence ("inside a control the user's own text is the subject"), and a note rendered beneath a title is not inside a control.

**What this does not do.** It adds no fourth tier and changes no rule in the mapping block; every line above is an APPLICATION of the existing three questions. Where one of them conflicts with the block, the block wins and this entry is the thing that is wrong.
### D-326 · Implements the second half of issue #25 · Applies D-293 rule 4 · (issue #25, 2026-08-15) · The front door is photographic in BOTH of its views: the wall keeps a cover mounted behind the auth card, and the Ken Burns is stopped by the ruled pause rather than by an unmount

The landing half of the front-door redesign shipped correctly — full-bleed cover, Ken Burns, display type, measured contrast. The auth half did not, and the reason is structural rather than cosmetic: `components/token-gate.tsx` renders the landing **XOR** the auth card, and the landing owns the cover *inside* the panel, so pressing a CTA unmounted the photograph outright. The second view had display type and gradient chrome and no photography at all, against an acceptance criterion that says the front door gets photography and a design rule that puts the panel's scrim **over** the cover, not instead of it.

**What ships.** The wall root renders its own copy of the cover as a **sibling of the `role="dialog"` panel**, mounted only while the auth view is up. It is the shared photo engine element for element — `.photo-header__media` supplies the isolation, the image grade and the children's inset, and the duotone pair is the same Nepal grade the cover carries — with a two-declaration delta class, `.door-wall`: `position: fixed` (the wall is `overflow-y-auto`, so an absolutely positioned backdrop is part of the scrolled content and slides off a short viewport) and `overflow: hidden` (the loop overscans to `scale(1.13)` and this box *is* the viewport, so without it the pan pushes the document sideways).

**The scrim is flat, and that is the deviation worth recording.** `.photo-header`'s two-ramp stack is bottom-weighted because its text sits in the dark end of a band. The auth card floats mid-screen and its fill is opaque, so what the scrim owes is a uniform floor wherever the panel lands: `.door-wall-scrim` is a flat `rgba(10,7,20,.72)`, the ruled panel-scrim value, and nothing else.

**Rule 4 gets its mechanism back.** The cover no longer unmounts when the card opens, so the surface's one ambient loop no longer stops by accident. `.wall-auth-open .door-kb { animation-play-state: paused }` is what stops it — the wall root stamps the class in the auth view. The old code satisfied "nothing animates under an open form" by deleting the surface the rule was about, and that same reasoning is what left the view with no picture; the CSS comment that said no class was needed is corrected in place rather than removed, because the argument reads sound and needs its refutation next to it. `animation-play-state` over `animation: none` so the frame is held where it is instead of snapping back to the start. Reduced motion is unaffected: the `@media (prefers-reduced-motion: reduce)` block already names `.door-kb` with `animation: none !important`, which outranks the pause, and `scripts/motion-loops.mjs` still reports exactly one front-door loop at 30 s, hard-stopped.

**Contrast: what moved and what did not.** The panel is opaque `--surface-2` (`.glass-card-dark`), so **no pairing inside the card changed** — the field, its edge, the error colour and the three text tiers all still sit on the same solid fills they were measured on. What is new is the surface underneath, and `scripts/contrast-tokens.mjs` gains it as a composite (`doorWall` = the brightest pixel the grade can produce, under `.72`, with the grain multiplier) plus two measured pairings — white **9.30:1**, `--text-mid` **5.67:1** — and two guards. The guards are the two rules that would otherwise be a comment: `--text-lo` measures **3.58:1** there, so the floor tier is not text over this photograph (the same rule the Home hero carries on its own surface); and an opaque `--surface-2` panel is **1.74:1** against the worst-case pixel behind it, so **the card is separated from the picture by depth — the elevated shadow and the fill step — and not by a ratio**. The panel is a container, not a control, so 1.4.11 does not bite on that edge; every control inside it is on an opaque fill and measured. If either guard starts passing, the scrim or the surface ramp moved, and that is a decision somebody should make having seen the line flip.

**What was deliberately not touched.** The landing's own cover, whose `92px`/`68px` ramp contract is what makes its measured floor a number. The focus contract — the backdrop is outside `panelRef`, carries nothing focusable, and the entry-focus query (`panel.querySelector('button:not([disabled])')`) and the Tab-trap therefore cannot see it; `lib/__tests__/s345-front-door.test.ts` asserts that placement alongside the existing `document.activeElement` checks. And the #70 routing: the shared-trip CTA still opens **create**, and a Trip Token holder is still never shown the key field.

**Amended by D-332.** The fill measurement above is correct and its ruling stands, but it is only half the surface: the panel *edge* was never measured, and `--border` is 1.04:1 over this cover — invisible where the card crosses the highlights. D-332 records why a fill can never carry a ratio here (the graded backdrop is a range the fill sits inside) and steps the wall dialog to `--border-ui`.

**Changes if:** the wall ever renders both views at once, or the auth panel becomes translucent — either would put its foregrounds on the photograph and every pairing in the card would have to be re-measured over `doorWall` instead of over `--surface-2`.
### D-327 · Completes D-316 (supersedes its "the other three overlaps are intentional and stay") · (issue #18, 2026-08-15) · The seed's three containments are corrected in CONTENT, not grandfathered: each container gives up the time the nested plan occupies, and the seed now holds zero overlaps

**What was left undone.** D-316 shipped the guard issue #18 asked for and fixed one of the five pre-existing overlaps (`j1-4`, hotel check-in, `'1h'` → `'45m'`). The other three — `j3-1`/`j3-2` on 2026-12-21, `j5-1`/`j5-2` on 2026-12-23, `j13-3`/`j13-4` on 2026-12-31 — were reclassified as "deliberate containments", exempted through the `timeFootprintChanged` delta scope, and then pinned as *expected* by `lib/__tests__/sort-items-by-time.test.ts`. The issue text does not support that reading: it says the roughly five existing overlaps "get corrected in this same piece of work" and, in its own sentence, that **being fully inside another plan still counts as an overlap**. A test asserting the shipped content overlaps was asserting the defect.

**Decision: the content is corrected, one rule applied three times.** The container keeps its start and is SHORTENED to end exactly where the nested item begins (the `j1-4` precedent — shorten the duration, never move a time — and half-open means touching is clean). Where the container's surrendered span carried real plan content, that content moves onto the nested row rather than being deleted, so the day's total footprint is unchanged:

- **2026-12-21, USJ.** `j3-1` 09:00 `'8h'` → `'4h'` (09:00–13:00); `j3-2` 13:00 `'1h'` → `'4h'` (13:00–17:00), retitled "Lunch inside the park, then the afternoon rides". The park day still runs 09:00–17:00, now told as two rows split at the lunch break, which is what actually happens. A ticketed park day's afternoon is not free time and could not honestly be dropped.
- **2026-12-23, Shinsekai.** `j5-1` 10:30 `'4h'` → `'2.5h'` (10:30–13:00); `j5-2` untouched (13:00–14:00). Only the block shrank, because this one is explicitly a *flex/recovery day* with an empty afternoon after it: the Spa World soak the block's notes describe now sits in that open afternoon instead of being squeezed into the 30 minutes the old 4h block left after lunch. The notes were re-worded to say so.
- **2026-12-31, NYE.** `j13-3` 21:30 `'4h'` → `'2h 15m'` (21:30–23:45); `j13-4` 23:45 `'1h'` → `'1h 45m'` (23:45–01:30). The night still runs 21:30–01:30, split at the countdown, which is the one instant that day exists for.

Day count, item count, `duration`-string count and every id are unchanged (32 days, 158 items, 158 duration strings), so nothing downstream of the seed's shape moves. The golden snapshot (`lib/__tests__/__fixtures__/sample-itinerary.golden.json`) was regenerated for these lines, per its documented deliberate-edit lifecycle.

**`timeFootprintChanged` STAYS, and the reason it stays is not the seed.** Removing the delta scope once the seed went clean would be wrong. The intent-layer guard sees writes made *through this app's UI and concierge*; a row can reach a device without passing it — a synced peer's write merged by `mergeItems`, a vault import, a plan saved by an older build. An overlapping row arriving by any of those routes must stay editable (renameable, fixable) rather than be frozen by a guard it never had a chance to satisfy. What changed is only the JUSTIFICATION, and D-316's text carried the seed as its example — the comments in `lib/sort-items-by-time.ts` and the test that named the three containments now say this instead.

**How it is held.** `lib/__tests__/sort-items-by-time.test.ts` asserts the whole seed is clean (`[]` across all 32 days) and, separately, that each former pair TOUCHES — container start + duration === nested start — so a future content edit that re-nests one of them fails on the specific pair rather than on an opaque list. The containment RULE keeps its coverage, retargeted at a synthetic item dropped inside the real 2026-12-21 block: it must still badge AND block. Deleting that case along with the grandfathered list would have removed the only assertion that containment counts at all.

**Changes if:** a future seed day genuinely needs a nested plan that cannot be told as two touching rows — then the honest fix is a container exemption argued as an amendment to D-316 (whose own `Changes if` already names that path), not a re-pinned "expected overlaps" list in a test. Or the clash rule stops being half-open, which would make every one of these touching pairs collide.
---

### D-334 · Supersedes D-291's chrome-accent clause ONLY · (issue #91, part of #88, 2026-08-16) · The chrome accent moves marigold -> volt `#3ED8FF` and the surface ramp gets more chromatic; the two country gradients are byte-identical

**Decision.** Two token-layer moves, in one commit, in `trip/app/globals.css` and its pinned mirror `trip/scripts/contrast-tokens.mjs`:

1. **The chrome accent is volt `#3ED8FF`** (`hsl(192 100% 62%)`), with lip `--lip-volt #1C97CC` and a declared-but-unconsumed CTA gradient `--cta-a #6E8BFF -> --cta-b #43E4FF`. `--primary`, `--accent`, `--ring`, `--accent-scroll` and `--accent-scroll-rgb` move as **one unit** — `--accent-scroll` is the copy that actually paints `:focus-visible`, every eyebrow, the tab-bar tint, the `h2` underline, `--shadow-glow`, today-pulse and the drag overlay, so moving `--primary` alone would leave the chrome where it was.
2. **The surface ramp is re-valued**: `#0E0920 / #170F2F / #221745 / #2F2159`. The base hue barely moves (258 -> ~254). **The saturation lift, 32% -> 50%, is the actual fix** — blue:red at surface-2 goes 1.50 -> 2.20 — and this was measured: pushing the hue toward 270 for "more purple" *raises* the red channel and makes the warm cast worse.

**What this supersedes, and what it does not.** It replaces **only** D-291's chrome-accent clause (the cyan -> marigold move). D-291's aubergine canvas, its identity-from-content principle and its country-gradient clause all **stand** — and the first two are the reasons this decision exists at all.

**Why: the accent was double-booked.** D-291 made one colour mean two incompatible things. `--marigold` and `--np-b` are the same 24 bits, so "this is pressable" and "this is Nepal" were the same signal, on a two-country product where the other country is pink -> violet. The consequence was not aesthetic: a Nepal-tinted surface and a primary button were indistinguishable by hue, and D-291's own stated principle — *identity comes from CONTENT, never from the chrome* — could not hold while the chrome WAS the content colour. **This is a second iteration on a standing goal, not a reversal.** D-291 was itself ruled against nearly this brief, got the canvas right, and got the accent wrong in a way that only shows once the canvas is in place.

**Marigold is not retired.** It keeps its hex and stays Nepal's gold stop and the front door's chapter-01 numeral. It stops being the interaction colour, and that is the whole of the change to it. **The two country gradients are byte-identical** (`--np-a/-b`, `--jp-a/-b`, `--grad-nepal`, `--grad-japan`) — splitting chrome from country identity is the structural point, so "harmonising" the country stops with the cooler canvas would undo it.

**The six accents stay six, and no seventh.** `--sky #5CD2F5` is renamed and re-valued to `--volt #3ED8FF` in place. A chrome accent bolted on beside the six would be a seventh colour and the palette rule exists to prevent exactly that.

**It fixes a live three-way map defect as a side effect.** `lib/map-style.ts`'s `CATEGORY_COLOR` collided with the live chrome accent on three of seven categories — `Attraction` at **0.0 deg** of hue separation from marigold, `Cultural` 4.1, `Restaurant` 19.7 — so a map pin and "pressable" were the same hue. The guard written to catch precisely this (`lib/__tests__/map-category-mirror.test.ts`) **hardcoded `189`**, the cyan retired two accent changes earlier, so it passed the whole time. It now reads the live accent out of `globals.css` and asserts **every** category, and it asserts the four accent tokens are one value. Against volt the closest category is `Hotel` at **46.7 deg**. Verified by running the new guard against the retired accent: it fails on exactly those three (`Attraction` 0.2, `Cultural` 4.3, `Restaurant` 20.0 — the deltas differ from the raw hue by 0.2 because the token's hue is the integer 42). The map pin palette itself is still frozen for the /map slice (D-292); the freeze is simply no longer covering for a defect.

**What did NOT move, deliberately.** The three text tiers (`#FFFFFF / #CFC6E0 / #A79BC0`) are byte-identical: ~728 sites were swept onto them under issue #27 and re-hueing them buys nothing. Re-measured on the new ramp they read hi 19.47/18.33/16.45/14.16, mid 11.87/11.18/10.03/8.64, lo 7.50/7.06/6.34/**5.46** — the tightest pair is 21% over AA. The traveller accents in `lib/token-auth.ts` are unchanged too (they mirror the three brand families, which are frozen); re-measured they read 12.25 / 6.07 / 9.28 / 11.62 / 8.30 / 4.96, all warm hues 24-42 and 330, so none can be confused with a cyan chrome accent.

**The rules that constrained the values.** THE INK RULE holds: the only legal ink on a saturated fill is `--on-accent #140F20`, and white-on-volt (**1.68**) joins white-on-marigold (1.59) as a guard that MUST keep failing. `--border #4A3880` stays DECORATIVE at **2.01** on the page field with its under-3:1 guard intact; `--border-ui #9184C9` is the interactive boundary and clears 3:1 on every step with more room than before (**5.89 / 5.54 / 4.97 / 4.28**, up from a 3.72 worst case). The `navy-*` names are still a documented misnomer and are still re-valued rather than renamed.

**Two consequences that had to be handled rather than discovered later.**

- **`--shadow-glow` had to move with the accent.** It aliased `--glow-nepal` on the reasoning that marigold was both the Nepal stop and the chrome accent. Every one of its five consumers is a `hover:`/`focus-within:` pair that sets `border-[hsl(var(--accent-scroll)/0.55)]` in the same class string, so leaving the alias would have painted a volt edge inside a gold halo. It now aliases a new `--glow-volt`; `--glow-nepal` keeps its name and value as the country glow with no consumer, like `--grad-nepal`.
- **`html[data-tm-legibility='high']` carries hardcoded copies of the ramp** and had to move with it or `/travel` would silently paint the retired palette back — the same defect that block already suffered once. Four steps, four distinct values, each one step below the base ramp.

**Resolved in this change, not handed on.** `/map`'s page identity was `--sky`, so renaming that slot made **/map's identity the chrome accent** — which `page-hero.tsx`'s own rule forbids. That collision was introduced mechanically by this decision's rename rather than chosen by anyone, so it is fixed here rather than deferred: a collision a token slice creates should not outlive the commit that created it. **/map takes `--marigold`** (8.37:1 over the JP header grade, measured in the harness). Marigold is genuinely free — it had exactly two roles, primary action (now `--volt`'s) and Nepal, and Nepal's identity is carried by `--np-a`/`--np-b`/`--grad-nepal`, which are their own tokens; `--np-b` merely SHARES marigold's hex. So this does not re-double-book the accent that this decision just un-double-booked. What the /map slice still owes under D-292 is the map PIN palette, which is a different question and is untouched.

**Held by** `npm run contrast-check` (`scripts/contrast-tokens.mjs`, a **hand-maintained mirror** of the token values, not a parser — deliberately, so a value change is a two-file decision) reporting ALL PAIRINGS PASS, ALL GUARDS HOLD across 147 pairings and 13 guards; and `lib/__tests__/map-category-mirror.test.ts` (16 assertions, up from 9).

**Changes if:** the /map palette slice lands and reassigns that route's accent; or a light material beyond the passport parchment is ever admitted, which would invalidate every ratio here at once since all of them are measured against a near-black field.

### D-333 · Narrows D-155's payer fallback · (issue #37 follow-up, 2026-08-15) · A split expense with no `paidBy` is UNATTRIBUTABLE; `settle()` takes no identity argument at all

**Decision:** `settle()` no longer resolves an absent `paidBy` to the signed-in traveller. A live, split expense with no recorded payer contributes NOTHING to any balance or transfer — the same treatment a fast-path (unsplit) or tombstoned row already gets. The `self?: string` third parameter is REMOVED, not merely ignored, so the resolution cannot be re-wired by a future caller. `components/budget-panel.tsx` drops the argument and, with it, its only `useActiveTraveler()` subscription. The expense dialog still prefills its payer picker with the active traveller; that is an editing default the user can see and change, and it is now documented as such rather than as the meaning of an absent field.

**Why: the fallback re-pointed money without writing a byte.** D-288 keeps the claim-authorship rewrite away from `Expense.paidBy`/`split[]` on the stated ground that *"they are settlement inputs, so a silent rewrite would re-point who owes whom."* The read-time fallback achieved exactly that harm by the other route: for a payer-less split row, the balance was attributed to whoever happened to be signed in, so a claim-authorship rename moved it to the new name while `paidBy`/`split` sat byte-identical. That is why the S408 money guard could not see it — every write-side invariant was satisfied. Note the direction: the settings-panel copy warns that the OLD name persists on paid-by chips and settle-up balances (issue #37 amendment 6), and this row did the opposite. It also made the shipped sentence *"Settle up keeps showing '{from}' in its balances"* (`components/settings-panel.tsx:906`) false for that row.

**The rename is one symptom of a wider defect.** `self` is `traveler?.name`, which is device-local: the same synced row settled to a different person on each traveller's device, with no rename involved. A settlement that depends on who is looking is not a settlement.

**`createdBy` was considered as a stable fallback and rejected.** It is stamped once at create and does not drift per device — but `claimAuthorship` DOES rewrite it, so money would move on a rename again, just through a different field. There is no stable stand-in for a payer nobody recorded, which is the argument for recording nothing.

**Checked, and the fallback was the odd one out.** Every other reader of `paidBy` already treats absent as absent: `lib/expense-csv.ts:46` emits `''`, and `rosterForActiveTrip` (`lib/token-auth.ts:163`) contributes no name. Only `settle()` invented one.

**Reachability, stated so the blast radius is not overestimated.** `components/expense-dialog.tsx:163` writes `paidBy` and `split` together or neither, so the app's own happy path cannot produce this row. It arrives via `sanitizeExpense`, which drops a non-string or empty `paidBy` while keeping a valid `split` (`core/budget/expenses.ts:129-133`, reached from `core/vault/backup.ts`, `lib/expense-export.ts`, `core/budget/storage.ts` and peer merge) — i.e. a vault/JSON import, a merged peer row, or a legacy row. `claimAuthorship` spreads the row, so it cannot create the shape either. **A guest save was named as a fourth route in the first draft of this entry and is wrong: it is unreachable.** `paidBy: ''` would need `meName === ''` while `splitMembers` is non-empty, but `meName` falls back through `allNames[0]` and `allNames` is `rosterForActiveTrip(expenses)`, which is non-empty in every case that can populate `splitMembers` at all. The behaviour change is therefore confined to a signed-in user viewing an imported/merged/legacy row: it used to be attributed to them, and now it is attributed to no one. An omitted row is a known unknown; a fabricated payer is a wrong number presented as fact.

**Held by** `lib/__tests__/settlement.test.ts` (two D-333 regressions replacing the test that pinned the fallback) and `lib/__tests__/claim-authorship-expenses-docs.test.ts` (the `exp-nopayer` fixture from issue #37 amendment 7).

**🔴 How these tests are written, because the obvious way does not work and the first draft shipped it.** The removed `self` was OPTIONAL. So a regression test that simply calls `settle(rows, ROSTER)` with two arguments passes against the DEFECTIVE implementation too — it takes the `if (!payer) continue` branch for want of an identity, not for want of a fallback. The first version of this slice was "mutation-proved" against a mutant that hardcoded a name, which was never the defect; a faithful revert of `settlement.ts` was then run against the whole suite by the review gate and **2204/2204 passed**. Deleting the parameter is what FIXES this; it is not what TESTS it. The discriminating question is "does supplying an identity change the answer?", and asking it requires supplying one — so both suites cast `settle` back to the three-argument shape and assert the third argument is inert (including the two sides of the rename, `OLD` vs `ME`, which differ by 800 NPR on the old code). Do not "clean up" those casts into two-argument calls: that deletes the only assertions that can fail. The general lesson is D-308's, one level up — a guard must be checked against a faithful revert of the change it guards, not against a mutant chosen by the same person who wrote the guard.

**Changes if:** expenses gain a stable, non-rewritable payer identity (a traveller id rather than a display-name string), which would make a recorded-at-create fallback safe; or the product decides a payer-less split should be surfaced as a repair prompt in the UI rather than silently omitted — that is a new surface, not a return to guessing.

### D-332 · Amends D-326's contrast finding · (issue #25, 2026-08-15) · The auth panel is separated from the cover by its EDGE, not its fill: a fill cannot carry a ratio over a graded photograph, and `--border` was invisible there at 1.04:1

D-326 measured the auth panel's **fill** against the cover — 1.74:1 — and ruled that the card is separated by depth rather than by a ratio. That ruling stands and is now proven rather than argued. What D-326 never measured is the panel's **edge**, and the edge is where the real defect was.

**The fill genuinely cannot carry a ratio, and this is arithmetic, not preference.** `.photo-header__duo-lo` is `mix-blend-mode: lighten` over the duotone shadow stop, so the grade **floors** every channel as well as capping it. Under the ruled `.72` scrim the backdrop is therefore a *range* — `#150C12` at the dark end, `#514443` at the bright end — and the panel's `--surface-2` fill sits **inside** it. A fill inside the range has no single ratio against the thing behind it: it hits 1.00:1 somewhere on the photograph by construction. Darkening only trades ends. At `--bg` the card measures 2.07:1 against the highlights and **1.00:1 against the shadows** — it disappears into the sky instead of the sand. The ceiling for *any* fill over this backdrop is **2.258:1**, at pure black. Reaching 3:1 needs a panel at `L ≥ 0.114`, i.e. a mid-grey card: a second light material dropped into a dark-only app, which is D-009 with a D-294-sized carve-out, for a login form. Refused.

**The defect that was actually there.** `.glass-card-dark` draws `1px solid hsl(var(--border))`, and over this cover that line measures **1.04:1** against the brightest pixel the scrim can pass. The auth panel's hairline is not merely decorative there, it is **invisible** wherever the card crosses the photograph's highlights — leaving the card held by a fill step and a shadow, which is precisely the F-8 failure mode recorded against D-291, arriving on the one surface F-8 was written about. The same finding was already on record one control over: `contrast-tokens.mjs` says of the door's ghost CTA that `--border` "would be a button with no visible boundary on the loudest surface in the product". It was never carried across to the container that arrived later.

**What ships.** One declaration in `globals.css`, scoped to the wall: `.wall-auth-open [role='dialog'] { border-color: var(--border-ui) }`. `--border-ui` is the boundary already ruled for the door's key field and its ghost CTA over this same photograph, so this is a precedent applied, not a value invented — no new token, and `token-gate.tsx` already consumes it as `border-[color:var(--border-ui)]` twice. The scoping matters: the **landing** panel sits on a flat gradient rather than a photograph, and the other `.glass-card-dark` consumers are on solid canvas, so none of them has this problem and none of them changes. It wins on specificity (0,2,0 against 0,1,0, both unlayered and later in source), so no `!important`. In high-legibility mode `--border` is already pointed at `--border-ui`, so that mode was never affected and the change simply makes the default agree with it.

**Measured.** Edge against the cover: **1.04 → 2.38** at the bright end, **1.99 → 4.92** at the dark end. The edge also reads from inside the card (`--border-ui` on `--surface-2` is 4.15:1). Nothing else moves: the `.72` scrim and the `--surface-2` fill are both byte-unchanged, so every pairing inside the panel — the three text tiers, the field and its edge, the error colour, the focus ring — sits on the same solid fill it was measured on. White over the cover stays 9.30:1 and `--text-mid` stays 5.67:1. No alpha, no opacity and no text tier moves, so D-100/D-246 are untouched. The change is a static `border-color`, so it introduces no animation and has no reduced-motion fork.

**Why the harness gains a second backdrop.** `contrast-tokens.mjs` modelled only `doorWall`, the brightest pixel, because a *text* pairing only cares about its worst case. An **edge** has to survive both ends of the range, so the shadow stop and `doorWallLo` are new, and the edge is asserted against both. The bright-end target is **2**, and that is the ruled floor for this container edge rather than a WCAG number: 3 is unreachable there for anything that is not a text tier or the focus ring — only `--text-lo` (3.58) and `--marigold` (5.85) clear it, and neither may be spent on a resting border. A harness that claimed 3 here would be a harness that had started lying. The old fill guard stays byte-unchanged and is joined by `['--border as the auth panel edge over the cover', 1.04 < 2]`, which is what makes the override load-bearing.

**The lever deliberately not pulled.** The only change that reaches a true 3:1 relationship is *lightening* the scrim to `.56` (3.01:1, white still 5.39:1, clears the `.52` body-text floor). It works arithmetically and is refused on tier grounds: it makes the photograph loud behind a quiet form and it changes the `.72` dialog scrim product-wide, which is a design-system value and not this surface's to spend.

**Changes if:** `--border` is re-valued, or the scrim moves off `.72` — either could make the override unnecessary, and the `< 2` guard flipping is the signal to decide that on purpose. Or the panel becomes translucent, which re-opens D-326's own `Changes if` and re-measures everything in the card.

### D-335 · LOCKED (amends D-073 and D-086 clause (b)) · (issue #89, 2026-08-16, owner-ruled) · One named path prefix is precached: `images/hero/*.avif`. Images are still never precached everywhere else, and the WebP/JPG hole is bounded and accepted

**Decision.** `scripts/gen-sw.mjs` precaches `images/hero/*.avif` — six files, **555.2 KiB** on this build — and nothing else under `images/`. D-073's "not `public/images/**`" and D-086(b)'s "*Images are never precached (D-073)*" are superseded **for this prefix and for no other**.

**This fires D-086's own `Changes if`, first clause: "*the image corpus outgrows cap 80 (raise it deliberately here)*".** It has — there are 107 manifest paths against a cap of 80 — and the deliberate answer taken here is not to raise the cap (which would put ~10 MB of gallery photography into a cache with no budget) but to lift the six files that have a hard offline requirement out of the eviction pool entirely. D-086's `Why` makes the same point from the other side: the four values it locks are "*precisely the values a well-meaning future SW edit would silently get wrong*", so the exception is recorded here rather than left as an unexplained regex in `gen-sw.mjs`. The first pass of this slice shipped the regex without this entry, and review caught it: the code and the decision log gave opposite answers.

- **(a) It is a path PREFIX matched against the real `out/` walk** (`HERO_PRECACHE = /^images\/hero\/[^/]+\.avif$/` in `buildPrecacheList`), never a literal URL list. Two consequences, both wanted: a variant that `gen-images.mjs` renames or re-emits at another width cannot silently fall out of coverage, and a variant that was *not* emitted is simply absent from the list instead of 404-ing every install and tearing the atomic precache. `images/hero/` holds only the two hero frames and their build-time derivatives — every gallery photograph lives under `images/{nepal,japan,map,featured,photography,landing}/` — so the prefix is narrow by construction rather than by a list somebody has to maintain.
- **(b) There are two reasons, and the second is the bigger one.**
  - *(i) The new bug.* The leg-aware hero (issue #89) requests a URL the device has **never** seen: `hero-japan.*` is not fetched on any day before 19 Dec, so it is not in the runtime image cache either. Offline on the day the photograph changes, the fetch fails, `OptimizedImage`'s `onError` fires, and the hero paints the invented SVG mountain range. A leg-aware hero that shows fake mountains on the one day it swaps is worse than no swap.
  - *(ii) The pre-existing bug, which is worse.* `trip-images-v1` is **FIFO-80, not LRU-80**: `trimImageCache()` evicts oldest **by insertion order**, and a cache HIT does not refresh recency. Against **105** other manifest images and a cap of 80, and with Home as the entry route, the hero is among the very first entries inserted and therefore among the very first evicted — ordinary gallery browsing is enough to lose it. **The default hero was already cold offline before this feature existed.** This amendment fixes a shipped defect, not only the new one. D-086(b)'s "LRU" wording describes an intent the code does not implement; that is noted here and left alone, because the fix for the hero is precaching it, not rewriting the eviction policy.
- **(c) The accepted hole, named rather than waved at.** WebP (**+1.16 MB**) and JPG (**+1.22 MB**) stay excluded. `OptimizedImage` renders `<picture>`, and a `<source>` whose `type` the browser supports always wins, so those bytes are only ever requested by an engine that can run a service worker but has no AVIF decoder: **Edge < 121, iOS Safari 16.0–16.3, Firefox < 93, Chrome < 85**. Measured, not assumed — offline with the runtime cache wiped, `hero-japan.webp` and `hero-japan.jpg` both come back FETCH REJECTED, so those engines degrade to the SVG fallback art offline rather than to a soft miss. Bounded, named, accepted: 2.38 MB to serve browsers three-plus years behind, on a decision whose whole cost argument is payload.
- **(d) All six AVIFs stay, and the trims were examined individually.** Every candidate trim drops a real device class — the hero passes `sizes="100vw"`, so selection is by viewport × DPR and there is no partial credit (a device that picks 1024w gets nothing from a precached 1920w). Dropping the two native 1920s in particular would put the offline hole on **DPR-3 phones**, which select native. Coverage wins over payload here; the payload is stated in (e) rather than reduced.
- **(e) The cost, in the denominator that matters.** Raw, the six files are 555.2 KiB of a 4.57 MiB precache — 11.9%, which understates it, because AVIF does not compress and the HTML and JS do. On the wire the install is **1.81 MiB gzipped** and the hero is **555.3 KiB of that — 30.0%**. A new user's install goes from **1.26 MiB to 1.81 MiB, +43%**. That is the real price of the offline hero guarantee and it is paid knowingly.
- **(f) What is UNTOUCHED, so no future reader widens this by analogy.** The `trip-images-v1` LRU/FIFO-80 cap (D-086(b)) still governs every other image; the content-hashed precache name (D-086(a)) is unchanged and now simply includes six more files in its hash; the origin-check-first rule (D-086(c)) is untouched; the images cache still survives `activate` on its own prefix. The `theme_color` clause (D-086(d)) is unrelated and unaffected.

**Held by** `e2e/pwa.spec.ts`: the retargeted exclusion test (`the ONLY /images/ precache entries are the six hero AVIFs`) fails both on a gallery image sneaking in and on a seventh hero file arriving unnoticed, and a new offline test wipes `trip-images-v1`, goes offline, loads `?today=2026-12-19` and asserts the Japan raster decoded with a non-zero `naturalWidth` and zero fallback-SVG paths on screen.

**One-line SW fix that came with this**, because the hero's offline guarantee now flows through it: the image branch's catch ended `return caches.match(request) || Response.error();`. `caches.match` returns a Promise, which is always truthy, so `Response.error()` was dead code and a genuine miss resolved to `undefined`. It is now `return (await caches.match(request)) || Response.error();`. Nothing else in that handler changed — in particular it still does **not** fall back on `!res.ok`, which is a real behaviour change and is filed separately.

**Deferred, deliberately:** no byte ceiling and no size assertion in `gen-sw.mjs` this round (owner's call — the amendment was chosen without one). The six-file count is pinned in the e2e instead, which catches a seventh frame but not a frame that doubles in size.

**Changes if:** the hero precache passes a stated byte ceiling, or a third hero frame lands without one — either is the moment to price this again rather than let the prefix grow silently. Also if `trimImageCache()` is ever made a true LRU, which would weaken reason (ii) but not reason (i).

### D-336 · LOCKED · (issue #89, 2026-08-16) · The `home-hero-*` visual baselines cannot detect a hero photograph change, and must never be cited as protection for one

**Decision.** `e2e/visual.spec.ts`'s `home-hero-{desktop,tablet,mobile}` snapshots are a layout regression gate, not an art gate. Any change to the hero photograph, its crop or its grade is re-baselined **deliberately** — `npx playwright test -g "home hero" --update-snapshots=all`, then read `git status` and OPEN the PNGs — and never inferred to be safe from a green run.

**Why, measured.** Issue #89 replaced the hero outright: a different photograph, an `object-position` shift, and a `mix-blend-mode: darken` cap over the entire frame. That moved **0.283%** of pixels against `e2e/visual.spec.ts:84`'s `maxDiffPixelRatio: 0.02`. It passes with 7× headroom. The cause is `.hero-scrim`, which holds the photograph at ~24% of the painted composite — the gate is mostly measuring scrim, so the one region it is named after is the one region it cannot see. Two of this slice's own changes confirm it from the other direction: `center 38%` moves the desktop frame **2.7px**, and at 390 the vertical focus value is inert by construction (a 1.5-aspect source in a portrait box crops horizontally only), so the cap alone was left to move those pixels and it did not move 2% of them.

**What that actually cost.** For the length of the redesign the three committed baselines contained the *retired* labelled NASA satellite map — "Tibetan plateau" and "Indo-Gangetic plain" legible under the `h1` — while `npm test`, the visual pack and CI were all green. The map's last home in this repo was the evidence files of the gate that was supposed to notice it. It is removed when the pack is re-shot after issue #92's Home rework (#93 sequences that; it runs last, once, so a slice does not re-baseline pixels the next slice moves again).

**This compounds the flag trap already recorded on #28.** Bare `--update-snapshots` defaults to mode `changed`, so it only writes when a comparison FAILS — and under a 2% allowance a hero swap does not fail, so the bare flag reports green and rewrites nothing, which is indistinguishable from "the baselines were already correct". `=all` is mandatory; the changed-file list is the evidence, not the exit code.

**What DOES hold the hero** is therefore assertion, not pixels: `lib/__tests__/hero-image.test.ts` pins both paths to real `image-manifest.json` keys, `e2e/countdown.spec.ts` pins the resolved raster per leg at `?today=`, `e2e/pwa.spec.ts` pins the precached set and the offline decode (D-335), and `npm run contrast-check` pins every text pairing over the composite. All four were added or extended in #89 precisely because the pixel gate could not carry it.

**Changes if:** the scrim floor drops materially (more photograph on screen raises the diff ratio and could make the pack meaningful again), `maxDiffPixelRatio` is tightened for this spec specifically, or the hero gets its own dedicated shot at a stricter threshold — which is the cheap fix if this keeps costing time.

### D-337 · Amends D-305's assertion 2 and supersedes its monotonicity deferral · (2026-08-17) · The release gate refuses a `trip/docs/RELEASES.md` heading that says the release is HELD, and refuses a version that is not strictly above the newest deploy tag; zero visible tags is a FAILURE

**Decision.** Two changes to `scripts/release-gate.mjs`, and nothing else in D-305 moves.

- **(a) Assertion 2 stops being a fixed string.** `releases.includes('## <tag> ')` becomes a scan of `## ` heading lines: `**` is stripped, the tag must match as a whole token, and the entry is REFUSED if a hold marker — `NOT DEPLOYED`, `NOT SHIPPED` or `⛔` — appears anywhere on that line, not only as a prefix.
- **(b) A new assertion 1b requires the version to have gone UP.** It is compared against the highest existing `v*` tag as a numeric triple and fails unless it is strictly higher. **Zero parseable tags is a failure, not a pass.**

**Why (a): the code and the decision log gave opposite answers, and the code was the one that shipped.** D-305 pins assertion 2 as the fixed string, and this script's own comment claimed a heading carrying the NOT-DEPLOYED marker therefore did not satisfy it. It always did: the marker is a **suffix** on the heading, so `## v6.0.0 (app) · NOT DEPLOYED · …` contains `## v6.0.0 ` and matched. The gate printed `release-gate: v6.0.0 is clear to ship` and exited 0 on an entry whose body reads *"it is NOT cleared to ship … that merge deploys immediately"*. This is the only automated signal the `dev` → `main` pull request carries, and the thing it was wrong about is the one question it exists to answer.

**Why (b), superseding D-305's deferral.** That deferral reads *"correct semver ordering is not a four-line job"*. It is one, once ordering is restricted to a plain `N.N.N` and everything else fails loudly rather than sorting oddly — the parse is a regex, the comparison is a triple, and a version this file cannot order is refused by name instead of guessed at. The hole it left was live, not theoretical: `v5.8.0`, `v5.10.x`, `v5.11.0`/`.1`, `v5.12.x`, `v5.13.0`, `v5.14.1` and `v5.15.0` are all versioned in `trip/docs/RELEASES.md` and were never tagged, so setting the version **backwards** to any of them passed assertion 1's inequality, shipped old-looking bytes, and then got tagged as if it were a release — `deploy.yml`'s own header records that class of accident happening once. D-134's failed-deploy re-run stays legal and is not weakened: a failed deploy writes no tag, so its version is still above the newest one.

**The consequence worth stating out loud.** A revert must now bump the version **forward**. It can never restore an older number, tagged or not, and a release that wants the old bytes back gets them under a new version.

**Three ceilings, named rather than papered over.**

- **First match.** The scan takes the first heading naming the tag, and a heading may NAME an older release: `trip/docs/RELEASES.md:165` is `## v5.11.2 (app) + v1.8.0 (worker) — 2026-08-09 · **DEPLOYED**: the first live deploy since v5.9.2`, which shadows v5.9.2's own entry at `:243`. Enumerated against every heading in the real file, that is the only shadow, and both lines are unheld so the verdict is the same either way. It is safe by construction rather than by luck: a shadowing heading is always a **newer** release, so a shadowed version is below the newest documented one, and 1b now refuses everything at or below `v5.14.4` — the only two headings above it (`v6.0.0` at `:15`, `v5.15.0` at `:49`) are both held, so a shadow match today lands on a held line and fails closed. The single fail-open shape is a held target named by a newer, still-untagged, NOT-held heading, and creating one means writing "supersedes v5.15.0" into an unshipped release's heading. If it ever bites, the upgrade is two lines and is written in the comment: prefer the heading whose first token after `## ` (past an optional marker) IS the tag, falling back to the current scan, which every app heading in the file already satisfies.
- **Worker versions.** Every heading line also names a worker version (`v1.8.0`, `v1.9.0`), so a whole-token scan is only correct because it is fed the **app** version out of `trip/package.json`. Feed it a worker version and it matches the wrong line.
- **A tagless checkout cannot run this gate at all**, deliberately. That is D-305's trap turned into a loud refusal rather than a silent pass: without tags the gate cannot answer "did it go up", so it says so. Both call sites already pin `fetch-depth: 0` and `fetch-tags: true`, and a third caller must too — under `actions/checkout@v4`'s default the gate is now red rather than falsely green.

**Held by** `trip/lib/__tests__/release-gate.test.ts`, which runs the real script as a child process against a throwaway tree holding only the two files it reads — the artifact CI runs, not exported helpers a refactor could let drift. Four cases: both hold-marker forms refused with the offending heading quoted, the real `v5.11.2` **DEPLOYED** shape still passing (the line a laxer marker test breaks on), and a near miss (`v6.0.01`) reported as *no entry* rather than as held.

**Changes if:** a heading is genuinely needed that names a held release from a newer, unshipped entry, which is the moment to spend the two-line upgrade above rather than widen the scan · or a rollback to an older version number is genuinely wanted, which is now impossible by construction and must be argued as an amendment here, not as a quiet exception at the call site · or tags stop being the record of what is live (D-134), which is the fact both assertion 1 and assertion 1b rest on.

### D-338 · Cites D-180, not D-152 (D-255 already settled which) · (2026-08-17) · The concierge Worker takes an IP-keyed 60-per-60s rate limit that bounds no daily quota and FAILS OPEN on purpose; `[observability]` counters amend no privacy clause

**Decision.** Worker **v1.8.1** is prepared on top of the live **v1.8.0** (deployed 2026-08-09, Version ID `157ed2e0-2cfb-4044-af3e-ea80bc1b4ce6`): a Cloudflare rate-limit binding in front of the concierge's upstream call, plus `[observability]` on. **v1.9.0 stays reserved** for the unshipped membership gate and must not be consumed by this. The deploy is by hand from the private Worker tree, on D-180's runbook. It is the one carve-out from the v6 release hold, approved 2026-08-17 on the ground that the Worker is a separate service on its own version line, outside this repo and with no remote here: it touches neither `main` nor the app bundle, so shipping it deploys nothing that the hold is holding.

**The config form is first-class `[[ratelimits]]`** — `name = "CHAT_LIMITER"`, `namespace_id = "1001"`, `simple = { limit = 60, period = 60 }` — deliberately **not** `[[unsafe.bindings]]`. Both emit the identical wire binding, so the choice buys nothing at runtime; what it buys is that wrangler schema-validates the first-class form, and the failure this whole change is written against is a limiter that silently is not there.

**This entry is not about the limiter as implementation.** It exists because the four things below are choices a future cleanup pass will otherwise reverse for good-sounding reasons.

**(a) The ceiling, stated at full strength, because softening it is the failure mode.** The binding offers **only 10-second and 60-second windows**, so a per-minute limit does not bound a daily quota: at 60 per 60 s a single IP still gets **86,400 requests/day**, far past Groq's daily cap (D-174). The counter is **per-colo and best-effort**, not a global one, and IP keying is defeated outright by a distributed source. What this buys is real and it is narrow — it converts "one laptop with a `for` loop" into "sustained traffic from many IPs for hours". That is an improvement, **and it is not a fix**. The flip side is the guard's placement: it sits **after** the origin, route and token checks, so a **403, 405 or 401 is never rate-limited**, and every one of them still spends Cloudflare's 100k requests/day free allowance. A distributed scanner pointed at the wrong origin can therefore take the Worker dark for the rest of the day without ever consulting the limiter, which is the abuse shape this change does least about.

**(b) Fail-open is chosen, not overlooked.** If the `CHAT_LIMITER` binding is absent, or if `limit()` **rejects**, the guard is skipped and the request proceeds. The reasoning is blast radius: no card is on file and no money is at risk anywhere in this stack, so the worst case of an unbounded Worker is a free quota emptying, while the population being served is two real travellers. Fail-closed would trade that for a binding misconfiguration becoming a total concierge outage, in order to prevent an abuse that has not happened.

**The rejecting case is the one worth recording, because it is what a reverter needs to know.** Letting a rejection escape `fetch` means the handler returns **no `Response` at all**, so the CORS headers this route applies on the way out are never applied: the runtime answers 1101/500 without them, the browser blocks the response before the client can read it, and the client's own `catch` — not its status handling, which never runs — tells the traveller to check their connection. A limiter that turns a binding error into "you are offline" is strictly worse than having no limiter. The consequence, accepted rather than discovered later: **a deploy that loses the binding silently loses the limiter**, and `[observability]` is the only thing that can detect it.

**(c) `[observability] enabled = true` amends nothing, and the citation is the point.** It is request, error and CPU-time counters, with **no request-body content** of any kind. The no-logging clause that binds this Worker is **D-180**'s — *"no logging of message bodies or tokens anywhere"* — and **not D-152**, which is LOCKED, is about the journal never syncing, and says nothing about the Worker. **D-255 already litigated that exact mix-up** and ruled D-180 the governing entry, on the reasoning that the distinction decides who has to approve the change. Counters touch no content clause of D-180, so **no amendment is required** and none is claimed. This is written down because the likeliest future accident here is the opposite of a leak: a privacy-minded reader deleting `[observability]` on sight, which would also remove the only detector for the fail-open state in (b).

**(d) The upgrade path, and why it cannot be taken yet.** The right key is the trip token, instead of or as well as the IP. It is not available today: the Worker's own `src/index.ts:55-57` records that there is **no server-side registry of valid tokens** (D-221), so any non-empty string of the right shape passes, and a token-keyed limiter would be **strictly weaker** than an IP-keyed one — an abuser mints a fresh token per request and never lands in the same bucket twice. That changes the moment the reserved **v1.9.0** membership gate gives a token a server-side meaning, which is why the two are recorded next to each other: whoever builds that gate is holding the missing half of this limiter.

**Changes if:** the binding grows a window longer than 60 s, which is the first moment a daily quota becomes expressible at all and (a)'s ceiling becomes worth spending effort on · or the membership gate lands, which makes (d) available and should be taken in the same change rather than deferred again · or money enters the stack anywhere, a card on file at any provider, which inverts (b) directly because the blast radius stops being availability · or the 403/401/405 path becomes the observed abuse, which needs something in front of the Worker rather than a stricter limit inside it.

### D-339 · Extends D-307's stored-key class to the budget maps · Amended by D-340 (closes this entry's expenses ceiling; the budget ceiling stands) · (2026-08-17) · An unrecognised leg id is RETAINED verbatim by the expense and budget sanitizers and excluded in the AGGREGATES instead — and the retention is LOCAL only

**Decision.** `sanitizeExpense` accepts any non-empty-string `leg`; `id` and `category` stay fatal, because those two have no safe default. `normalizeModel` PRESERVES unknown keys in **both** `legBudgets` and `categoryBudgets` — it seeds the active pack's legs on top of whatever the slot already carries, rather than rebuilding the maps from `LEGS`. The exclusion moves to the aggregates: `expensesToSpent` (`core/budget/expenses.ts:208`) and `expensesByDate` (`core/budget/burn-rate.ts:188`) skip a row whose leg fails `isLeg`, and `settle` (`core/budget/settlement.ts:75`) excludes structurally, by iterating `LEGS` and matching rows to it rather than iterating rows. `isLeg` is exported once from `core/budget/model.ts:65`, next to `LEGS` which is its only source, instead of each consumer keeping a private copy.

**The rule, in the imperative, because this is the clause a later slice reverts: do not add a leg check back to a sanitizer, and any new aggregate must carry the `isLeg` skip.** The code that rejected a foreign leg at the sanitizer *looked like a guard*, and that is the whole reason this needs an entry — the instinct on meeting an unrecognised leg in a validator is to drop the row, the diff that does it reads as defensive, and here it destroys data.

**Why: rejecting at the sanitizer was a permanent delete, not a hidden row.** `LEGS` resolves ONCE at module load from whatever pack the active-trip pointer names, and the storage slot OUTLIVES that resolution. Both sanitizers run on **write** as well as read — `saveExpenses` is `expensesStore.set(sanitizeExpenses(expenses))` (`core/budget/storage.ts:49`), `saveBudget` is `budgetStore.set(normalizeModel(model))` (`:29`) — so the round trip was load → drop → save, and the next commit wrote the survivors back over the slot. `{ main: 5000 }` became `{ nepal: 0, japan: 0 }`; 40 imported rows became 0. **And the restore path reported success**, because `core/vault/backup.ts:118` validates with `Array.isArray(v) ? sanitizeExpenses(v) : null` and a fully-emptied `[]` is `!== null`, so an emptied list clears the never-destroy gate on its way to being written. 40 rows in, 0 out, "Trip restored".

**Three reachable routes, not one.** A config-less join that later heals and flips `LEGS` under a slot already written; a whole-trip backup restored across packs — reached from the sign-out dialog's own **"Back up this trip first"** button (`components/sign-out-confirm.tsx:109`), so the traveller is following the app's own advice at the moment it costs them the data; and an expenses-only import.

**`'__proto__'` is the one stored key deliberately NOT preserved, and it is the same family as D-307.** D-307 is about READING a map with a key that came from stored or imported data; this is the write half of that class — preserving arbitrary stored keys means assigning an attacker-reachable string onto an object literal. The key arrives as a real own property out of `JSON.parse`, but assigning it hits the `Object.prototype` setter instead of defining a key: on `legBudgets` the setter silently swallows the primitive, so the amount vanishes with no error and no key; on `categoryBudgets` an object value **replaces the `[[Prototype]]` of the object being returned**. Both loops `continue` on the key explicitly, at the assignment site, rather than constructing the maps prototype-less — the same choice D-307 argues for, for the same reason. Note this also retires D-307's *"deliberately not touched: `legBudgets` and `categoryBudgets`"* paragraph as a rationale: it held only because both maps were built by `for (const leg of LEGS)` loops, and this entry is the change that stops that being true.

**The ceiling, and it is the most important clause in this entry: the round-trip is LOCAL only.** It holds for `loadExpenses` / `saveExpenses`, and therefore for a whole-trip restore and for an import. It does **not** survive remote sync, in either domain. No later slice may treat this entry as sufficient cover for a remote-configured trip.

- **Expenses — erased on the first snapshot.** `lib/expenses-remote.ts:35` hardcodes its own two-leg list, `['nepal', 'japan']`, and `applySnapshot` rebuilds the ENTIRE local slot from that partition and persists the result. A foreign-leg row is not in the rebuilt list, so it is gone from the slot as soon as one snapshot lands — regardless of what the sanitizer was willing to keep.
- **Budget — outbound IS inert; inbound is where it stops.** `flattenBudget` iterates `LEGS` for both maps (`core/budget/flatten.ts:46-47`), so a preserved key is never emitted, never stamped and never written up: nothing leaks outward and nothing is clobbered on the way out. Coming back, `unflattenBudget` rebuilds `legBudgets` from `LEGS` alone (`:64`) and skips any `categoryBudgets` path whose leg is not in `LEGS` (`:76`), and `lib/budget-remote.ts:147` persists that rebuilt model over local. So the preserved key survives every local save and dies on the first budget snapshot.

**That gap is not fixed here and must not be described as fixed.** The guard stops at the sync seam. Closing it means the remote layer deriving its legs from the active pack instead of a literal, and `lib/expenses-remote.ts:35` is the single worst line in the repo for this: a hardcoded default-pack assumption sitting in a path that overwrites local storage.

**Amended by D-340 — the EXPENSES bullet above is now fixed; the BUDGET bullet is not.** `lib/expenses-remote.ts` and `lib/expenses-ports.ts` no longer hardcode `['nepal', 'japan']`; both import `LEGS` from `core/budget/model.ts`, the same pack-derived constant this entry's own aggregates already used. See D-340 for the root cause (worse than "erased" implies — a custom trip's expenses were never even pushed, so nothing had ever synced to be erased) and for why no dual-read migration window was needed. The BUDGET bullet directly above (`flattenBudget` / `unflattenBudget`, `lib/budget-remote.ts`) is untouched by D-340 and this entry's ceiling still stands for that domain.

**Why the local half is worth carrying anyway.** It is what makes a later change to the `legBudgets` key set non-destructive. A slice that adds, renames or re-homes a leg can do it without the previous build's sanitizer eating the old key's money on the next save — which is the failure that would otherwise be discovered after the save, when there is nothing left to recover.

**Held by** `lib/__tests__/unknown-leg-retention.test.ts`, plus extensions to `lib/__tests__/expenses-core.test.ts`, `expenses-storage.test.ts` and `expense-export.test.ts`. That file opens by asserting its own premise — that the suite runs under the default pack, so the leg id it uses really is foreign to `LEGS` — because every other case in it is vacuously green if that ever stops being true. It pins the retention through a **re-normalize** (the save path runs the normalizer a second time, which is where the old bug actually bit); pins that retention buys no other laxity, with `safeAmount` coercion still applied, categories still filtered to `BUDGET_CATEGORIES`, and an unknown leg whose categories are all invalid still dropped rather than left as an empty husk; pins `'__proto__'` refused in both maps and in both senses; pins the inertness through `rollUp`; and pins that `expensesByDate` and `expensesToSpent` agree about WHICH rows count — the two aggregates disagreeing is the shape this defect returns as once one of them loses its skip.

**Changes if:** the remote layer stops hardcoding its leg list, which is the moment the ceiling above closes and this entry is amended rather than quietly assumed to have covered sync all along · or `LEGS` stops being a module-load constant, since a reactive active-trip pointer removes the premise the whole defect rests on and would make the sanitizers safe to tighten again · or leg validation moves to the trust boundary — `core/vault/schema.ts` narrowing `leg` against the pack being restored INTO — which is the only place this decision should ever move to, and would make the aggregate skips redundant rather than merely relocating them.

---

### D-340 · Amends D-339 (fulfils its own "Changes if" — the remote layer stopped hardcoding its leg list, for expenses) · (issue #85, root-caused in #43, 2026-08-17) · The expenses remote-sync seam derives its chunk set from the ACTIVE pack's real `LEGS` instead of a private `['nepal', 'japan']` copy, and no dual-read window is needed because no client has ever written a custom trip's expense chunk under any key

**Decision.** `lib/expenses-remote.ts:35` (`const LEGS: readonly Leg[] = ['nepal', 'japan'] as const`) and `lib/expenses-ports.ts:34` (`for (const leg of ['nepal', 'japan'] as const)`) are deleted. Both files now `import { LEGS } from '@/core/budget/model'` — the same pack-derived, module-load-resolved constant D-339's `isLeg` already reads (`nepal`/`japan` for the default pack, `main` for a custom single-leg trip). Every `leg !== 'nepal' && leg !== 'japan'` / `d.id !== 'nepal' && d.id !== 'japan'` guard becomes `!LEGS.includes(...)`.

**This bug is worse than #85's write-side description, not a duplicate of it.** #85 says a custom trip's expenses fail to *push*. They also fail to *pull*, and the pull failure is destructive: `applySnapshot` (`lib/expenses-remote.ts:136-166`) builds the ENTIRE row-set it is about to persist by iterating its own `LEGS` — `for (const leg of LEGS) { …; result.push(...) } persistAndDispatch(result)`, where `persistAndDispatch` is `saveExpenses(result)`, an overwrite of the whole local slot. With the hardcoded pair, a `'main'`-leg trip's rows were never in that loop at all — not merged, not seeded, not considered, first snapshot or not. Since nothing had ever pushed a `'main'` chunk (next paragraph), the first server snapshot a signed-in traveller's client ever saw was a genuinely empty collection, and `persistAndDispatch([])` wiped every real logged expense on the trip. `trip/docs/RELEASES.md`'s `v5.15.0` entry already names the write-side half as "Root-caused during issue #43's manual pass, the fix is its own slice" — this is that slice, and it turned out to be two bugs sharing one hardcode, not one.

**Root cause, write side (why nothing had ever synced to be lost).** `expensesChunkSync.chunkDiff` (`lib/expenses-ports.ts:34`, pre-fix) only ever compared `legRows(prev, 'nepal')` / `legRows(prev, 'japan')`. On a `'main'`-leg trip both are permanently `[]` on both sides of the diff, so `chunkDiff` reported no changed chunk, ever — the offline outbox (`withOutbox`, `core/sync/outbox.ts:197`) never enqueued a push for a custom trip's expenses, at all, since the feature existed. `pushExpenseChunk`'s own guard (`expenses-remote.ts:83`, pre-fix: `if (leg !== 'nepal' && leg !== 'japan') return`) would also have dropped a `'main'` chunk on the rare path that reached it directly. Two independent no-ops, same hardcode.

**The read-side fix required no new branching — only that the existing branches see the right leg.** `applySnapshot`'s per-leg logic was already correct once asked about the correct leg: `presentLegs.has(leg)` true (a chunk doc exists at all, including an explicitly empty one) is authoritative and applies verbatim — a deliberately emptied leg is a real state, D-018/D-091 parity, not a reseed trigger; `presentLegs.has(leg)` false is "never synced for this leg" and seeds UP from local while leaving local completely untouched (`expenses-remote.ts:148-157`, unchanged by this fix). That is exactly the distinction this slice's check needed — "server confirms zero for my legs" (apply, clear) vs. "the snapshot doesn't cover my legs because of a doc-id mismatch" (do not apply) — and it already existed; the bug was that `LEGS` (and therefore the loop that populates `result`, and the `d.id` filter that populates `presentLegs`) never resolved to `'main'` in the first place, so the "chunk ABSENT" branch was unreachable for a custom trip's real leg no matter what Firestore held.

**No dual-read window, for three independent reasons — this is a real conclusion, not an assumption skipped past:**
1. **The write side has been fully dead since the feature existed** (above), so no client, old or new, has EVER written a real expense row to `trips/{id}/expenses/main` or to any doc id outside `nepal`/`japan`. There is no legacy data under a "wrong" key to migrate, orphan, or split-brain — the migration this policy exists to protect against has no data to move.
2. **The custom-trip feature itself has never shipped.** `trip/docs/RELEASES.md`: the newest *deployed* app is `v5.14.4` (2026-08-14, confirmed against the live deploy tag, not the file's topmost heading — see that file's own caution about the two times its heading overstated what was live). Custom trips first appear in the `v5.15.0` entry, and both `v5.15.0` and `v6.0.0` are marked **NOT DEPLOYED**. There is no rollout window where an old (broken) client and a new (fixed) client share a real custom trip's data, because no real custom trip exists outside this held, undeployed release. The fix ships in the SAME build as the feature's first live appearance.
3. **The default pack is untouched.** `LEGS` for the default pack is byte-identical, `['nepal', 'japan']` (pinned by `lib/__tests__/custom-trip-config.test.ts`'s "DEFAULT pack: … byte-identical to the legacy hardcodes" case, and by this slice's own default-pack regression tests below) — nothing about the shipped Nepal × Japan trip's doc ids, sync behavior, or existing production data moves.

A flag day is therefore correct, not merely convenient: there is nothing to dual-read.

**One piece of harmless residue, named rather than silently left.** The pre-fix code's "chunk ABSENT → seed from local" branch ran for BOTH `'nepal'` and `'japan'` on every custom trip's first snapshot (both permanently absent, both `localLeg` permanently `[]` since a custom trip's rows are all `leg: 'main'`), so it called `seedUp('nepal', [])` and `seedUp('japan', [])` unconditionally — writing two junk, empty (`items: []`) chunk docs, `trips/{id}/expenses/{nepal,japan}`, on a custom trip. They carry no data (nothing to lose) and the fixed code ignores them from here on (`LEGS.includes(d.id)` is `false` for both on a `'main'`-leg trip). They are dead weight, not a hazard; cleaning them up is optional and out of this slice's scope.

**Held by** a new suite, `lib/__tests__/expenses-remote-custom-leg.test.ts`, against a fake Firestore (mirrors `itinerary-remote-sync.test.ts`'s `onSnapshot` pattern) crossed with the `vi.resetModules()` + dynamic-import pattern `custom-trip-config.test.ts` uses to re-resolve a module-load constant under a different active pack. It pins: a DEFAULT-pack regression guard (empty first snapshot is a no-op; an unrecognized doc id is ignored); the CUSTOM-pack repro (chunk ABSENT, local `'main'` rows present → INTACT after an empty first snapshot, plus the seed-up write); the CUSTOM-pack authoritative-empty case (chunk PRESENT with `items: []` → DOES clear local, proving the fix is not "never apply an empty result"); the CUSTOM-pack authoritative-nonempty case (remote rows apply verbatim); the write side (`chunkDiff` now reports `'main'` changed; `expensesSyncPort.push` reaches Firestore as `trips/{id}/expenses/main`); and that `pushExpenseChunk` still acks-and-drops a leg genuinely foreign to the active pack (`'nepal'` under a `'main'`-leg pack), never issuing a bad write. Mutation-checked by running the new suite against the pre-fix code (git-stashing only the two source files): 5 of 9 cases fail, including the headline "local rows survive an empty first snapshot" assertion, which reports `[]` instead of the seeded rows — exactly the wipe this entry fixes. `lib/__tests__/expenses-remote-sync.test.ts` (the existing default-pack push suite) is untouched and stays green, and `lib/__tests__/custom-trip-config.test.ts`'s default-pack byte-identity case is unaffected.

**Changes if:** a second registered PACK (not a custom single-leg trip) ships with a leg id that collides in name with `'nepal'`/`'japan'` but different semantics — none exists today, and `LEGS.includes` would need a pack-scoped disambiguator rather than a bare string set · or D-339's budget-side ceiling (`flattenBudget`/`unflattenBudget`, `lib/budget-remote.ts`) is closed the same way, which would let this entry's "budget bullet is not" caveat be struck.
### D-341 · Extends D-399's INERT-until-armed contract · (v6 cycle, 2026-08-17) · Firestore membership enforcement is unverifiable from this repo alone — no publish is recorded since D-219, and `FIREBASE_SERVICE_ACCOUNT` still does not exist as a repository secret

**Decision.** No slice may treat `firestore.rules` in this tree as describing a running system, and no issue may be closed on the grounds that these rules prevent something, until `FIREBASE_SERVICE_ACCOUNT` exists as a repository secret AND a release has actually run `publish-rules`'s publishing branch. Today it has not: `deploy.yml`'s `publish-rules` job (`:155-213`, `needs: build`) reads the secret into `env.FIREBASE_SERVICE_ACCOUNT` (`:166-167`) and takes the `if: env.FIREBASE_SERVICE_ACCOUNT == ''` branch (`:185-194`) — which warns and publishes nothing — whenever the secret is unset; the `if: env.FIREBASE_SERVICE_ACCOUNT != ''` branch that actually runs `firebase-tools@14 deploy --only firestore:rules` (`:196-208`) never executes otherwise. `gh secret list --repo Powan55/trip_planner` returns exactly six `NEXT_PUBLIC_FIREBASE_*` entries and no `FIREBASE_SERVICE_ACCOUNT` (checked live, 2026-08-17), so the inert branch is the one every release has taken since D-399 landed.

**What is actually live is unknown from this repository, and that unprovability is the finding, not a gap to research away.** D-219 (`DECISIONS.md:1505`) is the last publish recorded anywhere: on 2026-07-19 it live-verified `match /trips/{tripId} { allow get, create, update, delete: if true; match /{sub}/{document=**} { allow get, list, write: if true; } }` — no auth floor, no shape guard, enumeration denied only. Nothing since is recorded as published; D-248's shape guard, D-251's `boundedWrite()`, and the whole member model (D-296, D-300, D-301) all landed in this tree as file changes only. So the ruleset a reader sees in `firestore.rules` today — `request.auth != null` gating throughout, `isMember()`/`isOwner()` on the trip doc and its subtree, the `profile/**`/`meta/**` carve-outs D-296 requires for the login door — is provably not what D-399's own contract (`git show v<version>:firestore.rules` answers "what is live") can vouch for, because that contract's own precondition (the secret exists) is unmet.

**Why SB-7 fixes `firestore.rules:238` anyway, despite the file being unpublished.** D-399 records the publish as an unconditional overwrite with no diff and no confirmation — whatever sits in the tree at release time becomes live, instantly. `firestore.rules:238` read `allow get, delete: if request.auth != null;` inside `match /profile/{document=**}`, letting any signed-in party holding a `userToken` destroy `trips/{userToken}/profile/identity` — the exact document the login door reads to validate a pasted User Token (`trips-remote.ts:164`, `:202`) — which bricks that account. No production call site uses the grant: every `deleteDoc` in the tracked tree (excluding tests and e2e) is `itinerary-remote.ts:430` (`days/{date}`) and `presence.ts:273` (`presence/{deviceId}`). Publishing an unused destructive grant is strictly worse than leaving it in a file nobody has published yet, so it is fixed now rather than left for whichever slice next touches this file — narrowing it costs nothing, since no reachable client is broken in any window. `scripts/rules-check.mjs:518-519`, which previously pinned the grant as `'ALLOWED'`, is flipped to `'DENIED'` in the same commit; splitting the two would make the emulator gate fail the correct fix instead of the bug it replaces.

**Binding consequence.** Every statement anywhere in this codebase about `isMember()`, the auth floor, or membership enforcement describes a file, not a system in production. A future client or Worker change that assumes a stranger cannot read or write `trips/{id}/**` without membership is assuming a ruleset that is not proven live. This does not weaken SB-7's fix — the fix is correct regardless of when it ships — it forecloses citing "the rules already prevent this" as closing rationale for any other issue while this entry stands.

**Why:** `ci.yml`'s `rules-check` job proves this file against a real Firestore emulator on every PR, and `deploy.yml` orders `publish-rules` before `deploy` so a failed publish ships nothing — both correct, and both currently proving a file that is never actually pushed to the live project. A repository that reads as secured while the live project is not is exactly the gap D-399 named and left open on purpose (arming needs an owner-run roster audit first); this entry exists so that gap cannot be forgotten by the time some other slice wants to lean on it.

**Changes if:** `FIREBASE_SERVICE_ACCOUNT` is set and a release runs `publish-rules`'s publishing branch — at which point D-399's contract becomes true for the first time, and D-219's standing rule applies: adversarially live-verify enumeration denial with a real `getDocs` against the live site after the publish.

**Addendum · (issue #478, 2026-09-22) · The inert test above no longer greps, and the publish toolchain is now frozen as well as pinned.** This entry states its inert test by quoting expressions `deploy.yml` no longer contains — `env.FIREBASE_SERVICE_ACCOUNT`, `if: env.FIREBASE_SERVICE_ACCOUNT == ''`, `if: env.FIREBASE_SERVICE_ACCOUNT != ''`, and the `firebase-tools@14 deploy --only firestore:rules` line. The test itself is unchanged in substance, so it is restated here rather than edited above, per this file's convention. **In its current form:** `publish-rules` holds `HAS_FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT != '' }}` at job scope and the credential itself only in step-level `env` on the publishing step; the warn-and-publish-nothing branch is `if: env.HAS_FIREBASE_SERVICE_ACCOUNT != 'true'`, and the branch that actually publishes is `if: env.HAS_FIREBASE_SERVICE_ACCOUNT == 'true'`, running `./tools/node_modules/.bin/firebase deploy --only firestore:rules --non-interactive`. Why the gate is a boolean at job scope, and why the two branches partition on `!= 'true'` rather than `== 'false'`, is in `deploy.yml`'s own comments and is not repeated here. **Nothing about this entry's binding consequence moves:** the secret still does not exist, the inert branch is still the one every release takes, and no slice may yet treat `firestore.rules` as describing a running system. Re-verify against the workflow, not against this paragraph — a documented invariant going quietly stale is the exact failure this entry was written to prevent, and it just happened to this entry.

**The substantive decision this addendum records: the publish toolchain is installed from a committed lockfile, which closes a supply-chain hole and freezes a patch path in the same move.** `npx --yes firebase-tools@14.27.0` pinned only the top-level spec; npm still re-resolved the whole transitive graph from the registry on every release run, in the one job that writes a Google service-account key to disk — so a single compromised transitive publish yielded the credential that rewrites the live ruleset. `tools/package.json` plus `tools/package-lock.json` now pin all 749 packages by integrity hash, installed with `npm ci --ignore-scripts` in a step whose environment does not contain the credential. **The trade, named because it is the half that goes quiet:** that re-resolution was both the hole and the patch path. The lock landed reporting 8 advisories — 1 critical (`tar@6.2.1`, hardlink path traversal and symlink poisoning), 1 high, 6 moderate — every one of them pre-existing inside `firebase-tools@14.27.0` and byte-identical to what `npx` had been installing unseen. The vulnerabilities are not new; what is new is that nothing bumps them on its own any more. `.github/dependabot.yml` gains an npm entry for `/tools` in the same commit and is now the only thing watching that tree. Note what that entry can and cannot do: it carries `target-branch: dev` for the same reason `/trip` does, and per this file's existing note that means it governs the scheduled monthly *version* bump only — Dependabot *security* updates always target the default branch and are off at the repo level, so they are not the mechanism here. **Whoever arms `FIREBASE_SERVICE_ACCOUNT` inherits a bump owner for `/tools`**, because from that moment the advisories in this tree are advisories next to a live credential rather than next to an inert one.

**Changes if:** a `firebase-tools` bump clears the advisories in `tools/package-lock.json`, or `/tools` grows a second tool — at which point "the publish runs one reviewed dependency tree" stops being true by inspection and needs re-checking · or Dependabot security updates are switched on at the repo level, which changes where these bumps land and is the condition `.github/dependabot.yml`'s own header already flags.
### D-342 · Completes SB-6's config-less placeholder · Protects D-314 and D-320 · (v6 session A, 2026-08-18) · An unconfigured trip's placeholder span is a FIXED, deliberately unreachable date — a trip whose dates nobody has set must never report itself as IN PROGRESS

**Decision.** `placeholderTripConfig` (`trip/core/trips/custom.ts`) spans the single fixed day `PLACEHOLDER_DATE = '2099-12-31'` — start and end — instead of the UTC "today" SB-6 shipped. The span stays exactly **one** day, so `buildDayShells` still manufactures exactly one empty shell (SB-6's whole point, and what stops a config-less joiner seeding 32 Nepal×Japan day docs into their own Firestore trip) and `TRIP_DATES` stays length >= 1. The rule this entry binds, beyond the constant: **a trip whose dates the user has never authored must never resolve to a span that contains the current date.** SB-6 is not weakened by any of this — a config-less registered `TripMeta` still resolves to the placeholder, never to `NEPAL_JAPAN_2026`, and a genuinely unknown id still returns `null`.

**"In progress" is not a cosmetic claim — it authorises two writes, and both fired.** Verified on a real run of the built app with a config-less joined trip, by dumping localStorage: `tripPlannerLifetimeVisits = {"cities":["Somewhere"],"countries":[]}` and `tripPlannerVisitConfirmations = {"checkedOn":"<today>","confirmed":[]}`.
1. **An unrequested geolocation prompt.** `runVisitAutocount` (`trip/lib/visit-autocount.ts:152-192`) hard-stops on `if (getTodayInTrip() === null) return;` — its own comment promises "no trip day, no prompt, ever… someone who reads the app at home in August is never asked for their location by this code". With the span on today, `TRIP_DATES` is `[today]`, `dayInTripFor` returns index 0, the gate passes, `markVisitCheck(today)` writes and `geo.getCurrentPosition` runs. The prompt was also provably useless: `matchPlace` skips any candidate `cityCoord` does not know, and `lib/city-coords.ts` has no entry for `PLACEHOLDER_CITY` (`'Somewhere'`), so `confirmVisit` could never fire no matter what the device answered. Asking for a location that cannot change any outcome is the worst version of this bug, not the mildest.
2. **Junk in a permanent record.** `addVisit` wrote `'Somewhere'` into `tripPlannerLifetimeVisits` — key 32, LIFETIME-SCOPED under D-314: outside the trip namespace **and** outside `wipeAllTripData()` on purpose, so it survives sign-out and "nothing can reconstruct it". A trip-scoped mistake is undoable by switching or clearing a trip; this one is not.

**Why a FIXED constant and not `today + N`.** Three independent properties, all lost by a relative date: (a) **deterministic** — the same `meta` always yields the same config, which retires the "PURE relative to its args but NOT time-pure" wart the old comment had to carry; (b) **cannot flip across midnight** — `core/dates`' `TRIP_DATES` is computed ONCE at module load while `placeholderTripConfig` is re-evaluated per call, so a relative span lets the frozen day list and a freshly-computed config disagree about the same trip mid-session; (c) **unit-testable without clock mocking.**

**Why NOT an empty span, which is the other obvious answer.** `TRIP_DATES` must stay length >= 1: roughly fifteen consumers index `TRIP_DATES[0]` / `TRIP_DATES[last]` unguarded — `components/calendar-day-picker.tsx:40` does `new Date(TRIP_DATES[0] + 'T12:00:00')`, which on `[]` becomes `new Date('undefinedT12:00:00')`, an Invalid Date — plus `calendar-planner.tsx:628`, `add-to-itinerary-dialog.tsx:135`, `import-place-sheet.tsx:86,100`, `trip-timeline.tsx:40`, `expense-log-host.tsx:53,59`, `quick-add-fab.tsx:82`, `lib/travel-date.ts:70`, `trip-story-recap.tsx:60`, `core/recap/model.ts:89`, `lib/visit-autocount.ts:91`. A zero-day span would be a fresh crash of exactly the class SB-6 exists to prevent.

**What the VALUE has to satisfy, and what it makes visible.** Far enough out that it is never "today" for any plausible life of this app, and ordinary enough that the date math around it stays sane — a real Gregorian date that `Intl`, `date-fns` and `new Date(str + 'T12:00:00')` all format normally, nowhere near an epoch boundary, and the last day of its century so it reads as a sentinel rather than as a date someone authored. The consequence is visible and is **reported, not hidden**: on a config-less trip Home's countdown now renders `880 MONTHS / 01 WEEKS / 05 DAYS` and `26797 DAYS TO GO`, and the trip-date label reads `December 31, 2099 – December 31, 2099`. That is an honest rendering of "these dates do not exist yet" and it is strictly better than the alternative it replaced (a trip that claimed to be running today, every day). Fixing the surface — a "dates not set yet" empty state for a config-less trip — is a separate slice; **it must not be fixed by moving the span back onto or near today**, which is exactly what this entry forbids. The post-trip branch reads correctly too: `isPostTrip` (`core/recap/model.ts:89`) is `false` for every real clock reading, `elapsedTripDates` is `[]`, and `/recap` shows its locked state with "0 of 1 trip days" (pre-fix it said "1 of 1" — the same false in-progress claim, in words).

**Held by** a new case in `trip/lib/__tests__/visit-autocount.test.ts` ("a config-less joined trip is never IN PROGRESS — nothing counted, no prompt"), which joins a config-less trip, sets the `?today=` clock to the REAL current UTC day (the one clock reading that can catch a placeholder span moved back onto today), and asserts `getVisited().cities` is empty, `tripPlannerLifetimeVisits` is absent, `getVisitConfirmations().checkedOn` is null, and `getCurrentPosition` was never called. Mutation-checked: against a placeholder span recomputed as UTC-today the case fails with `expected [ 'Somewhere' ] to deeply equal []`. Confirmed end-to-end on the served static build as well — a config-less joined trip loading `/` and `/plan/` leaves localStorage holding only identity, the trip pointer and the known-trips list; neither lifetime key appears at all. `trip/e2e/multi-trip-isolation.spec.ts`'s key classifier gains `tripPlannerLifetimeVisits` and `tripPlannerVisitConfirmations` in its **APP_SCOPED** set, not `LEGACY_LITERALS`: both are lifetime-scoped and carry no `trip:` prefix by design, so the classification has to be right on its own terms rather than by absence (a run under `?today=` inside a trip window writes both legitimately).

**Changes if:** a config-less trip starts receiving real dates from a synced config block at join time — at which point the placeholder is reached less often but must keep this span for the window before that lands · or `runVisitAutocount` gains the coordinate-table guard (`matchPlace` can never match, so never prompt) that this slice deliberately did NOT bundle: that guard is independently correct and closes the prompt half for any trip naming a city `cityCoord` does not know, but it is a separate pre-existing bug and it does not make an unreachable placeholder span unnecessary.
### D-353 · V6-1 · (2026-08-18) · Firestore's cached singleton (`getRemote()`) now opens with `persistentLocalCache()`, single-tab manager only

**Decision.** `lib/itinerary-remote.ts`'s `getRemote()` swaps `getFirestore(app)` for `initializeFirestore(app, { localCache: persistentLocalCache() })`, no `tabManager` option — single-tab persistence. Deliberate: every synced domain (`expenses-remote.ts`, `places-remote.ts`, `trips-remote.ts`, `presence.ts`, `docs-remote.ts`, `budget-remote.ts`) shares this one singleton init, so the swap buys offline reads and a persistent cache for the whole app in one line. Cost: a second tab open on the same device falls back to memory-only cache for its own Firestore layer — the SDK degrades gracefully, it does not throw.

**Why not `persistentMultipleTabManager()` too.** No reported case of a traveler running two tabs on one device needing offline reads in both; adding the multi-tab manager now solves a problem nobody has hit. Cheap to add later — a second constructor argument, not a restructure.

**Changes if:** a multi-tab usage pattern is reported (trip kept open in two tabs while syncing offline) — swap in `persistentMultipleTabManager()`.

### D-354 · V6-4 · (2026-08-18) · No `legBudgets` migration needed — the custom-trip feature has never deployed

This slice's plan flagged a possible stored-schema concern: once `budget-panel.tsx` renders a real card for a custom trip's `'main'` leg (instead of two hardcoded `nepal`/`japan` cards that write into keys a custom trip's rollup never reads), does any already-shipped device need its `legBudgets.nepal`/`.japan` data migrated forward into `.main`? **No — verified, not assumed.** `git tag --sort=-creatordate` tops out at `v5.14.4`. `trip/docs/RELEASES.md`'s `v5.15.0` and `v6.0.0` entries — the two releases where custom trips first appear at all — are both marked **NOT DEPLOYED**. No tag past `v5.14.4` exists, so no live device has ever run a build with a custom-trip budget UI, and no orphaned `legBudgets.nepal`/`.japan` data from a real custom trip exists to migrate. `'main'` is a **new** key on write, not a renamed one.

**Why this needs recording rather than just skipping silently.** The plan explicitly says this question "goes in `DECISIONS.md`" — so this entry closes it rather than the fix quietly doing nothing where a migration step was expected.

**Changes if:** custom trips ship live (a tag past `v6.0.0` deploys) before this entry is revisited — at that point any future rekey of `legBudgets` needs the read-both/migrate-on-read step this entry currently rules unnecessary.

### D-355 · V6-6 · (2026-08-18) · A custom trip's docs/packing fallback is a derived, country-neutral template — not `DEFAULT_TEMPLATE`

**Decision.** `core/docs/model.ts` gets `UNIVERSAL_TEMPLATE`, a `DEFAULT_TEMPLATE` filter (drops `nepal-visa`/`japan-entry`) plus a 4-label override map, kept as a derivation so it can't drift from `DEFAULT_TEMPLATE` on a future edit rather than as a hand-written second array. `loadDocs()`/`loadPacking()` pick their fallback via `isDefaultTrip()` — the Nepal×Japan template on the default trip, the country-neutral one (or, for packing, just the `universal`-category items) on any custom trip. In-memory template selection only; no persisted-key rename, no stored-schema change. Fixes A-15/#102: a custom trip's absent/corrupt docs slot was seeding — and, once synced, pushing to Firestore for every peer — six Nepal/Japan-specific rows into a trip that has neither.

**The static-export ceiling.** `app/layout.tsx`'s sitewide `<title>`/meta description and `app/plan/page.tsx`'s own `metadata.description` are deliberately left untouched: `next.config.js` has `output: 'export'` (D-010, LOCKED), so Server Component `metadata` bakes once at build time, before any visitor's trip exists — there is no per-request personalization mechanism available. Only the client-rendered `/plan` hero subtitle (a new `components/plan-hero.tsx`, mount-gated like `hero-section.tsx`'s `custom` flag) is fixed. `app/map/page.tsx`'s subtitle has the same issue and is out of scope here.

**Changes if:** a non-static (server-rendered) build ever becomes possible — at that point the layout/page `metadata` exports could read the active trip per-request instead of staying generic.

### D-356 · V6-7 · (2026-08-19) · Forgetting a trip now wipes its local data; the expenses quarantine and currency-rate cache join the one-registry invariant

**Decision (A-10/#100 fix).** `core/storage/gateway.ts` gets `wipeTripData(id)`, a `trip:{id}:*` prefix sweep scoped to one non-default trip (mirrors `wipeAllTripData()`'s collect-then-delete shape, no-ops on an empty id or `DEFAULT_TRIP_ID`). `core/trips/registry.ts::removeKnownTrip` now calls it alongside its existing list/tombstone writes, so forgetting a trip no longer leaves every `TRIP_SCOPED_SLOTS` member (itinerary, expenses, budget, journal, photos meta, docs, packing, share-inbox, favorites, day-anchors, weather cache, my-places, sync outbox, both quarantine slots) on disk forever. `syncOutbox` is itself trip-scoped, so a dirty outbox for the forgotten trip is swept with everything else — a later re-join can never replay stale local edits over the live remote.

**No dual-read/migration window for `expensesCorrupt` becoming a `TripScopedSlot`.** `lib/expense-export.ts`'s quarantine slot (`EXPENSE_QUARANTINE_KEY`, gateway key 37) is now routed through `keyFor('expensesCorrupt')` instead of raw `window.localStorage` calls, same move D-210 made for `itineraryCorrupt`. `git tag --sort=-creatordate` still tops out at `v5.14.4` — same fact D-354 verified — so no live device has ever run a custom-trip build capable of writing a per-trip-scoped quarantine blob under any key. There is nothing to orphan; the default pack keeps the byte-identical legacy literal via `keyFor`'s grandfather.

**A-26 — the currency-rate cache is registry-consistent only, not trip-scoped.** `lib/currency-rate.ts`'s cache now reads/writes `STORAGE_KEYS.currencyRateCache` (gateway key 38) via `readJson`/`writeJson`, replacing its own raw-`localStorage` boilerplate. Deliberately NOT added to `TripScopedSlot`/`ALL_TRIP_SCOPED_SLOTS` (mirrors `deviceId`/`firstRunTour`) — rates are genuinely global, sharing across trips is intentional, and this cache is not swept by `wipeAllTripData` or `wipeTripData`. The key string and retention policy are unchanged; only where the literal is declared and where the read/write happen moved, closing the module's former "deliberate, flagged exception to one-registry" carve-out.

**A-18 (photo blob orphan) is a named, deferred follow-up, not part of this slice.** `core/photos/blob-store.ts` IndexedDB blobs survive both `wipeTripData` and `wipeAllTripData` because only the photo metadata index is trip-scoped — the blob bytes are keyed separately in IndexedDB with no per-trip teardown. Per the sweep's own text, this is "a separate list()-vs-meta reconcile, not the minimum," effort M on its own. This slice does not touch `core/photos/blob-store.ts`.

**A-20 — a cancelled first-snapshot reconcile can no longer land after a wipe.** `lib/itinerary-remote.ts`'s `subscribeRemote`/`attemptSetup` awaits `getDocFromServer`/`getDoc` inside `reconcileFirstSnapshot` with no re-check of `cancelled` after the await returns — so a sign-out (`wipeAllTripData()` + reload) racing an in-flight first-snapshot reconcile could write the previous account's itinerary back to disk after the wipe. Fixed at the call site, not inside `reconcileFirstSnapshot`: the `applyRemoteAuthoritative` callback passed in is now wrapped, `(plans) => { if (!cancelled) applyRemoteAuthoritative(plans); }`, so a late-arriving continuation no-ops instead of writing. `reconcileFirstSnapshot`'s own signature is untouched — both of its internal `applyRemote(...)` call sites already route through this one wrapped callback.

**Changes if:** custom trips ship live before this entry is revisited — same D-354 condition — at which point `expensesCorrupt`'s no-migration reasoning above needs re-checking against real on-disk data.

### D-357 · V6-8 · (2026-08-19) · Three one-line correctness fixes: Home's trip-day clock, the pre-trip day count, and the pre-trip "Next up" item all now read from the same sources every sibling surface already uses

**A-22 — `trip-recap.tsx` read the device's own calendar day, not the trip's.** Its local `nowDateString()` built `'YYYY-MM-DD'` off `getNow()`'s LOCAL Y-M-D fields — the device's own midnight, not the destination's. `getNowAtTrip().date` (`lib/trip-now.ts`) is the destination-local, `?today=`-aware trip day every other trip-day surface already reads (`trip-story-recap.tsx`, `core/recap/wrapped.ts`, D-320's visit-autocount). Near a leg's midnight — the device clock reading past midnight while the traveller is still in the previous day's leg, or the reverse — the two disagreed by a day, so the recap's "days so far" set could differ from Home's own live day-in-trip by one. Fixed by deleting `nowDateString()` and its two call sites in favour of `getNowAtTrip().date`; the now-unused `getNow` import is dropped with it.

**A-23 — `travel-date.ts`'s pre-trip `daysUntilStart` truncated instead of counting calendar days.** `computeCountdown(TRIP_START, now).totalDays` is a flat, truncated day count (a partly-spent day is borrowed into the hour/minute/second residue — see D-313's own header), which under-reports by one for the entire day before departure: at 11pm the night before, `totalDays` reads 0 while a calendar reads "1 day away," and the surface says "Trip starts in 0 days" for the whole day before it starts, not just its last minute. Fixed with `differenceInCalendarDays(TRIP_START, now)` (date-fns, already a project dependency, already used the same way in `core/clock/countdown.ts`). No special-casing for 0: this branch only runs when `now.getTime() < TRIP_START.getTime()` (`travel-date.ts`'s own guard, one line above), and `TRIP_START` is local midnight, so the calendar-day difference computed here can never actually be 0 — there is no reachable case to special-case. **Scope, stated so this is never misread as reopening D-313:** this touches only `travel-date.ts`'s own `daysUntilStart` field. `core/clock/countdown.ts`'s `computeCountdown` — its `totalDays`, its calendar-accurate months/weeks/days breakdown, and the fact the two deliberately do NOT reconcile — is untouched, byte-identical, and still governed entirely by **D-313 (LOCKED)**.

**A-24 — `home-bento.tsx`'s pre-trip "Next up" tile showed the day's first STORED item, not its earliest.** `firstPlanned` picked `day.items[0]` — persisted/manual order, per D-018, not time order — so a day whose items had been reordered (drag, edit, a sync merge) could show a later activity as "Next up" ahead of an earlier one still to come. Fixed with `earliestTimedItem(day.items) ?? day.items[0]` (`lib/phase-of-day.ts`, already used two lines above in the same file for the in-trip case's phase grouping) — the untimed fallback is unchanged, so a day with nothing timed still shows its first stored item exactly as before.

**Why grouped:** all three are one-line correctness fixes, each replacing a locally-reasoned value with the shared derivation the rest of the app had already established for the same question — no new machinery, no behavior change outside the field named.

**Changes if:** none of these three reopens on its own; A-23's "no special-casing for 0" claim reopens only if `travel-date.ts`'s own pre-trip guard (`now.getTime() < TRIP_START.getTime()`) is ever loosened to admit `now === TRIP_START`.

### D-358 · V6-8, closes #98 · (2026-08-19) · The Home hero gets a third state: post-trip is no longer a permanently zeroed countdown

**What was wrong.** `components/hero-section.tsx` branched on `todayInTrip` alone: non-null → the "Day N — city" travel-mode panel, null → the six-cell countdown-to-day-one digit grid. `todayInTrip` is null both BEFORE the trip and AFTER it, so post-trip landed in the same branch pre-trip uses — `computeCountdown` returns its `ZERO_PAST` shape once `now >= target`, so the grid rendered "00:00:00", 0 total days, permanently, under "Countdown to day one … until adventure begins," for as long as the app is opened again after the trip ends.

**Decision: a third branch, gated on `mounted && !todayInTrip && isPostTrip(getNowAtTrip().date)`.** `isPostTrip` (`core/recap/model.ts`) and `getNowAtTrip()` (`lib/trip-now.ts`) are both already the app's standing answer to "is the whole trip over" and "what trip day is it, destination-local," used the same way by `trip-story-recap.tsx` and `core/recap/wrapped.ts`, and by the D-357/A-22 fix a few files over. No new device-local date helper was written for this — that would have been the exact anti-pattern D-357 just deleted from `trip-recap.tsx`.

**The new panel is static, not live, and deliberately smaller than what it replaces.** There is nothing left to count down, so it renders a fixed "Trip complete" heading plus the trip date range inside the same `glass-card` shell the in-trip panel uses, with an `ink-mid` caption line above it matching that panel's own contrast handling (this line also sits over the hero photograph, where the floor tier fails AA there). It carries its own `data-testid="hero-post-trip"`, sibling-named to the existing `hero-travel-mode`, so the e2e coverage below asserts a hook rather than prose. Being strictly less content than the six-cell grid it replaces, it cannot threaten the 740px fold-clearance budget **D-311** locks the grid's own sizing against, so no re-measurement was needed there. The existing "Open Planner" CTA (`!(mounted && todayInTrip)`) and the existing pre-trip countdown-grid branch are both untouched — the former already applies uniformly whenever `todayInTrip` is null, the latter already excludes post-trip once the new branch sits ahead of it in the ternary.

**The e2e test that pinned the old (buggy) behavior as correct is rewritten, not just extended.** `e2e/countdown.spec.ts`'s `'Post-trip state'` describe block used to assert the zeroed digit grid's testids read `'00'`/`'0'` as the CORRECT outcome. That assertion is deleted rather than kept alongside a new one — a test asserting both "the zero grid is right" and "the zero grid is gone" would be internally contradictory, and the old assertion was pinning the exact defect this entry fixes (same precedent for rewriting rather than appending as V6-4's A-13 fix). The rewritten test asserts `hero-travel-mode` still absent (unchanged), the four digit-grid testids (`countdown-hours`/`countdown-minutes`/`countdown-seconds`/`countdown-total-days`) now absent, `hero-post-trip` visible with "Trip complete," and keeps the pre-existing "Days travelled: 32" `home-stat-row` assertion — that half was already correct (it reaches the post-trip lifecycle state through `computeCountdown(...).isPast`, unrelated to the hero) and is unaffected by this change.

**What this does not touch.** `e2e/visual.spec.ts`'s `home-hero-*` snapshots pin at a pre-trip `TODAY`, and `countdown.spec.ts`'s S258 fold-budget spec also runs only at a pre-trip `?today=` — both untouched, no re-baseline needed either way. `core/clock/countdown.ts` is untouched (A-21's DST bug is explicitly deferred and out of scope for this slice).

**Changes if:** a post-trip surface wants to route somewhere other than the planner (e.g. straight to `/recap` or `/wrapped`) — that is a CTA-copy/target decision, not a re-litigation of this branch's gating condition.
### D-347 · LOCKED · (V6-9 / sweep-B B-5, 2026-08-17) · Composite ARIA roles are deleted, not implemented

_Renumbered from D-338 on 2026-08-17: Session A claimed the same id in parallel for the Worker rate limiter, and that entry had already shipped and was cited from `trip/docs/RELEASES.md`. This one had no references, so it moved._

**Decision.** A surface may declare `radiogroup`/`radio`, `menu`/`menuitem`, `listbox`/`option` or `tablist`/`tab` only if it also ships roving tabIndex and arrow-key handling. Where it does not, downgrade rather than build the contract: `radiogroup` → `role="group"`, `radio` + `aria-checked` → `aria-pressed`, `menu`/`menuitem` + `aria-haspopup` → deleted, with `role="group"` retained on the container.

**Why the container keeps a role.** `aria-label`/`aria-labelledby` on a bare `<div>` resolves to `generic` and the accessible name is dropped — deleting the role outright is a silent name loss, not a simplification. `group` itself carries no keyboard contract in APG, so this trades a lie for nothing. A role that promises navigation it does not honour is worse than no role: AT announces "radio button, 1 of 4", the user presses an arrow key, and nothing happens.

**Why not implement the pattern.** It is ~40 lines of roving-tabindex primitive plus five migrations, against six attribute deletions. The app already implements `tablist` (`budget-panel.tsx`), `listbox` (`time-picker.tsx`) and `combobox` (`plan-search.tsx`) correctly, which is what made the broken five actively misleading — the app teaches the user that arrows work and then five surfaces silently do not.

**Known holdout:** `components/settings-panel.tsx:1268/:1279` still carries `radiogroup`/`radio`. Deliberately untouched — a concurrent session owns that file, and `e2e/settings.spec.ts:447` asserts `aria-checked` on it, so the attribute flip and the assertion flip must land in one commit.

**Changes if:** a surface genuinely needs radio semantics for a screen-reader user's mental model badly enough to pay for the keyboard contract — in which case build one shared roving-tabindex component and migrate all of them, never one hand-rolled instance.

### D-343 · LOCKED · (V6-10 / sweep-B B-2, 2026-08-17) · Place cards are a stretched-`::after` title button, and every interactive sibling must be lifted

**Decision.** `recommendation-section.tsx`, `photography-guide.tsx` and `nightlife-section.tsx` make the **title** the details control, not the card. The `<h3>`'s `<button>` carries `after:absolute after:inset-0 after:rounded-2xl`, the card root carries `relative`, and **every interactive sibling in the card carries `relative z-10`**. The title button takes no `aria-label`: the visible name is both the heading text and the button's accessible name.

**Why the inversion.** A card-wide `<button>` is invalid twice over. `button` may only contain phrasing content, and `<h3>`/`<p>`/`<div>` are flow content — React's `validateDOMNesting` does not warn on it, which is how it survived. Worse, `button` is a **children-presentational** ARIA role, so everything inside collapses into the button's name: roughly 60 card titles on `/nepal` and `/japan` were absent from the heading outline entirely, leaving those routes at `h1` → `h2` → nothing.

**The trap this entry exists for.** The `::after` covers the whole card, so **an interactive sibling added without `relative z-10` is a control nobody can click** — and no test in the suite would catch it. Badges (`added-badge.tsx`) are passive `<span>`s and need no lift; `AddToPlanButton` and `guide-favorite-*` do have it. If a guard is ever wanted, the cheap version is one `elementFromPoint`-at-centre assertion per control, not a new abstraction.

**Two testids are now misnomers, deliberately.** `guide-card-*` and `nightlife-add-*` identify the **title button**, not the card wrapper — `nightlife-add-*` is the worse of the two, since it names an add action but opens the detail sheet, and always did. Both are kept because moving them touches ~20 spec references across 5 files. `guide-tilt-*` is the card-root handle if one is needed.

**Not a shared component.** Three files, one markup inversion each. Extracting a Card primitive was considered and rejected — `components/ui/` is not the shared layer here (`ui/button.tsx` ships 8 variants against 2 importers, versus 211 raw `<button>`s in 54 files), and a fourth abstraction nobody imports is how that happened.

**Changes if:** a fourth card surface wants the same pattern — at that point extract it, and put the `z-10` requirement in the component rather than in this entry.

### D-344 · LOCKED · (V6-11 / sweep-G G-2, 2026-08-17) · `.font-display` pins weight 400, unlayered — and which family a heading takes is still a per-site choice

**Decision, part one — the invariant.** `app/globals.css` carries one unlayered rule, `.font-display { font-weight: 400 }`. Instrument Serif ships weight 400 and nothing else, so this is not a remedy, it is the statement "this family has exactly one weight" expressed once instead of 93 times. **No site opts out, and it is never removed.**

**Unlayered is load-bearing.** It wins over `.font-bold` / `.font-semibold` at equal specificity (0,1,0) purely on source order — unlayered rules are emitted after `@tailwind utilities`. Verify in the compiled artifact, never in the source: `.font-display{font-weight:400}` must come **after** `.font-bold` and `.font-semibold`. Reproduce with `npx tailwindcss -i app/globals.css -o - | grep -n 'font-weight'`. **No line numbers are recorded here on purpose** — they were, and they were wrong within one revision: the pin measured 5054, then 5070, then 5074 across three rounds of *comment* edits to this same file. A compiled-artifact line number has no stable anchor. The ordering is the load-bearing fact and it is permanently true; the offsets are noise. **Moving this rule into `@layer base` or `@layer components` silently disables it** and returns all 70 faux bolds with nothing going red.

**What it fixed.** 70 of 93 `font-display` sites across 45 files paired the serif with `font-bold`/`font-semibold`, so every page title, section masthead, error heading and dialog title in the app rendered a browser-synthesised faux bold. `tailwind.config.ts:112-118` had documented this in writing as a live defect while the tree shipped 70 of them.

**Decision, part two — the remedy ruling.** `landing-page.tsx:238-242` and `token-gate.tsx:546-548` fix the same defect the other way, by **dropping `font-display`** and taking a sans display step. Those are not competing remedies and must not be reconciled: the pin is an invariant about the family, while **which family a heading takes is a design choice, per site.** Serif elegance keeps `font-display` and the pin makes it honest; real weight contrast takes the sans step and drops `font-display`. Both of those two sites stay as they are — their comments are right about the defect, they now just describe one the pin has already neutralised.

**Open follow-up, named so it is not lost.** The thing actually still wrong is `font-display` paired with a `text-display-*` step: those are sans steps tracked at `-0.035em`, while the serif steps use `-0.02em`. Those sites now render serif 400 at sans-800 tracking — weight honest, step mismatched. They want `text-editorial-*`, or the sans step without `font-display`; **which one is a design call, not a mechanical swap**, which is why it is not folded in here.

**It is three sites, not the nine-plus-one this entry first said.** V6-12 (D-346) landed between the two and collapsed eight of the nine page titles into one component. Current state of the pattern:

```
components/page-header.tsx:60     one site, covers 8 routes
app/travel/page.tsx:37            V6-12 did not touch /travel
components/page-hero.tsx:202
```

Note what that means: `page-header.tsx:60` is a **brand-new instance of the pattern this entry names as the open defect**, created after the entry was written — the extraction faithfully carried the mismatch forward, which is what a proven no-op extraction is supposed to do. The migration is now one component edit plus two, and it is the thing that stops a later author reading `landing-page.tsx` and stripping `font-display` off headings V6-11 repaired.

**Changes if:** a second weight of Instrument Serif is ever loaded — at which point this rule is wrong and must go, in the same commit as the font change.

### D-345 · LOCKED · (V6-11 / sweep-G G-1, 2026-08-17) · Travel Mode carries a 12:1 outdoor floor, and it is a headroom number, not a legality one

**Decision.** `scripts/contrast-tokens.mjs` models the `html[data-tm-legibility='high']` block. Over every text-tier × surface pairing it asserts a strict **raise** against the same pairing in normal mode and a **12:1 outdoor floor**; separately, once and globally, it asserts the three TM tier hexes are **three distinct values**. `--text-mid` (`#F2EFF9`) and `--text-lo` (`#E9E4F5`) are mirrored in both `globals.css` and that script and must move together.

**Why a floor at all.** The raise alone is not a check, and this was measured rather than argued: in the G-1 defect state every pairing still "rose" by 0.29–1.40 purely because the surface ramp darkens one step under fixed-hex text. A raise-only assertion would have been green on the dead feature. 12 is chosen because the overrides bottom out at 13.22, leaving 1.22 for a re-tune; 13 would leave 0.22 and go red on any nudge. Be precise about what it does not do: the defect state's ceiling among the rows the fix moves is 12.34, which clears 12 by 0.34 — the floor is sized to catch the ramp that broke, not to be unreachable.

**Why the distinctness assertion exists separately.** Setting all three tiers to `#FFFFFF` satisfies both the raise and the floor, and is exactly the shape of the deleted `[class*='text-white/']` rule that flattened every tier onto white@0.92. Measured: without the third assertion, a flattened ramp exits 0.

**AA is not the guarantee here.** Travel Mode's promise is headroom for sun on the screen. Every TM site passed AA for the entire time the feature was dead — `text-ink-lo` on a card sat at 7.06:1 where the deleted selector used to give 15.53:1, a 55% loss that no contrast guard could fire on.

**Two honest limits, recorded so nobody trusts the harness further than it goes.** (1) **This check would not have caught G-1 on the day.** The #27 sweep changed `.tsx` consumers, not tokens, and a hand-mirror of token values is structurally blind to a consumer change. It is the right shape only *now*, because the fix moves TM legibility out of a classname-dependent selector and into tokens. (2) **The surface-ramp collapse warning is only half-measured.** TM[i] equals normal[i-1], so a TM step *lightened* onto its lighter neighbour fires; a step *darkened*, or two steps collapsed onto one value, exits 0 silently.

**Changes if:** a re-tune genuinely cannot hold 12 — a decision to make on purpose, having watched the line go red — or the two TM overrides the mirror does not model (`--border`, `--muted-foreground`) are brought into it.

### D-346 · LOCKED · (V6-12 / sweep-E E-3 + sweep-G G-4, 2026-08-17) · Two masthead components, split by tier, and `HeroVariant` stays closed

**Decision.** `components/page-header.tsx` is the Tier-3 **text** masthead (glass panel, brand wash, eyebrow, `<h1>`, description). `components/page-hero.tsx` is the Tier-2 **photographic** band. Eight routes — `/checklist`, `/packing`, `/profile`, `/recap`, `/safety`, `/settings`, `/share`, `/trips` — take the former. **They are not merged and `HeroVariant` is not widened.**

**Why not widen the union.** G-4 proposed exactly that; rejected on two grounds. It buys a longer closed enum plus a Tier-2 photo code path none of the eight ever take — and `page-hero.tsx:1` is `'use client'`, so widening it would have pushed a client boundary onto eight Server Components that export `metadata`. The second reason was not the one the ruling was made for, and it is the more expensive one.

**What it fixed, and what it did NOT.** Eight byte-for-byte hand copies, identical down to class order; `app/trips/page.tsx`'s own comment admitted it "reuses the /settings header tokens verbatim". `2fddaf5` ("the retired gold survived the recolour on ten route headers") is that duplication having already cost one recolour bug. **The duplication was the whole defect.** All eight carried the accent as an inline `hsl(var(--accent-scroll))`, and that is **token-compliant** under `page-hero.tsx:21` — the rule there is token-not-literal, not class-not-inline, and `page-hero.tsx:198` uses the identical construct. It was wrong in eight places, not wrong in kind. Recording this because the scoping brief claimed otherwise, and a wrong rationale outlives the entry.

**Proven a no-op, not asserted.** All eight were compared old-versus-new through `renderToStaticMarkup` and are byte-identical, 693–794 B each — a string compare of the full serialized HTML, so it covers class order, attribute order, the `&amp;`/`&apos;` entity round-trip on `/checklist`, and JSX whitespace collapsing in the multi-line descriptions. The harness was proved to have teeth by deliberately breaking two of the three real differences and watching it report DIFF.

**Three real differences, preserved as props.** `/profile` alone lacks `animate-reveal-up` (`reveal={false}`); `/settings` alone carries `id="settings-title"` (`titleId` — the target of `settings-panel.tsx:123`'s `aria-labelledby`, which before that id existed pointed at nothing); per-route eyebrow, title and description text.

**Two conditional lifetimes, named so they do not become permanent by accident.** `reveal` exists only because `/profile` dropped the class **accidentally** in `ac66787`, whose own comment says the header "mirrors app/settings/page.tsx" — which has it. Restore the entrance and the prop goes with it. `accent` has no caller varying it and exists only to make G-4's per-route accent reachable without touching the union; retire that requirement and delete the prop.

**Net −76 lines, not the −133 the scoping estimate claimed.** −146 across the eight pages, +70 for the new file. The estimate assumed a ~25-line component with no prose, which contradicts this repo's own docblock standard (`page-hero.tsx`'s is 81 lines). The prose was kept and the number was not chased.

**Known ceiling: nothing in CI pins this.** Zero test coupling is what made the extraction provably safe, and it also means a future edit to that class-string template literal is unguarded. No presentational component in this repo has a test and the eight copies it replaced were equally unguarded and strictly worse — but it is a ceiling, not an oversight.

**Changes if:** any of the eight routes wants photography — at which point it is a Tier-2 route and takes `PageHero`, which is the whole basis of the split.

### D-348 · LOCKED · (V6-13 / sweep-E E-1, 2026-08-17) · Two image tiers, not three — and the LQIP stays WebP

**Decision.** `<picture>` ships AVIF plus the original raster (`.jpg`/`.png`) and nothing between them. The 296 `.webp` files and every `webp` key in `lib/image-manifest.json` are deleted, `gen-images.mjs` no longer emits the tier, and `ImageVariant` in `lib/image-srcset.ts` loses the field.

**Why the tier was dead, arithmetically.** Source order was AVIF → WebP → JPEG, so WebP could only ever win for a browser that decodes WebP but **not** AVIF. **Within the declared browserslist** (last-2 Chrome/Edge/Firefox/Safari/iOS + Firefox ESR + not dead) that set is empty.

**Outside it, the set is not empty, and saying "empty" unqualified would be the fourth false claim in these records.** `gen-sw.mjs:671-673` names them: Edge < 121, iOS Safari 16.0–16.3, Firefox < 93, Chrome < 85. Those engines were being served the WebP and now fall through to the **heavier JPEG**. Accepted — they are three-plus years behind and outside the support target — but it is a real regression for them, not a no-op.

**One transitional consequence, bounded to a single session.** A device holding an old service worker also holds old route HTML that still renders `<source type="image/webp">`. An AVIF-capable browser never requests it (the AVIF source wins). An AVIF-less one selects it, 404s, the SW image branch finds nothing cached and returns the real 404, and `OptimizedImage`'s `onError` swaps in the caller's fallback art. So: fallback art instead of photographs, on an already-degraded browser class, until the SW update lands and the page reloads. Self-healing, and shipped knowingly.

**Be honest about the win — it is not a payload win.** No user ever fetched these bytes. Tracked working-tree bytes went 100,614,781 → 59,226,489, so the tier was **41.1% of the repo**: clone, CI checkout and deploy time, nothing else. Any future note claiming this made the app faster is wrong.

**The 107 `blurDataURL` LQIPs stay `data:image/webp;base64`.** They are inlined into the manifest and never fetched, so the browserslist argument does not reach them, and `gen-images.mjs` keeps that one encode path. A reader grepping `webp` will find 107 hits in the manifest and they are all correct.

**One file outside the brief had to move, and it is the interesting one.** `lib/image-srcset.ts` declared `webp` as *required* on `ImageVariant`, so `tsc` broke the moment the manifest lost the key — the type was load-bearing in a way the file list did not predict. Its `format` parameter went single-valued with the tier and was dropped; the signature is now `buildSrcSet(variants, resolve)`.

**Guarded, not assumed.** `e2e/responsive-images.spec.ts` was inverted rather than deleted — it now asserts `toHaveCount(0)` on the webp `<source>` on both paths, plus a scan that no remaining `source` srcset carries a `.webp` URL, deliberately written not to match the `data:image/webp` LQIP (which rides a plain `<img>`). `lib/__tests__/image-srcset.test.ts`'s "builds srcset for webp" case became a `not.toMatch(/\.webp/)` regression guard.

**Changes if:** the browserslist ever admits a browser with WebP-but-not-AVIF support. Check that before regenerating the tier, not after.

### D-349 · LOCKED · (V6-14 / sweep-C C-5 + issue #109, 2026-08-17) · The precache is the shell and the hero, not the map — and `/map` cold-offline owes the boundary pane

**Decision.** MapLibre's engine chunks and the `font/**` glyph PBFs are **withheld** from the precache and runtime-cached instead. Measured off every install: **363,100 B gzip (354.6 KiB)** — 87,073 B for the two PBFs, 276,027 B for the engine. The SW's last fetch branch (`cacheFirst(request, PRECACHE)`) backfills the engine on the first **online** `/map` visit, into the same cache the checks read, so the preflight row flips to `ok` afterwards.

**Two mechanisms fed it, and both had to go.** Dropping only the explicit union left the engine riding in three call sites' own chunk lists via the island walk. The content scan and its anti-vacuity floor are kept — the floor now guards the opposite direction, "the engine drifts back INTO the precache unnoticed".

**The `/map` cold-offline contract, named once so the next flip is not archaeology.** It has moved three times (D-271 ① → S394 → here). The asserted artifact is **`data-testid="map-island-unavailable"`** (`components/map-island-boundary.tsx:93`), not a canvas. `data-testid="map-shell"` sits strictly *inside* that boundary — `map-section.tsx:1291` → `app/map/sections.tsx:9,22-24` → `app/map/page.tsx:27` — so cold-offline it never renders, by design and per D-274.

**#109, and the refutation that shaped it.** The image branch only fell back to cache when `fetch` **rejected**; a captive portal *resolves* (511, a redirect, or an opaque 200), so the offline hero broke with the correct bytes sitting in the precache. Fixed by returning the network response only when `res.ok` and otherwise falling through to `caches.match(request)`, scoped to the image branch. A genuine 404 with nothing cached still returns the real 404, not `Response.error()`. **C-3's proposed remedy (`res.redirected || res.type !== 'basic'`) was NOT implemented** — review refuted it, and correctly: the transparent-200 shape it names *is* basic and not redirected, so the guard misses the very case it was written for. C-4 was also refuted — the hero precache is present and landed in #110.

**Proven red-then-green, not asserted.** A synthetic `out/` fixture ran HEAD's `gen-sw.mjs` against the edited one: 23 → 19 precache entries, exactly four leaving, hero AVIFs byte-identical. The emitted `sw.js` was then executed in a `vm` with a stubbed Cache API — 6/6 green after, and red on HEAD with the exact symptom (`'<html>Sign in to WiFi</html>'` where `'HERO BYTES'` was expected).

**Known ceiling, reasoned but NOT measured.** MapLibre requests glyphs from inside a **blob-URL worker**. A blob worker inherits its creator's SW controller per spec and in Chromium/Firefox, so interception should hold — nobody measured it on this tree. If it does not hold, offline `/map` labels stay blank permanently rather than until one online visit. That degradation sits inside the D-274 boundary either way.

**The user-facing copy moved with it.** `lib/preflight.ts`'s map-shell row keeps `state: 'attention'` — there is a real action the traveller can take, so the row is honest — but "Map engine missing" read as an install fault and became the common case. It is now "Map engine not saved yet", naming the action. The D-286 constraint above it (cartocdn cross-origin, tiles never cached, PMTiles NO-GO) is untouched and still binding.

### D-350 · LOCKED · (V6-15 / sweep-G G-3 + sweep-B B-8 + issue #105, 2026-08-17) · `--tap` is reachable from a class name, and two sweep findings were wrong

**Decision.** `--tap: 44px` gains exactly three Tailwind keys — `spacing.tap` (→ `h-tap`/`w-tap`), `minHeight.tap`, `minWidth.tap` — and those are the canonical way to write the floor. 20 controls across 8 files were raised to it, headlined by `/plan`'s 17×17 drag grip. `ui/button.tsx` loses `glass-light` (it carried `text-gray-900`, a light-mode value forbidden under D-009) and `glass-dark`, both at zero consumers.

**Corrections to the sweep's own numbers.** G-3 said three live `ui/button.tsx` sizes were under the floor; at this app's real **17px root** it is five (default 42.5, xs 29.75, sm 38.25, icon 42.5, icon-sm 34) — G-3 used 16px math and omitted `icon`. `lg` at 46.75 was already clear. 136 sites still write `min-h-[44px]` literally; they are already at the floor and were left for opportunistic migration.

**Two findings were wrong, and the refusals are the point.**

1. **E-11's "three unused CSS classes" are live.** `.maplibregl-compact`, `.maplibregl-ctrl-attrib-inner` and `.maplibregl-ctrl-attrib-button` have zero *source* hits because **MapLibre generates that DOM at runtime** (15/1/1 hits in `maplibre-gl.js`). The block at `globals.css:1961` is a documented axe fix — MapLibre's default attribution measures **1.1:1** (`#000000` on `#0a0e27`). Deleting them re-opens a contrast failure on a route the a11y specs scan. They stay. A zero-hit grep is not proof of death when a library writes the DOM.
2. **E-7 described `e2e/sync-status-badge.spec.ts` as entirely skipped. Lines 47–74 are three real, running tests.** Only the trailing `test.describe.skip` block was removed. The all-skip spec was `sync-two-client.spec.ts`, deleted, with its manual runbook appended to `docs/two-phone-sync-check.md` as E-7 itself asked.

**Left under 44 deliberately:** `navbar.tsx:385` sign-out and `trip-map.tsx:295` drag affordance, both 29.75 and both desktop-only, where WCAG 2.2's floor is 24px.

**`/plan` rows now `flex-wrap`, and that is a real layout change.** Four 44×44 controls cost 51px of row width; without wrapping, a 360px phone's title drops from ~180px to ~92px. The action cluster moves to its own right-aligned line below `sm`, and nothing changes at ≥640px. Taken because the tap floor is an acceptance criterion and title width is not.

**Known ceiling:** every size above is computed from class strings against the 17px root, not measured in a live layout. `--tap` is a px literal, so it does not scale with the root or with `/travel`'s 112.5% override — correct for a physical-finger floor.

**E-8 and E-13 landed with this slice.** `ui/sheet.tsx` loses its single-variant `cva` block, `SheetFooter` and `SheetClose` (zero consumers each), with `SheetPortal`/`SheetOverlay` unexported; the inlined class string was proved **token-identical** to what `cva` emitted, and byte-identical after `twMerge` normalises a stray double space. `withOutbox`'s unused `_storage` parameter is gone from 25 call sites. E-13's stated benefit — "removes a false dependency edge, five modules import a storage port purely to satisfy a parameter" — **is wrong**: all five re-export that port on purpose for `flushOutbox`, and zero imports were removed. The parameter was genuinely unused, so the change stands; the payoff is 25 shorter call sites, not a dependency-graph win.

### D-351 · LOCKED · (V6-16 / sweep-D D-7, D-8, D-10, D-13, D-14, 2026-08-17) · Actions are SHA-pinned, and the `.npmrc` exit condition was tested and failed

**Decision.** All 17 `uses: actions/*` lines carry a 40-character commit SHA with the version as a trailing comment, Node moves to 22 across all five job pins (with `engines: {node: ">=22"}`), `zod` and `tailwind-merge` move to `dependencies` because they ship, and `marker-check --self-test` runs in CI as its own step ahead of the scan.

**Why SHA and not tag.** `deploy.yml`'s `publish-rules` is the one job that will hold `FIREBASE_SERVICE_ACCOUNT`. A mutable tag there is a credential-adjacent supply-chain hole. Renovate and Dependabot both understand the `@sha # vX.Y.Z` form, so bumps stay automatable. Resolved via `gh api` and re-verified per SHA; every tag ref came back `.object.type == "commit"`, so no annotated-tag dereference was needed. The scoping note said six `checkout` sites; there are **eight**.

**This was not only a pinning change — six actions moved a MAJOR version**, and that is the riskier half: `checkout` v4→v7, `setup-node` v4→v7, `upload-artifact` v4→v7, `configure-pages` v5→v6, `upload-pages-artifact` v3→v5, `deploy-pages` v4→v5.

**Three of the six cannot be exercised before a push to `main`.** `deploy.yml:12-14` is `on: push: branches: [main]` with `workflow_dispatch` deliberately removed, so `configure-pages`, `upload-pages-artifact` and `deploy-pages` run for the first time **as the live deploy**. No `dev` sweep can cover them; that is a permanent hole in the pre-`main` gate, not an oversight of this slice. The evidence that makes it acceptable, read from the release notes rather than assumed: all three are **Node-runtime majors** (`configure-pages` v6 = "upgrade to node 24"; `deploy-pages` v5 = "Update Node.js version to 24.x"; `upload-pages-artifact` v5 = "Update upload-artifact action to version 7" plus `include-hidden-files`), with **no input or output API change named**, and the artifact producer/consumer pair was bumped in lockstep so they cannot disagree about artifact format.

**The self-test had never run.** `MUST_CATCH` exists to stop the leak gate reporting "clean" on a partial marker set, and nothing exercised it. Proved it is a live gate rather than a no-op by renaming one rule in a scratch copy: `AssertionError [ERR_ASSERTION]: PATTERNS and MUST_CATCH have drifted`.

**`trip/.npmrc` is NOT deleted, and the reason is worth recording so nobody re-derives it.** The scoping claim was that all three blockers now publish React-19 lines. They do — *upstream*. What is installed here is `cmdk@1.0.0`, `next-themes@0.3.0`, `sonner@1.5.0`, all peering `^18`, confirmed against `package-lock.json`. Deleting `.npmrc` today ERESOLVEs every install. Getting there means three bumps, two of them majors, a lock regeneration and a full suite run — `components/ui/sonner.tsx` calls `useTheme()` and is the known fragile spot. **Checked 2026-08-17, exit condition not met.**

**Trap paid for once:** moving both packages dev → prod desyncs `package-lock.json`, and `npm ci` treats that as fatal. `npm install --package-lock-only --legacy-peer-deps` is the fix and it must run in the same commit.

**`engines` is advisory** — npm only warns without `engine-strict=true`, which interacts with `.npmrc` and was left alone.

**The `nextjs_space/` sweep is partial on purpose.** Only the two refs that are live, wrong *instructions* were fixed (`scripts/fetch-images.mjs`, `scripts/serve-out.mjs`). The 21 in `DECISIONS.md` and 1 in `docs/V4-DEVPLAN.md` accurately describe the past and stay — rewriting a decision log to erase a path is worse than a stale path in it. The 2 in `firestore.rules` belong to Session A's SB-7, which had not landed at the time of writing.

### D-352 · LOCKED · (#94, 2026-08-17) · `/plan` renders the itinerary once, and its two-column layout is the planner's own grid

**Decision.** `components/trip-timeline.tsx` is deleted. `/plan` is `PageHero` → `CalendarPlanner` → `PlanActivity` → `BudgetPanel`. `ActivityFeed` — the one surface the timeline held that the planner does not — is re-mounted as its own lazy island. **No page-level grid was added.**

**The defect was worse than "rendered twice".** `trip-timeline.tsx:40` held its **own** `selectedDate`, and `LazyVisible` renders its component prop-less (`lazy-visible.tsx:171`), so the `onDateSelect` callback was dead code. The route shipped **two 32-day day selectors that never synced**, showing the same day in two different orders — the planner in stored/manual order (D-018), the timeline in `sortItemsByTime` order.

**Why no outer grid, arithmetically.** `calendar-planner.tsx:1334` is already `grid lg:grid-cols-[340px_1fr] gap-6`, splitting again at `xl` when the map opens. At the 1280×900 `plan-map-split.spec.ts:30` pins, the day-detail column resolves to **452px** today and to **68px** inside an outer `[1fr_360px]` rail. A `2xl` rail is no better: 1536 − 360 − gaps → 348px, still worse than 452. There is also no page-level container to hang a grid on — every island owns its own `px-4 sm:px-6` + `max-w-[1200px] mx-auto`, a literal appearing at 20+ sites. **The two-column layout the issue asked for was already shipped; the page-level job was only to stop stacking.**

**What deletion cost, named honestly.** The chronological read of a day (`sortItemsByTime` projected into a UI) has no other home — `today-panel.tsx:192` passes items unsorted and `whats-next.ts` returns a single item. The *logic* survives with two live consumers and its own suites; what died is a surface. The trip-progress bar and country band died with it (12 lines of CSS, no other home). A chronological/manual toggle on the planner's day list is **deferred, not rejected** — it is its own slice, because a `sortMode` switch has to disable DnD while sorted or a drag writes an order the view contradicts, which is D-018 territory.

**One net was genuinely lost, and it was accepted with evidence.** `e2e/sort-clash.spec.ts`'s S377 test — the Jan-9 date-line day, DTW layover after the flight that produces it — was timeline-only and is deleted. `lib/__tests__/sort-items-by-time.test.ts:91` and `:106` assert the same `j22-1..j22-6` ordering against the **real `TRIP_ITINERARY` seed content**, so the regression net moved from e2e to unit rather than disappearing. The spec header now names that file, so the next reader does not have to find it.

**No vacuous test was left behind.** Four surviving `sort-clash` tests were retitled to match what they still prove via the calendar. `author-filter-propagation.spec.ts`'s "exactly one control even with the timeline scrolled into view" was **deleted, not rewritten** — `AuthorFilterControl` now has exactly one mount site in the tree, so no surface can produce a second and a `toHaveCount(1)` would pass for the wrong reason forever.

**Two navigation entries were already broken before this slice** and went with it: `command-palette.tsx:127` pointed `#timeline` at `/` (the timeline moved to `/plan` at S321), and `legacy-hash-redirect.tsx:41` polled Home for the same dead anchor. The `#timeline` scroll-margin selector in `globals.css` went too.

**Heading order is `h1` → `h2` "Itinerary Planner" → `h3` "Recent changes" → `h2` "Trip Budget".** `h2→h3` is a legal descent and axe `heading-order` stays clean. **Do not "fix" that h3 up to an h2.**

**Known ceiling:** the `pb-16` wrapper around `PlanActivity` is `budget-panel.tsx:177`'s own class verbatim and is load-bearing when the feed renders, because `BudgetPanel` has no top padding. On a build where nothing is attributed `ActivityFeed` returns `null` and the wrapper still contributes 64px of phantom gap. The one-line upgrade is to move the padding onto a `className`-applying reference component and pass that to `LazyVisible` — the `GatedTravelInspiration` precedent.

### D-359 · LOCKED · (V6-18 sweep, issue #114 fallout, 2026-08-19) · A Tailwind opacity step that does not exist emits nothing, so the broken class was load-bearing — and axe, not `contrast-tokens.mjs`, owns stock-palette contrast

**The defect.** `flight-journey-card.tsx:169` carried `text-amber-200/45` for months. **45 is not a step in Tailwind's opacity scale, so no rule was ever generated**, and the span silently inherited the parent `li`'s `text-amber-200/70`. It rendered at 0.7 alpha and passed contrast. #114 corrected the typo to `/50` — a real step — which **activated** the declaration and dropped the composite to **4.24:1** against the 4.5:1 AA floor (11px, normal weight, no large-text exemption). Fixed here at `/60` = **5.48:1**, independently derived twice; the model was validated against axe's own reported figure (predicted 4.219 at `/50`, axe reported 4.24).

**The bug class, which is the part worth keeping.** A non-emitting utility is invisible to every static check in this repo: it type-checks, it lints, it greps as present, and it reads correctly in review. Only a rendered-page axe pass can see it, and only *after* someone "fixes" the typo. Correcting a class name is therefore not a cosmetic change — it can activate a declaration that has never once applied. Treat a typo'd utility as untested code, not as dead code.

**Guard boundary, so nobody re-litigates it.** `contrast-tokens.mjs` owns the **design tokens** — the navy/duo/scrim/ink ramps, with real alpha compositing. **axe owns stock-Tailwind palette usage on rendered routes.** Adding an `amber-*` pairing to `contrast-tokens.mjs` was proposed and **REJECTED**: axe already caught this correctly, twice, as serious. Nothing failed to detect it. What failed is that **PR #114 was merged with its E2E job red (24m24s)**. A second detector does not fix a process that merges past a red first detector. Add amber to that script only if a *design token* goes amber.

**Changes if:** a design token adopts the amber ramp, or axe stops covering `/flights/`.

### D-360 · LOCKED · (V6-18 sweep, V6-9 fallout, 2026-08-19) · The skip link is suppressed on `/travel`, because a zero-chrome route has no repeated block for WCAG 2.4.1 to bypass

**Decision.** `app/globals.css` carries `body:has(.travel-mode-root) a[href="#main"] { display: none; }`, adjacent to the `.travel-mode-root` block it is coupled to.

**Why it was needed.** V6-9 (D-343) added one root-layout skip link to satisfy 2.4.1 across all 19 routes. `/travel` renders as `children` inside the `#main` wrapper, so `[data-testid="travel-mode-root"]` sits **below** the skip link in tab order, and TM-9's Tab walk failed at **focus step 0**. One a11y fix broke a different a11y contract.

**Why suppression rather than relaxing TM-9.** Travel Mode deliberately ships zero chrome — no navbar, footer, tab bar or FAB — which TM-9 asserts separately and which still passes. 2.4.1 exists to let a keyboard user bypass *repeated blocks of content*; on a route with none, there is nothing to bypass and the link is pure leakage. Relaxing the assertion to whitelist the link would weaken a deliberate contract to accommodate a regression. `display:none` removes it from the tab order outright.

**Verified, not assumed:** `.travel-mode-root` is a real class (`app/travel/page.tsx:34`), not merely a testid; specificity (0,2,2) beats `focus:not-sr-only` (0,2,0), and neither `sr-only` nor `not-sr-only` sets `display` at all, so there is no conflict to win; `:has()` is Chrome 105+, inside browserslist. The one spec asserting the skip link runs on `/` only, where the selector cannot match, and it stays green.

### D-361 · LOCKED · (V6-18 sweep, 2026-08-19) · Any spec that runs axe must settle finite animations first — the helper lives in `e2e/fixtures.ts`, and there is exactly one copy

**Decision.** `settleAnimations` and `ANIMATION_SETTLE_BUDGET_MS` move out of `a11y.spec.ts` into `e2e/fixtures.ts`, exported. `a11y-full-audit.spec.ts` calls it **inside `expectAxeClean`**, not at its 11 call sites, so every present and future scan inherits it.

**This is a recurring defect class, not a one-off.** It was root-caused once in `a11y.spec.ts` — that helper's doc comment records the original `text-green-200` / `#52906a` / 4.31:1 instance — and then **re-introduced by a sibling pack whose own header claims it "mirrors a11y.spec.ts"**. It did the `h1` half and dropped the settle. Copy-that-didn't-get-the-fix is the mechanism; one shared copy is the remedy.

**The symptom, for recognition.** axe scans mid-reveal and reports violations against elements still at `opacity: 0`, producing composite colours that no token pairing actually specifies. **The tell is a violation count that varies run to run** — observed at 3, then 62, then 71 nodes on the same route. Measured failure rate before the fix: 1 in 4. After: 10/10 clean.

**Rejected: `emulateMedia({ reducedMotion: 'reduce' })`.** It would audit only the reduced-motion branch and leave the default-motion branch — what most users get — audited nowhere in the suite, and it would not cover the next animation added outside a reduced-motion guard. **Rejected: leaving it to CI `retries: 2`.** `playwright.config.ts` states in terms that retries are "NOT the mechanism for any known flake".

**Corollary worth its own line: a real defect can mask a flake.** The amber violation of D-359 made this test fail deterministically for months, so its non-determinism was invisible until the real defect was fixed. **After fixing a long-standing red, re-run the newly-green test under `--repeat-each` rather than assuming it is stable.**

### D-362 · LOCKED · (V6-18 / issue #93, 2026-08-19) · The 36 visual baselines are Windows-canonical and the CI visual job is advisory by design — the platform suffix is why, not AA tolerance

**Decision.** The committed baselines are shot on Windows and end `-win32`. The CI visual job stays `continue-on-error: true`. Re-baselining is a Windows-local operation, and a `-win32`-only diff is the expected shape of a V6-18-class commit.

**The mechanism, stated correctly.** The older caveat said a Linux runner "will differ by sub-pixel AA on text — enough to trip a strict compare", absorbed by `maxDiffPixelRatio`. That understates it. Playwright's snapshot path template appends `{platform}`, so on Linux it looks for `-linux`, **finds nothing, and reports a MISSING snapshot — never a diff.** `maxDiffPixelRatio` never enters the picture. Generating Linux baselines any other way would mean committing 36 files nobody actually rendered.

**What V6-18 established about the tolerance.** `-u all` rewrote **36 of 36** files, not the 12 that were failing. Passing at `maxDiffPixelRatio: 0.02` means *differs by under 2%*, not *identical* — so the whole set had drifted and 24 of them were sitting under the threshold. This generalises D-336, which measured a total hero swap at **0.283%** because `.hero-scrim` holds the photograph at ~24% of the composite: three `home-hero-*` PNGs still contained the retired satellite map and the retired gold CTA, and no assertion could ever have reported it.

**Therefore, binding on the next re-baseline:** use `--update-snapshots=all` (the bare flag defaults to `changed` and rewrites nothing when the compare already passes), **read `git status` rather than the exit code**, and **open the files** — after `-u all` there is no automated check left in the system at all. Confirm reproducibility with a no-flag run before committing; a baseline that cannot re-pass is one captured frame, not a baseline.

### D-363 · LOCKED · (issue #123, 2026-08-19) · The itinerary item read contract has ONE definition — `itineraryItemSchema` — and both untrusted boundaries wrap it

**Decision.** `core/itinerary/model.ts` adds `sanitizeItineraryItem`/`sanitizeItineraryItems`, the per-row sanitizer the itinerary was the last domain to lack (`sanitizePlace`, `sanitizeItem`, `sanitizeExpense` are the siblings). `docToDayPlan` calls it instead of casting `data.items as ItineraryItem[]`. The rule is **not restated** — the sanitizer wraps `itineraryItemSchema` (`core/vault/schema.ts`), which is already the declared lenient read contract, so the remote-snapshot boundary and the on-disk boundary cannot drift about what a row is.

**Two failures, not one.** The issue described a single bug; tracing found two. **Throwing rows** (`null`, primitives) die on the unconditional `it.rev`/`rit.id` derefs in `defaultDayForMerge` and `mergeItems` — and the snapshot handler's `catch → console.warn` swallows it, so sync goes *silently dead* for that trip with no apply, no push and no error. **Non-throwing bad rows** (no `category`, an unrecognised `sourceType`) ride through to disk and fail the *next* load. That second one is the reported wipe, and it reaches every device the snapshot did.

**Lenient, deliberately: dropping a good row is worse than the bug.** Nothing is coerced, nothing absent is defaulted, `.passthrough()` forward keys survive, and rows are **not** deduped by id — `mergeItems` resolves same-id rows, and deduping here would discard the loser of a merge that has not happened yet. A blank `id` is rejected on top of the schema, because it is the merge key every sync path buckets on.

**The import cycle is by design and is safe.** `schema.ts` imports the sanitizer; the sanitizer imports the schema. `sanitizeItineraryItems` is a function *declaration*, so its binding initializes at module instantiation before either body evaluates — no TDZ on either entry order. Neither side dereferences the other at init: `schema.ts` only builds `z.object(...)` literals, `model.ts` only declares functions. Note no test imported `core/itinerary/model` first before this slice; every path reaches it through `lib/itinerary-remote.ts`, which pulls `schema.ts` in earlier.

**The `docToDayPlan` freeze holds.** Dropping a row is not defaulting a field, which is what the freeze forbids. `itinerary-remote.test.ts` took additions only, zero deletions; the D-303 `country` leg-id pass-through and the `countryLabel` delete-guard are byte-identical.

### D-364 · LOCKED · (issue #123, 2026-08-19) · The on-disk read path degrades per-row; the import/restore path stays strict — D-098 is unchanged

**Decision.** `parseItineraryPayload` drops malformed days and items and returns `null` only for a non-array payload. `parseItineraryPayloadStrict` is the all-or-nothing parse, and `parseBackup` uses it. `load-save.ts` keeps the degrading one. Both carry a do-not-merge-these comment.

**The tradeoff inverts between the two boundaries, which is the whole reason for two functions.** On disk the alternative to degrading is quarantine plus a fall back to the sample/empty shells: the user has no second copy, so 31 good days beat none, and that is the fix #123 asked for. On import the user holds *both* the file and their live trip — rejecting costs them nothing, because the file is still there and the error names the problem, while accepting overwrites live data with a silently truncated version and reports success.

**This was caught as a live regression, not reasoned about in advance.** Making `parseItineraryPayload` degrade left `parseBackup` still treating "not `null`" as "validated", so an array of pure garbage validated as `[]` and the import called `savePlans([])`. Measured against a live one-day trip: `{schemaVersion:5, payload:[{nope:true},1,null]}` returned `{ok:true}` and `loadPlans()` came back `[]` — trip gone, success reported, nothing quarantined. A mangled backup with `date: 12` on day 2 silently deleted day 2 the same way. Under sync it is worse than local loss: `restorePlans` with `plans: []` walks every current day, `stampSyncDeleted`s every live item, re-adds nothing, and fresh-id-beats-tombstone means that deletion **wins on every synced device**.

**Guarding `parseBackup` closes all of it** — `importItinerary`, both `backup.ts` restore branches, and `restorePlans` via its two callers, all of which are fed from that one parse. No separate guard in `use-itinerary.ts`.

**Rejected: rejecting only on `plans.length === 0`.** It still lets the two-days-becomes-one case through silently, which is the harder half to notice.

**The lesson worth keeping:** D-098's never-destroy guarantee was defeated without anyone touching D-098, by redefining what counts as a rejection. The restored test in `export-import.test.ts` is the only automated pin on it — it was rewritten away during the fix and has been put back verbatim, with the garbage-array and partial-truncation shapes added alongside.

### D-365 · LOCKED · (issue #126, 2026-08-19) · The expenses and docs remote reads sanitize, and the docs one passes `[]` rather than taking the default fallback

**Decision.** `chunkDocToRows` calls `sanitizeExpenses`; `docToRows` calls `sanitizeItems(data.items, [])`. Both sanitizers already existed and were already used on the local load path — they were simply never applied at the remote read boundary.

**Why the explicit `[]` is load-bearing.** `sanitizeItems(value, fallback = DEFAULT_TEMPLATE)` returns the fallback when the array sanitizes to **zero** items, not only when it is not an array. Taking the default at a remote boundary would turn "a peer deliberately cleared the checklist" into 18 resurrected template rows, written straight back up by `pushChecklistMerged` — and on a custom trip those include `nepal-visa`/`japan-entry`, the exact leak `UNIVERSAL_TEMPLATE` (D-355) exists to prevent. An empty remote list means empty.

**Checked and deliberately not changed:** `budget-remote.ts` returns a field map, not a row array, and `mergeBudget` guards `!a`/`!b` before touching `hlc`; `trips-remote.ts` casts, but `mergeTripLists` runs every row through `sanitizeTripMetaEntry` one layer in.

**Known asymmetry, accepted for now.** `sanitizeItem`/`sanitizeExpense` rebuild field-by-field, so unknown forward keys on remote rows are stripped and the merged write puts the stripped result back — erasing a newer client's forward fields from the server. The itinerary boundary stays `.passthrough()` and does not do this. Nothing round-trips today because the local write path already sanitizes, but the two boundaries do not agree and the docs/expenses side is the stricter one.

### D-366 · LOCKED · (issue #124, 2026-08-19) · The outbox serializes per `(domain, chunk)`, and an ack may only clear a chunk when no newer push for it is outstanding

**Decision.** `pushChunkOnce` allows at most one push in flight per `(domain, chunk)`. A second push for a chunk already in flight hands the running loop the newer state and joins its promise instead of opening a second transaction; the loop acks only when the attempt that carried the newest state resolves, and otherwise loops and pushes the newer state. `pushChunks` routes every chunk through it, so all five domains and both the commit and flush paths are fixed at one choke point.

**Rejected: routing the commit path through the existing per-domain `inFlight` flag**, which the issue proposed as the simplest incremental fix. That flag is per *domain*, so it would drop a commit to day Y merely because day X was mid-push, and it makes the second caller a silent no-op — the dirty flag survives, but the newer edit then reaches the remote only on the next `online`/`visible`/app-start trigger, which never fires in a tab that stays open and online. Fixing the data-loss half by stranding the write is not a fix.

**Still state-based.** No op queue, no sequence numbers; the dirty set remains the only durable record. A superseded attempt is dropped, not queued, and the newest local state is re-pushed through the same merged write — the dirty set's set-no-op property expressed in time rather than in the slot.

**The commit path deliberately stays outside the per-domain flush flag**, so the two cannot deadlock or starve each other: nothing in `pushChunkOnce` reads `inFlight`, and `flushOutbox` never waits on the run map.

**Ceiling, marked in the code:** the run map is module-scope and therefore per-tab, exactly like the flush flag. Two tabs editing the same chunk inside one push window can still race an ack against the other's in-flight edit. The upgrade path is a lease in the slot or a `BroadcastChannel`, which buys a cross-tab protocol and a lease-expiry problem; the per-tab guard covers the real timeline, which is one tab and two edits a keystroke apart.

### D-367 · LOCKED · (issue #115, 2026-08-19) · `csvField` neutralizes a leading formula trigger, and exempts values that are entirely a number literal

**Decision.** A field whose first character is one of `= + - @ TAB CR LF` is prefixed with `'`, unless the whole value matches `/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/`. The check lives inside `csvField`, so every column is covered and no future caller can forget; `csvField` is the only CSV serializer in the repo.

**TAB, CR and LF are triggers because spreadsheets strip leading whitespace before the formula test** — `\t=1+1` executes exactly like `=1+1`. The four documented starters alone would leave that open.

**The numeric exemption exists so the Amount column still sums.** `String(e.amount)` puts `-42` in a cell; prefixing it turns a numeric cell into text, which is a real regression in an export whose point is arithmetic. The exemption is anchored at both ends with no `m` flag, so there is no room for a payload after the digits — `-42+cmd|X`, `-4.2.3`, `- 42` and `-42=1` are all still neutralized. It is a value-shape carve-out, not a per-caller one.

**Order is load-bearing: neutralize, then quote.** The apostrophe must land inside the quotes — `=1,2` becomes `"'=1,2"`, never `'"=1,2"`, which is not valid RFC-4180 and leaves the formula intact. The test pins the literal bytes rather than asserting the apostrophe is merely present.

### D-313 addendum (2026-08-20) · the overshoot guard is subsumed by a maximal-months walk, not deleted; two offset-change defects fixed with it

D-313's text says its `while` guard "must never be removed", and the loop it names no longer exists. It was not deleted. `computeCountdown` is now ONE walk — months, then whole days measured from where the month walk landed, then the residue measured from where the day walk landed, each step taking as much as it can without passing the target — and step one defines `months` as the maximal `m` with `addMonths(now, m) <= target`, corrected from **both** sides rather than only downward. The overshoot D-313 repaired is unreachable rather than repaired, and `afterMonths <= target` then forces every later field non-negative by construction. Verified rather than argued: D-313's own leap sweep passes (2,184 cases, zero failures) and a 40,000-probe check finds zero instants where `months` is not maximal in either direction.

**Why the structure changed at all.** The old code derived the day part and the residue from two INDEPENDENT walks — `differenceInDays` counting back from the target, `addDays` measuring forward from now — held in step by a hand-rolled borrow. Across a UTC-offset change those two walks are not inverses, and the borrow failed in both directions: `now 2026-03-07 02:53 -> target 2026-03-08 03:00` read `0m 0w 1d -1h -53m` (negative fields, sum-back broken outright), and `now 2026-11-01 00:29 -> target 2026-11-02 00:00` read `0m 0w 0d 24h 31m` (a literal 24 in the hours cell). A first attempt removed the negatives and left `0m 0w 1d 23h 7m` for a true 23h07m span — a clean double-count, because the two walks were still independent. Deriving each step from where the last one landed removes the class instead of the instance.

**Months stay anchored on `now`, by owner ruling.** `Aug 20 2026 -> Dec 9 2026` must read **3 months, 2 weeks, 5 days** (111 days). Target-anchored months read `3 months, 2 weeks, 6 days` -- a one-day difference, not a three-month one and were measured and rejected on that basis. The consequence is recorded rather than hidden: a month block's length depends on where it starts (`addMonths` spans 92 days from Aug 20 but 89 from Jan 31), so when the block changes length the day remainder absorbs the difference and the days cell can tick up by one at a month boundary. That is arithmetic, not a defect, and D-313's claim that the sum-back "subsumes monotonicity" is retracted here. Reported and retracted publicly.

**One documented exception to sum-back, and it is the price of a display rule.** A countdown must never render 24 or more hours. A fall-back day is genuinely 25 hours long, so the honest residue reaches 24h and the whole day is carried into the day count — which a calendar reconstruction cannot undo. Cost: one hour of `now` values on each day whose final day-leg reaches across the transition, 23,942 of 576,000 one-minute instants over a 400-day horizon against a target the day after a fall-back. Against the shipped 2026-12-09 target it fires **zero** times, and zero readings change there at all.

**Held by** three cases in `lib/__tests__/countdown-sum-back.test.ts`, each verified to fail against the previous implementation with the exact strings above. An earlier version of the sweep targeted only 05:30 the day after a transition and passed on the broken code; the 24-hour reading needs a midnight-ish target and the negative fields need the target ON the transition day, so it now sweeps both shapes and the comment records what each arm catches.

**Changes if:** the owner's Aug 20 reading is ever re-ruled, which reopens the now-anchored choice and with it the month-boundary tick · or a display rule other than "never 24 hours" is adopted, which removes the carry and restores unconditional sum-back.

### D-368 · (issue #119, 2026-08-20) · `showUndoToast` gained an `onSettled` seam, because "free the blob" and "offer Undo" are incompatible without one

**Decision.** `showUndoToast(message, onUndo, onSettled?)`. `onSettled` fires from sonner's `onAutoClose`/`onDismiss`, guarded by a local flag the Undo handler sets, so it runs exactly when the undo window closes WITHOUT the user taking it.

**Why a seam rather than deleting the photo at delete time.** An expense's receipt has to still exist if Undo lands — `repointExpense` exists precisely to move that meta onto the restored row. Deleting the blob up front would make Undo restore an expense whose receipt is gone; not deleting it at all is the bug. The only correct moment is after the window closes un-taken, and the toast is the only thing that knows when that is.

**Ceiling, marked in the code:** a reload or a navigation before the toast closes skips the cleanup, so the blob survives. That is strictly better than today (where it always survives) and the alternative is a durable pending-delete queue for a few kilobytes of image.

**Journal `clearAll` takes the other branch** — its confirm already says the wipe cannot be undone, so its day-photos are freed straight away, at the Settings call site rather than inside `useJournal`. Cross-domain cleanup stays with the caller, the same way `budget-panel.tsx` already owns the receipt re-point.

### D-369 · (issue #130, 2026-08-20) · one ref-counted writer for `body[data-dialog-open]`

**Decision.** `hooks/use-dialog-open-flag.ts` owns the attribute. Five modals call `useDialogOpenFlag(open?)`; the module-scope count moves the attribute only on the 0↔1 transitions.

**Why it was false before.** Each modal set the flag on mount and `delete`d it on unmount, with no counter — `add-to-itinerary-dialog.tsx` carried a comment claiming a ref-count guard that did not exist. `place-detail-sheet.tsx` renders a `<Sheet>` (flag set) and can nest an `<AddToItineraryDialog>` on top (flag set again); closing the nested dialog cleared the flag with the sheet still open.

**No visible symptom today, and that is not a reason to leave it.** The only reader, `quick-add-fab.tsx`, sits at `z-40` under the dialogs' `z-50`, which its own comment already names as the primary guarantee. The invariant was still false, and the next consumer would not have the z-index luck.

**Per-tab by construction**, like every other module-scope guard here. Two tabs is not a case: the attribute is per-document.

### D-370 · (issue #118, 2026-08-20) · `lib/travel-tick.ts` is the app's shared tick, not `/travel`'s, and it stops while the tab is hidden

**Decision.** `/flights`' four `FlightJourneyCard`s subscribe to `subscribeTravelTick` instead of each opening `setInterval(…, 1000)`, and hold `requestFastTick()` only while their countdown is inside a week — the one reading that carries seconds. The module's scope was never technical: nothing in it referenced `/travel`, only its header comment did.

**The tick now pauses on `document.hidden`** and fires one catch-up tick on `visibilitychange` back to visible. That is a change to the shared module, so it applies to `/travel` as well: a backgrounded tab does no work, and every label is correct the instant it is looked at again rather than up to one period stale. Held by a case in `lib/__tests__/travel-tick.test.ts` that advances 120s hidden and asserts zero callbacks.

**One listener, bound on first subscribe, never removed.** A document-level `visibilitychange` handler for the life of the page is cheaper than add/remove around every subscriber, and `bindVisibility` is idempotent so repeated subscribes cost nothing.

**Time values are unchanged.** Each tick re-reads the real clock through `getFlightTiming(journey)`, exactly as the per-card interval did; only the frequency moved. The visible countdown is byte-identical at every cadence because the text further out than a week has no seconds field to move.

### D-372 · (issue #136, 2026-08-20) · Amends D-349 · The image handler checks the content type, not just `res.ok`

**Decision.** The service worker's image path requires a response to look like an image — content type `image/*`, or absent — before it will either cache it or hand it back. Both the cache-put and the return are guarded; an unusable 200 now takes the same cache-consult path D-349 built for non-ok, and the original response is returned only on a genuine miss, so a real 404 still reads as a 404.

**Why.** D-349 treated non-ok as the unusable shape, but a captive portal answers 200 with its login page. `res.ok` is true for that, and the response is same-origin `basic`, so the HTML was written into `trip-images-v1` and served from cache afterwards — the failure outlived the portal.

**An absent content type is trusted rather than rejected.** Some hosts omit it, and rejecting on absence would send those images to a guaranteed miss. (An earlier draft of this record also justified it by opaque cross-origin responses exposing no headers; that is irrelevant here — cross-origin returns earlier and never reaches this handler.)

**The install precache carries the same guard, but a deliberately softer one.** Install checked only `res.ok`, so a portal active during install wrote its login page into the precache *permanently* — and this diff's own fallback would then serve that HTML as the "cached image". `isExpectedPrecacheBody` rejects it, throwing exactly as `!res.ok` does, so the atomic-install guarantee is unchanged: activate never runs and the previous precache stays intact. Route entries are legitimately html; for every file entry, html *is* the portal by construction. **Only html is poison, and that rule is uniform — image entries are NOT held to the runtime's `image/*` test.**

**The first version of this guard did hold them to it, and it bricked immediately.** The E2E static server had no `.avif` MIME entry, so the six hero rasters arrived as `application/octet-stream`, install threw, the worker went redundant and never controlled the page — taking five e2e tests down with it, each stalling 15s per navigation waiting for a controller that never came. The asymmetry with the runtime handler is intentional and is the whole point: a runtime miss degrades to a cache lookup, whereas an install rejection is all-or-nothing and takes offline down entirely, *silently*, from inside the worker where nothing surfaces it. This repo has no rollback from a bad deploy, so the install path buys safety by being **less** strict, not more. Measured: with every file served as `application/octet-stream` all 179 entries still install; with the old strict branch restored, 173 install and the controller never arrives. `serve-out.mjs` gained the `.avif` entry in the same change so the harness keeps mirroring what the live host actually serves (`image/avif`, verified against the deployed site), but the guard no longer depends on any host getting a content type right.

**Known ceiling.** A non-redirecting portal that answers a *route* entry with a 200 login page in place is still indistinguishable by headers alone; `res.redirected` catches the common redirecting flavour. Separating those needs body sniffing, not built. `cacheFirst` (static assets, nav backfill) also still has the runtime version of this blind spot.

### D-373 · (issue #147, 2026-08-20) · `theme.opacity` is a dense 0–100 scale, because Tailwind resolves opacity modifiers against it

**Decision.** `tailwind.config.ts` extends `theme.opacity` to every integer 0–100, a strict superset of Tailwind's default 15-step scale. No call site was rewritten.

**Why.** Tailwind 3 resolves a colour opacity modifier against `theme.opacity` and silently drops any candidate outside it: no rule, no build warning, and the element falls back to preflight's `#e5e7eb` — a light grey border on a dark surface. 74 sites across 24 files were dead this way. The arbitrary form `/[0.06]` always worked, which is why neighbouring classes in the same string rendered and the failure survived review.

**The guard asserts emitted CSS, not the theme object**, via a real postcss run on the repo config — emission is the property that broke. Verified non-vacuous: it goes red with the config line removed.

**`{lib,components}/__tests__/**` is now excluded from `content`.** `lib/` is a scanned class-name source, so class-name literals inside specs were injecting real rules into the shipped bundle; three had leaked already.

**Not done here.** This does not make `border-white/15` a legal boundary for an interactive control. At ~1.5:1 that is decorative-tier, alongside `--border`, where the design system says an interactive boundary takes `--border-ui`. Roughly 68 controls are written that way and were painting an accidental grey until now; moving them is a token decision and wants its own pass.

### D-374 · (issue #138, 2026-08-20) · Undeclared-key retention in the docs/expenses sanitizers is opt-in, and set only at the remote read

**Decision.** `sanitizeExpense`/`sanitizeExpenses` and `sanitizeItem`/`sanitizeItems` take `SanitizeOptions { keepUnknownKeys?: boolean }`. Absent — the default — is the field-by-field allowlist rebuild they have always been. It is set at exactly two call sites, both remote reads: `chunkDocToRows` (`lib/expenses-remote.ts`) and `docToRows` (`lib/docs-remote.ts`). Every local entry point takes the default. Reject rules and declared-field coercion are identical in both modes; only undeclared keys differ.

**Why the split rather than a blanket passthrough.** The two directions have opposite requirements and disjoint caller sets. On the remote read, D-365's sanitize runs on a row that is then merged and written straight back up, so an allowlist meant an older client silently erased a newer client's forward fields from the server, permanently, on every sync — the normal state for a lazily-updating PWA. On every local path that same rebuild is what makes D-159's zero-egress guarantee structural rather than a discipline: a rogue or legacy row carrying photo refs cannot survive a rebuild that never copies it. A blanket passthrough fixes the first and deletes the second.

**Why not a by-name denylist.** Considered and rejected: to satisfy the existing egress proof it would have to drop `receipt`, a perfectly plausible future expense field. Dropping it by name re-creates this bug for exactly the class of key the issue is about. Dropping an unrecognised key and dropping a known-forbidden one are different rules, and only the first was asked for.

**Retention at the read is necessary but NOT sufficient, and the first version of this record wrongly implied otherwise.** The local storage layer re-sanitizes strict on the way to disk, so `commit()` re-reads a *stripped* row carrying the **same HLC** and pushes that back. The equal-HLC tie then decided against the richer row every time — see D-376, which is what actually makes the retained key survive. Measured before D-376 landed: the forward key was erased on this device's next push of that leg, which any expense edit in the leg triggers. On the docs checklist retention alone was a complete no-op, because a fixed template puts every id on both sides and so every row takes the collision path.

**Default-strict is load-bearing.** A new caller that does not know to ask gets the safe behaviour. Two disjointness assertions fail if the default ever flips.

**The tests that first "proved" this were green without testing it.** Both used a remote row with no local counterpart while being titled "survive the read→merge→write round trip" — pass-through for a row that never collides, which is not the round trip. They are now named for what they check, and a real same-id/same-HLC collision test sits beside each.

**Residual risk, named.** Retention on the remote read means a photo-bearing key placed into Firestore by some other writer would be preserved on write-back instead of scrubbed. Judged acceptable: those bytes are already remote, so nothing new leaves the device, and it is not a key this app can mint — everything entering the merge from the local side comes through the strict path. If that stops being true, the fix belongs at the schema layer D-159 lives at, not here.

**Not done here.** `category` stays an enum check, so a forward category still drops the whole expense row. Widening it means widening `Expense['category']` off `ItineraryCategory`, which breaks `CATEGORY_COLORS[e.category]` and `setCategory(expense.category)` — a type-surface decision, not a sanitizer one.

### D-375 · (issue #139, 2026-08-20) · `sourceType` is lenient on read; the draft discriminant stays a closed union

**Decision.** `itineraryItemSchema.sourceType` is `z.string().optional()`, matching `category` directly above it. `SourceType` is **not** widened: it is the card-family discriminant the four `toItineraryDraft` branches are written against, and every caller passes a literal. `SOURCE_TYPES` and `isSourceType()` are exported as the runtime narrow to use for a value read off disk or off a snapshot. Unlike `BUDGET_CATEGORIES`/`isCategory`, which `sanitizeExpense` calls, `isSourceType` has **no production caller today** — nothing reads this field as a union. It is provided so the next consumer narrows instead of casting; if one never appears, delete it rather than leaving a guard that implies a check nobody performs.

**Why.** It was the one non-lenient field in a deliberately lenient schema, so a fifth source family from a newer build dropped the whole row: loudly before #123, silently per-row after it, at both the on-disk and remote boundaries.

**Why the union stays closed.** Widening it forces the exhaustive switch's `never` guard out, and the obvious way to make that compile is to delete the guard and let the switch fall through returning `undefined`. The persisted field and the draft discriminant are different things and now read as such. An unrecognised value throws by name, unchanged, and a test pins it; `sourceType` only drives an optional back-link label, so it degrades to "no recognised source".

**Changes if:** a fifth card family is added (extend `SOURCE_TYPES` and the switch together), or `ItineraryItem['sourceType']` is widened to match the schema.

### D-376 · (issue #138, 2026-08-21) · The equal-HLC tie-break prefers the strict key-set superset

**Decision.** `resolvePair` (`core/sync/merge-items.ts`): on an exact HLC tie between two rows of the same deleted-ness, the row whose key set strictly contains the other's wins. `contentFingerprint` decides only when neither contains the other. The tombstone bias still returns first, so this only ever chooses between two live rows or two tombstones.

**Why.** `contentFingerprint` was systematically biased against the richer row. It sorts the entries and stringifies, so inserting a key always makes the result diverge DOWNWARD — at the new key's own name, or at `,` (0x2C) versus the closing `]` (0x5D) when it sorts last. The stripped copy therefore won every equal-HLC collision, in both argument orders, for every key name tried. That is the mechanism that re-erased a peer's forward fields upstream and made D-374 a no-op on its own.

**The tie is not protocol-impossible any more.** The old comment called the equal-HLC/different-content case unreachable and kept the fingerprint purely as a determinism guard. D-374 creates it for real: a row read from a peer keeps forward keys this build cannot name, while the copy re-read from this device's own strict-sanitized storage has been stripped of them — same id, same HLC, different key set.

**Commutativity is preserved, and it is the invariant this file cares about.** Strict containment is antisymmetric, so at most one row can satisfy it and the winner is a function of the unordered pair, never of argument order. Equal key-set sizes short-circuit, so the branch cannot fire between rows with the same keys; when it declines, the pre-existing fingerprint path runs unchanged. Idempotence holds. Pinned by both-orders tests and a 500-trial randomized property test over colliding HLCs with random key sets, alongside the existing 500-trial `mergeItems` property test.

**Known ceiling: not associative** for three or more mutually incomparable rows at one identical `pt:ct:actor`. That needs three devices minting the same HLC with three different key sets. **[Correction, issue #438: the trigger as originally written, "revisit only if the actor field stops being unique per device," had already fired — `actor` is the traveller's display NAME in all five hooks, not a device id, so two devices signed in as the same traveller mint the same actor. What actually keeps the ceiling effectively unreachable is the conjunction it needs: three same-name devices minting one identical stamp with mutually incomparable key sets. A key-*count* total order would be associative, but it would let a row with more keys beat one holding keys it lacks, which trades data loss for tidiness — not worth it. A device-scoped actor (`deviceStore.getId()`, synchronous and firebase-free) would restore the original premise, at the cost of the human-readable attribution the field carries; that trade, not the retired trigger, is what to revisit.]**

### D-377 · (issue #135, 2026-08-21) · Visual snapshots compare at exact match; the 2% tolerance is gone

**Decision.** `maxDiffPixelRatio: 0.02` is removed from `SHOT` (`e2e/visual.spec.ts`) and `TM_SHOT` (`e2e/tm-acceptance.spec.ts`). The per-pixel `threshold` default is untouched — it was never part of the measurement.

**Why it was dead weight, precisely.** The 36 baselines carry a `-win32` suffix, so the only runner that can compare against them is one on the same OS as the run that shot them. On Linux CI, Playwright looks for `-linux`, finds nothing, and reports a *missing snapshot* — never a diff — which is why that job is advisory. The tolerance therefore only ever applied where the cross-OS antialiasing drift it existed to absorb cannot occur, while buying roughly 23k pixels of cover on a 1280×900 hero: enough to hide a recoloured button or a shifted line of type.

**Measured, not assumed.** With the tolerance removed outright and no baseline rewritten: 24 + 12 green on one pass, 72 + 36 green at `--repeat-each=3`, and 24 green again after a rebuild — 144 strict assertions, zero differing pixels. `--update-snapshots` was never run.

### D-378 · (issue #160, 2026-08-21) · The five domain-sync effects collapse into one `useDomainSync` hook, gated through the port's own `isConfigured()`

**Decision.** `hooks/use-domain-sync.ts` extracts the flush-then-subscribe wiring effect that `itinerary-provider.tsx` had copy-pasted five times (itinerary/expenses/budget/docs/places, ~260 lines total): `useDomainSync(outboxSync, storagePort, syncPort)`, called once per domain. Same shape as D-148's factory precedent (build exactly what the five call sites need, no `coreOps`-style generalization). Behavior is unchanged — flush on mount, `online`, and tab-return-visible; subscribe gated and reactive on `IDENTITY_CHANGED_EVENT` per D-240; D-149/D-150's `SyncPort`/outbox decorator are untouched, only their call site moved.

**The places bug.** The old places effect gated on `isRemoteConfigured()` while its own comment said `isTripRemoteConfigured()` — drifted apart at some point. Places is per-trip (every write composes `trips/{getTripId()}/…`, retired to `''` on the default sample pack), and `placesSyncPort.isConfigured()`/`subscribe()` already gate on the stricter `isTripRemoteConfigured()` internally, so the outer mismatch never produced a bad write, just a redundant flush/subscribe call on the sample pack. Fixed at the root: the new hook's outer gate is `syncPort.isConfigured()` instead of a hardcoded `isRemoteConfigured()`, so each domain gates on exactly what its own port already declares — no per-domain special case needed, and the comment/code drift can't recur.

**Changes if:** a Linux baseline set lands and the visual job goes blocking. Measure the antialiasing drift on that runner and set a value from the measurement — do not restore 2% from memory.

### D-402 · (SYNC-1 / DATES-3, 2026-08-21) · Two clock ports: `clock` is what the user reads, `realClock` is what sync stamps

**Decision.** `lib/trip-now.ts` exports a second `ClockPort`, `realClock`, whose `now()` is `new Date()` and which never resolves the `?today=` override. Every HLC stamp site and every tombstone-GC horizon takes `realClock`; every countdown, day number and label takes `clock`/`getNow` exactly as before. That is the five domain hooks (`use-itinerary`, `use-expenses`, `use-docs`, `use-budget`, `use-my-places`) plus the GC/stamp sites in `lib/itinerary-remote.ts`, `lib/expenses-remote.ts` and `lib/places-remote.ts`.

**Why one port could not serve both.** `?today=` exists so day numbers and countdowns can be demoed against a trip that is months away; it persists to sessionStorage for the whole page session and ships in every build. The sync layer was reading that same port for causality and for a GC horizon, where a faked instant is not a simulation but corruption written to the shared trip.

- **Stamps.** `?today=2026-12-09` stamped every itinerary/expense/docs/places/budget write made under it with `hlc.pt = 2026-12-09T17:00Z`. `resolvePair` takes the higher `pt`, so those rows beat every genuine later edit from any device until the real clock passes the faked date — and because `hlcSendOrLocal` ratchets `pt` to the row's own stored stamp, the inflated value is inherited by every subsequent edit of that row on every device. Measured: an edit typed on Aug 21 under the override outranked a real edit made three days later by 107 days. The mirror case is as bad — a past-dated override mints stamps that LOSE every merge, so those edits are discarded in silence.
- **GC horizon.** `gcTombstones`/`gcTombstoneRows` dropped every tombstone older than `faked − 30d` from a MERGED doc that `pushDayMerged`/`pushChunkMerged` then `tx.set` straight back to Firestore. Any peer still holding the row live re-adds it on the next merge, so a delete silently un-deletes for the whole group.

**`lib/preflight.ts` already read `new Date()` by hand** for exactly this reason, with a comment saying so, and `lib/attribution.ts` stamps `updatedAt` from the real clock on the same edit — so a row written under the override carried `updatedAt` = the real day and `hlc.pt` = the faked one. The codebase already knew the two clocks differed; it had no seam that made the choice explicit at the call site. That is what the second port is.

**`?today=` now rejects a date string that does not round-trip.** `DATE_RE` validated the SHAPE only, and `new Date(y, mo-1, d)` rolls out-of-range parts over silently: `2026-13-45` became 2027-02-14 and was accepted as the clock. `overrideMsFor` re-reads the constructed date and refuses it unless year, month and day all come back unchanged; a rejected override falls through to the persisted one and then to the real clock, rather than becoming a plausible-looking wrong day.

**Not done here.** The two DISPLAY clocks still disagree with each other: `getTodayInTrip()` derives the trip day at the destination leg's fixed offset while `TRIP_START`, `getFlightTiming` and `elapsedInclusiveDays` use the device's own calendar, so for a traveller in New York the hero flips to "Day 1" 10h45m before the phone agrees. That needs a seam decision (origin-local until the first leg begins, or move the other three onto the offset), not a second port, and both write paths that default a new row's `date` from `getTodayInTrip()` inherit whichever answer wins. Recorded as open.

**Changes if:** the override stops shipping in production builds — the second port would then be unnecessary, but not wrong.

### D-403 · Amends D-374 · (SYNC-4, 2026-08-21) · Forward-key retention has call sites in three domains now, and places needs BOTH halves

**Decision.** `sanitizePlace`/`sanitizePlaces` take the same `SanitizeOptions { keepUnknownKeys?: boolean }` the expenses and docs sanitizers took in D-374, and `mergePlaces` threads it to its closing sanitize. `lib/places-remote.ts` sets it at `docToPlaceRows` AND at both `mergePlaces` calls.

**D-374's "set at exactly two call sites, both remote reads" is stale, and this is the correction.** It is now three domains, and places is the one that needs a second flag on a path that is not a read.

**Why places is different.** Docs and expenses write `mergeItems` output directly, with no sanitize tail. `mergePlaces` closes with its own `sanitizePlaces` — it is the domain's one narrowing boundary — so at the strict default that rebuild re-stripped the forward keys `docToPlaceRows` had just retained, on the way INTO `tx.set`. Retention at the read alone was a complete no-op here, in the same way D-374 records it being a no-op on the docs checklist for a different reason. An older client therefore went on erasing a newer client's fields from the server on every push, which is the defect #138 was supposed to have closed.

**`stripSeed` had to take over dropping `updatedAt`.** The transient legacy-HLC seed is applied inside `mergePlaces` and must never reach storage or the wire, because `rowHlc` seeds from it whenever `hlc` is absent — a persisted copy would be a second source of truth for the order key. Under retention the sanitizer spreads the source row instead of rebuilding it field by field, so the strict rebuild is no longer what removes the seed. `stripSeed` drops it UNCONDITIONALLY, which is exactly what the strict path did with that key: `updatedAt` is not a declared `MyPlace` field, so keeping a peer's copy of it would create the same second source of truth.

**Default-strict is unchanged and still load-bearing.** `loadMyPlaces`/`saveMyPlaces` and backup stay strict, and it is that strict local re-save which creates the equal-HLC/different-key-set collision D-376 resolves in favour of the richer row. Retention at the read remains necessary but not sufficient without D-376.

**Changes if:** a fifth synced domain grows a sanitizer tail. The rule is then "wherever the merge closes with a narrowing boundary, both halves", not "at the remote read".

### D-404 · Addendum to D-228 / D-309 · (SYNC-2, 2026-08-21) · The skew clamp cannot move into `hlcSendOrLocal`, and the docstrings that implied it could were the defect

**Decision.** `MAX_SKEW_MS` and `hlcReceive` stay where they are and stay unwired. `hlcSendOrLocal` does NOT clamp `last`. Both docstrings now say plainly that they have no production caller and that the "far-future peer is capped" sentence describes `hlcReceive`, not the shipped merge path.

**Why the obvious fix is data loss.** In this state-based design `last` is the ROW's own stored stamp, not a device clock reading. Clamping it to `physicalNow + MAX_SKEW_MS` mints a new stamp that sorts BELOW the row being edited; `compareHlc` then keeps the stored row, and the user's edit is reverted by the next snapshot. One line, all five domains, silent.

**Pinned by** the R5 monotonicity case in `lib/__tests__/core-sync-hlc.test.ts`, which drives `last.pt` a thousand years ahead and asserts the result is strictly greater than `last`.

**Written down because it has now been proposed twice**, both times from a correct reading of the file: the docstrings described a 24h clamp as a live defence of the merge, so a reader looking for where it runs concludes it must belong in the one function every stamp routes through. It does not. The state-based design never grew a receive step — absorption happens implicitly, because `nextSyncStamp(prev, …)` passes the merged winner's own `hlc` as `last` — so there is no remote stamp for the clamp to be applied to at the moment it would mean something.

**D-309's ceiling stands, unchanged:** a concurrent offline edit from a correct-clock device can still lose to one whose clock is hours wrong, and that is the accepted trusted-device residual. D-402 removes the app's own way of manufacturing that state.

**Changes if:** a device-wide running-clock primitive lands — D-228's original reason for keeping both. `hlcReceive` then gets a caller and the clamp applies to a REMOTE stamp, which is the value it was written for.

### D-405 · Amends D-313 (LOCKED) · (DATES-5, 2026-08-21) · The hero ring counts CALENDAR days, from one derivation

**Decision.** `daysToGo(now)` in `lib/home-stats.ts` — `differenceInCalendarDays(TRIP_START, now)` — is the single producer of "days to go". The hero ring's digit and its fill fraction both read it, `home-stat-row.tsx`'s live cell reads it, and `lib/travel-date.ts`'s `daysUntilStart` reads it (A-23 had already fixed the identical reading there, in isolation, one file over).

**`computeCountdown` is untouched.** `totalDays`, the month/week/day grid and the sum-back are byte-for-byte as D-313 left them, and the grid still does not reconcile with the ring — the non-reconciliation D-313 explicitly accepted is unchanged. What changed is which quantity the ring counts, not how the ring behaves and not how the countdown is computed.

**Why.** `totalDays` is a truncated 24-hour count that borrows the partly-spent day into the hour/minute/second residue, so it reads 0 for the whole day before departure. It is correct for what it claims and it is simply not "how many sleeps". Home rendered the number twice in one frame from two derivations, so the ring and the stat row directly beneath it printed values one apart at every instant except exactly local midnight: `2026-12-08T09:00` read 0 in the ring and 1 in the row, and `/travel` on the same device read 1 while Home read 0.

**Recorded consequence: the pinned `?today=2026-11-09` ring reading moves 29 → 30**, in both the ring and the stat row (`e2e/countdown.spec.ts`). `?today=` freezes the clock at local NOON, so the truncated count borrows half of Nov 9 into the 12h residue and the calendar count does not. The days cell inside the grid above still reads 29 and is labelled as one field of a breakdown, not as a day count. The two numbers answer different questions and each is now labelled with its own.

**One clock read per tick feeds both.** The hero's interval calls `getNow()` once and passes the same instant to `computeCountdown` and `daysToGo`, so the grid and the ring cannot be a tick apart even transiently.

**Changes if:** the ring's caption stops saying "days to go". The number follows the label, not the other way round.

### D-405 · Addendum · (issue #92, 2026-08-22) · The trigger fired: the ring's caption is gone, not reworded

**Exit condition met.** `hero-section.tsx`'s ring no longer carries a "days to go" caption — the `<span>` under the digit was deleted outright. Cause: Home printed the same LABELLED figure twice on one screen, `home-stat-row.tsx`'s live cell being the other "Days to go" (issue #92's `32`/`114` duplicate-figure defect). The stat-row cell could not be removed instead — its column count must divide six cells evenly (issue #90) and `e2e/countdown.spec.ts` asserts trip-lifecycle state against it — so the caption came off the ring, per this entry's own rule.

**What did not change.** The digit itself, its value, and everything D-405's main entry decided: still `daysToGo(now)`, still `countdown-total-days`, still fed from the one clock read that also drives `computeCountdown`. The ring and the stat row still print the identical number by design — that was never the defect, only the double caption was. `lib/__tests__/home-stats.test.ts` gained a source-level check that the caption stays gone.

### D-406 · (CONTENT-7 / DATES-6, 2026-08-21) · `TRIP_DAYS_MAX = 730` is the one span cap, enforced at `sanitizeTripConfig`

**Decision.** `TRIP_DAYS_MAX = 730` inclusive days, exported from `core/trips/registry.ts` and enforced inside `sanitizeTripConfig`. A config whose span exceeds it is REJECTED, not clamped. The create form imports the same constant and mirrors it natively — `min`/`max` on both date inputs — so the picker cannot offer a year that would breach it, and re-checks it in the submit handler because Enter-in-a-field bypasses a disabled button.

**Why the validator and not the form.** `sanitizeTripConfig` is the trust boundary all four config sources funnel through: the create form, a peer's trip-meta doc, the synced trip list, and hand-edited storage. A check in the form covers exactly one of them, and the three it misses are the ones nobody is watching.

**Why a cap has to exist at all.** Every consumer treats the span as a length it materialises: `TRIP_DATES` and `buildDayShells` emit one entry per day, roughly fifteen components render a node per entry, and `reconcileFirstSnapshot`'s seed branch pushes ONE FIRESTORE DOCUMENT PER DAY against a free-tier write ceiling. A one-digit year typo (`2027` → `2227`) is 73k days, ~4.3 MB of day shells and 73k writes. 730 is two years — past any real trip, and small enough that the worst case is survivable rather than a wedged account.

**Reject rather than clamp, and the ceiling that buys.** Clamping would silently rewrite dates the user typed, and worse, would rewrite a PEER's config on read and push the altered version back. Refusing keeps the rule one-directional and keeps the bad bytes visible. The cost is named rather than hidden: a trip created before this cap with a longer span now fails the validator, so the registry entry survives with no config and the app falls back to the placeholder instead of rendering a 73k-day trip. Nothing is deleted; editing the dates restores it.

**The other half of the same defect: `ISO_DATE` validated shape, not existence.** `2026-13-45` passed the regex, and `new Date` rolls it to 2027-02-14 — or, with the `T00:00:00` suffix the date backbone uses, becomes an Invalid Date and yields an EMPTY `TRIP_DATES`, which is the state the fifteen unguarded `TRIP_DATES[0]` readers crash on. `isoDayMs` re-reads the constructed UTC date and returns `NaN` unless year, month and day all round-trip. Same idiom as the `?today=` check in D-402, for the same reason: digits in the right places is not a day.

**Changes if:** a trip legitimately needs to run longer than two years. Raise the constant — do not move the check, and do not add a second one at a call site.

### D-407 · (CONCIERGE-3, 2026-08-21) · The href scheme allow-list is a shared security boundary, in one file

**Decision.** `lib/safe-href.ts` exports `SAFE_HREF` and `isSafeHref`. The pattern is byte-identical to the one `components/concierge-chat.tsx` shipped inline; nothing was widened. It is applied at the two producing boundaries — `lib/place-resolve.ts` (`finalUrl` off the Worker's `/resolve`) and `components/import-place-sheet.tsx` (whatever was typed into the URL field, which Save was never gated on) — and at the render site, `components/my-places-section.tsx`, which links to the first of `resolvedUrl`/`sourceUrl` that passes and renders no link at all if neither does.

**The render-site check is the load-bearing one.** Places is a SYNCED domain and the read boundary does not re-validate URLs, so a row arrives carrying whatever a peer's device or an older client put in it. Guarding only the producers would leave every such row live. The producers are guarded as well, so nothing bad reaches storage from this build — but that is defence in depth, not the boundary.

**Why it matters on this deployment specifically.** The export is static GitHub Pages with no CSP, so a `javascript:` href runs on the app origin with the Firebase session and every trip key in localStorage in reach.

**Widening the list is a security change** and should be handled as one. An allow-list is what keeps out `javascript:` and `data:` together with every scheme nobody has thought of yet; a deny-list would not.

**Deliberately NOT tightened at the schema.** `myPlaceSchema` keeps `sourceUrl`/`resolvedUrl` as plain optional strings rather than `z.string().url()`. A `myPlaceSchema` failure drops the WHOLE row — `sanitizePlace` returns `null` — so a stricter schema would silently delete a synced place because its link was odd, which is the all-or-nothing failure #123 and D-375 already ruled against for other fields. Dropping the link and keeping the place is the correct degradation, and the render-site check is what performs it.

**Changes if:** a CSP lands on the deployed site. The render-site check stays either way; it would just stop being the only line.

**Addendum (issue #171, 2026-08-21) · two predicates, one file.** `lib/safe-href.ts` now exports `isHttpHref` alongside `isSafeHref`. `isSafeHref` is unchanged and still governs place links; `isHttpHref` accepts `http(s):` only and governs the share-target row, which had been carrying its own inline copy of that rule. **Do not “unify” the share row onto `isSafeHref`.** That widens it: `SAFE_HREF`'s site-relative `/` alternative also matches a protocol-relative `//host/path`, so a value arriving from a `?url=` parameter would render a `target="_blank"` anchor to any origin. The subset relation is pinned in `lib/__tests__/safe-href.test.ts`.

### D-408 · (PWA-7, 2026-08-21) · Reachability is corroborated from real traffic, and a suspected outage EXPIRES

**Decision.** `hooks/use-online.ts` reports online only when `navigator.onLine` is true AND reachability has not been contradicted. `navigator.onLine` stays the fast NEGATIVE — it is reliable when false — and the positive is corroborated from the outcome of requests the app already makes, via a one-time wrapper around `window.fetch` that observes and re-throws and never alters a result. No probe, no polling, no new dependency.

**Why the flag alone was not the truth.** It reports that a network interface exists, not that anything is reachable. On captive-portal wifi, a dead uplink or a hotel AP that resolves nothing it stays `true`, so the banner never rendered and the Home connection tile read "Online" while weather, the currency rate, Firestore sync and the concierge were all failing — the one moment the banner exists for.

**The rule worth recording, which is more general than this hook: a negative inferred from traffic has to expire.** Once the app believes it is offline it stops generating the traffic that would disprove it — `use-concierge-chat` refuses to send while `online` is false, so the concierge could never produce the evidence that clears its own false negative — and the `online` event is no rescue, because it does not fire on a link that never dropped. So `REACHABILITY_SUSPECT_MS = 30_000`: re-armed on every failure so a run of them holds the banner open through a real outage, cleared by any cross-origin success or by a real link-layer transition. 30s is deliberately shorter than the concierge's own 45s request deadline, so a traveller who was told "you're offline" can retry and actually be heard. Guessing wrong in the optimistic direction costs one banner flicker; guessing wrong in the pessimistic direction used to cost the feature for the rest of the session.

**Only CROSS-ORIGIN outcomes are evidence, in both directions.** Same-origin requests are answered by the service worker's cache, which resolves happily while the network is dead (a false positive) and returns `Response.error()` for a plain miss (a false negative). Neither says anything about reachability.

**`TimeoutError` is a caller hang-up, exactly like `AbortError`.** `AbortSignal.timeout()` rejects with `TimeoutError`, not `AbortError`, and both are the same statement: OUR deadline ran out, which is not a network fact. The concierge's deadline is 45s against a cross-origin Worker, so reading it as an outage took the concierge offline app-wide on one slow answer.

**Known ceiling, marked in the code:** `api.frankfurter.dev` is the worker's one stale-while-revalidate exception, so a cached rate can resolve cross-origin without touching the network — one host, one request per rate read. Not worth teaching this module the worker's routing table.

**Changes if:** a same-origin endpoint the worker never caches appears, which would give a second evidence source and let the cross-origin restriction relax.

### D-409 · (CONCIERGE-6 / CONCIERGE-4 / CONCIERGE-7, 2026-08-21) · Two concierge contracts reversed on purpose, and identical ops are one proposal

**Decision 1 — a 2xx whose body is not the `{reply, ops}` envelope is an ERROR turn, not an empty successful one.** `typeof data.reply !== 'string'` now calls `fail(statusMessage(0))` and returns. It used to swallow the parse failure, default `reply` to `''`, set status `idle` and leave `error` null — a blank grey bubble with no error row, no "Try again", and that empty turn shipped as history on every later turn. The canonical producer is a captive portal or an interposing proxy answering 200 with HTML. "Did the body parse into an envelope" and "was the request successful" are different questions, and this is the line that stops them being conflated.

**Decision 2 — the abort ceiling is scoped to the TURN, not to the fetch.** `AbortSignal.timeout(CHAT_TIMEOUT_MS)` is constructed at the top of the try and the auth await is raced against it, resolving to no header if the ceiling wins. It used to be constructed inline in the `fetchImpl(...)` call, which left two unbounded awaits ahead of it — the lazy `import('./itinerary-remote')` and a `securetoken.googleapis.com` token refresh, neither with a timeout of its own. If either STALLS rather than rejecting, `send()` never settles, so `finally` never runs: status stuck on `streaming`, `sendingRef` stuck true, `error` still null so no retry row ever mounts, and only a reload recovers. That is the exact state `CHAT_TIMEOUT_MS` exists to prevent, on exactly the connections this file's other comments already treat as normal. Degrading to an unauthenticated request on a token we could not obtain in time is already `workerAuthHeader`'s documented catch behaviour, so an empty header is the correct fallback; the fetch then rejects on the already-aborted signal and lands in the catch with the timeout copy.

**Knock-on, and the reason the two are recorded together: any concierge fetch stub in a test must now return a real envelope.** A stub resolving `{ ok: true, json: () => ({}) }` used to be a successful empty turn and is now an error turn. Two tests pinned the old behaviour by name; they were rewritten to assert the new contract rather than kept.

**Also here — two byte-identical ops in one reply are ONE proposal**, deduped on arrival by the same `JSON.stringify` the chip's `opKey` is built from. A model repeating itself within a reply is an ordinary failure mode, and two identical ops produced one key: both chips rendered under the same React key, Confirm on either resolved both, only one `applyOp` ran, and the second proposal vanished with no chip, no undo entry and no "didn't match" line. Deduping is what makes "one proposal" true everywhere; the alternative is a positional key, which asks the user to confirm the same thing twice.

**Not done here, and it is not a client decision.** The live Worker still verifies nothing — the membership gate exists only in a Worker version that was never deployed — so the panel's "this trip is on your account" gating remains client-only and guards nothing. No change in this repo can make it real, and nothing client-side should be treated as a security boundary for it. Recorded as open, including the in-code comment that still asserts the Worker checks membership.

**Changes if:** the envelope grows a streaming shape, which would make "reply is a string" the wrong test rather than a stricter one.

### D-410 · (CONTENT-3 / CONTENT-6, 2026-08-21) · Destinations are required at creation, and the active-trip pointer follows a tombstone from any device

**Decision 1 — a custom trip cannot be created without at least one destination.** The field is `required`, the submit button is disabled without it, and the guard runs before `crypto.randomUUID()` so nothing is minted on the refusal path. The previous default was the trip NAME.

**Why the default was the defect.** `destinations[0]` becomes the leg's `fallbackCity`; `getCityForDate` returns it for every day of the trip; `runVisitAutocount` writes it into the lifetime "cities visited" record — which sits outside the trip namespace, outside `wipeAllTripData()`, and survives sign-out, all by design (D-314). "Mum's 60th" was recorded permanently as a city the user had visited. The visit record is the one store the app deliberately cannot clean up, so the only honest boundary is the single place the value is authored.

**Decision 2 — the active-trip pointer moves whenever the trip it names is tombstoned, from ANY device.** `removeKnownTrip` already did this for a local forget; `importRemoteTrips` now does it for an incoming tombstone.

**Why, mechanically.** Without it the forget undid itself: the merge dropped the entry, the pointer kept naming it, the next `listKnownTrips()` self-healed the entry back in with a FRESH `joinedAt`, `entryRecency` then outranked `removedAt`, the next merge deleted the tombstone, and the trip was re-pushed to every device — including the one that had just forgotten it. Moving the pointer removes the state the self-heal reacts to, so no second guard is needed anywhere. As with `removeKnownTrip`, the CALLER reloads; the pack is re-resolved on the next load.

**Changes if:** the self-heal in `listKnownTrips` is removed — the pointer move would then be unnecessary, and harmless.

### D-411 · Extends D-307 · (CONTENT-5 / CONTENT-8, 2026-08-21) · The last two unguarded object indexes

**Decision.** `vibeFor` (`core/trips/custom.ts`) and the legacy hash lookup (`components/legacy-hash-redirect.tsx`, extracted as `legacyHashTarget`) read their maps through `Object.prototype.hasOwnProperty.call(...)` rather than a bare index. Same one-line idiom D-307 established; these were the fifth and sixth surviving sites, and this sweep found no others.

**Why the existing fallbacks did not cover it.** `VIBES['constructor']` is the `Object` function — non-nullish, so `??` never fires — and the hero then dereferenced `.gradient` on it and took the whole Home route to `app/error.tsx`. `ROUTE_REDIRECTS['constructor']` is likewise a truthy NON-STRING, so the truthiness guard passed and `target.indexOf('#')` threw, with the same result for anyone who opened `/#constructor`. Both keys are untrusted input: `TripConfigBlock.vibe` is stored/imported data that `sanitizeTripConfig` accepts as any non-empty string, and the hash is raw URL text.

**The hash lookup was extracted to a named export** so the rule has a test seam. The redirect effect is otherwise unchanged.

**Changes if:** either map becomes a `Map`, which has no prototype chain to fall through — the guard would then be redundant rather than wrong.

### D-412 · (STORAGE-2 / STORAGE-1 / CONTENT-4, 2026-08-21) · A restore is not finished until it is enqueued, and an expense import is all-or-nothing

**Decision 1 — the four synced domains are enqueued through their own outbox-decorated push before the bare write.** `enqueueRestored(port, storage)` in `core/vault/backup.ts` routes the restored value through `withOutbox` — the same seam every ordinary edit uses — for expenses, budget, docsChecklist and myPlaces. It reads the pre-restore local state as the push's `prev`, so it MUST run before `spec.write`, and the spec carries that ordering in its type.

**Why.** `spec.write` is a gateway write and never reaches `commit()`, so nothing was enqueued in the sync outbox. On the reload that follows a restore, the first remote snapshot takes its "remote is authoritative" branch for every chunk that is present remotely and not dirty — which was all of them — and overwrote the just-restored rows while the UI reported success. Only the itinerary escaped, via the `CommitItinerary` dual path. The write-ahead enqueue is synchronous, so the dirty chunks are on disk before the reload and the first snapshot takes the MERGE branch instead. Self-gating: dormant and guest builds no-op exactly as before.

**Known ceiling, marked in the code:** merge, not tombstone-replace. A row the backup DROPPED — present remotely, absent in the file — survives the merge, where the itinerary's `restorePlans` would tombstone it. Closing that needs a restore-shaped commit on each of the four domains (only expenses has one today); the upgrade path is to inject them the way `commitItinerary` is injected.

**Decision 2 — `parseExpenseBackup` rejects the whole file if any payload row does not survive `sanitizeExpenses`.** That is D-098's rule (`parseItineraryPayloadStrict`) applied to the expense path, because the two boundaries have identical failure economics. On disk there is no second copy, so the storage read stays lenient and drops the bad row. On IMPORT the user holds both the file and their live expenses, and the caller applies the result as a tombstone-REPLACE that propagates to every device. The lenient gate meant any `{schemaVersion: number, payload: []}` file passed — including the ITINERARY export, which sits in the same Downloads folder and is offered by the same file picker: none of its rows is an `Expense`, so it sanitized to `[]`, wiped every logged expense everywhere, and reported success. Rejecting costs one failed import with the bytes quarantined.

**Decision 3 — a legacy itinerary-only file is checked against the ACTIVE trip's DATES.** A-5 refuses a full backup whose `tripId` does not match the active trip, but the legacy envelope (`{schemaVersion, updatedAt, payload}`) carries no trip identity at all, so it sailed past that check and replaced whatever trip happened to be active — and under sync `commitItinerary` is `restorePlans`, which propagates the replacement to every other member. The only identity such a file carries is its dates, so the rule is that at least one day must fall inside the active trip's span. A legitimate same-trip restore costs nothing by construction; an empty payload is refused too, because committing it is the whole-trip wipe D-098 exists to prevent.

**Changes if:** the legacy envelope is retired — decision 3 goes with it, and decisions 1 and 2 do not.

### D-413 · (STORAGE-5 / STORAGE-4, 2026-08-21) · Two boundaries that promised TOTAL and were not

**Decision 1 — `readJson` gates on SHAPE, not just on parseability.** A slot holding a JSON scalar (`null`, `5`, `"x"` — devtools, another script on the origin, a corrupt profile) parses fine and used to be handed straight back typed as the caller's `T`. Accessors that dereference it directly rather than passing it to a domain sanitizer (`weatherCache`, `outbox.loadSlot`) then threw a TypeError OUT of the gateway, and `weatherCache`'s escaped into Home's render. The gate fires only when the caller's `fallback` is object-shaped, so the `ABSENT`-sentinel callers — `core/vault/backup.ts`'s export, which must distinguish an absent slot from a stored one — still receive the raw parsed value.

**Why at the gateway rather than at the accessors.** The never-throw contract is stated at the top of that file and every caller is written against it, so a leak there is a leak of the contract, not of one accessor. One gate is smaller than a guard per accessor and it is the version a future accessor inherits for free.

**Decision 2 — the migration CHAIN drops rows a step cannot be applied to.** The steps are whole-array `map`s that throw on an unusable row, and they run BEFORE the per-row-degrading Zod read, so a pre-v5 vault with one malformed day quarantined the ENTIRE trip while the same data at v5 lost only that day. `isMigratableDay` filters in the chain runner, not inside any one step, so every current and future step inherits the rule; survivors are still re-validated by `parseItineraryPayload`, which reports the loss through its existing "dropped N malformed row(s)" warn.

**This is #123's partial-beats-nothing rule, one layer up.** Applying it per-step would have to be re-done, correctly, for every step ever added.

**Changes if:** a migration step ever needs to SEE a malformed row in order to repair it — then the filter moves inside the steps that do not.

### D-414 · (PWA-2 / PWA-3 / PWA-4 / PWA-5 / PWA-1, 2026-08-21) · The worker owns only `trip-*` caches, normalizes its keys, and consults the precache first

**Decision 1 — `activate` deletes only caches whose name starts with `trip-`.** The ownership prefix is not a duplicate of the allowlist: `caches.keys()` is scoped to the ORIGIN, not to the worker's scope, and the live app is a GitHub Pages PROJECT page sharing `powan55.github.io` with every other project on the account. Without the prefix, accepting an update here wiped a sibling app's Cache Storage — and that sibling only repopulates on ITS own next version bump.

**Decision 2 — the cache key drops `_rsc`.** Next computes that param from the CURRENT router state tree, so one target route yields a different URL per source route and again for prefetch versus navigation. Keyed literally, each became its own permanent entry in a precache that has no size cap and no eviction: roughly 19 routes × 19 source states × 2 kinds, about 17 MB of near-duplicate JSON against a 4.57 MiB shell. `cacheKey(request)` normalizes once inside `cacheFirst`, which both the static branch and the glyph/lazy-chunk path route through. The consequence of not fixing it is not just size: when the origin is evicted under storage pressure the entire Cache Storage goes, precache included, and nothing rebuilds it as a unit because `install` has already run.

**Decision 3 — the image handler consults the PRECACHE before `trip-images-v1`.** The precache name is content-hashed and rolls with every deploy; `IMAGES_CACHE` is `trip-images-v1` forever and is allowlisted through every activate, while `/images/**` filenames are not content-hashed. Runtime-first meant a re-encoded image stayed stale on a returning client permanently, with the fresh bytes sitting unread in the new precache — and meant the precached hero rasters (D-335, 30% of the gzipped install) were never served from cache on a first online paint, because anything not already in `IMAGES_CACHE` went to the network. Precache-first fixes both and keeps the heroes from burning one of the 80 FIFO slots.

**Decision 4 — every `caches.match` goes through `cacheMatch`, which swallows a rejection.** A corrupted store, an eviction racing the read, or iOS storage reclamation can reject; an exception inside `respondWith` rejects the response and the browser paints its network-error page for a route the precache is holding. Guarding the one shared helper is what makes every branch degrade to "nothing cached" instead of failing. Two lookups that sat OUTSIDE their try blocks are gone with it, and the nav-branch `cache.put` grew a `.catch`.

**Decision 5 — `normalizePath` strips a trailing `index.txt`/`.txt` before the trailing-slash rule.** Offline, the App Router's RSC fetch fails and Next falls back to a browser NAVIGATION to the `.txt` URL itself. Nothing precached matched it, so the nav handler answered with the app-root shell: tap "Plan" offline and Home rendered at `/plan/index.txt`, from which every further tap repeated it, so offline the UI could never leave Home. Only navigations reach `normalizePath` — the RSC fetch itself is not `mode:'navigate'` and takes the static branch.

**Not done: the RSC payloads are still not precached.** Adding `out/<route>/index.txt` to `buildPrecacheList` is +461 KB raw across 19 files on an install that is atomic and fails from inside the worker (D-372), onto a deployment that has no rollback. That is an install-size decision and it is deliberately deferred, not missed. Decision 5 means an offline link tap now resolves to the correct route's shell; what remains without the payloads is that the navigation is a hard reload and the address bar still reads the `.txt` URL.

**Changes if:** the install budget is re-measured and 461 KB is judged affordable. Decisions 2 and 5 are the prerequisites for it and both are in.

### D-415 · (MONEY-2 / MONEY-3, 2026-08-21) · The settlement is device-independent, and there is exactly one tolerance

**Decision.** `minimalTransfers` no longer takes the roster. Arithmetic ties in the greedy match break on the participant id itself (code-unit compare). `travelers` survives only as `orderBy`, a DISPLAY re-key of the balances object, and nothing arithmetic reads it.

**Why.** `rosterForActiveTrip` puts the signed-in traveller FIRST on a custom trip, so ranking ties by roster order made the emitted transfers a function of who was looking: byte-identical expenses told Ana "pay Dee" and Cal "pay Ana", and two people reading the same trip could not reconcile. `settle`'s docstring already promised the result was the same on every device, and there is deliberately no "who am I" parameter — the roster was the identity leak that parameter was avoided to prevent. The id is device-independent, which is what the caller's promise actually requires.

**`EPS` is exported and is the only threshold.** The "settled" chip in `components/settle-up-summary.tsx` used a hardcoded `0.5` — a whole-unit assumption written for the NPR/JPY legs — so on a USD leg, which every custom trip is, it called a 30-cent debt settled while printing the transfer that clears it: one card contradicting itself. A rounded balance is either exactly 0 or at least one display unit, so half a cent is the correct floor for both currency shapes and there is no reason for two numbers.

**Changes if:** a currency with more than two decimal places ships — that moves the floor, not the rule.

### D-416 · (MONEY-1, 2026-08-21) · An expense's leg is not its day's leg — fixed at the recap seam, named as a ceiling at the calendar one

**Decision.** `sumExpensesForDate(expenses, date, leg?)` takes the leg, and both recap surfaces pass the DAY's leg — the same leg they format the result with. A row whose leg the ACTIVE pack does not recognise contributes nothing, matching `expensesToSpent` and `expensesByDate`, so all three aggregates agree about which rows count.

**Why the leg is a real input and not a convenience.** A trip day belongs to exactly one leg, but an EXPENSE does not: the log dialog lets the leg chip be switched while `date` stays pinned to the day the dialog opened on ("paid for Japan while still in Nepal"), so `e.leg` and the day's leg are independent inputs. Summing by date alone handed a ¥50,000 row to a Nepal day, where the caller formats the bucket with the day's `legCurrency` and rendered it as "Rs 50,000" — and with rows from both legs on one date it added NPR to JPY into one meaningless number. In `trip-story-recap.tsx` the same sum also fed `spendByLeg`, which then contradicted `wrapped-story`'s own per-leg totals.

**Known ceiling, marked in `core/budget/burn-rate.ts`:** `expensesByDate` still keys on the date and drops `e.leg`, and the calendar overlay formats each bucket with the day's `legCurrency`. Same defect, same cause, not fixed here. Closing it means keying on the (date, leg) pair, which changes the shape every consumer reads — `components/calendar-planner.tsx` and `calendar-day-picker.tsx` — a wider diff than the recap seam, not a harder one. Recorded so it is not re-found from scratch.

**Changes if:** the log dialog stops letting the leg diverge from the date. Both seams then become unnecessary — and that is an input-design decision, not a money one.

### D-416 addendum (2026-08-21) · the calendar seam is closed too — `expensesByDate` filters to the day's own leg

**Decision.** `expensesByDate` skips a row whose `e.leg` is not `getCountryForDate(e.date)`. The day's leg is derived INSIDE the function from the `e.date` it already holds, so there is no new argument, no return-shape change and no caller edit. The bucket is now identical in contract to `sumExpensesForDate(expenses, date, getCountryForDate(date))` — the call both recap surfaces already make — which is what makes the flat `Record<string, number>` safe for the calendar overlay to format with the day's `legCurrency`. The ceiling recorded in the entry above is closed; one surface, one contract: **a day line shows that day's own leg, in that day's own currency, and a cross-leg row contributes to no day.**

**The pair-keyed shape was considered and rejected.** `Record<string, Partial<Record<Leg, number>>>` changes a shape two components (`components/calendar-planner.tsx`, `calendar-day-picker.tsx`) and two test files read, and it forces an answer to a question nobody has designed: how two currencies are rendered inside a 44px month-grid cell and its `aria-label`. Excluding the row is the same answer v6 already shipped at the recap seam, and it costs neither a shape nor a design.

**Reachable by default, not by hunting.** Pre-trip every expense defaults to `date: '2026-12-09'`; tapping the Japan chip — which renders `¥`, so it is the obviously correct action for a flight or a JR pass booked in advance — produced exactly the summed-across-currencies state.

**Residual ceiling, marked in the code:** a cross-leg row is EXCLUDED from every day view rather than shown under its own symbol. It is not lost — it still counts in the leg total, the trip total and settle-up, so the per-day sum can legitimately differ from the leg total by the undated amount and by the cross-leg rows.

**Changes if:** a day surface ever has to *display* foreign-leg spend rather than merely not mis-price it. Then key on the pair — and design the two-currency rendering first.

### D-417 · (A11Y-3, 2026-08-21) · A live region has to be in the tree BEFORE the text it announces

**Decision.** The polite status regions mount their `role="status"` / `aria-live="polite"` wrapper ALWAYS and put the conditional content inside it: `offline-banner.tsx`, `sync-status-badge.tsx`, `presence-bar.tsx` and `photo-attach.tsx`, joining `settings-panel.tsx` and `backup-restore.tsx`, which already did. `aria-label` is set only when there is something to say, so an always-mounted region does not claim the device is offline for the whole time it is online.

**Why.** A live region announces a MUTATION of a region already in the accessibility tree. A region inserted in the same commit as its text is not reliably announced by NVDA, JAWS or VoiceOver, so components that returned `null` when idle announced nothing at all — at exactly the moments they exist for. The bug was invisible in review because the markup was correct in isolation; only the mount timing was wrong.

**It costs no layout.** An empty wrapper with no children has no box, and the `fixed` positioning and every visual class stay on the inner pill, so nothing moves by a pixel in either state.

**Test seam:** the offline banner's region carries its own `data-testid` (`offline-banner-region`), because the pill's testid has to go on keeping its meaning — "the pill is showing".

**Changes if:** a screen reader ships that announces a freshly-inserted region reliably. That is not a bet worth taking on a status surface.

### D-418 · (A11Y-5, 2026-08-21) · The ambient-loop audit reads the SOURCE for Tailwind's utility loops, and fails closed

**Decision.** `scripts/motion-loops.mjs` runs a second pass over `app`, `components`, `core`, `hooks` and `lib`, matching `animate-pulse|spin|bounce|ping` and judging each SITE against the same 6s floor, with a `motion-safe:` prefix as the per-site guard. Five live sub-6s loops were structurally invisible to pass 1 and now carry the prefix: `ui/button.tsx`, `photo-attach.tsx`, `journal-browse.tsx`, `trip-story-recap.tsx` and `import-place-sheet.tsx`.

**Why pass 1 could not see them.** Its argument — the CSS is the fact, so a second copy would only prove the file agrees with itself — holds for loops somebody hand-wrote into `app/globals.css`. Tailwind emits `animate-pulse` (2s) and `animate-spin` (1s) into ITS stylesheet from a class written in a `.tsx` file, so the audit reported two loops while five shipped.

**A grep of the source, not a read of the built CSS.** Reading `out/` would couple the audit to a prior `npm run build`; this check runs before `npm ci`, like the other two. Durations are pinned from Tailwind's own theme — that is the price of not needing `node_modules`, and they have not moved since Tailwind 1. Comments are blanked in place so line numbers survive and a class named in prose is not a hit.

**It fails closed twice, and both are deliberate.** A pass that scans zero files means the roots moved and every verdict above it is vacuous, so that is a failure rather than a clean run. And the reduced-motion block losing `animation-iteration-count: 1` is a failure, because that universal rule is the only thing that stops a generated loop for a user with reduced motion on who hits a call site written before its guard — a utility loop has no selector of its own to name in the reduce block.

**The guard lives at the call site**, not in `globals.css`, because that is where the class is written. `motion-safe:` means the class applies only at `prefers-reduced-motion: no-preference`, which is the fork `components/trip-map.tsx` already used.

**Changes if:** Tailwind's default durations change. The pinned table is what to re-read, and the self-test should grow a row that notices.

### D-419 · (SYNC-5, 2026-08-21) · The sync/tombstone gate is TRIP-scoped, not app-scoped

**Decision.** `use-itinerary`, `use-expenses`, `use-docs` and `use-budget` gate on `isTripRemoteConfigured()` instead of `isRemoteConfigured()`, matching `use-my-places`, which already did.

**Why.** The default sample pack has no remote id (#10: `getTripId()` returns `''`), so nothing written there can ever be pushed — and both tombstone-GC boundaries sit behind the same trip-scoped gate, so nothing can ever collect what it wrote. On the app-wide gate, a Firebase-configured build accumulated tombstones in the sample pack forever, and undo re-minted item ids against rows no merge would ever see.

**The dormant byte-identity claim gets WIDER, not narrower.** "No firebase env" becomes "no firebase env, or the local-only sample pack", and the docstrings in all four hooks now say so. Nothing that was stamping stops stamping: a trip with a remote id behaves exactly as before, and the guarantee that a dormant slot is byte-identical to a local-only one now covers one more case rather than one fewer.

**Changes if:** the sample pack is ever given a remote id, which would make the two gates equivalent again.

### D-420 · (DATES-1, 2026-08-21) · Window MEMBERSHIP comes from the device calendar; the day NUMBER comes from the destination offset

**Decision.** `getTodayInTrip()` (`lib/trip-now.ts`) asks the device calendar whether today is inside the trip window at all, and only then asks the destination offset which trip day it is — falling back to the device's own answer when the offset lands outside. Three lines in one function; `dayInTripFor` is unchanged and still takes the offset it always took.

**Why deriving both halves at the destination offset was not a rounding error.** It made the app hold two definitions of "today", 10h45m apart on a New York device. Pre-departure, at 13:15 EST on Dec 8, the hero swapped its countdown for "Day 1 — Kathmandu" while the phone still read Dec 8 and the Flights card still said the outbound was ten hours away. The mirror case ended the trip early: at 10:00 EST on Jan 9 the destination day is already Jan 10, so this returned `null` and the hero flipped to its post-trip state while the traveller was still airborne on Day 32.

**The irreversible half is the write path, and it is why the seam had to be decided rather than left open.** `resolveDate()` in `components/expense-log-host.tsx` falls back through `getSelectedDay()` — an in-memory var, `null` on a fresh load — to `TRIP_DATES[0]`. A last-day expense was therefore STORED as `2026-12-09` with a `'nepal'` leg preset: a 31-day mis-file on a synced domain, and afterwards indistinguishable from a real Day-1 expense. `components/quick-add-fab.tsx` defaults the same way.

**The guard is deliberately NOT in `tripOffsetMinFor`,** which reads as the tidier place for it and is not. `lib/preflight.ts:316` is a third caller: it needs the trip's offset whether or not the device day is in the window, and a `null` there turns a correct "Phone is on home time" row into a false "Couldn't compare — this trip has no time zone set". No test covers that row, so it would have gone wrong quietly.

**Deliberately untouched: `getNowAtTrip`, `computeCountdown`, `TRIP_START`, `getFlightTiming`, `elapsedInclusiveDays`.** The other candidate fix — move flight timing onto the destination offset so at least nothing contradicts itself — is REJECTED. `Journey.departDate` is authored in the DEPARTURE airport's zone, so the outbound is origin-local by construction and the card would announce "Departing today" some sixteen hours early. The two surfaces disagree because the underlying quantities genuinely differ, not because one of them is wrong.

**Known ceiling: it assumes the traveller's phone stays on home time until arrival.** That is what `lib/preflight.ts` already calls the normal state, and the clock row exists to tell them when it is not. A traveller who sets the phone to destination time before boarding inverts the premise, and gets the pre-fix behaviour back.

**A second copy of the same derivation is still live, and is left open on purpose.** `lib/preflight.ts:324` computes its own `onTrip` from the destination offset alone, so the preflight clock row still flips early. Closing it needs an answer to a question this entry does not settle: whether preflight's "on trip" means the same thing as the hero's. That row is about the phone's relationship to the trip, not about which day number to render, so the two may legitimately differ.

**Changes if:** a real position fix backs the day math rather than a leg offset — membership could then be asked of where the traveller actually is, and the home-time assumption stops being load-bearing.

### D-421 · Discharges D-414's `Changes if` · (PWA-1, 2026-08-21) · The 19 route RSC payloads are precached

**Decision.** `buildPrecacheList` emits `out/index.txt` and every `out/<route>/index.txt`. Precache goes 179 → 198 entries. D-414's Decision 5 stays as the fallback for anything not on the list, and D-422 is a prerequisite rather than a refinement — without it the palette's one query-carrying navigation still misses.

**The WIRE number is what decided it, not the raw one.** +461,315 B raw is the figure D-414 deferred on, and it is not the figure anyone pays. GitHub Pages serves these gzipped and only gzipped — it does not negotiate brotli — so measured against the live host the delta is **+69.3 KiB on an install already 1.48 MiB gzipped**. That is less than the ~87 KB gzip of map glyphs D-349 withheld from the same install for the same kind of reason, which is the nearest thing this repo has to a calibrated ceiling.

**Steady-state device storage moves by ZERO.** D-414's Decision 2 made `cacheFirst` normalize `_rsc` away, so the first online browse already deposits these same 19 canonical keys into the same cache. Precaching changes WHEN they arrive, not how many exist or what they occupy. The trade is install-time bytes for a cold-offline guarantee, not bytes for bytes.

**Nothing changes on the published site.** The 19 files are already built, already published and already served; this only adds them to a list the worker reads at install. The site sits at 4.86% of the 1 GB Pages cap either way.

**What it buys.** Offline, `next/link` fetches `<route>/index.txt` before it renders, and a failed fetch is a HARD navigation to that `.txt` URL. D-414's Decision 5 made that land on the right shell, but it is still a document navigation: client state is dropped and the whole shell re-runs on every offline tap. With the payloads on disk the click is a SOFT navigation. `e2e/pwa-torn-update.spec.ts` asserts that with a `window` marker rather than with the title, because the shell-identity assertions pass under the hard fallback too — a soft nav keeps the JS context, a document navigation throws it away.

**Changes if:** the shell grows enough that the install budget has to be re-measured, or Pages starts negotiating brotli — which moves the number this was decided on, in the cheaper direction.

### D-421 · Addendum · (issue #325 / PR #327, 2026-08-25) · Next 16 requests segment payloads, not `<route>/index.txt`

**The "What it buys" premise was Next-15-only, and stayed wrong until it broke.** `next/link` prefetch under Next 16 fetches `__next._tree.txt`, `__next._index.txt` and `__next.<segment>.__PAGE__.txt` — the flattened segment-payload names `flatten-segment-payloads.mjs` writes — never `<route>/index.txt`. `buildPrecacheList`’s rule only matched the whole-route file, so 99 of the 119 payload files the build emits were excluded from the precache, and every in-viewport `Link` prefetch failed offline through the worker (`net::ERR_FAILED`), issue #325.

**Fix.** `gen-sw.mjs` gained a `SEGMENT_PAYLOAD` matcher (`/(^|\/)__next\.(?!_full\.txt$)[^/]*\.txt$/`) that precaches the three segment shapes; `__next._full.txt` stays excluded on purpose — 524,100 B raw for a shape the router only reaches on a segment-cache miss, never observed over a real browse. Precache 201 → 261 entries, +90 KiB gzipped. The whole-route `index.txt` rule this entry’s Decision added is KEPT, not replaced: the Next 16 client runtime still contains that fallback path, so the offline shell still holds it, but it is no longer the mechanism `next/link` prefetch actually uses — that correction is what this addendum records.

**Changes if:** a future Next major renames the segment-payload shape again — same fix, same place, and the code comment beside `SEGMENT_PAYLOAD` is where to start.

### D-422 · (PWA-1, 2026-08-21) · A `.txt` cache key drops its WHOLE search, not just `_rsc`

**Decision.** `cacheKey(request)` clears the entire search string when the pathname ends in `.txt`. Every other request keeps the existing delete-`_rsc`-only rule.

**It is not a tidy-up of D-421, it is what makes D-421 true.** Next derives the payload URL by mutating only the PATHNAME, so any existing query rides along: `components/command-palette.tsx:453` pushes `/plan/?focus=<id>`, and the router fetches `/plan/index.txt?focus=<id>&_rsc=<digest>`. Deleting `_rsc` alone leaves `?focus=<id>` in the key, which matches nothing — `/plan/index.txt` is the only entry that exists. Precaching without this reads as complete while still being broken for exactly one navigation, which is the shape of defect that survives a review.

**One live call site, and it is worth being precise about that.** `travel-date-picker` is NOT a second one: TM-11 already replaced its `router.replace` with a same-document `history.replaceState`, precisely because the `?date=` payload fetch died offline, so it no longer produces a query-carrying payload fetch at all. The rule still earns its place — a bookmarked or shared `/travel/?date=…` cold load goes through it, and so does any future query-carrying navigation, which is the case nobody would think to add a test for.

**Scoped to `.txt` DELIBERATELY.** It is sound only because a static export's payload is prerendered per ROUTE and cannot vary by query: the bytes behind `/plan/index.txt` are the same whatever the search says. For any other asset a param can select the bytes, so dropping the search globally would be wrong — and wrong silently, by serving the right URL's cached answer to the wrong request.

**Changes if:** the export stops being static, so a route's payload can vary by query. The scoping premise goes with it, and this rule has to go at the same time.

### D-423 · Amends D-099 · (issue #158, 2026-08-21) · The inward-arrow rule is enforced by ESLint, with one named exception
**Decision.** `eslint.config.mjs` gains a `no-restricted-imports` block over `core/**/*.ts` forbidding runtime imports from `@/lib`, `@/hooks`, `@/components` and `@/app`, with `allowTypeImports: true`. That flag is the point: type-only imports are erased at build and carry no dependency, so the 15 `core → @/lib/trip-data` type edges stay legal while any runtime edge fails the build. D-099 was prose each new slice had to remember; it is a check now.

Three moves cleared the standing violations. The nine `*_CHANGED_EVENT` constants moved from the React hook modules into `core/storage/events.ts` and are re-exported from the hooks, which also killed six `lib → hooks → lib` import cycles. The itinerary `StoragePort` moved to `core/vault/storage.ts`, and `lib/itinerary-storage.ts` became a re-export facade over it, matching its four siblings. `core/vault/backup.ts` moved to `lib/trip-backup.ts` — it is the whole-trip backup composition root, an application-layer job, so in `lib/` its imports are `lib → lib`.

**The one exception, and why it is not a move.** `core/sync/outbox.ts` needs two runtime predicates to answer “should I write?” — `isTripRemoteConfigured` and `getActiveTraveler`. That is a question about the runtime environment, not domain logic, and it has no core-side home today. Threading them through the `ChunkSync` recipe would add a parameter to every caller for no behavioural gain, on the sync path that carries the HLC and the merge algebra. So the rule is re-declared for that one file permitting exactly those two modules by negated glob: a *new* violation there still fails. It is not switched off.
**Changes if:** `outbox.ts` needs a third `lib/` import — that is the signal it wants a core-side home, not another negation. Also open: `ItineraryCategory` and `ALL_CATEGORIES` live in `lib/`, so `core/content/schema.ts` and `core/budget/model.ts` still carry their own copies of the vocabulary and cannot reach the shared one under this rule. Moving the type into `core/` and making `lib/itinerary-category.ts` a re-export delegate — the shape used for `itinerary-storage` above — collapses the last two copies.

### D-264 · Addendum · (issue #177, 2026-08-22) · All three React-18 peer pins are gone

**Exit condition is met.** All three React-18 peer pins are gone — `cmdk 1.0.0→1.1.1`, `next-themes 0.3.0→0.4.6`, `sonner 1.5.0→2.0.8`. The `.npmrc` stays: a fourth, unrelated conflict was underneath it. `@types/node` is pinned at `20.6.2`; `vite@8` (via `@vitejs/plugin-react`/`vitest`) declares `peerOptional @types/node "^20.19.0 || >=22.12.0"`, fatal because the package is present.

**New exit condition is a bump to `@types/node@20.19.0`.** Measured both directions: `--legacy-peer-deps=false` fails on `@types/node` alone with no mention of the three named packages, and bumping only `@types/node` to `20.19.0` resolves clean (747 packages, no ERESOLVE).

**No call-site changes needed for `sonner@2.0.8`.** The major version was absorbed with no removed v2 API (`loadingIcon`, `pauseWhenPageIsHidden`, `cn`, `important`) in use here. It did break `next-themes/dist/types`, a subpath 0.4.6 no longer exports. D-264's a11y condition was discharged: `a11y.spec.ts`, `a11y-full-audit.spec.ts`, `a11y-intrip.spec.ts` all clean under 2.0.8.

### D-379 · (issue #179, 2026-08-21) · Amends D-362 · The visual job runs on `windows-latest`, matching the baselines, instead of staying `continue-on-error` on Linux forever

**Decision.** `.github/workflows/ci.yml` gets a new `visual` job on `runs-on: windows-latest`, gated the same way as `e2e` (`needs: checks`, `if: github.event_name == 'pull_request'`). It builds, installs Chromium, and runs `npm run test:e2e -- --grep visual` with no `continue-on-error` — a real, blocking check. The old Linux `Visual regression (advisory)` step is deleted from `e2e` outright rather than left in place unused; `e2e`'s `Behavioural suite` step already excludes visual specs (`--grep-invert visual`) and needed no change.

**D-362's finding still holds — this is the fix it names, not a reversal.** D-362 established that the CI visual job was structurally advisory because Playwright's snapshot path template appends `{platform}`, and a Linux runner looking for `-linux` against Windows-shot `-win32` baselines reports a missing snapshot, never a diff — no tolerance value could ever have closed that gap. That fact does not change. What changes is the runner: `windows-latest` is free for public-repo GitHub Actions, and on it the `-win32` suffix the baselines already carry is the one the run actually looks for, so the compare is real. Regenerating Linux baselines (D-362's other option) was rejected again here for the same reason it was rejected before: it commits 36 PNGs nobody locally renders and diverges from the Windows-local re-baselining workflow D-362 and D-377 both assume.

**The `e2e` job keeps its exact name.** Both `dev`'s and `main`'s branch protection require the literal status-check context `E2E (behavioural · visual advisory)`; renaming it (e.g. to drop "visual advisory") would make that required check stop reporting until the owner updates branch protection to match, which is out of scope for a workflow-file change. The name is now a stale description of what runs inside that one job, not a claim about the visual job's rigor — the visual job is a separate context (`Visual regression (Windows baselines)`) with its own name.

**Residual gap, stated plainly.** The new `visual` job is not in either branch's `required_status_checks.contexts` (verified via the GitHub API at the time of this decision). It runs and can go red on every pull request, but a red run does not by itself block a merge — only jobs listed in branch protection do. Adding it there is an owner action on repo settings, not a file in this repo.

**Changes if:** the owner adds `Visual regression (Windows baselines)` to branch protection, at which point this job is the actual gate and not just a reporting job.

### D-381 · (issue #180, 2026-08-22) · The CSP is a `<meta>` tag, not a header, and that shape sets its own ceilings

**Renumbered from D-379 by issue #219.** Two unrelated decisions were both headed `D-379`: the `windows-latest` visual job (issue #179, above) and this one. The visual-job entry keeps the id because it is the one with inbound citations — `.github/workflows/ci.yml:226` and `:279` both name D-379 and both mean that decision. This entry had none, so it moved. D-380 was already taken, so this took the next free id; D-382 through D-398 remain unused. The file's next new id is D-424.

**Decision.** `lib/csp.ts` builds the policy string at build time; `app/layout.tsx` emits it as `<meta http-equiv="Content-Security-Policy">` plus a `<meta name="referrer">`. Both directives and rationale live at the point of use in `lib/csp.ts` and `layout.tsx` — this entry is the why plus the tripwires, not a restatement.

- **Meta, not a header, because there is no server.** `next.config.js` sets `output: 'export'`, which drops `headers()` entirely, and the static host serves no headers of its own. A `<meta>` tag is the only lever a static export has.
- **No `frame-ancestors` is possible this way** — the directive is ignored in `<meta>` by spec — so clickjacking is not covered by this policy. Framing protection needs a real header, i.e. a host that isn't a static export. Report-only mode and `report-uri` are similarly unavailable.
- **`worker-src 'self' blob:` is load-bearing for maplibre-gl, and its failure is silent-partial, not a blank map.** maplibre builds its clustering worker as a Blob and spawns it via `URL.createObjectURL`. Measured with `blob:` removed: the basemap, tile layer, zoom/locate controls and attribution all still render — only the clustered place markers vanish, with one console CSP violation as the sole signal. A glance at the page does not catch it.
- **`refreshExpiredTiles` tripwire.** Tiles are governed by `connect-src` (fetched), not `img-src`, because maplibre's `Map` defaults `refreshExpiredTiles: true` and this app never overrides it. If the `Map` constructor is ever given `refreshExpiredTiles: false`, tiles switch to maplibre's `Image()` decode path, which is `img-src`-governed, and the CARTO tile origin (currently only in `connect-src`) has to be added there too or every tile silently 404s under CSP.
- **`'unsafe-inline'` on `script-src` is structural, not laziness.** Next's App Router serializes 615+ inline `self.__next_f.push(...)` RSC-payload tags across 21 pages (127 byte-unique, changing every build via content-hashed chunk names), plus `next-themes`' blocking inline theme script. One shared meta string across 21 pages can't carry per-page hashes, and a static export has no server to mint a per-request nonce. This CSP reduces XSS *impact* (blocks third-party script `src`) — it does not prevent inline script execution. Upgrade path: a post-build pass, shaped like `scripts/gen-sw.mjs`, that rewrites each page's meta tag with that page's own hashes; a half-migration is worse than none, since CSP3 makes browsers ignore `'unsafe-inline'` once a hash/nonce is present.
- **The policy string is `NODE_ENV`-dependent.** `'unsafe-eval'` is appended to `script-src` only under `process.env.NODE_ENV === 'development'` (webpack's HMR runtime evals modules as strings; the exported production bundle never does) — fail-closed: anything other than literal `'development'` (including `test`, or an unset env) ships without it. Any test or snapshot asserting on the built policy string must pin `NODE_ENV` explicitly (`lib/__tests__/csp.test.ts` does, via `vi.stubEnv`) or it is asserting on a string no browser ever receives.

### D-380 · (issue #191, 2026-08-22) · Amends D-130 · Owner approves Next 16 adoption for this milestone

**Decision.** The constraint in D-130 — "Stop at Next 15 for v4 (the plan's default; no 15→16 follow-on this milestone)" — no longer applies. The owner has explicitly approved Next.js 16 adoption for this milestone via issue #191. Target version is now Next 16.3.2.

**Why.** Issue #191 requested and the owner approved overriding the v4 milestone boundary, removing the "no Next 15→16" hold placed in D-130. This unblocks the Next 16 migration planned for the current development cycle.

**`eslint-config-next` deliberately stays at 15.5.20.** Not a compatibility block — it lints fine against next 16, and its 16.3.2 release does NOT conflict with the app's runtime `zod@3.23.8` (16.3.2 depends on zod v4, which npm nests under `eslint-config-next/node_modules`; the app's own resolution is untouched). The bump is deferred purely because 16.x turns on new lint rules, and taking that diff belongs in its own slice where the findings can be read on their own.

**Changes if:** a specific incompatibility forces a pin back to Next 15 — name the package and the failure here when it happens. The likely candidates are the three deps already carrying React 18 peers (the `--legacy-peer-deps` set) or `maplibre-gl`, none of which broke on 16.3.2 at the time of writing.

### D-399 · Addendum · (issue #183, 2026-08-23) · The missing-credential path is now visibly flagged, not just quietly skipped

**What changed.** The `No credential — rules NOT published` step in `publish-rules` now sets `continue-on-error: true` and ends with `exit 1` (upgraded from an implicit exit 0). GitHub renders a `continue-on-error` step that fails with a distinct warning icon in the run summary and checks list, so the skip path is no longer a plain green checkmark indistinguishable from a real publish. The step's own `::warning::` annotation is upgraded to `::error::` to match.

**What did NOT change.** `publish-rules`'s JOB conclusion is still success when the secret is absent — `continue-on-error` absorbs the step failure before it reaches the job — so `deploy: needs: publish-rules` still runs and the Pages deploy still ships exactly as it does today. The `Publish firestore.rules` step (the credential-present path) is untouched. D-399's INERT-until-armed contract stands: this fixes visibility of the skip, not the skip itself.

### D-424 · (issue #264, 2026-08-24) · The vitest `include` enumerates source roots, and that enumeration is load-bearing

**Decision.** `vitest.config.ts` collects `{app,components,core,hooks,lib}/**/*.test.{ts,tsx}`. Two axes widened at once: any depth under those roots, and no requirement that a test sit in a `__tests__/` directory. A test may now live beside the module it covers.

**Why it needed fixing at all.** The previous glob reached `{lib,components}/__tests__/` only, so a test written under `core/` or `hooks/` — the natural home for domain logic — was collected by nothing and passed CI by being absent. That is the same failure the D-099-era comment on this line already named when issue #32 widened the *extension* axis; #32 fixed one axis and left the other. Issue #173 filed the resulting layout and was closed by a commit that touched only `rule.md`, so the mechanism survived untouched and the count grew from 191 to 198.

**Do not "simplify" this to `**/*.test.{ts,tsx}` from the project root.** The roots are enumerated specifically to keep `e2e/` out of vitest's reach. Playwright's specs are all `.spec.ts` today, but Playwright's default `testMatch` also covers `*.test.ts`, so the first `e2e/foo.test.ts` would be collected by both runners and vitest would fail on the Playwright imports. Measured on the glob change in isolation: 203 files collected before and after, zero lost, no `e2e/` file swept in. The suite reports 204 once this batch's new spec lands.

**Known ceiling.** `scripts/` is deliberately outside the list — it is build tooling, and its tests live in `lib/__tests__/` today. A test placed at `scripts/**/__tests__/` is still collected by nothing. Narrower instance of the same fault, left open rather than widened without a reason to.

**Changes if:** a test lands under `scripts/`, or Playwright's `testMatch` is narrowed to `.spec.ts` explicitly — the second would make a root-level glob safe and this enumeration unnecessary.

### D-425 · (issue #248, 2026-08-24) · The installed app does not lock orientation

**Decision.** `scripts/gen-sw.mjs` emits `orientation: 'any'` in the generated web app manifest, replacing `portrait-primary`.

**Why.** WCAG 2.1 SC 1.3.4 requires that content not restrict its view and operation to a single display orientation unless that orientation is essential. Nothing here is essential in that sense — no viewfinder, no signature pad, no instrument. The map and the calendar are the two surfaces that gain most from landscape, and the people this locked out are anyone whose device is mounted or who cannot comfortably rotate it.

**Why the existing coverage could not have caught it.** axe does not read the web app manifest. The recorded twelve-route scan at all impact levels says nothing about this file, and no test asserted on the value — verified before changing it.

**Stated rather than omitted.** `any` is the spec default, so the key could be dropped entirely. It is written out so that `portrait-primary` does not drift back in as an apparently-deliberate addition.

**Changes if:** a surface ships that genuinely cannot function in landscape, in which case lock that surface, not the whole app.

### D-426 · (issue #266, 2026-08-24) · The Firebase web config is a required build input, not an optional one

**Decision.** `deploy.yml` halts the release when any of the six `NEXT_PUBLIC_FIREBASE_*` values is empty or whitespace-only. This reverses the previous explicit stance, recorded in that file's own comment, that an absent value simply built a localStorage-only site with no failure.

**Why the old stance expired.** It was written while sync was genuinely optional. Trip join, share and the two-device check are now load-bearing, so a rotated or renamed secret ships an app with cross-device sync silently off — build green, version gate green, nothing red anywhere in the run. Same failure shape as issue #41, which is why it gets the same treatment as the concierge guard directly above it.

**Six by choice, not by necessity.** `lib/firebase-config.ts:47` gates `isRemoteConfigured()` on three of the six — apiKey, projectId, appId. The other three do not affect that predicate and two are inert today. All six are still required here on purpose: they come from one console page, so a partial set is a mistake however it arose, and a missing `authDomain` is the worse shape — the gate still reports configured while auth breaks.

**Hard `exit 1`, not the visible-but-not-blocking idiom used by `publish-rules`.** That idiom exists because arming the rules publish is a deferred owner decision with a documented downside. No analogous reason exists to want a deploy that ships with sync off, and fail-closed is free here: a blocked deploy leaves the working live site untouched, which matters more than usual given there is no rollback. Also structural — `continue-on-error` is a step-level key and that step ends with `npm run build`, so marking it non-blocking would swallow a real build failure too.

**Names only, never values.** The guard reports a count on success and names the empty variables on failure. They do inline into the public bundle and are not really secrets, but a workflow log is still the wrong place to widen that.

**Changes if:** the app stops treating cross-device sync as load-bearing, or the three inert values are removed from the build entirely.

### D-427 · (issue #268, 2026-08-24) · `NEXT_PUBLIC_BASE_PATH` is set on the `checks` build only, and the omission elsewhere is deliberate

**Decision.** `ci.yml`'s `checks` job builds with the same `basePath` expression `deploy.yml` derives, so the shipped configuration is exercised before the job that publishes it. The `e2e` and `visual` jobs deliberately do not set it.

**Why.** Until this change nothing in CI set the variable, so every automated check ran against `next.config.js`'s empty-string default while production shipped with a prefix. `scripts/gen-sw.mjs` prefixes every precache URL from it — 198 entries on the verifying build — and that prefixed manifest was never produced anywhere except the publishing job. The class has shipped twice before: a query-parameter cleanup that double-prefixed and navigated users to a 404, visible only on the deployed site, and a `next/image` assumption that only a real basePath build disproved.

**Why the browser jobs are excluded.** `scripts/serve-out.mjs` maps `/` to `out/index.html` and knows nothing about a prefix, so under a basePath build every asset and every navigation would 404. Mounting that server at the prefix is its own change. Do not add the variable to those jobs without it.

**Residual, stated so it is not mistaken for done.** `deploy.yml` also sets `NEXT_PUBLIC_SITE_URL`, which `checks` still does not. Its only consumer falls back cleanly, so nothing breaks; the "CI's build environment is a strict subset of the deploy environment" framing is now less true rather than false.

**Changes if:** `serve-out.mjs` learns a prefix mount, at which point the browser jobs should take the variable too.

### D-428 · (issue #243, 2026-08-24) · Two offset resolvers, and which one a caller takes is a correctness question

**Decision.** `core/dates/item-time.ts` exports both `declaredOffsetForCountry` — the pack's own value for a leg — and `offsetForCountry`, which is that value when the pack has real geography and the device's own offset otherwise. Callers doing UTC-instant maths take the second. Callers that **assert** a zone take the first.

**Why the split.** One function was answering two different questions. "What UTC instant is this wall-clock?" must return something even when the pack declares no geography, and the device offset is the honest anchor — `lib/trip-now.ts` independently makes the same choice. "Which zone may we print?" must be allowed to return nothing. Feeding the first answer into the second is the defect: a custom trip sets `utcOffsetMin: 0` on its single leg, so a device at UTC−5 in December badged every item `EST`, including on a Paris trip.

**This restores a guarantee that was already written down.** `lib/item-time-display.ts` states that an offset with no table entry — naming a custom pack's own leg offset explicitly — stays unbadged. "Silence, never a guess." The badge never reached the table because the substitution happened one function earlier. The code now matches the comment the author thought they had written.

**Rejected: making `offsetForCountry` return the leg's zero.** It has fifteen consumer files doing instant maths; a US-Eastern traveller's Tonight card and now/next progress would shift five hours. Much larger blast radius for a display defect.

**Changes if:** issue #250 resolves real coordinates for custom trips, at which point `declaredOffsetForCountry` is where the resolved value belongs and the badge lights up with no further change — but only for offsets already in the hardcoded table, so the existing ceiling on that table binds harder then, not less.

### D-429 · (issues #242 and #241, 2026-08-24) · The dialog scroll-lock is released while the item editor is hidden, and the tab-bar contract has two forms

**Decision, part one.** `calendar-planner.tsx`'s `ItemEditor` now takes the ref-counted dialog-open flag, but as `useDialogOpenFlag(!hidden)` rather than the bare call its three mount-scoped siblings use.

**Why not the bare call.** During pin-pick the editor stays mounted but goes `invisible pointer-events-none`, and the interaction surface for that whole state is the map pane — non-modal by design, page meant to scroll behind it, and on large viewports a sticky aside the user may have to scroll into view. Locking there would trap desktop pin-drop, and `e2e/pin-drop.spec.ts` scrolls the canvas into view in exactly that state.

**Decision, part two.** The `--tab-bar-h` contract is consumed two different ways and the choice is not arbitrary. Floating chips — the presence bar, the quick-add button, the arrival toast — take it as a `bottom` offset. Full-width bottom-anchored **panels** take it as `padding-bottom` with the large-viewport reset, leaving box geometry untouched.

**Why that distinction matters here.** The mobile map sheet on `/plan` has two height states. Lifting `bottom` moves the top edge up in both, and at the expanded state on a short phone the sheet header — the collapse and close controls — goes off the top of the screen. Padding shrinks only the canvas, which is the thing that has to move: the tile attribution control is docked to the canvas, and that attribution is a licence condition rather than decoration.

**Changes if:** the tab bar's height stops being published as a custom property, or a panel appears whose top edge genuinely should move with the bar.

### D-430 · (issue #244, 2026-08-24) · The first-run tour is trip-aware, not gated

**Decision.** The tour's Plan blurb derives its day count and destinations from the active trip config. It is not wrapped in the default-trip gate.

**Why not gated.** All five stops exist on a custom trip — the destinations are primaries or a panel on `/plan`, none is default-trip-only. Gating would either render a "this belongs to another trip" notice inside a welcome modal, or delete onboarding entirely for the traveller whose app is emptiest. The leak was one string literal, not the feature.

**Why the trip config and not `TRIP_DATES`.** That constant is captured at module load while the label is read at call time, so the two could pair a stale count with a fresh destination. Both halves now come from one object.

**The placeholder case is guarded.** A trip joined by token with no config yet is a one-day span whose only destination is the trip's own name, so the clause drops entirely rather than claiming "1 days in Shared trip".

**Related fix in the same file.** The nav lookup asked for a label that no longer exists — the entry was relabelled Today — and its `?? '/'` fallback returned Today's real href, so a broken lookup was correct by luck and nothing caught it. The fallback is now `''`: still total, because this module sits in the app-wide chunk where a module-load throw sends every route to the error boundary, but no longer able to be accidentally right.

**Changes if:** a tour stop is added that genuinely does not exist on a custom trip, which would make gating that stop correct — gate the stop, not the tour.

### D-431 · Addendum to D-034 · (issue #213, 2026-08-24) · The `ToBookPlaceholder` type is gone; the `to-book` status is not

**What was removed.** `JAPAN_TODO` (a permanently empty exported array), the `ToBookPlaceholder` interface, and `toBookPlaceholderSchema`. The only consumers were two unit assertions confirming an empty array was empty, and the panel that once rendered it is already asserted gone by `e2e/flights-page.spec.ts`.

**What survives, and why the distinction matters.** `BookingStatus` and its `'to-book'` member are independent of the deleted type. They type `Journey.status` and `Stay.status`, feed the journey and stay schemas, and drive a live rendering branch in `flights-section.tsx`. Deleting them would have broken the flights page. The two are easy to confuse because D-034's text names them in one breath.

**D-034 is amended only in that respect.** Its sentence that `status: 'to-book'` and `ToBookPlaceholder` are "the only sanctioned way to show unbooked logistics" now over-states: the status half stands unchanged and remains the sanctioned way; the placeholder record type no longer exists. The rule that unbooked logistics are never faked with invented numbers or hotels is untouched.

### D-432 · Amends D-423 · (issue #214, 2026-08-24) · Static firebase imports are lint-enforced, and a same-rule block must splice rather than stack

**Decision.** `eslint.config.mjs` forbids static `import` of `firebase/*` and `@firebase/*` outside tests, so the SDK can only be reached through a dynamic import.

**The enforcement mechanism works for a non-obvious reason.** `no-restricted-imports` registers listeners for import and export *declarations* only — it has no `ImportExpression` and no `CallExpression` listener. The permitted shape and the forbidden shape are therefore different AST node types, so `await import('firebase/app')` and inline `import('firebase/firestore').Type` are invisible to the rule by construction. **No allowlist or negation block is needed** for the modules that legitimately reach Firebase. `allowTypeImports` stays on, matching D-423, and the genuinely risky variant — value-syntax import used only as a type, whose elision depends on compiler settings — is still caught.

**The constraint worth remembering is about flat config, not about firebase.** ESLint flat config **replaces** a rule's options when a later block sets the same rule name on an overlapping path; it does not merge. A new block adding this restriction over `core/**` would have silently switched off D-423's entire inward-arrow boundary for every core file, with a green build and no failing test — precisely the failure mode this issue exists to prevent. The firebase pattern is therefore spliced into the existing blocks' `patterns` arrays. **Any future restriction on a path already covered must splice too.**

**Not covered, stated plainly.** `require('firebase/app')` is out of this rule's reach and is caught by the no-require rule instead. `e2e/` and `scripts/` are out of scope, being non-first-load. A disable comment still bypasses, as with any lint rule. Separately, the `lib/*-ports.ts` headers assert that the `*-remote` **module** is not imported at module scope — a local-module restriction, not an SDK one, and still unenforced.

### D-433 · Amends D-423 · (issue #267, 2026-08-24) · A rules refusal is classified and stops being retried, and the classifier took a core-side home

**Decision, part one.** `isPermissionDenied` now declares in `core/sync/denied.ts`, and `lib/firebase-remote.ts` re-exports it. There is still exactly one copy, and `presence.ts`, `trips-remote.ts` and the `export *` chain are unchanged.

**This discharges D-423's own trigger clause literally.** That clause reads: `outbox.ts` needing a third `lib/` import is the signal it wants a core-side home rather than another negation. It also names the re-export delegate shape, which is what was used.

**Rejected: threading the predicate through the `ChunkSync` port.** The value would be identical in all five domain implementations, and the five `*-ports.ts` files are on the static graph — static-importing `lib/firebase-remote.ts` into them would have put it on the dormant first-load path for the first time, breaking a promise repeated verbatim in all five headers.

**Decision, part two.** A chunk whose push is refused for permission reasons is recorded in a session-scoped set and stops being attempted for that page load. It surfaces as a third sync-badge state and a matching pre-flight row.

**It is never acked and never persisted.** Not acked, because the dirty record is also the first-snapshot merge exception — acking a refused chunk would let the next reload apply remote authoritatively over the very edit that could not be pushed. Not persisted, because membership can be granted later from another device; `presence.ts` sets the same per-page-load precedent, and a disk flag would need an expiry protocol. The set is keyed by the trip-scoped slot key, so singleton chunk ids cannot carry one trip's refusal into another.

**Rejected: reusing the existing access-pending toast.** A toast is transient and the badge is the durable surface that was lying — dismiss the toast and it still reads "3 pending" indefinitely. The wording is also wrong for a write-shape refusal.

**This makes the failure legible, not recoverable.** Recovery is still that a member adds the device, and that path was not built here. It matters most as a precondition for arming the Firestore rules publish: without it, stranding a traveller by publishing before inspecting the live rosters produces nothing anyone would find.

**Known ceiling.** Per-tab and per-page-load; two tabs each learn a refusal independently, and membership granted mid-session needs a reload. The read side is also unclassified — the snapshot stream's error callback warns and retries without checking for a denial — which is a sibling gap, not this one.

**Changes if:** the read path is classified too, or a recovery flow lands that can clear a refusal without a reload.

### D-434 · (issue #221, 2026-08-24) · Journal search lives on `/journal`, not in the command palette

**Decision.** A substring filter over `useJournal().entries` in `components/journal-browse.tsx`, exported as `matchesJournalQuery`. No index, no dependency, no second read path.

**The issue proposed a palette group and that was rejected on a fact, not a preference: the command palette has no mobile trigger.** Its only two openers are the Cmd/Ctrl+K binding, which needs a physical keyboard, and the More-menu Search row in the desktop navigation — `navbar.tsx` records that the mobile hamburger was removed, and neither the bottom tab bar nor `/more/` carries a Search row. The journal is written and re-read on a phone mid-trip, so a palette-only search would have shipped unreachable for its whole audience. Filed separately as issue #281, because it makes plan search, the currency converter and section jumps desktop-only too.

**Active-trip scoping is structural, not a filter.** `useJournal()` reads through the gateway's trip-namespaced key, so the filter's output is a subset of the active trip's entries by construction — the same guarantee the palette's own plan group relies on.

**Mood is deliberately not matched.** It is a chip facet; "good" is too common a word in a body for it to be a useful substring.

**If a mobile palette trigger ever lands, `matchesJournalQuery` is the extraction point. Do not duplicate the matcher.**

### D-435 · (issue #220, 2026-08-24) · `HOME_TIME_ZONE` is an assumption, and it is an IANA id on purpose

**Decision.** A home clock renders on the Travel Mode essentials card, gated to the default trip. The zone is one exported constant in `core/dates/item-time.ts`.

**The app stores no home location.** There is a home *currency* in the budget model and nothing else. The zone is derived from the default pack's flight-home destination and is written down as an assumption rather than smuggled into a component. A custom trip renders no clock at all rather than showing a stranger someone else's home time.

**It is an IANA zone id, not the `-300` offset, and that is the load-bearing detail.** The offset table's US Eastern row is documented as December and January only; the zone is `-240` for most of the year. A home clock gets read months before departure, so a fixed offset would show the wrong hour nearly all the time. `Intl` resolves the offset per instant, including across the DST boundary inside the reading window.

**It reads the real clock, never the trip's.** The `?today=` override moves the trip's day; it does not move the wall time at home.

**Changes if:** a pack can declare a home, at which point this moves onto the pack and the default-trip gate comes off.

### D-436 · (issue #236, 2026-08-24) · A removal the itinerary will undo is announced as temporary, not prevented

**Decision.** `/profile` marks a row the active trip names, carries the caveat in the remove button's accessible name, and announces that the place will be counted again. The button stays and `removeVisit` is unchanged.

**Why not hide or disable the control.** The write is real — the row goes, the count drops, disk changes. Only its permanence was over-claimed. Hiding remove for a trip-claimed place would encode "the itinerary wins" into the UI, and `core/places/visited.ts` records that decision as deliberately open. A disabled control with no explanation is also worse for a screen reader than a labelled live one.

**The claimed set is the whole trip, not the arrived-so-far prefix.** The prefix version is clock-dependent and would still lie about a future city — remove it in August, and it silently returns the day the trip reaches it. Using every trip place makes the sentence true in both cases and needs no clock.

**This does not settle the ceiling at `removeVisit`.** Which record wins, the itinerary or the person, is still open. Note the related asymmetry filed as issue #279: the removal drops the city's GPS confirmation permanently while the city itself returns.

### D-437 · (issue #234, 2026-08-24) · Dependabot watches `trip/`, targets `dev`, and may move the SHA pins

**Decision.** `.github/dependabot.yml` with the npm and github-actions ecosystems, monthly, grouped, majors ungrouped.

**Two settings are silent when wrong.** `directory: /trip`, because that is where the only manifest lives and the default `/` would watch nothing while looking identical to "no updates available". `target-branch: dev`, because everything lands there first — with the consequence that this config does **not** apply to Dependabot security updates, which always target the default branch.

**`.npmrc` is honoured, which is the thing that decides whether this config is useful at all.** Dependabot fetches a committed `.npmrc` from the configured directory, preserves it apart from interpolated and timeout lines, and writes it beside the lockfile before resolving. So `legacy-peer-deps=true` is in force and the `@types/node` peer conflict never fires. This matters because Dependabot deliberately does not retry with that flag on a peer-dependency failure — without the committed file, every PR it opened would fail to resolve.

**The actions ecosystem is enabled despite every `uses:` being SHA-pinned.** Pinned actions never generate advisories, by design, so a scheduled bump is the only coverage they have; pinning without one is a slow freeze onto old releases. Dependabot rewrites both the SHA and the bare version comment, so the pin keeps its meaning.

**No `npm audit` step in CI.** It would go red on two transitive low-severity advisories for a dev-only issue and block merges, which is the wrong trade.

**This does not close the advisory gap.** Dependabot alerts are disabled at the repository level — a settings toggle, not a file. Filed as issue #277.

### D-438 · (issue #223, 2026-08-24) · A print stylesheet is not a light theme, and does not reopen D-009

**Decision.** One `@media print` block appended to `app/globals.css`, plus Tailwind `print:` variants. Two routes earn a designed paper layout: `/safety` restyled in place, and `/plan` rendering a separate print-only 32-day sheet. `/flights` gets none — its bookings fold into the plan sheet.

**Why this does not reopen dark-only.** Print is a separate media context the browser selects when the output device is paper. It adds no toggle, no theme class, no user-facing choice, and cannot match at screen. Ink is subtractive: on paper white is the absence of toner, so the night canvas is not merely expensive to print, it is unreadable once printed.

**The safety property, and how it is checked.** The block is appended, and everything before it is byte-identical to the prior revision, with exactly one `@media` in the added text. That is verifiable mechanically rather than by reading, and it is what guarantees no screen rule moved.

**Why `/plan` gets a twin rather than a restyle.** The planner shows one day at a time, so restyling it for paper prints a month grid and a single day — not an itinerary.

**Why `/flights` gets nothing.** A traveller carries one sheet, not three, and proof of onward travel is only proof when it is attached to the itinerary. The flight cards are a live-status and deep-link surface whose value is entirely on screen.

**Ink tiers are `#000` / `#333` / `#555` on white — 21.00, 12.63 and 7.46 to one.** The floor lands within 0.04 of the screen ramp's own floor, so the three-tier contrast decisions hold on paper as written rather than by luck. Still three tiers, no fourth.

**Two things only rendering finds, both handled.** The gradient heading classes set `-webkit-text-fill-color: transparent`, so stripping the gradient and setting a colour leaves those headings invisible. And framer-motion parks unrevealed elements at an inline `opacity: 0`, which a print job renders regardless of what anyone scrolled to — an author `!important` is the only thing that reaches them.

**Known ceiling: no page numbers.** The `@page` margin-box counters that would provide them are a paged-media feature no browser ships. Numbered day headings carry the ordering instead.

### D-439 · (issues #252 and #253, 2026-08-24) · A time-windowed checklist claim is anchored in the label, not in a new field

**Decision.** The Nepal visa row names the earliest useful date in its own label, and the power-bank row states the carry-on rules in its own label.

**Why not a due-date field on the row type.** `DocItem` extends the synced row type, so a new field drags the merge and rules surface along with it — for a value that never varies, because the trip dates are fixed. A literal in the copy is the smaller and more honest change. `PackingItem` has no notes field at all, so the label is the only place the rules can go.

**Why these read as they do.** The visa receipt is valid fifteen days, so ticking the row in September is a false green on the one item that gates entry; the anchor is chosen to sit inside the window under either inclusive or exclusive day-counting. The power-bank row states only the firm carrier-wide rules and deliberately omits the lower ceiling one carrier flags for January 2027 — encoding a maybe into a packing label is how a wrong label ships in December.

**These rest on external facts that can move.** They are worth re-verifying before departure, and the claims are kept short specifically so that re-check is cheap.

### D-438 · Addendum · (issue #223, 2026-08-24) · The sr-only carve-out, and the honest version of the eager-mount trade

**`.sr-only` keeps its clip, and the universal `overflow: visible` must never take it away.** That rule is the pagination fix — a clipped box cannot flow onto page two — but `.sr-only`'s `clip: rect(0,0,0,0)` is a **paint** clip, not a layout one. Unclipping it prints nothing extra, and the text still lays out at full width. Measured on `/checklist`: `scrollWidth` 1905px against a 794px A4 page, entirely from one visually-hidden string. The consequence is not a visible break — it is the print dialog silently shrinking the whole document to fit, and a headless `page.pdf` clipping it. Both failures are the kind nobody notices until they are holding the paper.

**That carve-out is pinned by `e2e/print.spec.ts`,** which asserts `documentElement.scrollWidth <= clientWidth` in print media on `/plan`, `/checklist` and `/safety`. Verified to bite: with the carve-out removed, `/checklist` fails and the other two still pass.

**The print sheet's title comes from the active pack, not a literal.** Every other value on the sheet is pack-derived, so a hardcoded title printed a custom trip's real dates and days under the default trip's name — the same leak class the bookings block on the same sheet is already gated against.

**The eager-mount reasoning first recorded here was wrong twice, and the correction is worth more than the original.** Measured from a real build, the island is its own chunk at 14,045 B raw / 5,047 B gzipped, and it does **not** appear in `/plan`'s HTML — First Load JS is unchanged either way, so deferring it would save nothing on load. The two reasons originally given for mounting eagerly do not survive either: `dynamic(ssr:false)` also mounts after hydration, so both the print-races-the-chunk-load window and the layout-shift argument apply equally to that form. The window is shortened by mounting eagerly, not closed.

**The real cost runs the other way, and it is the number to weigh if this is revisited.** On screen the hidden sheet is 1,218 of `/plan`'s 2,119 DOM nodes. It consumes the itinerary context, so every itinerary edit re-renders 32 days and reconciles those hidden nodes. That is the price of the sheet always being there, and it is paid on every edit in the planner rather than in kilobytes on load.

**Worth naming as a general lesson:** the original comment was long, confident, and two of its three claims were wrong. Length read as authority. A shorter comment with a measured number in it would have been harder to get wrong and easier to check.

### D-440 · (issue #227, 2026-08-25) · Packing gets local add/remove/custom items — D-201's named trigger fired, no schema change

**Decision.** `core/packing/model.ts` gains `addItem`/`removeItem`, total pure functions mirroring the existing `addExpense`/`removeExpense` id-injection shape. A custom item is minted with a `custom-<ts>-<rand>` id (prefixed so it can never collide with the fixed template's `nepal-`/`japan-`/`universal-` ids) and stored in the existing gateway key 21 slot alongside the template — no new key, no schema change. Custom items are bucketed into the existing `universal` category rather than adding a fourth `PackingCategory` value; `isPackingCategory`/`CATEGORY_META`/`CATEGORY_ORDER` are untouched.

**Why.** D-201 named its own trigger for revisiting the fixed-template decision: "user-added custom packing items being wanted." That trigger fired via #227. Bucketing into `universal` rather than minting a category was the smaller diff, needed no category-picker UI, and composes correctly with the existing custom-trip fallback in `core/packing/storage.ts` (which already filters the template to `universal`-only for a non-default trip).

**What did not change.** Packing stays a device-local, non-synced domain — no outbox chunk, no merge rules, no Firestore rules shape. That was D-201's other named condition for a *future* decision ("packing sync is a whole new synced domain... a separate decision"), and this slice deliberately did not touch it.

**Changes if:** packing sync is ever wanted — that is still the separate, larger decision D-201 flagged, unaffected by this one.

### D-443 · (issue #247, 2026-08-25) · Wake lock policy: always-on for a bounded interaction, opt-in toggle for a route that can sit open

**Decision.** `lib/use-wake-lock.ts` now has three call sites. Travel Mode and the safety phrase card (`travel-safety-kit.tsx`) both hold the lock unconditionally (`useWakeLock(true)`) — each is a bounded, deliberate hold-up-the-phone interaction with a natural end. `/map` (`map-section.tsx`) instead gets an explicit user toggle, persisted via a new gateway key (`mapWakeLockEnabled`, mirroring the existing boolean-persisted-toggle shape used elsewhere), defaulting off.

**Why the map route is different.** Travel Mode and the phrase card are interactions someone is actively holding the phone through; `/map` is a route someone can leave open in a pocket. An always-on lock there would drain battery on a trip that is already rationing it for a benefit nobody asked for in that moment.

**The general rule for the next consumer.** A wake lock on a bounded, actively-attended interaction can be unconditional. A wake lock on a route that could plausibly sit open and unattended needs an explicit, persisted, off-by-default toggle. This is the test to apply before wiring `useWakeLock` into a fourth surface.

**Changes if:** a bounded-interaction surface turns out to have a realistic "left open in a pocket" failure mode too — then it should move to the toggle pattern, not stay unconditional.
### D-442 · (issue #238, 2026-08-25) · Tombstone GC horizon is anchored on data, not just the device clock

**Decision.** `gcTombstoneRows` (`core/sync/merge-items.ts`) is the one predicate all three GC call sites route through (itinerary's `gcTombstones`, expenses' `gcTombstoneRows`, and `core/places/merge.ts`'s `mergePlaces`). Its cutoff was `deviceClock - horizonMs`; it is now `min(deviceClock, newestLiveRowStamp) - horizonMs`, where the anchor is the newest `hlc.pt` among the *live* rows in the set being GC'd (tombstones excluded from the anchor), falling back to the device clock when there is no live row at all.

**Why live rows only.** An anchor drawn from tombstones lets two ancient tombstones shield each other — each reads as "recent" relative to the other regardless of how wrong the clock is — and a single lone tombstone becomes its own anchor and can never be collected. A live row is written by a real device acting now, so it is an independent check the clock can't self-referentially satisfy.

**Why.** A device clock genuinely ~30 days fast pruned every tombstone in a document and pushed the pruned result; an offline peer holding the pre-delete row then re-added it, undoing the delete for the whole group. `lib/trip-now.ts` had already closed the *simulated*-clock vector; this closes the real-wrong-clock one, without a trusted-clock redesign — the horizon logic itself is unchanged, only its clock source.

**Residual, not closed.** A device with both a bad clock and a fresh live edit in the *same push* still poisons its own anchor — `hlcSendOrLocal` never clamps physical time (D-228). That self-poisoning case is out of scope; what this closes is GC reading a clock decoupled from anything in the document at all, which was the reported mechanism.

**Changes if:** the self-poisoning residual above becomes a real observed failure — that needs clamping physical time at the HLC layer (D-228), a separate and larger decision.
### D-441 · (issue #228, 2026-08-25) · A booking made mid-trip is shown via a local override layer, not a `booking-data.ts` edit

**Decision.** `core/bookings/override.ts` adds a local-only, trip-scoped `BookingOverrideMap` (gateway key 40, `nepal_japan_booking_overrides`) keyed by the same id space `lib/booking-data.ts` already exports (`Journey.id` / `Stay.id`). `/flights` (`components/booking-override-editor.tsx`) is the only editor: a small inline form (carrier/hotel name, confirmation number, two verbatim labels, a note) that appears beside any entry whose static status is `'to-book'`. `components/flights-section.tsx` merges an override onto the matching `Journey`/`Stay` at render time via `applyJourneyOverride`/`applyStayOverride`, which return a new object (or the identical input reference when there is no override) — `booking-data.ts` is never imported for anything but its `Journey`/`Stay` types, never edited, and its exported consts are proven unmutated by the merge.

**Why this doesn't violate D-034.** D-034 locks `booking-data.ts` as read-only presentation data with a single writer: a human editing the module and redeploying. That module is untouched by this slice. The override is a separate, additive layer that only ever touches the display copy handed to `FlightJourneyCard`/`StayCard`; clear the override and `/flights` reverts to rendering `booking-data.ts` exactly as authored. Nothing here makes the module writable.

**Scope.** Local-only, no sync (mirrors `favoritesStore`) — an override made on one device is not visible to another traveler's, unlike a real booking. It overlays only the fields the small form collects; it does not reconstruct a multi-leg itinerary or new layovers, and it does not populate `flight-journey-card.tsx`'s existing "Confirmation" chip (that chip's `undefined` is D-034's own "never fabricated" contract on the static data — the override's confirmation number shows in a separate summary panel instead). It rides the existing whole-trip backup/restore (`lib/trip-backup.ts`) as a plain local-only domain, matching `dayAnchors`.

**Changes if:** a booking needs to be visible to every traveler on the trip, not just the device that entered it — that is real sync, a materially bigger decision, and is not what this slice does.

### D-444 · (issues #239, #295, 2026-08-25) · docsChecklist restore is a same-id upsert — a third named restore shape

**Decision.** `hooks/use-docs.ts` gains `restoreDocsChecklist(backup)`. Dormant is a plain `commit(() => backup)` overwrite (byte-identical, unchanged). Under sync it's `commit(current => mergeItems(current, backup))` — the same `mergeItems`/`resolvePair` HLC comparator every synced domain already shares, applied per fixed id: whichever side's stamp is newer wins. Wired into `lib/trip-backup.ts` as a 5th optional `CommitDocsChecklist` param on `importTripBackup`, mirroring the `commitMyPlaces` injection shape, and into `components/backup-restore.tsx` gated on `synced`.

**Why a third shape, not a repeat of expenses/myPlaces.** Those two restore by tombstoning every live row absent from the backup and re-adding the backup's rows under fresh ids — correct for domains that add/remove freely. `core/docs/model.ts`'s `DocItem` is a fixed, meaningful-id template (`passport-validity`, `nepal-visa`, …) with no add/remove path and no tombstone mechanism at all; minting a fresh id on restore would disconnect a row from the id `toggleItem`/`setNote`/`docsCompletion` look it up by. Same-id upsert-by-stamp is the correct shape for a domain whose id space is closed and permanent, not a compromise.

**What was actually broken before this.** Restore routed through the generic `enqueueRestored` path — a blind overwrite of local disk with the backup's raw rows, no stamp comparison at all. A live edit made after the backup was taken got silently reverted by a restore, the exact "restore merges instead of replacing" defect class #239 named, just manifesting as the opposite direction (over-writing forward edits) rather than under-writing them.

**The general rule going forward.** Three restore shapes now exist for three real domain shapes: fresh-id tombstone-replace (expenses, myPlaces, itinerary — open id space), same-id upsert-by-stamp (docsChecklist — fixed id space, no add/remove), and not-yet-solved (budget — field-level LWW, no per-row shape at all, tracked separately). Before wiring a new domain's restore, name which of the three its storage shape actually matches — don't default to copying expenses' shape because it was first.

**Changes if:** budget gets a real per-field restore design — that is its own decision, unrelated to this one.

### D-447 · (issue #333, 2026-08-25) · An absence claim needs an explicit count assertion, and a persistence test must read back through production code

**Decision.** Two test rules, both learned by finding tests that stayed green while the code under them was broken.

**One: `toBeHidden()` and `if (await locator.count())` both pass for an element that does not exist.** So a test asserting something is hidden, or guarding an assertion on presence, survives that element being deleted outright. Any such claim needs `expect(await locator.count()).toBeGreaterThan(0)` first. Proven: renaming both target test ids in the app and rebuilding left the offending test green.

The same file already carried this rule in a comment on an earlier test, and the last test in it did the opposite anyway. Knowing the trap is not enough — the count assertion has to be written.

**Two: a persistence test that reads storage directly proves nothing.** The one named "the localStorage reload proof" unmounted, remounted, and then asserted with a direct `localStorage.getItem`. No production code ran between the write and the check, and deleting the remount entirely left it green. A reload test has to read back through the component or hook that does the rehydrating.

**Both were found by mutation, and that is the standard worth keeping.** Twenty-four production mutations were run across the tests that landed in one day: nineteen were caught, five were not. Passing proves a test compiles and does not throw; only breaking the code under it proves the test would notice. Every fix here was accepted on the same evidence — apply the mutation, see red, restore, see green.

**Three related shapes to distrust**, all found in the same pass: an assertion on a value the test itself constructed (a fixture that hand-picks ids which cannot collide, then asserts they do not collide); an assertion that re-runs the implementation to compute its own expected value (comparing against `-new Date().getTimezoneOffset()` when that is exactly what the function does — it binds to the runner's clock, and what it accepts changes silently at every DST boundary); and a branch whose precedence is never exercised because no test sets both inputs at once.

**Not every guard of this shape is wrong.** A `count()` check preceding a settle — waiting for an animation on an element that may legitimately be absent — is correct, because there is nothing to settle when it is missing. The distinction is whether the absence is the thing being claimed or merely tolerated.

**Changes if:** a linting rule can catch the bare `toBeHidden()` case mechanically, at which point the convention stops depending on review.
### D-445 · Supersedes D-441 · (issue #329, 2026-08-25) · The booking-override layer is removed; `'to-book'` is a type member with no instances, not a feature key

**Decision.** The local booking-override layer is deleted — editor, hook, core module, gateway key, backup domain and its tests. `BookingStatus`'s `'to-book'` member and the status chip stay; they are independently typed and removing them is a separate call.

**Why, and the fact that decides it.** D-441 gated the feature on `Journey.status === 'to-book'`. **No `Journey` or `Stay` has ever carried that status, in any revision of `lib/booking-data.ts`.** Checked across every revision of the module: the sole match in each is the header comment, not a record. On `dev` the count is eight `'booked'` and zero `'to-book'` outside that comment. The gate was `false` for all eight records from the day it was written, so the editor has never rendered.

**The unbooked surface was never the same shape.** `JAPAN_TODO` was `ToBookPlaceholder[]` — `{id, kind, label, note}`, with no `status` field — rendered by its own card in a separate panel. It could not have satisfied the gate either. Its deletion in #213 is a coincidence, not the cause, and restoring it would fix nothing.

**The root cause is a comment, not a collision.** `booking-data.ts`'s header asserted that `status: 'to-book'` was "the ONLY sanctioned way to show unbooked logistics" — an aspirational contract written in the first commit and never once exercised. Three passes trusted that sentence without grepping the eight records: the slice that built the feature, D-431's addendum claiming the status "drives a live rendering branch" (it does not — the chip is typed for both values and has only ever rendered the booked one), and the issue that first diagnosed the bug. The header and the matching row in `docs/trip-content.md` are corrected in the same change, because that prose is what the next person would read.

**Why not author a `to-book` record.** The booking data is deliberately fictional scrubbed sample content, so there is no real reservation to be honest about. A `to-book` journey would render identically to a booked one — `FlightJourneyCard` does not read `status`, and the placeholder card went with `JAPAN_TODO` — so it could only ever work for a stay, leaving the flights half unreachable. Flipping a stay would contradict its own check-in and check-out facts and the `/flights` masthead copy that a prior fix made honest, which an e2e assertion pins.

**Why not re-key it onto every booking.** Overriding a *confirmed* booking is a different feature from graduating a placeholder. It needs per-leg targeting — the apply function overlays the first leg only, and the outbound has three — and a user-typed flight number silently kills the live-status rail, whose carrier map is deliberately bounded to this pack's four fictional airlines. That is a new slice with a new decision against D-034's never-faked rule, not a four-line unguard.

**Migration cost is zero, and provably so.** `origin/main` at v6.0.3 contains none of these files, so no shipped build has ever written the storage key and it cannot exist on any device. An absent backup domain is omitted from the envelope without a version bump.

**One consequence worth recording.** `print-itinerary.tsx` claims in a comment that it reads the same static booking data `/flights` does, with no second source. That became false when the override layer landed and is true again by deletion — the paper sheet and the Travel Mode flight row read the static data raw, so any future override feature must bring all three read paths into scope from the start.

**Changes if:** a custom trip ever gets a `/flights` surface — it is default-trip-gated today — at which point a mid-trip booking is a real requirement and deserves a real design, keyed on the leg rather than the journey, with the deep-link carrier map and the print and Travel Mode read paths in scope from the beginning.

**Standing lesson:** a brief that asserts the state of shipped data must cite the grep. This one cost a feature, a decision entry, and a wrong diagnosis before anyone checked eight records.
### D-446 · Amends D-201 · (issue #328, 2026-08-25) · Packing: an absent slot is not an empty one

**Decision.** The built-in template seeds a packing slot that was **never written**. A slot holding `[]` is a traveller who deleted every row, and it stays empty across reloads. `loadPacking` separates the two on raw key presence via the gateway's `hasKey`, never on list length. `savePacking` sanitizes with an empty fallback, so a write persists what the caller passed and nothing else.

**What was wrong.** `sanitizeItems` ends "if nothing survived, return the fallback", and `savePacking` called it without one — so the default full template applied. Emptying the list wrote all 28 rows back to disk while the UI showed an empty list. Add one item afterwards and 29 appeared, because the next commit re-reads storage.

**On a custom trip it was a content leak, not just a data bug.** `loadPacking` filtered the seed to universal items — that is the custom-trip fix — and `savePacking` did not. So emptying a custom trip's list injected the Nepal and Japan leg template into that trip's slot.

**This amends D-201's "no empty state".** That held while `toggleItem` was the only mutator, which made an empty list unreachable. Adding a remove control ended it, and the seeding rule was never revisited. The adapter's own claim that absent, corrupt and empty all resolve to the template is likewise no longer true, and both were corrected in place.

**Three states now, not two.** Absent seeds, trip-filtered, and SSR lands here because `hasKey` is false with no window. Present and non-empty sanitizes as before, so corrupt and non-array input still reseed exactly as they did. Present and `[]` stays empty. Both guards pull weight: the length check alone would work only because the seed happens never to be empty, which is an implicit invariant; `hasKey` states it.

**Empty sticks, but not bare.** A trash button whose effect silently reverses is worse than no trash button, and the UI and disk disagreeing is what produced the 29-item state. But emptying would otherwise be a dead end — the template is content the user cannot retype — so the empty state carries an explicit restore affordance that re-seeds through the same trip-filtered path a first load uses. That is the one thing here beyond the strict data fix.

**Sibling, filed separately as issue #335:** `saveDocs` has the identical shape, and the docs snapshot-apply path calls it directly rather than through the store's commit. Not reachable by hand — the docs checklist has no remove control — but the two domains sitting on opposite sides of the same rule is how this gets reintroduced.

**Changes if:** a domain gains a seed that can legitimately be empty, at which point the `hasKey` guard is the only thing still distinguishing the two states and the length check should come out.
### D-448 · (2026-08-30) · A `globals.css` recipe outranks a Tailwind utility, so the utility reads as live and renders nothing

**Decision.** The component recipes in `trip/app/globals.css` are two-class selectors — specificity (0,2,0). Tailwind 3.3.3 emits no native `@layer` here, so its utilities sit at (0,1,0) with nothing to lift them above the recipe. A single-class utility written against a recipe loses, always, and loses silently. The class is in the markup, it reads as live to anyone reviewing the JSX, and it renders nothing.

**Six live bugs shipped before the rule had a name**, each diagnosed on its own for a while, because the markup looked correct in every one:

- destructive confirms at 3.27:1 contrast;
- the `.plate` scrim at zero height;
- `aspect-auto` dead on home-chapters — a 966px band inside a 512px column, which is what produced sideways page scroll at desktop widths;
- `duration-[var(--duration-press)]` dropped by Tailwind across 5 components;
- `flex` inert on `calendar-sortable-item`, killing a documented 44px tap-target fix;
- `!text-ink-hi` rendering white-on-white in the print block.

**The sanctioned hatch is the recipe's own custom property, not a heavier selector.** `--lead`, `--cols`, `--plate-ar`/`--plate-split`, or a bare `!` where a single keyword really is the whole change. `[--lead:13px]` is one token, wins with no specificity fight, and leaves the next override exactly as easy as this one. Escalating the selector instead only moves the fight one round later.

**The print block must list the escaped-bang twins.** A `!` hatch emits `.\!text-ink-mid`, whose own `!important` outranks the print reset, so the print block spells those twins out alongside their plain forms. Miss one and that hatch silently opts out of the paper ramp — which is exactly how `!text-ink-hi` reached white-on-white.

**One regression test, on the case that fails invisibly.** `trip/lib/__tests__/plate-ramp-frame.test.ts` asserts the structural rule behind the scrim bug: a ramp must sit inside a `.frame` ancestor, because `.plate .frame` is the grid it spans and outside one there is no row to take a height from. Five call sites shipped that way and measured h=0 in Chromium against the compiled stylesheet. The other five bugs are visible the moment someone looks at the page; a zero-height scrim is not.

**Changes if:** the recipes move into a declared `@layer components` with utilities in a later layer. Layer order beats specificity outright, so a single-class utility would win by construction and the hatches stop being necessary. That is the real fix, and it is a whole-stylesheet change rather than a slice.
### D-449 · Extends D-448 · (2026-08-30) · `.plate`'s aspect ratio is an opt-in property, not a media-query breakpoint

**Decision.** `.plate` takes its shape from `--plate-ar` and `--plate-split` (named `--plate-rows` until D-494's sweep made the ramp stops track it) — defaulted in the recipe and opted into per surface by `.plate--band` and `.plate--wide`. A bare 700px breakpoint no longer decides whether a plate is landscape. The query survives only *inside* `.plate--wide`, tuning 16/10 to 21/9 for a surface that has already declared itself wide.

**Why the breakpoint could not be made correct.** A media query reads the viewport. It cannot see how many columns the plate sits in, and that is what actually decides whether the caption fits. In the inspiration grid the plate is 317-465px wide from 700 up, where 21/9 leaves the 58% caption row 79-94px to hold 138-160px of chip, title and blurb. The overflow goes upward out of the row — `.lay` is `justify-content: flex-end` — so title and blurb land on unscrimmed photograph, above the line the ramp guarantee says text may never cross, and at 1024 the country chip cleared the frame entirely. The breakpoint was not mistuned. It was structurally unable to be right, so retuning it would only have moved which call site was wrong.

**Portrait stays the default for the same reason landscape is opt-in.** The portrait frame holds wherever the plate is a grid cell, which is the only place the caption has to survive a narrow column. A surface that knows it has the width says so.

**It is D-448's hatch applied to shape.** A custom property on the recipe is how a call site overrides a two-class selector without a specificity fight, so the fix and the convention are the same thing.

**Changes if:** container queries land on this surface, at which point the plate could read its own column count directly and both the opt-in modifiers and the surviving 700px query become redundant.
### D-485 · (2026-08-30) · The service worker outlives `page.route`, so an assertion on a transient state must start before the navigation

**Decision.** Any e2e assertion on a state that exists only for a window — a loading skeleton, a placeholder, an in-flight spinner — starts its wait **before** the navigation, concurrently with it, and captures whatever it measures at the moment the wait latches rather than after. `await goto(...)` then `await expect(...)` is the wrong shape for this class of test, however long the timeout is.

**Chunk throttling stops applying the moment the service worker claims the page.** `out/sw.js` serves same-origin static GETs cache-first — `scripts/gen-sw.mjs:1233` routes them into `cacheFirst()` at `:1082`, which returns the Cache Storage hit and never calls `fetch`. Per-route lazy chunks that miss the precache are backfilled into it on their first successful online fetch (`:88`). A request answered from Cache Storage produces no network request, so Playwright's `page.route('**/_next/static/chunks/**')` never fires and the delay it was holding is silently not applied. The throttle is a first-visit-only device, and nothing goes red when it lapses.

**The helper's return is bound to that same event, and is unbounded against the window.** `gotoAsTraveler` waits on `navigator.serviceWorker.controller` (`trip/e2e/polish-bundle.spec.ts:28-33`), so it returns when the worker claims the page — measured 2.0-2.3s on a good run and 12.5s on a slow one, against a placeholder window that opens at hydration and closes roughly 1.3s later. Neither number is a property of the code under test. Waiting for the navigation to settle first means racing a variable against a fixed window and having no way to tell which won.

**Two specs in `trip/e2e/polish-bundle.spec.ts` were written the old way.** One flaked. The other passed on roughly 150ms of margin, which is a pass by luck, not by construction. Both now run their wait inside a `Promise.all` alongside the navigation, and the box measurement is chained off the wait rather than taken as a separate step afterwards.

**This is a shape the codebase invites.** `gotoAsTraveler` is copy-pasted into 12 spec files rather than shared, and 10 of those copies carry the controller wait. A third spec written the natural way — navigate, then assert — would flake identically, and would look correct in review.

**Changes if:** the SW registration is gated off under test, or `gotoAsTraveler` becomes one shared helper that resolves on something bounded by the page rather than by the worker. Either would decouple the helper's return from the throttle window and make the sequential shape safe again.
### D-486 · Amends D-277 section 6 · (2026-08-30) · The door reads the account name off the probe it already issues; "do not force a name lookup into the door" no longer governs

**Decision.** `probeAccountIdentity` returns `{ verdict, name }` off its single `getDocFromServer` of `trips/{code}/profile/identity`, and `handleLogin` adopts that name instead of hard-coding `stored || 'Traveler'`. The door gains no second read, no second timeout and no budget of its own: D-296's one 8s race now serves both #10's key validation and this.

**Why section 6's clause stopped governing.** It read *"forcing a name lookup into it violates D-239's LOCKED firebase-free clause"*. Five days later D-296 amended that clause to its real invariant — the door is **STATICALLY firebase-free only** — and put a dynamically-imported read of *this exact document* inside `handleLogin`. A name read of a document the door already reads cannot violate a rule that read lives under. D-277 section 2's write contract is untouched: this is a read, and it is awaited before `signIn`.

**What decided it is section 5, not the door.** Attribution there is immutable, and section 3 admits that an item created before the reconciler runs is stamped permanently. So the nudge-toast-plus-rename remedy repairs the name chip and leaves attribution wrong forever: everything the traveller creates in that window stays signed "Traveler", which section 5 itself calls a merged identity that may belong to several humans. The remedy fixed the label. The defect was in the data.

**The verdict still gates only a NEW key.** A key already stored on the device skips gating exactly as D-296 requires — a live session credential is never re-gated. On that stored-key path the read is issued for the name alone and every verdict admits, `'missing'` included, because a device that is already signed in must not be evicted by an answer about someone else's document.

**The cost, recorded rather than buried.** A returning device with no local name now waits up to 8s at the door where it previously admitted instantly. It still admits — the race is fail-open on that path in every branch — but the wait is real, it is new, and it is paid by precisely the person this fixes.

**Changes if:** a second account-level scalar moves into `profile/identity`, at which point section 1's clobber analysis has to be redone from scratch and this stops being a read of one field (D-277's own `Changes if` already names that trigger); or token-format discrimination (`user-`/`trip-` prefixes) lands, which would let the door answer before any network and changes what this read is for (D-296's trigger).

### D-487 · (2026-08-30) · A reorder under sync is a real HLC-stamping event; ordering stays derived from the hlc sort, and the residual is a whole-day republish

**Decision.** Reordering a day under sync re-stamps that day's live rows so their `hlc`s ascend in the new order (`reorderSyncStamps`, `core/sync/stamp.ts`). Ordering stays a **derived** property of `mergeItems`' hlc-ascending sort instead of becoming a field of its own. No schema change, no migration, and `merge-items.ts`, `merge-day.ts` and `hlc.ts` are untouched, so the four other synced domains are unaffected by construction.

**What it replaces was universal, 100%-reproducible data loss.** That sort runs at both sync boundaries, including a self-merge of a snapshot the device produced itself, so an order-only rewrite was reverted by the very next merge with no peer involved at all. Every drag under sync was silently discarded, on one device, every time.

**The residual, at its real scope — which is wider than it was first stated.** Re-stamping *every* live row republishes the whole day's local content over any peer edit this device has not yet received, not just the rows that moved. The realistic worst case is offline: go offline, drag one card, come back, and the entire day's stale local content beats everything a peer did meanwhile. Stated at full width here, because the narrower version of this sentence is what made the trade look cheap.

**Why the trade was accepted anyway.** The defect is universal and deterministic; the residual needs genuine concurrency that the local store has not yet absorbed. Trading a loss that happens to everyone every time for one that happens to two people editing the same day across a sync gap is worth taking, and worth taking now rather than behind the design that removes it.

**Two facts about the stamp, corrected here because both were stated too strongly.** (1) The new stamp is **not** strictly greater than every input stamp. Each row advances from `max(its own hlc, the previous row's new hlc)`, so the result ascends across the array and beats that row's own prior stamp — it is not lifted above some other row's input. (2) Two devices reordering the same day inside one millisecond do converge, but they may converge on an order that is **neither** device's: the merge resolves each row independently, so the array they ascend into can be an interleaving neither traveller performed. Convergence is the guarantee. Agreeing with either drag is not.

**Upgrade path, named:** a separate order register — fractional indexing or LSEQ — which makes position a value that merges rather than a consequence of time, and takes the whole-day republish with it. Not built now because it changes merge algebra shared by four domains, so its blast radius is every synced surface rather than one gesture.

**Changes if:** the residual is actually reported — an offline reorder seen clobbering a peer's day — or a second domain needs user-controlled ordering, at which point the order register stops being one gesture's cost and starts being shared.

### D-488 · Extends D-448 · (2026-08-30) · Tailwind's `@layer` here is a build-time directive, so an unlayered rule does not outrank a layered one; the focus ring lost on source order

**Decision.** Any recipe rule that must beat a Tailwind utility needs specificity **above (0,2,0)**. At (0,2,0) the two tie, source order decides, and utilities are emitted last.

**The premise that was wrong, and it was written down.** A comment in `globals.css` stated that an unlayered rule beats every layered one regardless of specificity. That is true of native cascade layers. It is false here, because there are no cascade layers in the output at all: Tailwind's `@layer` is a build-time directive telling the compiler where to place a rule, and **zero `@layer` at-rules reach the built stylesheet**. Nothing is layered, so nothing is outranked by being unlayered. This is why nobody expected a utility to beat the `.btn` recipe — the file's own explanation said it could not.

**Measured on the shipped stylesheet, not argued.** `.btn:focus-visible` sits at byte 75736; `.focus-visible\:outline-none:focus-visible` sits at byte 83754. Equal specificity, (0,2,0) each. The later one wins, so a button carrying that utility rendered with no focus ring while the recipe meant to guarantee one read as live in both the CSS and the JSX.

**It is D-448 read from the other side.** D-448 measured the recipe beating a single-class utility at (0,1,0) and concluded the utility loses silently. Same emission order, same absent layers; the only difference is that a `:focus-visible` utility carries a pseudo-class and so ties instead of losing. Both directions are decided by where Tailwind writes the rule, which is the one thing the markup does not show.

**Changes if:** the recipes move into a declared `@layer components` with utilities in a later layer — D-448's own named fix. Layer order beats specificity outright, so this rule inverts rather than relaxes, and every hatch written against it needs re-reading.

### D-489 · (2026-08-30) · Two render rules: a programmatically-opened dialog owns its close focus, and a client-only decision is never read on a prerendered route's first render

**Part 1 — no `Trigger` means no `triggerRef`, and Radix drops focus to `<body>`.** Radix restores focus on close to the trigger that opened the dialog. A dialog opened from state has no trigger, so that ref is null and a keyboard user is returned to the top of the document instead of to the control they pressed. **Rule: any Radix dialog opened programmatically supplies `onCloseAutoFocus`**, preventing the default and focusing the originating control itself. `components/backup-restore.tsx`'s restore confirm now does; `components/command-palette.tsx` already did, and its comment is the pattern to copy.

**Part 2 — the first render answers with what the export contains.** A client-only decision read during the first render of anything reachable from a prerendered route is a hydration mismatch, and React recovers by re-rendering the whole route on the client. `entranceFor()` reads `matchMedia` and a sessionStorage ledger, neither of which exists during the export; `/passport/` is a Server Component whose `<Reveal>` really is in the shipped HTML, so it mismatched on every reload and on every reduced-motion first load. The shape is a **pair**: `prerenderEntranceFor` — pathname-only, so it cannot disagree with the export — answers the first render, and an effect installs the live decision. Plus a **drift ratchet**: `lib/__tests__/motion-budget.test.ts` asserts the two agree under prerender conditions for every tiered surface, so a new input added to the live decision without a prerender counterpart fails a test instead of shipping a mismatch.

**The trap that makes the naive fix wrong, and it is D-246 recurring.** framer reads `initial` once at mount and re-reads an `animate` target whenever it changes. Deferring the decision without moving the resting target leaves an off-screen reveal at the fade floor forever — `whileInView` never fires for content below the fold, so nothing ever arrives to lift it. That is the exact state D-246 measured axe scanning: a floored masthead resting at the floor indefinitely, which is why the floor has to be AA-safe on its own. The deferral therefore has to change what the element rests at, not only when the decision is read. Cite `FADE_FLOOR`, never a number copied out of a decision entry.

**Changes if:** a second prerendered route reaches a client-only decision — the pair generalises but the ratchet's surface list does not, so the list has to grow with it — or Radix ships a close-focus fallback for triggerless dialogs, which would retire part 1.

### D-490 · (2026-08-31) · A meta line names its destination in words; it never prints the route, and a line that would only repeat the row's title is dropped

The v7.0.0 type pull-back removed `font-family: var(--font-machine)`, `text-transform: uppercase` and the tracking from `.list .mt`. Every recipe that lost them was carrying label text, which survives the change. Two call sites were not: the command palette and `/more/` both printed `href.replace(/\//g, '')` — a raw slug — and relied entirely on the uppercase machine face to make it read as machine annotation rather than prose. In the new type, `checklist` under **Documents** is indistinguishable from a lowercase typo of the title.

**Decision.** A meta line renders a human name resolved from `NAV_ITEMS`, never a route string. `routeLabel()` lives in `lib/nav-items.ts` because that is where the catalog it reads lives; the palette was the wrong home for it, and `/more/` could not reach it there without a component-to-component import.

**The fallback is load-bearing, not defensive.** `/nepal/` and `/japan/` left `NAV_ITEMS` when `/guides/` replaced them, but both are still palette destinations. The segment-titlecasing fallback is what keeps those two rows named, and it is pinned by test rather than left to be rediscovered.

**Suppression over repetition.** Where the resolved name equals the row's own title — 14 of the palette's 20 rows — the line is not rendered. `/more/` drops it on all 11, because every row there is a `NAV_ITEMS` entry by construction and the suppression would fire every time; a branch that cannot produce output is not worth keeping. The palette's rows are mixed height by design.

**What it cost, recorded rather than absorbed.** Three command-palette baselines moved for a change made in a round scoped to a different surface, and `/more/`'s rows now sit at exactly the 44px D-350 floor with no headroom, having lost their second line.

**Why nothing caught it.** No baseline covers `/more/`, and no spec asserted either surface's meta text — the palette was caught only because a baseline happened to include it. The unit test added here pins `routeLabel` and cannot see `/more/`, which no longer calls it. That gap is filed, not closed by this entry.

**Changes if:** a surface needs the route itself visible — a debug or developer view — in which case it prints the route deliberately in a machine face, and this rule is scoped to navigation surfaces rather than relaxed.

### D-491 · (2026-08-31) · The install-to-Home hint is signed-in-only, because a `duration: Infinity` toast is the one piece of chrome that never clears on scroll

`components/ui/sonner.tsx` sets the Toaster `position: fixed`. Every other overlay in the app either scrolls away with the document or dismisses itself on a timer; a `duration: Infinity` toast does neither. `TokenGate` is also pathname-free, so an always-on toast is not a `/`-only concern — it lands on the front door on every route a signed-out visitor can reach.

Measured at 375x667 on the shipped v7.0.0 front door, the install hint covered 100% of "Create an account", 67% of "I have a key — log in" and 48% of "Someone shared a trip with me" (#352). That is all three of the wall's CTAs, on the one screen whose job is a three-second decision.

**Decision.** The hint gates on `getActiveTraveler()` — the same "gate passed" read `first-run-tour.tsx` already uses — in addition to the existing standalone and dismissal checks. Offsetting the toast was rejected: it tunes one viewport and leaves the next one to be discovered.

The feature is not lost. Every sign-in path in `token-gate.tsx` ends in a full reload, so a traveler who signs in gets the hint on the very next mount, and a signed-out visitor no longer burns the once-ever dismissal flag without ever having seen it.

**Generalizes to:** any future `duration: Infinity` toast. It is app-wide chrome that cannot be scrolled out of the way, so it needs a reason to exist on the signed-out wall before it is allowed there.

### D-492 · (2026-08-31) · `calc(var(--tab-bar-h) + env(safe-area-inset-bottom) + gap)` is a `position: fixed` idiom and does nothing for flow content

This calc appears in `quick-add-fab.tsx`, `presence-bar.tsx`, `travel-arrival-toast.tsx` and `ui/sonner.tsx`, and in all four the element is `position: fixed` — the calc is its `bottom`, lifting it above the tab bar. Applied to normal flow content it only adds padding underneath, leaving the content exactly where it was.

The document-level version of the same reservation already exists once, at `app/layout.tsx:191`: `#main` carries `pb-[calc(var(--tab-bar-h,64px)+env(safe-area-inset-bottom))]`. That is what guarantees the END of a page clears the bar, and it is why obstruction count at maximum scroll measures 0 on every route.

**What this rules out.** #353 and #355 were both scoped as "add bottom clearance". Neither can be fixed that way: they are flow content that happens to occupy the 65px band under the fixed tab bar at first paint, and it clears as soon as the user scrolls. Three spacing candidates were measured on `/map/` and each one merely moved the obstruction to a different control, because on a content-dense page that band always contains something.

**The fixes that do work are of a different kind:** suppress the floating element on routes where its action is not primary (`/trips/` and `/packing/` joined `/travel` and `/plan` for the quick-add FAB), or change what the page leads with. Spacing is not one of them.

**Also recorded so it is not re-measured:** when auditing this class, exclude elements inside `details:not([open])`. Collapsed disclosure content reports a real `getBoundingClientRect()` and fails a Playwright `click()` with a timeout, which reads exactly like an unreachable control and is not one. Four findings on `/plan/`, `/settings/`, `/more/` and `/guides/` were withdrawn for this reason.

### D-493 · (2026-09-01) · `region` is not an allowed role on `<header>`; `group` is

axe-core's `html-elms` table gives `header` exactly `['group', 'none', 'presentation', 'doc-footnote']`. Setting `role="region"` on one trades a serious `scrollable-region-focusable` violation for a minor `aria-allowed-role` violation — measured, not reasoned:

```
header + role="group"   axe: none
header + role="region"  axe: aria-allowed-role (minor)
header + no role        axe: scrollable-region-focusable (serious)
```

**Decision.** A `<header>` that is an overflow scroller takes `tabIndex={0}` + `role="group"` + `aria-label`. The `role="region"` used by the scrollers in `travel-safety-kit.tsx` and `budget-panel.tsx` is correct there only because those are `<div>`s — the two idioms are not interchangeable, and reaching for the div recipe on a `<header>` is how the minor violation gets introduced.

Checked and not a cost: axe resolves `header`'s implicit role as `banner` only when it is outside sectioning content. Both running heads sit inside `<main>`, so their implicit role was already `generic` and the override destroys no landmark.

**Why it was not caught earlier:** `.head` overflows only in a narrow band around 440-510px. `e2e/a11y-full-audit.spec.ts` scanned `/flights/` at desktop width, where it fits, so the serious violation lived between the two widths the suite measured. That is why the pack now carries explicit 480px entries for `/flights/` and `/plan/`.

### D-494 · Amends D-487 · (issues #367 and #368, 2026-09-01) · The conflict key and the day-order key are separate fields: `hlc` decides which copy of a row wins, `ord` decides where the row sits

**Decision.** `hlc` stays the last-writer CONFLICT key and nothing else. Ordering becomes its own optional field, `ord`, and `mergeItems` sorts a day by `ord ?? hlc` ascending — so a row that has been neither edited nor dragged since the split sorts exactly where its `hlc` alone used to put it. D-487's *"ordering stays derived from the hlc sort"* no longer governs, and neither does the whole-day republish it recorded as the price.

**Three changes, and they only hold together.** (1) `stampSyncUpdated` freezes `ord = item.ord ?? item.hlc` before it advances the conflict key, so an edit — which must become the day maximum to win its own resolve — no longer drops its row to the bottom. (2) `reorderSyncStamps` writes `ord` and leaves `rev`/`hlc` alone, so a drag ships one field that no content edit reads and can no longer carry the dragging device's whole local body over a peer edit it has not received. (3) `resolvePair` joins `ord` as a max over the two rows' `ord` FIELDS, independently of the body winner. Comparing the effective `ord ?? hlc` key there instead would turn a peer's fresh EDIT stamp into a position and make the row jump, which is the exact coupling the split exists to break — and the independence is what lets a new position land on a body the peer wins.

**Additive-optional, so there is no migration.** `ord` is declared `z.string().optional()` beside `hlc` on the item schema; `.passthrough()` already tolerated it on read, so declaring it only makes the accepted surface explicit. `CURRENT_ITINERARY_VERSION` STAYS 5 and the `schemaVersion` assertions remain `toBe(5)`. With neither side of a collision carrying `ord`, `resolvePair` returns the winner object itself, so every merge over pre-split data is byte-identical to before.

**The transitional cost, recorded because it is the part that is not visible from the code later.** Until every device runs this build the split is asymmetric. An old client's reorder bumps `hlc` and writes no `ord`; a new client merging that row keeps its own `ord`, because there is no `ord` on the other side for the max to prefer, and the sort answers on `ord` — so **an old client's drag is invisible to a new client for any row that already carries `ord`**. Rows carrying no `ord` on either side still follow it, which is why a day untouched since the split reorders correctly across builds and a day edited once does not.

**The reverse direction is worse, and a new client must not try to repair it.** An old client's reorder still re-stamps `hlc` on every live row in the day, so it still republishes that device's whole local copy of the day over any peer edit it has not received — D-487's residual, still live wherever an old build is. A new client resolves such a row honestly: the incoming `hlc` really is higher, so it really does win the body. Nothing in the received row distinguishes "reordered" from "edited", and a heuristic that declined a legitimately-higher `hlc` would drop real edits to save hypothetical ones. The window closes when the last old device updates, and nothing else closes it.

**Changes if:** a second domain needs user-controlled ordering, at which point `ord` stops being one gesture's field and the freeze in `stampSyncUpdated` — deliberately not pushed down into `nextSyncStamp`, which expenses, docs, places and the budget flattener share — has to move with it. D-487's named upgrade path is unchanged and still open: this makes position a separate field, not yet a value that merges.

### D-495 · Amends D-489 Part 2 · (issue #370, 2026-09-01) · No entrance component is prerendered, so the entrance decision is read at render time

**Decision.** `<Reveal>` asks `entranceFor()` during render. The deferral Part 2 installed — first render answers `prerenderEntranceFor`, an effect then installs the live decision — is removed. `prerenderEntranceFor` is KEPT, called by nothing in the app, as the tripwire for the day its premise becomes true.

**The premise was measurably false.** Part 2 held that *"a client-only decision is never read on a prerendered route's first render"*, on the strength of `/passport/` being a Server Component whose `<Reveal>` "really is in the shipped HTML". It is not. `app/layout.tsx` puts `{children}` inside `<ItineraryProvider>`, which renders `{mounted && traveler ? children : null}` (`components/itinerary-provider.tsx:442`), so nothing routed reaches the export at all: **0 of the 22 HTML files in `out/` contain a `data-entrance` attribute.** Server Component or not, the markup is gated behind a mount and an identified traveler, and `/passport/`'s reveal is client-first like every other one. There was no mismatch to fix.

**What the deferral cost, and who paid it.** framer reads `initial` once at mount, so a decision arriving in a post-paint effect arrives after the only read that matters. Every Tier-1 and Tier-2 masthead painted at `y: 20` and the floored opacity before correcting itself — including for the reduced-motion visitor and the returning visitor whose `'present'` fork exists precisely to spare them that. The fork was still correct; it was late, and on this path late is the same as absent for the frame that matters. It also dragged in the D-246 hazard Part 2 names itself — a deferral has to move what the element RESTS at, not only when the decision is read, or an off-screen reveal sits at `FADE_FLOOR` forever. Reading at render time is what makes `initial` right at mount and takes that whole clause with it.

**The tripwire is the part worth keeping.** `lib/__tests__/motion-budget.test.ts` still asserts `entranceFor === prerenderEntranceFor` under prerender conditions — no `matchMedia`, empty ledger — for every tiered surface, and still pins the pathname-only property. Nothing calls `prerenderEntranceFor` in the app, so the pin measures the gap rather than a live path. If a reveal ever does reach the exported HTML, the two answers have to be reconciled BEFORE paint: the answer then is `useLayoutEffect`, never a state-deferred correction, which is what this entry removes.

**Changes if:** the provider gate stops holding — a route rendered outside `<ItineraryProvider>`, or the gate relaxed so an unidentified visitor gets routed markup — at which point the export really does contain `data-entrance`, the file count above is the check to re-run, and Part 2 returns in its `useLayoutEffect` form.

### D-496 · LOCKED (amends D-096) · (issue #411, 2026-08-18) · The quarantine slot preserves a capped leading slice plus the original length, not the raw string verbatim

D-096 rules that a rejected import is preserved **verbatim**. That is amended here: the slot now stores at most `QUARANTINE_MAX_CHARS` (4096) of the original, and when it truncates it appends the original character count.

**Why.** The slot exists so a human can see *why* a file was rejected, and that is visible in the first few KB — a version marker, a wrong top-level key, a truncated brace. Verbatim made it an archive instead. A whole-trip backup that lost its `domains` key carries every embedded base64 photo, so a mid-size file that fits could hold most of the ~5 MB localStorage budget indefinitely. The worst case only self-limited because a file too big to store threw a quota error into a swallowing catch — luck, not design.

The original length is kept because it is diagnostic in its own right: it is how a truncated 2 KB file is told apart from a 4 MB photo backup that lost its envelope.

**What D-096 keeps.** Don't-clobber-first-capture is unchanged (an existing slot is the original failure and is never overwritten), the preserve attempt still never throws, and preserve-before-fallback ordering is untouched — so D-031 non-destructiveness still holds.

**Also changed:** the write goes through the gateway's `writeString` rather than a raw `localStorage.setItem`. That is what raises `trip:quota-exceeded` (D-097 makes the gateway the only place raw web storage is touched), so a quarantine write that fails on quota is no longer completely silent.

**Separately, the read side:** `decompressBlobOrText` now rejects a file over `MAX_IMPORT_BYTES` (64 MB) before reading it into memory. Stored photos are downscaled to a 1600px long edge at JPEG q0.8, so ~200–400 KB each and ~33% more as base64 — 64 MB still admits well over a hundred photos. It is a memory guard, not a policy on backup contents. A gzip file is measured compressed, so a crafted archive can still expand past it; the cap bounds the read, not the expansion.

**Changes if:** a recovery UI is built that consumes the quarantine key (it would need the full bytes, which this no longer stores — that is the trade, and D-096's own "changes if" already anticipated a consumer), or a real backup ever trips the 64 MB cap.

### D-503 · Implements D-314 residual (2) · (issue #401, 2026-09-22) · "Forget this device" clears the three lifetime-scoped keys; `wipeAllTripData()` still does not

**Decision.** The `forgetDevice` branch of `components/sign-out-confirm.tsx` removes `lifetimeVisits`, `visitConfirmations` and `passportStamps` after `defaultBlobStore.clear()` and before `signOut()`. `core/storage/gateway.ts` is untouched: the keys stay out of `TRIP_SCOPED_SLOTS` and `wipeAllTripData()`, so plain sign-out and a trip clear leave the lifetime record where they always did. D-314 residual (2) named this path as the one clearing surface that does not reopen D-314, and D-320 retired the "nothing writes the key yet" clause that had kept it moot.

**Copy moved with the behaviour.** The dialog and the Settings row both say the travel history goes too, and the dialog says it is kept only on this device, so unlike the plan and photos it cannot come back from a sync.

**Coverage.** `components/__tests__/sign-out-confirm.test.tsx` asserts forget-device leaves all three keys absent and plain sign-out leaves them intact.

**Changes if:** the lifetime record gains a remote copy; clearing the local keys would then be a detach, not a deletion, and the copy would have to say so.

### D-504 · Amends D-239's never-mix clause for the join direction · (issue #393, 2026-09-22) · The account key is refused at `joinTrip`

**Decision.** `core/trips/registry.ts::joinTrip` returns `false` and writes nothing when the token names this device's own account key (`isOwnAccountToken`: the PARSED id, so a `pack:` prefix cannot carry it past, compared trimmed and case-folded against `getSyncCode()`). The boolean contract from D-546 is kept rather than widened to a reason object: callers that speak (`trips-hub` and `settings-panel` join forms) ask `isOwnAccountToken` which refusal it was and render `OWN_ACCOUNT_TOKEN_COPY`; `trip-join-handshake` checks up front and draws the refusal instead of a confirm whose only outcome would have been the storage-failure sentence. `token-gate` already falls through to `/trips/` on `false`. The two switch surfaces that pass registry ids (`trips-hub` row, `home-trip-strip` chip) no longer navigate when the pointer did not move.

**Why it matters.** A registry row's id is that trip's capability token: it gets a copy control, a `?trip=` link and a push to the account's trip list. Joined as `pack:<key>` it would become the default pack's share id and be printed in every share link. The account key must never enter either.

**Residual.** A row a pre-fix device already created, or one arriving through the account trip-list merge, is not swept. It is inert (every switch refuses it) but still listed.
### D-505 · Extends the CONCIERGE-5 delimiter strip · (2026-09-04) · Every field the digest interpolates goes through `oneLine`, and a source-level guard makes that true for the next field too

**Decision.** `buildTripDigest`'s item line is now `` `${time}${oneLine(i.category)} ${oneLine(i.title)} #${oneLine(i.id)}` ``, and the header's `Day N of M, <city>` stamp wraps `today.city`. CONCIERGE-5 wrapped `title` and `city` only. `lib/__tests__/concierge-digest-sanitize.test.ts` adds one behavioural case per field plus a structural check that parses the module and fails when a template interpolation reading the stored plan is not a `oneLine(...)` call.

**Why the two unwrapped item fields were the same class as the one that was wrapped.** `category` and `id` are `z.string()` at the read boundary, with an explicit *"permissive on read — NOT z.enum"* note, and they ride the same peer-writable `days/{date}.items` array CONCIERGE-5 was written for. The digest is a line-oriented format (`date city: item; item`), so a `\n` or `;` in any interpolated field forges a row the model cannot distinguish from a real one. `#id` is the sharper of the two: that token is what the model addresses back in an `ops[]` entry, so a forged id steers the label on a Confirm chip. The write path itself is sound — `validateOps` re-resolves every id against the live plans — but the chip TEXT the traveller reads is derived from model output shaped by the forged context.

**`today.city` was not part of the original CONCIERGE-5 fix and is the same field by another route.** For a custom trip it resolves through `legForDate(...).fallbackCity`, which is `config.destinations[0]` off the trip's meta doc — `sanitizeTripConfig` trims the ends and keeps everything in the middle. It is wrapped here because the structural guard would otherwise have needed an exemption for it, and an exemption is how this defect survived the first fix.

**The structural guard is the part worth keeping.** Behavioural cases cover the fields that exist; they cannot cover the one someone adds next year. The guard walks the real AST of `buildTripDigest`, roots each template interpolation at the identifier it reads, and requires a `oneLine(...)` wrapper for anything rooted in the plan load (`plans`/`byDate`/`day`/`items`/`i`/`city`). Verified by removing a wrap and adding an unwrapped `${i.location}`: it named both. `entries` is the single exemption and is asserted by name — it is the join of item strings each of which was already wrapped, so wrapping it again would be redundant, and leaving the exemption implicit is what would rot.

**Changes if:** the read boundary is ever narrowed to `z.enum` for `category` (then that one wrap is belt-and-braces, not load-bearing, and the guard should keep it anyway); or the digest stops being line-oriented, which would change what "delimiter" means and invalidate the `[\r\n;]` set rather than this rule.

### D-506 · (2026-09-04) · The trip label is bounded in structure at the descriptor, which is the last client-side point before the wire

**Decision.** `buildTripDescriptor` returns `oneLine(trip.label).slice(0, TRIP_LABEL_MAX)`. The strip runs BEFORE the slice, so the 120-char bound still holds exactly and the existing truncation assertion is unchanged.

**Length was bounded; structure was not.** `slice(0, TRIP_LABEL_MAX)` was doing one job — keeping the worst-case request body computable against the Worker's 16 KB `MAX_BODY_BYTES`, which is measured on the raw body before any parse. It says nothing about what is inside those 120 characters. The label is remote-sourced: `itinerary-provider.tsx` adopts `remote.name` from the trip's meta doc, which any member of the trip writes, `trips-remote.ts` validates only that it is a non-empty string and returns it untrimmed, and `renameKnownTrip` applies `.trim()`, which keeps interior newlines. `readIdentityName`, on the same file's other read, both trims and caps — the contrast is what makes this an omission rather than a deliberate looseness.

**Fixed at the descriptor rather than at either source.** Two upstream places could have taken it (`trips-remote.ts`'s validator, `itinerary-provider.tsx`'s adoption), and both would leave a label already on disk unsanitised. The descriptor is the last client-side boundary before the request body, so it covers every path the label can arrive by, including one restored from a backup.

**What is verified and what is not.** The client half is verified end to end: no `\r`, `\n` or `;` leaves the browser in the `trip.label` field, pinned in `lib/__tests__/concierge-digest-sanitize.test.ts`. Whether an unstripped label reached a line-oriented region of the system prompt depends on the Worker's `normalizeTrip`, which is not in this repo and was not read. This entry does not claim it did.

**Changes if:** the Worker begins accepting a structured trip descriptor whose label is not folded into prose, at which point the strip is inert but harmless; or `trips-remote.ts` grows a real validator for `name`, which would make this the second of two and worth reconciling into one.

### D-517 · Extends D-098 (LOCKED) · (2026-09-04) · A restore may only report what it actually restored: the expense envelope is matched for EQUALITY and an empty payload is refused; the whole-trip restore builds its message from `restored`

**Decision.** `parseExpenseBackup` requires `schemaVersion === EXPENSE_EXPORT_VERSION` rather than merely `typeof === 'number'`, and refuses a `payload` of length 0. `importTripBackup` (`lib/trip-backup.ts`) refuses BEFORE Phase B's writes — `ok:false`, nothing touched — whenever nothing in the envelope survived validation (`domainWrites.length === 0 && itinPlans === null && metas.length === 0`); `components/backup-restore.tsx` builds its success sentence from the `restored` array on the `ok:true` path, which can no longer be empty.

**Two vacuous gates, same shape.** The expense envelope check accepted any numeric version, so the itinerary export (`schemaVersion: 5`), which sits in the same Downloads folder and is offered by the same file picker, cleared it. The all-or-nothing row guard `expenses.length !== payload.length` then caught it only because it had rows — `0 !== 0` is false, so an EMPTY array sailed through both, and `restoreExpenses([])` tombstones every live row under sync, propagates that deletion to every device, and the dialog says "Expenses imported." On the whole-trip side, `importTripBackup` correctly drops any domain failing `spec.validate` and names the survivors in `restored`, but `restored` had zero production consumers: the UI read only `photosSkipped` and printed a fixed "itinerary, journal, photos and more are back" whether it restored eleven domains or none.

**Restoring nothing is not a null outcome, it is a deletion.** That is the whole reason an empty payload is refused rather than accepted as a no-op: the caller applies the parse result as a tombstone-replace, so "zero rows" is the instruction to delete everything. This is the same reasoning D-364 already recorded for the itinerary side ("an array of pure garbage validates as `[]` and `savePlans([])` wipes the trip"), applied to the boundary that did not have it.

**Two pinned tests were pinning the hole, and both were rewritten rather than deleted.** `expense-export.test.ts` asserted that `exportExpenses([])` round-trips to `ok:true` with `[]`, and that a higher `schemaVersion` "is still read leniently (forward-compat)". Neither is forward-compatible in practice: `sanitizeExpense` rebuilds each row field-by-field and strips keys it does not know (the asymmetry D-365 already flagged), so a v2 file read by a v1 build propagates the STRIPPED rows back to the newer devices that wrote them. A version this build cannot claim to understand is refused with the bytes quarantined, until a migration step exists to actually understand it. The export half is unchanged — an empty file still exports.

**The container version is now read too.** `isTripBackup` checks `format` and `domains` and ignores `TripBackup.version`, so a v2 container was restored as if it were a v1 one — `DOMAINS` has no spec for a slot it does not know, so the commit loop never visits it and the domain vanished into the success string. `importTripBackup` refuses `env.version > BACKUP_VERSION` in Phase A, before any write. It is checked BEFORE the `tripId` guard on purpose: a format this build cannot claim to understand is not one whose fields it should be reading, and "wrong trip" would be a wrong diagnosis of a version problem. The gate stays inside `isTripBackup`'s TRUE branch rather than inside the guard itself — a `false` there would route the file into the legacy itinerary-only branch and surface "not a recognized trip export", which is the corrupt-file message.

**The copy says NEWER, not corrupt, and that is a deliberate distinction.** They send the user hunting two different things and only one of them exists; a corruption reading starts a search for a fault that is not there. Zero writes have happened at that point, so this branch can and does promise that no changes were made — the same promise the "nothing survived validation" refusal below now makes, for the same reason.

**Its neighbour gate points the opposite way, and that asymmetry is correct.** `parseBackup` (`core/vault/export-import.ts`) accepts a nested itinerary `schemaVersion` GREATER than current *leniently*, validating the payload as-is without migrating it. That is not in conflict with refusing a newer CONTAINER: a forward itinerary envelope still has a known payload shape that `parseItineraryPayloadStrict` validates in full, so leniency there costs nothing, while a forward container has an unknown set of `domains` keys and no validator over the container as a whole — unknown slots are simply never visited, which is the silent drop this entry exists to stop. Validate-what-you-can is lenient; cannot-validate-at-all is refused. Recorded because the two gates sit a file apart and a future reader could "reconcile" them in either direction and be wrong.

**Both halves are pinned by a real run, not by reading.** The expense gate is covered in `expense-export.test.ts` (empty payload refused and quarantined; every version that is not exactly `EXPENSE_EXPORT_VERSION` refused; the current one still imports). The UI half is covered in `components/__tests__/backup-restore-dialog.test.tsx`, which drives the real component through the real confirm dialog with `importTripBackup` returning each shape: an `ok:false` refusal (the shape `importTripBackup` now returns when nothing survived validation) must render the error line with `role="alert"` and must NOT reload, and a partial restore must name only the domains it got back.

**The `restored: []` failure branch was itself found to be reached AFTER a destructive write, and is now checked before any write.** `importTripBackup` calls `savePhotos(metas)` whenever the envelope has an array-shaped `photos.meta`, but only pushes `'photos'` to `restored` when that array is non-empty — so a backup carrying `photos: { meta: [] }` and nothing else valid reached Phase B, ran `savePhotos([])`, wiped the live photo index and every blob orphaned by it, and only THEN reported `restored: []`, which the UI read as "nothing changed." The check is now made at the end of Phase A, on the same three facts Phase B would otherwise commit (`domainWrites`, `itinPlans`, `metas`), before any of Phase B runs — so the case that used to slip through is refused with zero writes, not reported after the fact. An explicit empty array alongside OTHER real domain data is unaffected and still tombstone-replaces that one domain (matching every other domain's `[]`-means-delete-everything semantics); it is only refused when it is the ONLY content the backup carries. Pinned in `lib/__tests__/trip-backup.test.ts` (`photos.meta: []` alone refuses and never touches the live index or blobs) and in the three pre-existing never-destroy tests this correction also had to update, since two of them had pinned the pre-write reach of this exact bug as "the guard is not overbroad."

**Changes if:** an expenses v2 ships (add the migration step and widen the gate to the versions it can migrate, never back to "any number").

### D-518 · Completes D-357/A-22 · Enforces D-075 (LOCKED) · (2026-09-04) · Both `/recap/` surfaces read the app's one clock

**Decision.** `components/trip-story-recap.tsx` and `components/wrapped-story.tsx` each delete a private `nowDateString()` and read `getNowAtTrip().date`, the destination-offset trip day `trip-recap.tsx` already uses.

**The recap divergence is Home versus `/recap/`, not within `/recap/`.** `app/recap/page.tsx` renders only `RecapHeader`, `TripStoryRecap` and `WrappedStory`; `TripRecap` is a Home island. The two `/recap/` surfaces shared the same private helper and so always agreed with each other while disagreeing with Home. `core/recap/` reads no clock at all — it is pure and takes `nowDateStr` from its caller — so the component was the sole injector and fixing it fixes the whole subtree. It bites on a device left on home time, where the two dates differ for most of the day rather than at a midnight edge.

**The decision log had already been corrected, and this is the half it was waiting on.** D-357/A-22 carries a correction dated 2026-09-04 stating that the surfaces originally named as already reading `getNowAtTrip()` did not, and that "the claim becomes true of `trip-story-recap.tsx` once its own `nowDateString()` is replaced the same way A-22 replaced `trip-recap.tsx`'s." That replacement is this entry. `wrapped-story.tsx`, which the correction does not name but which carried a copy of the same helper, is replaced with it — and because `core/recap/wrapped.ts` inherits `nowDateStr` from that component, the pure module's day is now the trip day too. No further edit to D-357 is needed.

**Changes if:** a surface genuinely needs the device's own calendar day rather than the trip's (none does today) — then it says so at the call site and is added to D-420's exclusion list, never by re-deriving a local helper.

### D-527 · Extends D-369 · (2026-09-04) · The dialog-open flag is a layer STACK, and a covered sheet takes its Escape listener down

**Decision.** `hooks/use-dialog-open-flag.ts`'s `useDialogOpenFlag` moves from a count to a stack of registration ids, and now returns `covered: boolean` — true while another layer is registered above the caller's. `components/ui/sheet-dark.tsx` ORs that into its own `disableEscape`, so the sheet's document-level Escape handler no-ops whenever anything is open over it — including a nested dialog (e.g. an expense/add-to-itinerary dialog opened from a place-detail sheet) that owns its `open` state privately and so cannot be wired through the existing `disableEscape` prop.

**One Escape press was closing two layers.** Both the sheet's and the dialog's Escape handlers sit on `document`; `preventDefault()` in the deeper (dialog) handler cannot stop the shallower (sheet) one from also firing on the same keydown. `disableEscape` only helps when the parent can pass it down, which it cannot for a dialog whose `open` state the sheet does not own.

**It has to be a stack, not a count, because ORDER is the second thing it answers.** A count can tell "something is open" but not "am I the topmost one" — and that is exactly what a covered layer needs to know to stand down. It only sees what registers: `first-run-tour.tsx` and `time-picker.tsx` are `aria-modal` and do not register here, so neither covers the layer beneath it; `disableEscape` remains the escape hatch for a layer like those.

**Pinned end to end**, real components, in `components/__tests__/nested-dialog-escape.test.tsx`: `PlaceDetailSheet` → `AddToPlanButton` → `AddToItineraryDialog`, one Escape press closes only the dialog, the sheet is still open, a second press closes the sheet.

**Changes if:** a future layer needs to suppress Escape for a reason OTHER than being covered (none does today) — that stays `disableEscape`, not this stack.

### D-528 · (2026-09-04) · The two hand-rolled dialogs keep their portal and their fill, and share their keyboard contract through `hooks/use-modal-keys.ts`

**Decision.** `expense-dialog.tsx` and `add-to-itinerary-dialog.tsx` each carried a character-identical copy of: the document-level Escape listener, the panel Tab-trap, and the `useDialogOpenFlag()` call. That triple is extracted into `hooks/use-modal-keys.ts`'s `useModalKeys(panelRef, onClose)`, which returns the `onKeyDown` the panel carries. Everything else about the two dialogs — their portal, their form fields, their focus-return contract — is untouched.

**Why extracted rather than left duplicated.** A fix landing on one copy and not the other is exactly how D-527's stack fix would have shipped on only one of the two dialogs if this had not been done first — the two files are edited by different features on different days, and nothing forced them to stay in sync.

**FOCUS is deliberately not part of this hook.** Which element opened the dialog and where focus returns on close is the parent's job (D-021): the field to autofocus differs per dialog, and a hook that captured/restored focus in its own effect is the exact shape D-021 was written to forbid. `hooks/use-modal-keys.ts`'s `FOCUSABLE` export is now the one copy of the Tab-trap's selector, reused directly by `components/__tests__/nested-dialog-escape.test.tsx`.

**`components/ui/sheet-dark.tsx` is not rewired onto this hook.** It owes the same two document-level duties, but it also owns presence (mount/unmount, portal) and its Escape is conditionally disabled by a prop the two dialogs don't have; folding it in is a separate pass, not this one.

**Changes if:** `sheet-dark.tsx` is ever unified onto this hook (then `disableEscape` becomes a param, not a prop the caller ORs itself); or a third hand-rolled dialog is added, which should reach for this hook from the start rather than copying a fourth time.

### D-529 · (2026-09-04) · `formatRelativeTime`'s minutes branch clamps to 1

**Decision.** `lib/relative-time.ts`'s sub-hour branch is `` `${Math.max(1, Math.floor(diffMs / MIN))}m ago` `` instead of a bare `Math.floor`. `lib/__tests__/relative-time.test.ts` is a new suite pinning every threshold (44999ms → "just now", 45s/59.999s/60s → "1m ago", the hour/day/week/month/year boundaries on each side) plus the future-timestamp clamp to "just now".

**The 45s "just now" cutoff is not a minute boundary, and the branch below it assumed it was.** 45–59999ms floors to `0m ago` under a bare `diffMs / MIN`, which is a lower number than the "just now" case immediately above it in the read-back — an item logged 50 seconds ago would have reported an older-sounding age than one logged 44 seconds ago once the wall clock ticked past 45s. Every other branch (hour/day/week/month/year) is entered by a cutoff exactly equal to its own unit, so none of them needs the same clamp.

**Changes if:** the "just now" cutoff is ever moved to something other than sub-45s-of-a-minute (60s), at which point the clamp in this branch becomes provably unreachable and can be dropped with a comment saying why.
### D-509 · Extends D-374 / D-403 to the budget domain · (2026-09-04) · `modelToFields` writes a stamped-null clear ONLY for a path this build can name

**Decision.** `modelToFields` (`core/budget/flatten.ts`) computes the closed path set this build can produce — the fixed scalars plus `LEGS` × `BUDGET_CATEGORIES` — and emits `{ v: null, hlc }` only for a stamped path inside it. A stamped path outside it is omitted from the field-doc entirely. The clear semantics for every path the budget UI can actually reach are unchanged.

**What it was doing.** `budgetDocToFields` already retains an unknown path, and its comment is accurate about itself; the inversion is two hops later. `fieldsToModel` stores that path's `hlc` unconditionally while `unflattenBudget` rebuilds a closed path set and drops the VALUE, and `modelToFields` had one rule for "stamped but not in the flatten": write a null. That null carried the PEER'S OWN stamp verbatim, so `mergeBudget` fell into the equal-HLC tie-break `valueFingerprint(a) >= valueFingerprint(b)` — and `"null"` sorts above every digit, `-`, and the `"` that opens every JSON string. The peer's `400000` was written back to Firestore as `null`.

**It did not self-heal, which is what makes it a deletion rather than a stale read.** Re-running the same tie from the newer peer's side gives `"400000" >= "null"` = false, so the null wins on that device's read *and* on its next push. Both devices end up without the leaf and nothing reports an error. Reproduced on a real run before the change: the four new cases in `budget-flatten.test.ts` fail with `expected { v: null } to deeply equal { v: 400000 }` in both argument orders.

**Not reachable between two devices on the same build,** because `LEGS` is a single leg for a custom trip and `BUDGET_CATEGORIES` is a compile-time tuple. It arms the moment a build adds a budget leaf while a peer is still on the old bundle — the lazily-updating-PWA window D-374 exists for.

**Why omission rather than round-tripping the value through the model.** The three sibling domains express forward-key retention as a `SanitizeOptions { keepUnknownKeys?: boolean }` flag on a field-by-field sanitizer (D-374, D-403). Budget has no sanitizer: its narrowing boundary is a closed dotted-PATH set, and `BudgetModel` is a typed struct with no slot to park an unnameable leaf in. So the flag shape does not transfer; the RULE does — a build must not erase what it cannot name. Omitting the path leaves `mergeBudget`'s union to carry the peer's entry through untouched on both the snapshot merge and the transactional push, which is the same end state retention buys the other three domains, with no new mechanism and no model change.

**This also makes D-339's "outbound sync is inert" claim true.** That entry argues a preserved unknown leg key is never emitted because `flattenBudget` iterates `LEGS` for both maps. That was only half the picture: the key was never emitted as a VALUE, but once a peer had stamped it, `modelToFields` emitted it as a null. It is genuinely inert now.

**Changes if:** budget grows a real per-field tombstone list, or `BudgetModel` gains a slot for undeclared leaves — either would let an unnameable path round-trip with its value instead of merely surviving on the server, which is the one thing this fix does not buy.

### D-516 · Extends D-363 (LOCKED) · (2026-09-04) · A coordinate out of WGS84 range degrades the FIELD, not the row; `itineraryItemSchema` moves to a leaf module so the two read boundaries stop being an import cycle

**Decision.** `lat`/`lng`/`tzOffsetMin` in `itineraryItemSchema` are range-gated: a finite number inside `[-90,90]` / `[-180,180]` / `[-720,840]` is kept verbatim, anything else parses to ABSENT. A wrong-TYPED value still fails the item exactly as before, so the change is confined to numbers that are numbers but cannot be places. The BOUNDS are the ones `sanitizeCityCoords` (`core/trips/registry.ts`) already applies at the trip-config coordinate boundary, and the two must stay numerically consistent. The schema now lives in a new leaf module `core/vault/item-schema.ts`, re-exported from `core/vault/schema.ts`; D-363's ONE-definition invariant is untouched and every existing importer keeps working.

**The comment it replaces was describing a guard that had been deleted.** The field carried `z.number().optional()` under a note saying the range check "lives once, in the ItemEditor UI, matching the startMinutes precedent". `calendar-planner.tsx` describes that check in the past tense — picking a coordinate off the map made the bad states unrepresentable, so the explicit validation went away and the note stayed. So there was no range check anywhere on any read path. Against the installed zod, `500`, `-500` and `Infinity` all parse and only `NaN` is rejected, and `JSON.parse('1e999')` is `Infinity` — a hand-edited or truncated backup reaches that without trying.

**What it costs when it lands.** maplibre's `LngLat` constructor throws on `lat > 90 || lat < -90`, and `trip-map.tsx` reaches it via `fitBounds` on raw `Math.min`/`Math.max` folds with no finite check. Every maplibre island is inside a real `getDerivedStateFromError` boundary and `gen-sw.mjs`'s `assertMapIslandsWrapped` fails the build if one is not, so the outcome is a dead map pane rather than a dead route — but the fallback copy blames a missing chunk when the cause is bad data, and `state.failed` is sticky, so "Try again" re-renders the same markers and throws again.

**Why the field degrades and the row does not.** Rejecting the value (a `.refine`) would drop the whole item at `sanitizeItineraryItems`, taking the title, notes and time with it over one bad number — the exact trade D-363 settled the other way ("dropping a good row is worse than the bug"). Absent lat/lng simply means un-pinned: the item falls back down `resolvePlacement`'s ladder to its area or the day's city and still renders. **The sibling boundary deliberately does NOT behave this way, and the two must not be unified.** `sanitizeCityCoords` drops the whole city entry, because `CityCoord` is `{latitude, longitude}` with no optional half and `lib/weather.ts` reads both fields to build a request — degrading one of them there produces a typed-but-half-populated `CityCoord` heading into that fetch. This was measured, not argued: simulating the merge yielded `{ "Bali": { "latitude": undefined, "longitude": 115.09 } }` and broke `custom-trip-config.test.ts:128`, so the distinction was already covered as a regression, just not by name. `ranged` is also module-private and `registry.ts` keeps a deliberately zod-free runtime graph, since the date backbone pulls it onto every route. Same bounds, different failure behaviour, on purpose; both files carry the note.

**One guard, at the only untrusted boundary, deliberately not two.** Every path that can carry a foreign coordinate funnels through this schema: the on-disk read (`parseItineraryPayload`), the remote snapshot (`docToDayPlan` → `sanitizeItineraryItems`), and both import paths (`parseItineraryPayloadStrict`). The concierge op schema carries no `lat`/`lng` at all, and `MAP_MARKERS` is authored, type-checked content. No second check was added in `lib/itinerary-map.ts` or `components/trip-map.tsx`, because a second check is a second rule that can drift from this one.

**The leaf module is the fix for a real runtime cycle, not tidying.** `core/itinerary/model.ts` and `core/vault/schema.ts` imported each other as VALUES in both directions. It was benign only because neither dereferenced the other at module-eval time — an invisible property `tsc` is green on either way. The hazard is asymmetric: lifting `itineraryItemSchema` into a module-level const in `model.ts` throws a TDZ `ReferenceError` when `schema.ts` is the entry, while the other direction is safe because a function *declaration* binds at instantiation. `item-schema.ts` imports zod and nothing else in `core/`, so there is nothing left to be careful about. No test loaded the model side first; `lib/__tests__/itinerary-model-entry.test.ts` now does, and its import order is load-bearing.

**`dayPlanSchema` gets the drift guard its sibling already had.** `ItineraryItem` has a two-layer guard (a `Record<keyof …, true>` literal plus a runtime `Object.keys(schema.shape)` check); `DayPlan` is `.passthrough()` too and had none, so a field added to the interface would be tolerated on read, never declared, and lost by any consumer that rebuilds the object field-by-field. Second `it()` in the file that already existed. The exposure is asymmetric — 25 keys and growing against 5 and stable — which is why this is a guard and not an incident.

**Changes if:** a trip pack ever needs a coordinate outside WGS84 (it cannot) or an offset outside UTC-12:00…UTC+14:00 (it cannot); or the map error boundary is taught to distinguish bad data from a failed chunk, at which point the sticky-retry residue is worth its own slice.

### D-519 · (2026-09-04) · Only a LIVE IndexedDB connection is memoised; a blocked, failed or closed one is dropped

**Decision.** `core/photos/blob-store.ts`'s `openDb` caches the connection promise as before, but clears the cache when it resolves `null`, and installs `db.onclose` to clear it when the browser closes a live connection. The cache is cleared through a `.then` on the promise rather than inside the executor, because the executor can resolve SYNCHRONOUSLY (no `indexedDB`, or `open()` throwing) and a clear from in there would be undone by the assignment that follows it.

**A transient failure was being cached forever.** `onblocked` is transient by definition — it fires because another tab is holding the old connection — and a rejected open can succeed on the next try. Both resolved `null` into a promise that was never invalidated, so one bad moment took photos out for the rest of the page's life. There was also no `onclose`, so a connection the browser closed left every later `tx()` throwing `InvalidStateError` against a dead handle, swallowed into `{ ok:false, reason:'unavailable' }` — the same answer a browser with no IndexedDB gives, which is why this never looked like a bug worth reporting.

**Checked and deliberately not added: `onversionchange`.** It can only fire on a version bump or an origin data wipe, and `DB_VERSION` has been 1 since the store was written with no bump in flight. Adding a handler now would be speculative; the pairing to remember is that a tab holding an open connection is what makes another tab's open BLOCK, so if `DB_VERSION` ever moves, `onversionchange` (close, then clear) belongs in the same commit.

**Proven against a hand-rolled `indexedDB` stub, not a new dependency.** jsdom has no IndexedDB and D-088 rules out `fake-indexeddb`, so the test in `lib/__tests__/photos-blob-store.test.ts` drives `openDb` with the smallest stub it will accept and counts `open()` calls: blocked then unblocked must open twice, two live reads in a row must open once, and a close must force a third. On the pre-fix memo that counter is pinned at 1 for the life of the module, which is the whole defect expressed as a number.

**Changes if:** `DB_VERSION` is bumped (see above), or the store gains a second object store, at which point the upgrade path needs the same treatment.

### D-520 · Amends D-057 (LOCKED), applies D-205 · (2026-09-04) · A heartbeat belongs to the loop that started it, and the presence subscribe is bounded

**Decision.** Two changes to `lib/presence.ts`, both of which follow from D-205 having moved the presence doc id from the traveller's uid to a persisted device id. **(a) Lifecycle.** `HeartbeatLoop` gains `tripId` and `deviceId`, captured in `startPresence()`. `writeHeartbeat()` captures `loop` into a local before its `await` and drops the beat on `!current || current.stopped`, and composes its ref from the captured pair rather than from `getTripId()`/`deviceStore.getId()`. `stopPresence()` keeps the loop object `teardownLoop()` returns and deletes `trips/{captured}/presence/{captured}`, gated on the captured trip id being non-empty instead of on `isTripRemoteConfigured()`. **(b) Read bound.** `subscribePresence` opens a `query(collection, where('lastSeen','>',now-ACTIVE_WINDOW_MS), orderBy('lastSeen','desc'), limit(PRESENCE_LIMIT))` instead of the bare collection. `PRESENCE_LIMIT` is 8 and is exported. The 180s cadence is untouched — D-057's addendum already settled it.

**(a) The post-await guard was dead, and its comment said what it was supposed to do.** `if (loop?.stopped) return;` was commented "A stop() during the await wins", but `teardownLoop()` sets `loop = null`, so after a plain stop the expression is `undefined?.stopped` — falsy — and the write proceeds. The other two gates run BEFORE the await, so an in-flight beat has already passed them and is carrying the traveller who was signed in when it started. Since the doc id is now the stable device id rather than a per-traveller uid, an identity switch does not write a second doc: it overwrites this device's doc with the PREVIOUS traveller's name. Reading the captured loop is what makes the guard mean what it already claimed.

**And the delete that would have cleaned it up never ran.** `stopPresence()`'s gate was `isTripRemoteConfigured()`, evaluated at teardown. On sign-out `wipeAllTripData()` clears the active-trip key before the identity event fires, so that gate is already false and the `deleteDoc` was unreachable — local teardown was complete, only the network delete was skipped. Deleting the gate would not have fixed it: `getTripId()` is `''` by then and would compose `trips//presence/{id}`. Capturing at start is the only version that targets the doc this loop actually wrote. `deviceStore.getId()` moves to start time for the same reason — it MINTS on a miss, so calling it after a wipe could delete a device id that never had a doc.

**(b) Reads, not writes, are what the free tier cannot absorb here.** `onSnapshot` bills per delivered document, so an unbounded collection subscribe costs writes × concurrent subscribers: at 9 live devices, 4,320 writes/day becomes 38,880 reads/day, **77.8% of Spark's 50k**, and Spark cannot be billed, so the overrun is a feature outage rather than a bill. Device-keyed docs have no GC beyond the best-effort delete above, so the collection only grows. The `where` drops every doc that was already stale when the tab opened; the `limit` caps what any one subscription can ever be handed. `orderBy … 'desc'` is not decoration — with no ordering Firestore falls back to `__name__`, and the device id is a random UUID, so the limit would keep an arbitrary slice of devices rather than the most recently seen. All three constraints name the same field, so this needs only the automatic single-field index; no composite is created, which matters because nothing in this project may require one.

**8, and what it costs when it binds.** The presence bar shows other travellers, deduped by name, over a three-name roster — 8 is roughly that roster on two or three devices each, so it never truncates a real trip. Above it, the visible set is the 8 most recent beats and it rotates; a name only disappears if every one of that traveller's devices falls outside the window at once. That is the deliberate trade against a quota that has no rollback.

**Existing mitigations are load-bearing and were not touched.** The interval still pauses on `document.hidden`, a `permission-denied` still tears the loop down permanently and warns once, and the default pack is still local-only and pays none of this (`startPresence` returns before a loop exists, so `teardownLoop()` returns null and the new delete branch is unreachable there).

**One behavioural edge is accepted.** `orderBy('lastSeen')` excludes a doc whose field is missing, and a just-written beat is a pending `serverTimestamp` locally. That is this device's own doc, and `usePresence` excludes the viewer by name before rendering, so nothing the bar shows depends on it. `isActive(null) === true` is unchanged for any other caller.

**Pinned.** `lib/__tests__/presence.test.ts` drives the real module against a fake Firestore whose `getRemote()` sits on a releasable gate — that is what makes "in flight across a teardown" reproducible instead of timing-dependent. Against the pre-fix file, four of its nine cases fail: the beat-after-stop writes, the identity switch writes `['Alina','Rhea']` where only `Rhea` is correct, the sign-out delete is absent entirely, and the subscribe target is a `collection` rather than a `query`.

**Changes if:** presence docs gain real garbage collection (then the `where` stops earning its place); the roster stops being small, at which point 8 has to be re-derived from the read budget rather than from the bar; or a future change makes `stopPresence()` reachable for a trip whose loop never started, which the captured-id gate would then be the wrong shape for.

### D-521 · Amends D-148 · (2026-09-04) · `commit()` does not wake its own listener

**Decision.** `hooks/create-reactive-store.ts` gains a per-instance `dispatching` ref, set across the `window.dispatchEvent(new CustomEvent(eventName))` line in `commit()` and checked by that instance's own `onCustom` listener. Everything else in D-148's skeleton is byte-identical: the dispatch still happens, at the same point, with the same event name; every OTHER mounted instance still re-reads; the cross-tab `storage` layer is untouched; D-039's push-from-commit-only echo suppression is untouched.

**D-148 froze this skeleton, which is why this is an amendment rather than an edit.** The entry's behaviour line 2 says "every commit dispatches the CustomEvent; the hook listens to that event". Both halves are still true. What changes is that the dispatcher no longer counts as one of its own listeners, and the entry's own line 2 now says so.

**`dispatchEvent` is synchronous, so the dispatcher was re-parsing a value it already held.** `commit()` does `prev = storage.load()` → `next = compute(prev)` → `save(next)` → `setValue(next)` → dispatch. The dispatch runs listeners inline, its own included, and that listener calls `storage.load()` and throws `next` away. For the itinerary that second load is the whole vault chain — `getItem` → `JSON.parse` → `detectVersion` → the migration chain → lenient zod over 32 days — inside the click handler. And `useItinerary()` has two production call sites, `itinerary-provider.tsx` and `concierge-chat.tsx`, whose store is mounted whenever the navbar renders it; both share the event bus, so one click paid for three full chains where one is the only one that has to happen.

**Per-instance, and that is the whole correctness argument.** A module-scoped flag would suppress every listener on the bus, which is exactly the cross-instance liveness the event exists for. A ref is per hook instance and stable across renders, so `commit`'s empty-dep `useCallback` closes over the right one. The `try/finally` is not defensive padding: a listener that throws would otherwise leave the flag set and permanently deafen that instance to the same-tab layer.

**The residual, stated because no test would show it.** The committing instance now holds `next` where it used to hold `storage.load()` after the save. Every domain port sanitizes on save and on load, so those agree unless a mutator emits a value its own sanitizer would rewrite — and `compute` receives an already-loaded base, so it would have to be the mutator introducing it. If a domain ever needs load-shaped state after a commit, it re-reads in the domain hook; it does not go back to waking its own listener.

**Pinned by counting loads, because every value-level assertion passes either way.** `create-reactive-store.test.ts`'s in-memory port now counts `load()` calls: one instance costs 1 load per commit, two instances cost 2, and a later same-tab event or a cross-tab `storage` event still re-reads the committer. Against the pre-fix file the two counting cases fail 2-for-1 and 3-for-2; the other seven pass unchanged, which is the point.

**Changes if:** a domain's `save`/`load` stop round-tripping, or a consumer starts relying on post-commit state being disk-shaped rather than commit-shaped.

### D-523 · (2026-09-04) · The four non-places sync ports gate on `isTripRemoteConfigured()`, matching the remotes they front

**Decision:** `lib/{itinerary,expenses,budget,docs}-ports.ts` return `isTripRemoteConfigured()` from `SyncPort.isConfigured()`, not `isRemoteConfigured()`. `places-ports.ts` already did, and it was the correct one. Their `subscribe()` dormant gate is left on the looser `isRemoteConfigured()` — it is defence in depth behind `isConfigured()`, and every `subscribeRemote*` checks for itself anyway.

**Why:** the published per-domain gate answered a question the domain does not ask. All five remotes compose `trips/{getTripId()}/…` and all five test `isTripRemoteConfigured()` for themselves, so on a pack with no remote trip id, with Firebase env present, `useDomainSync`'s `activate()` — its only caller, `hooks/use-domain-sync.ts:43` — saw four `true`s, flushed, and dynamic-imported four remote chunks that immediately no-op. Nothing was unsafe; the gate was just wrong, and a wrong published gate is what the next reader builds on.

**Changes if:** a domain ships whose writes are genuinely app-scoped rather than trip-scoped. Then it needs its own gate, not a loosened shared one.

### D-535 · (2026-09-17) · Kimi K3 is an opt-in concierge model on NVIDIA's free endpoint; Groq stays the default

**Decision.** The concierge header carries a model picker. Groq is the default. Picking Kimi K3 adds `provider: 'kimi'` to the request body, and the Worker then tries Kimi first with a 170s leg timeout before falling back to its Groq 120b → 20b ladder. Without the field the Worker behaves exactly as before, and the default body stays byte-identical, so the measured ~14.1 KB worst case against the 16 KB cap does not move. The pick is a device preference in key 44, not trip data.

**Why Groq stays the default.** Kimi on the free queue measured 81–89s for a short reply and 135s with a full 32-day plan in context. Groq answers in seconds. A picker that defaults to the slow model would make every first question feel broken.

**Timeouts.** The client abort is 215s for a Kimi turn, the Worker's 170s leg plus the 45s a Groq fallback normally gets, and stays 45s for Groq. The option label and the pending copy both say a Kimi reply can take up to 3 minutes.

**Changes if:** Kimi's free-tier latency drops to Groq's range, or NVIDIA's endpoint stops being free.

### D-536 · (2026-09-17) · The concierge thread is kept on this device, per trip, and nowhere else

**Decision.** The chat survives closing the app. Key 43 holds the last 50 turns per trip as `{ role, content, model? }`, trip-scoped through `keyFor` like every other trip slot. It is hydrated in an effect on mount, appended after each completed turn, and wiped by the panel's Clear chat control. Restored turns feed the next request's `history`, still bounded by `capHistory`, so the body is no larger than it was.

**Local only, on purpose.** No sync path reads the key and the backup export leaves it out (it sits in the backup module's exclusion bucket beside `weatherCache`). Being a trip-scoped slot puts it in `wipeAllTripData()` and `wipeTripData()`, so sign-out and forgetting a trip both remove it and a shared phone does not show the last person's chat. The provider pick (key 44, D-535) is a device preference and survives sign-out.

**Proposals are not restored.** Ops were validated against the plan as it stood when the reply arrived. They are never written to storage and are stripped on read, so a restored reply shows its text and model stamp but no Apply chip.

**Replaces** the in-memory-only stance the hook documented, where the chat cleared on reload. The panel's disclosure and input note said nothing was stored; both now say chats are saved on this device only.

**Changes if:** cross-device chat history is asked for, which would make this a synced domain with its own merge rule and a privacy review of what the provider already sees.

### D-540 · (2026-09-18) · A members roster that names no owner reads as open, and can no longer be written (#453)

**Decision.** `isOpen()` in `firestore.rules` is now also true when `members` is not a map, or is a map with no value equal to `'owner'` (empty, all `'member'`, a `'viewer'`, a mis-cased `'Owner'`). A new `rosterIsWellFormed()` on trip-doc updates refuses any write that leaves `members` present without being a map that names an owner, and `claimsSelfAsOwner()` tests `is map` before calling `.get()`. Before this, each of those shapes left `isOwner()` false for everyone; the empty, non-map and viewer-only shapes also answered "not a member" to every uid, delete included, so the trip was locked for everyone, creator too, with no route back through the rules. Same-doc `get()` calls count once in the rules engine (emulator: 20 same-doc gets allowed, 11 distinct docs denied), so the extra `roster()` reads cost nothing.

**Open, not closed.** Reading a malformed roster as open is the only choice with a repair: any signed-in holder of the trip id can read the trip and overwrite the roster, which is the capability model every members-less trip already has (D-205). The cost is that an owner-less roster of real members (say two `'member'` entries) stops keeping strangers out until someone opens the trip and enrols as owner. Under the old reading that trip kept its gate but nobody could remove a member or delete it, and the empty, non-map and all-viewer shapes were bricked outright.

**No new way for a gated trip to open.** The shapes that now read open cannot be written. A create must name the creator owner, an update must leave a map naming an owner, and a member's add-only edit cannot remove or re-role one. They can only exist through data written before this ruleset was ever published (#263) or a console edit. The owner's existing ways to un-gate a trip, dropping `members` or deleting the doc, are unchanged.

**Client mirror.** `readMembers()` in `lib/trips-remote.ts` returns `undefined` for the same shapes. Without that, `ensureMembership` would see a truthy roster, try to enrol as `'member'`, be refused by `rosterIsWellFormed()`, and show the access-pending toast on a trip the rules treat as open. With it, the first device enrols as owner and the trip is gated from then on. `scripts/roster-inspect.mjs` drops its LOCKOUT_ALL and NO_OWNER buckets, which can no longer occur, and refuses to run if `isOpen()` loses either guard.

**Changes if:** roles move to a `members/{uid}` subcollection (the ceiling in the rules header), where "has an owner" stops being a map test.

**Addendum · (issue #477, 2026-09-22) · The client repair this entry leans on is REMOVED; the open reading stands, permanently.** Two sentences above are now false and are retired: "stops keeping strangers out until someone opens the trip and enrols as owner", and "With it, the first device enrols as owner and the trip is gated from then on." `ensureMembership` no longer writes anything when `readMembers()` returns `undefined` — it reads the doc and returns. A roster is minted only where the creator is actually known: `createTripDoc` at create time, and the first-snapshot seed in `lib/itinerary-remote.ts`.

**The repair was the defect from the other side.** "The first device to open a pre-lock trip is overwhelmingly its creator" is false for the way these trips are actually shared. A `?trip=` link forwarded into a group chat makes whoever taps it first the sole owner, and from that moment only an existing member can add anyone — so the real creator is locked out permanently, with no self-service route back. Nothing local distinguishes the two devices: `core/trips/registry.ts` records `joinedAt` for a create and a join alike, and for a pre-#10 trip no creation record could exist retroactively anyway.

**`'member'` is not available as the safer value.** `rosterIsWellFormed()` gates every trip-doc update, so writing `members.<uid> = 'member'` onto a trip with no usable roster produces a map naming no owner and is refused — which would raise the access-pending toast on a trip the rules treat as open and this device can read and write. Emulator-pinned at `scripts/rules-check.mjs:525`. With both values unavailable the only correct write is none: an open trip already grants this device everything, so there is nothing to enrol in.

**Accepted consequence, and it is a real cost.** An owner-less roster of REAL members (two `'member'` entries) now stays open to every token holder permanently, rather than until someone opens the app. And a pre-#10 trip can no longer adopt the lock at all: the rules header (`firestore.rules:21-33`) promises such a trip is never FORCED into membership and explicitly contemplates a token holder writing a roster naming only themselves, so removing the only path that did it converts "opt-in" into "unavailable". That is a new position, not the existing grandfather contract, and it is recorded here rather than settled: both this and the permanently-open real-member roster are raised as follow-ups for a product call. A deliberate, user-initiated "lock this trip" control is the obvious shape of the answer and is NOT built here.

**Downstream.** `scripts/roster-inspect.mjs` fed a publish decision for #263 on the strength of this mitigation ("rosters have been self-healing since 2026-08-10"); its header and its per-trip OPEN note now state that no client heals a roster and that the exposed set does not shrink between runs. `components/settings-panel.tsx` hides the add-device form on a confirmed-rosterless trip, where the rules can never accept the write — which is why `fetchTripMembers` gained a third answer (`'unknown'`) rather than collapsing a failed read into "no roster" and taking the control away from an owner who opened Settings offline.

### D-541 · (2026-09-20) · A key with a tripList doc and no identity doc is a real account, and the door now admits it

**The defect.** The door validates a pasted key with one server read of `trips/{code}/profile/identity` (`probeAccountIdentity`, D-296): absent ⇒ `'missing'` ⇒ rejected. Two "grandfathered account" affordances minted keys that never created that document. `finishAccount()` in `components/trips-hub.tsx` and `SyncGroup.reveal()` in `components/settings-panel.tsx` both did `crypto.randomUUID()` → `setSyncCode` → `pushTripList`, and nothing else; the door's own create path writes both docs (`pushAccountIdentity` + `pushTripList`) and always did. So a key minted from either affordance worked on the minting device and was rejected on every other device, permanently. The minting device never showed it: `token-gate.tsx`'s `const fresh = token !== getSyncCode()` skips the probe entirely for a device that already holds the key, so it logs in offline on a cached credential and never re-validates. Both affordances exist specifically for travellers who signed in before accounts existed — the defect hit exactly the people the feature was for.

**Fix, root cause.** One new writer, `seedAccountDocs(code, name)` in `lib/trips-remote.ts`, writes both documents; both mint sites call it. The placeholder filter lives in the helper, not at the call sites: `DEFAULT_TRAVELER_NAME` must never be published (it would overwrite the real name on every other device), so a device sitting on the placeholder writes `{ version: 1 }` — an identity doc with no name. That nameless form already had a meaning the probe understood (`'exists'` with `name: undefined`), which is what makes existence and naming separable here.

**Fix, already-orphaned accounts.** A root-cause fix does nothing for a key minted months ago, so `probeAccountIdentity` gains a fallback: on an absent identity doc, read `trips/{code}/profile/tripList`. Present ⇒ `'exists'`, and backfill the identity doc so the second read is paid once per account. Absent ⇒ still `'missing'`. The admit is on POSITIVE evidence of a document that only a deliberate account write creates — not on the absence of one — so an invented or mistyped key is rejected exactly as before. The backfill is best-effort: its failure is swallowed and the verdict is already decided, so it can never turn an admit into a reject. `'exists'` rather than a fourth verdict, because that is the honest answer and the door needs no new branch.

**Cost.** One extra document read against the Spark 50k/day quota, on the rejecting path only. The admit path is still one read. `PROBE_TIMEOUT_MS` (8s) now races the whole call including `getRemote()`'s lazy firebase load, not just the first read, so two reads and a write stay inside the budget the door was sized for.

**Sign-out no longer destroys the key silently.** `signOut()` → `wipeAllTripData()` clears key 28 — this device's only copy of the credential, which nothing can re-issue — while `<SignOutConfirm>`'s copy promised "your key still gets you back into your account". That is the mechanism that produced the lockouts. Confirming now advances to `UserTokenShowOnce` (copy, download, a required "I've saved my key" tick) and the teardown runs from its confirm. A device with no key stored skips the step and the copy stops claiming one exists.

**Changes if:** accounts gain a recovery path (email, a second factor, a server-side account record). Then existence stops being "one document is there" and the fallback, the nameless identity doc and the show-once screen all get re-derived together.
### D-542 · (2026-09-20) · The default pack can be shared, by minting a remote id on the device rather than moving the trip

**Decision.** `getTripId()` on the default pack returns `getDefaultTripShareId()` (gateway key 45, `nepal_japan_default_trip_share`) instead of a hardcoded `''`. Absent ⇒ `''`, so a device that never opts in is byte-identical to #10. `ShareDefaultTripDialog` mints one with `crypto.randomUUID()`, or takes a pasted one to open someone else's plan; both write the key and reload. `wipeAllTripData()` clears it alongside `syncCode`.

**The problem.** #10 retired `NEXT_PUBLIC_TRIP_ID` for a good reason — a `NEXT_PUBLIC_*` value inlines into the public bundle, so the "separately-minted secret" shipped to every visitor — but it left the sample pack with no remote path at all and no way to say so. Every edit to the built-in trip is device-only, forever, and the UI reported this as silence: the outbox is gated off, so `SyncStatusBadge` read the same neutral shape as "all synced" and rendered nothing. The id here is minted per device and only ever in localStorage, so it is a real capability token and the retirement stands.

**Not "create a trip and copy the data across".** That route loses the plan and degrades what survives. `keyFor` namespaces on the PACK id, so a `joinTrip(newId)` pointer switch leaves the itinerary at the legacy `nepal_japan_itinerary` key and the vault falls back to `buildDayShells` — one blank day per date — with no UI that can reach the real data. And a custom trip is single-leg with `utcOffsetMin: 0` and `contentRef: 'empty'`, so NPT +345 / JST +540 become "no geography": `tripOffsetMinFor` returns `null` and the countdown, what's-next and preflight's clock check all re-anchor on the device offset, while the Nepal and Japan guide, nightlife and photography content disappears. Decoupling "which pack am I on" from "what remote id do I sync to" needs no copy at all — storage keys, leg offsets, guide content and on-disk bytes are untouched.

**The trip doc is deliberately NOT pre-created.** `reconcileFirstSnapshot` reads `if (tripExists && (remoteDays.length > 0 || localWasPersisted)) applyRemote(remoteDays)`. Calling `createTripDoc` first would make that true with an empty remote and a present local key — `applyRemote([])` → `savePlans([])` → the itinerary destroyed on the first snapshot. Leaving the doc absent takes the existing seed branch, which writes the marker with this device as `owner` and pushes the local days up. The trips-hub create flow escapes this only because a new pack id always has an absent local key.

**Joining.** A peer who pastes the code stays on the default pack, so they keep the leg offsets and the guide content and still converge on the shared plan (their first snapshot finds a non-empty remote and applies it authoritatively). This is strictly better than the `?trip=` handshake's `joinTrip`, which makes the joiner a custom trip; that path is untouched here and is the obvious follow-up.

**Cost.** Joining replaces whatever is on the device, which is the documented first-snapshot semantic and is why the dialog says so and points at the backup. One trip id per device, minted locally, so two devices that both mint are two different trips — the code is how they converge.

**Changes if:** the `?trip=` handshake is rewired to set the share id instead of switching packs, which would make the link and the code the same thing.

### D-781 · (issue #485, 2026-09-21) · Prototype-safe maps at the settlement and budget-merge boundary
_Renumbered from D-546; the id collided with the share-link entry._


**Decision.** `core/budget/settlement.ts` and `core/sync/merge-budget.ts` build their accumulator maps with `Object.create(null)` and read with `Object.prototype.hasOwnProperty.call`. A participant or field path named `constructor`, `toString` or `__proto__` behaves like any other key. `core/sync/hlc.ts` `parse` returns the oldest stamp for a non-string input rather than throwing.

**Why the plain object was wrong.** `'constructor' in {}` is `true`, so settlement's zero-init was a no-op and `balances[id] += amount` accumulated onto an inherited function: `NaN`, a `NaN` deficit, the largest-remainder loop never ran, and every transfer on that leg came out wrong. With `__proto__` the write hit the prototype setter instead, the payer vanished, and the debtors owed nobody. Traveller names are free text and a custom roster is derived from `paidBy`/`split`/`createdBy`, so this is reachable without a hostile doc.

**The null prototype escapes both modules deliberately.** `settle()`'s result is display-only — `settle-up-summary.tsx` reads it with `Object.entries`. `mergeBudget()`'s result is normalised before it leaves: `sanitizeFieldsForWrite` in `lib/budget-remote.ts` is `JSON.parse(JSON.stringify(...))` on the write path, and `flatten.ts` `fieldsToModel` rebuilds fresh objects on the read path. Firestore's own `isPlainObject` accepts a null prototype, so the SDK is a second layer rather than the relied-upon one. Two constraints follow: never call `.hasOwnProperty()` as a method on these values, and never string-coerce them — both throw on a null prototype.

**Testing note.** Only an own-key assertion pins this. Reading `obj.__proto__` back off a plain object returns the value that was silently written to the prototype, so `expect(merged.__proto__)` passes with the bug present. Assert `Object.keys()` or the JSON round-trip instead.

**Changes if:** either result starts being written somewhere without passing through those two normalisers.
### D-543 · (2026-09-20) · Calendar colour derives from one module, keyed on leg id and by-date city

**Decision.** All calendar colour comes from `trip/lib/city-palette.ts`. One hue per leg, cities take shades in first-visit order. A city with one day in its leg is a day trip and inherits the shade of the nearest preceding base city. A leg change, or a first-day departure from outside the trip, is a transit day and renders as a split cell. Nothing may key colour off `DayPlan.countryLabel`.

**Cost.** A run of one-day cities that is not a round trip (Paris, Rome, then a week in Berlin) would be read as day trips of Berlin. Unreachable with the default pack or single-city custom trips. Print drops colour (the print sheet forces a grey border), so it carries border style plus text.

**Changes if:** a pack needs explicit city colours, or the one-day rule needs to be bracketed by the same base on both sides.
### D-545 · Amends D-297 · (issue #450, 2026-09-20) · `ensureMembership` gates on its argument, not on the active pack

**Decision.** `ensureMembership(tripId)` gates on `isRemoteConfigured() && tripId && tripId !== DEFAULT_TRIP_ID` rather than on `isTripRemoteConfigured()`. A new `ensureKnownTripMemberships()` calls it once per known trip, and `settings-panel.tsx` uses that on the Google `credential-already-in-use` (adopted) path instead of re-enrolling only the active trip.

**Why the active-pack gate was the wrong one here.** `isTripRemoteConfigured()` resolves the ACTIVE pack — `getTripId()` is `''` on the default sample — so asking to enrol a NAMED trip while the sample was active returned early and enrolled nothing. Adoption changes this device's uid, and an inactive trip gets no second enrolment opportunity on that page: the page-load caller only ever passes the active id. The new gate is the same pair of checks `runTripMembership()` already ran immediately before calling, moved inside the function, beside the id it actually writes to.

**Scoped exception to D-297, and it makes the module self-consistent.** D-297 binds modules composing `trips/{getTripId()}/…`; `ensureMembership` composes `doc(db, 'trips', tripId)` from its argument and never reads the active pack. Its neighbour `createTripDoc(tripId)` — same shape, same argument — already gated on `isRemoteConfigured() && tripId`, so `ensureMembership` was the outlier rather than the rule. The two functions here that DO resolve the active pack keep `isTripRemoteConfigured()`.

**Changes if:** a caller ever needs to enrol in the default sample pack (it has no members map today, by D-297), or `isTripRemoteConfigured()` stops meaning "the active pack" — every syncing domain depends on that reading and it must not be widened to fix a per-function gate.
### D-544 · (2026-09-20) · A remote with zero day docs means "never pushed", never "emptied" — so it may not overwrite a non-empty local

**The invariant.** A first snapshot may overwrite local state verbatim only for content the remote actually reports; the absence of content is evidence that it was never pushed, never that it was deleted.

**The defect.** `reconcileFirstSnapshot` seeded a group by writing the trip-doc marker first and then calling `pushPlans([], localPlans)`. `pushPlans` swallows its own failure to a `console.warn` and had no outbox behind it, so it never even reached the surrounding `catch` — alone among the writes in this app, a failed seed was neither retried nor recorded. Marker lands, day pushes do not, and the remote is left as "trip doc present, zero day docs". On the next load `tripExists && localWasPersisted` is true, so the authoritative branch ran `applyRemote([])` → `savePlans([])` and the user's whole itinerary was gone. The dirty-outbox merge exception that exists precisely to stop this could not fire, because the seed path never enqueued. D-542 hit the same edge from the other side and documented it as a reason not to pre-create the trip doc; this removes the edge instead of steering around it.

**Why zero docs can never mean emptied.** Emptying keeps the day: `removeItem`/`clearDay` leave `items: []` (D-091), and whole-day removal is not a user-reachable op because the trip dates are fixed. A deliberately-emptied plan therefore always arrives as N docs with empty items, which is `plans.length > 0` and still applies verbatim. Zero docs is a shape only an incomplete seed produces. The marker cannot tell the two apart because it is a *different document* from the content.

**Fix ①, the floor.** `applyRemoteAuthoritative` refuses when `plans.length === 0 && loadPlans().length > 0`, and now answers whether it handled the snapshot rather than returning void. One guard, on the single function every verbatim apply routes through, instead of one per call site. The reconcile branch gains `&& applyRemote(remoteDays)` and nothing else, so a refusal falls through to the seed and *heals* the remote rather than refusing forever. A cancelled reconcile (A-20) answers `true` — it must write nothing and seed nothing — which is why the contract is "handled", not "applied".

**Fix ②, the seed is an ordinary write again.** It pushes through `itinerarySyncPort.push([], localPlans)`, the outbox-decorated port every other itinerary write already uses, instead of the bare `pushPlans`. Same per-day merge-aware transactions, but write-ahead: the dates are enqueued before any network, so a failed seed stays dirty, retries on the next ordinary flush, and survives a reload. It also arms the existing dirty-chunk merge exception for exactly those dates, which covers the *partial* seed — 30 of 164 days landing used to apply those 30 over the whole local plan.

**Ordering was considered and rejected.** Pushing content before the marker also self-heals, but the marker is what writes `members: {uid: 'owner'}`, and deferring it widens the window in which a second client seeding concurrently writes a roster that drops the first client's ownership. With ① and ② the ordering buys no additional safety, so the race stays closed.

**The siblings do not share this.** `budget-remote`, `docs-remote`, `expenses-remote` and `places-remote` contain no trip-level document reference at all — their first-snapshot marker is `snap.exists()` / `presentLegs.has(leg)` on the content doc itself, written by the same single write that carries the content. Marker and content cannot diverge there, so a failed seed leaves the doc absent and the next load simply re-seeds. Itinerary was the only domain whose marker was a separate document, which is the whole cause.

**Cost.** No new Firestore read or write on the happy path — the same one read plus one write per changed day, inside the transaction that already existed. A failed seed now retries on later flush triggers, bounded by the day count (~32 docs), which is the cost profile of any other dirty chunk and well inside Spark's 50k reads / 20k writes per day.

**Changes if:** whole-day removal becomes user-reachable (editable trip dates that delete day docs). Then zero docs stops being unambiguous and the seed needs an explicit completion marker rather than an inference.

### D-548 · Amends the D-281 alias rules · (2026-09-21) · A marker's name is its match key: matching is word-bounded, the item's TITLE outranks its `location`, and the longest alias wins within each

**Decision.** `matchMarker`'s rung 2 tests each alias with a `\b`-anchored, metacharacter-escaped regex instead of `hay.includes(k)`, runs against the item's `title` alone before falling back to `title + location`, and within each pass picks the longest matching alias across all markers rather than the first hit in `MAP_MARKERS` order. Rung 1, the `sourceId` exact join, is untouched and still takes precedence. The alias GENERATION rules — the strip list, `length >= 4`, the containing-city guard — are unchanged.

**Three defect classes, all of which array order or field-blindness was hiding.** Substring: `Asan Bazaar` strips to the alias `asan`, which clears the discriminating-alias guard (4 chars, and not its own city `kathmandu`) and is a substring of `Basantapur` — the `location` on Kathmandu Durbar Square, a different site ~450 m away. Shadowing: `np-thamel` has a single-segment `area`, so `containingCity` returns null and the guard is structurally unable to drop the alias `thamel` — and every venue inside Thamel carries "Thamel" in its `location`, so the venues resolved to the district. Cross-field ranking: with both fields in one haystack, alias LENGTH decides across them, so "Breakfast at OR2K Restaurant" / `location: 'Thamel'` lost `or2k` (4) to `thamel` (6) and the dinner plotted at the district. What an item calls itself beats where it says it is, whatever the two names happen to measure.

**Measured against the owner's canonical seed, not asserted.** 164 seed items, 27 markers before and 156 after. Placement is identical for 134 items, 18 gain an exact pin where they previously fell back to a city or area centroid, 3 move from a district pin to the specific venue named in their title (`np-thamel` → `np-roadhouse-thamel`, `np-or2k` ×2), 9 improve from city-centroid to area-level approximation, and **0 lose a pin**. No marker id was removed, so no `sourceId` join changes. The title-first pass on its own accounts for exactly 2 of those 3 moves and changes nothing else.

**The conditional boundary is load-bearing.** The `\b` is applied per side only when that side's own edge character is a word character. Several aliases end in `)` or `'` — `le sherpa & farmers'`, `kinkaku-ji (golden pavilion)` — and an unconditional trailing `\b` demands a following word character, which would kill them at end of string. No alias starts with a non-word character, so the leading side is always anchored.

**The gate is derived, not hand-written.** `itinerary-map.test.ts` asserts that any seed item whose TITLE contains a marker's name resolves to that marker, built from the data so a new place is covered the moment it is added. It is keyed on the title alone and not `location` deliberately: `location` is the field the shadowing came through, so including it would let the defect define the expectation. 37 of 164 items are covered today; the floor asserts 30 so ordinary content edits do not trip it.

**Changes if:** a marker is added whose name is a strict prefix of another's, where longest-wins stops being obviously right; or the strip list gains a term that shortens an alias below the length of a locality alias containing it.

### D-549 · (2026-09-21) · Asset bytes are measured by a dependency-free CI step with ceilings, and the image credits file is generated, never hand-edited

**Decision.** `trip/scripts/asset-budget.mjs` (`npm run budget-check`) runs in CI's dependency-free block and fails the build over three ceilings: the precached hero rasters, the rest of the precache out of `public/`, and the image tree as a whole. `trip/scripts/fetch-images.mjs --credits` regenerates `public/images/CREDITS.md` from `scripts/image-map.json` with no network access, and CI re-runs it and diffs, so a credits file that drifts from the manifest fails.

**Why.** Nothing in CI measured bytes. The one size-adjacent guard was `expect(imageEntries).toHaveLength(6)` in `e2e/pwa.spec.ts` — the COUNT is asserted and the bytes are not, so re-encoding a hero at 2 MB keeps it green while every install pays for it. That spec also runs on pull requests only, so it is absent from the path a direct push takes.

**Source tree only, and that is a real limit.** The step runs before `npm ci` and long before a build, so `out/` does not exist and the install payload's JS/HTML half is NOT covered. A check that silently skipped itself when `out/` was missing would report green having measured nothing, which is the failure mode the file exists to prevent — so it measures what it can reach and says so rather than papering over it.

**Ceilings, not pins.** Each number is a measured baseline plus 5%, so an ordinary re-encode does not fail the build and a doubling does. Raise one only with a reason; when a cleanup drops a measured total well under its ceiling, bring the ceiling down in the same commit or it stops meaning anything. **A ceiling authored to fit the drop that is landing alongside it cannot catch that drop** — it establishes the baseline for the next one. That is the case for the image-tree row as recorded here.

**KNOWN CEILING:** `--credits` writes LF, and a Windows checkout holds CRLF, so the file hashes differ locally while `git diff --exit-code` — what CI actually runs — is clean. Compare with git, not `sha256sum`.

**Changes if:** the build artifact becomes reachable this early, at which point the JS/HTML half of the install payload should get its own row rather than the whole check moving after `npm ci`.
### D-546 · Amends D-542 · (2026-09-21) · A share link names its namespace, so the default pack's link keeps the pack

**Decision.** A default-pack share id travels as `pack:<id>`. `core/trips/registry.ts` gains `parseTripToken` (wire form → `{ kind: 'default' | 'custom', id }`, or `null`) and `formatShareToken` (the inverse); `joinTrip` resolves through the first of those and, for a default-pack token, calls `setDefaultTripShareId` and points at `DEFAULT_TRIP_ID` instead of registering the id as a trip of its own. It now returns whether the switch actually landed. `settings-panel.tsx` emits the wire form in both the Trip Token card and the `?trip=` link.

**The problem.** D-542 gave the default pack a remote id and left the `?trip=` handshake alone, naming the rewire as the obvious follow-up. Until it happened the two invitations in Settings did different things: the code went through `ShareDefaultTripDialog` and stayed on the pack, the link went through `joinTrip` and became a CUSTOM trip. `core/trips/custom.ts` builds one leg at `utcOffsetMin: 0`, so `tripOffsetMinFor` returns `null` — "no geography → device-local" — and the joiner's countdown, what's-next and preflight clock check all re-anchored on their own device offset instead of NPT +345 / JST +540, while `contentRef: 'empty'` took every Nepal/Japan guide, nightlife and photography binding with it. Nothing threw. The standing workaround was "send the code, not the link".

**Why the TOKEN carries the namespace rather than the link carrying a second parameter.** A share id and a pack id are both bare uuids, so no receiver can tell them apart by value — and the ambiguity belongs to the token, not to the link. Five entrances consume one (`?trip=` on the front door and in the handshake, both paste boxes, the share dialog), so a link-only signal would have fixed one of them and left a pasted share id still making a custom trip in the other four. Prefixing at the transport layer puts the answer inside the thing being copied, so one guard in `joinTrip` — the single entry point every active-trip pointer write already flows through — settles all five. The prefix is stripped before the id is used and never reaches a Firestore path. A bare uuid is still read as a custom trip, so every token issued before this keeps working, and the share dialog accepts both forms because its subject IS the pack.

**Refusal is now possible, and is stated (#476).** `parseTripToken` rejects a token that could not compose the path it claims: empty, over 128 chars, `.`/`..`, containing `/` or a space or a control byte, or Firestore-reserved `__x__`. `joinTrip` writes nothing on a refusal and returns false, so a truncated link cannot leave a half-joined state; the handshake draws a stated refusal, and both paste boxes carry a `role="alert"` instead of reloading onto the trip the browser was already on. This narrows one reachable path in D-307's A-4 case — `__proto__` can no longer be pasted in as a trip id at all — and that test now sets the pointer directly, because the value can still be on disk from before this.

**Addendum · (issue #476, 2026-09-22) · the same predicate, moved down a layer and applied at composition as well as at the join.** The refusal above guards the one entrance; it does not guard a value that reached disk before it existed, nor a trip id that never passes an entrance at all. The predicate therefore moved verbatim out of `registry.ts` into `core/storage/gateway.ts` as `isSafeTripSegment` — the gateway is a zero-import leaf that both `core/trips/registry.ts` and `lib/firebase-config.ts` already depend on, so this adds no edge to the import graph — and now runs in four places: `parseTripToken` (unchanged behaviour, on the POST-strip value, so a `pack:`-prefixed share id is validated as the segment it will actually become), `sanitizeTripMetaEntry`, `getTripId()`, and the early return of every `lib/trips-remote.ts` function that composes a `trips/{id}` path from an explicit argument.

**The invariant, stated precisely, because the obvious statement of it is wrong.** It is NOT that a re-parented write stays at the same depth. `firestore.rules` matches `/trips/{tripId}/{sub}/{document=**}` and `{document=**}` matches zero or more segments, so `trips/A/B/C/days/d` still binds `tripId=A` and `isMember()` still resolves against `trips/A`. The invariant is that **the id must occupy exactly one path segment**, so `{tripId}` binds the whole id and the membership subject is the same document the write lands under. Rejecting `/` is the whole of what delivers it; the rest of the predicate (`.`/`..`, `__x__`, whitespace and control bytes, a 128-char ceiling) only stops a value silently naming a neighbouring, empty trip.

**`sanitizeTripMetaEntry` is a second trust boundary, not a display filter.** It checked `id.length === 0` and nothing else, and its own docblock records that it is shared by the local-store parse AND `mergeTripLists`. So a Sync-Code-merged entry with an id like `A/B/C` never touches `joinTrip` or `getTripId()`, yet `ensureKnownTripMemberships` maps it to `doc(db, 'trips', 'A/B/C')` — four segments, an even count, therefore a VALID doc ref that does not throw — and `updateDoc` writes a members map under a document the recursive rule authorizes against trip `A`. (A single `/` throws on an odd segment count and is swallowed by the surrounding catch; two or more is the live shape.) Dropping the entry closes that door and, in the same move, stops the hub drawing a chip no join could ever honour.

**Why `''` from `getTripId()` is not a new failure mode.** It is the regime every default-pack device has shipped in since #10: `isTripRemoteConfigured()` goes false, every remote module no-ops, the outbox KEEPS its dirty entries rather than discarding them, and local data is untouched because `keyFor` namespaces on `getActiveTripId()`, never on `getTripId()`. The pack goes local-only instead of writing somewhere the rules were not asked about.

**Why not the strict `/^[A-Za-z0-9_-]{1,64}$/` the issue proposed.** Every minted id is a `crypto.randomUUID()` and would pass it, but ids already on disk need not be minted — a hand-made or renamed id containing a `.`, or a non-ASCII one, is legal today and composes exactly one segment. Tightening to the charset would refuse tokens people are currently using, for no gain against the invariant. **Known ceiling:** an exotic-Unicode id (a non-breaking space, say) clears the predicate. It composes a DIFFERENT document, never a different segment count, so the membership subject and the write path still agree — which is the property being defended.

**The badge stopped reporting transport as delivery.** `useSyncStatus` reads only this device's own outbox; `lastAckAt` is stamped when Firestore accepts the bytes, which is equally true when zero peers will ever read them. So "Synced 2m ago" held throughout the defect above, and is the main reason it went undiagnosed. `SyncStatusBadge` now also reads `usePresence()` — the same heartbeat collection, the same gate and the same 6-minute active window the presence bar already subscribes to — and splits the synced state: "Synced · N here" with an audience, "Saved Xm ago" without one. Being alone is the NORMAL state of a solo trip, so that case keeps the neutral check mark and the plain tone and explains itself only in the `sr-only` sentence; making it a warning would have taught everyone to ignore the signal.

**Cost.** No new Firestore read on the happy path: the badge opens the identical collection query the presence bar already holds, which the SDK multiplexes onto one listen target. Worst case, if it ever were a second target, it is ≤3 docs per heartbeat — under 1k reads/day, ~2% of Spark's 50k.

**Changes if:** a third token namespace appears (an account-scoped invite, a per-leg share). Then the prefix stops being a boolean and `parseTripToken` needs a real scheme rather than one literal — decide that before adding the second prefix, not after.

### D-551 · Amends D-540 · (issue #501, 2026-09-22) · The first-snapshot seed names this device owner only if it created the trip

A creator offline at create loses `createTripDoc`, so whichever device first snapshotted the trip seeded the doc and named itself owner, letting a joiner take the trip over. The seed now writes `members` only when this device created the trip, tracked in a local-only id list (storage key 46), kept off the trip registry because that syncs across devices. Any other device seeds a doc with no roster, which reads as open (D-540), and the creator reclaims owner through `ensureMembership` on its next load. That reclaim needs the creator on this build; an older client marks nothing, so its trip stays open. Settings says "hasn't synced yet" when the trip doc does not exist, instead of calling it a pre-lock trip.

**Changes if:** trips get created anywhere other than the trips hub or the default-pack share dialog. That path must mark the id too, or its creator seeds an open trip.
### D-550 · (issue #471, 2026-09-22) · The map worker is a same-origin file, and worker-src drops blob:

**Decision.** maplibre-gl 6 loads its worker from a URL. `scripts/copy-maplibre-worker.mjs` copies `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` into `public/maplibre/` (gitignored) before `dev`, `build` and `analyze`, and `trip-map.tsx` calls `setWorkerUrl(withBasePath(...))` before the first `new Map`. A same-origin URL is spawned directly, so the CSP is `worker-src 'self'` with no `blob:`. Neither file is precached; they are runtime-cached on the first online /map visit, like the engine chunk.

**Changes if:** the worker URL ever points at another origin. maplibre then wraps it in a blob, and `blob:` has to come back into worker-src.

### D-512 · Amends D-033 and D-418 · (2026-09-04) · Two static checks reported clean while checking less than they claimed: a marker-check exemption is now keyed to ONE rule, and the loop check's second pass has a floor

**Decision.** `marker-check.mjs`'s `ALLOWED_LINES` entries are `[rule, pattern]` pairs, tested only against hits of that rule; `scanText`'s blanket early return is gone and both markdown scans consult the same per-rule helper. `motion-loops.mjs` fails when its utility pass scans files but finds no `animate-pulse/spin/bounce/ping` site at all. Separately, marker-check now warns when a tracked file passes 80% of the 2,000,000-byte read cap.

**The exemption reach was structural, not a bad entry.** `if (ALLOWED_LINES.some((re) => re.test(line))) return;` ran before the `PATTERNS` loop, so an exemption written for one rule silenced eleven patterns plus both markdown scans on that line. Twelve live lines were exempt from more than they needed, including `trip/docs/RELEASES.md:943`, where the entry for the deployed Worker hostname also exempted that line from `trip-id` — the rule whose own docstring calls a hit *"a live leak, not a cosmetic one."* All twelve are benign today (the UUIDs are deploy ids, and that line is separately and deliberately exempt through the `Version ID` entry), so nothing was leaking. What was wrong is that the next entry anyone adds inherits the same thirteen-rule reach while the failure message tells them they are adding something narrow — the message now names the rule and says the entry exempts that rule and no other.

**Zero behaviour change was the acceptance criterion, and it is measured rather than asserted.** The previous script and this one were run against the same tree and their output diffed: identical hits, same scanned-file count, the only difference the reworded failure message. The self-test gained the two assertions that make the narrowing load-bearing: a line carrying an allowlisted phrase alongside a different rule's marker must now report that other rule, checked against both the role-word and the gate-word entries. The old blanket return reported both of those lines clean, and restoring it fails the self-test.

**Pass 2 of the loop check had no guard that could see its own blind spot.** All three existing checks survive a pass-2 regex that stops matching: `filesScanned` counts up before the regex runs, the reduced-motion block check is about the CSS, and the allowlist-matched-nothing check is satisfied entirely by pass 1 because both `STATE_INDICATORS` keys are authored loops. So a Tailwind class rename or a new loop utility printed "0 UTILITY INFINITE LOOP(S) ... ALL HARD-STOPPED" in green — the state the ambient-loop work exists to prevent. Verified by renaming the class list: the check now reports that the pass proves nothing and exits 1, where it previously exited 0. The floor is non-zero rather than a pinned count of the two live sites, matching `token-wrappers.mjs`'s `tokens.size` guard.

**The read cap is a hard stop for this check and for the first step of CI on every branch.** `DECISIONS.md` is append-only and growing roughly 7 KB a day, and the next largest tracked text file is two orders of magnitude smaller, so nothing else is close. On the day it crosses, `npm run marker-check` and every branch's first CI step fail together, and the fastest unblock under pressure is widening the cap, which is what this file's own failure message tells people not to do. The warning never fails the run: the file is still scanned in full, and turning the check red would be the outage it exists to give notice of. Its text carries the one non-obvious constraint on the fix — the archive must not be called `DECISIONS-archive*.md`, because `private-doc` matches that name and every reference to the new file would then fail this check.

**Changes if:** the cap moves (the warning band moves with it, it is a ratio); or the last `motion-safe:`-guarded utility loop is genuinely removed, in which case delete that floor in the commit that removes it rather than leaving a check that fails for the right reason at the wrong time.

### D-515 · Amends D-334 · (2026-09-04) · The contrast harness asserts its own mirror, and the ten published family ratios move out of a comment into it

**Decision.** `scripts/contrast-tokens.mjs` keeps deriving every ratio from pinned hexes — the no-parser stance in its header is unchanged and no ratio is derived from a file it reads. One new pass at the tail reads `app/globals.css` and `tailwind.config.ts` and asserts that each mirrored key still declares the pinned value: dozens of declarations across three forms (hex, HSL triplet, bare RGB channels), scoped by selector so travel mode's re-declarations are compared against travel mode's pins. A second new table asserts the ten published family ratios as NUMBERS rather than as floors.

**The mirror was the one thing the design could not check about itself.** Pinning the values makes a token change a two-file decision, which is the argument for it; what pinning cannot do is notice that a pin has stopped being what the app paints. A token edit that skipped this file left every ratio here measuring a colour nothing renders, and the run still printed ALL PAIRINGS PASS. Verified by moving a pin 5/255 and by renaming a token out from under its pin: mismatches, exit 1, every ratio row still passing — which is precisely the state that used to be invisible.

**Tolerance is one channel, and it is not slack.** globals.css declares the shadcn keys as HSL triplets rounded to whole degrees and percents (`--primary: 192 100% 62%`), which renders up to 1/255 from the hex the same line is annotated with. That rounding ships today and 1/255 cannot move any ratio in these tables. Anything larger is a real token change and fails.

**All ten published ratios were stale, and every error was conservative.** They were published in a comment marked MEASURED against a field the app no longer paints, so all ten reproduced against a retired background and read low. They are assertions now because a number in a comment has no runner and drifts the next time the field moves, which is exactly what happened.

**Changes if:** a token gains a declaration form this parser does not read (then extend `FORM`, never drop the row); or a published ratio row fires after a deliberate token change, in which case read the printed value and republish it in the same commit.

### D-524 · (2026-09-04) · A zero-argument `toLocale*` call is a lint error, not a sweep item

**Decision:** `eslint.config.mjs` carries a `no-restricted-syntax` rule over `app/`, `components/`, `hooks/`, `lib/` and `core/` (tests excluded) refusing `CallExpression[callee.property.name=/^toLocale/][arguments.length=0]`. The one live violation, `components/travel-essentials-card.tsx`'s FX rate, is pinned to `'en-US'`.

**Why:** three manual sweeps had each left one site behind. Unpinned, the rate rendered `152,7` on a de-DE device beside money from a pinned `'en-US'` formatter — same card, two locales. The rule is what makes the fourth sweep unnecessary; the rule firing on the real defect before the fix, and passing over locale-aware calls that take an explicit argument after it, is the evidence it is shaped right.

**Changes if:** a surface genuinely needs the viewer's locale rather than the app's. Then it takes an explicit `undefined` argument with a comment, and this rule still catches every accidental case.

### D-525 · (2026-09-04, control-chain gap closed 2026-09-22) · `release-gate.mjs` assertions may not chain across independent facts

**Decision:** the `trip/docs/RELEASES.md` block is two independent checks, not one `if / else if` chain. The heading assertions (present, not held) and the preamble assertion (names the newest deploy tag) share no input, so neither may suppress the other.

**Why:** the file's own header promises "every assertion runs even after one fails", and the chain broke that promise: a missing or held heading hid a stale preamble, so the operator fixed the heading, re-pushed, and only then discovered the second problem — the rediscovery loop the promise exists to prevent. Severity was reporting-only (`fail()` sets exit 1 either way, so no bad release could slip through), which is exactly why it survived a human read.

**Two chains, closed on two different dates.** The first cut (2026-09-04) fixed the DATA half: `newestTag` used to be assigned only on the branch where the version was above the newest tag, so every other outcome left it null and silently disarmed the preamble comparison. That is fixed — `newestTag` is now recorded before any verdict. The CONTROL half survived that fix: the preamble check still lived inside the same heading `if / else if` chain, so a held or missing heading still skipped it. Closed 2026-09-22: a held or missing heading now falls through to an independent preamble check rather than skipping it, covered by two new tests in `release-gate.test.ts`.

### D-561 · (issue #517, 2026-09-23) · Moving the default pack to a different shared trip drops its synced local copy

**Decision.** `setDefaultTripShareId` clears the default pack's `syncOutbox`, `itinerary`, `expenses`, `budget`, `docsChecklist` and `myPlaces` slots when the share id changes from one non-empty id to another. Starting to share (`''` to an id) and leaving (id to `''`) keep everything. The Settings and trips-hub paste boxes confirm first, with the handshake's copy.

**Why.** The outbox is keyed by pack, not by remote trip, and the push path reads `getTripId()` only when it sends, so edits queued under trip Y were pushed into trip X after a join. Clearing the outbox alone is not enough: budget and places always merge local into remote, and expenses seeds any leg the remote lacks, so Y's rows still landed in X. Dropping the synced slots makes the join do what D-542 and the join copy already promise, that their plan replaces the one on this device.

**Amendment (issue #572).** Joining a `pack:` token from an unshared pack drops the same slots too, and the paste boxes confirm when any of them is present; otherwise this device's rows merged into the partner's trip. `setDefaultTripShareId` itself still keeps everything on `''` to an id, because the owner's own share button starts sharing through it.
### D-565 · (issue #529, 2026-09-23) · Every loaded device heals its account's identity doc, create-only

**Decision.** On load, `runAccountIdentitySync` reads `profile/identity` from the server. If it is missing, the device creates it in a transaction that writes only when the doc is still absent: `{ version: 1, name }`, or a nameless `{ version: 1 }` when the local name is the placeholder. A failed read writes nothing. The Settings rename still overwrites.

**Why.** Legacy keys had no identity doc and the door rejects a missing one, so a key that worked on the device holding it was locked out everywhere else (Sushil). Create-only keeps two racing devices, or a doc that appeared mid-read, from being overwritten, and treating a read error as "missing" could have written a local name over a real one.

**Amendment (2026-09-24).** The door's own probe (`#10`) fails OPEN on a timeout or offline read, so a mistyped or invented key can be admitted while offline. Left ungated, this heal would then mint a *permanent* identity doc for that key the next time the device is online (identity docs are never deleted — D-341), turning a typo into a standing account. The heal now requires positive evidence the key is a real, previously-synced account before it writes: this device already lists it as a known trip, or the server's `profile/tripList` doc exists. Neither present ⇒ no write; the device stays admitted for the session but heals nothing.

### D-564 · (issue #532, 2026-09-23) · An expense id lives in one leg; a leg move tombstones the old chunk

**Decision.** Pushing a leg chunk tombstones any remote live row whose id this device holds in another leg at a newer hlc, stamped with that row's hlc. The snapshot rebuild keeps one row per id across legs: highest hlc wins, and on an exact tie the live row beats the tombstone.

**Why.** The old leg's push merged its remote copy back in, so a moved expense stayed live in both legs and counted twice. The tie rule exists because the move tombstone reuses the moved row's stamp. Already-duplicated data reads correctly on the next snapshot and the stale leg is tombstoned the next time it is pushed.

**Addendum.** An edit patches only the live row for an id, never its tombstone. Two live rows sharing an id (pre-fix data) collapse to the newest-hlc one before the patch applies. The per-chunk tombstone GC also checks the OTHER legs' live rows before dropping a tombstone, so a sibling chunk's still-live copy of the same id can't resurface once the horizon passes.

### D-566 · (issue #531, 2026-09-23) · Only the tab that clicked Refresh reloads on a SW update

**Decision.** `clients.claim()` fires `controllerchange` in every open tab. Only the tab whose user clicked Refresh auto-reloads; other tabs keep showing the update toast (with their own Refresh action) instead. A passive tab that never reloads may hit `ChunkLoadError` on a lazy chunk the old precache doesn't have — accepted over silently reloading and losing whatever that tab had in progress.

### D-576 · (issue #571, 2026-09-24) · Sign-out clears the Firestore cache; Forget this device also drops the anonymous session

**Decision.** `<SignOutConfirm>` calls `clearRemoteCache()` before `signOut()`. A started instance is terminated and its IndexedDB persistence cleared, and the cached handle is reset. If Firebase never started on this page load, the leftover `firestore/[DEFAULT]/<projectId>/main` database is deleted by name instead. Forget this device also signs out of Firebase Auth (or deletes `firebaseLocalStorageDb`), so the next sign-in mints a new anonymous uid. A plain sign-out keeps the uid, as #10 requires.

**Why.** The wipe cleared web storage only, so the previous traveller's trip docs and the account key path stayed in the Firestore cache on a shared device. The clear is best-effort and gives up after 3 s with a warning: sign-out must finish even when another tab holds the database open or the SDK hangs.
### D-573 · (issue #561, 2026-09-24) · Expenses merge on first snapshot instead of taking remote verbatim

**Decision.** On the first server snapshot a clean, present leg is merged with local, then local rows absent from remote and older than `DEFAULT_GC_HORIZON_MS` are dropped; unstamped rows stay. If a kept row is missing from remote or newer than it, the leg is pushed right away. Same rule as places (#539).

**Why.** Signed-out adds and backup restores stamp an `hlc` but never reach the outbox, so the verbatim apply wiped them on the first sign-in. A cross-leg move is still safe: the old leg's move tombstone wins the merge, and `dedupeAcrossLegs` covers a peer that never wrote one.
### D-569 · (issue #541, 2026-09-24) · The done tick merges on its own stamp, apart from the rest of the row

**Decision.** Itinerary items and docs checklist rows carry an optional `doneHlc`, set to the row's new `hlc` on every done/checked toggle (tick and untick) under sync. `resolvePair` takes `done`/`doneBy`/`doneAt`/`checked`/`doneHlc` as one unit from the row with the higher `doneHlc`, the same way it already joins `ord`. A tombstone winner is returned untouched; a tie, or no `doneHlc` on either side, keeps the body winner as before. A row with no `doneHlc` compares by its `hlc` instead, so an older build's untick still beats an older tick; to keep that fallback from letting a plain edit claim the tick, current builds write the pre-edit key into `doneHlc` on every non-toggle edit.

**Why.** Whole-row LWW let a later notes edit from another device carry the old done state over an offline tick. `doneAt` couldn't be the key: it's wall-clock, only written when a display name is set, cleared on untick, and docs rows don't have it.
### D-567 · (issue #539, 2026-09-24) · Tombstones live 365 days, and places drops stale unsynced rows on first snapshot

**Decision.** `DEFAULT_GC_HORIZON_MS` goes from 30 to 365 days for every synced domain. `subscribeRemotePlaces` still merges on the first server snapshot, but when the places `'list'` chunk is clean it then drops local rows that are absent from remote and whose `hlc` is older than the horizon. Unstamped rows are kept.

**Why.** A device idle past the horizon still held rows whose tombstones the other devices had already dropped, so its first merge brought deleted places and expenses back. Trips are planned months ahead, so 30 days was well inside a normal idle gap; tombstones are small and places already caps them at 200. Taking remote verbatim would have fixed places too, but it wipes a place added while signed out, which stamps an `hlc` and never reaches the outbox. A row can only resurrect after its tombstone is GC'd, so it must be older than the horizon; anything newer is kept.

**Trade-off.** A place added while signed out and left unsynced for more than 365 days is dropped on the next sign-in.

**Caveat.** Builds from before this change still GC at 30 days. Until every device updates, one of them can still drop a tombstone early and a stale peer can resurrect that row.
### D-575 · (issues #570, #573, 2026-09-24) · A synced whole-trip restore must name the shared trip it came from

**Decision.** Backups carry an optional `remoteId` (the shared trip id at export, `''` when unshared). On a synced device a restore is refused unless the file's `remoteId` equals the current shared trip id; a file with none (older backups, legacy itinerary-only exports) is refused there too, and restores only on an unshared copy. Unsynced restores are unchanged. A custom pack's id is its shared id, so an older custom-trip file with no `remoteId` falls back to its `tripId` and still restores. An older default-pack file, or one made before the device started sharing, cannot be restored into the shared trip; that is accepted over risking a cross-trip wipe. Expenses now restore through `restoreExpenses` under sync, the same injected path as my-places.

**Why.** `tripId` is the local pack id, which every shared copy of the default pack has in common, and a synced restore tombstones every live row and pushes. So a backup from one shared trip could wipe another. Expenses were documented as replaced but fell to the merge path, so rows added after the backup survived.
### D-572 · (issue #544, 2026-09-24) · An outbox ack only clears a chunk nothing re-enqueued since its push

**Decision.** The outbox slot gains an optional `seq` map: a per-domain, per-chunk counter bumped on every enqueue. A push carries the counter captured with its state, and `ack` removes the chunk only if the counter is unchanged. Additive, no `version` bump; a missing counter reads as 0, so slots already on disk ack as before. Counters are never pruned on ack, since a reset would let a stale push match a fresh edit.

**Why.** A stale push from one tab could ack a chunk after another tab's newer edit was enqueued; if that edit's push then failed, the chunk was no longer dirty and the first snapshot overwrote it on reload. An older build in another tab drops `seq` when it writes the slot; the counter then reads 0 and a newer build's in-flight ack no-ops (the chunk stays dirty and retries), which is the safe direction.

### D-593 · (issue #599, 2026-09-24) · Holding a trip id lets a signed-in device add itself as a member

**Decision.** firestore.rules gains one update branch, `selfJoinsAsMember`: on a rostered trip, a signed-in non-member may add exactly its own uid as `member` and change nothing else. The profile carve-outs and the 200-entry roster cap are unchanged.

**Why and the cost.** Opening a link and signing in should be enough to join. That makes the trip id the whole capability: a removed member can add itself back, each anonymous uid (one per device or cleared browser) takes a roster slot until the cap fills, and the only real revocation is a new trip id. Publish these rules only after the client self-join (D-595) ships, and only after confirming anonymous auth is enabled in the console, since the rules publish step still reports success without doing anything (#263).
### D-590 · (issues #581, #582, 2026-09-24) · Reload a tab when another tab changes the active trip or identity

**Decision.** `useCrossTabReload` reloads the tab on a `storage` event for the active-trip pointer, the default share, a token going to or from null (sign-in/out), or `localStorage.clear()`. A token rename keeps it non-null and does not reload. While reloading, the tab is marked retiring, and both draft flushes (`useDraftOnBlur` and the docs checklist note) skip their pagehide/unmount commit.

**Why.** An unreloaded tab keeps its snapshot listeners on the old trip while `keyFor` resolves to the new one, so peer edits and local drafts landed in the wrong trip, and after sign-out were written back onto a wiped device. Without the guard on both flushes, the reload's own pagehide would commit the old draft into the new slots. A snapshot landing between the event and unload can still persist; closing that needs the remote adapters to check the trip they subscribed for.
### D-594 · (2026-09-24) · Per-person settings live in their own account doc, merged per field

**Decision.** Settings that follow a person across devices go in `trips/{code}/profile/prefs` as `{ [field]: { v, hlc } }`, where `code` is the account's User Token (storage key 28, `getSyncCode()`), not the display-name slot (key 4). The doc is mirrored locally in storage key 48, which is wiped on sign-out, and a response that lands after sign-out or an account switch is dropped. Each field is last-write-wins on its own HLC. An explicit `setPref` stamps past both the local and the stored stamp inside its transaction, so an edit always wins by commit order; stale stamps only lose when an older value is read back. Writes update only their own field, and `claimField` is a create-if-absent transaction that returns whichever value the account ends up with. The rules' `boundedWrite` caps a doc at 32 top-level fields, so this doc holds at most 32 prefs. Key 47 (`syncPaused`) is a per-device switch and is not synced.

**Why.** `pushTripList` rewrites `profile/tripList` whole with `tx.set` of `{version, trips, removed}`, so any new field there would be erased by older clients. A whole-doc LWW on the new doc would let one device's edit to one setting revert another device's edit to a different one.

### D-597 · (2026-09-24) · "Sync this device" pauses at getRemote(), not at the sync gate

**Decision.** The per-device switch (key 47) makes `getRemote()` reject with `SyncPausedError` (code `sync-paused`). `isTripRemoteConfigured()` is untouched, so the outbox keeps queuing while paused; pushes, snapshot listeners and the presence heartbeat all fail at `getRemote()`. The error is not `permission-denied`, so queued chunks stay dirty and are not counted as refused. Toggling reloads the tab, and a `storage` event on key 47 reloads other tabs. On resume the outbox flushes and each domain's first snapshot merges dirty chunks rather than overwriting them. The auth-only helpers (`getAuthIdToken`, Google link) bypass the switch because they move no trip data. The badge reads "Sync off" ahead of every other state. The pre-flight check reports "Sync is off on this device" ahead of its blocked and pending rows, the presence heartbeat does not start, and adding or removing a device in Trip access is disabled.

**Why.** Gating `isTripRemoteConfigured()` would also switch the outbox off, and edits made while paused would be lost on the next authoritative snapshot.

**Changes if:** sync needs to pause per trip rather than per device.

### D-599 · (issue #603, 2026-09-24) · Home currency is a per-person pref, not a budget field

**Decision.** With an account, the display currency is `homeCurrency` in the account prefs doc (D-594), overlaid onto `useBudget().model`. It is seeded once from the shared `budget.homeCurrency` through `claimField`, never `setPref`. New clients stop writing the shared field, and `commit` pins it to its stored value, but it is never deleted: older clients still read it, and `flatten.ts` falls back to USD without it. Rates stay USD-anchored and `merge-budget` is unchanged. Without an account the pick stays in the budget model on this device. `setPref` now writes the local mirror, marked dirty, before `getRemote()`, so a paused or offline edit is kept; after each server read or snapshot, dirty fields still newer than the account's copy are pushed with their original stamp.

**Why.** Two travellers sharing one budget each want totals in their own currency, and a shared field made one person's pick flip the other's display.

**Changes if:** a total needs to be stored in the home currency rather than only displayed in it.
### D-596 · (issue #602, 2026-09-24) · The journal follows its author across their own devices

**Decision.** Amends D-152 by owner decision. A trip's journal is mirrored to `trips/{code}/profile/journal_{tripId}`, where `code` is the account's User Token (key 28) and `tripId` the local pack id. No token, no remote at all. The doc is `{ entries: { [date]: row } }`, one field so the 32-field cap doesn't bound the trip length. Each date is last-write-wins on its HLC; a delete writes a tombstone `{ deletedAt, hlc }`. An explicit save or delete stamps past both the local and the stored stamp inside a transaction and writes only its own date. Per-date stamps sit in the new trip-scoped key 50. A push that fails stays dirty and retries, keeping its stamp, on the next snapshot or `online` event, where anything newer on the server wins. Entries from before a device had a stamp are stamped at their own `updatedAt` and pushed. Body text is capped at 4000 characters. Photos stay on the device that took them (key 16 and IndexedDB), so another device shows the entry without them. "Clear journal" in Settings stays local: the stamps are kept, so the account copy doesn't refill it. One listener per page, and only while a journal view is mounted. A retry never turns a missing local entry into a tombstone unless the delete was explicit (deletedAt in key 50). The listener binds to the token present at mount. A backup restore re-stamps each restored day, so the restore wins on the author's other devices.

**Why.** The owner wanted a diary written on the phone to be there on the laptop. The account path sits under the User Token, which is never shared, so nothing reaches a shared trip doc. Tombstones stop a delete coming back from a device that was offline.
### D-591 · (issue #583, 2026-09-24) · A failed domain subscribe is reopened on `online` or tab return; a healthy one never is

**Decision.** `SyncPort.subscribe` takes an optional `onDead` callback, fired when the dynamic import of the remote module fails and the subscription was not already torn down. `useDomainSync` then drops its handle, and the next `online` or visible `visibilitychange` flushes and reopens it. The handle is cleared only if it is still the one that died, so a late failure from a torn-down subscription cannot clear a newer one. `onDead` only covers a failed dynamic import: an `onSnapshot` error (e.g. permission-denied) still leaves the listener dead and is not reopened; that fix belongs in the `*-remote.ts` modules and is deferred. The captive-portal case (`armOnlineRetry` waiting on an `online` event that never fires) is deferred.

**Why.** Resubscribing on every focus would re-read every doc across five domains on each tab return, against a 50k reads/day free quota. Keeping a healthy subscription costs no extra reads, so only a dead one is reopened.
### D-592 · (issue #589, 2026-09-24) · A phase header only repeats when the day moves to a later phase

**Decision.** `groupItemsByPhase` amends D-216 (header-boundary rule): `isNewPhase` now tracks the last *headed* phase's rank (morning < afternoon < evening < anytime) and only fires when the current item's rank is higher, instead of comparing to the immediately preceding item. D-142's (LOCKED) no-reorder guarantee still holds; stored/manual order is untouched.

**Why.** A day whose items cross timezones (or are manually reordered) could fall back to an earlier phase mid-list and re-print that phase's header, which read as a bug even though the order was intentional.

**Trade-off.** A manually reordered item that lands under an earlier-ranked header shows under the wrong-looking header; its own time chip stays correct.

### D-595 · (issue #599, 2026-09-24) · A device holding a trip id joins the roster itself

**Decision.** When `ensureMembership`'s server read of the trip doc is refused, the client writes `members.<uid> = 'member'` by field path (never 'owner'), the add D-593's rule allows, and returns `'joined'`. Only the page-load caller in the provider reloads on that, once per trip per session (`selfJoinReload`, key 49), because listeners already refused stay dead; the adoption loop over every known trip never reloads. If the self-add is refused too, or the guard has fired, the access-pending toast shows as before. The provider now enrols `getTripId()`, so a shared default pack enrols under its share id.

**Why.** Under member-gated rules a non-member cannot read the doc, so the read-then-enrol path could never let anyone join.

**Trade-off.** The trip id is the whole capability: a removed member can rejoin. Open trips skip the self-join (the read succeeds). One real change: the provider now enrols a shared default pack, so the device that shared it (marked created-here) writes itself `'owner'` on first load and the pack becomes member-gated, as #501 already does for custom trips. Harmless while the live rules are open.

### D-600 · (issue #604, 2026-09-24) · Trip name/config propagate via `trips/{id}/meta/info.updatedAt`, last-write-wins

Every load of a non-default trip re-fetches meta/info once (no listener) and applies it through `applyRemoteTripMeta`: remote wins only when its `updatedAt` is strictly newer (a missing stamp counts as 0), and the remote stamp is adopted so an unchanged doc is a no-op next load. Carve-outs: a local placeholder name/config is always filled (joiner heal), and a remote placeholder name never replaces a real one. `cityCoords` are per-device: kept locally when the remote lacks them, and a geocode write does not bump `updatedAt`. At most one reload per session and only on a real change. Same client-clock stamp as the synced trip list. Accepted: pre-D-600 clients write no stamp, so their renames don't reach updated devices, and a member with a clock far ahead can pin the name until someone writes a later stamp.
### D-598 · (issue #601, 2026-09-24) · The default pack's share id lives in the account

**Decision.** On each identified page load (`lib/account-share.ts`, run from `app/chrome-islands.tsx`), under a `default-share` Web Lock, the client settles `profile/prefs.defaultShare` through `claimField` alone, whose transaction is the server read (the local prefs mirror is never consulted). A device with no share id mints one, claims it, and adopts whichever id the claim returns; only a device whose own mint won marks the trip created-here. A device that already has an id claims with it: an empty account takes it, and if the account holds a different one the device keeps its own and only logs. Before adopting, every synced domain the pack holds (itinerary days, budget, docs, places, expense legs) is marked dirty so it merges into the trip's first snapshot rather than being replaced. The adopt then reloads in place, at most once per session (`defaultShareReload`, key 51). Other open tabs are not reloaded; they pick the id up on their next load. A failed or offline claim does nothing, and the trip doc is not pre-created. The share id is re-read right before writing, because writing a different one would wipe the pack's synced slots. `setPref` is never used for this field.

**Why.** Minting per device (D-542) gave one person a separate trip on each device.

**Trade-off.** Older clients stay local-only until they update. A person whose devices already hold different ids keeps them apart; nothing merges them automatically.
### D-601 · (issue #605, 2026-09-24) · Prior names follow the account and only ever grow

**Decision.** The names someone renamed away from live in the account prefs doc as one field, `priorNames`, as well as locally (key 30). On boot, sign-in and reconnect, and after a claim, `unionPref` merges the local list into the account inside a transaction and the device adopts the union. Nothing is ever removed; the account list stops accepting new names at 50. The login placeholder is never synced unless it is explicitly claimed.

**Why.** "My edits" on a second device missed items stamped with a name only the first device knew. Per-field last-write-wins would drop one of two concurrent additions.

**Trade-off.** A name added past the cap stays on its own device. Removing a name needs a new rule.

### D-602 · (issues #630, #631, 2026-09-25) · Journal text is capped on the wire, never on the author's device

**Decision.** A synced journal row still carries at most 4000 characters of text. A push never writes that row back over the local entry, and adopting a capped row whose text is a prefix of a longer local entry keeps the local text. Dirty journal days count toward the sign-out warning.

**Why.** Entries written before the input cap, or restored from a backup, lost everything past 4000 characters on every device the first time they synced. Lifting the cap instead would let one long entry push the trip's journal doc past Firestore's 1 MiB limit and stop all its journal pushes.

**Trade-off.** Other devices see only the first 4000 characters. If one of them edits the text, that capped edit comes back to the author's device and replaces the full text. Accepted.

### D-606 · Supersedes the tile clause of D-079 (LOCKED), by owner decision · (issue #646, 2026-09-26) · The basemap is OpenFreeMap vector tiles with an inlined dark style

**Decision.** `lib/map-style.ts` uses OpenFreeMap's vector tiles (`tiles.openfreemap.org`, OpenMapTiles schema) with a small dark layer set written in the file: water, parks, buildings, roads by class, rail, borders, and place/road labels. The OpenFreeMap style JSON is not fetched at runtime and there is no sprite. The source points at OpenFreeMap's TileJSON (`https://tiles.openfreemap.org/planet`) rather than an inlined tile URL, because the dated planet build it names rotates weekly; the TileJSON is one small request, cached for a day. Every label reads `name:latin` only, so MapLibre asks for glyph ranges we host and never Devanagari or kana ones. Glyphs stay self-hosted (D-319). `Noto Sans Regular` gains 256-511, 7680-7935 and 8192-8447 (285 KiB, runtime-cached like the rest, not precached): the ranges a browser probe saw the labels request over Nepal, Japan and the default view, for macrons (Tōkyō), Vietnamese letters and curly apostrophes. Each file is byte-identical to the OpenFreeMap and demotiles copies. Attribution is "OpenFreeMap © OpenMapTiles Data from OpenStreetMap". CSP `connect-src` swaps the CARTO origin for `https://tiles.openfreemap.org`.

**Why.** Around 2026-09-23 CARTO started returning an "API KEY REQUIRED" tile for every keyless request, so the map had no usable basemap. The owner chose OpenFreeMap over registering a free CARTO key: no key, no account, no stated limits. Esri was rejected because its free tiles have no Japan or Nepal detail past z10. Stadia needs a registered domain.

**Trade-off.** Tiles and the TileJSON are still cross-origin and uncached, so offline is unchanged: ground colour, pins and route (D-286). A label with a codepoint outside the hosted ranges logs a 404 and MapLibre draws that glyph locally. Vector tiles stop at z14 and overzoom past it.

**Changes if:** OpenFreeMap changes its TileJSON location or schema · or labels need a script we do not host, which means adding that range under `public/font/`, never a third-party glyph host.
### D-603 · Amends D-598 · (issue #642, 2026-09-25) · Adopting the account's default trip asks before replacing a local plan

**Decision.** When a device with no share id claims and the account already holds a different one, it no longer marks its local plan dirty and merges it in. If the default pack holds no synced data it adopts silently as before. If it does, and the tab is visible, it asks through `replaceLocalPlanCopy` with its own lead line, since the join box's "Their plan" reads wrong for the person's own account and the prompt appears on load unasked. Yes sets the share id, confirms it stuck, then drops the pack's outbox and synced slots and reloads. No marks the session guard and changes nothing, so it is not asked again until the next session. A hidden tab does nothing and leaves the guard unset, so the next load asks. Only a device whose own mint won still marks its plan dirty.

**Why.** Merging on adopt pushed a second device's sample or stale plan into the account's real trip without the person ever seeing a choice.

**Trade-off.** Answering No leaves that device on its own local plan, unsynced, and it asks again next session. The id is written before the drop, so a failed write keeps the local data.

### D-604 · Amends D-521 · (issue #634, 2026-09-25) · `commit()` re-reads its own event again

**Decision.** The `dispatching` ref is removed. The committing instance hears its own CustomEvent and re-reads storage, as it did before D-521. Everything else in D-148's skeleton is unchanged, including where `sync.push` fires.

**Why.** When `save` fails (quota), the committer kept showing an edit that was never stored. Re-reading snaps it back to what storage holds. D-521's skip was only a performance saving.

**Trade-off.** One extra `load()` per mounted instance per commit, which is the full vault chain for the itinerary. With storage fully blocked, every edit now snaps straight back, which is the intended pre-D-521 behaviour.

### D-605 · (issue #644, 2026-09-26) · Profile carve-out covers prefs and journal docs

**Decision.** The `profile/{docId}` carve-out goes through `isAccountDoc()`: exactly `identity`, `tripList` or `prefs`, or `journal_` plus 1-128 characters. Same signed-in floor and `boundedWrite()` shape check, including the 1000-entry journal cap. Delete is unchanged, so members can still remove them (#398).

**Why.** Only identity and tripList were carved out, so `profile/prefs` and `profile/journal_*` fell to the member-only subtree block and were denied whenever the account token was also a member-gated trip id.

**Trade-off.** A stranger holding a gated trip id can plant these two docs under it, the same accepted cost as identity and tripList. rules-check 9b/9c pin the allows and the near-miss ids (`journal`, `journal_`, `prefsx`), and the allows fail against the pre-D-605 rules.

### D-642 · (issue #667, 2026-09-26) · A member can add others only as `member`

**Decision.** `addsMembersOnly()` also requires the count of non-`member` roster values to be unchanged. With no key removed or changed, that means every added value is `member`, so a member can no longer add an `owner` (or any other role). No extra reads. Supersedes ceiling (1) of D-300.

**Status.** Repo only until the rules are actually published (#263). rules-check 7e now expects these adds to be denied.

### D-780 · Amends D-142 (retires its view-order clause) · (owner-instructed, 2026-09-27) · Every day list is chronological; the sort is view-level, and drag now governs the untimed run only
_Renumbered from a second D-606; the id collided with the basemap entry._


**Decision.** A day's plans render in time order on every surface that lists them: the planner's day detail (`lib/phase-of-day.ts`'s `groupItemsByPhase`, which now sorts before it classifies), the Today panel, the Travel-Mode agenda card, the printed itinerary, and the numbered day route on the `/plan` and `/travel` maps (`buildItineraryStops` passes `chrono: true`). One key throughout: `sortItemsByTime`, so timed items ascend by absolute INSTANT, untimed items sink to a single trailing run preserving their own relative order, and equal instants keep their stored order. `groupItemsByPhase` therefore takes the day's date and place offset — an instant-accurate sort cannot be done without them, and there is no second time-math path.

D-142's "stored manual order is what the calendar renders" clause is retired. Everything else in D-142 stands, and so does D-018: the sort is a pure render-time projection, writes nothing, and the persisted order remains the persisted truth. The zero-writes proof in `e2e/sort-clash.spec.ts` is unchanged and still passes on the same bytes.

The `isNewPhase` rank-monotonic guard (#589) is KEPT, not made redundant. Sorting by instant means a day crossing time zones can be in perfect chronological order with its wall clocks running backwards — the 2027-01-09 Tokyo→Detroit day reads 17:35 JST then 15:35 EST — so a phase rank can still drop, and a rank-blind rule would print "Afternoon" a second time beneath "Evening".

Drag-and-drop consequently governs the untimed ("Anytime") run only. A timed row passes `dragDisabled` to `SortableItem`, which tells dnd-kit itself (so the keyboard sensor agrees with the pointer one) and renders a dimmed non-interactive glyph in place of the grip, keeping the row's left edge aligned without putting a dead control in the tab order.

**Why.** A day holding a 3pm plan before a 10am one printed "Afternoon" as the day's first header and then rendered the morning plan underneath it, because headers were emitted wherever the phase changed between two ADJACENT rows in stored order. The plan list disagreed with the clock on the one screen whose job is the clock. Sorting the projection fixes every surface at once and leaves the store alone.

**Trade-off.** Manual ordering of timed plans is gone — their time is now the only thing that places them, which is what was asked for. A drag of an untimed row past a timed one still rewrites stored order, so it can land the row at a different spot within the trailing untimed run than the drop point suggested; the run's own order is all that is observable, so this is cosmetic. On a date-line day the displayed times are correctly ordered but visually non-monotonic, with nothing on screen explaining why — the pre-existing accepted cost `lib/sort-items-by-time.ts` already records, now reachable from the day list rather than only the map.

**Changes if.** Manual ordering of timed plans is wanted back: it returns as an explicit per-day "Time / Manual" toggle, never as a silent reversion, since the sort is what makes the phase headers trustworthy.

### D-651 · Amends D-575 · (issue #657, 2026-09-27) · A pre-adopt default-trip backup restores into the trip it became

**Decision.** When this device turns its own default pack into a shared trip (account mint, account adopt, or the share dialog) it records `{ shareId, at }` under `nepal_japan_default_trip_adopted`. A default-pack backup with no remote id restores into a synced trip only if that marker names the current trip and the file's `exportedAt` is not later than `at`. Everything else without a remote id stays UNMATCHED. Joining never writes the marker, so it is not set inside `setDefaultTripShareId`. Sign-out clears it.

**Why.** The adopt prompt says to back up first, and that backup has an empty remote id, so D-575 refused it once the adopt happened. The only way back was signing out, which wipes local data.

**Trade-off.** Any unshared default-pack backup older than the adopt restores over the shared trip without any further prompt, not just one made on this device.

### D-652 · (issue #674, 2026-09-27) · CI's `e2e` job runs a second, Firebase-configured build for `@firebase` specs

**Decision.** After the behavioural suite, `e2e` rebuilds with `NEXT_PUBLIC_FIREBASE_*` set to fake, `demo-`-prefixed values (no emulator, no credential) and runs `--grep "@firebase"`. Specs tagged `@firebase` self-skip unless `E2E_FIREBASE` is set, so they no-op on every other build and on the first, dormant build in this same job.

**Why.** Trip access and the Google link are gated on `isRemoteConfigured()`, a build-time env read; nothing in CI ever flipped it, so that surface had no real browser coverage at all.

### D-650 · Amends D-148, D-604 · (issue #666, 2026-09-27) · A refused local save is never pushed

**Decision.** `writeString`, `writeJson` and `saveItinerary` return `true` only once `setItem` succeeds, and `false` on every failure (quota, storage disabled or absent, a stringify throw). The synced saves and their store `.set` methods pass that through, and `commit()` skips `sync.push` when `save` returns `false`. `StoragePort.save` is `boolean | void`, so a port that returns nothing still pushes as before. The D-604 snap-back and the `trip:quota-exceeded` toast are unchanged.

**Why.** Local storage is the truth. A save refused for quota snapped back on screen but still synced, so the user re-added the expense and every member saw it twice.

**Trade-off.** A change that fails locally never reaches other devices, even when the network is fine. Restore paths and the outbox flush still ignore the result.

### D-661 · (issue #641, 2026-09-27) · An account id belongs to one uid, and the username is the signed-in email's

**Decision.** Creating `users/{uid}` now also requires the token's email to be `<username>@accounts.trip-planner.invalid`, a lowercase-UUID `accountId`, and `accountClaims/{accountId}` naming the same uid after the write. The claim doc is `{uid}` only, create-only, and must be written in the same batch as the users doc. Signed-in clients may read a claim; nobody may list, update or delete one.

**Why.** `users/{uid}` checked only the shape, so any signed-in device could create an account doc pointing at someone else's account id, or under a username it had not signed in with.

**Trade-off.** Two extra document reads per account link, once. The first claim wins: any new email account that knows an unclaimed account id can claim it in its own link batch. Knowing the id already grants its profile docs, so today the gain is locking the real owner out of linking; once profile access depends on claims it becomes a takeover. `users` docs written before this rule have no claim.

**Before publishing (#263).** List the existing `users` docs in the console and create each one's `accountClaims` doc. Until that is done, nothing may treat a claim as proof of ownership.

### D-662 · Supersedes D-593 · (issue #641, 2026-09-27) · Joining a rostered trip takes a single-use invite

**Decision.** `selfJoinsAsMember` is removed. The owner mints `trips/{tripId}/invites/{token}` (a lowercase UUID) as `{createdBy, createdAt}` with a server timestamp, lists them, and revokes one by deleting it. It expires 7 days after `createdAt`; there is no expiry field. A non-member redeems in one batch: the invite gets `{redeemedBy, redeemedAt}` and the trip gets `members.<uid> = 'member'` plus `joinInvite = token`, both by field path. Each half checks the other, so neither lands alone, and an invite can be redeemed once. The subtree wildcard excludes `invites` so members cannot read, forge or delete them. The share link carries `?trip=` and `&invite=`; for the default pack the trip param is `pack:<id>`, as in existing share links. A plain `?trip=` still joins an open trip and ends at access-pending on a rostered one. The client no longer adds itself to a roster on a refused read. Session key 49 (`selfJoinReload`, D-595) is retired with self-join, and its number must not be reused. Open trips have no owner, so no invites.

**Why.** Under D-593 the trip id was the whole capability: a removed member could add itself back, and any anonymous uid could take a roster slot. Now removal sticks, and each join spends an invite the owner chose to give.

**Trade-off.** One extra read of the invite doc per redeem, and one of the trip doc per mint or redeem; nothing on the heartbeat path. Repo only until the rules are actually published (#263), and publishing them before the invite client ships stops new joins on rostered trips.

### D-660 · (issue #641, 2026-09-27) · Username + password accounts

**Decision.** The front door signs in with a username and password on Firebase Auth (Email/Password), superseding D-239's User Token door. A username is `trim().toLowerCase()` matching `^[a-z0-9_]{3,20}$`, mapped to `<username>@accounts.trip-planner.invalid` (reserved TLD, nothing is mailed); Auth enforces uniqueness, so there is no usernames collection. Passwords are at least 8 characters. Sign-in errors for a wrong password and an unknown username read the same. `users/{uid}` = `{ username, accountId }` records which account id the user owns, and `accountClaims/{accountId}` = `{ uid }` records who owns the id; both are created in one batch and are create-only (D-661). Account ids are lowercase UUIDs, checked by the client before any probe or write; the account id stays in key 28 (`tripPlannerSyncCode`) and still keys `trips/{accountId}/profile/*`. It is never put in the Auth display name or custom claims, because ID tokens go to the Worker.
- **Sign-up** links the device's anonymous session to the new credential, so the uid already in trip rosters becomes the account's, then mints an account id, writes `users/{uid}` and seeds the account docs.
- **Sign-in hands trip access over before it swaps the session.** Rosters name this device's anonymous uid (B), and once the session is the account's uid (A) nobody here can add A. So a secondary Firebase app with in-memory persistence signs in first, learns A and reads `users/{A}` and the account's trip list; then, still as B, every known trip plus every listed trip where B is rostered and A is not gets `members.A = members[B]` (field path). A failed owner grant aborts the sign-in with nothing swapped, since a lost owner role cannot be restored from the client; member grants are best-effort. The secondary app is deleted afterwards. This replaces self-join enrolment, which D-662 removes. A failed `users/{uid}` read is an error, never "missing".
- **First sign-in** (an account made in the console with a temporary password): a missing `users/{uid}` IS the must-change-password flag. The door asks for a new password, then takes the account id from this device's key 28, else a pasted old key (format-checked, then validated by `probeAccountIdentity`; a key it cannot confirm is refused), else starts a fresh account. The link batch is written only after `updatePassword` succeeds. If the id is already claimed by another user the door says "This account already has a username. Log in with it." and offers Start fresh, so a half-done claim cannot retry the same refused id forever.
- The client writes the link once; a retry that finds `users/{uid}` already there adopts the account id it names.
- Logging in overwrites key 28 with the account's id. The trip-list subscribe unions the account list with this device's registry and pushes local extras up, so no trip known here is dropped.
- `getRemote()` signs in anonymously only when there is no session at all. Every password sign-in or link rebinds the cached handle's uid, so presence, membership and trip creation never write under the old anonymous one.
- **Upgrade:** a device already admitted but still on an anonymous session gets the card over the app: sign in with a given username (claiming THIS device's id if `users/{uid}` is missing, or the old-key/fresh choice when it holds none), or create a username + password linked to the anonymous uid, with `users/{uid}` naming the id already in key 28 and no reseed (a device with no id mints and seeds one). When `accountClaims/{key 28}` already exists, the card offers log-in only. A password session with no `users/{uid}` (a claim left half done) resumes at the claim step. "Later" defers to the next load and is offered only before a password sign-in; an unconfirmable check (dormant, offline, auth unreachable) shows nothing. Password sign-in first flushes writes queued under the anonymous uid (bounded).
- A build with no Firebase config admits locally, as the door always has there, and says so on the card.
- All User Token minting and reveal UI is gone: the door's create-and-show-once, the /trips "Finish setting up your account" card, and the Settings key card. The sign-out dialog keeps its show-my-key step only on a device that has no password session yet, since the key is then its only way to claim. The Google link is removed. `tripPlannerToken` stays as the local "admitted" marker.

Amends D-296: the identity probe now runs only on the claim path (plus the display-name read). Amends D-299: anonymous auth is only the pre-sign-in session, and Google linking is removed. Amends D-249: sign-out of a password session also signs out of Firebase Auth; an anonymous session keeps its rostered uid unless it is Forget this device.

**Why.** The owner wants real accounts: a unique username and a private password. A User Token was a bearer credential people had to store themselves, and losing it lost the account.

**Ship order.** The `users/{uid}` and `accountClaims` rules (D-661) must be merged, published and live-probed before this reaches `main`, because key login is gone.

**Owner migration.** A legacy trip owner keeps the role either way: "Create a username and password" links the owner uid itself, and logging in with a console-created account on the owner's device grants the account uid `owner` before the swap. Logging in on a device that is not on the roster carries nothing over.

**Trade-off.** `accountClaims` makes an account id claimable once, but the first claimant is self-asserted: whoever writes the claim first owns the id. Trips on a pasted old key's list are not granted, because the uid they name belongs to a device that is not here; those need an invite (D-662). Until the Firestore rules are published (#263), the password guards the app screens, not the stored data. "Later" was kept rather than a hard block because the `users/{uid}` write is not yet verified against live rules, and a hard block that cannot complete would lock every existing user out. Recovery: there is no in-app password reset yet (it needs an admin path on the Worker with the Admin SDK, deferred). Console "Reset password" sends mail, which cannot reach a `.invalid` address, so the interim is to delete the user and recreate it with a temporary password; the owner then signs in and re-claims with their old key or this device's account id.

### D-663 · Supersedes D-542 minting and D-598 claimField for the default pack · Amends D-662 · (issue #728, 2026-09-28) · The shared trip belongs to three named accounts

**Decision.** For the shared trip id (`isShared()` in `firestore.rules`) the rules ignore the trip doc and its roster. Read and write go to a token whose email is `powan@`, `uttam@` or `sushil@accounts.trip-planner.invalid`, and to nobody else. There is no `get()` on that path, so it holds when the trip doc or its members map does not exist, and a members map someone writes there grants nothing. Invites and the meta/profile carve-outs are closed for that id. Every other trip is unchanged.

**Why.** Only people with trip access may see, read or write it. An absent doc read as open, so any signed-in device that knew the id was in.

**Trust basis.** Auth email uniqueness. The three accounts exist, so EMAIL_EXISTS stops anyone else signing up with those addresses. Never delete and recreate one of them: the D-661 recovery does exactly that and leaves a window where a squatter can take the email.

**Supersedes.** The default pack is no longer minted per device (D-542) or shared through the account's claimField (D-598), and the D-597 pause goes away for it. D-662 invites do not apply to this trip.

**The id must be an existing trip doc.** Use the owner's current trip id, or create the doc in the console first. Nothing in the client creates `trips/{shared}`, `sharedTripReadable()` needs `.exists()`, and the Worker's concierge gate (a user-token GET, `res.ok`) turns a missing doc's 404 into a 403. A fresh id would never sync anyone.

**Client gate.** The anonymous-session gate applies to shared-trip content only, not to the invite, meta or profile paths.

**Ship order.** Before publishing, the owner checks the Auth console lists all three users (`powan@`, `uttam@`, `sushil@accounts.trip-planner.invalid`). EMAIL_EXISTS is the only thing stopping a squatter, so create any that is missing first. Then publish the rules and probe them with real headers. The id is in the branch, so it is public on the first push; until the rules are live, anyone who reads it can reach the trip. Publish and probe before the branch merges, and push only when the window is acceptable.

**Trade-off.** Denied reads still count against the free quota; App Check is the upgrade path. Adding a fourth person means editing the list and publishing.

### D-673 · (issues #761, #762, 2026-10-03) · A deploy is checked against the live site

**Decision.** `deploy.yml` has a `smoke` job after `deploy`, on push to `main` only (never in `ci.yml`, which pull requests run). It is read-only (`contents: read`), uses no secrets, and runs no schedule. The build job records the sha256 of `out/sw.js`; smoke polls the live `sw.js` for up to ten minutes (Pages caches about ten; the job times out at fifteen) until the bytes match, then requires 200 on `/` and the manifest with a `start_url` under the repo base path, and an OPTIONS preflight to the concierge Worker answering 204 with `Access-Control-Allow-Origin`. It never sends a POST, and skips the preflight if the repo variable is unset.

**Why.** `deploy-pages` succeeding only means Pages accepted the artifact. With no rollback (see `rule.md`), a stale or broken live site should show up in the run, not on a traveller's phone.

**Trade-off.** A red smoke does not stop or undo anything, since the deploy already happened. The only alert is GitHub's default failure email to whoever merged. Recovery stays forward-only. The hash is passed as a job output rather than downloading the Pages artifact, which avoids another action.

### D-672 · (issue #758, 2026-10-03) · The active worker refills a precache the browser emptied

**Decision.** On every online page load with a controller, the registrar posts `REPAIR`. The worker calls `registration.update()`, stops if a worker is installing or waiting, then fetches only the `PRECACHE_URLS` missing from the current precache and puts each one on its own. A failed fetch skips that entry. It never deletes and never touches another cache. Every entry must pass `isExpectedPrecacheBody`, and route pages and RSC `.txt` payloads must also contain this build's `BUILD_ID`, which gen-sw reads from `.next/BUILD_ID` and fails without.

**Why.** Install was the only thing that filled the precache, so clearing site data while the registration survived left the app with no offline shell until the next deploy.

**Not atomic, on purpose.** Install stays atomic. Repair runs under a worker that is already serving, so a partial refill is strictly better than none, and a throw there would only lose the entries that did succeed.

**Torn deploys.** The update check catches a deploy the worker can see. The guard for the rest is the `BUILD_ID` on HTML and RSC payloads, not chunk overlap: hashed chunks are shared between builds, so a newer page can load ours, but it carries its own build id. A captive portal carries none. Unhashed files (icons, hero images, the manifest) only get the content-type check, so a torn refill there keeps a neighbouring build's bytes until the next deploy.

**Not covered.** An uncached route still falls back to the Home shell rather than the 404 page; that is the other half of #758. Preflight's map-shell row still reads a partly filled precache as present.

### D-671 · Amends D-156 and #239 · (issues #750, #751, 2026-10-03) · Restore under sync keeps place ids and re-points receipts to reminted expense ids

**Decision.** A synced restore picks the id policy per domain. Saved places keep their ids: each live backup row is upserted under its own id, stamped with `nextSyncStamp` off the current row for that id (live or tombstone) or the backup row, and only current rows missing from the backup are tombstoned. Expenses still get fresh ids. `restoreExpenses` returns a backup-id to new-id map (or `false`), and `importTripBackup` commits the domains before the photo index so restored receipt metas, or the live ones when the file brings no photos, follow that map. The expenses-only settings restore re-points live photos the same way. A file with an empty photo list leaves this device's photos alone. The import result lists domains that were present but malformed (`dropped`), and clearing expenses removes receipt photos from this device.

**Why.** Plan items link to a place by `sourceId: 'myplace-'+id`, and receipts link to an expense by id. Reminting both on restore orphaned every plan link and receipt. Same-id is safe for places because they live in one doc and a strictly-later stamp beats the tombstone (the undo path already relies on it). Expenses can change leg, which moves them across chunks, and a same-id re-add there hits the cross-chunk tombstone tie (#532).

**Trade-off.** Receipts that were already orphaned stay that way. There is no clean-up of photos whose expense is gone, because the stores may not be hydrated when it would run and it would delete real receipts.

### D-670 · Extends D-150 · (issue #748, 2026-10-03) · A failed push retries on a timer, and sign-out flushes first

**Decision.** `useDomainSync` keeps one retry timer per domain, armed by `SYNC_OUTBOX_CHANGED_EVENT` while that domain has a dirty chunk the rules have not refused (`outboxRetryable`). Backoff starts at 10s, above the 8s remote write timeout so a timed flush never joins a slow commit push, and doubles to a 5 min cap, for at most 6 attempts. Mount, `online` and tab-visible reset the count; an edit pushes itself once. A clean outbox, unmount, an identity change, the sync gate closing, or `navigator.onLine === false` stops it. Refused chunks (#267) never arm it. `flushOutbox`'s in-flight guard is now a map of promises with a rerun flag: a flush landing mid-run makes the running one take one more pass instead of returning, so an `online` flush is not lost behind a failing offline one. `flushAllDomains()` flushes every mounted domain; the sign-out dialog awaits it, bounded at 8s (the remote write timeout), before clearing blobs, the remote cache, or local data, and shows "Syncing your last changes…" in a status region meanwhile.

**Why.** A failed push stayed dirty until the next foreground or edit, so a traveller who stayed on one screen never synced, and sign-out wiped those edits without trying once more.

**Trade-off.** Up to 6 extra writes per stuck chunk per trigger, which the cap exists for (free-tier write budget). Sign-out can take up to 8s longer on a dead network. A push that acks after the sign-out wipe can write `{dirty:{}, lastAckAt}` into the wiped slot, which is harmless.

### D-679 · Extends D-420 · (issue #754, 2026-10-03) · A day that is still running is not over at the destination's midnight

**Decision.** `getTodayInTrip()` in `lib/trip-now.ts` keeps the previous trip day while one of that day's items is in progress at the current instant. An item counts only if it is not done and has a real duration (`core/dates/carry-over.ts`'s `hasItemInProgress`). It applies only on the real clock with known geography, looks back one day only, and runs after D-420's device-window gate, so it never puts a day outside the trip.

**Why.** At 13:15 EST on Dec 9 the JFK to DEL long-haul is in the air and Kathmandu passes midnight. The hero switched to Day 2, the flight dropped out of it for about 13 hours, and expense and quick-add rows were dated Dec 10. The 23:30 KTM departure did the same from 00:00 to 03:40 NPT on Dec 19 and showed "Upcoming: Layover CAN". Now Day 1 holds until the flight lands at 07:50Z Dec 10, and Day 10 until 21:55Z Dec 18. In both cases the next day's first item starts at the moment the hold ends.

**Trade-off.** Any cross-midnight item with a duration holds the day, a late night out as well as a flight. A night out still belongs to the evening it started, so that is the intended reading. The open-ended "until the next item, max 2h" block never holds a day. Each call reads the stored plan once, on the 20 to 60s ticks the callers already run.

**Not done here.** `getNowAtTrip()` still reports the destination wall-clock date and minutes (concierge digest, weather, visit autocount). Its date and minutes have to agree with each other, so it does not hold. The flight chip's in-flight state already reads the journey's arrival day (#812).
### D-675 · Amends D-546 and D-504 · (issue #775, 2026-10-03) · A join refuses ids that are not trips, and the front door never switches trips

**Decision.** `parseTripToken` reads the shared trip's id, bare or `pack:`-prefixed and in any case, as the default pack, and refuses any other `pack:` id and the legacy account names (`SHARED_TRIP_USERNAMES`, case-folded). `joinTrip` still switches to a row the registry already holds under such an id, and parse/merge never drop one, because its `trip:{id}:*` data lives under that id. The sign-in wall no longer calls `joinTrip`: after redeeming any invite it reloads to `/?trip=<token>` and the join dialog asks first, as it does for a signed-in device.

**Why.** A link could set a legacy account path or the shared trip's own id as a custom trip, and the wall switched trips without the confirm the dialog exists for.

**Trade-off.** Other people's account ids are uuids, the same shape as trip ids, so the client cannot tell them apart and does not try. Only the rules can refuse those. Cancelling the confirm after the wall leaves the redeemed membership written with no registry row; opening the plain `?trip=<id>` link again joins it (the invite reads as already used).
### D-674 · (issue #753, 2026-10-03) · The sync badge counts queued journal days and prefs

The badge read only the outbox, so it said Synced while a journal day or an account pref was still waiting to push, and those two only retried while their own view was mounted. `pending` now adds the active trip's dirty journal days and dirty pref fields, behind the outbox's gate plus an account code (the same gate their push uses), so a guest never sees a count nothing will clear.

**A refusal is blocked, not pending (#267 parity).** A journal day or prefs push the rules refuse stays dirty, is recorded for this page load only, is skipped by every later flush until reload, and counts in both `blocked` and `pending`, so `blocked` stays a subset and the badge and pre-flight show the refused row instead of Pending forever. Concurrent flushes of the same queue share one run.

Both mirrors dispatch the outbox's change event on every write, so an ack clears the badge without waiting for the minute tick. The badge, which is mounted app-wide, runs a one-shot push of both queues on mount, on `online`, and when the tab becomes visible.

**Not a listener.** Mounting the journal's snapshot stream app-wide would cost a read on every change for the life of the page. The one-shot push costs nothing when nothing is dirty, and one transaction read per dirty day or per prefs flush otherwise.

### D-676 · Amends D-334's text-tier clause · (issue #781, 2026-10-03) · The base app gets an outdoor floor: --text-lo #BEB4D6, 12.75px micro, .9 stamp scrim

**Decision.** Three moves for reading the base app in sunlight, not only in Travel Mode (D-165). (1) `--text-lo` goes `#A79BC0 -> #BEB4D6` (and `--muted-foreground` with it): lighter, same hue family, 7.24:1 on `--surface-3` where it was 5.48. hi and mid do not move. (2) `--t-micro`, the size floor, goes 11.69px -> 12.75px, so it now equals `--t-label`. The hero countdown labels move off their 10px literal onto `text-t-label`. (3) The Must-See stamp scrim on guide photos goes .72 -> .9 (6.84 np-a / 7.64 jp-a on a pure white pixel).

**Why.** The floor tier and floor size are what every meta row, chip and key reads at, so they bind first outdoors. Lifting the tokens fixes ~728 tier sites and every micro label at once instead of re-tiering them one by one.

**What did not change.** The tier is still one value, so the D-334 rule of three tiers and no fourth holds. Five harness guards (`--text-lo` over the hero photo, capped hero NP/JP, wall cover, np-a 18% screen) now pass and moved into `pairs` as "not used" floors. The authoring rules they guarded (no floor-tier words over a photograph, tint screens cap at 14%) stand. Loosening either is its own decision.

**Trade-off.** `--t-micro` and `--t-label` are the same size, so a mono-caps key over a label value now differs by family, case and tier, not size. The mid/lo tier gap also shrank to about 1.20:1 luminance, so hierarchy leans on size, weight and case. Visual baselines move app-wide.

**Changes if:** a layout cannot fit 12.75px (then move that site, never the floor back down); or someone re-tiers hero copy using the new numbers.

### D-677 · Extends D-420 · (issues #789, #791, 2026-10-03) · Day-of readers use the hero's day

**Decision.** `getTripDayDate()` in `lib/trip-now.ts` returns `getTodayInTrip()?.date`, else the device's own calendar day. The journal's missed-day picker, the passport stamps, both recaps, the wrapped story and the home stat row read it in place of `getNowAtTrip().date`. The ones that read it once on mount now re-read on the shared travel tick (20s, plus a catch-up on tab visible), so a page left open past midnight moves on. `getNowAtTrip` is unchanged and still feeds the concierge digest, the weather card (the forecast day is the destination's), the hero's post-trip check and visit autocount.

**Why.** On a home-time phone the destination-only day disagreed with the hero at both trip edges: from 13:15 EST on Dec 8 these surfaces already showed Dec 9 while the hero counted down, and from 10:00 EST on Jan 9 the recap unlocked while the hero said Day 32.

**Data.** The journal picker now offers a day only once the hero has reached it, so Dec 9 is no longer offered on Dec 8 evening at home. Entry keys are still the day the user picks, and existing entries are untouched.

**Not done here.** The preflight clock row's `onTrip` (`lib/preflight.ts`) still uses the destination-only gate; that file is in another open change. Visit autocount and the hero's post-trip check still read `getNowAtTrip`, so on Dec 8 evening EST autocount can credit Day 1 places early.

### D-696 · Extends D-675 · (issue #852, 2026-10-04) · Joining a trip needs a 20-character token

**Decision.** `parseTripToken` in `core/trips/registry.ts` refuses a custom token shorter than `MIN_TRIP_TOKEN_LEN` (20), so `joinTrip`, the `?trip=` handshake and the front door's held link all refuse it with the existing "incomplete code" copy. The floor is a length, not a UUID check, so a long hand-made id still joins. The default pack's own slug is exempt (it is the way back to the pack), and `isSafeTripSegment` is untouched because it guards stored paths. `joinTrip` and the handshake already let a row this device holds through, so existing short-id trips keep switching.

**Why.** Any 1-128 character token such as "abc" joined, and `reconcileFirstSnapshot` then seeded that trip doc, so a mistyped or guessed token landed on a world-guessable open trip. App-minted ids are v4 UUIDs.

**Unknown.** A live trip with a short hand-made id that no device has joined yet can no longer be joined fresh. Owner to confirm none exist.
### D-693 · Extends D-600 · A newer local trip name/config is re-pushed at boot (#846)

**Decision.** `runTripMetaSelfHeal` already reads the remote `meta/info` on every load. When the active trip's local `updatedAt` is strictly greater than the remote one (a missing remote stamp counts as 0), it calls `pushTripMeta` with the local name, config and stamp. Equal or older local pushes nothing.

**Why.** `pushTripMeta` is a blind `setDoc` whose failure is swallowed. A rename queued offline on one device can land after a newer rename from another, and the newer device never wrote again, so the two disagreed for good.

**Not done.** A compare-and-set transaction inside `pushTripMeta`: `runTransaction` throws offline and would break offline rename, which the persistent cache queues today. Known limits: only the active trip is healed (a stale rename on another trip waits until that trip is opened), and a device clock set far ahead wins until the others write, the same ceiling as D-600.
### D-695 · (issue #848, 2026-10-04) · A day push keeps remote itinerary rows this build cannot parse

`pushDayMerged` rebuilt the day from the rows `sanitizeItineraryItems` accepts, then `tx.set` wrote that, so an older build erased a newer peer's row it could not read (e.g. `lat` as a string). The write now appends every raw remote row that is an object with a non-blank string `id` not already in the merged items, verbatim and untouched by tombstone GC. Rows with no usable id (null, primitives) are still dropped. The push is not refused: one unreadable row would otherwise block the whole day. The local copy never sees the kept rows.

Sibling row sanitizers in the other synced domains have the same class of risk; not touched here.
### D-692 · Extends D-591 · (issue #845, 2026-10-04) · A dead read listener reopens on backoff and the badge says it is not receiving

**Decision.** Each `subscribeRemote*` (itinerary, expenses, budget, docs, places) takes the port's `onDead` and calls it on both a setup failure and a non-permission stream error, instead of arming its own `online` wait; with no `onDead` the old `online` retry still runs. `useDomainSync` clears the dead handle and reopens on the D-670 schedule (`RETRY_BASE_MS` doubling to `RETRY_MAX_MS`, `RETRY_MAX_ATTEMPTS` tries, none while `navigator.onLine` is false). The count resets on `online`, tab return and identity change; past the cap only those events reopen. A permission-denied read stays no-retry (#271). `core/sync/read-denied.ts` gains `setReadDead`/`isReadDead` on the same change event, cleared by the next good snapshot; `SyncStatus.readDead` is false while sign-in is required. The badge shows "Not receiving updates" in amber (`data-state="dead"`), below a refusal and above a pending count.

**Why.** On a weak or captive network `navigator.onLine` stays true, so no `online` event came and the listener stayed dead until reload while the badge read "Saved Xm ago". This closes the two cases D-591 deferred: stream errors and the captive-portal wait.

**Cost.** A reopen is a fresh listen that re-reads the domain's docs, at most six per domain per outage.
### D-690 · Extends #518 · (issue #843, 2026-10-04) · A remote forget keeps this device's pending work

**Decision.** `importRemoteTrips` skips `wipeForgottenTripData` for an id with unsynced edits (`unsyncedEditCountFor`) or device-only photos (`localPhotoCountFor`). The entry still leaves the list and the tombstone is still recorded; nothing is stamped or stripped, so the forget does not bounce back to the device that made it. A local forget (`removeKnownTrip`) still wipes everything.

**Why.** Device A forgetting a trip made device B's next trip-list snapshot delete B's offline edits and its photos, which exist nowhere else.

**Known ceiling.** The kept `trip:{id}:*` data sits on disk with no list entry. Re-joining the trip or forgetting it locally clears it. No prompt, no UI.
### D-691 · Extends D-230 and D-569 · (issue #844, 2026-10-04) · The editor saves only the fields it changed

**Decision.** `handleSaveItem` sends `itemPatch(editingItem, saved)` to `updateItem`: the keys whose value differs from the item the editor opened with, over the union of both key sets. A key cleared to `undefined` is kept, since that is how the editor clears location, notes, coordinates and end date.

**Why.** The whole-item patch put `done` in every edit, so `stampDone` re-stamped `doneBy`/`doneAt` on a notes edit of a done item (D-230 says immutable) and `doneHlc` took the edit's stamp, so an editor opened before another device's tick could revert it on save (D-569). It also carried stale `rev`/`hlc`/`ord` over fresh local values.

**Not changed.** `core.updateItem` still gates on `'done' in patch`; every other writer already sends partial patches. The merge in `core/sync` is untouched.

### D-704 · Extends D-674 · (issue #857, 2026-10-04) · A journal restore pushes the dates it removed, too

Restore replaces the whole local journal but pushed only the dates in the file, so the account journal doc kept the days the backup lacked and other devices still showed them. The journal `write` in `trip-backup.ts` now reads the pre-restore local dates before the write and pushes the union with the backup's dates. `pushJournalEntry` already tombstones a date that is absent locally with a sync record, and no-ops when it has none, so no new primitive and no new reads: one transaction per date on the single journal doc, as before.

The `ok` gate stays: a refused local write pushes nothing.
### D-703 · Extends D-540 · (issue #856, 2026-10-04) · The rules no longer let an owner delete the trip doc

**Decision.** `allow delete` on `trips/{tripId}` drops `|| isOwner()` and keeps only the open-trip branch (`isOpen() && request.auth != null`). A trip with a roster cannot be deleted from a client, owner or not.

**Why.** Subcollections outlive a deleted doc, and a trip id with no doc reads as open (D-540), so the orphaned tree became readable and writable by any signed-in holder of the id, who could also re-create the doc as owner. No client path deletes a trip doc today; this closes it before one exists.

**Not changed.** The repair for a malformed or empty roster still deletes (those read open). The console and admin SDK bypass rules. These rules are not published by this change; publishing stays an owner step.
### D-702 · Extends D-650 · (issue #855, 2026-10-04) · `saveItinerary` refuses to overwrite a newer envelope

**Decision.** `saveItinerary` reads the stored value first and, if its `schemaVersion` is above `CURRENT_ITINERARY_VERSION`, warns and returns `false`, the same refused-save result as D-650, so `commit()` skips the push and snaps back. A missing, unparseable or older value writes as before, and older versions still upgrade on write.

**Why.** A stale bundle (service-worker skew) reads a future envelope leniently, and its next save rewrote it as the current version, silently downgrading data a newer build had written.

**Not changed.** Import still writes through `writeString` and bypasses the check. No toast or UI.

**Trade-off.** Switching to an older branch on the same localhost origin locks saves until site data is cleared. The warning says so.
### D-701 · Amends D-199 · (issue #854, 2026-10-04) · Restore stops reading a gzip file once it unpacks past 64 MB

**Decision.** `decompressBlobOrText` reads the decompression stream chunk by chunk and, once the output passes `MAX_IMPORT_BYTES`, cancels the stream and throws "That file is too large to open (over 64 MB once unpacked)." The prefix is the one `trip-backup.ts` already keys on, so Restore shows its usual "No changes were made" line.

**Why.** The 64 MB cap measured the compressed file only. A small crafted archive inflated without limit through `Response(stream).text()` and froze the tab.

**Not changed.** The cap is the existing constant, so a real backup is bounded the same whether it arrives plain or gzipped.

### D-700 · Amends D-356 · (issue #853, 2026-10-04) · Forgetting a trip deletes its exact slot keys, not a prefix

**Why.** Trip ids may contain `:`, so the `trip:a:` sweep in `wipeTripData` also deleted the data of a hand-made trip `a:b`.

**Decision.** `wipeTripData` removes `keyForTrip(id, slot)` for each `TRIP_SCOPED_SLOTS` member. Only `keyForTrip` writes `trip:` keys, so nothing is orphaned. `wipeAllTripData` keeps its prefix sweep because it wants everything.
### D-699 · (issue #851, 2026-10-04) · The first-snapshot seed needs a confirmed server read

**Decision.** In `reconcileFirstSnapshot`, if `getDocFromServer` fails and the cache fallback also lacks the trip doc, the reconcile applies a non-empty remote (never an empty one) and returns. It no longer runs the seed, whose non-merge marker `setDoc` could overwrite an existing `members` map on the owner device. A cache hit still counts as the doc existing.

**Not done.** The stale-backup warning is deferred. The dead `pushPlans` is not removed.
### D-698 · (issue #850, 2026-10-04) · A synced reorder keeps live rows missing from its id list

**Decision.** Under sync, `reorderItems` appends every row of the day absent from `orderedIds` (live and tombstones), not just tombstones.

**Why.** The id list comes from the drag render. A peer row that arrives before the commit was dropped by the core reorder, and a drop that had already been pushed is not healed from remote.

**Not changed.** The core drop of unlisted rows and the cross-day branch in `use-calendar-dnd.ts` (unreachable today).
### D-705 · Extends D-103, D-106 · (issue #847, 2026-10-05) · Concurrent edits to different fields of one item both survive

**Decision.** Itinerary items carry an optional `fieldHlc`, a map from field group to the `hlc` of that group's last change. The groups are `title`, `time` (`time` + `startMinutes`), `duration` (`duration` + `durationMinutes`), `notes` and `location`. `resolvePair` joins each group from the row with the higher stamp, apart from the body winner, the same way it already joins `ord` and the done state (D-569); the merged `fieldHlc` is the per-group max. A tie keeps the body winner, a tombstone on either side is left to the body winner, and a group with no stamp compares by the row's `hlc`. Under sync, `updateItem` stamps a group with the new `hlc` only when its value actually changed (compared against the stored item, since the editors send the whole form on every save) and writes the pre-edit key for the rest; the rename-and-claim pass writes pre-edit keys for all. Everything else on the row (category, pin, source link, ...) still follows the body winner. No migration, no Vault version bump; `freshCopyOf` strips `fieldHlc` like the other stamps.

**Why.** Whole-row winner meant A's notes edit and B's time edit of the same item, made concurrently, resolved to whichever row had the higher `hlc` and the other edit vanished silently. D-103 put field-level merge out of scope for *same*-field edits; this is the different-field case it did not address, and it needs no CRDT: same-field edits still resolve last-writer-wins, per group.

**Compatibility.** An older build ignores `fieldHlc` and edits the whole row; its row carries no (or a stale) stamp per group and compares by `hlc`, so its edit still beats an older per-field edit. Stale `fieldHlc` left on a row by such a build can make a newer peer edit lose a group it should have won; same accepted ceiling as `doneHlc`.

**Not done here.** Category, pin and source-link fields stay whole-row. No "overwritten" notice in the activity feed: a same-group collision is still last-writer-wins and silent.


### D-706 · Extends D-650 · (issue #851, 2026-10-05) · The restore confirm names a stale backup's age, and the dead `pushPlans` is gone

**Decision.** Under sync, picking a backup file reads its `exportedAt` (`backupAgeDays` in `lib/trip-backup.ts`, read-only and best-effort), and when it is `STALE_BACKUP_DAYS` (7) days old or more the "Replace your current trip?" confirm adds one line: the backup's age in days, and that anything the others added or changed since will be removed for everyone. Nothing blocks the restore, a fresh or unreadable stamp shows no line, and an unsynced device never reads the file early. `pushPlans` and `dayEquals` in `lib/itinerary-remote.ts` are deleted: nothing in production called them since the outbox-decorated `pushDayChunk` took over, and the guest gate they carried lives in `withOutbox`. Their tests go with them, and the two that exercised the transactional merge now call `pushDayChunk`.

**Why.** A synced restore tombstones every live row, including items peers added after the file was made, and the only warning was generic. The age is the one fact in the file that tells the user how much they are about to lose.

**Not done here.** The seed guard from the same issue shipped earlier.

### D-707 · Extends D-662 · (issue #858, 2026-10-05) · An owner can make another member an owner, and step down while a second owner exists

**Decision.** `setTripMemberRole` in `lib/trips-remote.ts` writes `members.{uid}` as `'owner'` or `'member'` through the same field-path write as add and remove. The members list in Settings shows an owner a **Make owner** button on each member row and a **Step down** button on their own row, each behind a confirm. Step down is offered only while the roster names a second owner. `firestore.rules` is unchanged: it already let an owner write any well-formed roster (`isOwner()`), refuses one that names no owner (`rosterIsWellFormed`), and refuses a member's role write (D-642); `scripts/rules-check.mjs` now pins the promote, step-down and hand-back writes.

**Why.** The rules header promised owners could change roles, but the client only added `'member'` or deleted, so a trip whose owner device was lost, or whose account was deleted and recreated (D-660), had nobody who could remove a device or mint an invite. A second owner removes that single point of failure.

**Not done here.** A trip whose only owner is already gone cannot be recovered from the client, since only an owner may write a role; that would need a rules change or an out-of-band repair (`scripts/roster-inspect.mjs`). Owners are not told when a co-owner steps down.

### D-708 · Extends D-642, D-662 · (issue #859, 2026-10-05) · A member can leave a gated trip by removing its own roster key

**Decision.** `leavesRoster()` in `firestore.rules` lets a member write an update whose only affected key is `members` and whose only change is removing the writer's own uid: nothing else removed, added or re-roled. An owner leaves through `isOwner()` as before, so `rosterIsWellFormed()` still refuses a roster left with no owner and the last owner cannot walk away. `leaveTrip` in `lib/trips-remote.ts` makes that write, and Settings shows **Leave this trip** (behind a confirm) to a member, or to an owner while a second owner exists; the card then says the device has left. Leaving does not forget the trip locally; that stays on the Trips page. `scripts/rules-check.mjs` pins the leave, the two refused extras and the read denial afterwards.

**Why.** `addsMembersOnly()` refused every removal from a non-owner, so a member had no way out of a gated trip short of asking the owner.

**Not done here.** The other half of the issue stands: any member can still add any uid, including one the owner removed, so "removal sticks" (D-662) holds against self-join but not against another member adding the uid by its code. Closing it needs either owner-only adds, which undoes the "send me your code" flow of D-642, or a removed-uids list in the trip doc that every add is checked against. That is a product call and is left open.

### D-709 · Extends D-662, D-642 · (issue #859, 2026-10-05) · Removal does not block a re-add; accepted ceiling

**Decision.** A member removed from a gated trip can be added again by any member through `addTripMember` (D-642), or by an owner minting a fresh invite (D-662). No removed-uids list is kept. The leave half of #859 shipped as `leavesRoster()` in `firestore.rules` and `leaveTrip` in `lib/trips-remote.ts` (PR #896).

**Why.** Removal cannot hold against a member who wants the person back. Invites are owner-only to mint, but `addsMembersOnly()` takes any uid, and a removed person can show up under a new anonymous uid, so a tombstone on the old uid blocks nothing that matters. It would add a trip-doc field and a `get()` on every add, touch the open-roster reading (D-540), and need a rules publish, which is inert until #263.

**Trade-off.** An owner who removes someone cannot stop a member re-adding them. Remove the member who re-adds, or move the trip to a new id. Revisit if rules enforcement becomes real (#263) and a stricter add path is wanted.

### D-710 · Amends D-349, extends D-672 · (issues #944, #945, 2026-11-01) · Runtime-cached assets get their own cache, and install refuses another build's pages

**Decision.** Same-origin files the build ships but does not precache (lazy chunks, the maplibre engine and worker, the glyph PBFs) are listed in `sw.js` as `RUNTIME_URLS` and runtime-cached into `trip-runtime-<hash>` instead of the per-build precache. Activate keeps that cache and prunes it to the current list. The hash covers the unhashed files (maplibre worker, glyphs), so a maplibre bump drops the cache whole. Install now applies repair's `BUILD_ID` check to every page and `.txt` payload and throws on a mismatch; gen-sw fails the build if any precached page lacks the id. A failed install deletes the cache it created. Install writes `/__precache-urls.json` into the precache last (repair writes it too), and the preflight map row reads every `trip-*` cache for the engine and passes only when some precache holds every URL on that list.

**Amends a LOCKED decision, pending owner confirmation.** D-349 is LOCKED and says the engine is backfilled "into the same cache the checks read", the precache. That clause moves: the engine is backfilled into `trip-runtime-*`, and the preflight reads every `trip-*` cache. The rest of D-349 (engine and glyphs withheld from install, the `/map` cold-offline boundary) is unchanged.

**Why.** Activate deleted the old precache and the engine with it, so every update undid the "Saved on this device" check. A torn deploy could also commit the previous build's HTML next to new chunks, and a failed install's partial cache was read as saved.

**Not done.** Devices that cached the engine before this ships lose it on the first update, as before. The nav backfill still writes unverified route HTML into the precache.

### D-711 · (issue #946, 2026-11-01) · The error screens can apply a waiting update

**Decision.** The registrar re-reads `registration.waiting` after every update check and shows the update toast again (same id). `app/global-error.tsx` Reload and `app/error.tsx` Try again call `applyWaitingUpdate()` (`lib/apply-sw-update.ts`) first: it runs a capped `update()` when online (skipped offline), then posts `SKIP_WAITING` to a waiting worker, online or not, and waits up to 3 s for `controllerchange`. Try again then reloads if a worker was applied, otherwise resets as before. Rendering still needs no network.

**Why.** A dismissed toast never returned, and a crashed root layout took the registrar (the only `SKIP_WAITING` sender) with it, so Reload kept serving the same cached shell.

**Not done.** A worker still installing when the button is pressed is not waited for, and there is no "reset offline copy" action.

### D-725 · (issue #985, 2026-11-02) · Unreadable device-only data is copied before the next save

**Decision.** The journal, packing, photo index, share inbox and favorites stores read through `readDeviceOnlyJson` in the gateway. When the stored bytes fail to parse, or parse to a scalar the store refuses, the raw string is copied into the new trip-scoped slot `localRescue` (key 54: `nepal_japan_local_rescue` on the default pack, `trip:{id}:localRescue` on a custom trip) as `{ [slot]: raw }` before the fallback is returned. Write-once per slot, like the itinerary quarantine; a rescue slot that is itself unreadable is left alone. Not capped, unlike the itinerary's 4096 chars, because a truncated journal is not a copy. Not in the backup; sign-out and a local forget wipe it.

**Why.** These slots have no remote copy, so the save after a failed read overwrote the only one.

**Not done.** No UI reads the rescue slot; recovery is by hand. Day anchors and the concierge thread are not covered. A second corruption of a slot already rescued once is not covered (write-once), and the copy can push the next save over quota on a nearly full disk. (#1025) A slot that parses but whose entries the domain sanitizer drops entirely is now rescued too: the six `get` calls take the sanitizer and the gateway copies when stored content sanitizes to nothing.

### D-726 · (issue #983, 2026-11-02) · Another device's forget keeps this device's own data

**Decision.** `importRemoteTrips` still drops the row, but skips the #518 wipe when `hasDeviceOnlyData(id)` is true: a non-empty packing list, share inbox, favorites, day anchors, concierge thread, journal draft, either quarantine slot or `localRescue`, or any journal entry without a sync stamp (an unreadable journal counts). Empty `[]`/`{}` slots do not count. A local forget still wipes everything.

**Why.** Dropping only the row would bring back #518 for trips that hold nothing but synced data. Extending the #843 guard keeps the wipe for those and keeps anything no remote can restore.

**Not done.** The kept data has no row, so it is reachable only by re-joining the trip; sign-out clears it.

### D-720 · (issues #982, #978, 2026-11-02) · A refused outbox write is kept in memory

**Decision.** When the outbox slot write is refused (full quota), `core/sync/outbox.ts` keeps the slot it tried to write in a per-tab map and merges it into every slot read. `outboxDirty`, the flush, the badge and the first-snapshot merge in every domain see the chunk for the rest of the page load, and the next slot write that lands carries it to disk. A slot whose `version` is a number above 1 is never overwritten or removed; edits made under it go to the same in-memory map. `markOutboxDirty` is gone; its last caller left with #728.

**Why.** The enqueue ignored `writeJson`'s result, so the vault held the edit with no write-ahead record, and the first snapshot after a resubscribe applied over it. A newer build's slot was rewritten as v1, dropping its dirty set.

**Not done.** The memory copy does not survive a reload, so an edit that never reached the server or the disk is still lost then. Rolling back the vault write instead would need the reactive store to see the push's enqueue result.

### D-730 · (issue #986, 2026-11-02) · Older builds keep fields they don't know on journal entries and photo rows

**Decision.** The journal push in `lib/journal-remote.ts` carries the server row's undeclared keys into the row it writes, so an older build's edit no longer erases them. `sanitizePhoto` (`core/photos/model.ts`) keeps a row whose owner has a kind this build doesn't know, and keeps extra keys on the row. `sameOwner` never matches an unknown kind, so no view here lists it.

**Why.** Same class as #138 and #519. An older tab or phone editing a day rebuilt the entry from known fields and wrote it over the whole server row, erasing what a newer build had added. A photo row with an unknown owner kind was dropped on read and the next save made the drop permanent.

**Same shape as expenses.** The local journal path stays a strict allowlist (D-159, D-374): a backup restore or a legacy slot carrying a photo ref cannot reach Firestore, and text and highlight keep their length caps. Unknown keys are read only from the server row inside the push transaction, and never the declared fields, so clearing a mood or highlight still sticks. A tombstone, or a push over one, carries nothing. The local slot never holds the unknown keys; the server row is where they live. Photo rows are device-local, so that half keeps unknown owner kinds and keys in the model.

**Not done.** The outbox slot version is a separate change. Unknown keys have no size cap beyond Firestore's document limit.

### D-738 · (issue #981, 2026-11-02) · Gallery images revalidate after 7 days; the trim is serialised

**Decision.** A hit in `trip-images-v1` older than 7 days (by its `Date` header, missing counts as old) is still served at once, then refetched with `cache: no-cache` under `waitUntil` and replaced. `trimImageCache()` runs one at a time off a promise chain, so each pass reads current keys. Amends D-086(b): still cache-first, no longer forever.

**Why.** Image filenames are not content-hashed, so a re-encode or credit fix at the same path never reached returning devices; overlapping trims worked from stale key snapshots.

**Not done.** Hashed filenames. The precache-first order for hero rasters is unchanged.

### D-770 · (issue #970, 2026-11-03) · Config-less trips hide their placeholder dates; create picks a local currency

**Decision.** A trip with no config still resolves to the one-day 2099-12-31 placeholder (D-342), but nothing shows that date. `TRIP_DATES_PENDING` turns the date label into "Trip details not loaded yet", the hero drops its countdown, the live stat cell reads "Dates not set", the gate countdown shows the label, and Travel Mode skips its pre-trip Day 1 default. The create form gets a local currency picker limited to `CURRENCIES` (USD, NPR, JPY), written to the existing optional `config.currency`.

**Why.** Those three are the only currencies the budget has rates for (`rates.{NPR,JPY}`). Another currency needs new synced rate fields and a wider `CurrencyCode`, so it is a separate change.

**Not done.** More currencies, and per-day cities for multi-destination trips: every day still uses `destinations[0]`.

### D-741 · (issue #980, 2026-11-02) · The worker no longer caches the Frankfurter rate

**Decision.** The stale-while-revalidate route for `api.frankfurter.dev` is gone; the host is plain cross-origin passthrough again. `trip-frankfurter-v1` is no longer allowlisted, so the next activate deletes it. Retires D-190.

**Why.** The worker answered the rate request from cache as a 200, so `fetchCurrencyRate` took its success branch: the previous fetch looked fresh, never flagged stale, and online the row always lagged one fetch behind. Network-first with a cache fallback would still hand a cached 200 to the client when the network dies with `navigator.onLine` true, so the stale flag would stay wrong. With the route gone a dead network rejects and the localStorage fallback in `lib/currency-rate.ts` marks the value stale.

**Changes if:** the rate needs a cache layer the client's localStorage cannot give.

### D-795 · (amends D-226, D-086(a); issue #979, 2026-11-03) · Install copies byte-identical precache entries forward

**Decision.** gen-sw writes `PRECACHE_REVISIONS` (sha256, first 32 hex) for every precached file except `.html`/`.txt`. Before fetching each URL, install looks in existing `trip-precache-*` caches, hashes the stored bytes, and copies the entry only on a match. Pages and payloads are always fetched and checked against the build id. Any miss or error falls back to the normal fetch. Install stays atomic, the content-hashed cache name is unchanged, activate cleanup is unchanged.

**Why.** Pages ETags are deploy time plus size so no 304 is possible, and every device paid ~1.9 MB per deploy (#979).

**Changes if:** the worker gains a header-dependent read on precache entries (copied entries keep the old response headers), or a build step changes `out/` after gen-sw.

### D-790 · (issue #987, 2026-11-03) · The emergency card is a device-only slot (key 55)

**Decision.** `ice` (localStorage `nepal_japan_ice`, `trip:{id}:ice` off the default pack) holds the emergency card: blood type, allergies, medications, insurance and its 24h number, home contact, hotel in local script. Trip-scoped, written through `iceStore` and read through `readDeviceOnlyJson`, so an unreadable copy is rescued into `localRescue` before a save can replace it. Shape and limits live in `core/ice/ice.ts`; the editor is `components/ice-card.tsx` on `/profile`, linked from `/safety`, and the card holds the screen wake lock while it has content.

**Never leaves the device.** No sync domain, share link, backup (listed in the `trip-backup.ts` exclusion type) or concierge payload reads it. Sign-out and a local forget wipe it through `TRIP_SCOPED_SLOTS`; a remote forget keeps it, because `DEVICE_ONLY_SLOTS` counts it as data no remote copy could restore.

**Why.** Medical and contact details are the one kind of data where a sync leak or a backup file left in a shared inbox does harm that an app cannot undo. The issue's optional "include in backup" toggle is not built: the card is small enough to retype, and a toggle is a way to put it in a file by accident.

**Changes if:** the owner wants the card to follow a person across trips or devices, which needs an account-scoped slot and a decision on where it may be stored.

**Known gap.** `readJson` accepts arrays for object fallbacks (follow-up issue).

### D-796 · (amends D-720; issue #982, 2026-11-03) · A commit the outbox cannot record is rolled back

**Decision.** `withOutbox`'s push returns `false` synchronously, without pushing, when its write-ahead slot did not reach disk (full quota, or a newer build's slot). `SyncPort.push` is typed `Promise<void> | false`. `createReactiveStore`'s `commit()` then saves `prev` back, re-dispatches, and returns `false`, so the edit snaps back like any refused save and the quota toast explains it. If the rollback save is refused too, the edit stays and D-720's in-memory entry covers it for the page load.

**Why.** D-720's memory copy is gone after a reload, and the first server snapshot then applies over an edit the vault kept with no dirty record. Refusing the edit up front is the only outcome that stays true across a reload.

**Not done.** The restore path (`enqueueRestored` in `lib/trip-backup.ts`) still ignores the result. While a newer build's slot is on disk, every synced edit on this device is refused, and silently: that refusal raises no toast.

### D-797 · Per-day city for custom trips is create-time only (issue #1052, 2026-11-08)

**Decision.** A custom trip may carry `stops: {date, city}[]` inside `TripConfigBlock`, next to the single `main` leg. The city for a date is the last stop on or before it, else `destinations[0]`. The sanitizer keeps a stop only if its date is a real day and its city is exactly one of `destinations`; first stop per date wins, sorted, capped at 50. The create form splits the span evenly across the destinations, and cities beyond the number of days get no stop.

**Why.** `DayPlan.city`, expenses and budgets are keyed to the leg and stored per day, so a second leg would orphan them (the D-303 class of bug), and editing stops later would mean rewriting stored days. Old clients drop `stops` and keep `destinations[0]` for every day, which is today's behaviour.

**Changes if:** stops become editable after creation, which needs a plan for days already written.

### D-798 · Trip currencies beyond USD, NPR and JPY are leg-only (issue #1052, 2026-11-08)

**Decision.** EUR, GBP, INR, AUD, CAD and THB can be a trip's leg currency (`LOCAL_CURRENCIES`). `CURRENCIES` and `homeCurrency` stay USD, NPR and JPY, so an older client never sees a home code it cannot name. Each extra rate is its own additive `rates.<CODE>` path and falls back to that code's own seed. `ratePerUsd` is an explicit per-code lookup with no JPY fallthrough. Cents show for USD, EUR, GBP, AUD and CAD; INR and THB are whole units.

**Why.** The old lookup sent every code that was not USD or NPR to the JPY rate, so a code added only to the type would have converted at about 159 per dollar with no error. Older clients keep an unknown `rates.<CODE>` through the union merge (D-374, D-403, D-509) and only mislabel the amount with a dollar sign.

**Changes if:** the converter in `lib/currency-convert.ts` widens, or home currency needs a fourth code, which needs a rollout plan for older clients.

### D-800 · First snapshot with a clean outbox merges per id (issue #1124, 2026-11-10)

Amends D-544 and D-091 wording only. On the first marker-gated snapshot with no dirty dates, remote is still the shape: its days and ids are taken, an empty remote over a non-empty local is still refused by the D-544 floor, and an id held only locally is not kept, so delete-all stays empty and nothing is resurrected. The one change: an id present on both sides resolves with `resolvePair` (default hlc policy), so a local row (or field, tick, or position) that wins that merge survives, and any day whose merged result differs from remote is pushed through the outbox-decorated port.

**Why.** An edit whose outbox entry was lost (cleared storage slot, refused save) was overwritten by the older server copy on the next load, then never pushed.

**Changes if:** the merge core or HLC ordering changes.

### D-801 · Values a merge drops are kept on the device (issue #1124, 2026-11-10)

When the sync apply replaces a content-group value (title, time, duration, notes, location) of an item that exists on both sides with another person's, local's value is saved in a device-only slot (storage key 56, `conflicts`), up to 50 entries, pruned when the item is deleted. Restore is an ordinary edit with a fresh stamp; it syncs like any other. Only a value stamped by this person is kept, and only when the winning stamp is someone else's; the whole group is stored, with null for an absent key, so a restore can clear it. The merge itself is unchanged, and the slot is never on a row, a Firestore doc, an export or a backup.

**Limits.** From (local, merged) alone, a later sequential overwrite looks the same as a concurrent edit, so both are kept. The dirty-outbox branch of the first-snapshot apply records nothing (the offline-edit path; accepted). The slot is deliberately not in `DEVICE_ONLY_SLOTS`: it is ephemeral, so forgetting a trip does not warn about it.

**Why.** The merge picks one value per field group and the other is gone, with nothing to tell the person it happened.

**Changes if:** the merge core, the content groups or the HLC actor change.

### D-802 · The conflict notice on an itinerary item (issue #1124, 2026-11-10)

An item with a stored conflict (D-801) shows `ConflictNotice` under its row in the day list: "Changed by {name}. Your version: ..." with "Put mine back" (`restoreConflict`) and "Dismiss" (`dismissConflict`). It is a polite `role="status"` block, no focus move, no animation, two ordinary 44px buttons whose names include the item title. Every write to the slot fires `trip:conflicts-changed` on the window and `useItemConflict(itemId)` re-reads on it; nothing else subscribes. Restore failing (item gone) leaves the notice.

Updates are same-window only (a custom event); another open tab shows the notice after remount. An empty name reads "someone".

**Changes if:** a second surface (map, print, item sheet) needs the notice, or the slot moves off `local`.
### D-799 · Hero ring is progress only (issue #1131, 2026-11-10)

**Decision.** The countdown ring no longer prints a number. It is a progress arc with `role="img"` and an `aria-label` of the calendar days left. The `countdown-total-days` and `-unit` test ids stay on a visually hidden span. `computeCountdown` is unchanged (D-313).

**Why.** The tiles show elapsed 24h blocks and the ring showed calendar days, so Home read "29 days 3 hours" next to "30 days".

**Changes if:** the tiles move to calendar days, which would let the ring show its number again.

### D-810 · A new trip's vibe is optional (issue #1121, 2026-11-10)

**Decision.** The create form preselects no vibe, and tapping the picked one clears it. With none picked the config stores `vibe: 'none'` (`NO_VIBE`), which paints the fallback gradient and no tagline in the hero.

**Why.** `sanitizeTripConfig` refuses an empty vibe, so leaving the field out would change the stored config shape. Any non-empty string is already legal, and older clients read an unknown key as the fallback vibe, so they still show the city tagline for `'none'`.

### D-811 · Amends D-663 · The default pack syncs only for the shared trip's accounts (issue #1107, 2026-11-10)

**Decision.** `getDefaultTripShareId()` no longer writes the shared trip id on an untouched device; it returns the stored id or `''`. `lib/account-share.ts` writes it, and reloads once, only when the signed-in email is on the shared trip's allowlist (`SHARED_TRIP_USERNAMES`, the list `shared-trip.guard.test.ts` pins to `isAllowlisted()`). A non-member device already holding the id is cleared to `''`, even with writes queued: clearing drops nothing, and with no id the outbox goes dormant, whereas refused chunks never ack and would never drain. An anonymous or offline session decides nothing. Every page load re-checks, so a sign-in is picked up on the load after it. The once-per-session reload guard does not apply to a fresh member device, so signing out and back in within a session still records it; the next load holds the id, so it cannot loop.

**Why.** Every other account was put on the shared trip: the hub said "Shared trip — synced", their edits queued and were refused, and each open spent denied reads.

**Trade-off.** A member's first load on a new device is local-only until the check reloads it. A non-member's queued writes for the shared trip stay on the device, unsent.

### D-880 · Trip renames and the trip list retry until they land (issue #1125, 2026-11-10)

**Decision.** `pushTripMeta` and `pushTripList` queue their target in key 58 (`tripSyncQueue`: `{ meta: tripId[], list?: syncCode }`) before writing and dequeue it on success. `flushPendingTripSync` retries the queue from the current registry entry on the sync badge's existing triggers (mount, `online`, tab return), next to the journal and prefs queues. The badge counts queued renames for every trip, not just the active one, plus the list. A retried rename reads `meta/info` in a transaction and skips the write when the doc's `updatedAt` is the same as or newer than ours (D-600; an equal stamp means the doc already holds this version); an explicit rename writes as before. A refused push stays queued and blocked, with one attempt per page load, until the trip is forgotten. Sign-out flushes the queue under its existing 8s cap, counts it in the unsynced warning, then wipes the key. Doc shapes are unchanged.

**Why.** A failed push only logged a warning, so a rename made offline never reached the other travellers.

**Trade-off.** Not a real outbox domain: no per-chunk sequence, and an earlier list push can clear a later one's queue entry when the two run in different tabs.
