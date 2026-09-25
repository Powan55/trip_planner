// @vitest-environment jsdom
//
// #583: a subscribe whose import failed is reopened on `online` / tab-visible; a healthy one never is.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { StoragePort, SyncPort } from '@/core/ports';
import type { ChunkSync } from '@/core/sync/outbox';

const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock('@/core/sync/outbox', () => ({ flushOutbox: vi.fn(async () => {}) }));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return {
    ...orig,
    getActiveTraveler: () => (auth.signedIn ? { name: 'Powan', token: 'Powan', accent: '#000' } : null),
  };
});

import { flushOutbox } from '@/core/sync/outbox';
import { useDomainSync } from '@/hooks/use-domain-sync';
import { IDENTITY_CHANGED_EVENT } from '@/lib/token-auth';

function fakePort(dies: boolean) {
  const deaths: Array<() => void> = [];
  const port: SyncPort<unknown> = {
    push: async () => {},
    isConfigured: () => true,
    subscribe: vi.fn((onDead?: () => void) => {
      if (onDead) deaths.push(onDead);
      if (dies && onDead) queueMicrotask(onDead);
      return () => {};
    }),
  };
  return { port, deaths };
}

let root: Root | null = null;

function mount(port: SyncPort<unknown>) {
  function Probe() {
    useDomainSync({} as ChunkSync<unknown>, {} as StoragePort<unknown>, port);
    return null;
  }
  root = createRoot(document.createElement('div'));
  act(() => root!.render(createElement(Probe)));
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('useDomainSync dead-subscribe recovery', () => {
  beforeEach(() => {
    auth.signedIn = true;
    vi.mocked(flushOutbox).mockClear();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it('reopens after onDead on the next online event', async () => {
    const { port } = fakePort(true);
    mount(port);
    await tick();
    window.dispatchEvent(new Event('online'));
    expect(port.subscribe).toHaveBeenCalledTimes(2);
  });

  it('reopens after onDead on a visible visibilitychange', async () => {
    const { port } = fakePort(true);
    mount(port);
    await tick();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(port.subscribe).toHaveBeenCalledTimes(2);
  });

  it('never resubscribes a healthy port on online or tab return', async () => {
    const { port } = fakePort(false);
    mount(port);
    await tick();
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(port.subscribe).toHaveBeenCalledTimes(1);
  });

  it('does nothing on online when no traveler is signed in', async () => {
    auth.signedIn = false;
    const { port } = fakePort(false);
    mount(port);
    await tick();
    window.dispatchEvent(new Event('online'));
    expect(port.subscribe).toHaveBeenCalledTimes(0);
    expect(flushOutbox).toHaveBeenCalledTimes(0);
  });

  it('a late failure from a torn-down subscribe does not clear the newer one', async () => {
    const { port, deaths } = fakePort(false);
    mount(port);
    window.dispatchEvent(new Event(IDENTITY_CHANGED_EVENT));
    expect(port.subscribe).toHaveBeenCalledTimes(2);
    deaths[0]();
    window.dispatchEvent(new Event('online'));
    expect(port.subscribe).toHaveBeenCalledTimes(2);
  });
});
