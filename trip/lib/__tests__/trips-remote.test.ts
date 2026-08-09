// @vitest-environment jsdom
//
// S254 — WIRED-behavior unit suite for the trip-meta Sync-v2 seam (lib/trips-remote.ts), against a
// FAKE Firestore (the firebase SDK modules are vi.mock'd). Proves, on a real run:
//
//   1. pushTripMeta writes the exact doc path `trips/{tripId}/meta/info` with `{ name, config? }`,
//      stripping an `undefined` optional config field (Firestore rejects `undefined`).
//   2. fetchTripMeta round-trips a present, well-formed doc back into a sanitized TripMetaPayload.
//   3. fetchTripMeta on a MALFORMED remote doc (bad config) degrades to a name-only result — never
//      throws, never invents fields.
//   4. fetchTripMeta on a doc with no name at all returns undefined (no state change for the caller).
//   5. fetchTripMeta on an ABSENT doc returns undefined.
//   6. Both directions are dormant-safe: isRemoteConfigured() === false short-circuits with NO
//      Firestore call at all (proven by an empty writeLog / no getDoc invocation).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TripConfigBlock } from '@/core/trips/registry';

const isRemoteConfiguredMock = vi.fn(() => true);
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => isRemoteConfiguredMock(),
  getTripId: () => 'nepal-japan-2026',
}));

type DocData = Record<string, unknown>;
class FakeFirestore {
  docs = new Map<string, DocData>();
  failWrites = false;
  setDocData(path: string, data: DocData) {
    this.docs.set(path, JSON.parse(JSON.stringify(data)));
  }
}
const fake = new FakeFirestore();
const writeLog: { path: string; data: DocData }[] = [];
let getDocCalls = 0;

function pathOf(segments: string[]): string {
  return segments.join('/');
}

vi.mock('firebase/app', () => ({
  initializeApp: () => ({ name: 'fake' }),
  getApps: () => [],
  getApp: () => ({ name: 'fake' }),
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => fake,
  doc: (_db: unknown, ...segs: string[]) => ({ __type: 'doc', path: pathOf(segs) }),
  setDoc: async (ref: { path: string }, data: DocData) => {
    if (fake.failWrites) throw new Error('transport down');
    writeLog.push({ path: ref.path, data });
    fake.setDocData(ref.path, data);
  },
  getDoc: async (ref: { path: string }) => {
    getDocCalls++;
    const data = fake.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  },
}));

import { pushTripMeta, fetchTripMeta } from '@/lib/trips-remote';

const TRIP_ID = 'custom-trip-abc';
const DOC_PATH = `trips/${TRIP_ID}/meta/info`;

function config(over: Partial<TripConfigBlock> = {}): TripConfigBlock {
  return { start: '2027-01-01', end: '2027-01-10', destinations: ['Kerala'], vibe: 'relaxed', updatedAt: 1, ...over };
}

beforeEach(() => {
  fake.docs.clear();
  writeLog.length = 0;
  getDocCalls = 0;
  isRemoteConfiguredMock.mockReturnValue(true);
});

describe('pushTripMeta — writes trips/{tripId}/meta/info', () => {
  it('writes {name, config} to the exact doc path', async () => {
    await pushTripMeta(TRIP_ID, { name: 'Kerala 2027', config: config() });
    expect(writeLog).toHaveLength(1);
    expect(writeLog[0].path).toBe(DOC_PATH);
    expect(writeLog[0].data).toEqual({ name: 'Kerala 2027', config: config() });
  });

  it('strips the undefined config field (name-only push) rather than sending undefined', async () => {
    await pushTripMeta(TRIP_ID, { name: 'Just a name' });
    expect(writeLog).toHaveLength(1);
    expect(writeLog[0].data).toEqual({ name: 'Just a name' });
    expect('config' in writeLog[0].data).toBe(false);
  });

  it('a config with an undefined optional field (currency) serializes without it', async () => {
    await pushTripMeta(TRIP_ID, { name: 'K', config: config({ currency: undefined }) });
    const written = writeLog[0].data.config as Record<string, unknown>;
    expect('currency' in written).toBe(false);
  });

  it('no-ops (no Firestore call) when dormant', async () => {
    isRemoteConfiguredMock.mockReturnValue(false);
    await pushTripMeta(TRIP_ID, { name: 'X' });
    expect(writeLog).toHaveLength(0);
  });

  it('never throws when the transport fails — swallows to console.warn, no outbox', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.failWrites = true;
    await expect(pushTripMeta(TRIP_ID, { name: 'X' })).resolves.toBeUndefined();
    expect(writeLog).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    fake.failWrites = false;
    warn.mockRestore();
  });
});

describe('fetchTripMeta — one-shot getDoc round-trip + sanitize', () => {
  it('round-trips a present, well-formed doc', async () => {
    fake.setDocData(DOC_PATH, { name: 'Kerala 2027', config: config() });
    const result = await fetchTripMeta(TRIP_ID);
    expect(result).toEqual({ name: 'Kerala 2027', config: config() });
    expect(getDocCalls).toBe(1);
  });

  it('a malformed config (bad dates) degrades to a name-only result, never throws', async () => {
    fake.setDocData(DOC_PATH, { name: 'Kerala 2027', config: { start: 'not-a-date', end: '2027-01-10' } });
    const result = await fetchTripMeta(TRIP_ID);
    expect(result).toEqual({ name: 'Kerala 2027' });
  });

  it('a doc with no name returns undefined (no state change)', async () => {
    fake.setDocData(DOC_PATH, { config: config() });
    const result = await fetchTripMeta(TRIP_ID);
    expect(result).toBeUndefined();
  });

  it('an absent doc returns undefined', async () => {
    const result = await fetchTripMeta(TRIP_ID);
    expect(result).toBeUndefined();
  });

  it('no-ops (no getDoc call) when dormant', async () => {
    isRemoteConfiguredMock.mockReturnValue(false);
    const result = await fetchTripMeta(TRIP_ID);
    expect(result).toBeUndefined();
    expect(getDocCalls).toBe(0);
  });
});
