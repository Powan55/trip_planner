// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { SHARED_TRIP_ID } from '@/lib/shared-trip';

vi.mock('@/lib/firebase-config', async (orig) => ({
  ...(await orig<typeof import('@/lib/firebase-config')>()),
  isRemoteConfigured: () => true,
}));
vi.mock('@/lib/token-auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/token-auth')>()),
  getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }),
}));

// Stand-in for the one Firestore read settle() makes: the shared trip doc, from the server.
type SharedDoc = 'exists' | 'missing' | 'denied';
let sharedDoc: SharedDoc = 'exists';
let online = true;
let reads: string[] = [];
const fs = {
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  getDocFromServer: async (ref: { path: string }) => {
    reads.push(ref.path);
    if (sharedDoc === 'denied') throw Object.assign(new Error('denied'), { code: 'permission-denied' });
    return { exists: () => sharedDoc === 'exists' };
  },
};
vi.mock('@/lib/firebase-remote', () => ({
  getAccountRemote: () => (online ? Promise.resolve({ db: {}, fs, uid: 'uid-a' }) : Promise.reject(new Error('offline'))),
}));

import { syncDefaultShare } from '@/lib/account-share';
import {
  DEFAULT_TRIP_ID,
  STORAGE_KEYS,
  getDefaultTripAdopted,
  getDefaultTripShareId,
  getStoredDefaultTripShareId,
  keyForTrip,
  setDefaultTripShareId,
  wasTripCreatedHere,
} from '@/core/storage/gateway';
import { markOutboxDirty, outboxDirty } from '@/core/sync/outbox';

let reloads = 0;
const realLocation = window.location;
let confirmSpy: MockInstance<typeof window.confirm>;
const plans = [{ date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [] }];

function asDevice() {
  localStorage.clear();
  sessionStorage.clear();
}

beforeEach(() => {
  sharedDoc = 'exists';
  online = true;
  reads = [];
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
const planKept = () => localStorage.getItem(keyForTrip(DEFAULT_TRIP_ID, 'itinerary')) !== null;

// The navigator.locks path is untested: jsdom has no navigator.locks. The re-read before writing
// covers the same race.
describe('the default pack moves onto the one shared trip', () => {
  it('a device already on the shared trip is left completely alone', async () => {
    setDefaultTripShareId(SHARED_TRIP_ID);
    fillPack();
    await syncDefaultShare();
    expect(reads).toEqual([]);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(planKept()).toBe(true);
    expect(outboxDirty('itinerary')).toEqual(['2026-12-10']);
    expect(reloads).toBe(0);
  });

  it('a device with no id and nothing stored just records the shared trip, without a read or a reload', async () => {
    await syncDefaultShare();
    expect(getStoredDefaultTripShareId()).toBe(SHARED_TRIP_ID);
    expect(reads).toEqual([]);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(reloads).toBe(0);
  });

  it('the shared trip never gets an owner device', async () => {
    setDefaultTripShareId('device-x');
    await syncDefaultShare();
    expect(wasTripCreatedHere(SHARED_TRIP_ID)).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.tripsCreatedHere)).toBeNull();
  });

  it('a device on another id with no local plan moves without asking', async () => {
    setDefaultTripShareId('device-x');
    await syncDefaultShare();
    expect(reads).toEqual([`trips/${SHARED_TRIP_ID}`]);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(getStoredDefaultTripShareId()).toBe(SHARED_TRIP_ID);
    expect(reloads).toBe(1);
  });

  it('a device on another id with a plan asks first; yes replaces it and records the move (D-603, D-651)', async () => {
    setDefaultTripShareId('device-x');
    fillPack();
    confirmSpy.mockReturnValue(true);
    await syncDefaultShare();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(getDefaultTripShareId()).toBe(SHARED_TRIP_ID);
    expect(getDefaultTripAdopted()?.shareId).toBe(SHARED_TRIP_ID);
    for (const d of DOMAINS) expect(outboxDirty(d)).toEqual([]);
    for (const slot of SLOTS) expect(localStorage.getItem(keyForTrip(DEFAULT_TRIP_ID, slot))).toBeNull();
    expect(reloads).toBe(1);
  });

  it('a device with edits and no id drops them explicitly once it agrees, since setting the id alone would not', async () => {
    fillPack();
    expect(getDefaultTripShareId()).toBe(''); // held back until it is moved
    confirmSpy.mockReturnValue(true);
    await syncDefaultShare();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(getStoredDefaultTripShareId()).toBe(SHARED_TRIP_ID);
    for (const d of DOMAINS) expect(outboxDirty(d)).toEqual([]);
    for (const slot of SLOTS) expect(localStorage.getItem(keyForTrip(DEFAULT_TRIP_ID, slot))).toBeNull();
    expect(reloads).toBe(1);
  });

  it('keeps the local plan when the id write fails', async () => {
    setDefaultTripShareId('device-x');
    fillPack();
    confirmSpy.mockReturnValue(true);
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (v.includes(SHARED_TRIP_ID)) throw new DOMException('full', 'QuotaExceededError');
      real.call(this, k, v);
    });
    await syncDefaultShare();
    expect(getStoredDefaultTripShareId()).toBe('device-x');
    expect(outboxDirty('itinerary')).toEqual(['2026-12-10']);
    expect(planKept()).toBe(true);
    expect(reloads).toBe(0);
  });

  it('no keeps the plan and the old id, and does not ask again this session', async () => {
    setDefaultTripShareId('device-x');
    fillPack();
    confirmSpy.mockReturnValue(false);
    await syncDefaultShare();
    await syncDefaultShare();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(getStoredDefaultTripShareId()).toBe('device-x');
    expect(outboxDirty('itinerary')).toEqual(['2026-12-10']);
    expect(planKept()).toBe(true);
    expect(reloads).toBe(0);
  });

  it('a hidden tab does not prompt and leaves the question for the next load', async () => {
    setDefaultTripShareId('device-x');
    fillPack();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await syncDefaultShare();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(getStoredDefaultTripShareId()).toBe('device-x');
    expect(planKept()).toBe(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await syncDefaultShare();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['offline', () => { online = false; }],
    ['refused by the rules', () => { sharedDoc = 'denied'; }],
    ['not created yet', () => { sharedDoc = 'missing'; }],
  ])('%s: nothing is dropped, the old id stays and nothing is asked', async (_why, arrange) => {
    setDefaultTripShareId('device-x');
    fillPack();
    arrange();
    confirmSpy.mockReturnValue(true);
    await syncDefaultShare();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(getStoredDefaultTripShareId()).toBe('device-x');
    expect(planKept()).toBe(true);
    expect(outboxDirty('itinerary')).toEqual(['2026-12-10']);
    expect(reloads).toBe(0);
  });

  it('a device with edits and no id also waits when the shared trip cannot be read', async () => {
    fillPack();
    sharedDoc = 'denied';
    await syncDefaultShare();
    expect(getStoredDefaultTripShareId()).toBe('');
    expect(planKept()).toBe(true);
    expect(reloads).toBe(0);
  });

  it('moves at most once per session', async () => {
    setDefaultTripShareId('device-x');
    await syncDefaultShare();
    setDefaultTripShareId('device-x');
    await syncDefaultShare();
    expect(reloads).toBe(1);
  });
});
