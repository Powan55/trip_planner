// @vitest-environment jsdom
//
// S276 (P9) — the offline-dimmed deep-link (`DeepLink`, `components/travel-essentials-card.tsx`),
// exercised by RENDERING the real exported component (same createRoot+act harness
// `lib/__tests__/story-photos.test.ts` uses — no new dep, no JSX in this file since the
// standalone vitest.config.ts only globs `*.test.ts`).
//
// Proves: online renders a normal, enabled link (no aria-disabled, full click-through, no
// offline suffix); offline dims it (visual class), marks `aria-disabled="true"`, intercepts the
// click (never navigates), and appends an `sr-only` text so screen readers get the state too
// (not color alone) — and flipping the `online` prop re-enables it in place, no remount.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { DeepLink } from '@/components/travel-essentials-card';

function render(online: boolean) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      createElement(DeepLink, {
        href: 'https://example.com/track',
        online,
        testId: 'dl',
        className: 'base-class',
        children: 'Track flight',
      }),
    );
  });
  return {
    anchor: container.querySelector('[data-testid="dl"]') as HTMLAnchorElement,
    rerender(nextOnline: boolean) {
      act(() => {
        root.render(
          createElement(DeepLink, {
            href: 'https://example.com/track',
            online: nextOnline,
            testId: 'dl',
            className: 'base-class',
            children: 'Track flight',
          }),
        );
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('DeepLink — online', () => {
  it('renders a plain, enabled link: no aria-disabled, no offline suffix, click not intercepted', () => {
    const r = render(true);
    expect(r.anchor.getAttribute('aria-disabled')).toBeNull();
    expect(r.anchor.textContent).toBe('Track flight');
    expect(r.anchor.className).not.toContain('pointer-events-none');

    let prevented = false;
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      r.anchor.dispatchEvent(evt);
    });
    prevented = evt.defaultPrevented;
    expect(prevented).toBe(false);

    r.unmount();
  });
});

describe('DeepLink — offline', () => {
  it('dims + aria-disables the link and appends an sr-only offline suffix (a11y, not color alone)', () => {
    const r = render(false);
    expect(r.anchor.getAttribute('aria-disabled')).toBe('true');
    expect(r.anchor.className).toContain('pointer-events-none');
    expect(r.anchor.className).toContain('opacity-40');
    // Accessible name carries the offline state via visible text + an sr-only suffix, not a
    // color-only cue.
    expect(r.anchor.textContent).toBe('Track flight (unavailable offline)');
    const srOnly = r.anchor.querySelector('.sr-only');
    expect(srOnly).not.toBeNull();
    expect(srOnly!.textContent).toContain('unavailable offline');

    r.unmount();
  });

  it('intercepts the click and never navigates while offline', () => {
    const r = render(false);
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      r.anchor.dispatchEvent(evt);
    });
    expect(evt.defaultPrevented).toBe(true);
    r.unmount();
  });

  it('re-enables in place when the online prop flips back to true (no remount needed)', () => {
    const r = render(false);
    expect(r.anchor.getAttribute('aria-disabled')).toBe('true');

    r.rerender(true);
    expect(r.anchor.getAttribute('aria-disabled')).toBeNull();
    expect(r.anchor.className).not.toContain('pointer-events-none');
    expect(r.anchor.textContent).toBe('Track flight');

    r.unmount();
  });
});
