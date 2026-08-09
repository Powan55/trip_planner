import { test, expect } from './fixtures';

/**
 * Sync v2 — two-client concurrent-edit proof (S97).
 *
 * ── WHY THESE ARE test.skip (do NOT fake it — mirrors S84's SW-transition skip) ──
 * The centerpiece of Sync v2 is a TWO-CLIENT proof: two "friends" (two browser contexts, two
 * distinct anon-auth uids) both open the shared trip and edit near-simultaneously, and BOTH
 * edits survive. That requires a LIVE-or-EMULATED Firestore. This sandbox has NEITHER:
 *   - The dormant static harness (`serve-out.mjs` over `out/`) is built with NO firebase env
 *     (D-038), so `isRemoteConfigured()` is false and the remote layer never activates —
 *     there is no server to converge against.
 *   - The Firebase EMULATOR is not feasible here (attempted at S97, recorded honestly):
 *       • `firebase-tools` install hits the D-088 TLS wall (UNABLE_TO_VERIFY_LEAF_SIGNATURE);
 *         it only completes with `NODE_TLS_REJECT_UNAUTHORIZED=0`, and
 *       • the current `firebase-tools` REQUIRES JDK >= 21; this sandbox has JDK 17 — and the
 *         emulator JAR download is itself another TLS-gated fetch.
 *     Forcing it would be a green lie. Per the honesty rule (and consistent with how
 *     S90's live-Firestore migration was flagged), the live/emulated proof is FLAGGED FOR
 *     MANUAL INTEGRATION-QA, and the spec is written + skipped (visible in the report as
 *     skipped, NOT silently omitted) with the exact manual procedure below.
 *
 * ── WHAT IS ALREADY PROVEN ON A REAL RUN (so the live proof is confirmatory, not blind) ────
 * The item-level MERGE that makes two-client convergence work is proven off-firebase at S97:
 *   - `lib/__tests__/core-merge-day.test.ts` (S96): mergeDay is commutative + idempotent
 *     (convergence), different-items-same-day both survive, HLC tie-break, delete-vs-edit.
 *   - `lib/__tests__/itinerary-remote-sync.test.ts` (S97): against a FAKE Firestore — the
 *     snapshot handler MERGES remote against local and applies WITHOUT pushing
 *     (echo-suppression), `pushDayMerged` reads-merges-writes inside a transaction so a
 *     concurrent same-day peer item is not clobbered, and default-on-read makes a v1 remote
 *     doc mergeable. That is the whole wiring the live proof exercises end-to-end.
 * So the live run below validates the FIRESTORE TRANSPORT (transaction retry under real
 * contention, real anon uids, real snapshot timing) — the pure/merge logic is already green.
 *
 * ── MANUAL / INTEGRATION-QA PROCEDURE (run against the live `nepalxjapan` trip OR an emulator
 *    on a JDK-21 machine with network egress) ──────────────────────────────────────────────
 * Preconditions: a build WITH the firebase env (`.env.local` present); two browser profiles,
 * each signed in as a DIFFERENT traveler token (e.g. Powan and Sushil) so they carry distinct
 * anon uids + actors. Use a THROWAWAY test day (or the emulator) — do NOT pollute real trip
 * data on the live project.
 *
 *   #1 Headline — different items, same day (the exact v1 clobber this slice fixes):
 *      a. Both clients open /plan and select the SAME day D.
 *      b. Near-simultaneously: client A adds item "A-only"; client B adds item "B-only".
 *      c. After both snapshots settle (a second or two), assert BOTH clients show BOTH
 *         "A-only" AND "B-only" on day D. (v1 would have dropped one — LWW per day-doc.)
 *
 *   #2 Same-item collision — deterministic HLC winner, no divergence:
 *      a. Both edit the SAME existing item's title concurrently to different values.
 *      b. After settle, assert BOTH clients converge to the SAME title (the higher-HLC edit,
 *         tie-broken by actor uid — D-105), and there is NO console error on either.
 *
 *   #3 Delete vs edit — tombstone-wins-by-HLC (D-106 default 'hlc'):
 *      a. Client A deletes item X; client B edits item X concurrently.
 *      b. After settle, assert both clients converge per policy: the delete wins unless B's
 *         edit is strictly HLC-later (a late re-add). The deleted item must NOT permanently
 *         "flicker" back on the losing client. No console error.
 *
 *   #6 Live-data survival (dual-read, D-107): pick a day whose remote doc is still v1 (no
 *      per-item rev/hlc/deleted). One client edits an item on it; assert the edit round-trips
 *      with no loss and the doc is upgraded to v2 shape (the un-edited items keep their data).
 *
 * Each check is a REAL two-context run; paste the evidence (both clients' final state +
 * a clean console) into the integration-QA record. Playwright can drive it directly with
 * two `browser.newContext()` on a JDK-21 + network machine — the skeleton below is the
 * starting point (kept skipped so it never runs — and never falsely passes — here).
 */

test.describe('Sync v2 — two-client concurrent-edit proof (integration-QA, live/emulated Firestore)', () => {
  test.skip('#1 different items, same day → BOTH edits survive on BOTH clients (headline)', async () => {
    // Requires two contexts against a live/emulated Firestore (see file header). Skeleton:
    //   const ctxA = await browser.newContext(); const ctxB = await browser.newContext();
    //   const a = await ctxA.newPage(); const b = await ctxB.newPage();
    //   // sign A in as Powan, B in as Sushil; both open /plan, select day D.
    //   await Promise.all([addItem(a, 'A-only'), addItem(b, 'B-only')]);
    //   await settle(a); await settle(b);
    //   await expect(dayItems(a, D)).toContainText(['A-only', 'B-only']);
    //   await expect(dayItems(b, D)).toContainText(['A-only', 'B-only']);
    expect(true).toBe(true); // placeholder body; test.skip prevents execution
  });

  test.skip('#2 same item edited on both → clients converge to the SAME HLC winner (no divergence)', async () => {
    // Both edit the same item's title concurrently; after settle both show the identical
    // higher-HLC title (actor-uid tie-break, D-105); no console error on either client.
    expect(true).toBe(true);
  });

  test.skip('#3 delete vs concurrent edit → tombstone-wins-by-HLC, no permanent flicker-back (D-106)', async () => {
    // A deletes X while B edits X; after settle both converge per policy (delete wins unless
    // B's edit is strictly HLC-later). The deleted item does not resurrect permanently.
    expect(true).toBe(true);
  });

  test.skip('#6 v1 remote day-doc is read (defaulted), edited, and round-trips without loss (dual-read D-107)', async () => {
    // Edit an item on a still-v1 day-doc; the edit round-trips, the doc upgrades to v2 shape,
    // and every un-edited item on that day keeps its data (no clobber).
    expect(true).toBe(true);
  });
});
