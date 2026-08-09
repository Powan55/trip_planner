// @vitest-environment jsdom
//
// S217 — docs-checklist hook (`hooks/use-docs.ts`), exercised by RENDERING the real hook (a tiny
// renderHook shim over react-dom/client + act — no new dependency, mirrors use-packing.test.ts).
// Proves: hydrate-seeds-the-built-in-template, toggle/setNote persist through gateway key 25
// (byte-transport proof), RELOAD (unmount+remount) survives (the hard guarantee), completion updates,
// cross-instance sync via the CustomEvent fan-out, a corrupt slot degrades to the template, AND the
// DORMANT byte-identity gate — with no firebase env, a toggle writes NO rev/hlc field (D-038).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useDocs } from '@/hooks/use-docs';
import type { DocsStore } from '@/hooks/use-docs';
import { DEFAULT_TEMPLATE } from '@/core/docs/model';

const KEY = 'nepal_japan_docs_checklist';

interface HookHandle {
  current: DocsStore;
  run: (fn: (store: DocsStore) => void) => Promise<void>;
  rerenderFresh: () => Promise<void>;
  unmount: () => void;
}

function renderDocs(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root = createRoot(container);
  const ref: { current: DocsStore } = { current: null as unknown as DocsStore };

  function Probe() {
    ref.current = useDocs();
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

describe('useDocs (S217)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts hydrated with the built-in 18-item template, all unchecked, completion 0/18', async () => {
    const h = renderDocs();
    await h.run(() => {});
    expect(h.current.hydrated).toBe(true);
    expect(h.current.items).toHaveLength(18);
    expect(h.current.completion.done).toBe(0);
    expect(h.current.completion.total).toBe(18);
    expect(h.current.completion.perSection).toEqual({
      critical: { done: 0, total: 10 },
      dayzero: { done: 0, total: 8 },
    });
    h.unmount();
  });

  it('toggleItem checks an item, persists it, and updates completion', async () => {
    const h = renderDocs();
    await h.run(() => {});
    const id = h.current.items[0].id;
    await h.run((s) => s.toggleItem(id));
    expect(h.current.items.find((i) => i.id === id)?.checked).toBe(true);
    expect(h.current.completion.done).toBe(1);
    const stored = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(stored.find((i: { id: string }) => i.id === id).checked).toBe(true);
    h.unmount();
  });

  it('DORMANT (no firebase env) — a toggle writes NO sync field (D-038 byte-identity)', async () => {
    const h = renderDocs();
    await h.run(() => {});
    const id = h.current.items[0].id;
    await h.run((s) => s.toggleItem(id));
    const stored = JSON.parse(window.localStorage.getItem(KEY) as string);
    const row = stored.find((i: { id: string }) => i.id === id);
    expect(row.rev).toBeUndefined();
    expect(row.hlc).toBeUndefined();
    expect(row.updatedBy).toBeUndefined();
    expect(Object.keys(row).sort()).toEqual(['checked', 'id', 'label', 'section']);
    h.unmount();
  });

  it('setNote persists a trimmed note and clears it on empty', async () => {
    const h = renderDocs();
    await h.run(() => {});
    const id = h.current.items[0].id;
    await h.run((s) => s.setNote(id, '  policy #7 ')); // trims
    expect(h.current.items.find((i) => i.id === id)?.note).toBe('policy #7');
    const stored = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(stored.find((i: { id: string }) => i.id === id).note).toBe('policy #7');
    await h.run((s) => s.setNote(id, '   '));
    expect('note' in (h.current.items.find((i) => i.id === id) as object)).toBe(false);
    h.unmount();
  });

  it('RELOAD (unmount + remount) — checked + note survive (the hard guarantee)', async () => {
    const h = renderDocs();
    await h.run(() => {});
    const id = h.current.items[0].id;
    await h.run((s) => s.toggleItem(id));
    await h.run((s) => s.setNote(id, 'expiry 2029'));
    await h.rerenderFresh();
    const row = h.current.items.find((i) => i.id === id);
    expect(row?.checked).toBe(true);
    expect(row?.note).toBe('expiry 2029');
    expect(h.current.completion.done).toBe(1);
    h.unmount();
  });

  it('two instances stay in sync via the same-tab CustomEvent', async () => {
    const a = renderDocs();
    const b = renderDocs();
    await a.run(() => {});
    await b.run(() => {});
    const id = a.current.items[0].id;
    await a.run((s) => s.toggleItem(id));
    expect(b.current.items.find((i) => i.id === id)?.checked).toBe(true);
    a.unmount();
    b.unmount();
  });

  it('a corrupt (non-array) persisted slot degrades to the template on hydrate, never throws', async () => {
    window.localStorage.setItem(KEY, '{not json');
    const h = renderDocs();
    await h.run(() => {});
    expect(h.current.items).toEqual(DEFAULT_TEMPLATE);
    h.unmount();
  });
});
