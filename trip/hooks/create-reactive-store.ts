'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { StoragePort, SyncPort } from '@/core/ports';

/**
 * `createReactiveStore<T>` — the one reactive-store skeleton shared by every domain.
 *
 * The hydrate / listen / commit code was triplicated near-verbatim across
 * `hooks/use-itinerary.ts`, `hooks/use-expenses.ts`, and `hooks/use-journal.ts` (and budget
 * had no hook at all). This factory extracts exactly that proven skeleton — nothing more. It
 * owns only React state + the mount-load, the dual-layer reactivity listeners, and the
 * single `commit()` write choke-point (fresh-base compute + push-from-commit-only). Every
 * domain-specific concern — mutators, attribution/sync stamping, tombstone
 * filters, selectors, id generation, timestamp injection — stays in the domain hook that wraps
 * this. The factory knows nothing about items, ids, or tombstones.
 *
 * It is not a plugin framework: the config is precisely the four things the three hooks
 * differed in — the frozen same-tab event name, the on-disk keys the cross-tab listener
 * matches, the domain's `StoragePort`, and (for the one synced domain, itinerary) an optional
 * `SyncPort`. Mutators are deliberately left out of the config — they differ in arity/semantics
 * and stay domain-side.
 *
 * Behavior lines it reproduces byte-for-byte in effect (each was already commented in the three
 * hooks):
 *  1. HYDRATION GATING — state seeds from the StoragePort's SSR value; a mount effect loads +
 *     flips `hydrated`; `commit()` and the event re-read both no-op before hydration, so a
 *     first-render seed can never clobber storage. (Every consumer of these hooks is a
 *     `dynamic({ssr:false})` island, so seeding from `storage.load()` produces no server DOM to
 *     mismatch — the client simply reads the freshest value on first render.)
 *  2. REACTIVITY, BOTH LAYERS — every commit dispatches the CustomEvent; the hook
 *     listens to that event AND the cross-tab `storage` event (key-match via the exported key
 *     constants, or `key === null` full-clear), re-reading from the StoragePort — never a stale
 *     closure.
 *  3. FRESH-BASE COMMIT — `compute` receives `storage.load()`, so chained mutations in
 *     one handler compose (each sees the prior's already-persisted write).
 *  4. PUSH PLACEMENT — `sync.push(prev, next)` fires ONLY from `commit()`, AFTER the
 *     local save + dispatch, fire-and-forget, never throwing to the caller. Absent `sync` ⇒
 *     local-only (journal/expenses/budget in this slice).
 */

export interface ReactiveStoreConfig<T> {
  /** Same-tab CustomEvent name, frozen per domain:
   *  'itinerary:changed' · 'expenses:changed' · 'journal:changed' · 'budget:changed'. */
  eventName: string;
  /** On-disk key literals the cross-tab `storage` listener matches
   *  (`e.key === one of these || e.key === null`). Always the exported constants
   *  (ITINERARY_STORAGE_KEY / STORAGE_KEYS.*), never a literal. */
  storageKeys: readonly string[];
  /** The existing per-domain StoragePort. Key-presence, []-survives, quarantine, and
   *  sanitize-on-load all live inside the impl — the factory is agnostic. */
  storage: StoragePort<T>;
  /** Optional remote fan-out. Absent ⇒ local-only domain (journal/expenses/budget). */
  sync?: SyncPort<T>;
}

export interface ReactiveStoreCore<T> {
  /** The raw persisted-shape value (tombstones INCLUDED for synced domains — the domain hook
   *  applies any exposed-value filter). */
  value: T;
  hydrated: boolean;
  /** The single write choke-point:
   *  gate on hydrated → prev = storage.load() → next = compute(prev) → storage.save(next)
   *  → setState(next) → dispatch(eventName) → void sync?.push(prev, next)  [fire-and-forget]. */
  commit(compute: (current: T) => T): void;
}

/** Called ONCE at module scope per domain; returns the domain's core hook. */
export function createReactiveStore<T>(config: ReactiveStoreConfig<T>): () => ReactiveStoreCore<T> {
  const { eventName, storageKeys, storage, sync } = config;

  return function useReactiveStore(): ReactiveStoreCore<T> {
    const [value, setValue] = useState<T>(() => storage.load());
    const [hydrated, setHydrated] = useState(false);
    const hydratedRef = useRef(false);

    // Load from storage on mount. SSR-safe: `storage.load()` returns the impl's no-window
    // fallback under SSR; the real read happens here after mount.
    useEffect(() => {
      setValue(storage.load());
      setHydrated(true);
      hydratedRef.current = true;
    }, []);

    // Re-read on a same-tab CustomEvent OR a cross-tab `storage` event, so every store instance
    // stays in sync within and across tabs. Route the cross-tab match through the
    // exported key constants (never a literal) so it can't silently stop matching if a key
    // changes; a full clear (key === null) re-reads too.
    useEffect(() => {
      const reread = () => {
        if (!hydratedRef.current) return;
        setValue(storage.load());
      };
      const onCustom = () => reread();
      const onStorage = (e: StorageEvent) => {
        if (e.key === null || storageKeys.includes(e.key)) reread();
      };
      window.addEventListener(eventName, onCustom);
      window.addEventListener('storage', onStorage);
      return () => {
        window.removeEventListener(eventName, onCustom);
        window.removeEventListener('storage', onStorage);
      };
    }, []);

    // Single commit path: derive `next` from the freshest persisted state (storage is the
    // source of truth), write through `save()`, update React state, then dispatch the
    // same-tab CustomEvent so other store instances re-read. Gated on `hydrated` so a
    // first-render seed can't clobber storage before load. Remote push fires ONLY here,
    // AFTER the local save + dispatch, fire-and-forget (the SyncPort swallows its own failures
    // and never throws), and only for a synced domain.
    const commit = useCallback((compute: (current: T) => T) => {
      if (!hydratedRef.current) return;
      const prev = storage.load();
      const next = compute(prev);
      storage.save(next);
      setValue(next);
      window.dispatchEvent(new CustomEvent(eventName));
      if (sync) void sync.push(prev, next);
    }, []);

    return { value, hydrated, commit };
  };
}
