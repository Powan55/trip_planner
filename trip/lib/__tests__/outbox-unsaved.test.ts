// @vitest-environment jsdom
// #982: a refused outbox write must still protect the edit for this page load, and a slot from a
// newer build must not be rewritten as v1.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChunkSync } from '@/core/sync/outbox';
import { STORAGE_KEYS, setDefaultTripShareId } from '@/core/storage/gateway';

vi.mock('@/lib/firebase-config', () => ({
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => 'nepal-japan-2026',
}));
vi.mock('@/lib/token-auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/token-auth')>()),
  getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }),
}));

type State = Record<string, number>;
let m: typeof import('@/core/sync/outbox');
let online: boolean;
let pushes: string[];
const cs: ChunkSync<State> = {
  domain: 'itinerary',
  chunkDiff: (prev, next) => Object.keys(next).filter((k) => prev[k] !== next[k]),
  pushChunk: async (chunk) => {
    pushes.push(chunk);
    if (!online) throw new Error('offline');
  },
};
const KEY = STORAGE_KEYS.syncOutbox;
const storage = (v: State) => ({ load: () => v, save: () => true, has: () => true });

function fillQuotaFor(key: string) {
  const real = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
    if (k === key) throw new DOMException('full', 'QuotaExceededError');
    real.call(this, k, v);
  });
}

beforeEach(async () => {
  vi.resetModules();
  m = await import('@/core/sync/outbox');
  localStorage.clear();
  online = false;
  pushes = [];
});
afterEach(() => vi.restoreAllMocks());

describe('a refused outbox write (#982)', () => {
  it('keeps the chunk dirty for this page load and writes it once storage has room', async () => {
    const quota = fillQuotaFor(KEY);
    await m.withOutbox(cs)({}, { d1: 1 });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(m.outboxDirty('itinerary')).toEqual(['d1']); // what the first-snapshot merge reads
    expect(m.outboxSnapshot().dirty).toEqual({ itinerary: ['d1'] });

    quota.mockRestore();
    await m.withOutbox(cs)({ d1: 1 }, { d1: 1, d2: 1 });
    expect(JSON.parse(localStorage.getItem(KEY)!).dirty.itinerary.sort()).toEqual(['d1', 'd2']);
  });

  it('a flush still retries the unsaved chunk and acks it', async () => {
    fillQuotaFor(KEY);
    await m.withOutbox(cs)({}, { d1: 1 });
    online = true;
    await m.flushOutbox(cs, storage({ d1: 1 }));
    expect(pushes).toEqual(['d1', 'd1']);
    expect(m.outboxDirty('itinerary')).toEqual([]);
  });

  it('does not carry into another shared trip after a share switch', async () => {
    setDefaultTripShareId('trip-a');
    fillQuotaFor(KEY);
    await m.withOutbox(cs)({}, { d1: 1 });
    expect(m.outboxDirty('itinerary')).toEqual(['d1']);
    setDefaultTripShareId('trip-b');
    expect(m.outboxDirty('itinerary')).toEqual([]);
  });
});

describe('a refused write in one tab, an accepted one in another (#1026)', () => {
  it("the refused tab's ack does not clear the other tab's newer edit", async () => {
    let release!: () => void;
    const held: ChunkSync<State> = { ...cs, pushChunk: () => new Promise<void>((r) => (release = r)) };
    const quota = fillQuotaFor(KEY);
    const inFlight = m.withOutbox(held)({}, { d1: 1 });
    quota.mockRestore();
    // the other tab lands its own first enqueue of d1
    localStorage.setItem(KEY, JSON.stringify({ version: 1, dirty: { itinerary: ['d1'] }, seq: { itinerary: { d1: 1 } } }));
    release();
    await inFlight;
    expect(m.outboxDirty('itinerary')).toEqual(['d1']);
  });
});

describe('a slot from a newer build (#982)', () => {
  it('is left on disk and the new edit stays dirty in memory', async () => {
    const future = JSON.stringify({ version: 2, dirty: { itinerary: ['d9'] }, extra: true });
    localStorage.setItem(KEY, future);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await m.withOutbox(cs)({}, { d1: 1 });
    expect(localStorage.getItem(KEY)).toBe(future);
    expect(m.outboxDirty('itinerary')).toEqual(['d1']);
  });
});
