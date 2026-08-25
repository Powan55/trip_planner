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

/** Record (or clear) a permission-denied `onSnapshot` stream error for `domain`. A no-op call
 * (already at that state) skips the event so a steady run of successful snapshots doesn't spam it. */
export function setReadDenied(domain: SyncDomain, denied: boolean): void {
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
