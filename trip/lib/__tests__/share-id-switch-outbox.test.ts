// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
  return { ...config, ...gateway, ...outbox };
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

  it('keeps the plan when a local-only pack starts sharing', async () => {
    const m = await load();
    localStorage.setItem(m.STORAGE_KEYS.itinerary, '[]');
    m.setDefaultTripShareId(Y);
    expect(localStorage.getItem(m.STORAGE_KEYS.itinerary)).toBe('[]');
  });
});
