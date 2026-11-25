# Two-device sync check (#43)

A manual check of cross-device sync on the live site, using two browser profiles as two phones.
Two profiles have separate storage and separate anonymous-auth uids, so the app treats them as
two devices. Two tabs of one profile share localStorage and do not count.

CI runs the rules in the emulator, but the E2E build has no firebase env, so `isRemoteConfigured()`
is false and the app's sync layer never runs in Playwright. The manual run below is the only end-to-end
proof of the Firestore transport. The emulator needs JDK 21 and network access for `firebase-tools`
(D-088).

## Last run, 2026-08-15

Run against a throwaway custom trip, not the shared one.

| Domain | Result |
|---|---|
| Plan / itinerary | Pass, live in both directions, and an offline device caught up on reopen |
| Documents checklist | Pass, live in both directions |
| Saved places | Did not sync: the domain was local-only. Since wired through `lib/places-ports.ts` |
| Expenses | Did not sync on custom trips: the transport hardcoded the `nepal`/`japan` legs. Since fixed in `lib/expenses-remote.ts` |

## What is already covered off-Firebase

- `lib/__tests__/core-merge-day.test.ts`: mergeDay is commutative and idempotent, different items
  on one day, HLC tie-break, delete vs edit.
- `lib/__tests__/itinerary-remote-sync.test.ts`: snapshot handler merges without pushing,
  `pushDayMerged` read-merge-writes in a transaction, v1 docs read as mergeable.
- `lib/__tests__/core-sync-outbox.test.ts` and `lib/__tests__/use-sync-status.test.ts`: outbox
  gating, `lastAckAt`, the pending to 0 cycle.

The live run adds the transport itself: transaction retry under real contention, real uids, real
snapshot timing.

## Procedure

Preconditions: a build with the firebase env (`.env.local`), two browser profiles signed in as
different travellers, and a throwaway trip or day. Do not use real trip data.

### Itinerary merge

1. **Different items, same day.** Both open `/plan` on the same day; A adds "A-only" and B adds
   "B-only" at about the same time. Both clients must end up showing both items.
2. **Same item, both edited.** Both change one item's title to different values. Both converge on
   the higher-HLC edit, tie-broken by actor uid (D-105), with no console error.
3. **Delete vs concurrent edit.** A deletes item X while B edits it. The delete wins unless B's edit
   is strictly HLC-later (D-106). The deleted item must not flicker back.
4. **v1 day doc survives a v2 write** (D-107). Edit one item on a day whose remote doc is still v1.
   The edit round-trips and the other items keep their data.

### Sync-status badge

Needs the same firebase build, since `isRemoteConfigured()` is inlined at build time.

1. **Pending count.** Go offline and edit the itinerary: `sync-status-badge` shows
   `data-state="pending"` and "1 pending". Go online and wait for the flush (`online` event or tab
   visible): the badge disappears if this was the first sync, otherwise it shows
   `data-state="synced"`.
2. **Axe.** With the pending pill showing, scan `[data-testid="sync-status-badge"]`: zero serious or
   critical violations.
3. **Reduced motion.** Emulate `prefers-reduced-motion: reduce`, trigger the pending pill, and check
   the badge's computed `transform` is identity (or `none`) and `animationName` is `none`, the same
   check `e2e/motion.spec.ts` makes on the offline chip.

Playwright could drive all of this with two `browser.newContext()` calls on a machine with JDK 21
and network access.
