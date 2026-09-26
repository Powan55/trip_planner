// Firebase-free half of the per-person prefs (D-594): the local mirror (gateway key 48) and the
// account gate. Safe to import statically; the network side is `account-prefs-remote.ts`.

import { STORAGE_KEYS, getSyncCode, isSafeTripSegment, readJson } from '@/core/storage/gateway';
import { isRemoteConfigured } from './firebase-config';

// `dirty` exists only in the local mirror: an edit this device has not yet got onto the account.
export type PrefEntry = { v: unknown; hlc: string; dirty?: true };
export type PrefEntries = Record<string, PrefEntry>;

export const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function isEntry(x: unknown): x is PrefEntry {
  return typeof x === 'object' && x !== null && 'v' in x && typeof (x as PrefEntry).hlc === 'string';
}

export function sanitize(data: unknown, keepDirty = false): PrefEntries {
  const out: PrefEntries = {};
  if (typeof data !== 'object' || data === null) return out;
  for (const [k, e] of Object.entries(data)) {
    if (!FIELD_RE.test(k) || !isEntry(e)) continue;
    out[k] = keepDirty && e.dirty === true ? { v: e.v, hlc: e.hlc, dirty: true } : { v: e.v, hlc: e.hlc };
  }
  return out;
}

export function readLocal(): PrefEntries {
  return sanitize(readJson<unknown>('local', STORAGE_KEYS.personPrefs, {}), true);
}

export function values(entries: PrefEntries): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, e.v]));
}

export function accountCode(): string | null {
  const code = getSyncCode()?.trim() ?? '';
  return isRemoteConfigured() && isSafeTripSegment(code) ? code : null;
}

/** Whether per-person prefs can be kept at all: sync is configured and this device has an account. */
export function hasAccount(): boolean {
  return accountCode() !== null;
}

/** Synchronous read of the local mirror. May be stale; never use it to decide a mint. */
export function getCachedPrefs(): Record<string, unknown> {
  return values(readLocal());
}
