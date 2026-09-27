// @vitest-environment jsdom
//
// #662 — fullscreen map keeps focus on its toggle and traps it (body siblings inert);
// a map popup closes on Esc without exiting fullscreen and hands focus back to its opener.

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { onPopupKeyDown, restorePopupFocus } from '@/components/trip-map';

vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({ plans: [], addItem: () => {}, findPlacements: () => [] }),
}));

vi.mock('@/components/trip-map', async (orig) => ({
  ...(await orig<typeof import('@/components/trip-map')>()),
  __esModule: true,
  default: () => null,
}));

import MapSection from '@/components/map-section';

describe('MapSection fullscreen focus (#662)', () => {
  it('keeps focus on the toggle, inerts body siblings, and restores them on exit', () => {
    const sibling = document.createElement('div');
    sibling.inert = false;
    const preInert = document.createElement('div');
    preInert.inert = true;
    const toaster = document.createElement('section');
    toaster.setAttribute('aria-live', 'polite');
    document.body.append(sibling, preInert, toaster);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => root.render(createElement(MapSection)));

    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-testid="map-fullscreen-toggle"]',
    )!;
    toggle.focus();
    act(() => toggle.click());

    const shell = document.querySelector('[data-testid="map-shell"]')!;
    expect(shell.getAttribute('role')).toBe('dialog');
    expect(shell.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(toggle);
    expect(sibling.inert).toBe(true);
    expect(container.inert).toBe(true);
    expect(toaster.inert).not.toBe(true);
    const slot = document.querySelector<HTMLElement>('[data-map-fullscreen-slot]')!;
    expect(slot.contains(shell)).toBe(true);
    expect(slot.inert).not.toBe(true);

    // Exit via Esc: the app's React root is the document, but this test's root is a div the
    // relocated host no longer sits under, so a synthetic click there wouldn't reach React.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.activeElement).toBe(toggle);
    expect(shell.getAttribute('role')).toBeNull();
    expect(sibling.inert).toBe(false);
    expect(container.inert).not.toBe(true);
    expect(preInert.inert).toBe(true);

    act(() => root.unmount());
    container.remove();
    sibling.remove();
    preInert.remove();
    toaster.remove();
  });
});

describe('map popup Esc / focus restore (#662)', () => {
  it('Esc removes the popup, stops propagation, and focus returns to the opener', () => {
    const opener = document.createElement('button');
    const popupEl = document.createElement('div');
    const inner = document.createElement('button');
    popupEl.appendChild(inner);
    document.body.append(opener, popupEl);

    const docEsc = vi.fn();
    document.addEventListener('keydown', docEsc);
    const remove = vi.fn(() => {
      popupEl.remove();
      restorePopupFocus(popupEl, opener, null);
    });
    popupEl.addEventListener('keydown', (e) => onPopupKeyDown(e, remove));

    inner.focus();
    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(remove).not.toHaveBeenCalled();
    docEsc.mockClear();

    inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(docEsc).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);

    document.removeEventListener('keydown', docEsc);
    opener.remove();
  });

  it('leaves focus alone when it moved elsewhere, and falls back when the opener is gone', () => {
    const popupEl = document.createElement('div');
    const elsewhere = document.createElement('button');
    const fallback = document.createElement('button');
    const opener = document.createElement('button');
    document.body.append(elsewhere, fallback, opener);

    elsewhere.focus();
    restorePopupFocus(popupEl, opener, fallback);
    expect(document.activeElement).toBe(elsewhere);

    elsewhere.blur();
    opener.remove();
    restorePopupFocus(popupEl, opener, fallback);
    expect(document.activeElement).toBe(fallback);

    elsewhere.remove();
    fallback.remove();
  });
});
