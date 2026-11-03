// @vitest-environment jsdom
//
// #973: every *-remote writer, driven through a recording Firestore, must produce exactly the docs
// committed in __fixtures__/rules-write-shapes.json. scripts/rules-check.mjs replays that same file
// against the real rules engine, so a writer that grows or renames a field fails one side or the
// other. Regenerate after a deliberate shape change with:
//   npx vitest run lib/__tests__/rules-write-shapes.test.ts -u
// and run the emulator check before committing the new fixture.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const ID = vi.hoisted(() => ({
  TRIP: 'f973f973-0000-4000-8000-000000000001',
  NEW_TRIP: 'f973f973-0000-4000-8000-000000000002',
  ACCT: 'f973f973-0000-4000-8000-000000000003',
  INVITE: 'f973f973-0000-4000-8000-000000000004',
  UID: 'uid-f973-writer',
  OTHER: 'uid-f973-other',
}));

type Data = Record<string, unknown>;
type Write = { op: string; path: string; data?: Data; merge?: true; writes?: Write[] };

const cap = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  const log: Write[] = [];
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  // The real SDK throws on undefined; a JSON clone would hide it, so check first.
  const noUndefined = (v: unknown, at: string): void => {
    if (v === undefined) throw new Error(`undefined field value at ${at}`);
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) noUndefined(x, `${at}.${k}`);
  };
  const setPath = (data: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> => {
    const [head, ...rest] = path.split('.');
    if (!rest.length) return { ...data, [head]: value };
    return { ...data, [head]: setPath((data[head] as Record<string, unknown>) ?? {}, rest.join('.'), value) };
  };
  const apply = (w: Write) => {
    if (w.op.endsWith('set')) store.set(w.path, w.merge ? { ...store.get(w.path), ...w.data } : clone(w.data!));
    else {
      const cur = store.get(w.path);
      if (!cur) throw Object.assign(new Error(`no document to update: ${w.path}`), { code: 'not-found' });
      let next = cur;
      for (const [k, v] of Object.entries(w.data!)) next = setPath(next, k, clone(v));
      store.set(w.path, next);
    }
  };
  const entry = (op: string, ref: { path: string }, data: Record<string, unknown>, merge?: boolean): Write => {
    noUndefined(data, ref.path);
    return { op, path: ref.path, data: clone(data), ...(merge ? { merge: true as const } : {}) };
  };
  const snap = (path: string) => {
    const d = store.get(path);
    return { exists: () => !!d, data: () => (d ? clone(d) : undefined), metadata: { hasPendingWrites: false } };
  };
  const record = (w: Write) => {
    apply(w);
    log.push(w);
  };
  const fs = {
    doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
    serverTimestamp: () => ({ $sentinel: 'serverTimestamp' }),
    deleteField: () => ({ $sentinel: 'deleteField' }),
    getDoc: async (ref: { path: string }) => snap(ref.path),
    getDocFromServer: async (ref: { path: string }) => snap(ref.path),
    setDoc: async (ref: { path: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) =>
      record(entry('set', ref, data, opts?.merge)),
    updateDoc: async (ref: { path: string }, data: Record<string, unknown>) => record(entry('update', ref, data)),
    deleteDoc: async () => {},
    runTransaction: async <T,>(_db: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const tx = {
        get: async (ref: { path: string }) => snap(ref.path),
        set: (ref: { path: string }, data: Record<string, unknown>) => record(entry('tx.set', ref, data)),
        update: (ref: { path: string }, data: Record<string, unknown>) => record(entry('tx.update', ref, data)),
      };
      return fn(tx);
    },
    writeBatch: () => {
      const writes: Write[] = [];
      return {
        set: (ref: { path: string }, data: Record<string, unknown>) => writes.push(entry('set', ref, data)),
        update: (ref: { path: string }, data: Record<string, unknown>) => writes.push(entry('update', ref, data)),
        commit: async () => {
          writes.forEach(apply);
          log.push({ op: 'batch', path: '', writes });
        },
      };
    },
  };
  return { store, log, fs };
});

vi.mock('@/lib/firebase-config', async (orig) => ({
  ...(await orig<typeof import('@/lib/firebase-config')>()),
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => ID.TRIP,
}));
vi.mock('@/lib/firebase-remote', async (orig) => {
  const handle = () => Promise.resolve({ db: {}, fs: cap.fs, uid: ID.UID, auth: {} });
  return {
    ...(await orig<typeof import('@/lib/firebase-remote')>()),
    getRemote: handle,
    getSharedRemote: handle,
    getAccountRemote: handle,
    getAuthHandle: handle,
  };
});
vi.mock('@/lib/token-auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/token-auth')>()),
  getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }),
}));

import type { Firestore } from 'firebase/firestore';
import type { FirestoreMod } from '@/lib/firebase-remote';
import { STORAGE_KEYS, setActiveTripId, setSyncCode } from '@/core/storage/gateway';
import { SAMPLE_ITINERARY } from '@/lib/sample-itinerary';
import { addItem } from '@/core/itinerary/crud';
import { stampCreated } from '@/lib/attribution';
import { firstSyncStamp, nextSyncStamp, stampSyncCreated } from '@/core/sync/stamp';
import { addExpense } from '@/core/budget/expenses';
import { DEFAULT_BUDGET } from '@/core/budget/model';
import { stampBudgetChanges } from '@/core/budget/flatten';
import { DEFAULT_TEMPLATE, toggleItem } from '@/core/docs/model';
import { addPlace } from '@/core/places/model';
import { getKnownTrip, removeKnownTrip, setTripConfig, upsertKnownTrip } from '@/core/trips/registry';
import { loadJournal, saveJournal } from '@/core/journal/storage';
import { removeEntry, upsertEntry } from '@/core/journal/model';
import { pushDayMerged } from '@/lib/itinerary-remote';
import { pushChunkMerged } from '@/lib/expenses-remote';
import { pushBudgetMerged } from '@/lib/budget-remote';
import { pushChecklistMerged } from '@/lib/docs-remote';
import { pushPlacesMerged } from '@/lib/places-remote';
import {
  addTripMember,
  createTripDoc,
  healAccountIdentity,
  pushAccountIdentity,
  pushTripList,
  pushTripMeta,
} from '@/lib/trips-remote';
import { createInvite, redeemInvite } from '@/lib/invites-remote';
import { setPref, unionPref } from '@/lib/account-prefs-remote';
import { pushJournalEntry } from '@/lib/journal-remote';
import { startPresence, stopPresence } from '@/lib/presence';

// Who rules-check.mjs replays a group as: a member of a gated trip, the owner of it, a non-member
// holding an invite, a device creating a new trip, or any signed-in device on its account path.
type Actor = 'member' | 'owner' | 'joiner' | 'creator' | 'account';
type Group = { name: string; as: Actor; writes: Write[] };

const NOW = Date.UTC(2026, 11, 9, 3, 0, 0);
const db = {} as Firestore;
const fs = cap.fs as unknown as FirestoreMod;
const settle = () => new Promise((r) => setTimeout(r, 0));

async function capture(groups: Group[], name: string, as: Actor, run: () => Promise<unknown>) {
  cap.store.clear();
  cap.log.length = 0;
  await run();
  await settle();
  // Most writers swallow their own errors, so an empty log means the writer never reached the SDK.
  expect(cap.log.length, `${name} wrote nothing`).toBeGreaterThan(0);
  groups.push({ name, as, writes: cap.log.splice(0) });
}

describe('#973: the docs each remote writer sends match the fixture rules-check replays', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.deviceId, 'dev-f973');
    setActiveTripId(ID.TRIP);
    setSyncCode(ID.ACCT);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(ID.INVITE as `${string}-${string}-${string}-${string}-${string}`);
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('matches __fixtures__/rules-write-shapes.json', async () => {
    const groups: Group[] = [];
    const now = Date.now();
    const iso = new Date(now).toISOString();

    // Trip content, written by a member of the trip.
    const day = SAMPLE_ITINERARY[0];
    const [withItem] = addItem([day], day.date, { id: 'item-f973', title: 'Pashupatinath', category: 'sightseeing', time: '09:30' }, (i) =>
      stampSyncCreated(stampCreated(i, () => 'Powan', iso), now, 'Powan'),
    );
    await capture(groups, 'days/{date} (pushDayMerged)', 'member', () => pushDayMerged(db, fs, withItem, ID.TRIP));

    const expenses = addExpense([], { leg: 'nepal', category: 'food', amount: 1200, date: day.date, note: 'Dal bhat' }, 'exp-f973', iso,
      (e) => ({ ...e, createdBy: 'Powan', updatedBy: 'Powan', ...firstSyncStamp(now, 'Powan') }));
    await capture(groups, 'expenses/{leg} (pushChunkMerged)', 'member', () => pushChunkMerged(db, fs, 'nepal', expenses, [], ID.TRIP));

    const budget = stampBudgetChanges(DEFAULT_BUDGET, { ...DEFAULT_BUDGET, homeCurrency: 'JPY', legBudgets: { ...DEFAULT_BUDGET.legBudgets, nepal: 150000 } }, now, 'Powan');
    await capture(groups, 'budget/model (pushBudgetMerged)', 'member', () => pushBudgetMerged(db, fs, budget, ID.TRIP));

    const checklist = toggleItem(DEFAULT_TEMPLATE, DEFAULT_TEMPLATE[0].id, (it) => ({ ...it, updatedBy: 'Powan', ...nextSyncStamp(it, now, 'Powan') }));
    await capture(groups, 'docs/checklist (pushChecklistMerged)', 'member', () => pushChecklistMerged(db, fs, checklist, ID.TRIP));

    const places = addPlace([], { id: 'place-f973', name: 'Boudhanath Stupa', legId: 'nepal', addedAt: iso, lat: 27.7215, lng: 85.362, ...firstSyncStamp(now, 'Powan') });
    await capture(groups, 'places/list (pushPlacesMerged)', 'member', () => pushPlacesMerged(db, fs, places, ID.TRIP));

    upsertKnownTrip(ID.TRIP, 'Nepal x Japan');
    setTripConfig(ID.TRIP, { start: '2026-12-09', end: '2027-01-09', destinations: ['Kathmandu', 'Tokyo'], vibe: 'city', currency: 'NPR', updatedAt: now });
    const known = getKnownTrip(ID.TRIP)!;
    await capture(groups, 'meta/info with config (pushTripMeta)', 'member',
      () => pushTripMeta(ID.TRIP, { name: known.name, config: known.config, updatedAt: known.updatedAt }));
    await capture(groups, 'meta/info rename, merge (pushTripMeta)', 'member',
      () => pushTripMeta(ID.TRIP, { name: 'Nepal + Japan', updatedAt: now }));

    await capture(groups, 'presence/{deviceId} heartbeat (startPresence)', 'member', async () => {
      startPresence();
      await settle();
      stopPresence();
    });
    await capture(groups, 'trip doc: member adds a member (addTripMember)', 'member', async () => {
      cap.store.set(`trips/${ID.TRIP}`, { schemaVersion: 1 });
      await addTripMember(ID.TRIP, ID.OTHER);
    });

    // The trip doc and invites.
    await capture(groups, 'trip doc create (createTripDoc)', 'creator', () => createTripDoc(ID.NEW_TRIP));
    await capture(groups, 'invites/{token} mint (createInvite)', 'owner', () => createInvite(ID.TRIP));
    await capture(groups, 'invite redeem batch (redeemInvite)', 'joiner', async () => {
      cap.store.set(`trips/${ID.TRIP}/invites/${ID.INVITE}`, { createdBy: 'someone' });
      cap.store.set(`trips/${ID.TRIP}`, { schemaVersion: 1, members: { someone: 'owner' } });
      expect(await redeemInvite(ID.TRIP, ID.INVITE)).toBe('joined');
    });

    // Account docs under trips/{syncCode}/profile/.
    await capture(groups, 'profile/identity (pushAccountIdentity)', 'account', () => pushAccountIdentity(ID.ACCT, 'Powan'));
    await capture(groups, 'profile/identity heal (healAccountIdentity)', 'account', () => healAccountIdentity(ID.ACCT, 'Powan'));
    upsertKnownTrip('f973f973-0000-4000-8000-0000000000aa', 'Old trip');
    removeKnownTrip('f973f973-0000-4000-8000-0000000000aa');
    await capture(groups, 'profile/tripList (pushTripList)', 'account', () => pushTripList(ID.ACCT));
    await capture(groups, 'profile/prefs set, update, union (account-prefs-remote)', 'account', async () => {
      await setPref('homeCurrency', 'JPY');
      await setPref('homeCurrency', 'USD');
      await unionPref('priorNames', ['Powan']);
    });
    await capture(groups, 'profile/journal_{tripId} create, edit, delete (pushJournalEntry)', 'account', async () => {
      saveJournal(upsertEntry(loadJournal(), day.date, { text: 'Landed in Kathmandu.', mood: 'great', highlight: 'Pashupati' }, iso));
      await pushJournalEntry(day.date);
      saveJournal(upsertEntry(loadJournal(), day.date, { text: 'Landed in Kathmandu. Ate momo.' }, iso));
      await pushJournalEntry(day.date);
      saveJournal(removeEntry(loadJournal(), day.date));
      await pushJournalEntry(day.date);
    });

    let text = JSON.stringify(groups, null, 2) + '\n';
    for (const [k, v] of Object.entries(ID)) text = text.split(v).join(`$${k}`);
    await expect(text).toMatchFileSnapshot('./__fixtures__/rules-write-shapes.json');
  });
});
