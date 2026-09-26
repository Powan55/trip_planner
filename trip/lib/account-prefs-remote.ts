// Per-person settings that follow the traveler across their devices (D-594).
//
// SHAPE: ONE doc `trips/{userToken}/profile/prefs` = `{ [field]: { v, hlc } }`. Its own doc, not
// fields on `profile/tripList`: `pushTripList` writes that doc whole, so older clients would erase
// anything added there. Each field is last-write-wins on its own HLC, and every write is a
// transaction that touches only its field, so two devices editing different fields both survive.
//
// The local mirror is gateway key 48 (`personPrefs`), same shape, wiped on sign-out.

'use client';

import { STORAGE_KEYS, getSyncCode, writeJson } from '@/core/storage/gateway';
import { compareHlc, hlcSendOrLocal, parse, serialize } from '@/core/sync/hlc';
import { FIELD_RE, accountCode, readLocal, sanitize, values, type PrefEntries, type PrefEntry } from './account-prefs';
import { getRemote } from './firebase-remote';
import { realClock } from './trip-now';

export { getCachedPrefs, hasAccount, type PrefEntries, type PrefEntry } from './account-prefs';

// Stamps a local-only edit made before getRemote() is known to work (paused, offline).
const LOCAL_ACTOR = 'local';

function newer(a: PrefEntry | undefined, b: PrefEntry | undefined): PrefEntry | undefined {
  if (!a) return b;
  if (!b) return a;
  return compareHlc(parse(b.hlc), parse(a.hlc)) > 0 ? b : a;
}

/**
 * Fold account entries into the local mirror, per field, newest HLC wins; a tie goes to the
 * account copy, which is what clears a pushed field's dirty flag. `code` is the account the
 * entries came from; if this device has since signed out or switched account, nothing is written.
 */
function mergeIntoLocal(entries: PrefEntries, code: string | null): PrefEntries {
  const merged = readLocal();
  if (code !== null && (getSyncCode()?.trim() ?? '') !== code) return merged;
  for (const [k, e] of Object.entries(entries)) {
    const mine = merged[k];
    merged[k] = mine && compareHlc(parse(mine.hlc), parse(e.hlc)) > 0 ? mine : e;
  }
  writeJson('local', STORAGE_KEYS.personPrefs, merged);
  return merged;
}

/**
 * Push every dirty mirror field that is still newer than the account's copy, with its ORIGINAL
 * stamp (an automatic retry must not out-rank an edit made elsewhere since). Never rejects.
 */
async function pushDirty(code: string): Promise<void> {
  if ((getSyncCode()?.trim() ?? '') !== code) return; // the mirror now belongs to another account
  const dirty = Object.entries(readLocal()).filter(([, e]) => e.dirty);
  if (!dirty.length) return;
  try {
    const { db, fs } = await getRemote();
    const ref = fs.doc(db, 'trips', code, 'profile', 'prefs');
    const won = await fs.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const remote = snap.exists() ? sanitize(snap.data()) : {};
      const out: PrefEntries = {};
      const push: PrefEntries = {};
      for (const [f, mine] of dirty) {
        const theirs = remote[f];
        if (theirs && compareHlc(parse(theirs.hlc), parse(mine.hlc)) >= 0) out[f] = theirs;
        else out[f] = push[f] = { v: mine.v, hlc: mine.hlc };
      }
      if (Object.keys(push).length) {
        if (snap.exists()) tx.update(ref, push);
        else tx.set(ref, push);
      }
      return out;
    });
    mergeIntoLocal(won, code);
  } catch (err) {
    console.warn('[account-prefs] retry failed, kept on this device:', err);
  }
}

// JSON round-trip strips `undefined`, which Firestore rejects.
function clean(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
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
    const merged = mergeIntoLocal(snap.exists() ? sanitize(snap.data()) : {}, code);
    await pushDirty(code);
    return values(merged);
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
 * Set one field: an explicit edit, so it always wins. Mirrors locally (synchronously, marked
 * dirty) before touching the network, so a paused or offline edit stays on this device and
 * `getPrefs`/`subscribePrefs` push it later. Then, in a transaction, stamps past the newer of the
 * mirror's and the account's stamp (so a slow clock or an unread account can't lose the edit)
 * and writes only that field. Never rejects.
 */
export async function setPref(field: string, value: unknown): Promise<void> {
  if (!FIELD_RE.test(field)) return;
  const code = accountCode();
  if (!code) return;
  const local = readLocal();
  local[field] = { ...stampPast(local[field], value, LOCAL_ACTOR), dirty: true };
  writeJson('local', STORAGE_KEYS.personPrefs, local);
  try {
    const { db, fs, uid: actor } = await getRemote();
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
      const mine = readLocal()[field];
      if (mine?.dirty) return mine; // an explicit edit is on its way; never claim over it
      const entry = stampPast(existing, value, uid);
      if (snap.exists()) tx.update(ref, { [field]: entry });
      else tx.set(ref, { [field]: entry });
      return entry;
    });
    const mine = readLocal()[field];
    if (mine?.dirty) return mine.v as T;
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
          void pushDirty(code);
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
