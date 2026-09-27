// @vitest-environment jsdom
//
// #641 invite client: create shape, the redeem batch's exact field paths, and how every redeem
// outcome maps. Firestore is faked at the module boundary; calls are counted, not assumed.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => 'trip-abc',
}));
vi.mock('firebase/app', () => ({
  initializeApp: () => ({ name: 'fake' }),
  getApps: () => [],
  getApp: () => ({ name: 'fake' }),
}));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'me', getIdToken: async () => 'tok' } }),
  onAuthStateChanged: (_auth: unknown, next: (u: unknown) => void) => {
    queueMicrotask(() => next({ uid: 'me' }));
    return () => {};
  },
  signInAnonymously: async () => ({ user: { uid: 'me' } }),
}));

const { TS } = vi.hoisted(() => ({ TS: { __ts: true } }));
const fake = vi.hoisted(() => ({
  reads: 0,
  readError: undefined as { code: string } | undefined,
  commitError: undefined as { code: string } | undefined,
  trip: undefined as Record<string, unknown> | undefined,
  invites: [] as { id: string; data: Record<string, unknown> }[],
  sets: [] as { path: string; data: Record<string, unknown> }[],
  deletes: [] as string[],
  batches: [] as { path: string; data: Record<string, unknown> }[][],
}));
const err = (code: string) => Object.assign(new Error(code), { code });

vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}),
  initializeFirestore: () => ({}),
  persistentLocalCache: () => ({}),
  serverTimestamp: () => TS,
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  collection: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  getDocFromServer: async () => {
    fake.reads += 1;
    if (fake.readError) throw err(fake.readError.code);
    return { exists: () => fake.trip !== undefined, data: () => fake.trip };
  },
  getDocsFromServer: async () => {
    fake.reads += 1;
    return { forEach: (fn: (d: unknown) => void) => fake.invites.forEach((i) => fn({ id: i.id, data: () => i.data })) };
  },
  setDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    fake.sets.push({ path: ref.path, data });
  },
  deleteDoc: async (ref: { path: string }) => {
    fake.deletes.push(ref.path);
  },
  writeBatch: () => {
    const ops: { path: string; data: Record<string, unknown> }[] = [];
    return {
      update: (ref: { path: string }, data: Record<string, unknown>) => ops.push({ path: ref.path, data }),
      commit: async () => {
        if (fake.commitError) throw err(fake.commitError.code);
        fake.batches.push(ops);
      },
    };
  },
}));

import { createInvite, listInvites, redeemInvite, revokeInvite, INVITE_TTL_MS } from '@/lib/invites-remote';

const TRIP = 'trip-abc';
const TOKEN = '0f8b6c2e-1d3a-4b5c-8d7e-9f0a1b2c3d4e';

beforeEach(() => {
  window.localStorage.clear();
  Object.assign(fake, { reads: 0, readError: undefined, commitError: undefined, trip: undefined });
  fake.invites.length = 0;
  fake.sets.length = 0;
  fake.deletes.length = 0;
  fake.batches.length = 0;
});

describe('createInvite', () => {
  it('writes {createdBy, createdAt} under a lowercase uuid and returns the ?trip=&invite= link', async () => {
    const link = await createInvite(TRIP);
    expect(fake.sets).toHaveLength(1);
    const token = fake.sets[0].path.split('/').pop()!;
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(fake.sets[0]).toEqual({ path: `trips/${TRIP}/invites/${token}`, data: { createdBy: 'me', createdAt: TS } });
    expect(link).toBe(`${window.location.origin}/?trip=${TRIP}&invite=${token}`);
  });
});

describe('listInvites / revokeInvite', () => {
  it('lists only unused, unexpired invites and revoke deletes the doc', async () => {
    const now = Date.now();
    const at = (ms: number) => ({ toMillis: () => ms });
    fake.invites.push(
      { id: TOKEN, data: { createdAt: at(now - 1000) } },
      { id: '1f8b6c2e-1d3a-4b5c-8d7e-9f0a1b2c3d4e', data: { createdAt: at(now - INVITE_TTL_MS - 1) } },
      { id: '2f8b6c2e-1d3a-4b5c-8d7e-9f0a1b2c3d4e', data: { createdAt: at(now), redeemedBy: 'x' } },
    );
    expect(await listInvites(TRIP)).toEqual([
      { token: TOKEN, createdAt: now - 1000, expiresAt: now - 1000 + INVITE_TTL_MS },
    ]);
    expect(await revokeInvite(TRIP, TOKEN)).toBe(true);
    expect(fake.deletes).toEqual([`trips/${TRIP}/invites/${TOKEN}`]);
  });
});

describe('redeemInvite', () => {
  it('refused read ⇒ one batch with exactly the C5 field paths ⇒ joined', async () => {
    fake.readError = { code: 'permission-denied' };
    expect(await redeemInvite(TRIP, TOKEN)).toBe('joined');
    expect(fake.batches).toEqual([
      [
        { path: `trips/${TRIP}/invites/${TOKEN}`, data: { redeemedBy: 'me', redeemedAt: TS } },
        { path: `trips/${TRIP}`, data: { 'members.me': 'member', joinInvite: TOKEN } },
      ],
    ]);
  });

  it('readable and rostered ⇒ already, no write', async () => {
    fake.trip = { members: { me: 'member', o: 'owner' } };
    expect(await redeemInvite(TRIP, TOKEN)).toBe('already');
    expect(fake.batches).toHaveLength(0);
  });

  it.each([['permission-denied'], ['not-found']])('commit %s ⇒ invalid', async (code) => {
    fake.readError = { code: 'permission-denied' };
    fake.commitError = { code };
    expect(await redeemInvite(TRIP, TOKEN)).toBe('invalid');
  });

  it('transport failure ⇒ failed', async () => {
    fake.readError = { code: 'unavailable' };
    expect(await redeemInvite(TRIP, TOKEN)).toBe('failed');
    expect(fake.batches).toHaveLength(0);
  });

  it.each([['NOT-A-UUID'], [TOKEN.toUpperCase()], [`${TOKEN}x`], ['']])(
    'bad token %s ⇒ invalid before any network',
    async (bad) => {
      expect(await redeemInvite(TRIP, bad)).toBe('invalid');
      expect(await revokeInvite(TRIP, bad)).toBe(false);
      expect(fake.reads).toBe(0);
      expect(fake.deletes).toHaveLength(0);
    },
  );

  it('bad trip id ⇒ invalid before any network', async () => {
    expect(await redeemInvite('A/B', TOKEN)).toBe('invalid');
    expect(fake.reads).toBe(0);
  });
});
