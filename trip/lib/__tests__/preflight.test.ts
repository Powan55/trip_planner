// #20 — the night-before readiness checks (`lib/preflight.ts`).
//
// The property under test in EVERY case is the same one: an unverifiable fact must render as
// "couldn't check", never as a pass. A readiness screen that reports a false pass is worse than
// no screen at all, so the unavailable/throwing paths are asserted as hard as the happy ones.
//
// Also pinned here: the D-286 copy discipline. The map row may claim the ENGINE is downloaded
// and must never claim an offline MAP — basemap tiles are cross-origin and never cached, and
// "offline map ready" is the exact overstatement D-286 exists to kill.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkInstalled,
  checkMapShell,
  checkStorage,
  evaluateClock,
  evaluateSync,
  formatUtcOffset,
  readClockChecks,
} from '@/lib/preflight';

// ── fakes (no network, no real Cache API — jsdom has neither) ───────────────────────────────

/** A cached Response stub carrying only what `checkMapShell` reads: content-length + text(). */
function fakeResponse(body: string, size: number | null, onRead?: () => void): Response {
  return {
    headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? size?.toString() ?? null : null) },
    text: async () => {
      onRead?.();
      return body;
    },
  } as unknown as Response;
}

type FakeEntry = { body: string; size?: number | null };

function fakeCacheStorage(
  contents: Record<string, Record<string, FakeEntry>>,
  onRead?: (url: string) => void
): CacheStorage {
  return {
    keys: async () => Object.keys(contents),
    open: async (name: string) => {
      const cache = contents[name] ?? {};
      return {
        keys: async () => Object.keys(cache).map((url) => ({ url }) as Request),
        match: async (req: Request) => {
          const entry = cache[req.url];
          return entry === undefined
            ? undefined
            : fakeResponse(entry.body, entry.size ?? null, () => onRead?.(req.url));
        },
      };
    },
  } as unknown as CacheStorage;
}

const ENGINE = `var maplibregl=(function(){/*${'x'.repeat(300_000)}*/})()`;
/** Carries the marker (CSS class strings) but is nowhere near engine-sized, like the ~31 KB trip-map chunk. */
const TRIP_MAP_CHUNK = '.maplibregl-ctrl{display:none}';
const NOT_ENGINE = 'export const x=1;';
/** A precache the worker finished filling: its URL list, and every URL on it. */
const SHELL: Record<string, FakeEntry> = {
  'https://x/__precache-urls.json': { body: '["/","/plan/"]' },
  'https://x/': { body: 'HOME' },
  'https://x/plan/': { body: 'PLAN' },
};

// ── 1. Map shell ────────────────────────────────────────────────────────────────────────────

describe('#20 · map shell — the engine, never "the offline map"', () => {
  it('PASS: the maplibre chunk is present in the precache', async () => {
    const check = await checkMapShell(
      fakeCacheStorage({
        'trip-precache-93f277c05d06': {
          ...SHELL,
          'https://x/_next/static/chunks/a.js': { body: NOT_ENGINE, size: 1200 },
          'https://x/_next/static/chunks/b.js': { body: ENGINE, size: 1032412 },
        },
      })
    );
    expect(check.state).toBe('ok');
    expect(check.headline).toBe('Saved on this device');
  });

  it('the passing copy claims the ENGINE and explicitly denies offline tiles (D-286)', async () => {
    const check = await checkMapShell(
      fakeCacheStorage({ 'trip-precache-abc': { ...SHELL, 'https://x/b.js': { body: ENGINE, size: 999 } } })
    );
    const copy = `${check.headline} ${check.detail}`.toLowerCase();
    expect(copy).toContain('pins and your route');
    expect(copy).toContain('needs a connection');
    // The three ways this row could overstate what is downloaded.
    expect(copy).not.toContain('offline map');
    expect(copy).not.toContain('map works offline');
    expect(copy).not.toContain('map tiles');
  });

  it('largest-first: the ~1 MB engine chunk is found in ONE cached read, not 124', async () => {
    const reads: string[] = [];
    const contents: Record<string, FakeEntry> = { ...SHELL, 'https://x/big.js': { body: ENGINE, size: 1032412 } };
    for (let i = 0; i < 20; i++) contents[`https://x/small${i}.js`] = { body: NOT_ENGINE, size: 900 };
    const check = await checkMapShell(
      fakeCacheStorage({ 'trip-precache-abc': contents }, (url) => reads.push(url))
    );
    expect(check.state).toBe('ok');
    expect(reads.filter((u) => u.endsWith('.js'))).toEqual(['https://x/big.js']);
  });

  it('ATTENTION: a precache with no maplibre chunk says the engine is not saved yet, not a pass', async () => {
    const check = await checkMapShell(
      fakeCacheStorage({
        'trip-precache-abc': {
          ...SHELL,
          'https://x/a.js': { body: NOT_ENGINE, size: 1200 },
          'https://x/index.html': { body: `<script>${ENGINE}</script>`, size: 4000 }, // not .js — ignored
        },
      })
    );
    expect(check.state).toBe('attention');
    expect(check.headline).toBe('Map engine not saved yet');
    // V6-14 made this the state of EVERY fresh install until the first online /map visit, so
    // the copy must name that action and must not read as a fault. It stays 'attention'
    // because there IS something to do; what changed is that it says what.
    expect(check.detail).toMatch(/open the map with a connection/i);
    expect(check.detail).not.toMatch(/missing|isn't in that copy/i);
  });

  it('ATTENTION (#808): the small trip-map chunk carrying the marker is not the engine', async () => {
    const check = await checkMapShell(
      fakeCacheStorage({
        'trip-precache-abc': { ...SHELL, 'https://x/trip-map.js': { body: TRIP_MAP_CHUNK, size: 31000 } },
      })
    );
    expect(check.state).toBe('attention');
    expect(check.headline).toBe('Map engine not saved yet');
  });

  // #945: the engine now lives in the runtime cache, which survives updates.
  it('PASS: the engine in trip-runtime-* next to a complete precache', async () => {
    const check = await checkMapShell(
      fakeCacheStorage({
        'trip-precache-abc': SHELL,
        'trip-runtime-def': { 'https://x/b.js': { body: ENGINE, size: 1032412 } },
      })
    );
    expect(check.headline).toBe('Saved on this device');
  });

  // #945: a failed install or partial refill must not read as saved, whichever cache comes first.
  it('FAIL: a precache missing entries from its own list is "not saved yet", engine or not', async () => {
    const { 'https://x/plan/': _dropped, ...partial } = SHELL;
    const check = await checkMapShell(
      fakeCacheStorage({
        'trip-precache-partial': { ...partial, 'https://x/b.js': { body: ENGINE, size: 1032412 } },
        'trip-precache-nolist': { 'https://x/': { body: 'HOME' } },
      })
    );
    expect(check.headline).toBe('Not saved yet');
  });

  it('FAIL: no trip-precache-* cache at all reports "not saved yet"', async () => {
    const check = await checkMapShell(fakeCacheStorage({ 'trip-images-v1': {} }));
    expect(check.state).toBe('attention');
    expect(check.headline).toBe('Not saved yet');
  });

  it('UNAVAILABLE: no Cache API reads as "couldn\'t check", never a pass', async () => {
    const check = await checkMapShell(undefined);
    expect(check.state).toBe('unknown');
    expect(check.headline).toBe("Couldn't check");
  });

  it('UNAVAILABLE: a Cache API that throws reads as "couldn\'t check"', async () => {
    const exploding = {
      keys: async () => {
        throw new Error('SecurityError');
      },
    } as unknown as CacheStorage;
    const check = await checkMapShell(exploding);
    expect(check.state).toBe('unknown');
  });
});

// ── 2. Storage room ─────────────────────────────────────────────────────────────────────────

// 1 char = 2 bytes; key 'k' adds 2 more.
const fillLocal = (bytes: number) => localStorage.setItem('k', 'x'.repeat((bytes - 2) / 2));

describe('#20 · storage room (localStorage vs ~5 MB cap, #1130)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('PASS: well under the threshold reports the ratio', async () => {
    fillLocal(2 * 1024 * 1024);
    const check = await checkStorage();
    expect(check.state).toBe('ok');
    expect(check.headline).toBe('Room to spare');
    expect(check.detail).toContain('1 MB of 5 MB (20%)');
  });

  it('FAIL: at/over the 0.9 threshold (shared with the quota toast) it needs attention', async () => {
    fillLocal(Math.ceil(9.2 * 1024 * 1024 / 2) * 2);
    const check = await checkStorage();
    expect(check.state).toBe('attention');
    expect(check.headline).toBe('Nearly full');
    expect(check.detail).toContain("92%");
  });

  it('UNAVAILABLE: localStorage throwing reads as "couldn\'t check"', async () => {
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('denied');
    });
    localStorage.setItem('a', 'b');
    const check = await checkStorage();
    expect(check.state).toBe('unknown');
    expect(check.headline).toBe("Couldn't check");
  });
});

// ── 3. Clock & time zone ────────────────────────────────────────────────────────────────────

const NPT = 345;
const JST = 540;
const EST = -300;
const clockInput = (over: Partial<Parameters<typeof evaluateClock>[0]> = {}) =>
  evaluateClock({
    deviceOffsetMin: NPT,
    tripOffsetMin: NPT,
    tripPlace: 'Nepal',
    onTrip: false,
    simulatedDay: null,
    ...over,
  });

describe('#20 · clock & time zone', () => {
  it('formats offsets with real minutes (Nepal is :45, which is the whole point)', () => {
    expect(formatUtcOffset(NPT)).toBe('UTC+5:45');
    expect(formatUtcOffset(EST)).toBe('UTC−5:00');
  });

  it('PASS: the device zone matches the leg', () => {
    const [clock] = clockInput();
    expect(clock.state).toBe('ok');
    expect(clock.headline).toBe('Phone is on trip time');
  });

  it('a wrong device zone DURING the trip needs attention and names both zones', () => {
    const [clock] = clockInput({ deviceOffsetMin: EST, tripOffsetMin: JST, tripPlace: 'Japan', onTrip: true });
    expect(clock.state).toBe('attention');
    expect(clock.headline).toBe("Phone isn't on trip time");
    expect(clock.detail).toContain('UTC−5:00');
    expect(clock.detail).toContain('JST (UTC+9:00)');
  });

  it('the SAME mismatch the night before is stated, not failed — a phone on home time is normal', () => {
    const [clock] = clockInput({ deviceOffsetMin: EST, onTrip: false });
    expect(clock.state).toBe('ok');
    expect(clock.headline).toBe('Phone is on home time');
    expect(clock.detail).toContain('UTC−5:00');
    expect(clock.detail).toContain('NPT (UTC+5:45)');
  });

  it('UNAVAILABLE: a trip with no geography has nothing to compare against', () => {
    const [clock] = clockInput({ tripOffsetMin: null });
    expect(clock.state).toBe('unknown');
    expect(clock.headline).toBe("Couldn't compare");
  });

  it('every clock verdict states the ceiling: zones can be compared offline, the time itself cannot', () => {
    for (const over of [{}, { deviceOffsetMin: EST }, { onTrip: true, deviceOffsetMin: EST }, { tripOffsetMin: null }]) {
      expect(clockInput(over)[0].detail).toContain('trusted time source');
    }
  });

  it('no simulated-clock row when the override is off', () => {
    expect(clockInput().map((c) => c.id)).toEqual(['clock']);
  });

  it('?today= gets its OWN visible row rather than silently passing the clock check', () => {
    const rows = clockInput({ simulatedDay: '2026-12-14' });
    expect(rows.map((c) => c.id)).toEqual(['clock', 'simulated-clock']);
    expect(rows[1].state).toBe('attention');
    expect(rows[1].detail).toContain('2026-12-14');
    expect(rows[1].detail).toContain('?today=off');
  });
});

describe('#20 · readClockChecks reads the REAL clock, not getNow()', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('a persisted ?today= override surfaces as the simulated-clock row', () => {
    // The exact key `lib/trip-now.ts` resolves `?today=YYYY-MM-DD` into (gateway: todayOverride).
    window.sessionStorage.setItem('tripPlannerTodayOverride', '2026-12-14');
    const rows = readClockChecks();
    expect(rows.map((c) => c.id)).toEqual(['clock', 'simulated-clock']);
    expect(rows[1].headline).toBe('Simulated clock active');
    expect(rows[1].detail).toContain('2026-12-14');
  });

  it('no override → exactly one clock row, and it is never a fabricated pass', () => {
    const rows = readClockChecks();
    expect(rows.map((c) => c.id)).toEqual(['clock']);
    expect(['ok', 'attention', 'unknown']).toContain(rows[0].state);
  });
});

// ── 4. Trip data synced ─────────────────────────────────────────────────────────────────────

describe('#20 · trip data (outbox, per D-193 — not Firestore hasPendingWrites)', () => {
  it('FAIL: queued changes are named and counted', () => {
    expect(evaluateSync({ pending: 3, lastAckAt: null }).headline).toBe('3 changes waiting to upload');
    expect(evaluateSync({ pending: 3, lastAckAt: null }).state).toBe('attention');
    expect(evaluateSync({ pending: 1, lastAckAt: null }).headline).toBe('1 change waiting to upload');
  });

  it('signed out of the default pack outranks the pending row', () => {
    const check = evaluateSync({ pending: 2, lastAckAt: null, signInRequired: true });
    expect(check.state).toBe('attention');
    expect(check.headline).toBe('Sign in to sync');
    expect(check.detail).toBe('2 changes are saved here and upload once you sign in.');
  });

  it('PASS: nothing queued and a confirmed upload reports when it landed', () => {
    const now = new Date('2026-12-08T20:00:00Z');
    const check = evaluateSync({ pending: 0, lastAckAt: '2026-12-08T18:00:00Z' }, now);
    expect(check.state).toBe('ok');
    expect(check.headline).toBe("Everything's uploaded");
    expect(check.detail).toContain('2h ago');
  });

  it('the dormant/guest build ({0, null}) renders neutrally and claims no server confirmation', () => {
    const check = evaluateSync({ pending: 0, lastAckAt: null });
    expect(check.state).toBe('ok');
    expect(check.headline).toBe('Nothing waiting to upload');
    expect(check.detail).toContain('saved on this device');
    expect(check.detail).not.toContain('confirmed');
  });

  it('#267 · a REFUSED change is not "waiting to upload" — it never will be', () => {
    // Same one queued change (blocked ⊆ pending), but the pending row's promise that it uploads
    // "on their own next time you're online" is false for a rules refusal, so the refusal wins.
    const check = evaluateSync({ pending: 1, blocked: 1, lastAckAt: null });
    expect(check.state).toBe('attention');
    expect(check.headline).toBe('1 change the shared trip refused');
    expect(check.detail).not.toContain('will upload on their own next time');
    expect(check.detail).toContain('Trip access'); // says what to do about it
    expect(evaluateSync({ pending: 3, blocked: 2, lastAckAt: null }).headline).toBe(
      '2 changes the shared trip refused',
    );
  });

  it('#267 · blocked:0 is byte-identical to the pre-#267 behaviour, and the field is optional', () => {
    expect(evaluateSync({ pending: 3, blocked: 0, lastAckAt: null })).toEqual(
      evaluateSync({ pending: 3, lastAckAt: null }),
    );
  });
});

describe('checkInstalled (#950)', () => {
  it('standalone → ok', () => {
    expect(checkInstalled(true, true).state).toBe('ok');
  });

  it('a browser tab → attention; iOS gets the Share steps and the starts-empty caveat', () => {
    const ios = checkInstalled(false, true);
    expect(ios.state).toBe('attention');
    expect(ios.detail).toContain('Add to Home Screen');
    expect(ios.detail).toContain('starts empty');
    expect(checkInstalled(false, false).detail).toContain('Install app');
  });

  it('an unanswerable browser is "couldn\'t check", never a pass', () => {
    const check = checkInstalled(undefined, false);
    expect(check.state).toBe('unknown');
    expect(check.headline).toBe("Couldn't check");
  });
});
