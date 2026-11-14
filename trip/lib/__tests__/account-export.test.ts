// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

let authHandle: () => Promise<unknown> = () => Promise.reject(new Error('unset'));
const downloads: string[] = [];
vi.mock('@/lib/firebase-config', async (orig) => ({
  ...(await orig<typeof import('@/lib/firebase-config')>()),
  isRemoteConfigured: () => true,
}));
vi.mock('@/lib/firebase-remote', () => ({ getAuthHandle: () => authHandle() }));
vi.mock('@/lib/download-blob', () => ({ downloadBlob: (_b: Blob, name: string) => downloads.push(name) }));

import { buildAccountExport, downloadAccountExport } from '@/lib/account-export';
import { STORAGE_KEYS, setSyncCode } from '@/core/storage/gateway';
import { SHARED_TRIP_ID } from '@/lib/shared-trip';

const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const store: Record<string, Record<string, unknown>> = {};
const denied = new Set<string>();

const fail = (path: string) => {
  if (denied.has(path)) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
};
const fs = {
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  collection: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  getDoc: async (ref: { path: string }) => {
    fail(ref.path);
    return { exists: () => ref.path in store, data: () => store[ref.path] };
  },
  getDocs: async (ref: { path: string }) => {
    fail(ref.path);
    const rows = Object.keys(store)
      .filter((p) => p.startsWith(`${ref.path}/`) && !p.slice(ref.path.length + 1).includes('/'))
      .map((p) => ({ id: p.slice(ref.path.length + 1), data: () => store[p] }));
    return { forEach: (cb: (d: (typeof rows)[number]) => void) => rows.forEach(cb) };
  },
};
const handle = (email: string | null) =>
  ({ db: {}, fs, auth: { currentUser: { uid: 'uid-a', email } } }) as unknown as Parameters<
    typeof buildAccountExport
  >[0];

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  denied.clear();
  downloads.length = 0;
  localStorage.clear();
  store['users/uid-a'] = { username: 'powan', accountId: ACCOUNT };
  store[`trips/${ACCOUNT}/profile/identity`] = { name: 'Powan' };
  store[`trips/${ACCOUNT}/profile/tripList`] = { version: 1, trips: [{ id: 'trip-a' }, { id: 'trip-b' }] };
  store[`trips/${ACCOUNT}/profile/journal_trip-a`] = { entries: { '2026-12-10': 'hi' } };
  store['trips/trip-a'] = { members: { 'uid-a': 'owner' } };
  store['trips/trip-a/meta/info'] = { name: 'A' };
  store['trips/trip-a/days/2026-12-10'] = { items: [] };
  store['trips/trip-b/meta/info'] = { name: 'B' };
});

describe('buildAccountExport', () => {
  it('collects account docs, every listed trip, and only this app’s local keys', async () => {
    localStorage.setItem(STORAGE_KEYS.userName, 'Powan');
    localStorage.setItem('trip:trip-a:journal', '[]');
    localStorage.setItem('someOtherSite', 'x');
    const out = await buildAccountExport(handle('powan@accounts.trip-planner.invalid'));
    expect(out.account.accountId).toBe(ACCOUNT);
    expect(out.profile.identity).toEqual({ name: 'Powan' });
    expect(out.profile['journal_trip-a']).toBeTruthy();
    expect(Object.keys(out.trips).sort()).toEqual(['trip-a', 'trip-b']);
    expect(out.trips['trip-a'].days).toEqual({ '2026-12-10': { items: [] } });
    expect(out.local).toEqual({ [STORAGE_KEYS.userName]: 'Powan', 'trip:trip-a:journal': '[]' });
    expect(out.errors).toEqual([]);
  });

  it('a refused trip is recorded and the rest still exports', async () => {
    denied.add('trips/trip-a');
    denied.add('trips/trip-a/days');
    const out = await buildAccountExport(handle('powan@accounts.trip-planner.invalid'));
    expect(out.errors.map((e) => e.path).sort()).toEqual(['trips/trip-a', 'trips/trip-a/days']);
    expect(out.errors.every((e) => e.code === 'permission-denied')).toBe(true);
    expect(out.trips['trip-b']['meta/info']).toEqual({ name: 'B' });
  });

  it('an anonymous session falls back to this device’s key', async () => {
    setSyncCode(ACCOUNT);
    const out = await buildAccountExport(handle(null));
    expect(out.account.link).toBeNull();
    expect(out.account.accountId).toBe(ACCOUNT);
    expect(out.profile.identity).toEqual({ name: 'Powan' });
  });

  it('an anonymous session skips the shared trip instead of logging its refusal', async () => {
    setSyncCode(ACCOUNT);
    store[`trips/${ACCOUNT}/profile/tripList`] = { trips: [{ id: SHARED_TRIP_ID }] };
    denied.add(`trips/${SHARED_TRIP_ID}`);
    const out = await buildAccountExport(handle(null));
    expect(out.trips[SHARED_TRIP_ID]).toBeUndefined();
    expect(out.errors).toEqual([]);
  });
});

describe('downloadAccountExport', () => {
  it('with no server, still downloads this browser’s data and says why', async () => {
    authHandle = () => Promise.reject(new Error('offline'));
    localStorage.setItem(STORAGE_KEYS.userName, 'Powan');
    const out = await downloadAccountExport();
    expect(out.errors).toEqual([{ path: '(server)', code: 'unavailable' }]);
    expect(out.local).toEqual({ [STORAGE_KEYS.userName]: 'Powan' });
    expect(downloads).toHaveLength(1);
  });
});
