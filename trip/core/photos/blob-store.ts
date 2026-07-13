/**
 * `BlobStorePort` — the blob-bytes boundary. The ONE seam photo blobs pass
 * through. Two implementations live here: the native-IndexedDB default (`defaultBlobStore`) and a
 * ~15-line in-memory `Map` fake (`makeInMemoryBlobStore`) that unit tests use instead of adding a
 * `fake-indexeddb`/`idb` dependency (free-by-construction — native `indexedDB` only, no dep).
 *
 * ZERO EGRESS: NEITHER implementation contains a line of network code. Blobs exist only in
 * this device's IndexedDB; there is no code path from a blob to a socket. This is the structural half
 * of the zero-egress guarantee (the metadata half is the key-16 index carrying no bytes).
 *
 * Every method is TOTAL / never-rejects (mirrors the gateway's never-throw discipline): SSR,
 * `indexedDB === undefined`, privacy mode, or a rejected open all degrade to `unavailable`/`null`/
 * no-op. `put` is the ONE operation whose failure the user must see, hence the result type rather than
 * a silent no-op — a `QuotaExceededError` surfaces as `{ ok:false, reason:'quota' }`.
 */

/** Result of storing a blob — total, never throws. */
export type PutResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'quota' | 'unavailable' };

export interface BlobStorePort {
  /** Store an (already-downscaled) blob; mints and returns the photo id. Never rejects. */
  put(blob: Blob): Promise<PutResult>;
  /** The blob, or null: absent, EVICTED, SSR, or IndexedDB unavailable. Never rejects. */
  get(id: string): Promise<Blob | null>;
  /** Idempotent; resolves even if absent/unavailable. Never rejects. */
  delete(id: string): Promise<void>;
  /** Stored ids (source of truth for what survived eviction). [] on unavailable. */
  list(): Promise<string[]>;
  /** Rough footprint for the storage UI. Zeros on unavailable. */
  usage(): Promise<{ count: number; bytes: number }>;
}

/**
 * Mint a photo id — same time-prefixed + random-suffix pattern as `generateExpenseId` (`exp-…`).
 * Minted inside the store so the store is the single id authority. Browser-only in practice, but pure.
 */
export function mintPhotoId(): string {
  return `ph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── In-memory fake (unit tests; no `fake-indexeddb`/`idb` dep) ───────────────────────────
/** Extra test affordance on the fake: force the next writes to fail with a given reason. */
export interface InMemoryBlobStore extends BlobStorePort {
  /** Test-only: make `put` return `{ ok:false, reason }` ('ok' restores normal behavior). */
  __setMode(mode: 'ok' | 'quota' | 'unavailable'): void;
}

/** A trivial `Map<string,Blob>` `BlobStorePort` for tests (the IDB stand-in). */
export function makeInMemoryBlobStore(): InMemoryBlobStore {
  const map = new Map<string, Blob>();
  let mode: 'ok' | 'quota' | 'unavailable' = 'ok';
  return {
    async put(blob) {
      if (mode !== 'ok') return { ok: false, reason: mode };
      const id = mintPhotoId();
      map.set(id, blob);
      return { ok: true, id };
    },
    async get(id) {
      return map.get(id) ?? null;
    },
    async delete(id) {
      map.delete(id);
    },
    async list() {
      return [...map.keys()];
    },
    async usage() {
      let bytes = 0;
      for (const b of map.values()) bytes += b.size;
      return { count: map.size, bytes };
    },
    __setMode(m) {
      mode = m;
    },
  };
}

// ── Native IndexedDB default impl (db `nepal_japan_photos` v1, single `blobs` store) ─────────────
const DB_NAME = 'nepal_japan_photos';
const STORE = 'blobs';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** Lazily open + cache the DB connection. Resolves `null` on SSR / unavailable / blocked / rejected. */
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      // Single object store, out-of-line string keys (the photo id); values are raw Blobs
      // (structured-clone stores Blobs natively — no base64, no ArrayBuffer copies).
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

/** Best-effort, once: ask the browser to persist the origin so a blob is less likely evicted. */
let persistRequested = false;
function requestPersistOnce(): void {
  if (persistRequested) return;
  persistRequested = true;
  try {
    void navigator?.storage?.persist?.();
  } catch {
    /* ignore — best-effort, denial only changes eviction odds */
  }
}

/** Run one transaction, resolving on complete and rejecting with the tx error on abort/error. */
function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    let req: IDBRequest<T> | null;
    try {
      const t = db.transaction(STORE, mode);
      req = body(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    } catch (err) {
      reject(err);
    }
  });
}

export const defaultBlobStore: BlobStorePort = {
  async put(blob) {
    const db = await openDb();
    if (!db) return { ok: false, reason: 'unavailable' };
    const id = mintPhotoId();
    try {
      await tx(db, 'readwrite', (store) => store.put(blob, id));
    } catch (err) {
      const name = (err as DOMException | null)?.name;
      return { ok: false, reason: name === 'QuotaExceededError' ? 'quota' : 'unavailable' };
    }
    requestPersistOnce();
    return { ok: true, id };
  },

  async get(id) {
    const db = await openDb();
    if (!db) return null;
    try {
      const blob = await tx<Blob>(db, 'readonly', (store) => store.get(id));
      return blob instanceof Blob ? blob : null;
    } catch {
      return null;
    }
  },

  async delete(id) {
    const db = await openDb();
    if (!db) return;
    try {
      await tx(db, 'readwrite', (store) => store.delete(id));
    } catch {
      /* idempotent — absent/unavailable is a no-op */
    }
  },

  async list() {
    const db = await openDb();
    if (!db) return [];
    try {
      const keys = await tx<IDBValidKey[]>(db, 'readonly', (store) => store.getAllKeys());
      return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      return [];
    }
  },

  async usage() {
    const db = await openDb();
    if (!db) return { count: 0, bytes: 0 };
    try {
      const blobs = await tx<Blob[]>(db, 'readonly', (store) => store.getAll());
      const list = Array.isArray(blobs) ? blobs : [];
      let bytes = 0;
      for (const b of list) if (b instanceof Blob) bytes += b.size;
      return { count: list.length, bytes };
    } catch {
      return { count: 0, bytes: 0 };
    }
  },
};
