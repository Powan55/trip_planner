// @vitest-environment jsdom
// #971 — the PWA relaunch re-enter only fires for the active trip, inside the trip window, on a
// query-free launch URL.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const nav = vi.hoisted(() => ({ replace: vi.fn(), pathname: '/' }));
const clock = vi.hoisted(() => ({ today: { date: '2026-12-10' } as { date: string } | null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => nav.pathname,
}));
vi.mock('@/lib/trip-now', () => ({ getTodayInTrip: () => clock.today }));

import TravelModeRelaunch from '@/components/travel-mode-relaunch';
import { STORAGE_KEYS } from '@/core/storage/gateway';

function boot(url = '/') {
  window.history.replaceState(null, '', url);
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(createElement(TravelModeRelaunch)));
  act(() => root.unmount());
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  nav.replace.mockClear();
  nav.pathname = '/';
  clock.today = { date: '2026-12-10' };
});

describe('TravelModeRelaunch (#971)', () => {
  it('re-enters /travel/ for the active trip, in window, with no query', () => {
    localStorage.setItem(STORAGE_KEYS.travelMode, 'active:nepal-japan-2026');
    boot('/');
    expect(nav.replace).toHaveBeenCalledWith('/travel/');
  });

  it('does nothing when the flag was written by another trip', () => {
    localStorage.setItem(STORAGE_KEYS.travelMode, 'active:some-other-trip');
    boot('/');
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('does nothing once the clock is outside the trip window', () => {
    localStorage.setItem(STORAGE_KEYS.travelMode, 'active:nepal-japan-2026');
    clock.today = null;
    boot('/');
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('leaves a ?trip= join link alone', () => {
    localStorage.setItem(STORAGE_KEYS.travelMode, 'active:nepal-japan-2026');
    boot('/?trip=abc&title=x');
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('does nothing after the exit X (seen)', () => {
    localStorage.setItem(STORAGE_KEYS.travelMode, 'seen:nepal-japan-2026');
    boot('/');
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
