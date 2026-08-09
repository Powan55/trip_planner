// @vitest-environment jsdom
//
// S229 — the sync-status hook (`hooks/use-sync-status.ts`), exercised by RENDERING the real hook
// (a tiny renderHook shim over react-dom/client + act — no new dependency, mirrors
// lib/__tests__/use-favorites.test.ts / lib/__tests__/use-online.test.ts). Proves: the SSR-safe
// default matches first paint, live reactivity via the outbox's same-tab CustomEvent (real
// enqueue/ack through `withOutbox`/`flushOutbox`, NOT a mocked event), cross-tab `storage`
// reactivity, dormant/guest gating (mirrors `core-sync-outbox.test.ts`'s DORMANT/GUEST block),
// and — per S229's binding "tolerate a future 4th domain" requirement — that the
// pending count sums whatever domain keys are actually present in the dirty map rather than a
// hardcoded per-domain sum.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const gate = vi.hoisted(() => ({
  remoteOn: true,
  traveler: { name: 'Powan', token: 'Powan', accent: '#000' } as { name: string } | null,
}));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => gate.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => gate.traveler };
});

import { useSyncStatus, type SyncStatus } from '@/hooks/use-sync-status';
import { withOutbox, flushOutbox, type ChunkSync } from '@/core/sync/outbox';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import type { StoragePort } from '@/core/ports';

type State = Record<string, number>;

function makeStorage(initial: State): StoragePort<State> & { value: State } {
  const box = { value: { ...initial } };
  return {
    value: box.value,
    load: () => box.value,
    save: (v: State) => {
      box.value = v;
    },
    has: () => true,
  };
}

function makeHarness(failing: Set<string>): ChunkSync<State> {
  return {
    domain: 'itinerary',
    chunkDiff(prev, next) {
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      return [...keys].filter((k) => prev[k] !== next[k]);
    },
    async pushChunk(chunk) {
      if (failing.has(chunk)) throw new Error(`push failed for ${chunk}`);
    },
  };
}

interface HookHandle {
  current: SyncStatus;
  unmount: () => void;
}

function renderSyncStatus(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref: { current: SyncStatus } = { current: { pending: 0, lastAckAt: null } };

  function Probe() {
    ref.current = useSyncStatus();
    return null;
  }

  act(() => {
    root.render(createElement(Probe));
  });

  return {
    get current() {
      return ref.current;
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useSyncStatus (S229)', () => {
  beforeEach(() => {
    localStorage.clear();
    gate.remoteOn = true;
    gate.traveler = { name: 'Powan' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts at the SSR-safe default {pending:0, lastAckAt:null} and confirms it on mount when nothing is dirty', () => {
    const h = renderSyncStatus();
    expect(h.current).toEqual({ pending: 0, lastAckAt: null });
    h.unmount();
  });

  it('reflects a real offline-queued edit live (pending > 0) via the outbox same-tab event, no reload', async () => {
    const h = renderSyncStatus();
    expect(h.current.pending).toBe(0);

    const failing = new Set<string>(['d1']);
    const storage = makeStorage({ d1: 1 });
    const push = withOutbox(makeHarness(failing), storage);

    await act(async () => {
      await push({}, { d1: 1 }); // enqueues + fails → stays dirty
    });

    expect(h.current.pending).toBe(1);
    expect(h.current.lastAckAt).toBeNull(); // never acked yet
    h.unmount();
  });

  it('pending CLEARS and lastAckAt appears live once the queued edit is acked (reconnect + flush)', async () => {
    const h = renderSyncStatus();
    const failing = new Set<string>(['d1']);
    const storage = makeStorage({ d1: 1 });
    const cs = makeHarness(failing);
    const push = withOutbox(cs, storage);

    await act(async () => {
      await push({}, { d1: 1 });
    });
    expect(h.current.pending).toBe(1);

    failing.delete('d1'); // "reconnect"
    await act(async () => {
      await flushOutbox(cs, storage);
    });

    expect(h.current.pending).toBe(0);
    expect(h.current.lastAckAt).toEqual(expect.any(String));
    h.unmount();
  });

  it('reacts to a CROSS-TAB storage event on the outbox key (another tab wrote the slot)', async () => {
    const h = renderSyncStatus();
    expect(h.current.pending).toBe(0);

    // Simulate another tab's write: put a dirty slot directly on disk, then fire the browser's
    // cross-tab `storage` event (same-tab writes never receive this natively — jsdom mirrors
    // that; the SAME-tab path is proven separately via the CustomEvent test above).
    localStorage.setItem(
      STORAGE_KEYS.syncOutbox,
      JSON.stringify({ version: 1, dirty: { itinerary: ['2026-12-09'] } }),
    );
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.syncOutbox }));
    });

    expect(h.current.pending).toBe(1);
    h.unmount();
  });

  it('DORMANT: reads {pending:0, lastAckAt:null} even with real dirty+acked bytes on disk (D-038)', async () => {
    const failing = new Set<string>();
    const storage = makeStorage({ d1: 1 });
    await withOutbox(makeHarness(failing), storage)({}, { d1: 1 }); // acks, writes real bytes

    gate.remoteOn = false;
    const h = renderSyncStatus();
    expect(h.current).toEqual({ pending: 0, lastAckAt: null });
    h.unmount();
  });

  it('GUEST: reads {pending:0, lastAckAt:null} even with real dirty bytes on disk (D-055)', async () => {
    localStorage.setItem(
      STORAGE_KEYS.syncOutbox,
      JSON.stringify({ version: 1, dirty: { itinerary: ['2026-12-09'] } }),
    );
    gate.traveler = null;
    const h = renderSyncStatus();
    expect(h.current).toEqual({ pending: 0, lastAckAt: null });
    h.unmount();
  });

  // S229 binding requirement: "tolerate a future 4th domain" — the pending count must sum
  // whatever domain keys are PRESENT in the dirty map, never a hardcoded
  // dirty.itinerary.length + dirty.expenses.length + dirty.budget.length. A synthetic domain key
  // that does not exist in today's `SyncDomain` union proves the math has no such hardcoding
  // (the persisted JSON has no compile-time type once round-tripped through localStorage, so this
  // is a legitimate runtime probe of the summing logic, not a type-system loophole).
  it('tolerates a future 4th SyncDomain key in the dirty map (no hardcoded per-domain sum)', () => {
    localStorage.setItem(
      STORAGE_KEYS.syncOutbox,
      JSON.stringify({
        version: 1,
        dirty: {
          itinerary: ['2026-12-09'],
          expenses: ['nepal'],
          budget: ['model'],
          photos: ['p1', 'p2'], // synthetic 4th domain, not in today's SyncDomain union
        },
      }),
    );
    const h = renderSyncStatus();
    expect(h.current.pending).toBe(5); // 1 + 1 + 1 + 2, summed over EVERY present key
    h.unmount();
  });
});
