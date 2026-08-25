// @vitest-environment jsdom
//
// Issue #230 — the panel's Tab trap used to collect only `button:not([disabled])`, so any
// non-button focusable element in the panel (an input, a link, a `<summary>`) would sit outside
// the trap's first/last bookkeeping and let Tab walk out into the page behind it. Mirrors
// `import-place-sheet.test.ts`'s harness (plain react-dom/client render via `act`, framer-motion
// mocked to passthrough divs, no @testing-library dep in this repo).

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('framer-motion', async () => {
  const React = await import('react');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strip = (p: any) => {
    const { initial, animate, exit, whileHover, whileInView, whileTap, viewport, transition, layout, onExitComplete, ...rest } = p;
    return rest;
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m: { div: (props: any) => React.createElement('div', strip(props)) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AnimatePresence: ({ children }: any) => children,
    useReducedMotion: () => false,
  };
});

import TimePicker from '@/components/time-picker';

function q(testId: string): HTMLElement {
  const el = document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`missing [data-testid="${testId}"]`);
  return el;
}

async function flush(ms = 50): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function renderPicker() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(TimePicker, { value: undefined, onChange: vi.fn() }));
  });
  return {
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('TimePicker — Tab focus trap (#230)', () => {
  it('wraps Tab back to the first focusable element even when the panel contains a non-button focusable (regression: old trap only saw buttons)', async () => {
    const h = renderPicker();
    act(() => q('time-picker-trigger').click());
    await flush();

    const panel = q('time-picker-panel');

    // Simulate a non-button focusable landing in the panel (an input, a link, a <summary> — the
    // issue's examples). The panel happens to contain only buttons today; that's exactly the gap.
    const injected = document.createElement('input');
    injected.setAttribute('data-testid', 'injected-input');
    panel.appendChild(injected);

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.tabIndex !== -1,
    );
    const first = focusable[0];
    expect(focusable[focusable.length - 1]).toBe(injected); // the injected input is genuinely last in DOM order

    act(() => injected.focus());
    expect(document.activeElement).toBe(injected);

    act(() => {
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });

    // Forward-Tab from the panel's true last focusable element must wrap to the first one,
    // never fall through past the injected input and out of the trap.
    expect(document.activeElement).toBe(first);

    h.unmount();
  });

  it('shift+Tab from the first focusable element wraps to the injected (last) one', async () => {
    const h = renderPicker();
    act(() => q('time-picker-trigger').click());
    await flush();

    const panel = q('time-picker-panel');
    const injected = document.createElement('input');
    injected.setAttribute('data-testid', 'injected-input-2');
    panel.appendChild(injected);

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const first = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.tabIndex !== -1,
    )[0];

    act(() => first.focus());
    expect(document.activeElement).toBe(first);

    act(() => {
      panel.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
      );
    });

    expect(document.activeElement).toBe(injected);

    h.unmount();
  });
});
