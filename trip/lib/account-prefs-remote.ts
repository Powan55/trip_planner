// Per-person settings that follow the traveler across their devices (D-594).
//
// SHAPE: ONE doc `trips/{userToken}/profile/prefs` = `{ [field]: { v, hlc } }`. Its own doc, not
// fields on `profile/tripList`: `pushTripList` writes that doc whole, so older clients would erase
// anything added there. Each field is last-write-wins on its own HLC, and every write is a
// transaction that touches only its field, so two devices editing different fields both survive.
//
// The local mirror is gateway key 48 (`personPrefs`), same shape, wiped on sign-out.

'use client';

import { STORAGE_KEYS, getSyncCode, isSafeTripSegment, readJson, writeJson } from '@/core/storage/gateway';
import { compareHlc, hlcSendOrLocal, parse, serialize } from '@/core/sync/hlc';
import { isRemoteConfigured } from './firebase-config';
import { getRemote } from './firebase-remote';
import { realClock } from './trip-now';

export type PrefEntry = { v: unknown; hlc: string };
export type PrefEntries = Record<string, PrefEntry>;

const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function isEntry(x: unknown): x is PrefEntry {
  return typeof x === 'object' && x !== null && 'v' in x && typeof (x as PrefEntry).hlc === 'string';
}

function sanitize(data: unknown): PrefEntries {
  const out: PrefEntries = {};
  if (typeof data !== 'object' || data === null) return out;
  for (const [k, e] of Object.entries(data)) if (FIELD_RE.test(k) && isEntry(e)) out[k] = { v: e.v, hlc: e.hlc };
  return out;
}

function newer(a: PrefEntry | undefined, b: PrefEntry | undefined): PrefEntry | undefined {
  if (!a) return b;
  if (!b) return a;
  return compareHlc(parse(b.hlc), parse(a.hlc)) > 0 ? b : a;
}

function readLocal(): PrefEntries {
  return sanitize(readJson<unknown>('local', STORAGE_KEYS.personPrefs, {}));
}

/**
 * Fold entries into the local mirror, per field, newest HLC wins. `code` is the account the
 * entries came from; if this device has since signed out or switched account, nothing is written.
 */
function mergeIntoLocal(entries: PrefEntries, code: string | null): PrefEntries {
  const merged = readLocal();
  if (code !== null && (getSyncCode()?.trim() ?? '') !== code) return merged;
  for (const [k, e] of Object.entries(entries)) merged[k] = newer(merged[k], e)!;
  writeJson('local', STORAGE_KEYS.personPrefs, merged);
  return merged;
}

function values(entries: PrefEntries): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, e.v]));
}

function accountCode(): string | null {
  const code = getSyncCode()?.trim() ?? '';
  return isRemoteConfigured() && isSafeTripSegment(code) ? code : null;
}

// JSON round-trip strips `undefined`, which Firestore rejects.
function clean(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

/** Synchronous read of the local mirror. May be stale; never use it to decide a mint. */
export function getCachedPrefs(): Record<string, unknown> {
  return values(readLocal());
}

/**
 * One SERVER read of the account's prefs, merged into the local mirror. `null` when dormant,
 * signed out, offline or denied, so a caller can tell "nothing there" from "couldn't look".
 */
export async function getPrefs(): Promise<Record<string, unknown> | null> {
  const code = accountCode();
  if (!code) return null;
  try {
    const { db, fs } = await getRemote();
    const snap = await fs.getDocFromServer(fs.doc(db, 'trips', code, 'profile', 'prefs'));
    return values(mergeIntoLocal(snap.exists() ? sanitize(snap.data()) : {}, code));
  } catch (err) {
    console.warn('[account-prefs] read failed:', err);
    return null;
  }
}

function stampPast(prev: PrefEntry | undefined, value: unknown, actor: string): PrefEntry {
  return {
    v: clean(value),
    hlc: serialize(hlcSendOrLocal(prev ? parse(prev.hlc) : null, realClock.now().getTime(), actor)),
  };
}

/**
 * Set one field: an explicit edit, so it always wins. Mirrors locally first, then in a transaction
 * stamps past the newer of the mirror's and the account's stamp (so a slow clock or an unread
 * account can't lose the edit) and writes only that field. Never rejects.
 */
export async function setPref(field: string, value: unknown): Promise<void> {
  if (!FIELD_RE.test(field)) return;
  const code = accountCode();
  if (!code) return;
  try {
    const { uid: actor } = await getRemote();
    mergeIntoLocal({ [field]: stampPast(readLocal()[field], value, actor) }, code);
    const { db, fs } = await getRemote();
    const ref = fs.doc(db, 'trips', code, 'profile', 'prefs');
    const entry = await fs.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const remote = snap.exists() ? sanitize(snap.data())[field] : undefined;
      const next = stampPast(newer(readLocal()[field], remote), value, actor);
      if (snap.exists()) tx.update(ref, { [field]: next });
      else tx.set(ref, { [field]: next });
      return next;
    });
    mergeIntoLocal({ [field]: entry }, code);
  } catch (err) {
    console.warn('[account-prefs] write failed, kept on this device:', err);
  }
}

/**
 * Create-if-absent: writes `value` only when the account has no value for `field`, and resolves
 * to whichever value the account holds afterwards. `null` on any failure (dormant, offline,
 * denied), so a caller never acts on a guess.
 */
export async function claimField<T>(field: string, value: T): Promise<T | null> {
  const code = accountCode();
  if (!code || !FIELD_RE.test(field)) return null;
  try {
    const { db, fs, uid } = await getRemote();
    const ref = fs.doc(db, 'trips', code, 'profile', 'prefs');
    const won = await fs.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists() ? sanitize(snap.data())[field] : undefined;
      if (existing && existing.v !== null) return existing;
      const entry = stampPast(existing, value, uid);
      if (snap.exists()) tx.update(ref, { [field]: entry });
      else tx.set(ref, { [field]: entry });
      return entry;
    });
    mergeIntoLocal({ [field]: won }, code);
    return won.v as T;
  } catch (err) {
    console.warn('[account-prefs] claim failed:', err);
    return null;
  }
}

/**
 * Grow a string-list field: in one transaction, append whichever of `items` the account lacks
 * (account order first, so nothing already there is ever dropped) and resolve to the union.
 * Per-field last-write-wins would lose one of two concurrent additions; this cannot. Writes
 * nothing when there is nothing new. `max` keeps the doc bounded: past it, new items are refused.
 * `null` on any failure, like `claimField`.
 */
export async function unionPref(field: string, items: readonly string[], max = 50): Promise<string[] | null> {
  const code = accountCode();
  if (!code || !FIELD_RE.test(field)) return null;
  try {
    const { db, fs, uid } = await getRemote();
    const ref = fs.doc(db, 'trips', code, 'profile', 'prefs');
    const { entry, list } = await fs.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists() ? sanitize(snap.data())[field] : undefined;
      const v = existing?.v;
      const have = Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
      const next = [...new Set([...have, ...items])].slice(0, Math.max(max, have.length));
      if (next.length === have.length) return { entry: existing, list: have };
      const stamped = stampPast(existing, next, uid);
      if (snap.exists()) tx.update(ref, { [field]: stamped });
      else tx.set(ref, { [field]: stamped });
      return { entry: stamped, list: next };
    });
    if (entry) mergeIntoLocal({ [field]: entry }, code);
    return list;
  } catch (err) {
    console.warn('[account-prefs] union failed:', err);
    return null;
  }
}

/**
 * Live prefs. Each server snapshot is merged into the mirror and `cb` gets the merged values.
 * No-op unsubscribe when dormant or signed out; a dropped stream stays down until reload.
 */
export function subscribePrefs(cb: (prefs: Record<string, unknown>) => void): () => void {
  const code = accountCode();
  if (!code) return () => {};
  let cancelled = false;
  let unsub: (() => void) | null = null;
  void (async () => {
    try {
      const { db, fs } = await getRemote();
      if (cancelled) return;
      unsub = fs.onSnapshot(
        fs.doc(db, 'trips', code, 'profile', 'prefs'),
        (snap) => {
          if (snap.metadata.hasPendingWrites) return;
          if ((getSyncCode()?.trim() ?? '') !== code) return;
          cb(values(mergeIntoLocal(snap.exists() ? sanitize(snap.data()) : {}, code)));
        },
        (err) => console.warn('[account-prefs] stream error:', err),
      );
    } catch (err) {
      console.warn('[account-prefs] subscribe unavailable:', err);
    }
  })();
  return () => {
    cancelled = true;
    unsub?.();
  };
}
