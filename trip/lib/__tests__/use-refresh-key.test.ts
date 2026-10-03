// @vitest-environment jsdom
// #759 — cached network data is re-read on reconnect / long-hidden resume, never while offline.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRefreshKey, REFRESH_AFTER_MS } from '@/hooks/use-refresh-key';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let fetches: number;
let onLine = true;

function Probe() {
  const key = useRefreshKey();
  useEffect(() => {
    fetches++;
  }, [key]);
  return null;
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  fetches = 0;
  onLine = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => onLine);
  root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe)));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useRefreshKey', () => {
  it('mount is the one initial fetch; an online event adds exactly one', () => {
    expect(fetches).toBe(1);
    act(() => void window.dispatchEvent(new Event('online')));
    expect(fetches).toBe(2);
  });

  it('does not refetch while navigator.onLine is false', () => {
    onLine = false;
    act(() => void window.dispatchEvent(new Event('online')));
    expect(fetches).toBe(1);
  });

  it('resume refetches only after the data is older than the threshold', () => {
    vi.advanceTimersByTime(REFRESH_AFTER_MS - 1000);
    act(() => setVisibility('visible'));
    expect(fetches).toBe(1);
    vi.advanceTimersByTime(2000);
    act(() => setVisibility('visible'));
    expect(fetches).toBe(2);
  });
});
