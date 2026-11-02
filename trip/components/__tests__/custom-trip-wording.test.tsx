// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const trip = vi.hoisted(() => ({ active: 'nepal-japan-2026' }));
vi.mock('@/core/storage/gateway', async (orig) => ({
  ...(await orig<object>()),
  getActiveTripId: () => trip.active,
}));

import DefaultTripOnly from '@/components/default-trip-only';
import { isDefaultTripOnlySection } from '@/components/command-palette';
import { retitle } from '@/lib/trip-title';

describe('retitle', () => {
  it('leaves the default trip title shape alone and swaps the suffix for a custom name', () => {
    expect(retitle('Plan · Nepal × Japan Journey', 'Peru')).toBe('Plan · Peru');
    expect(retitle('Map · Trip Journey', 'Peru')).toBe('Map · Peru');
    expect(retitle('Nepal × Japan Journey | Dec 2026 - Jan 2027', 'Peru')).toBe('Peru');
    expect(retitle('Plan · Peru', 'Peru')).toBe('Plan · Peru');
    // a name that itself ends in the default suffix must be a fixed point, or the observer loops
    const once = retitle('Map · Trip Journey', 'Peru Trip Journey');
    expect(retitle(once, 'Peru Trip Journey')).toBe(once);
    expect(retitle('Plan · Nepal × Japan Journey', 'Nepal × Japan Journey')).toBe('Plan · Nepal × Japan Journey');
  });
});

describe('palette default-trip-only rows', () => {
  it('flags Safety and Travel Inspiration, keeps Trips', () => {
    expect(isDefaultTripOnlySection({ route: '/safety/' })).toBe(true);
    expect(isDefaultTripOnlySection({ route: '/', hash: '#inspiration' })).toBe(true);
    expect(isDefaultTripOnlySection({ route: '/', hash: '#dashboard' })).toBe(false);
    expect(isDefaultTripOnlySection({ route: '/trips/' })).toBe(false);
  });
});

describe('DefaultTripOnly quiet', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
  });

  async function render(quiet: boolean) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        createElement(
          DefaultTripOnly,
          {
            quiet,
            pending: createElement('i', { id: 'pending' }),
            children: createElement('b', { id: 'kid' }),
          },
        ),
      );
    });
    return host;
  }

  it('default trip: children; custom trip: nothing (quiet) or the card', async () => {
    trip.active = 'nepal-japan-2026';
    expect((await render(true)).querySelector('#kid')).not.toBeNull();
    act(() => root?.unmount());
    host?.remove();

    trip.active = 'my-peru';
    const quiet = await render(true);
    expect(quiet.innerHTML).toBe('');
    act(() => root?.unmount());
    host?.remove();

    const loud = await render(false);
    expect(loud.querySelector('h1')?.textContent).toContain('Nepal × Japan');
  });
});
