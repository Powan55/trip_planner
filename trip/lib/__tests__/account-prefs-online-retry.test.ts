// @vitest-environment jsdom
// #721 — a home-currency edit made offline is pushed when the connection returns.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/firebase-config', () => ({ isRemoteConfigured: () => true }));

const doc: { data?: Record<string, { v: unknown }> } = {};
const device = { down: true };

const fs = {
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  onSnapshot: () => () => {},
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
import { setSyncCode } from '@/core/storage/gateway';

beforeEach(() => {
  doc.data = undefined;
  device.down = true;
  localStorage.clear();
  setSyncCode('tok-1');
});

describe('subscribePrefs online retry', () => {
  it('pushes a dirty pref on the online event, and stops after unsubscribe', async () => {
    await setPref('homeCurrency', 'JPY');
    expect(doc.data).toBeUndefined();
    const stop = subscribePrefs(() => {});
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
});
