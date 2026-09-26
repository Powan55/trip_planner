// @vitest-environment jsdom
//
// D-599: the home currency is a per-person account pref. The shared budget keeps its
// homeCurrency field for older clients, but a new client with an account never writes it.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { BudgetStore } from '@/hooks/use-budget';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const fs = {
    doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
    getDocFromServer: async (ref: { path: string }) => ({ exists: () => docs.has(ref.path), data: () => docs.get(ref.path) }),
    onSnapshot: () => () => {},
    runTransaction: async <T,>(_db: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({
        get: async (ref: { path: string }) => {
          const d = docs.get(ref.path);
          return { exists: () => !!d, data: () => d && structuredClone(d) };
        },
        set: (ref: { path: string }, data: Record<string, unknown>) => docs.set(ref.path, structuredClone(data)),
        update: (ref: { path: string }, data: Record<string, unknown>) =>
          docs.set(ref.path, { ...docs.get(ref.path), ...structuredClone(data) }),
      }),
  };
  return { docs, fs, down: { v: false }, push: vi.fn(async () => {}) };
});

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => 'trip-1',
}));
vi.mock('@/lib/firebase-remote', () => ({
  getRemote: () =>
    t.down.v ? Promise.reject(new Error('sync paused on this device')) : Promise.resolve({ db: {}, fs: t.fs, uid: 'uid-a' }),
}));
vi.mock('@/lib/budget-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/budget-ports')>();
  return { ...orig, budgetSyncPort: { push: t.push, subscribe: () => () => {}, isConfigured: () => true } };
});

import { useBudget } from '@/hooks/use-budget';
import { STORAGE_KEYS, setSyncCode } from '@/core/storage/gateway';
import { SEED_RATES } from '@/core/budget/model';

const PREFS = 'trips/tok-1/profile/prefs';
const SHARED = { version: 1, homeCurrency: 'USD', rates: { ...SEED_RATES }, legBudgets: { nepal: 100, japan: 0 }, categoryBudgets: {} };
const OLD = '000000001000000:000000:uid-x';
// A shared value that arrived through sync (it carries a stamp), as opposed to the local default.
const synced = (home = 'USD') => localStorage.setItem(STORAGE_KEYS.budget, JSON.stringify({ ...SHARED, homeCurrency: home, sync: { fieldHlc: { homeCurrency: OLD } } }));

function render() {
  const container = document.createElement('div');
  const root = createRoot(container);
  const ref = { current: null as unknown as BudgetStore };
  function Probe() {
    ref.current = useBudget();
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return {
    ref,
    async run(fn: (s: BudgetStore) => void) {
      await act(async () => {
        fn(ref.current);
        await new Promise((r) => setTimeout(r, 0));
      });
    },
    unmount: () => act(() => root.unmount()),
  };
}

const onDisk = () => localStorage.getItem(STORAGE_KEYS.budget);
const mirror = (v: string) => localStorage.setItem(STORAGE_KEYS.personPrefs, JSON.stringify({ homeCurrency: { v, hlc: OLD } }));
const remoteHome = (path = PREFS) => (t.docs.get(path)?.homeCurrency as { v: unknown } | undefined)?.v;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEYS.budget, JSON.stringify(SHARED));
  setSyncCode('tok-1');
  t.docs.clear();
  t.down.v = false;
  vi.clearAllMocks();
});

describe('home currency per person', () => {
  it('display uses the personal value over the shared one', async () => {
    mirror('JPY');
    const h = render();
    await h.run(() => {});
    expect(h.ref.current.model.homeCurrency).toBe('JPY');
    h.unmount();
  });

  it('changing it while paused keeps it on this device and leaves the synced budget untouched', async () => {
    mirror('USD');
    t.down.v = true;
    const h = render();
    const before = onDisk();
    await h.run((s) => s.setHomeCurrency('NPR'));
    await vi.waitFor(() => expect(h.ref.current.model.homeCurrency).toBe('NPR'));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.personPrefs)!).homeCurrency).toMatchObject({ v: 'NPR', dirty: true });
    expect(onDisk()).toBe(before);
    expect(t.push).not.toHaveBeenCalled();

    // A caller spreading the overlaid model still can't write budget.homeCurrency.
    await h.run((s) => s.commit(() => ({ ...s.model, legBudgets: { nepal: 200, japan: 0 } })));
    expect(JSON.parse(onDisk()!).homeCurrency).toBe('USD');
    expect(JSON.parse(onDisk()!).sync.fieldHlc.homeCurrency).toBeUndefined();
    h.unmount();
  });

  it('seeds once from the shared budget when the account has no value', async () => {
    synced('JPY');
    const h = render();
    await vi.waitFor(() => expect(remoteHome()).toBe('JPY'));
    h.unmount();
  });

  it('the seed never overwrites a value another device already set', async () => {
    setSyncCode('tok-4'); // tok-1 was already seeded this page load
    synced();
    t.docs.set('trips/tok-4/profile/prefs', { homeCurrency: { v: 'NPR', hlc: OLD } });
    const h = render();
    await vi.waitFor(() => expect(h.ref.current.model.homeCurrency).toBe('NPR'));
    expect(remoteHome('trips/tok-4/profile/prefs')).toBe('NPR');
    expect(JSON.parse(onDisk()!).homeCurrency).toBe('USD');
    h.unmount();
  });

  // The seed-state is per account for the page load, so these two use their own account codes.
  it('a claim that got an answer is never re-run, even on a later mount', async () => {
    setSyncCode('tok-2');
    // An unusable account value leaves the display on the shared one, so only the seed guard stops a re-claim.
    synced();
    t.docs.set('trips/tok-2/profile/prefs', { homeCurrency: { v: 'XYZ', hlc: OLD } });
    const tx = vi.spyOn(t.fs, 'runTransaction');
    for (let i = 0; i < 3; i++) {
      const h = render();
      await h.run(() => {});
      await vi.waitFor(() => expect(tx).toHaveBeenCalledTimes(1));
      h.unmount();
    }
    expect(tx).toHaveBeenCalledTimes(1);
    tx.mockRestore();
  });

  it('a failed claim is retried at most three times', async () => {
    setSyncCode('tok-3');
    synced();
    const tx = vi.spyOn(t.fs, 'runTransaction').mockRejectedValue(new Error('offline'));
    for (let i = 0; i < 5; i++) {
      const h = render();
      await h.run(() => {});
      await h.run(() => {});
      h.unmount();
    }
    expect(tx).toHaveBeenCalledTimes(3);
    tx.mockRestore();
  });

  it('does not seed from the local default before the shared value has synced', async () => {
    setSyncCode('tok-5');
    localStorage.setItem(STORAGE_KEYS.budget, JSON.stringify({ ...SHARED, homeCurrency: 'JPY' }));
    const tx = vi.spyOn(t.fs, 'runTransaction');
    const h = render();
    await h.run(() => {});
    await h.run(() => {});
    expect(tx).not.toHaveBeenCalled();
    expect(t.docs.size).toBe(0);
    h.unmount();
    tx.mockRestore();
  });

  it('reset leaves the shared home currency alone for an account user', async () => {
    mirror('NPR');
    synced('JPY');
    const h = render();
    await h.run((s) => s.reset());
    expect(JSON.parse(onDisk()!).homeCurrency).toBe('JPY');
    expect(JSON.parse(onDisk()!).sync.fieldHlc.homeCurrency).toBe(OLD);
    h.unmount();
  });

  it('without an account the pick stays on this device in the budget model', async () => {
    localStorage.removeItem(STORAGE_KEYS.syncCode);
    const h = render();
    await h.run((s) => s.setHomeCurrency('NPR'));
    expect(JSON.parse(onDisk()!).homeCurrency).toBe('NPR');
    expect(h.ref.current.model.homeCurrency).toBe('NPR');
    expect(t.docs.size).toBe(0);
    h.unmount();
  });
});
