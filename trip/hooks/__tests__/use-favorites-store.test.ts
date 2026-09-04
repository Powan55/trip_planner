// @vitest-environment jsdom
//
// Read + write path of `hooks/use-favorites.ts` after it moved onto the shared
// `createReactiveStore` skeleton (it was the one hand-rolled copy of it). Everything here is
// BEHAVIOUR the hand-roll already had, asserted against the factory wiring: hydrate from a
// pre-seeded slot, commit through to the gateway's key-14 slot, the same-tab CustomEvent fan-out
// between two mounted instances, and the cross-tab `storage` match — that last one is the piece
// the migration re-expressed (a literal `e.key ===` comparison became the factory's function-form
// `storageKeys`, resolved at event time), so it is pinned by key rather than assumed.
//
// Renders the real hook through the same renderHook shim over react-dom/client + act the sibling
// hook suites use — no new dependency.

import { describe, it, expect, beforeEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { keyFor } from '@/core/storage/gateway';
import { useFavorites, FAVORITES_CHANGED_EVENT, type FavoritesStoreApi } from '@/hooks/use-favorites';

const KEY = keyFor('favorites');

interface HookHandle {
  current: FavoritesStoreApi;
  run: (fn: (store: FavoritesStoreApi) => void) => Promise<void>;
  unmount: () => void;
}

function renderFavorites(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref: { current: FavoritesStoreApi } = { current: null as unknown as FavoritesStoreApi };

  function Probe() {
    ref.current = useFavorites();
    return null;
  }

  act(() => {
    root.render(createElement(Probe));
  });

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

function persisted(): unknown {
  const raw = window.localStorage.getItem(KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe('useFavorites on createReactiveStore — read path', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('hydrates a pre-seeded slot and flips `hydrated`', async () => {
    window.localStorage.setItem(KEY, JSON.stringify(['na1', 'ja3']));
    const h = renderFavorites();
    await h.run(() => {});
    expect(h.current.hydrated).toBe(true);
    expect(h.current.favorites).toEqual(['na1', 'ja3']);
    expect(h.current.isFavorite('na1')).toBe(true);
    expect(h.current.isFavorite('nope')).toBe(false);
    h.unmount();
  });

  it('an empty origin reads as [] and writes nothing on mount', async () => {
    const h = renderFavorites();
    await h.run(() => {});
    expect(h.current.favorites).toEqual([]);
    expect(persisted()).toBeNull(); // hydration alone must never create the slot
    h.unmount();
  });

  it('a corrupt slot degrades to [] rather than throwing', async () => {
    window.localStorage.setItem(KEY, '{not json');
    const h = renderFavorites();
    await h.run(() => {});
    expect(h.current.favorites).toEqual([]);
    h.unmount();
  });

  it('sanitizes on load: non-strings, blanks and duplicates are dropped, order kept', async () => {
    window.localStorage.setItem(KEY, JSON.stringify(['na1', 42, '', 'ja3', 'na1', null]));
    const h = renderFavorites();
    await h.run(() => {});
    expect(h.current.favorites).toEqual(['na1', 'ja3']);
    h.unmount();
  });
});

describe('useFavorites on createReactiveStore — write path', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('toggle adds, persists, and toggling again removes', async () => {
    const h = renderFavorites();
    await h.run((s) => s.toggle('na1'));
    expect(h.current.favorites).toEqual(['na1']);
    expect(persisted()).toEqual(['na1']);

    await h.run((s) => s.toggle('na1'));
    expect(h.current.favorites).toEqual([]);
    expect(h.current.isFavorite('na1')).toBe(false);
    expect(persisted()).toEqual([]);
    h.unmount();
  });

  it('chained toggles in ONE handler compose (commit reads the freshest persisted base)', async () => {
    const h = renderFavorites();
    await h.run((s) => {
      s.toggle('na1');
      s.toggle('ja3');
    });
    expect(h.current.favorites).toEqual(['na1', 'ja3']);
    expect(persisted()).toEqual(['na1', 'ja3']);
    h.unmount();
  });

  it('a write survives a remount — the reload case', async () => {
    const a = renderFavorites();
    await a.run((s) => s.toggle('na1'));
    a.unmount();

    const b = renderFavorites();
    await b.run(() => {});
    expect(b.current.favorites).toEqual(['na1']);
    b.unmount();
  });

  it('two mounted instances stay in lockstep via the same-tab CustomEvent', async () => {
    const a = renderFavorites();
    const b = renderFavorites();
    await a.run((s) => s.toggle('na1'));
    expect(a.current.favorites).toEqual(['na1']);
    expect(b.current.favorites).toEqual(['na1']); // b never called toggle
    a.unmount();
    b.unmount();
  });

  it('a cross-tab `storage` event on THIS key re-reads; an unrelated key does not', async () => {
    const h = renderFavorites();
    await h.run(() => {});
    expect(h.current.favorites).toEqual([]);

    // Another tab wrote the slot. jsdom does not fire `storage` for same-window writes, so the
    // event is synthesised — the point under test is the factory's key match, not jsdom.
    window.localStorage.setItem(KEY, JSON.stringify(['na1']));
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'some_other_key' }));
      await Promise.resolve();
    });
    expect(h.current.favorites).toEqual([]); // unrelated key ignored

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
      await Promise.resolve();
    });
    expect(h.current.favorites).toEqual(['na1']);
    h.unmount();
  });

  it('the exported event name is the one the store dispatches on', async () => {
    const seen: string[] = [];
    const listener = () => seen.push(FAVORITES_CHANGED_EVENT);
    window.addEventListener(FAVORITES_CHANGED_EVENT, listener);
    const h = renderFavorites();
    await h.run((s) => s.toggle('na1'));
    window.removeEventListener(FAVORITES_CHANGED_EVENT, listener);
    expect(seen).toHaveLength(1);
    h.unmount();
  });
});
