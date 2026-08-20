# Two-device sync check (#43)

A hand-run pass of the live deployed site (`https://powan55.github.io/trip_planner/`) from two
independent browser profiles, standing in for "two phones" — separate storage, separate anon-auth
identity, exactly the shape the app treats as two different devices. This run carries out the manual
integration-QA procedure recorded in the appendix below (there is no live or emulated Firestore
in CI), extended to the domains that procedure doesn't cover (saved places, expenses, documents)
and to the offline-reconnect case.

**Who ran it:** Uttam, from the assistant session, 2026-08-15.
**Against:** a throwaway custom trip ("QA Sync Check", id `[redacted — see D-341]`)
created for this check — NOT the live `nepalxjapan` trip, so nothing here touches real trip data.
**Setup:** Device A = the sandboxed browser pane, signed in as "QA Device A". Device B = a separate
real-Chrome profile, signed in as "QA Device B", joined via Device A's Trip Token. Two distinct
anon-auth uids, two distinct local-storage partitions — a genuine two-client run, not two tabs of
the same session (two tabs share localStorage and are the same "device").

"PASS" = the change made on one device is visible on the other. "FAIL" = it never arrives.

---

## Plan (itinerary) — PASS, both directions, live

- A added "A-only: sunrise walk" on Day 1 → appeared on B within a couple of seconds, no reload,
  attributed "by QA Device A".
- B added "B-only: night market" → appeared on A the same way, live, attributed correctly.
- Activity feed on both devices logged the peer's edit ("QA Device A edited …").

## Documents & readiness checklist — PASS, both directions, live

- A ticked the first checklist item → B's ready-count updated (0/18 → 1/18) on a fresh load.
- B ticked a second item → A's ready-count updated live (1/18 → 2/18), no reload needed.

## Offline → reconnect catch-up — PASS (plan domain)

- Device B's tab was closed entirely (simulating offline/backgrounded).
- Device A added a plan item ("Catchup: added while B was offline") while B was away.
- Device B was reopened fresh and navigated to the trip: the new item was present immediately on
  load — a device that was offline catches up as soon as it reconnects.

## Saved places ("My Places") — WORKS AS DESIGNED, but does not cross devices

- A imported a place ("A-only cafe") via Shared Links → "Paste a Google Maps link" → it appeared
  in "My Places" on A's Home, and survived a reload there.
- B never received it, even after a reload and a wait.
- Root cause (by code, not just observation): `hooks/use-my-places.ts` is explicitly **local-only**
  — its own doc comment says so — backed by `core/places/storage.ts`, which stores under the
  `'local'` storage tier only. There is no `SyncPort`, no remote push, nothing wired to Firestore
  for this domain at all.
- This means the issue's premise ("Saved places were just added to what syncs") does not match
  what's in the repo today: saved places are NOT part of what syncs. Either the sync wiring for
  this domain hasn't landed yet, or whatever added it was reverted/never merged. Worth confirming
  with whoever filed that line before relying on it.

## Expenses — FAIL: never reaches the other device on a custom trip

- A logged an expense ("A-only: taxi", $25) → visible on A immediately, survives A's reload.
- B never received it — not live, not after a reload, not after a 5s wait + reload.
- This one **is** wired for remote sync (`hooks/use-expenses.ts` has a `SyncPort`, gates
  attribution on `isRemoteConfigured()`, and the "logged by QA Device A" attribution did appear —
  the sync path is engaging), so the miss is a real bug, not an unimplemented feature.
- **Root cause:** the expense sync transport chunks by trip *leg*, and the leg id is hardcoded to
  the two default-pack legs everywhere in the transport:
  - [`lib/expenses-ports.ts:34`](../lib/expenses-ports.ts) — `for (const leg of ['nepal', 'japan'] as const)`
    inside `chunkDiff`.
  - [`lib/expenses-remote.ts:35`](../lib/expenses-remote.ts) — `const LEGS: readonly Leg[] = ['nepal', 'japan']`.
  - [`lib/expenses-remote.ts:83`](../lib/expenses-remote.ts) — `pushExpenseChunk` returns early (silently, no
    error) for any leg that isn't literally `'nepal'` or `'japan'`.
  - [`lib/expenses-remote.ts:190`](../lib/expenses-remote.ts) — the snapshot subscribe also only reads Firestore
    docs named `nepal`/`japan`.

  A custom trip's only leg is `id: 'main'` (`core/trips/custom.ts:87`). Every expense on a custom
  trip carries `leg: 'main'`, so `chunkDiff` compares two always-empty nepal/japan buckets, never
  sees a change, and `pushChunk` is never called — the push silently no-ops by construction. This
  affects **every custom trip**, not just this throwaway one; any group that isn't on the default
  Nepal×Japan pack cannot split expenses across devices at all today. Budget targets (the total/
  per-category numbers, `lib/budget-ports.ts`) and Documents (`lib/docs-ports.ts`) are singleton
  chunks, not leg-chunked, so they're unaffected — this is specific to the expense transaction
  list.
- Not something to hand-wave past: this is a full plan for a live trip (`nepalxjapan`) too, but
  that one happens to use exactly the two hardcoded legs, so the bug is invisible there. It only
  shows up on a custom trip, which is exactly the shape more and more of the userbase is in.

---

## Summary

| Domain | Cross-device sync |
|---|---|
| Plan / itinerary | PASS — live, both directions, survives offline+reconnect |
| Documents checklist | PASS — live, both directions |
| Saved places | Does not sync at all (by design — local-only, contradicts the issue's premise) |
| Expenses | Broken on any custom trip — chunk transport hardcoded to `nepal`/`japan` legs |

Given the expenses gap is a real, reproducible bug (not a missing feature) that silently drops
data for every custom trip, this should block the freeze until it's fixed or the release scope is
explicitly narrowed to accept it. Flagged separately rather than fixed in this PR, since this PR's
job is the QA pass, not the transport rewrite — see the follow-up task.

---

## Appendix — the manual procedure itself

Kept here rather than in a `.spec.ts`. It used to live as an all-`test.skip` Playwright file with
`expect(true).toBe(true)` bodies, which asserted nothing and inflated the spec count; a runbook
belongs in `docs/`. Nothing about the procedure changed in the move.

**Why it cannot be automated in this sandbox.** Two-client convergence needs a live or emulated
Firestore. The static harness serves `out/` built with no firebase env, so `isRemoteConfigured()`
is false and the remote layer never activates. The emulator is not reachable either: installing
`firebase-tools` hits the TLS wall recorded in D-088, and the current version needs JDK >= 21
against this machine's JDK 17. Forcing a green here would be a lie, so the proof is manual.

**What is already proven off-Firebase**, so this run is confirmatory rather than blind:
`lib/__tests__/core-merge-day.test.ts` (mergeDay commutative + idempotent, different-items-same-day,
HLC tie-break, delete-vs-edit), `lib/__tests__/itinerary-remote-sync.test.ts` (snapshot handler
merges and applies without pushing; `pushDayMerged` read-merge-writes inside a transaction;
default-on-read makes a v1 doc mergeable), `lib/__tests__/core-sync-outbox.test.ts` and
`lib/__tests__/use-sync-status.test.ts` (outbox gating, `lastAckAt`, the pending -> 0 cycle).
What the live run adds is the FIRESTORE TRANSPORT: transaction retry under real contention, real
anon uids, real snapshot timing.

**Preconditions.** A build with the firebase env (`.env.local` present); two browser profiles,
each signed in under a DIFFERENT traveller token so they carry distinct anon uids and actors. Use
a throwaway test day or trip — do not pollute real trip data on the live project.

### Itinerary merge

1. **Different items, same day** (the v1 clobber this replaced). Both clients open `/plan` and
   select the same day D; near-simultaneously A adds "A-only" and B adds "B-only". After the
   snapshots settle, BOTH clients must show BOTH items on day D.
2. **Same item, both edited.** Both change the same item's title concurrently to different
   values. After settle both clients converge on the same title — the higher-HLC edit, tie-broken
   by actor uid (D-105) — with no console error on either side.
3. **Delete vs concurrent edit.** A deletes item X while B edits it. Both converge per the D-106
   default policy: the delete wins unless B's edit is strictly HLC-later. The deleted item must
   not permanently flicker back on the losing client.
4. **v1 day-doc survives a v2 write** (dual-read, D-107). Pick a day whose remote doc is still v1
   (no per-item `rev`/`hlc`/`deleted`), edit one item on it, and confirm the edit round-trips with
   no loss while the un-edited items keep their data.

### Sync-status badge (S229)

Needs the same firebase-configured build, because `isRemoteConfigured()` is inlined at
`next build` time and cannot be toggled from inside a test.

1. **Pending count.** Go offline, make an itinerary edit; the `sync-status-badge` shows
   `data-state="pending"` and "1 pending". Go back online and wait for the flush trigger (the
   `online` event or the tab becoming visible): the badge either disappears (when `lastAckAt` was
   null before the edit — the first ever sync) or flips to `data-state="synced"`.
2. **Axe.** With the pending pill rendered, scan `[data-testid="sync-status-badge"]` and expect
   zero serious or critical violations.
3. **Reduced motion.** Emulate `prefers-reduced-motion: reduce` before navigating, trigger the
   pending pill, and confirm the badge's computed `transform` is the identity matrix (or `none`)
   and `animationName` is `none` — the same check `e2e/motion.spec.ts` makes on OfflineBanner's
   identical reveal.

Paste both clients' final state and a clean console into the integration-QA record. Playwright can
drive all of it with two `browser.newContext()` calls on a JDK-21 machine with network egress.
