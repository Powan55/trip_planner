// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/firebase-config', async (orig) => ({
  ...(await orig<typeof import('@/lib/firebase-config')>()),
  isRemoteConfigured: () => true,
}));
vi.mock('@/lib/token-auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/token-auth')>()),
  getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }),
}));

// Firestore stand-in for the account prefs doc, with optimistic transactions (a commit whose read
// doc changed underneath it retries), so claimField's create-if-absent is exercised for real.
type Data = Record<string, unknown>;
const docs = new Map<string, { data: Data; ver: number }>();
let online = true;
// Holds the first transaction read of each of two runs until both have read, so both see an empty
// account and one commit has to retry.
let barrier: { waiting: number; release: () => void; done: Promise<void> } | null = null;
const fs = {
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  runTransaction: async <T,>(_db: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => {
    for (;;) {
      const seen = new Map<string, number>();
      const writes: (() => void)[] = [];
      const tx = {
        get: async (ref: { path: string }) => {
          if (barrier && ++barrier.waiting === 2) barrier.release();
          await barrier?.done;
          await Promise.resolve();
          const d = docs.get(ref.path);
          seen.set(ref.path, d?.ver ?? 0);
          const data = d && structuredClone(d.data);
          return { exists: () => !!d, data: () => data };
        },
        set: (ref: { path: string }, data: Data) =>
          writes.push(() => docs.set(ref.path, { data: structuredClone(data), ver: (docs.get(ref.path)?.ver ?? 0) + 1 })),
        update: (ref: { path: string }, data: Data) =>
          writes.push(() => {
            const d = docs.get(ref.path)!;
            docs.set(ref.path, { data: { ...d.data, ...structuredClone(data) }, ver: d.ver + 1 });
          }),
      };
      const out = await fn(tx);
      if ([...seen].some(([p, v]) => (docs.get(p)?.ver ?? 0) !== v)) continue;
      writes.forEach((w) => w());
      return out;
    }
  },
};
vi.mock('@/lib/firebase-remote', () => ({
  getRemote: () => (online ? Promise.resolve({ db: {}, fs, uid: 'uid-a' }) : Promise.reject(new Error('offline'))),
}));

import { syncDefaultShare } from '@/lib/account-share';
import {
  DEFAULT_TRIP_ID,
  STORAGE_KEYS,
  getDefaultTripShareId,
  keyForTrip,
  setDefaultTripShareId,
  wasTripCreatedHere,
} from '@/core/storage/gateway';
import { outboxDirty } from '@/core/sync/outbox';

const PATH = 'trips/acct-1/profile/prefs';
const accountShare = () => (docs.get(PATH)?.data.defaultShare as { v: unknown } | undefined)?.v;
const setAccountShare = (v: string) =>
  docs.set(PATH, { data: { defaultShare: { v, hlc: '000000001000000:000000:uid-z' } }, ver: 1 });

let reloads = 0;
const realLocation = window.location;

function asDevice() {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(STORAGE_KEYS.syncCode, 'acct-1');
}

beforeEach(() => {
  docs.clear();
  online = true;
  barrier = null;
  reloads = 0;
  asDevice();
  Object.defineProperty(window, 'location', {
    value: { ...realLocation, reload: () => void reloads++ },
    configurable: true,
    writable: true,
  });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { value: realLocation, configurable: true, writable: true });
});

// The navigator.locks path is untested: jsdom has no navigator.locks. The re-read before writing
// covers the same race, and the concurrent-mint test below runs without the lock.
describe('default share follows the account (D-598)', () => {
  it('two devices on one account end on the same id; only the minter is marked created-here', async () => {
    await syncDefaultShare();
    const a = getDefaultTripShareId();
    expect(a).not.toBe('');
    expect(accountShare()).toBe(a);
    expect(wasTripCreatedHere(a)).toBe(true);
    expect(reloads).toBe(1);

    asDevice();
    const plans = [{ date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [] }];
    localStorage.setItem(STORAGE_KEYS.itinerary, JSON.stringify(plans));
    await syncDefaultShare();
    expect(getDefaultTripShareId()).toBe(a);
    expect(wasTripCreatedHere(a)).toBe(false);
    expect(outboxDirty('itinerary')).toEqual(['2026-12-10']);
  });

  it('a device whose account already has an id adopts it without claiming the trip', async () => {
    setAccountShare('winner-id');
    await syncDefaultShare();
    expect(getDefaultTripShareId()).toBe('winner-id');
    expect(wasTripCreatedHere('winner-id')).toBe(false);
  });

  it('two concurrent mints collapse to one id and one adopt', async () => {
    let release = () => {};
    const done = new Promise<void>((r) => (release = r));
    barrier = { waiting: 0, release, done };
    await Promise.all([syncDefaultShare(), syncDefaultShare()]);
    expect(barrier.waiting).toBe(3); // both read an empty account, then the loser retried
    expect(reloads).toBe(1);
    expect(getDefaultTripShareId()).toBe(accountShare());
  });

  it('offline mints nothing', async () => {
    online = false;
    await syncDefaultShare();
    expect(docs.size).toBe(0);
    expect(getDefaultTripShareId()).toBe('');
    expect(localStorage.getItem(STORAGE_KEYS.tripsCreatedHere)).toBeNull();
    expect(reloads).toBe(0);
  });

  it('uploads the device id when the server is empty, even if the local mirror holds another', async () => {
    setDefaultTripShareId('device-x');
    localStorage.setItem(
      STORAGE_KEYS.personPrefs,
      JSON.stringify({ defaultShare: { v: 'mirror-y', hlc: '000000001000000:000000:uid-z' } }),
    );
    await syncDefaultShare();
    expect(accountShare()).toBe('device-x');
    expect(getDefaultTripShareId()).toBe('device-x');
  });

  it('marks every synced domain the pack holds dirty before adopting', async () => {
    setAccountShare('acct-trip');
    const put = (slot: Parameters<typeof keyForTrip>[1], v: unknown) =>
      localStorage.setItem(keyForTrip(DEFAULT_TRIP_ID, slot), JSON.stringify(v));
    put('itinerary', [{ date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [] }]);
    put('budget', {});
    put('docsChecklist', []);
    put('myPlaces', []);
    put('expenses', [
      { id: 'e1', leg: 'japan', category: 'food', amount: 1, createdAt: '2026-12-01T00:00:00Z' },
      { id: 'e2', leg: 'japan', category: 'food', amount: 2, createdAt: '2026-12-01T00:00:00Z' },
      { id: 'e3', leg: 'mars', category: 'food', amount: 3, createdAt: '2026-12-01T00:00:00Z' },
    ]);
    await syncDefaultShare();
    expect(getDefaultTripShareId()).toBe('acct-trip');
    expect(outboxDirty('itinerary')).toEqual(['2026-12-10']);
    expect(outboxDirty('budget')).toEqual(['model']);
    expect(outboxDirty('docs')).toEqual(['checklist']);
    expect(outboxDirty('places')).toEqual(['list']);
    expect(outboxDirty('expenses')).toEqual(['japan']);
  });

  // Records current behaviour, not a requirement: D-561 drops the outbox with the synced slots.
  it('switching to another share after adopting drops the queued outbox', async () => {
    setAccountShare('acct-trip');
    localStorage.setItem(STORAGE_KEYS.itinerary, JSON.stringify([{ date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [] }]));
    await syncDefaultShare();
    expect(outboxDirty('itinerary')).toEqual(['2026-12-10']);
    setDefaultTripShareId('other-trip');
    expect(outboxDirty('itinerary')).toEqual([]);
  });

  it('leaves a device with its own id alone, and uploads it when the account has none', async () => {
    setDefaultTripShareId('device-x');
    setAccountShare('account-y');
    await syncDefaultShare();
    expect(getDefaultTripShareId()).toBe('device-x');
    expect(accountShare()).toBe('account-y');

    docs.clear();
    await syncDefaultShare();
    expect(getDefaultTripShareId()).toBe('device-x');
    expect(accountShare()).toBe('device-x');
    expect(reloads).toBe(0);
  });

  it('adopts at most once per session', async () => {
    setAccountShare('acct-trip');
    await syncDefaultShare();
    localStorage.removeItem(STORAGE_KEYS.defaultTripShare);
    await syncDefaultShare();
    expect(reloads).toBe(1);
  });
});
