// @vitest-environment jsdom
//
// S160 — BlobStorePort contract unit suite, exercised against the in-memory fake (the IDB stand-in;
// jsdom has no IndexedDB, and D-088 forbids a `fake-indexeddb` dep). The REAL native-IDB impl is
// proven in a real browser by the Playwright capture flow (photos.spec.ts). Here we prove the PORT
// CONTRACT: put/get/delete/list/usage round-trip, a simulated QuotaExceededError → {ok:false,quota},
// and an evicted get → null. D-159/D-160 cited.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { defaultBlobStore, makeInMemoryBlobStore, mintPhotoId } from '@/core/photos/blob-store';

function blobOf(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
}

describe('mintPhotoId', () => {
  it('is a unique ph- prefixed id', () => {
    const a = mintPhotoId();
    const b = mintPhotoId();
    expect(a.startsWith('ph-')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('BlobStorePort (in-memory fake) — the port contract', () => {
  it('put → get → delete round-trips, list + usage reflect the store', async () => {
    const store = makeInMemoryBlobStore();
    expect(await store.list()).toEqual([]);
    expect(await store.usage()).toEqual({ count: 0, bytes: 0 });

    const put1 = await store.put(blobOf(100));
    const put2 = await store.put(blobOf(50));
    expect(put1.ok && put2.ok).toBe(true);
    if (!put1.ok || !put2.ok) return;

    const got = await store.get(put1.id);
    expect(got).not.toBeNull();
    expect(got!.size).toBe(100);

    expect((await store.list()).sort()).toEqual([put1.id, put2.id].sort());
    expect(await store.usage()).toEqual({ count: 2, bytes: 150 });

    await store.delete(put1.id);
    expect(await store.get(put1.id)).toBeNull(); // evicted/deleted get → null
    expect(await store.list()).toEqual([put2.id]);
    expect(await store.usage()).toEqual({ count: 1, bytes: 50 });
  });

  it('put returns {ok:false, reason:"quota"} on a simulated QuotaExceededError (nothing stored)', async () => {
    const store = makeInMemoryBlobStore();
    store.__setMode('quota');
    const put = await store.put(blobOf(999));
    expect(put).toEqual({ ok: false, reason: 'quota' });
    expect(await store.list()).toEqual([]); // no half-write
    expect(await store.usage()).toEqual({ count: 0, bytes: 0 });
  });

  it('put returns {ok:false, reason:"unavailable"} when the store is unavailable', async () => {
    const store = makeInMemoryBlobStore();
    store.__setMode('unavailable');
    expect(await store.put(blobOf(1))).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('get of an absent id is null; delete of an absent id is a no-op (idempotent, never rejects)', async () => {
    const store = makeInMemoryBlobStore();
    expect(await store.get('ph-nope')).toBeNull();
    await expect(store.delete('ph-nope')).resolves.toBeUndefined();
  });

  it('clear() deletes every stored blob (S352 — "Forget this device"); idempotent on an empty store', async () => {
    const store = makeInMemoryBlobStore();
    await store.put(blobOf(100));
    await store.put(blobOf(50));
    expect(await store.list()).toHaveLength(2);

    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(await store.usage()).toEqual({ count: 0, bytes: 0 });

    await expect(store.clear()).resolves.toBeUndefined(); // idempotent, never rejects
  });
});

// ── The NATIVE impl's connection memo, against a hand-rolled `indexedDB` stub (still no dep) ──
//
// jsdom has no IndexedDB, so the stub below is the smallest thing `openDb`/`tx` will drive: an
// `open()` that can be told to block or succeed, and a db whose one transaction resolves with a
// fixed key list. It exists to pin WHEN the connection promise is cached, which is the whole
// defect: a blocked open (transient — another tab holds the old connection) was memoised, so
// photos stayed dead until the page reloaded and every call reported `unavailable`.

interface FakeTx {
  objectStore: () => { getAllKeys: () => { result: string[] } };
  oncomplete?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  error: null;
}
interface FakeDb {
  onclose: null | (() => void);
  transaction: () => FakeTx;
}
interface FakeOpenRequest {
  result?: FakeDb;
  onsuccess?: () => void;
  onerror?: () => void;
  onblocked?: () => void;
  onupgradeneeded?: () => void;
}

function makeFakeDb(keys: string[]): FakeDb {
  return {
    onclose: null,
    transaction() {
      const t: FakeTx = { objectStore: () => ({ getAllKeys: () => ({ result: keys }) }), error: null };
      queueMicrotask(() => t.oncomplete?.());
      return t;
    },
  };
}

describe('defaultBlobStore — only a LIVE connection is memoised', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-opens after a blocked open, caches a good one, and drops it on close', async () => {
    const db = makeFakeDb(['ph-1']);
    let blocked = true;
    let opens = 0;
    vi.stubGlobal('indexedDB', {
      open(): FakeOpenRequest {
        opens++;
        const req: FakeOpenRequest = {};
        queueMicrotask(() => {
          if (blocked) {
            req.onblocked?.();
          } else {
            req.result = db;
            req.onsuccess?.();
          }
        });
        return req;
      },
    });

    expect(await defaultBlobStore.list()).toEqual([]);
    expect(opens).toBe(1);

    // The blocking tab goes away. Without invalidation this second call never re-opens and
    // photos stay unavailable for the life of the page.
    blocked = false;
    expect(await defaultBlobStore.list()).toEqual(['ph-1']);
    expect(opens).toBe(2);

    // A live connection IS cached — no third open.
    expect(await defaultBlobStore.list()).toEqual(['ph-1']);
    expect(opens).toBe(2);

    // The browser closes the connection: every later `tx()` would throw InvalidStateError
    // against the dead handle, so the memo is dropped and the next call re-opens.
    expect(db.onclose).toBeTypeOf('function');
    db.onclose!();
    expect(await defaultBlobStore.list()).toEqual(['ph-1']);
    expect(opens).toBe(3);
  });
});
