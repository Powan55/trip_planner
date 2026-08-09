// @vitest-environment jsdom
//
// S140 — unit coverage for `createReactiveStore` (D-148), the ONE reactive-store skeleton the
// four domains now share. Exercised by RENDERING the real hook (a tiny renderHook shim over
// react-dom/client + act — no new dependency, mirroring lib/__tests__/use-itinerary-sync.test.ts).
// Proves, on a real run, the four behavior lines the factory centralizes:
//   1. hydration gating (mount-load flips `hydrated`);
//   2. the commit choke-point (D-031 fresh-base: compute sees storage.load()) → persist → setState
//      → dispatch;
//   3. dual-layer reactivity (D-026): a same-tab CustomEvent AND a matching cross-tab `storage`
//      event re-read; a non-matching `storage` key does NOT; `key === null` (full clear) does;
//   4. push placement (D-039): a supplied SyncPort's push fires ONLY from commit, with (prev,next),
//      after the local save — and an ABSENT sync never pushes / never throws.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { StoragePort, SyncPort } from '@/core/ports';
import {
  createReactiveStore,
  type ReactiveStoreCore,
} from '@/hooks/create-reactive-store';

// A tiny in-memory StoragePort so the factory can be exercised free of any domain (items/ids/
// tombstones). `save` records what was written; `load` returns the freshest saved value.
function makeStorage(initial: number[]): { port: StoragePort<number[]>; disk: { v: number[] } } {
  const disk = { v: initial };
  return {
    disk,
    port: {
      load: () => disk.v,
      save: (value: number[]) => {
        disk.v = value;
      },
      has: () => true,
    },
  };
}

const EVENT = 'reactive-store-test:changed';
const KEY = 'reactive_store_test_key';

interface Handle<T> {
  current: ReactiveStoreCore<T>;
  run: (fn: (core: ReactiveStoreCore<T>) => void) => Promise<void>;
  unmount: () => void;
}

function render<T>(useStore: () => ReactiveStoreCore<T>): Handle<T> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref = { current: null as unknown as ReactiveStoreCore<T> };
  function Probe() {
    ref.current = useStore();
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return {
    get current() {
      return ref.current;
    },
    async run(fn) {
      await act(async () => {
        fn(ref.current);
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('createReactiveStore — the shared hydrate/listen/commit skeleton (D-148)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrates on mount and exposes the loaded value', async () => {
    const { port } = makeStorage([1, 2, 3]);
    const useStore = createReactiveStore<number[]>({ eventName: EVENT, storageKeys: [KEY], storage: port });
    const h = render(useStore);
    expect(h.current.hydrated).toBe(true);
    expect(h.current.value).toEqual([1, 2, 3]);
    h.unmount();
  });

  it('commit derives next from the FRESHEST persisted value (D-031), persists, and updates state', async () => {
    const { port, disk } = makeStorage([1]);
    const useStore = createReactiveStore<number[]>({ eventName: EVENT, storageKeys: [KEY], storage: port });
    const h = render(useStore);

    // Two commits chained in one handler must compose off the persisted base, not a stale closure.
    await h.run((c) => {
      c.commit((cur) => [...cur, 2]);
      c.commit((cur) => [...cur, 3]);
    });

    expect(disk.v).toEqual([1, 2, 3]); // both writes composed
    expect(h.current.value).toEqual([1, 2, 3]);
    h.unmount();
  });

  it('a second instance re-reads on the same-tab CustomEvent (D-026 layer 1, cross-instance liveness)', async () => {
    const { port } = makeStorage([1]);
    const useStore = createReactiveStore<number[]>({ eventName: EVENT, storageKeys: [KEY], storage: port });
    const a = render(useStore);
    const b = render(useStore);

    await a.run((c) => c.commit(() => [9, 9]));

    expect(a.current.value).toEqual([9, 9]);
    expect(b.current.value).toEqual([9, 9]); // b heard a's dispatched event and re-read
    a.unmount();
    b.unmount();
  });

  it('re-reads on a MATCHING cross-tab storage event and on a full clear (key===null); IGNORES a non-matching key', async () => {
    const { port, disk } = makeStorage([1]);
    const useStore = createReactiveStore<number[]>({ eventName: EVENT, storageKeys: [KEY], storage: port });
    const h = render(useStore);

    // Simulate another tab having written; the disk value changes out-of-band.
    disk.v = [7];
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'some_other_key' }));
      await Promise.resolve();
    });
    expect(h.current.value).toEqual([1]); // non-matching key ⇒ no re-read

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
      await Promise.resolve();
    });
    expect(h.current.value).toEqual([7]); // matching key ⇒ re-read

    disk.v = [8];
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
      await Promise.resolve();
    });
    expect(h.current.value).toEqual([8]); // full clear ⇒ re-read
    h.unmount();
  });

  it('with a SyncPort, push fires only from commit with (prev,next) after the save (D-039)', async () => {
    const { port } = makeStorage([1]);
    const pushes: Array<{ prev: number[]; next: number[] }> = [];
    const sync: SyncPort<number[]> = {
      push: async (prev, next) => {
        pushes.push({ prev, next });
      },
      subscribe: () => () => {},
      isConfigured: () => true,
    };
    const useStore = createReactiveStore<number[]>({ eventName: EVENT, storageKeys: [KEY], storage: port, sync });
    const h = render(useStore);

    expect(pushes).toHaveLength(0); // hydration alone never pushes
    await h.run((c) => c.commit((cur) => [...cur, 2]));
    expect(pushes).toEqual([{ prev: [1], next: [1, 2] }]);
    h.unmount();
  });

  it('with NO SyncPort, commit never pushes and never throws (local-only domain)', async () => {
    const { port, disk } = makeStorage([1]);
    const useStore = createReactiveStore<number[]>({ eventName: EVENT, storageKeys: [KEY], storage: port });
    const h = render(useStore);
    await expect(h.run((c) => c.commit((cur) => [...cur, 2]))).resolves.toBeUndefined();
    expect(disk.v).toEqual([1, 2]);
    h.unmount();
  });
});
