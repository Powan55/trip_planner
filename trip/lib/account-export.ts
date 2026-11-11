'use client';

// One JSON file with everything this account can read: its account docs, every trip it knows, and
// this browser's app storage. Photos stay out (device-local blobs; the trip backup carries them).
// A read that fails is listed under `errors` and the export carries on, so one refused trip never
// costs the rest of the file.

import {
  DEFAULT_TRIP_ID,
  STORAGE_KEYS,
  getDefaultTripShareId,
  getSyncCode,
  isSafeTripSegment,
} from '@/core/storage/gateway';
import { listKnownTrips } from '@/core/trips/registry';
import { isRemoteConfigured } from './firebase-config';
import type { RemoteHandle } from './firebase-remote';
import { downloadBlob } from './download-blob';

type Data = Record<string, unknown>;
type Handle = Pick<RemoteHandle, 'db' | 'fs'> & { auth: { currentUser: { uid: string; email: string | null } | null } };

export type AccountExport = {
  format: 'trip-planner-account-export';
  version: 1;
  exportedAt: string;
  account: { uid: string | null; email: string | null; accountId: string | null; link: Data | null };
  profile: Record<string, Data | null>;
  trips: Record<string, Record<string, unknown>>;
  local: Record<string, string>;
  errors: { path: string; code: string }[];
};

// Trip content the app writes (firestore.rules header). presence is a heartbeat, invites are owner-only.
const TRIP_DOCS = ['meta/info', 'budget/model', 'docs/checklist', 'places/list'];
const TRIP_COLLECTIONS = ['days', 'expenses'];

function localAppStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  const known = new Set<string>(Object.values(STORAGE_KEYS));
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // The origin is shared with other sites on the same host, so only this app's keys.
      if (k !== null && (known.has(k) || k.startsWith('trip:'))) out[k] = localStorage.getItem(k) ?? '';
    }
  } catch {
    /* storage disabled */
  }
  return out;
}

function tripIdsFrom(list: Data | null): string[] {
  const ids = new Set<string>();
  for (const t of listKnownTrips()) ids.add(t.id === DEFAULT_TRIP_ID ? getDefaultTripShareId() : t.id);
  const remote = list?.trips;
  if (Array.isArray(remote)) {
    for (const t of remote) if (t && typeof (t as Data).id === 'string') ids.add((t as Data).id as string);
  }
  return [...ids].filter((id) => id !== DEFAULT_TRIP_ID && isSafeTripSegment(id));
}

export async function buildAccountExport(h: Handle, now = new Date()): Promise<AccountExport> {
  const { db, fs } = h;
  const errors: AccountExport['errors'] = [];
  const read = async (...segs: string[]): Promise<Data | null> => {
    try {
      const snap = await fs.getDoc(fs.doc(db, segs[0], ...segs.slice(1)));
      return snap.exists() ? (snap.data() as Data) : null;
    } catch (err) {
      errors.push({ path: segs.join('/'), code: String((err as { code?: unknown }).code ?? 'unknown') });
      return null;
    }
  };
  const readAll = async (...segs: string[]): Promise<Record<string, Data> | null> => {
    try {
      const snap = await fs.getDocs(fs.collection(db, segs[0], ...segs.slice(1)));
      const out: Record<string, Data> = {};
      snap.forEach((d) => {
        out[d.id] = d.data() as Data;
      });
      return out;
    } catch (err) {
      errors.push({ path: segs.join('/'), code: String((err as { code?: unknown }).code ?? 'unknown') });
      return null;
    }
  };

  const user = h.auth.currentUser;
  const link = user && user.email ? await read('users', user.uid) : null;
  const linked = typeof link?.accountId === 'string' ? link.accountId : null;
  const code = linked ?? getSyncCode();
  const accountId = code && isSafeTripSegment(code) ? code : null;

  const profile: AccountExport['profile'] = {};
  if (accountId) {
    for (const id of ['identity', 'tripList', 'prefs']) profile[id] = await read('trips', accountId, 'profile', id);
  }
  const tripIds = tripIdsFrom(profile.tripList ?? null);
  if (accountId) {
    for (const id of tripIds) {
      const journal = await read('trips', accountId, 'profile', `journal_${id}`);
      if (journal) profile[`journal_${id}`] = journal;
    }
  }

  const trips: AccountExport['trips'] = {};
  for (const id of tripIds) {
    const trip: Record<string, unknown> = { trip: await read('trips', id) };
    for (const path of TRIP_DOCS) trip[path] = await read('trips', id, ...path.split('/'));
    for (const col of TRIP_COLLECTIONS) trip[col] = await readAll('trips', id, col);
    trips[id] = trip;
  }

  return {
    format: 'trip-planner-account-export',
    version: 1,
    exportedAt: now.toISOString(),
    account: { uid: user?.uid ?? null, email: user?.email ?? null, accountId, link },
    profile,
    trips,
    local: localAppStorage(),
    errors,
  };
}

/** Build and download the export. Offline or unsynced, the file still carries this browser's data. */
export async function downloadAccountExport(): Promise<AccountExport> {
  let data: AccountExport | null = null;
  if (isRemoteConfigured()) {
    try {
      const { getAuthHandle } = await import('./firebase-remote');
      data = await buildAccountExport(await getAuthHandle());
    } catch {
      /* no handle: fall through to the local-only file */
    }
  }
  data ??= {
    format: 'trip-planner-account-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    account: { uid: null, email: null, accountId: getSyncCode(), link: null },
    profile: {},
    trips: {},
    local: localAppStorage(),
    errors: isRemoteConfigured() ? [{ path: '(server)', code: 'unavailable' }] : [],
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `trip-planner-account-${data.exportedAt.slice(0, 10)}.json`);
  return data;
}
