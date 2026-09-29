// @vitest-environment jsdom
//
// Sync has no per-device off switch. An anonymous session is turned away from the shared trip's
// content in getSharedRemote() with a non-permission error, so the outbox keeps the edit queued and
// the badge asks for a sign-in. Everything else an anonymous session does (redeem an invite, read
// trip meta) still goes through getRemote() untouched. A stored key 47 (the retired switch) changes
// nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({ currentUser: null as null | { uid: string; email?: string } }));
const gate = vi.hoisted(() => ({ tripId: '' }));
const reads = vi.hoisted(() => ({ paths: [] as string[] }));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const strip = (p: any) => {
    const { initial, animate, exit, transition, ...rest } = p;
    return rest;
  };
  return { m: { div: (props: any) => React.createElement('div', strip(props)) } };
});
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => gate.tripId,
}));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan' }) };
});
vi.mock('@/hooks/use-presence', () => ({ usePresence: () => [] }));
vi.mock('firebase/app', () => ({
  initializeApp: () => ({}),
  getApps: () => [],
  getApp: () => ({}),
}));
vi.mock('firebase/firestore', () => ({
  initializeFirestore: () => ({}),
  persistentLocalCache: () => ({}),
  serverTimestamp: () => 'TS',
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  getDoc: async (ref: { path: string }) => {
    reads.paths.push(ref.path);
    return { exists: () => false, data: () => undefined };
  },
  getDocFromServer: async (ref: { path: string }) => {
    reads.paths.push(ref.path);
    return { exists: () => false, data: () => undefined };
  },
  writeBatch: () => ({ update: () => {}, commit: async () => {} }),
}));
vi.mock('firebase/auth', () => ({
  getAuth: () => auth,
  onAuthStateChanged: (_a: unknown, cb: (u: unknown) => void) => {
    queueMicrotask(() => cb(auth.currentUser));
    return () => {};
  },
  signInAnonymously: async () => ({ user: auth.currentUser }),
}));

import { getRemote, getSharedRemote, SignInRequiredError } from '@/lib/firebase-remote';
import { SHARED_TRIP_ID } from '@/lib/shared-trip';
import { redeemInvite } from '@/lib/invites-remote';
import { fetchTripMeta } from '@/lib/trips-remote';
import { withOutbox, flushOutbox, outboxDirty, outboxBlocked, type ChunkSync } from '@/core/sync/outbox';
import { setSignInRequired } from '@/core/sync/read-denied';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import SyncStatusBadge from '@/components/sync-status-badge';

const ANON = { uid: 'anon-uid' };
const SIGNED_IN = { uid: 'acct-uid', email: 'powan@accounts.trip-planner.invalid' };

type State = Record<string, number>;
const pushed: string[] = [];
const cs: ChunkSync<State> = {
  domain: 'itinerary',
  chunkDiff: (prev, next) =>
    [...new Set([...Object.keys(prev), ...Object.keys(next)])].filter((k) => prev[k] !== next[k]),
  async pushChunk(chunk) {
    await getSharedRemote();
    pushed.push(chunk);
  },
};

let root: Root | null = null;
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(el);
  });
  return container;
}

beforeEach(() => {
  localStorage.clear();
  pushed.length = 0;
  auth.currentUser = SIGNED_IN;
  gate.tripId = SHARED_TRIP_ID;
  reads.paths.length = 0;
  setSignInRequired(false);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('sync is always on', () => {
  it('a stored pause flag is ignored', async () => {
    // The retired key is set on purpose: old devices may still carry it.
    localStorage.setItem(STORAGE_KEYS.syncPaused, 'true');
    await expect(getSharedRemote()).resolves.toMatchObject({ uid: 'acct-uid' });
  });

  it('getSharedRemote rejects an anonymous session on the shared trip with a non-permission error', async () => {
    auth.currentUser = ANON;
    const err = await getSharedRemote().catch((e) => e);
    expect(err).toBeInstanceOf(SignInRequiredError);
    expect(err.code).not.toBe('permission-denied');
  });

  it('an anonymous session can still use getRemote, redeemInvite and fetchTripMeta on the default pack', async () => {
    auth.currentUser = ANON;
    await expect(getRemote()).resolves.toHaveProperty('db');
    await expect(redeemInvite('some-trip', '0f8b6c2e-1d3a-4b5c-8d7e-9f0a1b2c3d4e')).resolves.toBe('joined');
    await expect(fetchTripMeta('some-trip')).resolves.toBeUndefined();
    expect(reads.paths).toContain('trips/some-trip/meta/info');
    expect(reads.paths).toContain('trips/some-trip');
  });

  it('anonymous is fine on a trip that is not the shared one', async () => {
    auth.currentUser = ANON;
    gate.tripId = 'some-other-trip';
    await expect(getSharedRemote()).resolves.toHaveProperty('db');
  });

  it('an anonymous edit stays queued and unrefused, then flushes once signed in', async () => {
    auth.currentUser = ANON;
    await withOutbox(cs)({}, { '2026-12-01': 1 });
    expect(pushed).toEqual([]);
    expect(outboxDirty('itinerary')).toEqual(['2026-12-01']);
    expect(outboxBlocked()).toBe(0);

    auth.currentUser = SIGNED_IN;
    await flushOutbox(cs, { load: () => ({ '2026-12-01': 1 }), save: () => {}, has: () => true });
    expect(pushed).toEqual(['2026-12-01']);
    expect(outboxDirty('itinerary')).toEqual([]);
  });

  it('badge asks for a sign-in while the session is anonymous, even with queued edits', async () => {
    auth.currentUser = ANON;
    await withOutbox(cs)({}, { '2026-12-02': 1 });
    await getSharedRemote().catch(() => {});
    const c = await mount(<SyncStatusBadge />);
    const badge = c.querySelector('[data-testid="sync-status-badge"]')!;
    expect(badge.getAttribute('data-state')).toBe('sign-in-required');
    expect(c.querySelector('[data-testid="sync-status-text"]')!.textContent).toBe('Sign in to sync');
  });
});
