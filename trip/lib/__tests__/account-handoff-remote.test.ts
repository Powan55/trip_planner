// D-660: a password sign-in grants the account uid this device's trip roles BEFORE the session swaps.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const log: string[] = [];
  const failWrites = new Set<string>();
  const failReads = new Set<string>();
  const fs = {
    doc: (_db: unknown, ...segs: string[]) => segs.join('/'),
    getDocFromServer: async (path: string) => {
      if (failReads.has(path)) throw Object.assign(new Error('offline'), { code: 'unavailable' });
      if (!docs.has(path)) {
        if (path.startsWith('trips/denied')) throw Object.assign(new Error('x'), { code: 'permission-denied' });
        return { exists: () => false, data: () => undefined };
      }
      return { exists: () => true, data: () => docs.get(path) };
    },
    updateDoc: async (path: string, patch: Record<string, unknown>) => {
      if (failWrites.has(path)) throw Object.assign(new Error('x'), { code: 'permission-denied' });
      log.push(`grant ${path} ${JSON.stringify(patch)}`);
    },
    getFirestore: () => ({}),
  };
  const memory = { type: 'NONE' };
  return { docs, log, failWrites, failReads, fs, memory, persistence: null as unknown, secondaryUid: 'uid-A', deleted: 0 };
});

vi.mock('firebase/firestore', () => fake.fs);
vi.mock('firebase/app', () => ({
  initializeApp: () => ({}),
  deleteApp: async () => void fake.deleted++,
}));
vi.mock('firebase/auth', () => ({
  inMemoryPersistence: fake.memory,
  initializeAuth: (_app: unknown, deps: { persistence: unknown }) => {
    fake.persistence = deps.persistence;
    return {};
  },
  signInWithEmailAndPassword: async (_a: unknown, _e: string, pw: string) => {
    if (pw !== 'right-pass') throw Object.assign(new Error('x'), { code: 'auth/invalid-credential' });
    fake.log.push('secondary signin');
    return { user: { uid: fake.secondaryUid } };
  },
  signOut: async () => {},
}));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: {},
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
}));
vi.mock('@/lib/firebase-remote', () => ({
  isPermissionDenied: (err: unknown) => (err as { code?: unknown })?.code === 'permission-denied',
  withTimeout: <T,>(work: Promise<T>) => work,
  getAuthHandle: async () => ({
    db: {},
    fs: fake.fs,
    auth: { currentUser: { uid: 'uid-B', isAnonymous: true } },
    uid: 'uid-B',
  }),
  readAccountLink: async (uid: string) =>
    uid === 'uid-A' ? { username: 'powan', accountId: 'acct-1' } : null,
  signInWithPassword: async () => (fake.log.push('swap'), 'uid-A'),
}));
vi.mock('@/core/trips/registry', () => ({
  listKnownTrips: () => [{ id: 'nepal-japan-2026' }, { id: 'known-owner' }, { id: 'known-member' }, { id: 'denied-1' }],
}));

import { signInWithHandoff } from '@/lib/account-handoff-remote';

beforeEach(() => {
  fake.docs.clear();
  fake.log.length = 0;
  fake.failWrites.clear();
  fake.failReads.clear();
  fake.persistence = null;
  fake.deleted = 0;
  fake.docs.set('trips/known-owner', { members: { 'uid-B': 'owner' } });
  fake.docs.set('trips/known-member', { members: { 'uid-X': 'owner', 'uid-B': 'member' } });
  fake.docs.set('trips/listed', { members: { 'uid-X': 'owner', 'uid-B': 'member' } });
  fake.docs.set('trips/already', { members: { 'uid-B': 'owner', 'uid-A': 'owner' } });
  fake.docs.set('trips/not-mine', { members: { 'uid-X': 'owner' } });
  fake.docs.set('trips/acct-1/profile/tripList', {
    trips: [{ id: 'listed' }, { id: 'already' }, { id: 'not-mine' }, { id: 'known-owner' }],
  });
});

describe('signInWithHandoff', () => {
  it('grants A the role B holds on known and listed trips, then swaps the session', async () => {
    const out = await signInWithHandoff('powan@accounts.trip-planner.invalid', 'right-pass');
    expect(out).toEqual({ uid: 'uid-A', link: { username: 'powan', accountId: 'acct-1' } });
    expect(fake.log[0]).toBe('secondary signin');
    expect(fake.log.at(-1)).toBe('swap');
    expect(fake.log.slice(1, -1).sort()).toEqual([
      'grant trips/known-member {"members.uid-A":"member"}',
      'grant trips/known-owner {"members.uid-A":"owner"}',
      'grant trips/listed {"members.uid-A":"member"}',
    ]);
    expect(fake.deleted).toBe(1);
    expect(fake.persistence).toBe(fake.memory);
  });

  it('a roster read that fails for any reason but a refusal aborts before the swap', async () => {
    fake.failReads.add('trips/known-owner');
    await expect(signInWithHandoff('p@x.invalid', 'right-pass')).rejects.toMatchObject({
      code: 'handoff/owner-grant-failed',
    });
    expect(fake.log).not.toContain('swap');
  });

  it('a failed owner grant aborts before the swap', async () => {
    fake.failWrites.add('trips/known-owner');
    await expect(signInWithHandoff('p@x.invalid', 'right-pass')).rejects.toMatchObject({
      code: 'handoff/owner-grant-failed',
    });
    expect(fake.log).not.toContain('swap');
  });

  it('a failed member grant still signs in', async () => {
    fake.failWrites.add('trips/known-member');
    await signInWithHandoff('p@x.invalid', 'right-pass');
    expect(fake.log.at(-1)).toBe('swap');
  });

  it('wrong credentials grant nothing and swap nothing', async () => {
    await expect(signInWithHandoff('p@x.invalid', 'wrong')).rejects.toMatchObject({
      code: 'auth/invalid-credential',
    });
    expect(fake.log).toEqual([]);
    expect(fake.deleted).toBe(1);
  });
});
