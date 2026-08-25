// @vitest-environment jsdom
//
// #270 — recap's description named Nepal and Japan on every custom trip. Mirrors
// packing-header.tsx's own fix (#240): mount-gated copy switch on `isDefaultTrip()`.

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const isDefaultTrip = vi.fn();
vi.mock('@/core/trips', () => ({ isDefaultTrip: () => isDefaultTrip() }));

import RecapHeader from '@/components/recap-header';

function render(el: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('RecapHeader trip-aware copy (#270)', () => {
  it('renders the default Nepal × Japan description on the default trip', () => {
    isDefaultTrip.mockReturnValue(true);
    const r = render(createElement(RecapHeader));
    expect(r.container.textContent).toContain('A day-by-day narrative of Nepal and Japan');
    r.unmount();
  });

  it('renders the generic description on a custom trip, after mount', () => {
    isDefaultTrip.mockReturnValue(false);
    const r = render(createElement(RecapHeader));
    expect(r.container.textContent).toContain('A day-by-day narrative of your trip');
    expect(r.container.textContent).not.toContain('Nepal and Japan');
    r.unmount();
  });
});
