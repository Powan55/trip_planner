'use client';

import { useCallback } from 'react';
import { keyFor } from '@/core/storage/gateway';
import { loadShareInbox, saveShareInbox, shareInboxStoragePort } from '@/core/share/storage';
import { createReactiveStore } from '@/hooks/create-reactive-store';
import {
  addShareItem,
  removeShareItem,
  assignDay as assignDayCore,
  type ShareItem,
} from '@/core/share/model';

/**
 * Reactive share-inbox store. A THIN React adapter over the framework-free share core
 * (`core/share/model.ts`) + the load/save adapter (`core/share/storage.ts`, gateway key 23).
 * Local-only (no sync port), wiring `createReactiveStore` exactly like
 * `hooks/use-packing.ts` — the shared factory owns hydrate/listen/commit; this file owns only the
 * share-specific mutators + the id/timestamp injection (an I/O concern that stays out of the pure
 * core).
 */

export const SHARE_CHANGED_EVENT = 'share:changed';

export interface NewShareInput {
  title?: string;
  text?: string;
  url?: string;
}

export interface ShareStore {
  items: ShareItem[];
  hydrated: boolean;
  /** Add a received share (id + receivedAt injected here). Newest-first, capped at 100. */
  addShare(input: NewShareInput): void;
  /** Remove an inbox item by id. */
  removeShare(id: string): void;
  /** Assign (`day`) or clear (`undefined`) the trip day for an item. */
  assignDay(id: string, day: string | undefined): void;
}

// The shared hydrate/listen/commit skeleton, instantiated once for the share domain.
const useShareStore = createReactiveStore<ShareItem[]>({
  eventName: SHARE_CHANGED_EVENT,
  storageKeys: () => [keyFor('shareInbox')],
  storage: shareInboxStoragePort,
});

/** Generate a collision-resistant id without a new dependency (crypto.randomUUID when available). */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `share-${crypto.randomUUID()}`;
  }
  return `share-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useShare(): ShareStore {
  const { value: items, hydrated, commit } = useShareStore();

  const addShare = useCallback(
    (input: NewShareInput) => {
      const item: ShareItem = {
        id: newId(),
        receivedAt: new Date().toISOString(),
        ...(input.title ? { title: input.title } : {}),
        ...(input.text ? { text: input.text } : {}),
        ...(input.url ? { url: input.url } : {}),
      };
      commit((current) => addShareItem(current, item));
    },
    [commit],
  );

  const removeShare = useCallback(
    (id: string) => {
      commit((current) => removeShareItem(current, id));
    },
    [commit],
  );

  const assignDay = useCallback(
    (id: string, day: string | undefined) => {
      commit((current) => assignDayCore(current, id, day));
    },
    [commit],
  );

  return { items, hydrated, addShare, removeShare, assignDay };
}

// Re-exported so tests/callers can compare byte-transport values directly.
export { loadShareInbox, saveShareInbox };
