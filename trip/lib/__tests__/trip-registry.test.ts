// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// `removeKnownTrip` deletes the forgotten trip's photo bytes through the app's ONE blob-store
// singleton; jsdom has no IndexedDB (D-088 forbids a fake-idb dep), so swap in the in-memory fake
// that already ships in that module.
vi.mock('@/core/photos/blob-store', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/core/photos/blob-store')>();
  return { ...orig, defaultBlobStore: orig.makeInMemoryBlobStore() };
});
// Static import so the mock factory runs (registry.ts only imports it dynamically, inside the
// forget path) — this binding IS the fake the production code will reach for.
import { defaultBlobStore } from '@/core/photos/blob-store';

import {
  STORAGE_KEYS,
  DEFAULT_TRIP_ID,
  setActiveTripId,
  getActiveTripId,
  setSyncCode,
} from '@/core/storage/gateway';
import {
  listKnownTrips,
  upsertKnownTrip,
  renameKnownTrip,
  joinTrip,
  removeKnownTrip,
  listRemovedTrips,
} from '@/core/trips/registry';

/**
 * S238 — known-trips registry (gateway key 26 + core/trips/registry.ts). Pins:
 *   - key 26 literal + APP-SCOPED placement (raw transport in the gateway, policy here)
 *   - listKnownTrips: default pack ALWAYS first, sanitize drops malformed entries, self-heal
 *     persists a pre-registry active trip as 'Shared trip'
 *   - upsertKnownTrip keeps an existing name; renameKnownTrip persists (incl. the default)
 *   - joinTrip = upsert + setActiveTripId, NO reload (D-172 — the caller reloads)
 */

const KEY = 'tripPlannerKnownTrips';
const read = () => JSON.parse(window.localStorage.getItem(KEY) ?? '[]');

describe('trip registry (S238)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('gateway key 26 is exactly tripPlannerKnownTrips', () => {
    expect(STORAGE_KEYS.knownTrips).toBe('tripPlannerKnownTrips');
  });

  // ── default-first ──────────────────────────────────────────────────────────
  it('empty storage ⇒ exactly the synthesized default pack entry, first and only', () => {
    expect(listKnownTrips()).toEqual([
      { id: DEFAULT_TRIP_ID, name: 'Nepal × Japan', joinedAt: 0 },
    ]);
    // Synthesized, NOT persisted — no write on a pure read of the default state.
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('default pack is ALWAYS first even when stored after other trips', () => {
    upsertKnownTrip('aaa', 'Trip A');
    upsertKnownTrip(DEFAULT_TRIP_ID);
    const list = listKnownTrips();
    expect(list[0].id).toBe(DEFAULT_TRIP_ID);
    expect(list[0].name).toBe('Nepal × Japan');
    expect(list.map((t) => t.id)).toEqual([DEFAULT_TRIP_ID, 'aaa']);
  });

  // ── sanitize ───────────────────────────────────────────────────────────────
  it('drops malformed entries (bad JSON, non-array, missing/empty/wrong-typed fields, dupes)', () => {
    window.localStorage.setItem(KEY, 'not-json{');
    expect(listKnownTrips()).toHaveLength(1); // default only

    window.localStorage.setItem(KEY, JSON.stringify({ id: 'x' }));
    expect(listKnownTrips()).toHaveLength(1);

    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: 'good', name: 'Good', joinedAt: 5 },
        { id: '', name: 'no id', joinedAt: 1 },
        { id: 'no-name', name: '', joinedAt: 1 },
        { id: 'bad-time', name: 'x', joinedAt: 'yesterday' },
        { id: 'nan-time', name: 'x', joinedAt: NaN },
        { id: 'good', name: 'Dupe (dropped, first wins)', joinedAt: 9 },
        null,
        42,
      ]),
    );
    expect(listKnownTrips()).toEqual([
      { id: DEFAULT_TRIP_ID, name: 'Nepal × Japan', joinedAt: 0 },
      { id: 'good', name: 'Good', joinedAt: 5 },
    ]);
  });

  // ── self-heal ──────────────────────────────────────────────────────────────
  it('self-heals: an active trip missing from the list is persisted as Shared trip', () => {
    setActiveTripId('pre-registry-token'); // joined before the registry existed
    const list = listKnownTrips();
    expect(list.map((t) => t.id)).toEqual([DEFAULT_TRIP_ID, 'pre-registry-token']);
    expect(list[1].name).toBe('Shared trip');
    // PERSISTED (not just synthesized) — the next read finds it in storage.
    expect(read().some((t: { id: string }) => t.id === 'pre-registry-token')).toBe(true);
  });

  it('no self-heal write when the active trip is the default or already known', () => {
    listKnownTrips();
    expect(window.localStorage.getItem(KEY)).toBeNull(); // default active ⇒ no write
    joinTrip('known-1', 'Known');
    const before = window.localStorage.getItem(KEY);
    listKnownTrips();
    expect(window.localStorage.getItem(KEY)).toBe(before); // already known ⇒ no rewrite
  });

  // ── upsert ─────────────────────────────────────────────────────────────────
  it('upsertKnownTrip adds with the given name; re-upsert KEEPS the existing name', () => {
    upsertKnownTrip('t1', 'My name');
    upsertKnownTrip('t1', 'Other name');
    expect(listKnownTrips().find((t) => t.id === 't1')?.name).toBe('My name');
  });

  it('upsertKnownTrip without a name falls back to Shared trip', () => {
    upsertKnownTrip('t2');
    expect(listKnownTrips().find((t) => t.id === 't2')?.name).toBe('Shared trip');
  });

  // ── rename ─────────────────────────────────────────────────────────────────
  it('renameKnownTrip renames a stored trip', () => {
    upsertKnownTrip('t1', 'Old');
    renameKnownTrip('t1', 'New name');
    expect(listKnownTrips().find((t) => t.id === 't1')?.name).toBe('New name');
  });

  it('renaming the (synthesized) default pack persists and survives listKnownTrips', () => {
    renameKnownTrip(DEFAULT_TRIP_ID, 'Our big trip');
    const list = listKnownTrips();
    expect(list[0]).toMatchObject({ id: DEFAULT_TRIP_ID, name: 'Our big trip' });
  });

  it('renameKnownTrip ignores an empty/whitespace name', () => {
    upsertKnownTrip('t1', 'Keep');
    renameKnownTrip('t1', '   ');
    expect(listKnownTrips().find((t) => t.id === 't1')?.name).toBe('Keep');
  });

  // ── joinTrip ───────────────────────────────────────────────────────────────
  it('joinTrip registers the trip AND writes the active-trip pointer (no reload here — D-172)', () => {
    joinTrip('abc-123', 'New trip');
    expect(getActiveTripId()).toBe('abc-123');
    expect(window.localStorage.getItem('tripPlannerActiveTrip')).toBe('abc-123');
    expect(listKnownTrips().find((t) => t.id === 'abc-123')?.name).toBe('New trip');
  });

  it('joinTrip(DEFAULT_TRIP_ID) switches back without inventing a bogus name', () => {
    joinTrip('abc-123', 'New trip');
    joinTrip(DEFAULT_TRIP_ID);
    expect(getActiveTripId()).toBe(DEFAULT_TRIP_ID);
    expect(listKnownTrips()[0].name).toBe('Nepal × Japan');
  });

  it('joining the DEFAULT pack by pasted key never renames it to Shared trip', () => {
    joinTrip('other', 'Shared trip');
    joinTrip(DEFAULT_TRIP_ID, 'Shared trip'); // e.g. the default key pasted into Join-by-key
    expect(listKnownTrips()[0]).toMatchObject({ id: DEFAULT_TRIP_ID, name: 'Nepal × Japan' });
  });

  it('joinTrip on an already-known trip keeps its name (idempotent re-join)', () => {
    joinTrip('abc-123', 'Named once');
    joinTrip('abc-123', 'Shared trip'); // e.g. re-opening the same share link
    expect(listKnownTrips().find((t) => t.id === 'abc-123')?.name).toBe('Named once');
  });

  // ── the two-token invariant: the account credential is never a trip ────────
  //
  // A trip row IS a shareable capability (the id is the Trip Token, and /trips renders copy
  // affordances for it), so the account key must never become one. `joinTrip` is the single entry
  // point every join/switch surface routes through, which is why the check lives there and not in
  // four forms.
  describe('joinTrip refuses the account credential', () => {
    const ACCOUNT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

    it('the value getSyncCode() returns is refused, named, and writes NOTHING', () => {
      setSyncCode(ACCOUNT);
      joinTrip('real-trip', 'A real trip'); // a normal join first, so "unchanged" means something
      const listBefore = window.localStorage.getItem(KEY);

      expect(joinTrip(ACCOUNT, 'Looks like a trip')).toEqual({
        ok: false,
        reason: 'own-account-token',
      });
      expect(getActiveTripId()).toBe('real-trip'); // pointer never moved
      expect(window.localStorage.getItem(KEY)).toBe(listBefore); // no row, no rewrite
      expect(listKnownTrips().some((t) => t.id === ACCOUNT)).toBe(false);
    });

    it('refused however it was pasted — surrounding space and a different case are the same key', () => {
      setSyncCode(ACCOUNT);
      expect(joinTrip(`  ${ACCOUNT}  `)).toEqual({ ok: false, reason: 'own-account-token' });
      expect(joinTrip(ACCOUNT.toUpperCase())).toEqual({ ok: false, reason: 'own-account-token' });
      expect(listKnownTrips()).toEqual([
        { id: DEFAULT_TRIP_ID, name: 'Nepal × Japan', joinedAt: 0 },
      ]);
    });

    it('any OTHER non-empty id still joins, with an account set', () => {
      setSyncCode(ACCOUNT);
      expect(joinTrip('friends-trip', 'Friends trip')).toEqual({ ok: true });
      expect(getActiveTripId()).toBe('friends-trip');
      expect(listKnownTrips().find((t) => t.id === 'friends-trip')?.name).toBe('Friends trip');
    });

    it('no account on this device ⇒ nothing to compare against, so joins are unaffected', () => {
      expect(joinTrip('friends-trip', 'Friends trip')).toEqual({ ok: true });
      expect(getActiveTripId()).toBe('friends-trip');
    });

    it('an empty id is refused by its own name, not silently', () => {
      expect(joinTrip('')).toEqual({ ok: false, reason: 'empty' });
    });
  });

  // ── removeKnownTrip sweeps the trip's local data (A-10 / #100) ─────────────
  describe('removeKnownTrip — wipes the forgotten trip\'s trip:{id}:* data (A-10)', () => {
    it('a forgotten trip\'s scoped slots are gone; another known trip\'s data is untouched', () => {
      joinTrip('gone', 'Going away');
      window.localStorage.setItem('trip:gone:budget', 'x');
      window.localStorage.setItem('trip:gone:itinerary', 'y');
      window.localStorage.setItem('trip:kept:budget', 'keep-me');

      joinTrip(DEFAULT_TRIP_ID); // switch off 'gone' first (mirrors real usage)
      removeKnownTrip('gone');

      expect(window.localStorage.getItem('trip:gone:budget')).toBeNull();
      expect(window.localStorage.getItem('trip:gone:itinerary')).toBeNull();
      expect(window.localStorage.getItem('trip:kept:budget')).toBe('keep-me');
    });

    it('removeKnownTrip(DEFAULT_TRIP_ID) is a no-op and never wipes the default pack\'s bare keys', () => {
      window.localStorage.setItem(STORAGE_KEYS.budget, 'default-pack-data');
      removeKnownTrip(DEFAULT_TRIP_ID);
      expect(window.localStorage.getItem(STORAGE_KEYS.budget)).toBe('default-pack-data');
    });

    it('the forgotten trip\'s photo BLOBS go with its meta index; another trip\'s blobs stay', async () => {
      // wipeTripData only sweeps localStorage, so forgetting a trip deleted the photo meta — the
      // only index naming that trip's blob ids — and left the bytes in the app-scoped IndexedDB
      // forever: unreachable from every UI, never GC'd, still counting against the origin quota
      // until captures start failing with reason:'quota'.
      await defaultBlobStore.putWithId('ph-gone-1', new Blob(['a']));
      await defaultBlobStore.putWithId('ph-gone-2', new Blob(['b']));
      await defaultBlobStore.putWithId('ph-kept-1', new Blob(['c']));
      window.localStorage.setItem(
        'trip:gone:photos',
        JSON.stringify([
          { id: 'ph-gone-1', owner: { kind: 'journal', date: '2026-12-10' }, altText: 'a', createdAt: '2026-12-10T00:00:00.000Z' },
          { id: 'ph-gone-2', owner: { kind: 'journal', date: '2026-12-10' }, altText: 'b', createdAt: '2026-12-10T00:00:00.000Z' },
        ]),
      );

      joinTrip('gone', 'Going away');
      joinTrip(DEFAULT_TRIP_ID); // forget it from another trip, as the hub does
      removeKnownTrip('gone');

      await vi.waitFor(async () => expect(await defaultBlobStore.list()).toEqual(['ph-kept-1']));
    });
  });

  // ── removeKnownTrip tombstone cap (S352) ───────────────────────────────────
  describe('removeKnownTrip — the tombstone list caps at 200, newest-first (S352)', () => {
    it('a single forget records exactly one tombstone, newest (only) first', () => {
      joinTrip('t1', 'One');
      removeKnownTrip('t1');
      expect(listRemovedTrips().map((r) => r.id)).toEqual(['t1']);
    });

    it('caps at 200 entries — the 201st push drops the OLDEST, not a FIFO shift (mirrors PLACES_CAP)', () => {
      for (let i = 0; i < 200; i++) {
        joinTrip(`t${i}`, `Trip ${i}`);
        removeKnownTrip(`t${i}`);
      }
      expect(listRemovedTrips()).toHaveLength(200);
      expect(listRemovedTrips()[0].id).toBe('t199'); // newest-first

      joinTrip('t200', 'Trip 200');
      removeKnownTrip('t200');

      const removed = listRemovedTrips();
      expect(removed).toHaveLength(200); // still capped, not 201
      expect(removed[0].id).toBe('t200'); // newest prepended to the front
      expect(removed.some((r) => r.id === 't0')).toBe(false); // oldest dropped
    });
  });
});
