// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/firebase-config', () => ({ isRemoteConfigured: () => true }));

type Data = Record<string, unknown>;
const docs = new Map<string, { data: Data; ver: number }>();
const device = { uid: 'uid-a', down: false };

// Optimistic transactions like Firestore's: a commit whose read doc changed underneath it retries.
const fs = {
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  getDocFromServer: async (ref: { path: string }) => {
    const d = docs.get(ref.path);
    return { exists: () => !!d, data: () => d?.data };
  },
  onSnapshot: () => () => {},
  runTransaction: async <T,>(_db: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => {
    for (;;) {
      const seen = new Map<string, number>();
      const writes: (() => void)[] = [];
      const tx = {
        get: async (ref: { path: string }) => {
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
  // The uid is captured when getRemote is called, so each simulated device stamps with its own.
  getRemote: () => {
    const uid = device.uid;
    if (device.down) return Promise.reject(new Error('sync paused on this device'));
    return Promise.resolve({ db: {}, fs, uid });
  },
}));

import { setPref, claimField, getPrefs, getCachedPrefs, subscribePrefs } from '@/lib/account-prefs-remote';
import { STORAGE_KEYS, identityStore, setSyncCode, wipeAllTripData } from '@/core/storage/gateway';
import { compareHlc, parse } from '@/core/sync/hlc';

const PATH = 'trips/tok-1/profile/prefs';
const field = (f: string) => docs.get(PATH)?.data[f] as { v: unknown; hlc: string } | undefined;

function asDevice(uid: string) {
  localStorage.clear();
  setSyncCode('tok-1');
  device.uid = uid;
  device.down = false;
}

beforeEach(() => {
  docs.clear();
  vi.useRealTimers();
  asDevice('uid-a');
});

describe('account prefs', () => {
  it('two devices editing different fields both survive', async () => {
    await Promise.all([setPref('homeCurrency', 'EUR'), (asDevice('uid-b'), setPref('defaultShare', 'trip-x'))]);
    expect(field('homeCurrency')?.v).toBe('EUR');
    expect(field('homeCurrency')?.hlc.endsWith(':uid-a')).toBe(true);
    expect(field('defaultShare')?.v).toBe('trip-x');
    expect(field('defaultShare')?.hlc.endsWith(':uid-b')).toBe(true);
    asDevice('uid-c');
    expect(await getPrefs()).toEqual({ homeCurrency: 'EUR', defaultShare: 'trip-x' });
  });

  it('an explicit edit wins even from a device with a slow clock that never read the account', async () => {
    vi.useFakeTimers({ now: 2_000_000 });
    await setPref('homeCurrency', 'EUR');
    const eurHlc = field('homeCurrency')!.hlc;
    asDevice('uid-b');
    vi.setSystemTime(1_000_000);
    await setPref('homeCurrency', 'JPY');
    expect(field('homeCurrency')?.v).toBe('JPY');
    expect(compareHlc(parse(field('homeCurrency')!.hlc), parse(eurHlc))).toBeGreaterThan(0);
    expect(getCachedPrefs().homeCurrency).toBe('JPY');
  });

  it('a replayed older value from the account does not overwrite a newer local one', async () => {
    vi.useFakeTimers({ now: 3_000_000 });
    await setPref('homeCurrency', 'EUR');
    docs.set(PATH, { data: { homeCurrency: { v: 'JPY', hlc: '000000001000000:000000:uid-old' } }, ver: 99 });
    expect((await getPrefs())?.homeCurrency).toBe('EUR');
  });

  it('a display name without a sync code writes nothing remote', async () => {
    localStorage.clear();
    identityStore.setToken('Alice');
    await setPref('homeCurrency', 'EUR');
    expect(docs.size).toBe(0);
    expect(getCachedPrefs()).toEqual({});
    expect(await claimField('defaultShare', 'X')).toBeNull();
  });

  it('a write still in flight at sign-out leaves the mirror empty', async () => {
    const pending = setPref('homeCurrency', 'EUR');
    wipeAllTripData();
    await pending;
    expect(getCachedPrefs()).toEqual({});
  });

  it('concurrent claims agree on one winner', async () => {
    const [a, b] = await Promise.all([claimField('defaultShare', 'X'), claimField('defaultShare', 'Y')]);
    expect(a).toBe(b);
    expect((docs.get(PATH)?.data.defaultShare as { v: unknown }).v).toBe(a);
    expect(await claimField('defaultShare', 'Z')).toBe(a);
  });

  it('a paused/offline edit stays on this device and is pushed, with its own stamp, on the next read', async () => {
    vi.useFakeTimers({ now: 5_000_000 });
    docs.set(PATH, { data: { homeCurrency: { v: 'USD', hlc: '000000001000000:000000:uid-old' } }, ver: 1 });
    device.down = true;
    await setPref('homeCurrency', 'JPY');
    expect(getCachedPrefs().homeCurrency).toBe('JPY');
    expect(field('homeCurrency')?.v).toBe('USD');
    const localHlc = (JSON.parse(localStorage.getItem(STORAGE_KEYS.personPrefs)!).homeCurrency as { hlc: string }).hlc;

    device.down = false;
    expect((await getPrefs())?.homeCurrency).toBe('JPY');
    expect(field('homeCurrency')).toEqual({ v: 'JPY', hlc: localHlc });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.personPrefs)!).homeCurrency.dirty).toBeUndefined();
  });

  it('a paused edit is pushed from the subscribe snapshot too', async () => {
    device.down = true;
    await setPref('homeCurrency', 'JPY');
    device.down = false;
    const orig = fs.onSnapshot;
    fs.onSnapshot = ((_ref: unknown, next: (s: unknown) => void) => {
      next({ metadata: { hasPendingWrites: false }, exists: () => false, data: () => undefined });
      return () => {};
    }) as typeof fs.onSnapshot;
    const seen: unknown[] = [];
    const stop = subscribePrefs((p) => seen.push(p.homeCurrency));
    await vi.waitFor(() => expect(field('homeCurrency')?.v).toBe('JPY'));
    expect(seen).toEqual(['JPY']);
    stop();
    fs.onSnapshot = orig;
  });

  it('a pending local edit loses to a newer edit made elsewhere, and is not re-pushed', async () => {
    vi.useFakeTimers({ now: 5_000_000 });
    device.down = true;
    await setPref('homeCurrency', 'JPY');
    docs.set(PATH, { data: { homeCurrency: { v: 'NPR', hlc: '000000009000000:000000:uid-b' } }, ver: 1 });
    device.down = false;
    expect((await getPrefs())?.homeCurrency).toBe('NPR');
    expect(field('homeCurrency')?.v).toBe('NPR');
    expect(docs.get(PATH)?.ver).toBe(1);
  });

  it('a claim never lands over a pending local edit', async () => {
    device.down = true;
    await setPref('homeCurrency', 'JPY');
    device.down = false;
    expect(await claimField('homeCurrency', 'USD')).toBe('JPY');
    expect(field('homeCurrency')).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.personPrefs)!).homeCurrency).toMatchObject({ v: 'JPY', dirty: true });
    await getPrefs();
    expect(field('homeCurrency')?.v).toBe('JPY');
  });

  it("switching account drops the last account's pending edits instead of pushing them", async () => {
    device.down = true;
    await setPref('homeCurrency', 'JPY');
    device.down = false;
    setSyncCode('tok-2');
    await getPrefs();
    expect(docs.get('trips/tok-2/profile/prefs')).toBeUndefined();
    expect(getCachedPrefs().homeCurrency).toBeUndefined();
  });

  it('claimField does not overwrite an existing personal value', async () => {
    await setPref('homeCurrency', 'JPY');
    asDevice('uid-b');
    expect(await claimField('homeCurrency', 'USD')).toBe('JPY');
    expect(getCachedPrefs().homeCurrency).toBe('JPY');
  });

  it('sign-out wipes the local mirror', async () => {
    await setPref('homeCurrency', 'EUR');
    wipeAllTripData();
    expect(getCachedPrefs()).toEqual({});
  });
});
