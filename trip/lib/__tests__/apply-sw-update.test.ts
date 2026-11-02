// @vitest-environment jsdom
// #946: the error screens' path onto a waiting service worker.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyWaitingUpdate } from '@/lib/apply-sw-update';

function fakeSw(waiting: { postMessage: () => void } | null, onLine: boolean) {
  const listeners: Array<() => void> = [];
  const reg = { waiting, update: vi.fn(() => Promise.resolve()) };
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: onLine });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: async () => reg,
      addEventListener: (_t: string, cb: () => void) => listeners.push(cb),
    },
  });
  return { reg, fireControllerChange: () => listeners.forEach((cb) => cb()) };
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(navigator, 'onLine');
});

describe('applyWaitingUpdate', () => {
  it('offline, still hands over to an already-installed waiting worker, without an update check', async () => {
    let sw: ReturnType<typeof fakeSw>;
    const waiting = { postMessage: vi.fn(() => sw.fireControllerChange()) };
    sw = fakeSw(waiting, false);
    expect(await applyWaitingUpdate()).toBe(true);
    expect(sw.reg.update).not.toHaveBeenCalled();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('returns false when nothing is waiting, after checking online', async () => {
    const sw = fakeSw(null, true);
    expect(await applyWaitingUpdate()).toBe(false);
    expect(sw.reg.update).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting for controllerchange after the timeout and still resolves true', async () => {
    vi.useFakeTimers();
    const waiting = { postMessage: vi.fn() };
    fakeSw(waiting, false);
    const done = applyWaitingUpdate(3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await done).toBe(true);
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
  });
});
