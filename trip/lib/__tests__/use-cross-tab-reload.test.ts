// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createElement, type ChangeEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { STORAGE_KEYS } from '@/core/storage/gateway';

const reload = vi.fn();
const originalLocation = window.location;
let root: Root | null = null;

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload },
  });
});

afterAll(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

beforeEach(() => {
  reload.mockClear();
  vi.resetModules();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
});

// Fresh module per test so the never-resetting retiring flag can't leak between cases.
async function mount() {
  const mod = await import('@/hooks/use-cross-tab-reload');
  root = createRoot(document.createElement('div'));
  act(() => root!.render(createElement(() => (mod.useCrossTabReload(), null))));
  return mod;
}

const fire = (init: StorageEventInit) => window.dispatchEvent(new StorageEvent('storage', init));

describe('useCrossTabReload', () => {
  it('ignores unrelated keys and does not retire the tab', async () => {
    const { isTabRetiring } = await mount();
    fire({ key: 'trip:x:budget', oldValue: '1', newValue: '2' });
    expect(reload).not.toHaveBeenCalled();
    expect(isTabRetiring()).toBe(false);
  });

  it('a token rename (non-null to non-null) does not reload', async () => {
    const { isTabRetiring } = await mount();
    fire({ key: STORAGE_KEYS.token, oldValue: 'a', newValue: 'b' });
    expect(reload).not.toHaveBeenCalled();
    expect(isTabRetiring()).toBe(false);
  });

  it('an active-trip change reloads and retires the tab', async () => {
    const { isTabRetiring } = await mount();
    fire({ key: STORAGE_KEYS.activeTrip, oldValue: 'x', newValue: 'y' });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isTabRetiring()).toBe(true);
  });

  it('a default-share change reloads', async () => {
    await mount();
    fire({ key: STORAGE_KEYS.defaultTripShare, oldValue: null, newValue: 'z' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('sign-out (token to null) reloads', async () => {
    await mount();
    fire({ key: STORAGE_KEYS.token, oldValue: 'a', newValue: null });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('localStorage.clear (key null) reloads', async () => {
    await mount();
    fire({ key: null });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a dirty draft is not committed on the pagehide that follows a cross-tab trip switch', async () => {
    const { useCrossTabReload } = await import('@/hooks/use-cross-tab-reload');
    const { useDraftOnBlur } = await import('@/hooks/use-draft-on-blur');
    const onCommit = vi.fn();
    const ref: { current: ReturnType<typeof useDraftOnBlur> | null } = { current: null };
    function Probe() {
      useCrossTabReload();
      ref.current = useDraftOnBlur('100', onCommit);
      return null;
    }
    root = createRoot(document.createElement('div'));
    act(() => root!.render(createElement(Probe)));
    act(() => {
      ref.current!.onChange({ target: { value: '150' } } as unknown as ChangeEvent<HTMLInputElement>);
    });

    fire({ key: STORAGE_KEYS.activeTrip, oldValue: 'x', newValue: 'y' });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    act(() => root!.unmount());
    root = null;

    expect(reload).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
