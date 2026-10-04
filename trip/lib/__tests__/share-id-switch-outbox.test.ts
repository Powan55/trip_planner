// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SHARED_TRIP_ID } from '@/lib/shared-trip';

vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

const Y = 'trip-y-0000';
const X = 'trip-x-1111';
const DATE = '2026-12-10';

async function load() {
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'test-key');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'test-project');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_ID', 'test-app');
  vi.resetModules();
  const [config, gateway, outbox] = await Promise.all([
    import('@/lib/firebase-config'),
    import('@/core/storage/gateway'),
    import('@/core/sync/outbox'),
  ]);
  const registry = await import('@/core/trips/registry');
  return { ...config, ...gateway, ...outbox, ...registry };
}

describe('#517 — switching the default pack to another shared trip', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('pushes nothing queued under trip Y into trip X', async () => {
    const m = await load();
    m.setDefaultTripShareId(Y);
    const plans = [{ date: DATE, city: 'Kathmandu', country: 'nepal' as const, items: [] }];
    localStorage.setItem(m.STORAGE_KEYS.itinerary, JSON.stringify(plans));

    // Offline edit under Y: the push rejects, so the chunk stays queued.
    const offline = m.withOutbox<typeof plans>({
      domain: 'itinerary',
      chunkDiff: () => [DATE],
      pushChunk: () => Promise.reject(new Error('offline')),
    });
    await offline([], plans);
    expect(m.outboxDirty('itinerary')).toEqual([DATE]);

    m.setDefaultTripShareId(X);

    const pushedTo: string[] = [];
    await m.flushOutbox<typeof plans>(
      {
        domain: 'itinerary',
        chunkDiff: () => [],
        pushChunk: async () => {
          pushedTo.push(m.getTripId());
        },
      },
      { load: () => plans, save: () => {}, has: () => true },
    );

    expect(pushedTo).toEqual([]);
    expect(m.outboxDirty('itinerary')).toEqual([]);
    expect(localStorage.getItem(m.STORAGE_KEYS.itinerary)).toBeNull();
  });

  it('an edit queued under an old id never flushes into the shared trip after the move', async () => {
    const m = await load();
    m.setDefaultTripShareId(Y);
    const plans = [{ date: DATE, city: 'Kathmandu', country: 'nepal' as const, items: [] }];
    localStorage.setItem(m.STORAGE_KEYS.itinerary, JSON.stringify(plans));
    const cs = {
      domain: 'itinerary' as const,
      chunkDiff: () => [DATE],
      pushChunk: () => Promise.reject(new Error('offline')),
    };
    await m.withOutbox<typeof plans>(cs)([], plans);
    expect(m.outboxDirty('itinerary')).toEqual([DATE]);

    m.setDefaultTripShareId(SHARED_TRIP_ID);

    const pushedTo: string[] = [];
    await m.flushOutbox<typeof plans>(
      { ...cs, chunkDiff: () => [], pushChunk: async () => void pushedTo.push(m.getTripId()) },
      { load: () => plans, save: () => {}, has: () => true },
    );
    expect(pushedTo).toEqual([]);
    expect(m.outboxDirty('itinerary')).toEqual([]);
  });

  it('a Y push resolving after the switch does not ack the same chunk queued under X', async () => {
    const m = await load();
    m.setDefaultTripShareId(Y);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const push = m.withOutbox<string>({
      domain: 'budget',
      chunkDiff: () => ['model'],
      pushChunk: (_chunk, current) => (current === 'y' ? held : Promise.reject(new Error('offline'))),
    });

    const pushY = push('', 'y');
    m.setDefaultTripShareId(X);
    await push('', 'x');
    expect(m.outboxDirty('budget')).toEqual(['model']);

    release();
    await pushY;
    expect(m.outboxDirty('budget')).toEqual(['model']);
  });

  it('keeps the plan when a local-only pack starts sharing', async () => {
    const m = await load();
    localStorage.setItem(m.STORAGE_KEYS.itinerary, '[]');
    m.setDefaultTripShareId(Y);
    expect(localStorage.getItem(m.STORAGE_KEYS.itinerary)).toBe('[]');
  });
});

describe('#654 — switching the active trip while a push is in flight', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('writes and acks the trip that committed, and a same-chunk commit on the new trip runs on its own', async () => {
    const m = await load();
    const A = 'trip-a-2222';
    const B = 'trip-b-3333';
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const writes: [string, string][] = [];
    const push = m.withOutbox<string>({
      domain: 'budget',
      chunkDiff: () => ['model'],
      pushChunk: (_chunk, current, tripId) => {
        writes.push([current, tripId]);
        return current === 'a' ? held : Promise.resolve();
      },
    });

    m.setActiveTripId(A);
    const pushA = push('', 'a');
    m.setActiveTripId(B);
    await push('', 'b');
    expect(writes).toEqual([['a', A], ['b', B]]);
    expect(m.outboxDirty('budget', B)).toEqual([]);
    expect(m.outboxDirty('budget', A)).toEqual(['model']);

    const slotB = localStorage.getItem(m.keyForTrip(B, 'syncOutbox'));
    release();
    await pushA;
    expect(writes).toHaveLength(2);
    expect(m.outboxDirty('budget', A)).toEqual([]);
    expect(localStorage.getItem(m.keyForTrip(B, 'syncOutbox'))).toBe(slotB);
  });
});

describe('#572 — joining the shared trip from a pack that holds local data', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('only returns to the pack: the id is not written and local expenses are not dropped', async () => {
    const m = await load();
    localStorage.setItem(m.STORAGE_KEYS.expenses, '[{"id":"e1"}]');
    expect(m.joinTrip(`pack:${SHARED_TRIP_ID}`)).toBe(true);
    expect(localStorage.getItem(m.STORAGE_KEYS.expenses)).toBe('[{"id":"e1"}]');
    expect(m.getStoredDefaultTripShareId()).toBe('');
    expect(m.getActiveTripId()).toBe(m.DEFAULT_TRIP_ID);
  });

  it('keeps the owner data when they start sharing their own pack', async () => {
    const m = await load();
    localStorage.setItem(m.STORAGE_KEYS.expenses, '[{"id":"e1"}]');
    m.setDefaultTripShareId(X);
    expect(localStorage.getItem(m.STORAGE_KEYS.expenses)).toBe('[{"id":"e1"}]');
  });
});
