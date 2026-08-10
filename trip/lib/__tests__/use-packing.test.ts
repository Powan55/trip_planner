// @vitest-environment jsdom
//
// S206 — packing checklist hook (`hooks/use-packing.ts`), exercised by RENDERING the real hook (a
// tiny renderHook shim over react-dom/client + act — no new dependency, mirrors
// lib/__tests__/use-favorites.test.ts). Proves: hydrate-seeds-the-built-in-template,
// toggle-persists-through-the-gateway-key-21 `packingStore` (byte-transport proof), reload
// (unmount+remount) survives (the S206 hard guarantee — same bar as itinerary CRUD), progress
// updates, cross-instance sync via the CustomEvent fan-out, and a corrupt persisted slot degrades
// to the template (never throws).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { usePacking } from '@/hooks/use-packing';
import type { PackingStore } from '@/hooks/use-packing';
import { DEFAULT_TEMPLATE } from '@/core/packing/model';

const KEY = 'nepal_japan_packing';

interface HookHandle {
  current: PackingStore;
  run: (fn: (store: PackingStore) => void) => Promise<void>;
  rerenderFresh: () => Promise<void>; // unmount + remount = a "reload" (re-reads localStorage)
  unmount: () => void;
}

function renderPacking(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root = createRoot(container);
  const ref: { current: PackingStore } = { current: null as unknown as PackingStore };

  function Probe() {
    ref.current = usePacking();
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

describe('usePacking (S206)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts hydrated with the built-in 28-item template, all unchecked, progress 0/28', async () => {
    const h = renderPacking();
    await h.run(() => {});
    expect(h.current.hydrated).toBe(true);
    expect(h.current.items).toHaveLength(28);
    expect(h.current.items.every((i) => i.checked === false)).toBe(true);
    expect(h.current.progress).toEqual({ checked: 0, total: 28 });
    h.unmount();
  });

  it('toggleItem checks an item, persists it, and updates progress', async () => {
    const h = renderPacking();
    await h.run(() => {});
    const id = h.current.items[0].id;
    await h.run((store) => store.toggleItem(id));
    expect(h.current.items.find((i) => i.id === id)?.checked).toBe(true);
    expect(h.current.progress).toEqual({ checked: 1, total: 28 });
    const stored = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(stored.find((i: { id: string }) => i.id === id).checked).toBe(true);
    h.unmount();
  });

  it('toggleItem again UNCHECKS it (idempotent toggle)', async () => {
    const h = renderPacking();
    await h.run(() => {});
    const id = h.current.items[0].id;
    await h.run((store) => store.toggleItem(id));
    await h.run((store) => store.toggleItem(id));
    expect(h.current.items.find((i) => i.id === id)?.checked).toBe(false);
    expect(h.current.progress).toEqual({ checked: 0, total: 28 });
    h.unmount();
  });

  it('multiple items toggle independently', async () => {
    const h = renderPacking();
    await h.run(() => {});
    const [a, b] = [h.current.items[0].id, h.current.items[1].id];
    await h.run((store) => store.toggleItem(a));
    await h.run((store) => store.toggleItem(b));
    expect(h.current.progress).toEqual({ checked: 2, total: 28 });
    await h.run((store) => store.toggleItem(a));
    expect(h.current.progress).toEqual({ checked: 1, total: 28 });
    expect(h.current.items.find((i) => i.id === b)?.checked).toBe(true);
    h.unmount();
  });

  it('RELOAD (unmount + remount) — checked state survives (the S206 hard guarantee)', async () => {
    const h = renderPacking();
    await h.run(() => {});
    const id = h.current.items[0].id;
    await h.run((store) => store.toggleItem(id));
    await h.rerenderFresh();
    expect(h.current.items.find((i) => i.id === id)?.checked).toBe(true);
    expect(h.current.progress).toEqual({ checked: 1, total: 28 });
    h.unmount();
  });

  it('two instances stay in sync via the same-tab CustomEvent (mirrors journal/favorites)', async () => {
    const a = renderPacking();
    const b = renderPacking();
    await a.run(() => {});
    await b.run(() => {});
    const id = a.current.items[0].id;
    await a.run((store) => store.toggleItem(id));
    // `b` never called toggleItem itself but should observe the change via the fan-out.
    expect(b.current.items.find((i) => i.id === id)?.checked).toBe(true);
    a.unmount();
    b.unmount();
  });

  it('a corrupt (non-array) persisted slot degrades to the built-in template on hydrate, never throws', async () => {
    window.localStorage.setItem(KEY, '{not json');
    const h = renderPacking();
    await h.run(() => {});
    expect(h.current.items).toEqual(DEFAULT_TEMPLATE);
    h.unmount();
  });
});
