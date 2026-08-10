// @vitest-environment jsdom
//
// #10 — the opt-in member lock, against a FAKE Firestore + a fake anonymous session. Covers the
// three seams that share the `permission-denied` contract:
//
//   1. `createTripDoc` mints `members: { <uid>: 'owner' }` on the trip doc (the ONLY moment the
//      rules accept a members map being created).
//   2. `ensureMembership`'s four branches — absent doc, already enrolled, grandfathered
//      members-less trip (first enroller takes `owner`), and a refusal (⇒ `trip:access-pending`,
//      never a throw) — plus the FIELD-PATH shape of its write, which is what the rules' add-only
//      diff requires (a whole-document overwrite is refused for a non-owner).
//   3. The presence heartbeat STOPS on a refusal instead of retrying every 60s forever.
//
// ⚠ Assertions count writes and reads, not only outcomes: every function here swallows failure to
// a console.warn, so "nothing bad happened" is indistinguishable from "the mock was bypassed"
// without a count (the S378 rigour).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const gate = vi.hoisted(() => ({ on: true, tripId: 'trip-abc' }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => gate.on,
  isTripRemoteConfigured: () => gate.on && gate.tripId !== '',
  getTripId: () => gate.tripId,
}));

const UID = 'device-uid-fake';

vi.mock('firebase/app', () => ({
  initializeApp: () => ({ name: 'fake' }),
  getApps: () => [],
  getApp: () => ({ name: 'fake' }),
}));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'device-uid-fake', getIdToken: async () => 'tok' } }),
  onAuthStateChanged: (_auth: unknown, next: (u: unknown) => void) => {
    queueMicrotask(() => next({ uid: 'device-uid-fake' }));
    return () => {};
  },
  signInAnonymously: async () => ({ user: { uid: 'device-uid-fake' } }),
}));

type DocData = Record<string, unknown>;
interface WriteEntry {
  op: 'set' | 'update' | 'delete';
  path: string;
  data: DocData;
}
const fake = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  /** Paths whose read AND write are refused by the (fake) rules. */
  denied: new Set<string>(),
  writes: [] as { op: 'set' | 'update' | 'delete'; path: string; data: Record<string, unknown> }[],
  serverReads: 0,
}));

/** The exact rejection Firestore raises when the rules refuse an operation. */
function permissionDenied(): Error {
  return Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
  });
}

vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({ __type: 'db' }),
  doc: (_db: unknown, ...segs: string[]) => ({ __type: 'doc', path: segs.join('/') }),
  serverTimestamp: () => '<server-timestamp>',
  setDoc: async (ref: { path: string }, data: DocData) => {
    if (fake.denied.has(ref.path)) throw permissionDenied();
    fake.writes.push({ op: 'set', path: ref.path, data });
    fake.docs.set(ref.path, data);
  },
  updateDoc: async (ref: { path: string }, data: DocData) => {
    if (fake.denied.has(ref.path)) throw permissionDenied();
    fake.writes.push({ op: 'update', path: ref.path, data });
  },
  deleteDoc: async (ref: { path: string }) => {
    if (fake.denied.has(ref.path)) throw permissionDenied();
    fake.writes.push({ op: 'delete', path: ref.path, data: {} });
  },
  getDocFromServer: async (ref: { path: string }) => {
    fake.serverReads += 1;
    if (fake.denied.has(ref.path)) throw permissionDenied();
    const data = fake.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  },
}));

import {
  createTripDoc,
  ensureMembership,
  TRIP_ACCESS_PENDING_EVENT,
} from '@/lib/trips-remote';
import { startPresence, stopPresence, HEARTBEAT_MS } from '@/lib/presence';
import { signIn } from '@/lib/token-auth';
import { deviceStore } from '@/core/storage/gateway';

const TRIP = 'trip-abc';
const TRIP_PATH = `trips/${TRIP}`;

function writesTo(path: string): WriteEntry[] {
  return fake.writes.filter((w) => w.path === path);
}

beforeEach(() => {
  fake.docs.clear();
  fake.denied.clear();
  fake.writes.length = 0;
  fake.serverReads = 0;
  gate.on = true;
  gate.tripId = TRIP;
  window.localStorage.clear();
});

describe('createTripDoc — the members map is minted on the create (#10)', () => {
  it('writes the trip doc naming THIS device owner', async () => {
    await createTripDoc(TRIP);
    const writes = writesTo(TRIP_PATH);
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe('set');
    expect(writes[0].data.members).toEqual({ [UID]: 'owner' });
    expect(writes[0].data.schemaVersion).toBe(1);
    expect(writes[0].data.seededFrom).toBe('create');
  });

  it('no-ops with NO firebase call when remote is unconfigured', async () => {
    gate.on = false;
    await createTripDoc(TRIP);
    expect(fake.writes).toHaveLength(0);
  });

  it('never rejects when the write is refused (the create degrades to local-only)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.denied.add(TRIP_PATH);
    await expect(createTripDoc(TRIP)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('ensureMembership — four branches, one read (#10)', () => {
  it('ABSENT trip doc ⇒ returns after the read, writes nothing', async () => {
    await ensureMembership(TRIP);
    expect(fake.serverReads).toBe(1); // the read ran — this is a measurement, not a bypassed mock
    expect(fake.writes).toHaveLength(0);
  });

  it('ALREADY ENROLLED ⇒ no write at all (the common case on every load after the first)', async () => {
    fake.docs.set(TRIP_PATH, { schemaVersion: 1, members: { [UID]: 'member', other: 'owner' } });
    await ensureMembership(TRIP);
    expect(fake.serverReads).toBe(1);
    expect(fake.writes).toHaveLength(0);
  });

  it('MEMBERS-LESS legacy trip ⇒ the first enroller takes owner, via a FIELD PATH', async () => {
    fake.docs.set(TRIP_PATH, { schemaVersion: 1, createdAt: 1, seededFrom: 'sample' });
    await ensureMembership(TRIP);
    const writes = writesTo(TRIP_PATH);
    expect(writes).toHaveLength(1);
    // FIELD PATH, not a whole-document overwrite: the rules refuse any non-owner edit that touches
    // a key other than `members`, so the write must name `members.<uid>` and nothing else.
    expect(writes[0].op).toBe('update');
    expect(writes[0].data).toEqual({ [`members.${UID}`]: 'owner' });
  });

  it('members map present without this uid ⇒ enrols as member (belt to the rules braces)', async () => {
    // On a real server this branch is unreachable — the rules refuse the READ first (see the
    // refusal test below). It is pinned because the client must never assume itself an owner.
    fake.docs.set(TRIP_PATH, { schemaVersion: 1, members: { someone: 'owner' } });
    await ensureMembership(TRIP);
    expect(writesTo(TRIP_PATH)[0].data).toEqual({ [`members.${UID}`]: 'member' });
  });

  it('REFUSED ⇒ dispatches trip:access-pending, writes nothing, never throws', async () => {
    fake.denied.add(TRIP_PATH);
    const seen: Event[] = [];
    const onPending = (e: Event) => seen.push(e);
    window.addEventListener(TRIP_ACCESS_PENDING_EVENT, onPending);

    await expect(ensureMembership(TRIP)).resolves.toBeUndefined();

    window.removeEventListener(TRIP_ACCESS_PENDING_EVENT, onPending);
    expect(seen).toHaveLength(1);
    expect(fake.writes).toHaveLength(0);
  });

  it('a MALFORMED members field degrades to "members-less", it does not lock the user out', async () => {
    const seen: Event[] = [];
    const onPending = (e: Event) => seen.push(e);
    window.addEventListener(TRIP_ACCESS_PENDING_EVENT, onPending);

    fake.docs.set(TRIP_PATH, { schemaVersion: 1, members: 'not-a-map' });
    await ensureMembership(TRIP);

    window.removeEventListener(TRIP_ACCESS_PENDING_EVENT, onPending);
    expect(seen).toHaveLength(0); // junk in the doc is never read as "you have no access"
    expect(writesTo(TRIP_PATH)[0].data).toEqual({ [`members.${UID}`]: 'owner' });
  });

  it('no-ops with NO read when the trip is not remote (the local-only sample)', async () => {
    gate.tripId = '';
    await ensureMembership('');
    expect(fake.serverReads).toBe(0);
  });
});

describe('the access-pending event name is pinned to the provider literal (#10)', () => {
  it("is exactly 'trip:access-pending'", () => {
    // components/itinerary-provider.tsx listens by literal (importing this module would pull
    // firebase onto the provider's static chunk). This assertion is the anti-drift mechanism.
    expect(TRIP_ACCESS_PENDING_EVENT).toBe('trip:access-pending');
  });
});

describe('presence heartbeat STOPS on a refusal instead of retrying forever (#10)', () => {
  afterEach(() => {
    stopPresence();
    vi.useRealTimers();
  });

  it('one denied beat tears the loop down and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    signIn('Powan');
    const presencePath = `trips/${TRIP}/presence/${deviceStore.getId()}`;
    fake.denied.add(presencePath);
    vi.useFakeTimers();

    startPresence();
    await vi.advanceTimersByTimeAsync(0); // the immediate first beat resolves (and is refused)

    // Three full cadences later: the interval is gone, so nothing was attempted again.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
    expect(fake.writes.filter((w) => w.path === presencePath)).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('not a member');
    warn.mockRestore();
  });

  it('an allowed beat keeps the loop running (the stop is specific to a refusal)', async () => {
    signIn('Powan');
    const presencePath = `trips/${TRIP}/presence/${deviceStore.getId()}`;
    vi.useFakeTimers();

    startPresence();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.writes.filter((w) => w.path === presencePath)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(fake.writes.filter((w) => w.path === presencePath).length).toBeGreaterThan(1);
  });
});
