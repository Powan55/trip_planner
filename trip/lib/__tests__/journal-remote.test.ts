// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/firebase-config', async (orig) => ({
  ...(await orig<typeof import('@/lib/firebase-config')>()),
  isRemoteConfigured: () => true,
}));

type Data = Record<string, unknown>;
const docs = new Map<string, { data: Data; ver: number }>();
const net = { online: true };
let listener: ((snap: unknown) => void) | null = null;
// onGet: runs mid-transaction. interleave: another commit lands, then the body re-runs (a Firestore
// retry). afterCommit: runs after the write, before push() returns.
const hooks: { onGet?: () => void; interleave?: () => Promise<void>; afterCommit?: () => void } = {};

function setPath(data: Data, path: string, value: unknown): Data {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) return { ...data, [head]: value };
  return { ...data, [head]: setPath((data[head] as Data) ?? {}, rest.join('.'), value) };
}

const snapOf = (path: string) => {
  const d = docs.get(path);
  return { exists: () => !!d, data: () => d && structuredClone(d.data), metadata: { hasPendingWrites: false } };
};

const fs = {
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  onSnapshot: (_ref: unknown, next: (snap: unknown) => void) => {
    listener = next;
    return () => {
      listener = null;
    };
  },
  runTransaction: async <T,>(_db: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => {
    if (!net.online) throw new Error('unavailable');
    const writes: (() => void)[] = [];
    const tx = {
      get: async (ref: { path: string }) => {
        const snap = snapOf(ref.path);
        hooks.onGet?.();
        hooks.onGet = undefined;
        return snap;
      },
      set: (ref: { path: string }, data: Data) =>
        writes.push(() => docs.set(ref.path, { data: structuredClone(data), ver: 1 })),
      update: (ref: { path: string }, data: Data) =>
        writes.push(() => {
          const d = docs.get(ref.path)!;
          let next = d.data;
          for (const [k, v] of Object.entries(data)) next = setPath(next, k, structuredClone(v));
          docs.set(ref.path, { data: next, ver: d.ver + 1 });
        }),
    };
    let out = await fn(tx);
    const race = hooks.interleave;
    hooks.interleave = undefined;
    if (race) {
      writes.length = 0;
      await race();
      out = await fn(tx);
    }
    writes.forEach((w) => w());
    const after = hooks.afterCommit;
    hooks.afterCommit = undefined;
    after?.();
    return out;
  },
};
const getRemote = vi.fn(() => Promise.resolve({ db: {}, fs, uid: 'uid' }));
vi.mock('@/lib/firebase-remote', () => ({ getRemote: () => getRemote() }));

import { pushJournalEntry, retainJournalSync } from '@/lib/journal-remote';
import { loadJournal, saveJournal } from '@/core/journal/storage';
import { JOURNAL_TEXT_MAX, getEntry, upsertEntry, removeEntry } from '@/core/journal/model';
import { STORAGE_KEYS, identityStore, setActiveTripId, setSyncCode } from '@/core/storage/gateway';
import { signOut } from '@/lib/token-auth';
import { exportTripBackup, importTripBackup } from '@/lib/trip-backup';
import { makeInMemoryBlobStore } from '@/core/photos/blob-store';

const PATH = 'trips/tok-1/profile/journal_nepal-japan-2026';
const DAY = '2026-12-11';
const devices = new Map<string, Record<string, string>>();
let current = '';

function asDevice(name: string) {
  if (current) {
    const saved: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)!;
      saved[k] = localStorage.getItem(k)!;
    }
    devices.set(current, saved);
  }
  localStorage.clear();
  for (const [k, v] of Object.entries(devices.get(name) ?? {})) localStorage.setItem(k, v);
  if (!devices.has(name)) {
    setSyncCode('tok-1');
    localStorage.setItem(STORAGE_KEYS.deviceId, `dev-${name}`);
  }
  current = name;
}

const at = (ms: number) => vi.setSystemTime(ms);
const settle = () => new Promise((r) => setTimeout(r, 0));

async function edit(text: string) {
  saveJournal(upsertEntry(loadJournal(), DAY, { text, mood: 'great', highlight: 'Pashupati' }, new Date().toISOString()));
  await pushJournalEntry(DAY);
}
async function del() {
  saveJournal(removeEntry(loadJournal(), DAY));
  await pushJournalEntry(DAY);
}
/** Mount, take one server snapshot, let the retry flush finish, unmount. */
async function sync() {
  const release = retainJournalSync();
  await settle();
  listener?.(snapOf(PATH));
  await settle();
  await settle();
  release();
}

beforeEach(() => {
  docs.clear();
  devices.clear();
  current = '';
  net.online = true;
  hooks.onGet = hooks.interleave = hooks.afterCommit = undefined;
  getRemote.mockClear();
  vi.useFakeTimers({ toFake: ['Date'], now: 1_000_000 });
});

describe('journal account sync', () => {
  it('round trip keeps text, mood and highlight', async () => {
    asDevice('A');
    await edit('Temple at dawn');
    asDevice('B');
    await sync();
    expect(getEntry(loadJournal(), DAY)).toMatchObject({ text: 'Temple at dawn', mood: 'great', highlight: 'Pashupati' });
  });

  it('a delete on A beats an older offline edit on B', async () => {
    asDevice('A');
    await edit('first');
    asDevice('B');
    await sync();
    net.online = false;
    at(2_000_000);
    await edit('B offline');
    net.online = true;
    asDevice('A');
    at(3_000_000);
    await del();
    asDevice('B');
    await sync();
    expect(getEntry(loadJournal(), DAY)).toBeNull();
    expect((docs.get(PATH)!.data.entries as Data)[DAY]).toHaveProperty('deletedAt');
  });

  it('a newer edit beats an older tombstone', async () => {
    asDevice('A');
    await edit('first');
    asDevice('B');
    await sync();
    asDevice('A');
    at(2_000_000);
    await del();
    asDevice('B');
    net.online = false;
    at(3_000_000);
    await edit('B wrote later');
    net.online = true;
    await sync();
    asDevice('A');
    await sync();
    expect(getEntry(loadJournal(), DAY)?.text).toBe('B wrote later');
  });

  it('an offline edit re-pushes when the device comes back online', async () => {
    asDevice('A');
    const release = retainJournalSync();
    await settle();
    net.online = false;
    await edit('written on the plane');
    expect(docs.has(PATH)).toBe(false);
    net.online = true;
    window.dispatchEvent(new Event('online'));
    await settle();
    release();
    expect((docs.get(PATH)!.data.entries as Data)[DAY]).toMatchObject({ text: 'written on the plane' });
  });

  it('a local clear after an offline edit never tombstones the day on other devices', async () => {
    asDevice('A');
    await edit('first');
    const release = retainJournalSync();
    await settle();
    net.online = false;
    at(2_000_000);
    await edit('offline');
    saveJournal([]);
    net.online = true;
    window.dispatchEvent(new Event('online'));
    await settle();
    release();
    expect((docs.get(PATH)!.data.entries as Data)[DAY]).not.toHaveProperty('deletedAt');
    expect((docs.get(PATH)!.data.entries as Data)[DAY]).toMatchObject({ text: 'first' });
  });

  it('a backup restore wins over a newer edit from another device', async () => {
    asDevice('A');
    await edit('before the backup');
    const file = await exportTripBackup(makeInMemoryBlobStore());
    asDevice('B');
    await sync();
    at(2_000_000);
    await edit('B later');
    asDevice('A');
    at(3_000_000);
    expect((await importTripBackup(file, makeInMemoryBlobStore())).ok).toBe(true);
    await settle();
    expect((docs.get(PATH)!.data.entries as Data)[DAY]).toMatchObject({ text: 'before the backup' });
  });

  // #630
  it('a push never shortens a long local entry', async () => {
    asDevice('A');
    await edit('x'.repeat(5000));
    expect(getEntry(loadJournal(), DAY)?.text).toHaveLength(5000);
    expect(((docs.get(PATH)!.data.entries as Data)[DAY] as { text: string }).text).toHaveLength(JOURNAL_TEXT_MAX);
    await sync();
    expect(getEntry(loadJournal(), DAY)?.text).toHaveLength(5000);
  });

  it('an echo of our own capped row keeps the full local text', async () => {
    asDevice('A');
    const release = retainJournalSync();
    await settle();
    hooks.afterCommit = () => listener?.(snapOf(PATH));
    await edit('y'.repeat(5000));
    release();
    expect(getEntry(loadJournal(), DAY)?.text).toHaveLength(5000);
  });

  it('a retried transaction never overwrites a newer edit', async () => {
    asDevice('A');
    hooks.interleave = () => edit('second');
    await edit('first');
    expect((docs.get(PATH)!.data.entries as Data)[DAY]).toMatchObject({ text: 'second' });
    await sync();
    expect(getEntry(loadJournal(), DAY)?.text).toBe('second');
  });

  it('a trip switch during the transaction writes nothing', async () => {
    asDevice('A');
    await edit('first');
    hooks.onGet = () => setActiveTripId('trip-x');
    await edit('second');
    expect((docs.get(PATH)!.data.entries as Data)[DAY]).toMatchObject({ text: 'first' });
    expect([...docs.keys()]).toEqual([PATH]);
  });

  it('a sign-out mid-push writes no tombstone', async () => {
    asDevice('A');
    await edit('first');
    hooks.onGet = () => signOut();
    await edit('second');
    expect((docs.get(PATH)!.data.entries as Data)[DAY]).not.toHaveProperty('deletedAt');
    expect((docs.get(PATH)!.data.entries as Data)[DAY]).toMatchObject({ text: 'first' });
  });

  it('no sync code makes zero remote calls', async () => {
    localStorage.clear();
    identityStore.setToken('Alice');
    await edit('private');
    await sync();
    expect(getRemote).not.toHaveBeenCalled();
    expect(docs.size).toBe(0);
  });
});
