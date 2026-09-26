// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';

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
import { markOutboxDirty, outboxDirty } from '@/core/sync/outbox';

const PATH = 'trips/acct-1/profile/prefs';
const accountShare = () => (docs.get(PATH)?.data.defaultShare as { v: unknown } | undefined)?.v;
const setAccountShare = (v: string) =>
  docs.set(PATH, { data: { defaultShare: { v, hlc: '000000001000000:000000:uid-z' } }, ver: 1 });

let reloads = 0;
const realLocation = window.location;
let confirmSpy: MockInstance<typeof window.confirm>;
const plans = [{ date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [] }];

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
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  Object.defineProperty(window, 'location', {
    value: { ...realLocation, reload: () => void reloads++ },
    configurable: true,
    writable: true,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
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
    await syncDefaultShare();
    expect(getDefaultTripShareId()).toBe(a);
    expect(wasTripCreatedHere(a)).toBe(false);
  });

  it('a device with no local plan adopts the account id without asking or claiming the trip', async () => {
    setAccountShare('winner-id');
    await syncDefaultShare();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(getDefaultTripShareId()).toBe('winner-id');
    expect(wasTripCreatedHere('winner-id')).toBe(false);
    expect(reloads).toBe(1);
  });

  it('the minter queues its local plan so it seeds the new trip', async () => {
    localStorage.setItem(STORAGE_KEYS.itinerary, JSON.stringify(plans));
    await syncDefaultShare();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(outboxDirty('itinerary')).toEqual(['2026-12-10']);
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

  const fillPack = () => {
    const put = (slot: Parameters<typeof keyForTrip>[1], v: unknown) =>
      localStorage.setItem(keyForTrip(DEFAULT_TRIP_ID, slot), JSON.stringify(v));
    put('itinerary', plans);
    put('budget', {});
    put('docsChecklist', []);
    put('myPlaces', []);
    put('expenses', [{ id: 'e1', leg: 'japan', category: 'food', amount: 1, createdAt: '2026-12-01T00:00:00Z' }]);
    markOutboxDirty('itinerary', ['2026-12-10']);
  };
  const SLOTS = ['itinerary', 'budget', 'docsChecklist', 'myPlaces', 'expenses'] as const;
  const DOMAINS = ['itinerary', 'budget', 'docs', 'places', 'expenses'] as const;

  it('adopting over a local plan asks first; yes replaces it with the account trip (D-603)', async () => {
    setAccountShare('acct-trip');
    fillPack();
    confirmSpy.mockReturnValue(true);
    await syncDefaultShare();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(getDefaultTripShareId()).toBe('acct-trip');
    for (const d of DOMAINS) expect(outboxDirty(d)).toEqual([]);
    for (const slot of SLOTS) expect(localStorage.getItem(keyForTrip(DEFAULT_TRIP_ID, slot))).toBeNull();
    expect(reloads).toBe(1);
  });

  it('yes keeps the local plan when the share id write fails', async () => {
    setAccountShare('acct-trip');
    fillPack();
    confirmSpy.mockReturnValue(true);
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (v.includes('acct-trip')) throw new DOMException('full', 'QuotaExceededError');
      real.call(this, k, v);
    });
    await syncDefaultShare();
    expect(getDefaultTripShareId()).toBe('');
    expect(outboxDirty('itinerary')).toEqual(['2026-12-10']);
    expect(localStorage.getItem(keyForTrip(DEFAULT_TRIP_ID, 'itinerary'))).not.toBeNull();
    expect(reloads).toBe(0);
  });

  it('no keeps the local plan, writes nothing and does not ask again this session', async () => {
    setAccountShare('acct-trip');
    fillPack();
    const before = structuredClone(docs.get(PATH));
    confirmSpy.mockReturnValue(false);
    await syncDefaultShare();
    await syncDefaultShare();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(getDefaultTripShareId()).toBe('');
    expect(docs.get(PATH)).toEqual(before);
    expect(outboxDirty('itinerary')).toEqual(['2026-12-10']);
    expect(localStorage.getItem(keyForTrip(DEFAULT_TRIP_ID, 'itinerary'))).not.toBeNull();
    expect(reloads).toBe(0);
  });

  it('a hidden tab does not prompt and leaves the question for the next load', async () => {
    setAccountShare('acct-trip');
    fillPack();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await syncDefaultShare();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(getDefaultTripShareId()).toBe('');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await syncDefaultShare();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
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
