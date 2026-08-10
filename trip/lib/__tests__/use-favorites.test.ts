// @vitest-environment jsdom
//
// S149 — favorites/bookmarks hook (`hooks/use-favorites.ts`), exercised by RENDERING the real
// hook (a tiny renderHook shim over react-dom/client + act — no new dependency, mirrors
// lib/__tests__/use-itinerary-sync.test.ts). Proves: hydrate-from-storage, toggle add/remove is
// idempotent, persistence through the gateway key-14 `favoritesStore` (byte-transport proof),
// reload (unmount+remount) survives, cross-instance sync via the CustomEvent fan-out (two
// sections on one page stay in lockstep — the same guarantee `use-expenses`/`use-journal` give
// the budget panel + expense dialog), and a corrupt/non-array persisted slot degrades to [].

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useFavorites, type FavoritesStoreApi } from '@/hooks/use-favorites';
import { MAP_MARKERS } from '@/lib/map-data';
import { NEPAL_ATTRACTIONS, NEPAL_FOOD } from '@/lib/nepal-data';
import { JAPAN_ATTRACTIONS, JAPAN_FOOD } from '@/lib/japan-data';

const KEY = 'nepal_japan_favorites';

interface HookHandle {
  current: FavoritesStoreApi;
  run: (fn: (store: FavoritesStoreApi) => void) => Promise<void>;
  rerenderFresh: () => Promise<void>; // unmount + remount = a "reload" (re-reads localStorage)
  unmount: () => void;
}

function renderFavorites(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root = createRoot(container);
  const ref: { current: FavoritesStoreApi } = { current: null as unknown as FavoritesStoreApi };

  function Probe() {
    ref.current = useFavorites();
    return null;
  }

  act(() => {
    root.render(createElement(Probe));
  });

  const handle: HookHandle = {
    get current() {
      return ref.current;
    },
    async run(fn) {
      await act(async () => {
        fn(ref.current);
        await Promise.resolve();
      });
    },
    async rerenderFresh() {
      act(() => root.unmount());
      root = createRoot(container);
      act(() => {
        root.render(createElement(Probe));
      });
      await act(async () => {
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
  return handle;
}

describe('useFavorites (S149)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts empty + hydrated after mount (no favorites persisted)', async () => {
    const h = renderFavorites();
    await h.run(() => {});
    expect(h.current.hydrated).toBe(true);
    expect(h.current.favorites).toEqual([]);
    expect(h.current.isFavorite('na1')).toBe(false);
    h.unmount();
  });

  it('toggle adds an id, persists it, and isFavorite reflects it', async () => {
    const h = renderFavorites();
    await h.run((store) => store.toggle('na1'));
    expect(h.current.favorites).toEqual(['na1']);
    expect(h.current.isFavorite('na1')).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(KEY) as string)).toEqual(['na1']);
    h.unmount();
  });

  it('toggle again REMOVES the id (idempotent add/remove)', async () => {
    const h = renderFavorites();
    await h.run((store) => store.toggle('na1'));
    await h.run((store) => store.toggle('na1'));
    expect(h.current.favorites).toEqual([]);
    expect(h.current.isFavorite('na1')).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(KEY) as string)).toEqual([]);
    h.unmount();
  });

  it('multiple ids toggle independently', async () => {
    const h = renderFavorites();
    await h.run((store) => store.toggle('na1'));
    await h.run((store) => store.toggle('ja3'));
    expect(h.current.favorites.sort()).toEqual(['ja3', 'na1']);
    await h.run((store) => store.toggle('na1'));
    expect(h.current.favorites).toEqual(['ja3']);
    h.unmount();
  });

  it('RELOAD (unmount + remount) — a favorited id survives', async () => {
    const h = renderFavorites();
    await h.run((store) => store.toggle('na1'));
    await h.rerenderFresh();
    expect(h.current.favorites).toEqual(['na1']);
    expect(h.current.isFavorite('na1')).toBe(true);
    h.unmount();
  });

  it('two instances stay in sync via the same-tab CustomEvent (mirrors budget/expenses)', async () => {
    const a = renderFavorites();
    const b = renderFavorites();
    await a.run((store) => store.toggle('na1'));
    // `b` never called toggle itself but should observe the change via the fan-out.
    expect(b.current.favorites).toEqual(['na1']);
    a.unmount();
    b.unmount();
  });

  it('a corrupt (non-array) persisted slot degrades to [] on hydrate, never throws', async () => {
    window.localStorage.setItem(KEY, '{not json');
    const h = renderFavorites();
    await h.run(() => {});
    expect(h.current.favorites).toEqual([]);
    h.unmount();
  });

  it('a persisted slot with non-string/duplicate entries is sanitized on hydrate', async () => {
    window.localStorage.setItem(KEY, JSON.stringify(['na1', 'na1', 42, null, '']));
    const h = renderFavorites();
    await h.run(() => {});
    expect(h.current.favorites).toEqual(['na1']);
    h.unmount();
  });

  // FU-34: map-marker favorites (`components/trip-map.tsx`'s popup heart) and guide
  // favorites (`components/recommendation-section.tsx`) share this SAME flat store
  // (D-130) — raw ids, no namespacing. That's only safe because the two id spaces
  // never collide: map ids are `np-*`/`jp-*` kebab (lib/map-data.ts), guide rec ids
  // are `na#`/`nf#`/`ja#`/`jf#` short codes (lib/nepal-data.ts, lib/japan-data.ts).
  // This guard fails loudly if either id scheme ever drifts into the other's territory.
  it('id-disjointness guard (FU-34): map marker ids and guide rec ids never collide', () => {
    const mapIds = new Set(MAP_MARKERS.map((m) => m.id));
    const recIds = new Set(
      [...NEPAL_ATTRACTIONS, ...NEPAL_FOOD, ...JAPAN_ATTRACTIONS, ...JAPAN_FOOD].map((r) => r.id),
    );
    expect(mapIds.size).toBeGreaterThan(0);
    expect(recIds.size).toBeGreaterThan(0);
    const overlap = [...mapIds].filter((id) => recIds.has(id));
    expect(overlap).toEqual([]);
    // Shape guard, not just a snapshot: every map id is np-*/jp-* kebab, every rec id
    // is a na#/nf#/ja#/jf# short-code — so a raw `toggle(id)` from either surface can
    // never be ambiguous even if new ids are added later.
    for (const id of mapIds) expect(id).toMatch(/^(np|jp)-[a-z0-9-]+$/);
    for (const id of recIds) expect(id).toMatch(/^(na|nf|ja|jf)\d+$/);
  });
});
