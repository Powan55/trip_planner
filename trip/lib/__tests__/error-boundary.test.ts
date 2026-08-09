// @vitest-environment jsdom
//
// S280 — render coverage for the native App Router error boundary
// (`app/error.tsx`), exercised by RENDERING the real exported component with
// the same createRoot+act harness `lib/__tests__/story-photos.test.ts` uses
// (no new dep, no JSX in this file since vitest.config.ts only globs
// `*.test.ts`). `app/global-error.tsx` renders its own `<html><body>` (it
// REPLACES the root layout when the layout itself throws) and Next only
// wires it in through its own router machinery, not a plain component render
// — that file is compile+build verified instead.
//
// Proves: the fallback shows a calm on-brand message (mentions trip data
// being safe in local storage), and clicking "Try again" calls the `reset`
// callback Next passes in — the one behavior contract this file has.

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import ErrorBoundary from '@/app/error';

function render(error: Error, reset: () => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(createElement(ErrorBoundary, { error, reset }));
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('app/error.tsx — native error boundary fallback', () => {
  it('renders a calm on-brand message that reassures trip data is safe', () => {
    const reset = vi.fn();
    const r = render(new Error('boom: render crashed'), reset);

    expect(r.container.querySelector('[role="alert"]')).not.toBeNull();
    const heading = r.container.querySelector('h1');
    expect(heading?.textContent).toContain('Something went wrong');
    expect(r.container.textContent).toContain('safe');
    expect(r.container.textContent).toContain('local storage');

    r.unmount();
  });

  it('clicking "Try again" calls the reset() Next passes in', () => {
    const reset = vi.fn();
    const r = render(new Error('boom'), reset);

    const buttons = Array.from(r.container.querySelectorAll('button'));
    const tryAgain = buttons.find((b) => b.textContent?.includes('Try again'));
    expect(tryAgain).toBeTruthy();

    expect(reset).not.toHaveBeenCalled();
    act(() => {
      tryAgain!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(reset).toHaveBeenCalledTimes(1);

    r.unmount();
  });

  it('renders a Home link back to "/"', () => {
    const r = render(new Error('boom'), vi.fn());
    const homeLink = r.container.querySelector('a[href="/"]');
    expect(homeLink).not.toBeNull();
    expect(homeLink?.textContent).toContain('Home');
    r.unmount();
  });
});
