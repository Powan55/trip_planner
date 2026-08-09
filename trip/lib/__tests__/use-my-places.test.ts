// @vitest-environment jsdom
//
// S284 — my-places hook (`hooks/use-my-places.ts`), exercised by RENDERING the real hook (the same
// renderHook shim as use-share.test.ts — no new dependency). Proves: hydrate-seeds-the-empty-
// collection, add/remove persist through the gateway-key-31 `myPlacesStore` (byte-transport proof),
// reload (unmount+remount) survives, cross-instance sync via the CustomEvent fan-out, and a corrupt
// slot degrades to [] (never throws).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useMyPlaces, type MyPlacesStore } from '@/hooks/use-my-places';

const KEY = 'nepal_japan_my_places';

interface HookHandle {
  current: MyPlacesStore;
  run: (fn: (store: MyPlacesStore) => void) => Promise<void>;
  rerenderFresh: () => Promise<void>;
  unmount: () => void;
}

function renderMyPlaces(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root = createRoot(container);
  const ref: { current: MyPlacesStore } = { current: null as unknown as MyPlacesStore };

  function Probe() {
    ref.current = useMyPlaces();
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
}

describe('useMyPlaces (S284)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts hydrated with an empty collection', async () => {
    const h = renderMyPlaces();
    await h.run(() => {});
    expect(h.current.hydrated).toBe(true);
    expect(h.current.places).toEqual([]);
    h.unmount();
  });

  it('addPlace prepends (newest-first) and persists through the gateway key', async () => {
    const h = renderMyPlaces();
    await h.run(() => {});
    await h.run((s) => s.addPlace({ name: 'Boudhanath', legId: 'nepal', sourceUrl: 'https://maps.app.goo.gl/a' }));
    await h.run((s) => s.addPlace({ name: 'Fushimi Inari', legId: 'japan' }));
    expect(h.current.places).toHaveLength(2);
    expect(h.current.places[0].name).toBe('Fushimi Inari'); // newest first
    expect(h.current.places[0].id).toEqual(expect.any(String));
    expect(h.current.places[0].addedAt).toEqual(expect.any(String));
    const stored = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(stored).toHaveLength(2);
    expect(stored[0].legId).toBe('japan');
    h.unmount();
  });

  it('honours a caller-provided id (so the sheet can stamp a matching myplace- sourceId)', async () => {
    const h = renderMyPlaces();
    await h.run(() => {});
    await h.run((s) => s.addPlace({ id: 'fixed-1', name: 'X', legId: 'nepal' }));
    expect(h.current.places[0].id).toBe('fixed-1');
    h.unmount();
  });

  it('removePlace deletes an item and persists the removal', async () => {
    const h = renderMyPlaces();
    await h.run(() => {});
    await h.run((s) => s.addPlace({ id: 'a', name: 'A', legId: 'nepal' }));
    await h.run((s) => s.removePlace('a'));
    expect(h.current.places).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(KEY) as string)).toEqual([]);
    h.unmount();
  });

  it('RELOAD (unmount + remount) — an imported place survives', async () => {
    const h = renderMyPlaces();
    await h.run(() => {});
    await h.run((s) => s.addPlace({ id: 'keep', name: 'Keep me', legId: 'japan', note: 'nice' }));
    await h.rerenderFresh();
    expect(h.current.places).toHaveLength(1);
    expect(h.current.places[0].name).toBe('Keep me');
    expect(h.current.places[0].note).toBe('nice');
    h.unmount();
  });

  it('two instances stay in sync via the same-tab CustomEvent', async () => {
    const a = renderMyPlaces();
    const b = renderMyPlaces();
    await a.run(() => {});
    await b.run(() => {});
    await a.run((s) => s.addPlace({ name: 'shared across instances', legId: 'nepal' }));
    expect(b.current.places).toHaveLength(1);
    expect(b.current.places[0].name).toBe('shared across instances');
    a.unmount();
    b.unmount();
  });

  it('a corrupt persisted slot degrades to [] on hydrate, never throws', async () => {
    window.localStorage.setItem(KEY, '{not json');
    const h = renderMyPlaces();
    await h.run(() => {});
    expect(h.current.places).toEqual([]);
    h.unmount();
  });
});
