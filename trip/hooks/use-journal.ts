'use client';

import { useCallback, useRef } from 'react';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import { loadJournal, saveJournal, journalStoragePort } from '@/core/journal/storage';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import {
  getEntry as getEntryCore,
  upsertEntry as upsertEntryCore,
  removeEntry as removeEntryCore,
  type JournalEntry,
  type JournalPatch,
} from '@/core/journal/model';

/**
 * Reactive journal store (in-trip per-day text journal).
 *
 * A thin React adapter over the framework-free journal core (`core/journal/model.ts`) + the
 * load/save adapter (`core/journal/storage.ts`, gateway key 12). Simple: no sync fan-out, no
 * attribution, no tombstones (the journal is a private, single-user, localStorage-only domain
 * by design) — so it wires `createReactiveStore` without a `sync` port. The shared
 * factory owns the hydrate/listen/commit skeleton (dual-layer reactivity, fresh-base
 * commit); this file owns only the journal-specific mutators + `getEntry` selector.
 *
 * Timestamp injection: `saveEntry` injects `new Date().toISOString()` at the adapter
 * boundary and hands it to the pure `upsertEntry`, so the core stays deterministic and clock-free.
 */

export const JOURNAL_CHANGED_EVENT = 'journal:changed';

export interface JournalStore {
  entries: JournalEntry[];
  hydrated: boolean;
  getEntry(date: string): JournalEntry | null;
  /** Upsert the entry for `date` with a patch (mood/highlight `null` clears; empty content removes). */
  saveEntry(date: string, patch: JournalPatch): void;
  removeEntry(date: string): void;
  /** Clear ALL journal entries (settings page). Local-only — the journal never syncs; this
   *  store has no sync port, so a wipe of key 12 has no propagation path by construction. */
  clearAll(): void;
}

// The shared hydrate/listen/commit skeleton, instantiated once for the journal domain.
// Local-only: no `sync` port (the journal never syncs — privacy-by-design).
const useJournalStore = createReactiveStore<JournalEntry[]>({
  eventName: JOURNAL_CHANGED_EVENT,
  storageKeys: [STORAGE_KEYS.journal],
  storage: journalStoragePort,
});

export function useJournal(): JournalStore {
  const { value: entries, hydrated, commit } = useJournalStore();

  // Read against the freshest persisted state (not a stale closure), so a caller that reads right
  // after a save sees the write; falls back to React state under SSR/pre-hydrate.
  //
  // Performance: the per-call `loadJournal()` parse was O(callers) per render — the recap
  // browse renders one card per elapsed day, each calling `getEntry`, so up to ~32 full parses per
  // render. Memoize the parsed source via a version-stamped ref keyed on the `entries` identity:
  // `entries` gets a fresh reference on every `commit()` (setValue(next)) and every event re-read
  // (setValue(load())) in `createReactiveStore`, so the memo invalidates exactly when the store
  // changes — one parse per change, not per call. Read-after-write-in-one-handler is preserved
  // because no caller reads `getEntry` synchronously after `saveEntry` before re-render (verified:
  // journal-card seeds its draft on open, recap/trip-story-recap only read at render time).
  const sourceRef = useRef<{ key: JournalEntry[]; source: JournalEntry[] } | null>(null);
  const getEntry = useCallback(
    (date: string): JournalEntry | null => {
      if (!hydrated) return getEntryCore(entries, date);
      if (sourceRef.current?.key !== entries) {
        sourceRef.current = { key: entries, source: loadJournal() };
      }
      return getEntryCore(sourceRef.current.source, date);
    },
    [entries, hydrated],
  );

  const saveEntry = useCallback(
    (date: string, patch: JournalPatch) => {
      // timestamp injected here (the pure core stays deterministic).
      commit((current) => upsertEntryCore(current, date, patch, new Date().toISOString()));
    },
    [commit],
  );

  const removeEntry = useCallback(
    (date: string) => {
      commit((current) => removeEntryCore(current, date));
    },
    [commit],
  );

  // Local-only clear: the journal store carries no sync port, so this plain local wipe of
  // key 12 can never propagate — privacy-by-design. One commit; stays cleared on reload (key present).
  const clearAll = useCallback(() => {
    commit(() => []);
  }, [commit]);

  return { entries, hydrated, getEntry, saveEntry, removeEntry, clearAll };
}
