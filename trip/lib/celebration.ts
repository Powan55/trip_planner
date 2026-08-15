// — pure helpers behind the micro-celebration burst, kept outside React so the fire-once
// transition edge and the reduced-motion gate are unit-testable without a DOM render.

import { celebrationLedger } from '@/core/storage/gateway';

/** True only on an OBSERVED false→true edge, so a completion celebration fires once per live
 * transition — never on a re-render while the state stays true, and never on the FIRST
 * observation (`prev === null` seeds the baseline without firing: a list already complete in
 * storage, or a page loaded mid-trip, must not celebrate on every visit — review). */
export function crossedIntoComplete(prev: boolean | null, next: boolean): boolean {
  return next && prev === false;
}

/** Whether the burst should actually render: the caller says "fire" AND motion isn't reduced
 * */
export function celebrationVisible(active: boolean, reducedMotion: boolean | null | undefined): boolean {
  return active && !reducedMotion;
}

// ── The session ledger (D-293 rule 5, second clause · rule 6's caps) ─────────────────────────

/**
 * The three celebration weights of D-293 rule 6, plus D-323's `completion`. Deliberately the
 * same names as `MotionKind` in lib/motion.ts (they are the same vocabulary), but this module
 * only rules on HOW OFTEN a weight may fire — WHETHER it may fire on this surface at all is the
 * tier gate's answer, and the caller asks that one first (`components/home-milestone.tsx` is
 * the worked example).
 */
export type CelebrationWeight = 'tick' | 'pop' | 'burst' | 'completion';

/**
 * Rule 6's cap column, verbatim, and there is nothing else in it:
 *
 * | tick | unlimited |
 * | pop  | **3 per session** |
 * | burst | **1 per event, never twice for the same stamp** |
 *
 * `burst` and `completion` are `Infinity` here because their cap is not a COUNT — it is
 * "once per entity", which every claim already gets from the ledger's presence test. A stamp
 * cannot fire twice; a hundred different stamps on a device that has just been fed a hundred
 * countries are capped by the CALLER instead (`passport-stamps.tsx`'s FLOURISH_CAP of 3), which
 * is the right place for it: that is a budget for one screen, not for the session.
 */
const SESSION_CAP: Readonly<Record<CelebrationWeight, number>> = {
  tick: Infinity,
  pop: 3,
  burst: Infinity,
  completion: Infinity,
};

/**
 * Spend a celebration, or refuse it.
 *
 * `crossedIntoComplete` above answers "is this a real transition"; it cannot answer "has this
 * already been celebrated", because its baseline is a ref that a route change throws away —
 * leave `/packing` and come back and the edge fires again. This is that second half: a claim
 * key (`<weight>:<entity id>`) is spent AT MOST ONCE PER SESSION, and a weight with a numeric
 * cap stops being granted once the session has spent it.
 *
 * Returns `true` exactly once per entity per session, and only while the weight is under its
 * cap. **It is a WRITE.** Call it only where the celebration is actually about to be shown —
 * never speculatively, and never under reduced motion, where the user is shown nothing and must
 * therefore not be charged for it (the same rule `entranceFor()` follows for the greeting).
 *
 * The ledger is the only state; there is no in-memory memo, because the one caller
 * (`components/celebration-burst.tsx`) holds a per-window ref that keeps a React StrictMode
 * double-invoke from claiming twice. A second caller would need the same ref, or this would
 * need the memo `lib/motion.ts` keeps for entrances.
 */
export function claimCelebration(id: string, weight: CelebrationWeight = 'completion'): boolean {
  // The ledger is a comma-joined set, so a comma inside an id would split one entry into two
  // bogus ones and quietly eat a `pop` from the cap. Ids here are testids and country names, but
  // the separator is not the caller's problem to remember.
  const claimKey = `${weight}:${id.replace(/,/g, ';')}`;
  const spent = celebrationLedger.fired();
  if (spent.includes(claimKey)) return false;
  const prefix = `${weight}:`;
  if (spent.filter((k) => k.startsWith(prefix)).length >= SESSION_CAP[weight]) return false;
  celebrationLedger.markFired(claimKey);
  return true;
}
