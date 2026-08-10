// @vitest-environment jsdom
//
// S154 — connectivity hook (`hooks/use-online.ts`), exercised by RENDERING the real
// hook (a tiny renderHook shim over react-dom/client + act — no new dependency,
// mirrors lib/__tests__/use-favorites.test.ts). Proves: the SSR-safe default (true)
// is corrected to the real navigator.onLine reading on mount, it flips live on
// window 'online'/'offline' events, and it removes both listeners on unmount.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useOnline } from '@/hooks/use-online';

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    value,
    writable: true,
    configurable: true,
  });
}

interface HookHandle {
  current: boolean;
  unmount: () => void;
}

function renderOnline(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref: { current: boolean } = { current: true };

  function Probe() {
    ref.current = useOnline();
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

describe('useOnline (S154)', () => {
  beforeEach(() => {
    setNavigatorOnLine(true);
  });

  it('defaults to online and confirms true when navigator.onLine is true on mount', () => {
    const h = renderOnline();
    expect(h.current).toBe(true);
    h.unmount();
  });

  it('SSR-safe correction: picks up navigator.onLine === false in the mount effect', () => {
    setNavigatorOnLine(false);
    const h = renderOnline();
    expect(h.current).toBe(false);
    h.unmount();
  });

  it('flips to false on an "offline" event and back to true on "online"', () => {
    const h = renderOnline();
    expect(h.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(h.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(h.current).toBe(true);

    h.unmount();
  });

  it('removes its online/offline listeners on unmount (no leak)', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const h = renderOnline();
    const addedOnline = addSpy.mock.calls.filter(([type]) => type === 'online').length;
    const addedOffline = addSpy.mock.calls.filter(([type]) => type === 'offline').length;
    expect(addedOnline).toBe(1);
    expect(addedOffline).toBe(1);

    h.unmount();
    const removedOnline = removeSpy.mock.calls.filter(([type]) => type === 'online').length;
    const removedOffline = removeSpy.mock.calls.filter(([type]) => type === 'offline').length;
    expect(removedOnline).toBe(1);
    expect(removedOffline).toBe(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('after unmount, further online/offline events do not throw', () => {
    const h = renderOnline();
    h.unmount();
    expect(() => window.dispatchEvent(new Event('offline'))).not.toThrow();
    expect(() => window.dispatchEvent(new Event('online'))).not.toThrow();
  });
});
