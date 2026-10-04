// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTripBackup, importTripBackup } from '@/lib/trip-backup';
import { makeInMemoryBlobStore } from '@/core/photos/blob-store';
import { savePhotos } from '@/core/photos/storage';
import { setActiveTripId } from '@/core/storage/gateway';
import { savePlans } from '@/lib/itinerary-storage';
import type { PhotoMeta } from '@/core/photos/model';

const meta = (id: string): PhotoMeta => ({
  id,
  owner: { kind: 'journal', date: '2026-12-10' },
  altText: id,
  w: 10,
  h: 10,
  bytes: 1,
  createdAt: '2026-07-01T00:00:00.000Z',
});

// Random bytes so gzip cannot shrink them; the check is on the real output size.
const noise = (n: number) => {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 2654435761) >>> 24;
  return new Blob([a], { type: 'image/jpeg' });
};

beforeEach(() => {
  localStorage.clear();
  setActiveTripId('');
  localStorage.clear();
  savePlans([{ date: '2026-12-10', city: 'Kathmandu', country: 'nepal', items: [] }]);
});

describe('export byte budget (#749)', () => {
  it('keeps the file under the cap, omits the overflow, and the result still imports', async () => {
    const store = makeInMemoryBlobStore();
    for (const id of ['a', 'b', 'c', 'd']) await store.putWithId(id, noise(300_000));
    await store.putWithId('gone', noise(10)); // meta below has no bytes in store for 'missing'
    savePhotos(['a', 'b', 'c', 'd', 'missing'].map(meta));

    // cap fits ~2 photos of ~400KB base64 after the 1MB headroom
    const cap = 1024 * 1024 + 900_000;
    const r = await buildTripBackup(store, cap);
    expect(r.blob.size).toBeLessThanOrEqual(cap);
    expect(r.omitted).toBeGreaterThan(0);
    expect(r.missing).toBe(1);

    localStorage.clear();
    const res = await importTripBackup(r.blob, makeInMemoryBlobStore());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.photosSkipped).toBe(r.omitted + r.missing);
  });

  it('throws a clear error when even the bare envelope cannot fit', async () => {
    await expect(buildTripBackup(makeInMemoryBlobStore(), 100)).rejects.toThrow(/too large/);
  });

  it('restore surfaces the real too-large message', async () => {
    const big = { size: 65 * 1024 * 1024 } as unknown as Blob;
    const res = await importTripBackup(big, makeInMemoryBlobStore());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/too large to open/);
  });
});
