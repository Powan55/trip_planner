// @vitest-environment jsdom
//
// S282 — coverage for hooks/use-presence.ts (D-057), exercised by RENDERING the real hook (the
// same renderHook shim over react-dom/client + act the sibling hook suites use — no new
// dependency). `@/lib/presence` is the browser/firebase-only seam (it is reached ONLY via a
// dynamic `import()` inside the effect, behind the SAME gate the itinerary provider's remote
// subscribe uses), so it is module-mocked (mirrors use-sync-status.test.ts / use-photos.test.ts's
// firebase-config + token-auth mocks). Proves: the dormant/guest short-circuit never calls
// subscribePresence (no dynamic-import work happens), the active-others filter excludes the
// viewer + enriches accent (known name → brand accent, unknown name → gold fallback), a stale
// heartbeat ages off on the eviction tick (fake timers), IDENTITY_CHANGED_EVENT re-opens/tears
// down the subscription live, and the SSR-safe `[]` on first paint (before the lazy import
// resolves).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

// Control handle for the mocked `@/lib/presence` subscribe seam.
const presenceCtl = vi.hoisted(() => ({
  calls: 0,
  cb: null as null | ((records: Array<{ uid: string; name: string; lastSeen: number | null }>) => void),
  unsubCalls: 0,
}));
vi.mock('@/lib/presence', () => ({
  subscribePresence: (cb: (records: Array<{ uid: string; name: string; lastSeen: number | null }>) => void) => {
    presenceCtl.calls += 1;
    presenceCtl.cb = cb;
    return () => {
      presenceCtl.unsubCalls += 1;
    };
  },
}));

const gate = vi.hoisted(() => ({
  remoteOn: true,
  traveler: null as null | { name: string; token: string; accent: string },
}));
vi.mock('@/lib/firebase-config', () => ({
  isRemoteConfigured: () => gate.remoteOn,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => gate.remoteOn,
}));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => gate.traveler };
});

import { usePresence, type ActivePresence } from '@/hooks/use-presence';
import { IDENTITY_CHANGED_EVENT } from '@/lib/token-auth';

const ACTIVE_WINDOW_MS = 2 * 180_000; // mirrors the hook's own copy (lib/presence.ts's ACTIVE_WINDOW_MS)
const POWAN = { name: 'Powan', token: 'Powan', accent: '#FFC43D' }; // gold-400

interface HookHandle {
  current: ActivePresence[];
  unmount: () => void;
}

function renderPresence(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref: { current: ActivePresence[] } = { current: [] };

  function Probe() {
    ref.current = usePresence();
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

/** Flush the microtask queue enough for the effect's `import('@/lib/presence').then(...)` to land. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('usePresence (S54/D-057)', () => {
  beforeEach(() => {
    presenceCtl.calls = 0;
    presenceCtl.cb = null;
    presenceCtl.unsubCalls = 0;
    gate.remoteOn = true;
    gate.traveler = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('SSR-safe: returns [] on first paint, before the lazy import resolves', () => {
    gate.traveler = POWAN;
    const h = renderPresence();
    // The mount effect ran synchronously (activate() started the dynamic import), but its
    // `.then` has not landed yet — subscribePresence has not been called, and the hook still
    // reports the initial empty list.
    expect(h.current).toEqual([]);
    expect(presenceCtl.calls).toBe(0);
    h.unmount();
  });

  it('DORMANT (isRemoteConfigured() false): never subscribes, returns []', async () => {
    gate.remoteOn = false;
    gate.traveler = POWAN;
    const h = renderPresence();
    await flush();
    expect(presenceCtl.calls).toBe(0); // no import('@/lib/presence') work landed
    expect(h.current).toEqual([]);
    h.unmount();
  });

  it('GUEST (no active traveler): never subscribes, returns []', async () => {
    gate.remoteOn = true;
    gate.traveler = null;
    const h = renderPresence();
    await flush();
    expect(presenceCtl.calls).toBe(0);
    expect(h.current).toEqual([]);
    h.unmount();
  });

  it('active others: excludes self, filters by isActive, enriches accent (known + fallback)', async () => {
    gate.traveler = POWAN; // the viewer
    const h = renderPresence();
    await flush();
    expect(presenceCtl.calls).toBe(1);

    const now = Date.now();
    act(() => {
      presenceCtl.cb?.([
        { uid: 'u-sushil', name: 'Sushil', lastSeen: now }, // active, known accent (sakura)
        { uid: 'u-powan', name: 'Powan', lastSeen: now }, // self — excluded
        { uid: 'u-uttam', name: 'Uttam', lastSeen: now - 10 * 60_000 }, // stale (10m > 3m window) — excluded
        { uid: 'u-guest', name: 'Random Guest', lastSeen: null }, // pending beat counts active, unknown accent
      ]);
    });

    const names = h.current.map((p) => p.name).sort();
    expect(names).toEqual(['Random Guest', 'Sushil']);

    const sushil = h.current.find((p) => p.name === 'Sushil');
    expect(sushil?.accent).toBe('#FF8FC7'); // TRAVELERS sakura accent (sakura-400)

    const guest = h.current.find((p) => p.name === 'Random Guest');
    // R2/D-265: pins hooks/use-presence.ts's FALLBACK_ACCENT literal — fallback gold, no matching
    // TRAVELERS entry. An accent move fails here with a message about the fallback accent, not
    // about a chrome repaint. Re-valued to gold-400 under D-291/D-292/D-293.
    expect(guest?.accent).toBe('#FFC43D');

    h.unmount();
  });

  it('stale eviction tick: a traveler whose heartbeat stopped ages off after the active window', async () => {
    vi.useFakeTimers();
    gate.traveler = POWAN;
    const h = renderPresence();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(presenceCtl.calls).toBe(1);

    act(() => {
      presenceCtl.cb?.([{ uid: 'u-sushil', name: 'Sushil', lastSeen: Date.now() }]);
    });
    expect(h.current.map((p) => p.name)).toEqual(['Sushil']);

    // No new snapshot arrives, but the eviction interval re-filters on ACTIVE_WINDOW_MS ticks —
    // once real (fake) time has moved past the window, the same record ages off.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_WINDOW_MS + 1000);
    });
    expect(h.current).toEqual([]);

    h.unmount();
  });

  it('IDENTITY_CHANGED_EVENT: sign-in opens the subscribe live, sign-out tears it down + clears the list', async () => {
    gate.remoteOn = true;
    gate.traveler = null; // starts as a guest — dormant on mount
    const h = renderPresence();
    await flush();
    expect(presenceCtl.calls).toBe(0);

    // Sign in.
    gate.traveler = POWAN;
    act(() => {
      window.dispatchEvent(new CustomEvent(IDENTITY_CHANGED_EVENT));
    });
    await flush();
    expect(presenceCtl.calls).toBe(1); // subscribe opened live, no reload needed

    act(() => {
      presenceCtl.cb?.([{ uid: 'u-sushil', name: 'Sushil', lastSeen: Date.now() }]);
    });
    expect(h.current.map((p) => p.name)).toEqual(['Sushil']);

    // Sign out.
    gate.traveler = null;
    act(() => {
      window.dispatchEvent(new CustomEvent(IDENTITY_CHANGED_EVENT));
    });
    expect(presenceCtl.unsubCalls).toBe(1); // torn down
    expect(h.current).toEqual([]); // cleared immediately, no new subscribe re-opened
    expect(presenceCtl.calls).toBe(1); // re-activate short-circuited (guest again)

    h.unmount();
  });
});
