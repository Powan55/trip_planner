// #271 — the READ-side twin of `core/sync/denied.ts`'s write-side outbox record. A
// permission-denied `onSnapshot` STREAM error has no chunk to key against
// (`core/sync/outbox.ts`'s `outboxBlocked()` counts denied WRITE CHUNKS, keyed by domain+chunk) —
// a refused read is refused for the whole stream, so this is a bare per-domain flag rather than a
// chunk set. Session state only, same lifetime as the outbox's `denied` set: it resets on reload,
// and clears itself on the next successful snapshot (membership granted mid-session, no reload
// needed).
//
// Reuses `core/sync/outbox.ts`'s existing `SYNC_OUTBOX_CHANGED_EVENT` so
// `hooks/use-sync-status.ts` picks up a flip with no new wiring — same tick as an enqueue, ack, or
// write-side denial already dispatches.
import type { SyncDomain } from '@/core/sync/outbox';
import { SYNC_OUTBOX_CHANGED_EVENT } from '@/core/sync/outbox';

const readDenied = new Set<SyncDomain>();
// #845 — a listener that died for a reason other than a refusal (network, setup failure) and has
// not delivered a snapshot since. Cleared by the next good snapshot via `setReadDenied(d, false)`.
const readDead = new Set<SyncDomain>();

export function setReadDead(domain: SyncDomain, dead: boolean): void {
  if (dead === readDead.has(domain)) return;
  if (dead) readDead.add(domain);
  else readDead.delete(domain);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SYNC_OUTBOX_CHANGED_EVENT));
}

export function isReadDead(): boolean {
  return readDead.size > 0;
}

/** Record (or clear) a permission-denied `onSnapshot` stream error for `domain`. A no-op call
 * (already at that state) skips the event so a steady run of successful snapshots doesn't spam it. */
export function setReadDenied(domain: SyncDomain, denied: boolean): void {
  if (!denied) setReadDead(domain, false);
  const had = readDenied.has(domain);
  if (denied === had) return;
  if (denied) readDenied.add(domain);
  else readDenied.delete(domain);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SYNC_OUTBOX_CHANGED_EVENT));
}

/** Is ANY domain's read currently denied? The badge only needs to know whether the shared trip is
 * refusing this device's data, not which domain. */
export function isReadDenied(): boolean {
  return readDenied.size > 0;
}

// The default pack only syncs for a password account; an anonymous session is turned away in
// `getSharedRemote()` before any read is spent. Same session lifetime and event as the flag above.
let signInRequired = false;

export function setSignInRequired(required: boolean): void {
  if (required === signInRequired) return;
  signInRequired = required;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SYNC_OUTBOX_CHANGED_EVENT));
}

export function isSignInRequired(): boolean {
  return signInRequired;
}

// #753 — the journal and prefs twin of the outbox's #267 set: a refused journal day or prefs push
// is skipped for the rest of the page load and counted as blocked. Kept dirty, never persisted.
const queueDenied = new Set<string>();

function markQueueDenied(key: string): void {
  if (queueDenied.has(key)) return;
  queueDenied.add(key);
  console.warn('[sync] a journal or prefs push was refused by the rules — not retrying it this page load');
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SYNC_OUTBOX_CHANGED_EVENT));
}

const journalKey = (code: string, tripId: string, date: string) => JSON.stringify(['journal', code, tripId, date]);
const prefsKey = (code: string) => JSON.stringify(['prefs', code]);

export const markJournalDenied = (code: string, tripId: string, date: string) =>
  markQueueDenied(journalKey(code, tripId, date));
export const isJournalDenied = (code: string, tripId: string, date: string) =>
  queueDenied.has(journalKey(code, tripId, date));
export const markPrefsDenied = (code: string) => markQueueDenied(prefsKey(code));
export const isPrefsDenied = (code: string) => queueDenied.has(prefsKey(code));
