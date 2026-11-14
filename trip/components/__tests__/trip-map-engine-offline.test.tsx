// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const imports = vi.hoisted(() => ({ n: 0 }));

// vitest rejects the import with its own error and keeps this one as `cause`.
vi.mock('maplibre-gl', () => {
  imports.n += 1;
  throw Object.assign(new Error('Loading chunk 42 failed.'), { name: 'ChunkLoadError' });
});

import TripMap from '@/components/trip-map';
import MapIslandBoundary from '@/components/map-island-boundary';

async function mount(onLine: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: onLine });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const seen: unknown[] = [];
  const others = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', (reason) => seen.push(reason));
  const container = document.createElement('div');
  const root = createRoot(container);
  let card: Element | null = null;
  try {
    const before = imports.n;
    act(() =>
      root.render(
        createElement(MapIslandBoundary, { label: 'The day map', children: createElement(TripMap, { markers: [] }) }),
      ),
    );
    await vi.waitFor(() => expect(imports.n).toBe(before + 1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
    card = container.querySelector('[data-testid="map-island-unavailable"]');
    act(() => root.unmount());
  } finally {
    process.removeAllListeners('unhandledRejection');
    for (const l of others) process.on('unhandledRejection', l);
    vi.restoreAllMocks();
  }
  return { seen, card };
}

describe('TripMap: the map engine chunk fails to load', () => {
  it('offline, the surrounding boundary shows its engine card and nothing is left unhandled', async () => {
    const { seen, card } = await mount(false);
    expect(seen).toEqual([]);
    expect(card?.textContent).toContain('Map engine not on this device');
  });

  it('online, it still surfaces as an unhandled rejection and no card is shown', async () => {
    const { seen, card } = await mount(true);
    expect(seen).toHaveLength(1);
    expect(((seen[0] as Error).cause as Error).name).toBe('ChunkLoadError');
    expect(card).toBeNull();
  });
});
