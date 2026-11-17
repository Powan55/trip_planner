// @vitest-environment jsdom
// #1183: an offline edit of an already-synced day must be stamped dirty even when the lazy
// journal-remote chunk never loads, or a later remote row from another device overwrites it.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const imports = vi.hoisted(() => ({ n: 0 }));

vi.mock('@/lib/firebase-config', async (orig) => ({
  ...(await orig<typeof import('@/lib/firebase-config')>()),
  isRemoteConfigured: () => true,
}));
// Always fails; the real module is loaded explicitly below once the device is back online.
vi.mock('@/lib/journal-remote', () => {
  imports.n += 1;
  throw Object.assign(new Error('Loading chunk 42 failed.'), { name: 'ChunkLoadError' });
});

type Data = Record<string, unknown>;
const docs = new Map<string, Data>();
let listener: ((snap: unknown) => void) | null = null;
const snapOf = (path: string) => {
  const d = docs.get(path);
  return { exists: () => !!d, data: () => d && structuredClone(d), metadata: { hasPendingWrites: false } };
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
    const writes: (() => void)[] = [];
    const tx = {
      get: async (ref: { path: string }) => snapOf(ref.path),
      set: (ref: { path: string }, data: Data) => writes.push(() => docs.set(ref.path, structuredClone(data))),
      update: (ref: { path: string }, data: Data) =>
        writes.push(() => {
          const entries = { ...((docs.get(ref.path)!.entries as Data) ?? {}) };
          for (const [k, v] of Object.entries(data)) entries[k.replace('entries.', '')] = structuredClone(v);
          docs.set(ref.path, { entries });
        }),
    };
    const out = await fn(tx);
    writes.forEach((w) => w());
    return out;
  },
};
vi.mock('@/lib/firebase-remote', () => ({ getRemote: () => Promise.resolve({ db: {}, fs, uid: 'uid' }) }));

import { useJournal } from '@/hooks/use-journal';
import { loadJournal, saveJournal } from '@/core/journal/storage';
import { getEntry, upsertEntry } from '@/core/journal/model';
import { compareHlc, parse, serialize } from '@/core/sync/hlc';
import { STORAGE_KEYS, keyFor, setSyncCode } from '@/core/storage/gateway';

const PATH = 'trips/tok-1/profile/journal_nepal-japan-2026';
const EDITED = '2026-12-11';
const DELETED = '2026-12-12';
const H0 = serialize({ pt: 1_000_000, ct: 0, actor: 'dev-A' });
// Another device's write: after the synced stamp, before the offline edit (the clock is at 3_000_000).
const REMOTE = serialize({ pt: 2_000_000, ct: 0, actor: 'dev-B' });
const theirs = { hlc: REMOTE, text: 'other device', createdAt: 'x', updatedAt: 'x' };
const settle = () => new Promise((r) => setTimeout(r, 0));
const meta = (date: string) => JSON.parse(localStorage.getItem(keyFor('journalSync'))!)[date];

type Journal = ReturnType<typeof useJournal>;
let store: Journal;
function Probe() {
  const s = useJournal();
  useEffect(() => {
    store = s;
  });
  return null;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'], now: 3_000_000 });
  setSyncCode('tok-1');
  localStorage.setItem(STORAGE_KEYS.deviceId, 'dev-A');
  const at = new Date(500_000).toISOString();
  saveJournal(upsertEntry(upsertEntry([], EDITED, { text: 'synced text' }, at), DELETED, { text: 'synced text' }, at));
  localStorage.setItem(keyFor('journalSync'), JSON.stringify({ [EDITED]: { hlc: H0 }, [DELETED]: { hlc: H0 } }));
});

describe('offline journal edits with the lazy chunk unavailable', () => {
  it('an edit and a delete are marked dirty and beat an older-than-the-edit remote row', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe)));
    await vi.waitFor(() => expect(store?.hydrated).toBe(true));
    // The mount and each save try the chunk; let every attempt fail before going back online.
    await vi.waitFor(() => expect(imports.n).toBe(1));
    act(() => {
      expect(store.saveEntry(EDITED, { text: 'typed offline' })).toBe(true);
    });
    await vi.waitFor(() => expect(imports.n).toBe(2));
    act(() => {
      expect(store.removeEntry(DELETED)).toBe(true);
    });
    await vi.waitFor(() => expect(imports.n).toBe(3));
    await settle();
    expect(meta(EDITED).dirty).toBe(true);
    expect(compareHlc(parse(meta(EDITED).hlc), parse(H0))).toBeGreaterThan(0);
    expect(meta(DELETED)).toMatchObject({ dirty: true, deletedAt: expect.any(String) });
    act(() => root.unmount());

    // Back online: the chunk loads and another device's row for each day arrives.
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    docs.set(PATH, { entries: { [EDITED]: theirs, [DELETED]: theirs } });
    const real = await vi.importActual<typeof import('@/lib/journal-remote')>('@/lib/journal-remote');
    const release = real.retainJournalSync();
    await settle();
    listener?.(snapOf(PATH));
    await settle();
    await settle();
    release();

    expect(getEntry(loadJournal(), EDITED)?.text).toBe('typed offline');
    expect(getEntry(loadJournal(), DELETED)).toBeNull();
    const pushed = docs.get(PATH)!.entries as Record<string, Data>;
    expect(pushed[EDITED].text).toBe('typed offline');
    expect(pushed[DELETED].deletedAt).toEqual(expect.any(String));
    expect(meta(EDITED).dirty).toBeUndefined();
  });
});
