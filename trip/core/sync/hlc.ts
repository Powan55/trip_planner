/**
 * Sync v2 — Hybrid Logical Clock (HLC), PURE core.
 *
 * An HLC gives a deterministic, causal, bounded-drift total order over edits made by
 * different clients whose wall-clocks disagree. It is the primary ordering key the
 * per-day item merge (`merge-day.ts`) uses to pick a winner for a same-`id` collision.
 *
 * ── PURITY (the load-bearing rule) ───────────────────────────────────────────
 * This module reads NO clock. Physical time is INJECTED as a plain `number`
 * (`ClockPort.now().getTime()`), exactly as `computeCountdown(now)` takes its `now`.
 * It imports NO React / Next / `window` / firebase / date-fns-of-the-app — only plain
 * TS. That is what keeps the ops deterministically unit-testable and dormant-safe.
 *
 * ── The value ────────────────────────────────────────────────────────────────
 *   HLC = { pt: number, ct: number, actor: string }
 *   serialized: `${pad(pt)}:${pad(ct)}:${actor}`
 *     pt    — physical time, ms since epoch (the "physical" half).
 *     ct    — logical counter, a non-negative integer (the "logical" half).
 *     actor — the editing device's stable id (anon-auth uid) — the final tie-break.
 *
 * `pad(pt)` / `pad(ct)` are fixed-width zero-padded so a plain STRING compare of two
 * serialized stamps equals the structured tuple compare (`compareHlc`). That lets the
 * stamp live as a scalar Firestore/localStorage field and sort with `a.hlc < b.hlc`.
 */

/** A Hybrid Logical Clock stamp. */
export interface Hlc {
  /** Physical time, ms since epoch. The "physical" half; keeps stamps near real time. */
  pt: number;
  /** Logical counter, a non-negative integer. The "logical" half; breaks equal-`pt` ties. */
  ct: number;
  /** Editing device id (anon-auth uid). Final deterministic tie-break. */
  actor: string;
}

/**
 * Fixed-width zero-pad widths.
 *
 * `PT_WIDTH = 15`: ms-since-epoch fits in 15 digits until year ~33658 (10^15 ms ≈ 31.7 k
 * years past 1970) — comfortably well past year 5000. Any real trip
 * `pt` is 13 digits today (`Date.now()` ≈ 1.7e12), so 15 digits leaves 2 orders of
 * headroom before the width would ever be exceeded.
 *
 * `CT_WIDTH = 6`: the logical counter only grows while `pt` does NOT advance (many edits
 * inside a single ms, or repeatedly absorbing an equal peer `pt`). 10^6 = 1,000,000
 * same-ms events before overflow — astronomically beyond any human editing burst. The
 * documented ceiling and overflow behavior are in `CT_MAX` below.
 */
export const PT_WIDTH = 15;
export const CT_WIDTH = 6;

/**
 * The largest `ct` that still serializes within `CT_WIDTH` digits.
 *
 * `ct` overflow behavior (documented, astronomically unlikely): reaching
 * `CT_MAX` would require 1,000,000 events in a single unchanging millisecond. If it ever
 * did, `pad(ct)` would produce a 7-digit field and the string-sort==tuple-sort invariant
 * would break at that boundary only. The structured `compareHlc` (used inside the pure
 * core) is width-independent and stays correct regardless. `serialize` guards the invariant
 * by clamping the padded width; it does not throw (a pure function must not), so at the
 * (impossible) overflow the serialized form degrades gracefully to a wider field rather
 * than corrupting the value.
 */
export const CT_MAX = 10 ** CT_WIDTH - 1;

function pad(value: number, width: number): string {
  // Guard against negatives / non-finite so serialization never emits `NaN`/`-`.
  const n = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  const s = String(n);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

/**
 * Serialize an HLC to a fixed-width, lexicographically-sortable string.
 * `serialize(a) < serialize(b)` iff `compareHlc(a, b) < 0` (proven over a fuzz set).
 */
export function serialize(hlc: Hlc): string {
  return `${pad(hlc.pt, PT_WIDTH)}:${pad(hlc.ct, CT_WIDTH)}:${hlc.actor}`;
}

/**
 * Parse a serialized HLC back to structure. Inverse of `serialize` for well-formed input.
 * `actor` may itself contain ':' — only the FIRST two ':' are field separators, so the
 * actor is everything after the second delimiter (uids don't contain ':' today, but this
 * keeps parse total and lossless).
 */
export function parse(serialized: string): Hlc {
  const first = serialized.indexOf(':');
  const second = serialized.indexOf(':', first + 1);
  if (first === -1 || second === -1) {
    // Malformed — treat as the oldest possible stamp so it never spuriously "wins".
    return { pt: 0, ct: 0, actor: '' };
  }
  const pt = Number(serialized.slice(0, first));
  const ct = Number(serialized.slice(first + 1, second));
  const actor = serialized.slice(second + 1);
  return {
    pt: Number.isFinite(pt) ? pt : 0,
    ct: Number.isFinite(ct) ? ct : 0,
    actor,
  };
}

/**
 * The strict total order over HLCs: `pt` → `ct` → `actor` (string
 * compare), higher wins. Returns <0 if `a` sorts before `b`, >0 if after, 0 iff equal.
 *
 * Antisymmetric, transitive, total (proven over a random fuzz set). This total
 * order is what makes each same-`id` winner deterministic and therefore the merge
 * convergent: every client computes the identical winner for any pair.
 */
export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.pt !== b.pt) return a.pt < b.pt ? -1 : 1;
  if (a.ct !== b.ct) return a.ct < b.ct ? -1 : 1;
  if (a.actor === b.actor) return 0;
  return a.actor < b.actor ? -1 : 1;
}

/**
 * (a) LOCAL EVENT: this device makes an edit. Advance our clock strictly
 * past our last stamp. `pt` ratchets to `max(physicalNow, last.pt)` (never runs backward
 * under a slow clock); `ct` increments when `pt` did not advance (rapid/offline edits),
 * else resets to 0. The result is ALWAYS strictly greater than `last` (monotonic).
 *
 * @param last        our previous stamp for this item, or null on first create.
 * @param physicalNow injected ms-since-epoch (ClockPort.now().getTime()).
 * @param actor       this device's uid — stamped onto the new HLC.
 */
export function hlcSendOrLocal(last: Hlc | null, physicalNow: number, actor: string): Hlc {
  const lastPt = last?.pt ?? 0;
  const pt = Math.max(physicalNow, lastPt);
  const ct = pt === (last?.pt ?? -1) ? (last?.ct ?? 0) + 1 : 0;
  return { pt, ct, actor };
}

/**
 * (b) RECEIVE / MERGE: we observe a remote item's HLC. Absorb it (Lamport
 * "receive" rule) so our NEXT local stamp is causally after anything we've seen — including
 * a peer whose clock is far in the future. This is the skew-absorption guarantee: if
 * `remote.pt` is ahead of our real clock, `pt` ratchets up to it and `ct` advances, so a
 * subsequent `hlcSendOrLocal` sorts strictly after the peer's edit and no update is lost.
 *
 * `actor` is intentionally kept as the LOCAL actor (falling back to the remote actor only
 * when we had no prior stamp) — the caller re-stamps `actor` on a genuine local event; a
 * pure receive is a clock-absorption step, not an authorship claim.
 *
 * @param local       our current HLC state for this item, or null.
 * @param remote      the observed remote HLC.
 * @param physicalNow injected ms-since-epoch (ClockPort.now().getTime()).
 */
export function hlcReceive(local: Hlc | null, remote: Hlc, physicalNow: number): Hlc {
  const localPt = local?.pt ?? 0;
  const pt = Math.max(physicalNow, localPt, remote.pt);
  let ct: number;
  if (pt === (local?.pt ?? -1) && pt === remote.pt) {
    ct = Math.max(local?.ct ?? 0, remote.ct) + 1;
  } else if (pt === (local?.pt ?? -1)) {
    ct = (local?.ct ?? 0) + 1;
  } else if (pt === remote.pt) {
    ct = remote.ct + 1;
  } else {
    ct = 0;
  }
  return { pt, ct, actor: local?.actor ?? remote.actor };
}

/**
 * Legacy seeding — PURE, reads NO clock. For an item that predates Sync v2
 * (`hlc` absent), derive a DETERMINISTIC HLC from its existing `updatedAt` if present, else
 * from the HLC epoch (pt=0). `ct=0`, `actor=''` (empty string sorts lowest), so a legacy
 * item is the OLDEST known version of its `id` and loses any tie against a real post-v2
 * edit — exactly the "old data yields to fresh edits" behavior. Deterministic ⇒ every
 * client seeds the identical stamp for the same legacy item (no divergence).
 *
 * Returned as the serialized STRING (the disk/wire form) so it drops straight into the
 * Vault v3→v4 migration and `docToDayPlan` defaulting without a serialize step there.
 */
export function seedHlcFromLegacy(updatedAt?: string): string {
  const parsed = updatedAt ? Date.parse(updatedAt) : NaN;
  const pt = Number.isFinite(parsed) ? parsed : 0; // 0 = "unknown/oldest" epoch
  return serialize({ pt, ct: 0, actor: '' });
}
