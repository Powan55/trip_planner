// The offline-safe half of a journal push: stamping a day dirty in key 50. It lives outside
// journal-remote.ts because that file is a lazy chunk, and offline it may never load (#1183).
// Keep firebase out of this file's imports, or the chunk is no longer lazy.

import { deviceStore, getActiveTripId, getSyncCode, isSafeTripSegment, keyFor, readJson, writeJson } from '@/core/storage/gateway';
import { loadJournal } from '@/core/journal/storage';
import { getEntry } from '@/core/journal/model';
import { hlcSendOrLocal, parse, serialize } from '@/core/sync/hlc';
import { SYNC_OUTBOX_CHANGED_EVENT } from '@/core/sync/outbox';
import { isRemoteConfigured } from './firebase-config';
import { realClock } from './trip-now';

export type Meta = { hlc: string; dirty?: true; deletedAt?: string };
export type Target = { code: string; tripId: string; docId: string };

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function target(): Target | null {
  const code = getSyncCode()?.trim() ?? '';
  const tripId = getActiveTripId();
  const docId = `journal_${tripId}`;
  return isRemoteConfigured() && isSafeTripSegment(code) && isSafeTripSegment(docId) ? { code, tripId, docId } : null;
}

export const stamp = (after: string | undefined) =>
  serialize(hlcSendOrLocal(after ? parse(after) : null, realClock.now().getTime(), deviceStore.getId()));

export function stampedMap<T extends { hlc: string }>(raw: unknown): Record<string, T> {
  const out: Record<string, T> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [d, r] of Object.entries(raw)) {
    if (DATE_RE.test(d) && typeof r === 'object' && r !== null && typeof (r as T).hlc === 'string') out[d] = r as T;
  }
  return out;
}

export const readMeta = () => stampedMap<Meta>(readJson<unknown>('local', keyFor('journalSync'), {}));
// The badge counts dirty days (#753), so every stamp change re-renders it like an outbox write.
export const writeMeta = (meta: Record<string, Meta>) => {
  writeJson('local', keyFor('journalSync'), meta);
  window.dispatchEvent(new CustomEvent(SYNC_OUTBOX_CHANGED_EVENT));
};

/** Stamp `date` dirty after its explicit edit or delete was saved locally. False when there is
 * nothing to push (no sync code, bad date, or a delete of a day that never synced). */
export function markJournalDirty(date: string): boolean {
  if (!target() || !DATE_RE.test(date)) return false;
  const meta = readMeta();
  const deleted = !getEntry(loadJournal(), date);
  if (deleted && !meta[date]) return false;
  meta[date] = deleted
    ? { hlc: stamp(meta[date]?.hlc), dirty: true, deletedAt: realClock.now().toISOString() }
    : { hlc: stamp(meta[date]?.hlc), dirty: true };
  writeMeta(meta);
  return true;
}
