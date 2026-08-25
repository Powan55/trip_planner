// @vitest-environment jsdom
//
// S272 — component-level unit suite for `StoragePersistence` (`components/storage-persistence.tsx`),
// exercised by RENDERING the real exported component (same createRoot+act harness `story-photos.test.ts`
// uses — no new dep, no JSX in this file since the standalone vitest.config.ts only globs `*.test.ts`).
// `sonner` and `next/navigation` are module-mocked so the toast/router calls are observable; the
// gateway's real `installHintStore` is used against jsdom's real localStorage (matches the gateway's
// own test convention).
//
// Proves the required behaviors:
//   - persist() is called when supported and skipped when already persisted;
//   - the near-quota toast fires above the threshold and not below (and only once per module load);
//   - the install hint renders only when NOT standalone and NOT previously dismissed, and dismissing
//     it (action click) persists via the gateway so a later mount does not show it again.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const h = vi.hoisted(() => ({
  toastCalls: [] as Array<{ message: string; options?: Record<string, unknown> }>,
  dismissCalls: [] as unknown[],
  pushCalls: [] as string[],
  // Backs the `@/lib/trip-now` mock below — the "leg" section #5's polling reads on every
  // interval tick. `null` = outside the trip window (the default, matching every pre-existing
  // test in this file, which never sets it and must see no backup-nudge interference).
  currentLeg: null as string | null,
}));

vi.mock('sonner', () => {
  const toast = Object.assign(
    (message: string, options?: Record<string, unknown>) => {
      h.toastCalls.push({ message, options });
      return h.toastCalls.length; // fake id, unique per call
    },
    {
      dismiss: (id: unknown) => {
        h.dismissCalls.push(id);
      },
    },
  );
  return { toast };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (path: string) => {
      h.pushCalls.push(path);
    },
  }),
}));

// S222 — a minimal stand-in for the real clock/leg resolver, so the leg-change tests below drive
// `country` directly instead of faking trip dates end to end.
vi.mock('@/lib/trip-now', () => ({
  getTodayInTrip: () =>
    h.currentLeg === null
      ? null
      : { date: '2026-12-10', dayNumber: 2, city: 'Test City', country: h.currentLeg },
}));

import { StoragePersistence } from '@/components/storage-persistence';
import { installHintStore, backupPromptStore, STORAGE_KEYS } from '@/core/storage/gateway';

function render(el: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    async settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Installs a `navigator.storage` stub. `persist`/`estimate` are omitted entirely when the
 * respective `supportsPersist`/`supportsEstimate` flag is false, to exercise the real
 * feature-detection branch (not just a resolved-empty mock). */
function stubStorageManager(opts: {
  persisted?: boolean;
  persistImpl?: () => Promise<boolean>;
  usage?: number;
  quota?: number;
  supportsPersist?: boolean;
  supportsEstimate?: boolean;
}) {
  const {
    persisted = false,
    persistImpl = () => Promise.resolve(true),
    usage = 0,
    quota = 100,
    supportsPersist = true,
    supportsEstimate = true,
  } = opts;
  const persist = vi.fn(persistImpl);
  const persistedFn = vi.fn(() => Promise.resolve(persisted));
  const estimate = vi.fn(() => Promise.resolve({ usage, quota }));
  const storage: Record<string, unknown> = {};
  if (supportsPersist) {
    storage.persist = persist;
    storage.persisted = persistedFn;
  }
  if (supportsEstimate) {
    storage.estimate = estimate;
  }
  Object.defineProperty(navigator, 'storage', {
    value: storage,
    configurable: true,
  });
  return { persist, persisted: persistedFn, estimate };
}

/** Stubs matchMedia + navigator.standalone for the install-hint standalone check. */
function stubStandalone(standalone: boolean, ios = false) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: standalone }) as unknown as typeof window.matchMedia;
  Object.defineProperty(navigator, 'standalone', {
    value: undefined,
    configurable: true,
  });
  if (ios) {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
  }
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.toastCalls.length = 0;
  h.dismissCalls.length = 0;
  h.pushCalls.length = 0;
  h.currentLeg = null;
  vi.restoreAllMocks();
  stubStandalone(false);
});

describe('StoragePersistence — persist()', () => {
  it('calls persist() after the first interaction when supported and NOT already persisted', async () => {
    const { persist, persisted } = stubStorageManager({ persisted: false, quota: 0 }); // quota 0 => no quota toast noise
    const r = render(createElement(StoragePersistence));
    window.dispatchEvent(new Event('pointerdown'));
    await r.settle();
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('does NOT call persist() when already persisted', async () => {
    const { persist, persisted } = stubStorageManager({ persisted: true, quota: 0 });
    const r = render(createElement(StoragePersistence));
    window.dispatchEvent(new Event('keydown'));
    await r.settle();
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
    r.unmount();
  });

  it('is a quiet no-op with no interaction and no navigator.storage support (unsupported browser)', async () => {
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    expect(() => {
      const r = render(createElement(StoragePersistence));
      r.unmount();
    }).not.toThrow();
  });

  it('swallows a persist() rejection quietly (no throw, no toast)', async () => {
    stubStorageManager({
      persisted: false,
      persistImpl: () => Promise.reject(new Error('denied')),
      quota: 0,
    });
    const r = render(createElement(StoragePersistence));
    window.dispatchEvent(new Event('pointerdown'));
    await r.settle();
    expect(h.toastCalls.some((c) => c.message.includes('persist'))).toBe(false);
    r.unmount();
  });
});

// The "warn once per page load" guard is a MODULE-level flag (by design — see the component's
// comment), which means it is shared across every test in this file if they all import the same
// module instance. `vi.resetModules()` + a fresh dynamic import per test gives each test its own
// "page load" — the same isolation the real app gets from a real navigation/reload — so the
// three quota tests below don't leak the flag into one another.
describe('StoragePersistence — near-quota warning', () => {
  it('does NOT toast when usage/quota is below the threshold', async () => {
    vi.resetModules();
    const { StoragePersistence: Fresh } = await import('@/components/storage-persistence');
    stubStorageManager({ usage: 50, quota: 100, supportsPersist: false }); // 0.5 ratio
    const r = render(createElement(Fresh));
    await r.settle();
    expect(h.toastCalls.some((c) => c.message.includes('storage is nearly full'))).toBe(false);
    r.unmount();
  });

  it('DOES toast when usage/quota is at/above the 0.9 threshold, with an action pointing at /settings/', async () => {
    vi.resetModules();
    const { StoragePersistence: Fresh } = await import('@/components/storage-persistence');
    stubStorageManager({ usage: 95, quota: 100, supportsPersist: false }); // 0.95 ratio
    const r = render(createElement(Fresh));
    await r.settle();
    const call = h.toastCalls.find((c) => c.message.includes('storage is nearly full'));
    expect(call).toBeDefined();
    // The copy names the destination the action goes to. BackupRestore lives in Settings -> Data;
    // it was named "the Plan page" here (and pushed to /plan) long after it moved off /plan.
    expect(String(call!.options?.description)).toContain('Settings');
    expect(String(call!.options?.description)).not.toContain('Plan page');
    const action = call!.options?.action as { label: string; onClick: () => void } | undefined;
    expect(action).toBeDefined();
    action!.onClick();
    expect(h.pushCalls).toContain('/settings/');
    expect(h.pushCalls).not.toContain('/plan');
    r.unmount();
  });

  it('only warns ONCE across mounts in the same module/page load (module-level guard)', async () => {
    vi.resetModules();
    const { StoragePersistence: Fresh } = await import('@/components/storage-persistence');
    stubStorageManager({ usage: 99, quota: 100, supportsPersist: false });
    const r1 = render(createElement(Fresh));
    await r1.settle();
    r1.unmount();
    const quotaToastsAfterFirst = h.toastCalls.filter((c) => c.message.includes('storage is nearly full')).length;
    expect(quotaToastsAfterFirst).toBe(1);

    // Same module instance (Fresh) remounted — the SAME "page load" the guard is scoped to.
    const r2 = render(createElement(Fresh));
    await r2.settle();
    r2.unmount();
    const quotaToastsAfterSecond = h.toastCalls.filter((c) => c.message.includes('storage is nearly full')).length;
    expect(quotaToastsAfterSecond).toBe(1); // unchanged — no second toast this "session"
  });
});

describe('StoragePersistence — install-to-Home hint', () => {
  it('shows the hint when NOT standalone and NOT previously dismissed', async () => {
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    stubStandalone(false);
    const r = render(createElement(StoragePersistence));
    await r.settle();
    expect(h.toastCalls.some((c) => c.message.includes('Install this app'))).toBe(true);
    r.unmount();
  });

  it('does NOT show the hint when already standalone', async () => {
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    stubStandalone(true);
    const r = render(createElement(StoragePersistence));
    await r.settle();
    expect(h.toastCalls.some((c) => c.message.includes('Install this app'))).toBe(false);
    r.unmount();
  });

  it('does NOT show the hint again once dismissed (gateway-persisted, once-ever)', async () => {
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    stubStandalone(false);
    installHintStore.markDismissed();
    expect(window.localStorage.getItem(STORAGE_KEYS.installHintDismissed)).toBe('1');
    const r = render(createElement(StoragePersistence));
    await r.settle();
    expect(h.toastCalls.some((c) => c.message.includes('Install this app'))).toBe(false);
    r.unmount();
  });

  it('clicking the action dismisses the toast AND persists the dismissal via the gateway', async () => {
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    stubStandalone(false);
    expect(installHintStore.hasBeenDismissed()).toBe(false);
    const r = render(createElement(StoragePersistence));
    await r.settle();
    const call = h.toastCalls.find((c) => c.message.includes('Install this app'));
    expect(call).toBeDefined();
    const action = call!.options?.action as { label: string; onClick: () => void } | undefined;
    action!.onClick();
    expect(installHintStore.hasBeenDismissed()).toBe(true);
    expect(h.dismissCalls.length).toBe(1);
    r.unmount();
  });

  it('does NOT persist dismissal when the toast is swiped away (onDismiss), only when the action is clicked (#249)', async () => {
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    stubStandalone(false);
    const r = render(createElement(StoragePersistence));
    await r.settle();
    const call = h.toastCalls.find((c) => c.message.includes('Install this app'));
    expect(call).toBeDefined();
    // sonner fires `onDismiss` on a user swipe-away; there is no `onDismiss` prop wired here on
    // purpose (a swipe must not be permanent consent), so it's undefined rather than a no-op fn.
    expect(call!.options?.onDismiss).toBeUndefined();
    expect(installHintStore.hasBeenDismissed()).toBe(false);
    r.unmount();
  });

  it('uses iOS Share -> Add to Home Screen wording on an iOS user agent', async () => {
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    stubStandalone(false, true);
    const r = render(createElement(StoragePersistence));
    await r.settle();
    const call = h.toastCalls.find((c) => c.message.includes('Install this app'));
    expect(call?.options?.description).toContain('Share');
    r.unmount();
  });
});

// S279 — the REACTIVE write-failure toast, complementing the PROACTIVE near-quota toast above.
// The module-level "once per page load" guard here is separate from `quotaWarnedThisLoad`
// (different flag), so it needs the same `vi.resetModules()` + fresh dynamic import isolation
// the near-quota suite uses.
describe('StoragePersistence — reactive write-failure toast (S279)', () => {
  it('shows ONE toast, with a /settings/ action, when trip:quota-exceeded fires', async () => {
    vi.resetModules();
    const { StoragePersistence: Fresh } = await import('@/components/storage-persistence');
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    const r = render(createElement(Fresh));
    await r.settle();
    window.dispatchEvent(new CustomEvent('trip:quota-exceeded', { detail: { key: 'nepal_japan_journal' } }));
    await r.settle();
    const call = h.toastCalls.find((c) => c.message.includes("Couldn't save"));
    expect(call).toBeDefined();
    expect(String(call!.options?.description)).toContain('Settings');
    const action = call!.options?.action as { label: string; onClick: () => void } | undefined;
    expect(action).toBeDefined();
    action!.onClick();
    expect(h.pushCalls).toContain('/settings/');
    expect(h.pushCalls).not.toContain('/plan');
    r.unmount();
  });

  it('throttles to ONE toast per session even if the event fires multiple times (no per-write stacking)', async () => {
    vi.resetModules();
    const { StoragePersistence: Fresh } = await import('@/components/storage-persistence');
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    const r = render(createElement(Fresh));
    await r.settle();
    window.dispatchEvent(new CustomEvent('trip:quota-exceeded'));
    window.dispatchEvent(new CustomEvent('trip:quota-exceeded'));
    window.dispatchEvent(new CustomEvent('trip:quota-exceeded'));
    await r.settle();
    const toasts = h.toastCalls.filter((c) => c.message.includes("Couldn't save"));
    expect(toasts.length).toBe(1);
    r.unmount();
  });

  it('does NOT show the reactive toast without the event (no false positive on mount)', async () => {
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    const r = render(createElement(StoragePersistence));
    await r.settle();
    expect(h.toastCalls.some((c) => c.message.includes("Couldn't save"))).toBe(false);
    r.unmount();
  });

  it('removes the trip:quota-exceeded listener on unmount (no leak, no post-unmount toast)', async () => {
    vi.resetModules();
    const { StoragePersistence: Fresh } = await import('@/components/storage-persistence');
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    const r = render(createElement(Fresh));
    await r.settle();
    r.unmount();
    h.toastCalls.length = 0;
    expect(() => {
      window.dispatchEvent(new CustomEvent('trip:quota-exceeded'));
    }).not.toThrow();
    expect(h.toastCalls.length).toBe(0);
  });
});

// #222 — the backup-export nudge fired on an OBSERVED trip-leg change. `render()` already flushes
// the mount effect synchronously (see the install-hint suite above, which asserts on a toast fired
// during that same synchronous mount pass with no `settle()`), so `checkLegChange`'s FIRST,
// seed-only call has already run by the time `render()` returns; every test below only needs to
// advance the poll interval to observe a later change.
describe('StoragePersistence — backup nudge on leg change (#222)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires once when the observed leg changes mid-session, naming the new leg', async () => {
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    vi.useFakeTimers();
    h.currentLeg = 'nepal';
    const r = render(createElement(StoragePersistence));
    expect(h.toastCalls.some((c) => c.message.includes('Now in'))).toBe(false); // seed only, no nudge

    h.currentLeg = 'japan';
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const calls = h.toastCalls.filter((c) => c.message.includes('Now in'));
    expect(calls.length).toBe(1);
    expect(calls[0].message).toContain('Japan');
    expect(backupPromptStore.getPromptedLeg()).toBe('japan');
    r.unmount();
  });

  it('does NOT fire again while the leg stays the same across further ticks', async () => {
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    vi.useFakeTimers();
    h.currentLeg = 'nepal';
    const r = render(createElement(StoragePersistence));
    h.currentLeg = 'japan';
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(h.toastCalls.filter((c) => c.message.includes('Now in')).length).toBe(1);

    act(() => {
      vi.advanceTimersByTime(60_000);
      vi.advanceTimersByTime(60_000);
    });
    expect(h.toastCalls.filter((c) => c.message.includes('Now in')).length).toBe(1); // unchanged
    r.unmount();
  });

  it('does NOT fire on a fresh mount already inside a leg (no observed change, e.g. a same-leg reload)', async () => {
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    vi.useFakeTimers();
    h.currentLeg = 'japan';
    const r = render(createElement(StoragePersistence));
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(h.toastCalls.some((c) => c.message.includes('Now in'))).toBe(false);
    r.unmount();
  });

  it('does NOT re-fire when the gateway already marks this leg as prompted (persists across reload)', async () => {
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    vi.useFakeTimers();
    backupPromptStore.setPromptedLeg('japan'); // simulates an earlier session/reload having already nudged
    h.currentLeg = 'nepal';
    const r = render(createElement(StoragePersistence));
    h.currentLeg = 'japan';
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(h.toastCalls.some((c) => c.message.includes('Now in'))).toBe(false);
    r.unmount();
  });

  it('never calls fetch — this is a local reminder, never an upload — through the whole flow', async () => {
    stubStorageManager({ supportsPersist: false, supportsEstimate: false });
    vi.useFakeTimers();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    h.currentLeg = 'nepal';
    const r = render(createElement(StoragePersistence));
    h.currentLeg = 'japan';
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const call = h.toastCalls.find((c) => c.message.includes('Now in'));
    expect(call).toBeDefined();
    const action = call!.options?.action as { onClick: () => void } | undefined;
    action?.onClick(); // clicking the action must only navigate, never touch the network
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.pushCalls).toContain('/settings/');
    vi.unstubAllGlobals();
    r.unmount();
  });
});
