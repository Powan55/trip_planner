// @vitest-environment jsdom
//
// S270 — regression test for the wake-lock re-acquire bug. `navigator.wakeLock`
// isn't real in jsdom, so it's mocked to return a fake EventTarget-style
// sentinel (`addEventListener`/`release`), mirroring lib/__tests__/use-online.test.ts's
// tiny renderHook shim (react-dom/client + act — no new dependency).
//
// Proves the full re-acquire path: acquire -> sentinel fires 'release' (the
// browser auto-releasing the lock on backgrounding) -> visibilitychange back to
// 'visible' -> a SECOND request() call happens. On the unpatched hook, the
// release listener clears `held` but leaves `lockRef.current` pointing at the
// released sentinel, so the `!lockRef.current` re-acquire guard is false and
// request() is never called again — this test fails on that code.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useWakeLock } from '@/lib/use-wake-lock';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    writable: true,
    configurable: true,
  });
}

function makeFakeWakeLock() {
  const listeners: Record<string, Array<() => void>> = {};
  const request = vi.fn(async () => {
    const sentinel = {
      released: false,
      addEventListener: (type: string, cb: () => void) => {
        (listeners[type] ??= []).push(cb);
      },
      removeEventListener: () => {},
      release: vi.fn(async () => {
        sentinel.released = true;
      }),
    };
    return sentinel;
  });
  return {
    request,
    // Fires the most recently registered sentinel's 'release' listeners —
    // simulates the browser auto-releasing the lock on backgrounding.
    fireRelease: () => {
      listeners['release']?.forEach((cb) => cb());
    },
  };
}

async function renderWakeLock(active: boolean) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let held = false;

  function Probe() {
    held = useWakeLock(active).held;
    return null;
  }

  await act(async () => {
    root.render(createElement(Probe));
  });

  return {
    get held() {
      return held;
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function renderWakeLockToggle() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let held = false;

  function Probe({ active }: { active: boolean }) {
    held = useWakeLock(active).held;
    return null;
  }

  await act(async () => {
    root.render(createElement(Probe, { active: false }));
  });

  return {
    get held() {
      return held;
    },
    setActive: async (next: boolean) => {
      await act(async () => {
        root.render(createElement(Probe, { active: next }));
      });
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useWakeLock (S270 regression)', () => {
  let fake: ReturnType<typeof makeFakeWakeLock>;

  beforeEach(() => {
    setVisibility('visible');
    fake = makeFakeWakeLock();
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: fake.request },
      writable: true,
      configurable: true,
    });
  });

  it('re-acquires after an auto-release (backgrounding) followed by visibilitychange to visible', async () => {
    const h = await renderWakeLock(true);
    expect(fake.request).toHaveBeenCalledTimes(1);
    expect(h.held).toBe(true);

    // Browser auto-releases the lock when the tab is backgrounded.
    await act(async () => {
      fake.fireRelease();
    });
    expect(h.held).toBe(false);

    // Tab is backgrounded then foregrounded again.
    setVisibility('hidden');
    setVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(fake.request).toHaveBeenCalledTimes(2);
    expect(h.held).toBe(true);

    h.unmount();
  });

  // Issue #247 — the /map wake-lock toggle passes its OFF-by-default `wakeLockOn` state
  // straight through as `active`, so this is the same guarantee that toggle relies on:
  // nothing is requested while inactive, and a lock is acquired/released only in direct
  // response to `active` flipping — never on mount, never by default.
  it('never requests a lock while inactive; acquires only after active flips true, releases when it flips back', async () => {
    const h = await renderWakeLockToggle();
    expect(fake.request).not.toHaveBeenCalled();
    expect(h.held).toBe(false);

    await h.setActive(true);
    expect(fake.request).toHaveBeenCalledTimes(1);
    expect(h.held).toBe(true);

    await h.setActive(false);
    expect(h.held).toBe(false);

    h.unmount();
  });
});
