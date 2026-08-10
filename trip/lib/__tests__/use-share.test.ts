// @vitest-environment jsdom
//
// S220 — share-inbox hook (`hooks/use-share.ts`), exercised by RENDERING the real hook (a tiny
// renderHook shim over react-dom/client + act — no new dependency, mirrors use-packing.test.ts).
// Proves: hydrate-seeds-the-empty-inbox, add/remove/assignDay persist through the gateway-key-23
// `shareInboxStore` (byte-transport proof), reload (unmount+remount) survives, cap-100 drop-oldest
// through the real commit path, cross-instance sync via the CustomEvent fan-out, and a corrupt slot
// degrades to [] (never throws).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useShare, type ShareStore } from '@/hooks/use-share';
import { SHARE_CAP } from '@/core/share/model';
import { TRIP_DATES } from '@/core/dates';

const KEY = 'nepal_japan_share_inbox';

interface HookHandle {
  current: ShareStore;
  run: (fn: (store: ShareStore) => void) => Promise<void>;
  rerenderFresh: () => Promise<void>;
  unmount: () => void;
}

function renderShare(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root = createRoot(container);
  const ref: { current: ShareStore } = { current: null as unknown as ShareStore };

  function Probe() {
    ref.current = useShare();
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

describe('useShare (S220)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts hydrated with an empty inbox', async () => {
    const h = renderShare();
    await h.run(() => {});
    expect(h.current.hydrated).toBe(true);
    expect(h.current.items).toEqual([]);
    h.unmount();
  });

  it('addShare prepends a received item (newest-first), persists it through the gateway', async () => {
    const h = renderShare();
    await h.run(() => {});
    await h.run((s) => s.addShare({ title: 'First', url: 'https://a.co' }));
    await h.run((s) => s.addShare({ text: 'Second' }));
    expect(h.current.items).toHaveLength(2);
    expect(h.current.items[0].text).toBe('Second'); // newest first
    expect(h.current.items[0].id).toMatch(/^share-/);
    expect(h.current.items[0].receivedAt).toEqual(expect.any(String));
    const stored = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(stored).toHaveLength(2);
    h.unmount();
  });

  it('removeShare deletes an item and persists the removal', async () => {
    const h = renderShare();
    await h.run(() => {});
    await h.run((s) => s.addShare({ text: 'A' }));
    const id = h.current.items[0].id;
    await h.run((s) => s.removeShare(id));
    expect(h.current.items).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(KEY) as string)).toEqual([]);
    h.unmount();
  });

  it('assignDay sets an in-bounds trip day and persists it', async () => {
    const h = renderShare();
    await h.run(() => {});
    await h.run((s) => s.addShare({ url: 'https://a.co' }));
    const id = h.current.items[0].id;
    const day = TRIP_DATES[2];
    await h.run((s) => s.assignDay(id, day));
    expect(h.current.items[0].day).toBe(day);
    await h.run((s) => s.assignDay(id, undefined));
    expect(h.current.items[0].day).toBeUndefined();
    h.unmount();
  });

  it('RELOAD (unmount + remount) — a received item + its day assignment survive', async () => {
    const h = renderShare();
    await h.run(() => {});
    await h.run((s) => s.addShare({ title: 'Keep me', url: 'https://a.co' }));
    const id = h.current.items[0].id;
    await h.run((s) => s.assignDay(id, TRIP_DATES[1]));
    await h.rerenderFresh();
    expect(h.current.items).toHaveLength(1);
    expect(h.current.items[0].title).toBe('Keep me');
    expect(h.current.items[0].day).toBe(TRIP_DATES[1]);
    h.unmount();
  });

  it('cap-100 drop-oldest holds through the real commit path', async () => {
    const h = renderShare();
    await h.run(() => {});
    for (let i = 0; i < SHARE_CAP + 5; i++) {
      await h.run((s) => s.addShare({ text: `item ${i}` }));
    }
    expect(h.current.items).toHaveLength(SHARE_CAP);
    // The most recent add is at the head; the earliest adds were evicted.
    expect(h.current.items[0].text).toBe(`item ${SHARE_CAP + 4}`);
    h.unmount();
  });

  it('two instances stay in sync via the same-tab CustomEvent', async () => {
    const a = renderShare();
    const b = renderShare();
    await a.run(() => {});
    await b.run(() => {});
    await a.run((s) => s.addShare({ text: 'shared across instances' }));
    expect(b.current.items).toHaveLength(1);
    expect(b.current.items[0].text).toBe('shared across instances');
    a.unmount();
    b.unmount();
  });

  it('a corrupt persisted slot degrades to [] on hydrate, never throws', async () => {
    window.localStorage.setItem(KEY, '{not json');
    const h = renderShare();
    await h.run(() => {});
    expect(h.current.items).toEqual([]);
    h.unmount();
  });
});
