// @vitest-environment jsdom
//
// Identity stability for `hooks/use-presence.ts`. The hook rebuilt its list in the render body,
// re-reading the clock each time, so every render produced a fresh array — one consumer only maps
// over it today, but any `useEffect` depending on it loops. These cases pin the memo: a re-render
// that changes none of the inputs returns the SAME reference and does not re-read the clock, while
// a snapshot still produces a new one. Same module mocks as lib/__tests__/use-presence.test.ts
// (`@/lib/presence` is the firebase-only seam, reached via a dynamic import inside the effect),
// which keeps owning the filter/accent/eviction/identity-gate behaviour.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { firebaseConfigMock } from '@/lib/__tests__/firebase-config-mock';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const presenceCtl = vi.hoisted(() => ({
  calls: 0,
  cb: null as null | ((records: Array<{ uid: string; name: string; lastSeen: number | null }>) => void),
}));
vi.mock('@/lib/presence', () => ({
  subscribePresence: (cb: (records: Array<{ uid: string; name: string; lastSeen: number | null }>) => void) => {
    presenceCtl.calls += 1;
    presenceCtl.cb = cb;
    return () => {};
  },
}));

const gate = vi.hoisted(() => ({
  remoteOn: true,
  traveler: null as null | { name: string; token: string; accent: string },
}));
vi.mock('@/lib/firebase-config', (io) =>
  firebaseConfigMock(io, () => gate.remoteOn, 'nepal-japan-2026'));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => gate.traveler };
});

import { usePresence, type ActivePresence } from '@/hooks/use-presence';

const ALINA = { name: 'Alina', token: 'Alina', accent: '#FFC43D' };

interface HookHandle {
  current: ActivePresence[];
  renders: number;
  /** Re-render the SAME root with a new prop — the hook's own state is untouched. */
  rerender: () => void;
  unmount: () => void;
}

function renderPresence(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref: { current: ActivePresence[] } = { current: [] };
  let renders = 0;
  let nonce = 0;

  function Probe(_props: { nonce: number }) {
    ref.current = usePresence();
    renders += 1;
    return null;
  }

  act(() => {
    root.render(createElement(Probe, { nonce }));
  });

  return {
    get current() {
      return ref.current;
    },
    get renders() {
      return renders;
    },
    rerender() {
      nonce += 1;
      act(() => {
        root.render(createElement(Probe, { nonce }));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('usePresence — returned identity is stable across re-renders', () => {
  beforeEach(() => {
    presenceCtl.calls = 0;
    presenceCtl.cb = null;
    gate.remoteOn = true;
    gate.traveler = null;
  });

  it('empty list: the same array reference survives re-renders that change no input', () => {
    const h = renderPresence();
    const first = h.current;
    h.rerender();
    h.rerender();
    expect(h.renders).toBe(3); // the probe really did re-render
    expect(h.current).toEqual([]);
    expect(h.current).toBe(first);
    h.unmount();
  });

  it('populated list: a snapshot yields a NEW reference, then that reference is stable', async () => {
    gate.traveler = ALINA;
    const h = renderPresence();
    await flush();
    expect(presenceCtl.calls).toBe(1);
    const empty = h.current;

    act(() => {
      presenceCtl.cb?.([{ uid: 'u-rhea', name: 'Rhea', lastSeen: Date.now() }]);
    });
    const populated = h.current;
    expect(populated).not.toBe(empty); // a real change still re-derives
    expect(populated.map((p) => p.name)).toEqual(['Rhea']);

    const rendersBefore = h.renders;
    h.rerender();
    h.rerender();
    expect(h.renders).toBe(rendersBefore + 2);
    expect(h.current).toBe(populated);
    h.unmount();
  });

  it('a render that changes no input does not re-derive: the clock is not read again', () => {
    const h = renderPresence();
    const spy = vi.spyOn(Date, 'now');
    h.rerender();
    h.rerender();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    h.unmount();
  });
});
