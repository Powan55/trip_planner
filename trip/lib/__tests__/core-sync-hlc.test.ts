import { describe, it, expect } from 'vitest';
import {
  serialize,
  parse,
  compareHlc,
  hlcSendOrLocal,
  hlcReceive,
  seedHlcFromLegacy,
  PT_WIDTH,
  CT_WIDTH,
  CT_MAX,
  MAX_SKEW_MS,
  type Hlc,
} from '@/core/sync/hlc';
import { mergeItems, type SyncedRow } from '@/core/sync/merge-items';

/**
 * Sync v2 — HLC unit suite (S96; D-105 LOCKED).
 *
 * Proves the five properties of the pure Hybrid Logical Clock: monotonicity, skew
 * absorption, total order, string-sort==tuple-sort, and the ct-overflow ceiling. Physical
 * time is injected as a plain number throughout — no clock is read (D-099 purity), so every
 * assertion is deterministic.
 */

// A small deterministic PRNG (mulberry32) so the fuzz sets are reproducible run-to-run.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('HLC — serialize / parse', () => {
  it('serialize produces fixed-width zero-padded fields pt:ct:actor', () => {
    const s = serialize({ pt: 1234567890, ct: 5, actor: 'uidA' });
    const [ptField, ctField, actorField] = s.split(':');
    expect(ptField).toHaveLength(PT_WIDTH);
    expect(ctField).toHaveLength(CT_WIDTH);
    expect(ptField).toBe('000001234567890');
    expect(ctField).toBe('000005');
    expect(actorField).toBe('uidA');
  });

  it('parse is the inverse of serialize for well-formed stamps', () => {
    const hlc: Hlc = { pt: 1751700000000, ct: 42, actor: 'device-9' };
    expect(parse(serialize(hlc))).toEqual(hlc);
  });

  it('parse tolerates an actor containing ":" (only the first two ":" are separators)', () => {
    const hlc: Hlc = { pt: 10, ct: 1, actor: 'weird:actor:id' };
    expect(parse(serialize(hlc))).toEqual(hlc);
  });

  it('parse of a malformed string yields the oldest stamp (pt:0, ct:0, actor:"")', () => {
    expect(parse('garbage')).toEqual({ pt: 0, ct: 0, actor: '' });
  });
});

describe('HLC — monotonicity', () => {
  it('repeated hlcSendOrLocal on the SAME ms strictly increases the serialized stamp (ct increments)', () => {
    const actor = 'uidA';
    const fixedMs = 1751700000000;
    let last: Hlc | null = null;
    const stamps: string[] = [];
    for (let i = 0; i < 1000; i++) {
      last = hlcSendOrLocal(last, fixedMs, actor); // physical clock frozen — ct must carry the order
      stamps.push(serialize(last));
    }
    // Every stamp is strictly greater than its predecessor.
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i] > stamps[i - 1]).toBe(true);
    }
    // After 1000 same-ms events, ct is exactly 999 (0-based first event).
    expect(last!.ct).toBe(999);
    expect(last!.pt).toBe(fixedMs);
  });

  it('a slow local clock never runs the stamp backward (pt ratchets via max)', () => {
    const first = hlcSendOrLocal(null, 5000, 'uidA');
    // Next physical read is EARLIER (clock stepped back) — pt must not regress.
    const second = hlcSendOrLocal(first, 4000, 'uidA');
    expect(second.pt).toBe(5000); // held at the prior max
    expect(second.ct).toBe(first.ct + 1); // pt unchanged ⇒ ct advances
    expect(serialize(second) > serialize(first)).toBe(true);
  });

  it('advancing physical time resets ct to 0 (fresh millisecond)', () => {
    const a = hlcSendOrLocal(null, 1000, 'uidA'); // ct 0
    const b = hlcSendOrLocal(a, 1000, 'uidA'); // ct 1 (same ms)
    const c = hlcSendOrLocal(b, 2000, 'uidA'); // new ms ⇒ ct 0
    expect(a.ct).toBe(0);
    expect(b.ct).toBe(1);
    expect(c.ct).toBe(0);
    expect(c.pt).toBe(2000);
    expect(serialize(c) > serialize(b)).toBe(true);
  });
});

describe('HLC — skew absorption (clamped, D-228)', () => {
  it('after receiving a FAR-FUTURE peer stamp, the running clock is CLAMPED to MAX_SKEW_MS (D-228) — not poisoned to the peer value', () => {
    const localActor = 'uidLocal';
    // Our real clock is "now"; the peer's stamp is a year in the future.
    const realNow = 1751700000000;
    const farFuture = realNow + 365 * 24 * 60 * 60 * 1000;
    const peer: Hlc = { pt: farFuture, ct: 3, actor: 'uidPeer' };

    // Absorb the peer's clock — the remote contribution is capped at physicalNow + MAX_SKEW_MS.
    const absorbed = hlcReceive({ pt: realNow, ct: 0, actor: localActor }, peer, realNow);
    expect(absorbed.pt).toBe(realNow + MAX_SKEW_MS); // clamped, NOT the far-future peer value
    expect(absorbed.ct).toBe(0); // pt !== local.pt and pt !== remote.pt (both capped away) ⇒ reset branch

    // The next LOCAL edit ratchets off the CLAMPED clock (still bounded, not poisoned).
    const nextLocal = hlcSendOrLocal(absorbed, realNow, localActor);
    expect(nextLocal.pt).toBe(realNow + MAX_SKEW_MS); // stayed at the clamped ceiling

    // ACCEPTED CEILING (D-228 "accepted ceilings" #1): the clamp means our running clock does NOT
    // out-rank the far-future peer's STORED stamp — a subsequent local edit sorts BELOW it. This
    // is the deliberate trade for defense-in-depth (the stored-stamp merge path is untouched).
    expect(serialize(nextLocal) < serialize(peer)).toBe(true);
    expect(compareHlc(nextLocal, peer)).toBeLessThan(0);
  });

  it('receiving an OLDER peer stamp does not move our clock backward', () => {
    const local: Hlc = { pt: 9000, ct: 2, actor: 'uidLocal' };
    const older: Hlc = { pt: 1000, ct: 9, actor: 'uidPeer' };
    const out = hlcReceive(local, older, 9000);
    expect(out.pt).toBe(9000); // held at local max
    expect(out.ct).toBe(local.ct + 1); // pt==local.pt ⇒ local.ct + 1
    expect(serialize(out) > serialize(local)).toBe(true);
  });
});

describe('HLC — clock-skew clamp (D-228, S278): bounds hlcReceive RUNNING clock only, never the stored-stamp merge path', () => {
  it('R1 far-future non-poisoning: an absurdly-future peer (1000 years) is clamped, and the clamp HOLDS across a subsequent receive/send — the running clock never adopts it', () => {
    const NOW = 1751700000000;
    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const badPeer: Hlc = { pt: NOW + 1000 * YEAR_MS, ct: 0, actor: 'bad' };

    const received = hlcReceive({ pt: NOW, ct: 0, actor: 'me' }, badPeer, NOW);
    expect(received.pt).toBe(NOW + MAX_SKEW_MS);

    const sent = hlcSendOrLocal(received, NOW, 'me');
    expect(sent.pt).toBe(NOW + MAX_SKEW_MS); // still bounded, not poisoned
  });

  it('R2 plausible-ahead (< MAX_SKEW_MS) is still absorbed UNCHANGED — no update lost', () => {
    const NOW = 1751700000000;
    const FIVE_MIN_MS = 5 * 60 * 1000;
    const local: Hlc = { pt: NOW, ct: 0, actor: 'me' };
    const plausiblePeer: Hlc = { pt: NOW + FIVE_MIN_MS, ct: 4, actor: 'peer' };

    const received = hlcReceive(local, plausiblePeer, NOW);
    expect(received.pt).toBe(NOW + FIVE_MIN_MS); // clamp is a no-op well under the ceiling
    expect(received.ct).toBe(5); // pt===remote.pt ⇒ remote.ct + 1 (today's unchanged behavior)

    // A subsequent local edit sorts strictly after via compareHlc — no update lost.
    const nextLocal = hlcSendOrLocal(received, NOW, 'me');
    expect(compareHlc(nextLocal, plausiblePeer)).toBeGreaterThan(0);
  });

  it('R3 boundary: remote.pt exactly at physicalNow+MAX_SKEW_MS is absorbed as-is; +1ms is clamped', () => {
    const NOW = 1751700000000;
    const local: Hlc = { pt: NOW, ct: 0, actor: 'me' };

    const atBoundary: Hlc = { pt: NOW + MAX_SKEW_MS, ct: 7, actor: 'peer' };
    const receivedAt = hlcReceive(local, atBoundary, NOW);
    expect(receivedAt.pt).toBe(NOW + MAX_SKEW_MS);
    expect(receivedAt.ct).toBe(8); // pt===remote.pt ⇒ remote.ct + 1 (unclamped path)

    const overBoundary: Hlc = { pt: NOW + MAX_SKEW_MS + 1, ct: 7, actor: 'peer' };
    const receivedOver = hlcReceive(local, overBoundary, NOW);
    expect(receivedOver.pt).toBe(NOW + MAX_SKEW_MS); // 1ms over ⇒ clamped, does not reach remote.pt
  });

  it('R4 convergence across differing physicalNow (STORED stamp — mergeItems/compareHlc, NOT hlcReceive): the winning stored hlc is byte-identical no matter which physicalNow minted the losing local row', () => {
    const NOW = 1751700000000;
    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    // A remote row carrying a far-future STORED hlc (e.g. a bad-clock device's own past edit) —
    // this is the STORED merge path, so it is deliberately NOT clamped (D-228).
    const remoteFarFuture: SyncedRow & { id: string } = {
      id: 'row-1',
      hlc: serialize({ pt: NOW + 10 * YEAR_MS, ct: 0, actor: 'bad' }),
    };

    // Two different devices, with DIFFERENT physical clocks (a few hours apart — ordinary skew),
    // each mint their own competing local row for the same id at their own physicalNow.
    const localDeviceA: SyncedRow & { id: string } = {
      id: 'row-1',
      hlc: serialize(hlcSendOrLocal(null, NOW, 'deviceA')),
    };
    const localDeviceB: SyncedRow & { id: string } = {
      id: 'row-1',
      hlc: serialize(hlcSendOrLocal(null, NOW + 6 * 60 * 60 * 1000, 'deviceB')),
    };

    const mergedOnDeviceA = mergeItems([localDeviceA], [remoteFarFuture]);
    const mergedOnDeviceB = mergeItems([localDeviceB], [remoteFarFuture]);

    // Both devices' local edits lose to the far-future remote row regardless of their own
    // physicalNow — the winning STORED hlc is byte-identical on both, proving convergence does
    // not depend on which physicalNow minted the losing candidate.
    expect(mergedOnDeviceA[0]!.hlc).toBe(remoteFarFuture.hlc);
    expect(mergedOnDeviceB[0]!.hlc).toBe(remoteFarFuture.hlc);
    expect(mergedOnDeviceA[0]!.hlc).toBe(mergedOnDeviceB[0]!.hlc);
  });

  it('R5 monotonicity: hlcSendOrLocal always sorts strictly after `last` (pt below/equal/above NOW, incl. far-future inherited pt); hlcReceive result pt >= localPt always', () => {
    const NOW = 1751700000000;
    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const actor = 'me';

    for (const lastPt of [NOW - 5000, NOW, NOW + 5000, NOW + 1000 * YEAR_MS]) {
      const last: Hlc = { pt: lastPt, ct: 2, actor };
      const next = hlcSendOrLocal(last, NOW, actor);
      expect(compareHlc(next, last)).toBeGreaterThan(0);
    }

    // hlcReceive: result pt is never below the local pt, across a small fuzz of local/remote/now.
    const r = rng(42);
    for (let i = 0; i < 200; i++) {
      const localPt = Math.floor(r() * 1e13);
      const remotePt = Math.floor(r() * 1e13);
      const physicalNow = Math.floor(r() * 1e13);
      const local: Hlc = { pt: localPt, ct: 0, actor: 'me' };
      const remote: Hlc = { pt: remotePt, ct: 0, actor: 'peer' };
      const out = hlcReceive(local, remote, physicalNow);
      expect(out.pt).toBeGreaterThanOrEqual(localPt);
    }
  });
});

describe('HLC — total order is a strict total order', () => {
  const fuzz: Hlc[] = [];
  const r = rng(1337);
  for (let i = 0; i < 300; i++) {
    fuzz.push({
      pt: Math.floor(r() * 5), // small domain ⇒ forces frequent ties on pt
      ct: Math.floor(r() * 5),
      actor: ['', 'a', 'b', 'uid-1', 'uid-2'][Math.floor(r() * 5)],
    });
  }

  // FU-30 (S161): these two are inherently O(n²) over the 300-item fuzz set (~90k pairs, up to
  // ~180k compareHlc calls) — correct, but the 5000ms DEFAULT test timeout trips under full-suite
  // CPU contention (parallel Playwright / a second session), false-failing the reality gate on
  // nearly every net while passing 19/19 isolated. Raise the budget to 15s (the FU-16 precedent for
  // the serialize sibling below); the pairwise coverage is unchanged, only the deadline moves.
  it('is antisymmetric: sign(compare(a,b)) === -sign(compare(b,a))', () => {
    // Normalize -0 → 0 so an equal pair (both signs 0) compares cleanly under toBe (Object.is
    // distinguishes -0 from +0). Antisymmetry is about the SIGN, so `|| 0` is the right norm.
    const nsign = (n: number) => Math.sign(n) || 0;
    for (const a of fuzz) {
      for (const b of fuzz) {
        expect(nsign(compareHlc(a, b))).toBe(nsign(-compareHlc(b, a)));
      }
    }
  }, 15000);

  it('is total: compare===0 iff the triples are field-equal (no incomparable pairs)', () => {
    for (const a of fuzz) {
      for (const b of fuzz) {
        const eq = a.pt === b.pt && a.ct === b.ct && a.actor === b.actor;
        expect(compareHlc(a, b) === 0).toBe(eq);
      }
    }
  }, 15000);

  it('is transitive: a<=b and b<=c ⇒ a<=c across a fuzz set', () => {
    // O(n^3) — use a smaller, dense (heavy-tie) set so transitivity is stressed at the
    // ct/actor tie-break levels without a cubic blowup on the 300-item set.
    const tr = rng(7);
    const small: Hlc[] = [];
    for (let i = 0; i < 40; i++) {
      small.push({
        pt: Math.floor(tr() * 4),
        ct: Math.floor(tr() * 4),
        actor: ['', 'a', 'b'][Math.floor(tr() * 3)],
      });
    }
    for (const a of small) {
      for (const b of small) {
        if (compareHlc(a, b) > 0) continue;
        for (const c of small) {
          if (compareHlc(b, c) > 0) continue;
          expect(compareHlc(a, c)).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it('tie-break order is pt → ct → actor (higher wins at each level)', () => {
    expect(compareHlc({ pt: 2, ct: 0, actor: 'a' }, { pt: 1, ct: 9, actor: 'z' })).toBeGreaterThan(0); // pt dominates
    expect(compareHlc({ pt: 1, ct: 2, actor: 'a' }, { pt: 1, ct: 1, actor: 'z' })).toBeGreaterThan(0); // ct breaks equal pt
    expect(compareHlc({ pt: 1, ct: 1, actor: 'b' }, { pt: 1, ct: 1, actor: 'a' })).toBeGreaterThan(0); // actor breaks equal pt+ct
  });
});

describe('HLC — string-sort == tuple-sort (guards the padding width)', () => {
  it('serialize(a) < serialize(b) iff compareHlc(a,b) < 0 across a fuzz set', () => {
    const r = rng(9001);
    const set: Hlc[] = [];
    for (let i = 0; i < 400; i++) {
      set.push({
        pt: Math.floor(r() * 1e13), // realistic ms magnitudes (13 digits) — exercises the pad width
        ct: Math.floor(r() * (CT_MAX + 1)),
        actor: ['', 'a', 'zzz', 'uid-' + Math.floor(r() * 3)][Math.floor(r() * 4)],
      });
    }
    // FU-16 (S114): serialize each stamp ONCE up front (O(n)) instead of 4× per
    // inner-loop pair (O(n²) redundant serializations, ~640k calls) — the 400×400
    // pair coverage is byte-for-byte identical, but the ~5s-default timeout it kept
    // tripping under the full 21-file suite is gone. The property (string-sort ==
    // tuple-sort, the pad-width guard) is unchanged.
    const ser = set.map(serialize);
    // S277-close (run-determinism): assert ONCE, not 160k times. The 400×400 pair
    // coverage is byte-identical, but ~160k `expect()` calls carried enough per-call overhead
    // to push this past its 15s timeout once the suite grew (21 → 126 files). Accumulating the
    // first mismatch and asserting once drops the runtime to <1s and removes the load-variance
    // flake for good. The property (string-sort == tuple-sort, the pad-width guard) is unchanged.
    let mismatch: string | null = null;
    for (let i = 0; i < set.length && mismatch === null; i++) {
      for (let j = 0; j < set.length; j++) {
        const byString = ser[i] < ser[j] ? -1 : ser[i] > ser[j] ? 1 : 0;
        const byTuple = Math.sign(compareHlc(set[i], set[j]));
        if (byString !== byTuple) {
          mismatch = `pair (i=${i}, j=${j}): string-sort ${byString} != tuple-sort ${byTuple} for ${ser[i]} vs ${ser[j]}`;
          break;
        }
      }
    }
    expect(mismatch).toBeNull();
  });
});

describe('HLC — ct overflow ceiling (documented)', () => {
  it('a realistic edit burst never approaches CT_MAX (the ceiling is astronomically high)', () => {
    // 10k same-ms events is far beyond any human burst; ct stays a tiny fraction of CT_MAX.
    let last: Hlc | null = null;
    for (let i = 0; i < 10000; i++) last = hlcSendOrLocal(last, 42, 'uidA');
    expect(last!.ct).toBe(9999);
    expect(last!.ct).toBeLessThan(CT_MAX); // 9,999 << 999,999
    // At the ceiling, serialize still pads to CT_WIDTH (documented behavior).
    expect(serialize({ pt: 42, ct: CT_MAX, actor: 'x' }).split(':')[1]).toHaveLength(CT_WIDTH);
  });
});

describe('HLC — seedHlcFromLegacy (PURE, no clock)', () => {
  it('seeds pt from a valid updatedAt; ct=0, actor="" (legacy is the oldest known version)', () => {
    const iso = '2026-07-01T10:00:00.000Z';
    const seeded = parse(seedHlcFromLegacy(iso));
    expect(seeded.pt).toBe(Date.parse(iso));
    expect(seeded.ct).toBe(0);
    expect(seeded.actor).toBe('');
  });

  it('seeds pt=0 when updatedAt is absent or unparseable', () => {
    expect(parse(seedHlcFromLegacy(undefined)).pt).toBe(0);
    expect(parse(seedHlcFromLegacy('not-a-date')).pt).toBe(0);
  });

  it('is DETERMINISTIC: the same updatedAt always seeds the identical stamp (cross-client convergence)', () => {
    const iso = '2026-01-02T03:04:05.000Z';
    expect(seedHlcFromLegacy(iso)).toBe(seedHlcFromLegacy(iso));
  });

  it('a legacy seed LOSES a tie against a real post-v2 edit to the same instant (actor "" sorts lowest)', () => {
    const iso = '2026-07-01T10:00:00.000Z';
    const legacy = parse(seedHlcFromLegacy(iso));
    const realEdit: Hlc = { pt: Date.parse(iso), ct: 0, actor: 'uidReal' }; // same pt/ct, real actor
    expect(compareHlc(realEdit, legacy)).toBeGreaterThan(0); // real edit wins on actor
  });
});
