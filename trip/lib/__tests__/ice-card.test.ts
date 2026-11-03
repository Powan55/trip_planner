// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadIce, saveIce, clearIce, sanitizeIce } from '@/core/ice/ice';
import { STORAGE_KEYS, TRIP_SCOPED_SLOTS, wipeAllTripData, wipeTripData, setActiveTripId } from '@/core/storage/gateway';
import { hasDeviceOnlyData, upsertKnownTrip, joinTrip, importRemoteTrips, listKnownTrips } from '@/core/trips/registry';
import { DEFAULT_TRIP_ID } from '@/core/trips';
import { exportTripBackup } from '@/lib/trip-backup';
import { decompressBlobOrText } from '@/core/vault/compression';
import { makeInMemoryBlobStore } from '@/core/photos/blob-store';

const CARD = {
  bloodType: 'O neg',
  allergies: 'Penicillin',
  medications: 'None',
  insurance: 'FAKE-POLICY-000123',
  insurancePhone: '+1 555 0100',
  contactName: 'Test Contact',
  contactPhone: '555-0199',
  hotel: 'Hotel Example, 1 Test Street',
};

describe('ICE card (key 55)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('saves, loads, trims and clears', () => {
    expect(loadIce()).toEqual({});
    expect(saveIce({ ...CARD, allergies: '  Penicillin  ' })).toBe(true);
    expect(loadIce()).toEqual(CARD);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ice)!)).toEqual(CARD);
    clearIce();
    expect(localStorage.getItem(STORAGE_KEYS.ice)).toBeNull();
  });

  it('saving an all-empty card removes the slot and drops unknown or oversized fields', () => {
    saveIce(CARD);
    saveIce({ bloodType: '   ' });
    expect(localStorage.getItem(STORAGE_KEYS.ice)).toBeNull();
    expect(sanitizeIce({ bloodType: 'A'.repeat(99), extra: 'x', hotel: 5 })).toEqual({ bloodType: 'A'.repeat(20) });
  });

  it('rescues an unreadable slot instead of losing it to the next save', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEYS.ice, '{"bloodType":"O neg"');
    expect(loadIce()).toEqual({});
    saveIce({ bloodType: 'A pos' });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.localRescue)!)).toEqual({ ice: '{"bloodType":"O neg"' });
  });

  it('is wiped by sign-out and by forgetting the trip, and counts as device-only data', () => {
    expect(TRIP_SCOPED_SLOTS).toContain('ice');
    saveIce(CARD);
    wipeAllTripData();
    expect(localStorage.getItem(STORAGE_KEYS.ice)).toBeNull();

    localStorage.setItem('trip:t1:ice', JSON.stringify(CARD));
    expect(hasDeviceOnlyData('t1')).toBe(true);
    wipeTripData('t1');
    expect(localStorage.getItem('trip:t1:ice')).toBeNull();
    expect(hasDeviceOnlyData('t1')).toBe(false);
  });

  it('survives a remote forget of the trip', () => {
    setActiveTripId(DEFAULT_TRIP_ID);
    upsertKnownTrip('gone', 'Going away');
    joinTrip(DEFAULT_TRIP_ID);
    localStorage.setItem('trip:gone:ice', JSON.stringify(CARD));
    importRemoteTrips([], [{ id: 'gone', removedAt: Date.now() + 60_000 }]);
    expect(listKnownTrips().some((t) => t.id === 'gone')).toBe(false);
    expect(JSON.parse(localStorage.getItem('trip:gone:ice')!)).toEqual(CARD);
  });

  it('never reaches a backup file', async () => {
    saveIce(CARD);
    const text = await decompressBlobOrText(await exportTripBackup(makeInMemoryBlobStore()));
    expect(text).not.toContain('FAKE-POLICY-000123');
    expect(text).not.toContain('Test Contact');
    expect(text).not.toContain(STORAGE_KEYS.ice);
  });

  it('is referenced by no sync, share, backup or concierge code', () => {
    const root = join(__dirname, '..', '..');
    const files = [
      ...readdirSync(join(root, 'lib')).filter((f) => /remote|share|concierge|presence/.test(f)).map((f) => join(root, 'lib', f)),
      ...readdirSync(join(root, 'core', 'sync')).map((f) => join(root, 'core', 'sync', f)),
      ...readdirSync(join(root, 'core', 'share')).map((f) => join(root, 'core', 'share', f)),
      join(root, 'hooks', 'use-concierge-chat.ts'),
      join(root, 'core', 'storage', 'concierge-store.ts'),
    ].filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(15);
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/\biceStore|core\/ice|STORAGE_KEYS\.ice|'ice'/);
    }
  });
});
