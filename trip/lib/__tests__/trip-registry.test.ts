// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  STORAGE_KEYS,
  DEFAULT_TRIP_ID,
  setActiveTripId,
  getActiveTripId,
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
