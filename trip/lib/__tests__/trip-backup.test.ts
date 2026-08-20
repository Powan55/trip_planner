// @vitest-environment jsdom
//
// Full-trip backup/restore unit suite (slice S273, D-227). Exercises `core/vault/backup.ts` against
// the REAL Vault-backed localStorage (`loadPlans`/`savePlans` + the real gateway domain keys) and an
// in-memory `BlobStorePort` fake for photo bytes (jsdom has no IndexedDB; D-088 forbids a fake-idb dep).
//
// The 7 required cases:
//   1. Round-trip / P2 — seed every in-scope domain + photos → export → WIPE localStorage + use a fresh
//      empty blob store → import → every domain byte-equal, itinerary restored, every photo's BYTES back.
//   2. Custom-trip round-trip — data lands under `trip:custom-x:*` keys.
//   3. Never-destroy, total garbage — a non-JSON file rejects and destroys nothing.
//   4. Never-destroy, partial — one malformed domain (`journal:42`) is dropped, the rest restore.
//   5. Back-compat — a pre-S273 itinerary-only Vault export imports the itinerary, others untouched.
//   6. Photo quota on import — a blob that fails to store becomes a placeholder; ok:true, photosSkipped>0.
//   7. Compression self-check — a 20-photo round-trip through the REAL compress/decompress pipeline.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exportTripBackup, importTripBackup } from '@/core/vault/backup';
import { supportsCompression } from '@/core/vault/compression';
import { makeInMemoryBlobStore, type BlobStorePort } from '@/core/photos/blob-store';
import {
  journalStore,
  expensesStore,
  budgetStore,
  docsStore,
  packingStore,
  favoritesStore,
  dayAnchorStore,
  shareInboxStore,
  setActiveTripId,
  wipeAllTripData,
  STORAGE_KEYS,
} from '@/core/storage/gateway';
import { myPlacesStore } from '@/core/storage/my-places-store';
import { loadMyPlaces, saveMyPlaces } from '@/core/places/storage';
import { savePlans, loadPlans } from '@/lib/itinerary-storage';
import { exportItinerary } from '@/core/vault/export-import';
import { savePhotos } from '@/core/photos/storage';
import { sanitizeEntries } from '@/core/journal/model';
import { sanitizeExpenses } from '@/core/budget/expenses';
import { normalizeModel } from '@/core/budget/model';
import { sanitizeItems as sanitizeDocs } from '@/core/docs/model';
import { sanitizeItems as sanitizePacking } from '@/core/packing/model';
import { sanitizeItems as sanitizeShare } from '@/core/share/model';
import { sanitizePlaces, type MyPlace } from '@/core/places/model';
import type { PhotoMeta } from '@/core/photos/model';
import type { DayPlan } from '@/lib/trip-data';

// ── Seed fixtures (each pre-run through its domain sanitizer, so a round-trip is byte-idempotent) ──
const SEED_PLANS: DayPlan[] = [
  {
    date: '2026-12-10',
    city: 'Kathmandu',
    country: 'nepal',
    items: [{ id: 'it1', title: 'Boudhanath at dusk', category: 'photography' }],
  },
];
const SEED_JOURNAL = sanitizeEntries([
  { date: '2026-12-10', text: 'Momo feast in Thamel', createdAt: '', updatedAt: '' },
]);
const SEED_EXPENSES = sanitizeExpenses([
  { id: 'e1', leg: 'nepal', category: 'food', amount: 1200, createdAt: '' },
]);
const SEED_BUDGET = normalizeModel({ homeCurrency: 'USD', legBudgets: { nepal: 1000 } });
const SEED_DOCS = sanitizeDocs([{ id: 'passport', section: 'critical', label: 'Passport', checked: true }], []);
const SEED_PACKING = sanitizePacking([{ id: 'p1', label: 'Down jacket', category: 'japan', checked: false }], []);
const SEED_FAVORITES = ['naBoudha', 'jaFushimi'];
const SEED_ANCHORS = { '2026-12-10': 'marker-boudha' };
const SEED_SHARE = sanitizeShare([
  { id: 's1', receivedAt: '2026-07-01T00:00:00.000Z', title: 'A ryokan to book', url: 'https://example.com' },
]);
const SEED_PLACES: MyPlace[] = sanitizePlaces([
  { id: 'pl1', name: 'Pokhara Lakeside cafe', legId: 'nepal', addedAt: '2026-07-01T00:00:00.000Z' },
]);

function photoMeta(id: string, date = '2026-12-10'): PhotoMeta {
  return {
    id,
    owner: { kind: 'journal', date },
    altText: `Photo ${id}`,
    w: 120,
    h: 90,
    bytes: 16,
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

/** A deterministic JPEG-typed blob whose bytes are all `fill` — distinct fills prove per-photo fidelity. */
function blobOf(fill: number, len = 16): Blob {
  return new Blob([new Uint8Array(len).fill(fill)], { type: 'image/jpeg' });
}

async function bytesOf(blob: Blob | null): Promise<number[]> {
  if (!blob) return [];
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

/** Seed every in-scope domain (default trip) + N photos into the given blob store. */
async function seedAll(store: BlobStorePort, photoCount = 2): Promise<Map<string, number[]>> {
  savePlans(SEED_PLANS);
  journalStore.set(SEED_JOURNAL);
  expensesStore.set(SEED_EXPENSES);
  budgetStore.set(SEED_BUDGET);
  docsStore.set(SEED_DOCS);
  packingStore.set(SEED_PACKING);
  favoritesStore.set(SEED_FAVORITES);
  dayAnchorStore.set(SEED_ANCHORS);
  shareInboxStore.set(SEED_SHARE);
  myPlacesStore.set(SEED_PLACES);

  const metas: PhotoMeta[] = [];
  const blobBytes = new Map<string, number[]>();
  for (let i = 0; i < photoCount; i++) {
    const id = `ph-seed-${i}`;
    const fill = (i * 7 + 1) & 0xff;
    await store.putWithId(id, blobOf(fill));
    metas.push(photoMeta(id));
    blobBytes.set(id, Array.from(new Uint8Array(16).fill(fill)));
  }
  savePhotos(metas);
  return blobBytes;
}

/** The raw on-disk strings for every generic domain + photos (default-trip literal keys). */
function domainSnapshot(): Record<string, string | null> {
  const keys = [
    'journal', 'expenses', 'budget', 'docsChecklist', 'packing',
    'favorites', 'dayAnchors', 'shareInbox', 'photos', 'myPlaces',
  ] as const;
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = localStorage.getItem(STORAGE_KEYS[k]);
  return out;
}

beforeEach(() => {
  localStorage.clear();
  setActiveTripId(''); // clear the active-trip pointer → default pack
  localStorage.clear();
});

describe('S273 — case 1: whole-trip round-trip survives a device wipe (the P2 guarantee)', () => {
  it('export → clear localStorage + fresh blob store → import → every domain, itinerary AND photo bytes are back', async () => {
    const seedStore = makeInMemoryBlobStore();
    const blobBytes = await seedAll(seedStore);

    const before = domainSnapshot();
    const beforePlans = loadPlans();
    expect(beforePlans).toEqual(SEED_PLANS);

    const file = await exportTripBackup(seedStore);

    // ── DEVICE WIPE ── everything gone: localStorage cleared, a brand-new empty blob store.
    localStorage.clear();
    const importStore = makeInMemoryBlobStore();
    expect(domainSnapshot().journal).toBeNull();
    expect(await importStore.get('ph-seed-0')).toBeNull();

    const res = await importTripBackup(file, importStore);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Every generic domain came back byte-for-byte.
    expect(domainSnapshot()).toEqual(before);
    // Itinerary restored (payload identity; the envelope's updatedAt is re-stamped and not compared).
    expect(loadPlans()).toEqual(SEED_PLANS);
    // Each photo's BYTES survived the wipe.
    for (const [id, bytes] of blobBytes) {
      expect(await bytesOf(await importStore.get(id))).toEqual(bytes);
    }
    expect(res.restored).toEqual(expect.arrayContaining(['journal', 'photos', 'itinerary']));
    expect(res.photosSkipped).toBe(0);
  });
});

describe('S273 — case 2: custom-trip round-trip lands under trip:{id}:* keys', () => {
  it('restores into whichever trip is active at import time', async () => {
    setActiveTripId('custom-x');
    const seedStore = makeInMemoryBlobStore();
    await seedAll(seedStore);
    const before = localStorage.getItem('trip:custom-x:journal');
    expect(before).not.toBeNull();

    const file = await exportTripBackup(seedStore);

    localStorage.clear();
    setActiveTripId('custom-x'); // the device is still on custom-x after the wipe
    const importStore = makeInMemoryBlobStore();
    const res = await importTripBackup(file, importStore);

    expect(res.ok).toBe(true);
    expect(localStorage.getItem('trip:custom-x:journal')).toBe(before);
    expect(localStorage.getItem(STORAGE_KEYS.journal)).toBeNull(); // NOT the default-pack key
  });
});

describe('S273 — case 3: never-destroy, total garbage', () => {
  it('a non-JSON file rejects and destroys nothing', async () => {
    const store = makeInMemoryBlobStore();
    await seedAll(store);
    const before = domainSnapshot();

    const garbage = new Blob(['{ this is not valid json at all'], { type: 'application/json' });
    const res = await importTripBackup(garbage, store);

    expect(res.ok).toBe(false);
    expect(domainSnapshot()).toEqual(before); // every seeded domain intact
    expect(loadPlans()).toEqual(SEED_PLANS);
  });
});

describe('S273 — case 4: never-destroy, one malformed domain', () => {
  it('drops the malformed domain (journal:42) and restores the rest', async () => {
    const store = makeInMemoryBlobStore();
    await seedAll(store);
    const beforeJournal = localStorage.getItem(STORAGE_KEYS.journal);

    // A well-formed backup envelope whose `journal` is garbage but whose `expenses` is a NEW valid list.
    const newExpenses = sanitizeExpenses([{ id: 'e2', leg: 'japan', category: 'transport', amount: 500, createdAt: '' }]);
    const env = {
      format: 'nepal-japan-trip-backup',
      version: 1,
      exportedAt: '2026-07-10T00:00:00.000Z',
      tripId: 'nepal-japan-2026',
      domains: { journal: 42, expenses: newExpenses },
      photos: { meta: [], blobs: {} },
    };
    const file = new Blob([JSON.stringify(env)], { type: 'application/json' });
    const res = await importTripBackup(file, store);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.restored).toContain('expenses');
    expect(res.restored).not.toContain('journal');
    // Journal was left byte-untouched (dropped, not wiped to []).
    expect(localStorage.getItem(STORAGE_KEYS.journal)).toBe(beforeJournal);
    // Expenses replaced with the imported list.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.expenses)!)).toEqual(newExpenses);
  });
});

describe('S273 — itinerary commit uses the injected dual path (restorePlans under sync)', () => {
  it('routes the itinerary commit through the supplied function (not savePlans) for a full backup', async () => {
    const store = makeInMemoryBlobStore();
    await seedAll(store);
    const file = await exportTripBackup(store);

    localStorage.clear();
    const restoreSpy = vi.fn(); // stands in for the store's restorePlans (the sync path)
    const res = await importTripBackup(file, makeInMemoryBlobStore(), restoreSpy);

    expect(res.ok).toBe(true);
    expect(restoreSpy).toHaveBeenCalledTimes(1);
    expect(restoreSpy).toHaveBeenCalledWith(SEED_PLANS);
    // The commit was delegated — savePlans was NOT called, so the Vault key stays empty.
    expect(localStorage.getItem(STORAGE_KEYS.itinerary)).toBeNull();
  });

  it('also routes a legacy itinerary-only import through the injected commit (sync-safe back-compat)', async () => {
    savePlans(SEED_PLANS);
    const legacyText = exportItinerary();
    localStorage.clear();
    const restoreSpy = vi.fn();
    const file = new Blob([legacyText], { type: 'application/json' });

    const res = await importTripBackup(file, makeInMemoryBlobStore(), restoreSpy);
    expect(res.ok).toBe(true);
    expect(restoreSpy).toHaveBeenCalledWith(SEED_PLANS);
  });
});

describe('S273 — case 5: back-compat with a pre-S273 itinerary-only export', () => {
  it('imports the itinerary via the legacy path and leaves other domains untouched', async () => {
    const store = makeInMemoryBlobStore();
    await seedAll(store);
    const beforeJournal = localStorage.getItem(STORAGE_KEYS.journal);

    // Build a genuine legacy itinerary-only Vault envelope (NOT a full-trip backup).
    const legacyPlans: DayPlan[] = [
      { date: '2026-12-19', city: 'Tokyo', country: 'japan', items: [{ id: 'jp1', title: 'Ramen crawl', category: 'food' }] },
    ];
    savePlans(legacyPlans);
    const legacyText = exportItinerary();
    savePlans(SEED_PLANS); // change the live itinerary so a no-op could not masquerade as success

    const file = new Blob([legacyText], { type: 'application/json' });
    const res = await importTripBackup(file, store);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.restored).toEqual(['itinerary']);
    expect(loadPlans()).toEqual(legacyPlans);
    expect(localStorage.getItem(STORAGE_KEYS.journal)).toBe(beforeJournal); // untouched
  });
});

describe('S273 — case 6: photo quota on import → placeholders, ok:true', () => {
  it('a blob that fails to store leaves its meta as a placeholder and increments photosSkipped', async () => {
    const seedStore = makeInMemoryBlobStore();
    await seedAll(seedStore, 2); // ph-seed-0, ph-seed-1
    const file = await exportTripBackup(seedStore);

    localStorage.clear();
    // An import store whose putWithId fails for exactly one id.
    const importStore = makeInMemoryBlobStore();
    const realPut = importStore.putWithId.bind(importStore);
    importStore.putWithId = async (id, blob) =>
      id === 'ph-seed-1' ? { ok: false, reason: 'quota' } : realPut(id, blob);

    const res = await importTripBackup(file, importStore);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.photosSkipped).toBe(1);
    // Both metas persisted (ph-seed-1 is a placeholder — meta kept, blob absent).
    const metas = JSON.parse(localStorage.getItem(STORAGE_KEYS.photos)!) as PhotoMeta[];
    expect(metas.map((m) => m.id).sort()).toEqual(['ph-seed-0', 'ph-seed-1']);
    expect(await importStore.get('ph-seed-0')).not.toBeNull();
    expect(await importStore.get('ph-seed-1')).toBeNull(); // never stored → placeholder
  });
});

describe('S273 — case 7: compression self-check (20-photo round-trip through the real pipeline)', () => {
  it('every photo byte survives export→import through the real compress/decompress path', async () => {
    const seedStore = makeInMemoryBlobStore();
    const metas: PhotoMeta[] = [];
    const expected = new Map<string, number[]>();
    for (let i = 0; i < 20; i++) {
      const id = `ph-c-${i}`;
      const fill = (i * 11 + 3) & 0xff;
      await seedStore.putWithId(id, blobOf(fill, 64));
      metas.push(photoMeta(id));
      expected.set(id, Array.from(new Uint8Array(64).fill(fill)));
    }
    savePlans(SEED_PLANS);
    savePhotos(metas);

    const file = await exportTripBackup(seedStore); // REAL compressToBlob

    // Confirm which transport actually ran, so this proof is honest about the env.
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (supportsCompression()) {
      expect([head[0], head[1]]).toEqual([0x1f, 0x8b]); // gzip magic — the compressed path
    }

    localStorage.clear();
    const importStore = makeInMemoryBlobStore();
    const res = await importTripBackup(file, importStore); // REAL decompressBlobOrText
    expect(res.ok).toBe(true);

    for (const [id, bytes] of expected) {
      expect(await bytesOf(await importStore.get(id))).toEqual(bytes);
    }
  });

  it('the plain-JSON fallback path also round-trips (uncompressed Blob → import)', async () => {
    // Prove the no-CompressionStream branch independently of the env: an uncompressed JSON backup
    // (exactly what compressToBlob emits when CompressionStream is absent) must import identically.
    const store = makeInMemoryBlobStore();
    await seedAll(store);
    const before = domainSnapshot();

    const env = {
      format: 'nepal-japan-trip-backup',
      version: 1,
      exportedAt: '2026-07-10T00:00:00.000Z',
      tripId: 'nepal-japan-2026',
      domains: {
        itinerary: JSON.parse(exportItinerary()),
        journal: SEED_JOURNAL,
      },
      photos: { meta: [], blobs: {} },
    };
    const plainFile = new Blob([JSON.stringify(env)], { type: 'application/json' }); // NO gzip magic
    localStorage.clear();
    const res = await importTripBackup(plainFile, makeInMemoryBlobStore());

    expect(res.ok).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.journal)).toBe(before.journal);
    expect(loadPlans()).toEqual(SEED_PLANS);
  });
});

describe('A-5 — cross-trip restore is refused, not silently applied', () => {
  it('refuses a backup whose tripId differs from the active trip, and leaves the active trip untouched', async () => {
    // Export trip A ("nepal-japan-2026", the default pack).
    const storeA = makeInMemoryBlobStore();
    await seedAll(storeA);
    const fileFromTripA = await exportTripBackup(storeA);

    // Switch to trip B and seed it with DIFFERENT data. `journalStore`/`myPlacesStore` resolve their
    // key through `keyFor(activeTripId)`, so — unlike `domainSnapshot()`, which reads the DEFAULT
    // pack's literal keys — these correctly read/write trip B's own `trip:trip-b:*` namespace.
    setActiveTripId('trip-b');
    const storeB = makeInMemoryBlobStore();
    const tripBJournal = sanitizeEntries([{ date: '2026-12-11', text: "Trip B's own entry", createdAt: '', updatedAt: '' }]);
    const tripBPlaces = sanitizePlaces([{ id: 'plB', name: "Trip B's place", legId: 'main', addedAt: '2026-07-02T00:00:00.000Z' }]);
    journalStore.set(tripBJournal);
    myPlacesStore.set(tripBPlaces);

    // Restore trip A's backup while trip B is active.
    const res = await importTripBackup(fileFromTripA, storeB);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/different trip/i);
    // Trip B's data is byte-for-byte untouched — no domain was written.
    expect(journalStore.get<unknown>(null)).toEqual(tripBJournal);
    expect(myPlacesStore.get<unknown>(null)).toEqual(tripBPlaces);
  });

  it('still allows a same-trip restore through (the guard is not overbroad)', async () => {
    const store = makeInMemoryBlobStore();
    await seedAll(store);
    const file = await exportTripBackup(store);

    localStorage.clear(); // same trip pointer default (DEFAULT_TRIP_ID) after clear
    const res = await importTripBackup(file, makeInMemoryBlobStore());

    expect(res.ok).toBe(true);
  });
});

describe('A-9 — myPlaces round-trips through backup → sign-out wipe → restore', () => {
  it('the imported places survive exportTripBackup → wipeAllTripData → importTripBackup', async () => {
    const store = makeInMemoryBlobStore();
    await seedAll(store);
    const beforePlaces = loadMyPlaces();
    expect(beforePlaces).toEqual(SEED_PLACES);

    const file = await exportTripBackup(store);

    // The exact teardown the sign-out dialog's "Back up this trip first" button runs.
    wipeAllTripData();
    expect(loadMyPlaces()).toEqual([]);

    const res = await importTripBackup(file, makeInMemoryBlobStore());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.restored).toContain('myPlaces');
    expect(loadMyPlaces()).toEqual(beforePlaces);
  });

  it('a malformed myPlaces domain is dropped (never-destroy), not wiped to []', async () => {
    const store = makeInMemoryBlobStore();
    await seedAll(store);
    saveMyPlaces(SEED_PLACES); // ensure the on-disk value matches SEED_PLACES exactly

    const env = {
      format: 'nepal-japan-trip-backup',
      version: 1,
      exportedAt: '2026-07-10T00:00:00.000Z',
      tripId: 'nepal-japan-2026',
      domains: { myPlaces: 'not-an-array' },
      photos: { meta: [], blobs: {} },
    };
    const file = new Blob([JSON.stringify(env)], { type: 'application/json' });
    const res = await importTripBackup(file, store);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.restored).not.toContain('myPlaces');
    expect(loadMyPlaces()).toEqual(SEED_PLACES); // untouched, not cleared
  });
});
