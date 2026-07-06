'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import { loadJournal, saveJournal } from '@/core/journal/storage';
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
 * A THIN React adapter over the framework-free journal core (`core/journal/model.ts`) + the
 * load/save adapter (`core/journal/storage.ts`, gateway key 12). It mirrors `hooks/use-expenses.ts`
 * exactly — SIMPLE: no sync fan-out, no attribution, no tombstones (the journal is a private,
 * single-user, localStorage-only domain).
 *
 * Reactivity (idiom, mirrored):
 *  - Every mutator writes via `saveJournal()` AND dispatches a same-tab CustomEvent
 *    (`JOURNAL_CHANGED_EVENT`) on `window`, so any other reader (the recap consumes this)
 *    updates live the instant an entry is saved.
 *  - The hook listens for that CustomEvent (same-tab liveness) AND the cross-tab `storage` event,
 *    re-reading from storage on either — via the exported key constant, never a literal.
 *
 * SSR-safe + hydrated gate (mirrors `use-expenses.ts`): the list starts `[]` (matching the server
 * render), hydrates from `loadJournal()` in a mount effect, and every mutator reads the FRESHEST
 * persisted state as its base (not a stale React closure) so multiple saves in one handler compose.
 * `hydrated` is exposed so a consumer can defer a persist-on-first-render.
 *
 * timestamp injection: `saveEntry` injects `new Date().toISOString()` at the ADAPTER
 * boundary and hands it to the pure `upsertEntry`, so the core stays deterministic + clock-free.
 */

export const JOURNAL_CHANGED_EVENT = 'journal:changed';

export interface JournalStore {
  entries: JournalEntry[];
  hydrated: boolean;
  getEntry(date: string): JournalEntry | null;
  /** Upsert the entry for `date` with a patch (mood/highlight `null` clears; empty content removes). */
  saveEntry(date: string, patch: JournalPatch): void;
  removeEntry(date: string): void;
}

export function useJournal(): JournalStore {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);

  // Load from localStorage on mount. SSR-safe: `loadJournal()` returns [] under no-window,
  // matching first paint; the real read happens here after mount.
  useEffect(() => {
    setEntries(loadJournal());
    setHydrated(true);
    hydratedRef.current = true;
  }, []);

  // Re-read on a same-tab CustomEvent OR a cross-tab `storage` event, so every store instance
  // stays in sync within and across tabs.
  useEffect(() => {
    const reread = () => {
      if (!hydratedRef.current) return;
      setEntries(loadJournal());
    };
    const onCustom = () => reread();
    const onStorage = (e: StorageEvent) => {
      // Route through the exported key constant (never a literal) so the cross-tab listener can't
      // silently stop matching if the on-disk key changes. A full clear (key===null) too.
      if (e.key === STORAGE_KEYS.journal || e.key === null) reread();
    };
    window.addEventListener(JOURNAL_CHANGED_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(JOURNAL_CHANGED_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Single commit path: derive `next` from the freshest persisted state (storage is the source of
  // truth), write through `saveJournal`, update React state, then dispatch the same-tab CustomEvent
  // so other store instances re-read. Gated on `hydrated` so the first-render [] can't clobber a
  // saved list before load.
  const commit = useCallback((compute: (current: JournalEntry[]) => JournalEntry[]) => {
    if (!hydratedRef.current) return;
    const prev = loadJournal();
    const next = compute(prev);
    saveJournal(next);
    setEntries(next);
    window.dispatchEvent(new CustomEvent(JOURNAL_CHANGED_EVENT));
  }, []);

  // Read against the freshest persisted state (not a stale closure), so a caller that reads right
  // after a save sees the write; falls back to React state under SSR/pre-hydrate.
  const getEntry = useCallback(
    (date: string): JournalEntry | null => {
      const source = hydratedRef.current ? loadJournal() : entries;
      return getEntryCore(source, date);
    },
    [entries],
  );

  const saveEntry = useCallback(
    (date: string, patch: JournalPatch) => {
      // timestamp injected HERE (the pure core stays deterministic).
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

  return { entries, hydrated, getEntry, saveEntry, removeEntry };
}
