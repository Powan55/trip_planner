'use client';

import { useEffect, useRef, useState } from 'react';
import { keyFor } from '@/core/storage/gateway';
import { outboxSnapshot, SYNC_OUTBOX_CHANGED_EVENT } from '@/core/sync/outbox';

/**
 * Reactive read over the offline-push outbox — the data behind
 * `components/sync-status-badge.tsx`. A THIN adapter, mirroring `hooks/use-favorites.ts`'s
 * reactivity idiom: same-tab `SYNC_OUTBOX_CHANGED_EVENT` (dispatched by `core/sync/outbox.ts`'s
 * `saveSlot()`, its one write choke-point) + cross-tab `storage` event, both re-reading via
 * `outboxSnapshot()` — which is itself gated (`isRemoteConfigured() && getActiveTraveler()`), so
 * a dormant/guest build always reads the neutral `{pending:0, lastAckAt:null}` shape here too.
 *
 * `pending` sums `Object.values(dirty).flat().length` — every domain key CURRENTLY PRESENT in the
 * outbox's dirty map, never a hardcoded per-domain sum, so a future 4th `SyncDomain` needs no
 * edit here.
 *
 * SSR-safe: the default state matches the server/first-client-paint render (`pending:0,
 * lastAckAt:null` — the exact "nothing to show" shape `SyncStatusBadge` renders as nothing), and
 * a mount effect corrects it to the real on-disk snapshot — mirrors `useOnline`'s "safe default,
 * corrected on mount" pattern, so there is no hydration mismatch.
 */

export interface SyncStatus {
  pending: number;
  lastAckAt: string | null;
}

const SSR_DEFAULT: SyncStatus = { pending: 0, lastAckAt: null };

function readStatus(): SyncStatus {
  const { dirty, lastAckAt } = outboxSnapshot();
  const pending = Object.values(dirty).flat().length;
  return { pending, lastAckAt };
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(SSR_DEFAULT);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    setStatus(readStatus());

    const reread = () => {
      if (!mountedRef.current) return;
      setStatus(readStatus());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === keyFor('syncOutbox') || e.key === null) reread();
    };
    window.addEventListener(SYNC_OUTBOX_CHANGED_EVENT, reread);
    window.addEventListener('storage', onStorage);
    return () => {
      mountedRef.current = false;
      window.removeEventListener(SYNC_OUTBOX_CHANGED_EVENT, reread);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return status;
}
