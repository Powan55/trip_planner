// The journal follows its author across their own devices, and nobody else's (D-596).
//
// SHAPE: ONE doc per trip under the author's account, `trips/{syncCode}/profile/journal_{tripId}`
// = `{ entries: { [date]: row } }`, where a row is the entry plus `hlc`, or a tombstone
// `{ deletedAt, hlc }` so a delete can't come back from another device. Nested under one field
// because the rules cap a doc at 32 top-level fields. Each date is last-write-wins on its HLC and
// every write is a transaction touching only its own date.
//
// Local stamps live in key 50 beside the entries (key 12). An edit that fails to push stays
// `dirty` and is pushed again on the next snapshot or `online` event. Photos are not here: they
// sit in key 16 and IndexedDB on the device that took them.

'use client';

import { JOURNAL_CHANGED_EVENT } from '@/core/storage/events';
import {
  deviceStore,
  getActiveTripId,
  getSyncCode,
  isSafeTripSegment,
  keyFor,
  readJson,
  writeJson,
} from '@/core/storage/gateway';
import { loadJournal, saveJournal } from '@/core/journal/storage';
import { JOURNAL_TEXT_MAX, getEntry, sanitizeEntry, type JournalEntry } from '@/core/journal/model';
import { compareHlc, hlcSendOrLocal, parse, serialize } from '@/core/sync/hlc';
import { isRemoteConfigured } from './firebase-config';
import { getRemote } from './firebase-remote';
import { realClock } from './trip-now';

type Meta = { hlc: string; dirty?: true; deletedAt?: string };
type Row = { hlc: string; deletedAt?: string } & Partial<Omit<JournalEntry, 'date'>>;
type Target = { code: string; tripId: string; docId: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HIGHLIGHT_MAX = 120; // the highlight input's maxLength

function target(): Target | null {
  const code = getSyncCode()?.trim() ?? '';
  const tripId = getActiveTripId();
  const docId = `journal_${tripId}`;
  return isRemoteConfigured() && isSafeTripSegment(code) && isSafeTripSegment(docId) ? { code, tripId, docId } : null;
}

function sameTarget(t: Target): boolean {
  const now = target();
  return now?.code === t.code && now.tripId === t.tripId;
}

const newer = (a: string, b: string) => compareHlc(parse(a), parse(b)) > 0;

const stamp = (after: string | undefined) =>
  serialize(hlcSendOrLocal(after ? parse(after) : null, realClock.now().getTime(), deviceStore.getId()));

function stampedMap<T extends { hlc: string }>(raw: unknown): Record<string, T> {
  const out: Record<string, T> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [d, r] of Object.entries(raw)) {
    if (DATE_RE.test(d) && typeof r === 'object' && r !== null && typeof (r as T).hlc === 'string') out[d] = r as T;
  }
  return out;
}

const readMeta = () => stampedMap<Meta>(readJson<unknown>('local', keyFor('journalSync'), {}));
const writeMeta = (meta: Record<string, Meta>) => writeJson('local', keyFor('journalSync'), meta);
const readRows = (data: unknown) => stampedMap<Row>((data as { entries?: unknown } | undefined)?.entries);

function rowFor(date: string, hlc: string): Row {
  const e = getEntry(loadJournal(), date);
  if (!e) return { hlc, deletedAt: readMeta()[date]?.deletedAt ?? realClock.now().toISOString() };
  const row: Row = { hlc, text: e.text.slice(0, JOURNAL_TEXT_MAX), createdAt: e.createdAt, updatedAt: e.updatedAt };
  if (e.mood) row.mood = e.mood;
  if (e.highlight) row.highlight = e.highlight.slice(0, HIGHLIGHT_MAX);
  return row;
}

function rowToEntry(date: string, row: Row): JournalEntry | null {
  if (row.deletedAt !== undefined) return null;
  return sanitizeEntry({
    ...row,
    date,
    text: typeof row.text === 'string' ? row.text.slice(0, JOURNAL_TEXT_MAX) : '',
    highlight: typeof row.highlight === 'string' ? row.highlight.slice(0, HIGHLIGHT_MAX) : undefined,
  });
}

/** Write remote rows into the local journal and their stamps into key 50. */
function adopt(rows: [string, Row][], meta: Record<string, Meta>): void {
  let entries = loadJournal();
  for (const [date, row] of rows) {
    const e = rowToEntry(date, row);
    const i = entries.findIndex((x) => x.date === date);
    if (i === -1) entries = e ? [...entries, e] : entries;
    else entries = e ? entries.map((x, j) => (j === i ? e : x)) : entries.filter((_, j) => j !== i);
    meta[date] = row.deletedAt !== undefined ? { hlc: row.hlc, deletedAt: row.deletedAt } : { hlc: row.hlc };
  }
  writeMeta(meta);
  if (rows.length === 0) return;
  saveJournal(entries);
  window.dispatchEvent(new CustomEvent(JOURNAL_CHANGED_EVENT));
}

/** Merge a server snapshot. Entries written before this device had a stamp (older app, no sync
 * code yet) are stamped at their own `updatedAt` and marked dirty, so they push rather than lose. */
function applyRemote(rows: Record<string, Row>, t: Target): void {
  if (!sameTarget(t)) return;
  const meta = readMeta();
  for (const e of loadJournal()) {
    if (!meta[e.date]) {
      const pt = Date.parse(e.updatedAt);
      meta[e.date] = { hlc: serialize({ pt: Number.isFinite(pt) ? pt : 0, ct: 0, actor: deviceStore.getId() }), dirty: true };
    }
  }
  adopt(
    Object.entries(rows).filter(([d, r]) => !meta[d] || newer(r.hlc, meta[d].hlc)),
    meta,
  );
}

/**
 * Push one date. `explicit` (the author just edited it) stamps past both the local and the stored
 * stamp, so the edit wins even from a slow clock. A retry keeps its original stamp and loses to
 * anything newer on the server, which it then adopts.
 */
async function push(t: Target, date: string, explicit: boolean): Promise<void> {
  const m = readMeta()[date];
  if (!m || (!explicit && !m.dirty)) return;
  // Gone locally without an explicit delete (Settings' local clear): a retry must not tombstone it.
  if (!explicit && !m.deletedAt && !getEntry(loadJournal(), date)) {
    const meta = readMeta();
    if (meta[date]) delete meta[date].dirty;
    writeMeta(meta);
    return;
  }
  const sent = m.hlc;
  try {
    const { db, fs } = await getRemote();
    if (!sameTarget(t)) return;
    const ref = fs.doc(db, 'trips', t.code, 'profile', t.docId);
    const row = await fs.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const remote = snap.exists() ? readRows(snap.data())[date] : undefined;
      if (!explicit && remote && newer(remote.hlc, sent)) return remote;
      const next = rowFor(date, explicit ? stamp(remote && newer(remote.hlc, sent) ? remote.hlc : sent) : sent);
      if (snap.exists()) tx.update(ref, { [`entries.${date}`]: next });
      else tx.set(ref, { entries: { [date]: next } });
      return next;
    });
    const meta = readMeta();
    // Edited again while this was in flight: that edit pushes itself.
    if (sameTarget(t) && meta[date]?.hlc === sent) adopt([[date, row]], meta);
  } catch (err) {
    console.warn('[journal-sync] push failed, will retry:', err);
  }
}

async function flush(t: Target): Promise<void> {
  for (const [date, m] of Object.entries(readMeta())) if (m.dirty) await push(t, date, false);
}

/**
 * Call after an explicit edit or delete of `date` has been saved locally. No-op without a sync
 * code. Never rejects.
 */
export function pushJournalEntry(date: string): Promise<void> {
  const t = target();
  if (!t || !DATE_RE.test(date)) return Promise.resolve();
  const meta = readMeta();
  const deleted = !getEntry(loadJournal(), date);
  if (deleted && !meta[date]) return Promise.resolve();
  meta[date] = deleted
    ? { hlc: stamp(meta[date]?.hlc), dirty: true, deletedAt: realClock.now().toISOString() }
    : { hlc: stamp(meta[date]?.hlc), dirty: true };
  writeMeta(meta);
  return push(t, date, true);
}

function subscribe(): () => void {
  const t = target();
  if (!t) return () => {};
  let cancelled = false;
  let unsub: (() => void) | null = null;
  const onOnline = () => void flush(t);
  window.addEventListener('online', onOnline);
  void (async () => {
    try {
      const { db, fs } = await getRemote();
      if (cancelled) return;
      unsub = fs.onSnapshot(
        fs.doc(db, 'trips', t.code, 'profile', t.docId),
        (snap) => {
          if (snap.metadata.hasPendingWrites) return;
          applyRemote(snap.exists() ? readRows(snap.data()) : {}, t);
          void flush(t);
        },
        (err) => console.warn('[journal-sync] stream error:', err),
      );
    } catch (err) {
      console.warn('[journal-sync] subscribe unavailable:', err);
    }
  })();
  return () => {
    cancelled = true;
    unsub?.();
    window.removeEventListener('online', onOnline);
  };
}

let live: { count: number; stop: () => void } | null = null;

/** One listener per page however many journal views are mounted. Returns the release. */
export function retainJournalSync(): () => void {
  if (live) live.count += 1;
  else live = { count: 1, stop: subscribe() };
  let released = false;
  return () => {
    if (released || !live) return;
    released = true;
    live.count -= 1;
    if (live.count === 0) {
      live.stop();
      live = null;
    }
  };
}
