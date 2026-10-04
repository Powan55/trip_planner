// @vitest-environment jsdom
// #721 — a home-currency edit made offline is pushed when the connection returns.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/lib/firebase-config', () => ({
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => false,
  getTripId: () => '',
}));
vi.mock('@/lib/budget-ports', () => ({
  budgetSyncPort: { isConfigured: () => false, subscribe: () => () => {}, push: async () => {} },
}));

const doc: { data?: Record<string, { v: unknown; hlc?: string }> } = {};
const device = { down: true };

const fs = {
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  onSnapshot: vi.fn(() => () => {}),
  runTransaction: async <T,>(_db: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({
      get: async () => ({ exists: () => !!doc.data, data: () => doc.data }),
      set: (_ref: unknown, data: Record<string, { v: unknown }>) => void (doc.data = data),
      update: (_ref: unknown, data: Record<string, { v: unknown }>) => void (doc.data = { ...doc.data, ...data }),
    }),
};
vi.mock('@/lib/firebase-remote', () => ({
  getRemote: () =>
    device.down ? Promise.reject(new Error('offline')) : Promise.resolve({ db: {}, fs, uid: 'uid-a' }),
}));

import { setPref, subscribePrefs } from '@/lib/account-prefs-remote';
import { readLocal } from '@/lib/account-prefs';
import { setSyncCode, STORAGE_KEYS, writeJson } from '@/core/storage/gateway';
import { parse, serialize } from '@/core/sync/hlc';
import { useBudget } from '@/hooks/use-budget';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const stops: (() => void)[] = [];

function newerRemoteCurrency(): void {
  const local = parse(readLocal().homeCurrency.hlc);
  doc.data = { homeCurrency: { v: 'NPR', hlc: serialize({ ...local, pt: local.pt + 1000, actor: 'uid-other' }) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  doc.data = undefined;
  device.down = true;
  localStorage.clear();
  setSyncCode('tok-1');
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  stops.splice(0).forEach((stop) => stop());
  vi.restoreAllMocks();
});

describe('subscribePrefs online retry', () => {
  it('pushes a dirty pref on the online event, and stops after unsubscribe', async () => {
    await setPref('homeCurrency', 'JPY');
    expect(doc.data).toBeUndefined();
    const stop = subscribePrefs(() => {});
    stops.push(stop);
    device.down = false;
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(doc.data?.homeCurrency?.v).toBe('JPY'));

    stop();
    doc.data = undefined;
    device.down = true;
    await setPref('homeCurrency', 'EUR'); // dirty again, nothing listening
    device.down = false;
    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 20));
    expect(doc.data).toBeUndefined();
  });

  it('updates mounted useBudget to the newer remote currency after an offline subscription failure', async () => {
    await setPref('homeCurrency', 'JPY');
    newerRemoteCurrency();
    const winner = doc.data!.homeCurrency;
    const container = document.createElement('div');
    function Probe() {
      return createElement('span', null, useBudget().model.homeCurrency);
    }
    root = createRoot(container);
    await act(async () => root!.render(createElement(Probe)));
    expect(container.textContent).toBe('JPY');
    expect(fs.onSnapshot).not.toHaveBeenCalled();

    device.down = false;
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(readLocal().homeCurrency).toEqual(winner);
    expect(container.textContent).toBe('NPR');
    expect(fs.onSnapshot).not.toHaveBeenCalled();
  });

  it.each(['unsubscribe', 'account switch'])('does not notify after %s during a pending retry', async (action) => {
    await setPref('homeCurrency', 'JPY');
    newerRemoteCurrency();
    const cb = vi.fn();
    const stop = subscribePrefs(cb);
    stops.push(stop);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const runTransaction = fs.runTransaction;
    const tx = vi.spyOn(fs, 'runTransaction').mockImplementationOnce(async (db, fn) => {
      await pending;
      return runTransaction(db, fn);
    });
    device.down = false;
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(tx).toHaveBeenCalledOnce());
    if (action === 'unsubscribe') stop();
    else {
      const nextMirror = { homeCurrency: { ...readLocal().homeCurrency, v: 'EUR' } };
      setSyncCode('tok-2');
      writeJson('local', STORAGE_KEYS.personPrefs, nextMirror);
    }
    release();
    await tx.mock.results[0].value;
    await Promise.resolve();
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
    expect(readLocal().homeCurrency.v).toBe(action === 'unsubscribe' ? 'NPR' : 'EUR');
  });

  it('catches a retry notification error without losing the reconciled mirror', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setPref('homeCurrency', 'JPY');
    newerRemoteCurrency();
    const error = new Error('subscriber failed');
    const cb = vi.fn(() => { throw error; });
    stops.push(subscribePrefs(cb));
    device.down = false;
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[account-prefs] retry notification failed:', error));
    expect(cb).toHaveBeenCalledOnce();
    expect(readLocal().homeCurrency).toEqual(doc.data!.homeCurrency);
  });

  it.each(['remote setup', 'transaction'])('does not notify or alter dirty prefs when %s fails', async (failure) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setPref('homeCurrency', 'JPY');
    const before = localStorage.getItem(STORAGE_KEYS.personPrefs);
    const cb = vi.fn();
    stops.push(subscribePrefs(cb));
    const tx = vi.spyOn(fs, 'runTransaction');
    if (failure === 'transaction') {
      device.down = false;
      tx.mockRejectedValueOnce(new Error('transaction failed'));
    }
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(warn).toHaveBeenCalledWith('[account-prefs] retry failed, kept on this device:', expect.any(Error));
    expect(tx).toHaveBeenCalledTimes(failure === 'transaction' ? 1 : 0);
    expect(localStorage.getItem(STORAGE_KEYS.personPrefs)).toBe(before);
    expect(readLocal().homeCurrency).toMatchObject({ v: 'JPY', dirty: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it.each(['no dirty work', 'different account'])('does not transact or notify with %s', async (state) => {
    const cb = vi.fn();
    stops.push(subscribePrefs(cb));
    if (state === 'different account') {
      setSyncCode('tok-2');
      writeJson('local', STORAGE_KEYS.personPrefs, { homeCurrency: { v: 'EUR', hlc: serialize({ pt: Date.now(), ct: 0, actor: 'local' }), dirty: true } });
    }
    const before = localStorage.getItem(STORAGE_KEYS.personPrefs);
    const tx = vi.spyOn(fs, 'runTransaction');
    device.down = false;
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(tx).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.personPrefs)).toBe(before);
  });
});
