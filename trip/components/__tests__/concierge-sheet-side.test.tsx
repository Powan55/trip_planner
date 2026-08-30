// @vitest-environment jsdom
//
// The concierge panel's OPENING EDGE. Owner report: in Travel Mode the panel slid in from the
// side; it has to rise from the bottom, because the trigger lives in `/travel`'s fixed
// `.tm-thumb-zone` band and a side drawer arrives from an edge no thumb is near.
//
// Asserted on the REAL opened panel (click the trigger, read the portalled node's class list),
// not on the prop — the class strings are what tailwindcss-animate actually animates, and
// `cn()`/tailwind-merge sits between the prop and them.
//
// `@/lib/concierge-config` and `@/hooks/use-active-traveler` are mocked for the same reason
// `lib/__tests__/concierge-chat-gating.test.ts` mocks them: both of ConciergeChat's gates must be
// open before there is a trigger to click.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: { name: 'Nadia', token: 'nadia-token', accent: '#f0c760' } }),
}));

vi.mock('@/lib/concierge-config', () => ({
  CONCIERGE_URL: 'https://mock.example.workers.dev',
  isConciergeConfigured: () => true,
}));

import { ConciergeChat } from '@/components/concierge-chat';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Mount the panel, click its trigger, hand back the portalled panel element. */
function openPanel(props: { side?: 'right' | 'bottom' }): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(ConciergeChat, props)));
  const trigger = container.querySelector<HTMLElement>('[data-testid="concierge-trigger"]');
  expect(trigger).not.toBeNull();
  act(() => trigger!.click());
  const panel = document.body.querySelector<HTMLElement>('[data-testid="concierge-panel"]');
  expect(panel).not.toBeNull();
  return panel!;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('concierge panel opening edge', () => {
  it('side="bottom" (Travel Mode) rises from the bottom edge and is pinned there', () => {
    const panel = openPanel({ side: 'bottom' });
    expect(panel.className).toContain('data-[state=open]:slide-in-from-bottom');
    expect(panel.className).toContain('data-[state=closed]:slide-out-to-bottom');
    expect(panel.className).toContain('bottom-0');
    expect(panel.className).toContain('inset-x-0');
    // The bug: no side slide left over.
    expect(panel.className).not.toContain('slide-in-from-right');
    expect(panel.className).not.toContain('inset-y-0');
  });

  it('the default (navbar mount) still slides in from the right — unchanged', () => {
    const panel = openPanel({});
    expect(panel.className).toContain('data-[state=open]:slide-in-from-right');
    expect(panel.className).toContain('right-0');
    expect(panel.className).not.toContain('slide-in-from-bottom');
  });

  it('keeps the modal a11y contract whichever edge it opens from', () => {
    const panel = openPanel({ side: 'bottom' });
    // Radix owns the focus trap and Escape; what a class change could silently drop is the
    // dialog role/labelling and the panel's only close control.
    // (no `aria-modal` assertion: @radix-ui/react-dialog 1.1.23 does not emit one, it makes the
    // rest of the page inert with `aria-hidden` on the siblings instead. Never present here.)
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-labelledby')).toBeTruthy();
    expect(panel.getAttribute('aria-describedby')).toBeTruthy();
    const close = Array.from(panel.querySelectorAll('button')).find(
      (b) => b.textContent === 'Close',
    );
    expect(close).toBeTruthy();

    // Escape still closes it.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.body.querySelector('[data-testid="concierge-panel"]')).toBeNull();
  });
});
