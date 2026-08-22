// @vitest-environment jsdom
//
// S154 — connectivity hook (`hooks/use-online.ts`), exercised by RENDERING the real
// hook (a tiny renderHook shim over react-dom/client + act — no new dependency,
// mirrors lib/__tests__/use-favorites.test.ts). Proves: the SSR-safe default (true)
// is corrected to the real navigator.onLine reading on mount, it flips live on
// window 'online'/'offline' events, and it removes both listeners on unmount.
//
// Second half: `navigator.onLine` is not the truth. It reports that an interface
// exists, so a captive portal or a dead uplink reads "Online" while every request
// fails — the one moment the offline banner exists for. The hook keeps it as the fast
// NEGATIVE and corroborates the POSITIVE from the outcome of requests the app already
// makes, via a single fetch wrapper. Those tests are below.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useOnline, REACHABILITY_SUSPECT_MS } from '@/hooks/use-online';

// Installed BEFORE any mount, because the hook's fetch witness wraps whatever
// `window.fetch` is when the first consumer mounts (and jsdom ships no fetch).
let fetchOutcome: { kind: 'ok' } | { kind: 'reject'; name?: string } = { kind: 'ok' };
const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
Object.defineProperty(window, 'fetch', {
  configurable: true,
  writable: true,
  value: async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    if (fetchOutcome.kind === 'reject') {
      const err = new Error('stub network failure');
      if (fetchOutcome.name) err.name = fetchOutcome.name;
      throw err;
    }
    return { ok: true, status: 200 } as unknown as Response;
  },
});

const CROSS_ORIGIN = 'https://api.open-meteo.com/v1/forecast?lat=1';
const SAME_ORIGIN = '/trip_planner/_next/static/chunks/app-1234abcd.js';

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

// Reachability is module state (it is a property of the network, not of a component),
// so clear it between tests through the public surface: a mounted hook's 'online'
// handler re-arms it.
function resetReachability() {
  const h = renderOnline();
  act(() => {
    window.dispatchEvent(new Event('online'));
  });
  h.unmount();
}

describe('useOnline (S154)', () => {
  beforeEach(() => {
    setNavigatorOnLine(true);
    fetchOutcome = { kind: 'ok' };
    fetchCalls.length = 0;
    resetReachability();
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

describe('useOnline — reachability corroborated from real traffic', () => {
  beforeEach(() => {
    setNavigatorOnLine(true);
    fetchOutcome = { kind: 'ok' };
    fetchCalls.length = 0;
    resetReachability();
  });

  async function fetchOnce(url: string, init?: RequestInit) {
    await act(async () => {
      await window.fetch(url, init).catch(() => undefined);
    });
  }

  it('the captive-portal case: navigator.onLine stays true, but a failed cross-origin request reads as offline', async () => {
    const h = renderOnline();
    expect(h.current).toBe(true);

    fetchOutcome = { kind: 'reject' };
    await fetchOnce(CROSS_ORIGIN);

    expect(window.navigator.onLine).toBe(true); // the flag still claims a connection
    expect(h.current).toBe(false);
    h.unmount();
  });

  it('a later successful cross-origin request clears it again', async () => {
    const h = renderOnline();
    fetchOutcome = { kind: 'reject' };
    await fetchOnce(CROSS_ORIGIN);
    expect(h.current).toBe(false);

    fetchOutcome = { kind: 'ok' };
    await fetchOnce(CROSS_ORIGIN);
    expect(h.current).toBe(true);
    h.unmount();
  });

  it('an "online" event re-arms reachability, so one failure cannot pin the banner open', async () => {
    const h = renderOnline();
    fetchOutcome = { kind: 'reject' };
    await fetchOnce(CROSS_ORIGIN);
    expect(h.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(h.current).toBe(true);
    h.unmount();
  });

  it('ignores same-origin failures — the service worker answers those, so they say nothing about the network', async () => {
    const h = renderOnline();
    fetchOutcome = { kind: 'reject' };
    await fetchOnce(SAME_ORIGIN);
    expect(h.current).toBe(true);
    h.unmount();
  });

  it('ignores an aborted request — that is the caller hanging up, not an outage', async () => {
    const h = renderOnline();
    fetchOutcome = { kind: 'reject', name: 'AbortError' };
    await fetchOnce(CROSS_ORIGIN);
    expect(h.current).toBe(true);
    h.unmount();
  });

  // The case above was pinned and this one was not, which is how the suite stayed green over
  // it: `AbortSignal.timeout()` rejects with `TimeoutError`, a DIFFERENT name, and the
  // concierge runs a 45s one against a cross-origin Worker. Reading that as an outage marked
  // the app offline, and `use-concierge-chat.ts` then refuses to send at all — so the one
  // request that could have disproved it never left the device.
  it('ignores a timed-out request — AbortSignal.timeout() is our deadline, not the network’s', async () => {
    const h = renderOnline();
    fetchOutcome = { kind: 'reject', name: 'TimeoutError' };
    await fetchOnce(CROSS_ORIGIN);
    expect(h.current).toBe(true);
    h.unmount();
  });

  // The other half, and the one that matters for every OTHER cross-origin failure (a blocked
  // weather host, an ad blocker, a DNS blip): the negative is a guess, so it expires. Without
  // this, one failure pins the banner and the concierge for the rest of the session, because
  // the only re-arm is an `online` event that never fires on a link that never dropped.
  it('a suspected outage expires instead of latching for the session', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const h = renderOnline();
      fetchOutcome = { kind: 'reject' };
      await fetchOnce(CROSS_ORIGIN);
      expect(h.current).toBe(false);

      // Not yet — the window is still open.
      act(() => {
        vi.advanceTimersByTime(REACHABILITY_SUSPECT_MS - 1);
      });
      expect(h.current).toBe(false);

      act(() => {
        vi.advanceTimersByTime(2);
      });
      expect(h.current).toBe(true);
      h.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a fresh failure re-arms the window, so a real outage is not cleared mid-run', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const h = renderOnline();
      fetchOutcome = { kind: 'reject' };
      await fetchOnce(CROSS_ORIGIN);

      act(() => {
        vi.advanceTimersByTime(REACHABILITY_SUSPECT_MS - 1000);
      });
      await fetchOnce(CROSS_ORIGIN);
      act(() => {
        vi.advanceTimersByTime(1001);
      });
      // The first window would have expired here; the second failure moved it.
      expect(h.current).toBe(false);
      h.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('navigator.onLine === false still wins, whatever the last request did', async () => {
    const h = renderOnline();
    fetchOutcome = { kind: 'ok' };
    await fetchOnce(CROSS_ORIGIN);
    expect(h.current).toBe(true);

    setNavigatorOnLine(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(h.current).toBe(false);
    h.unmount();
  });

  it('the witness observes without altering: response, init and rejection all pass through', async () => {
    const h = renderOnline();
    const controller = new AbortController();

    const res = await window.fetch(CROSS_ORIGIN, { method: 'GET', signal: controller.signal });
    expect(res.status).toBe(200);
    expect(fetchCalls.at(-1)?.url).toBe(CROSS_ORIGIN);
    // init reaches the underlying fetch untouched — an AbortSignal that got dropped
    // here would leak every superseded request in the app.
    expect(fetchCalls.at(-1)?.init?.signal).toBe(controller.signal);

    fetchOutcome = { kind: 'reject' };
    await expect(window.fetch(CROSS_ORIGIN)).rejects.toThrow('stub network failure');

    h.unmount();
  });

  it('installs the witness exactly once, not once per mount', () => {
    const first = renderOnline();
    const wrapped = window.fetch;
    first.unmount();
    const second = renderOnline();
    expect(window.fetch).toBe(wrapped);
    second.unmount();
  });
});
