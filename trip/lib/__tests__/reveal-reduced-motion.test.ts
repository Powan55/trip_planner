// @vitest-environment jsdom
//
// S214 (D-007/D-056) — <Reveal>'s CSS path must NEVER render under
// prefers-reduced-motion, mirroring scroll-progress.tsx's own reduced-motion contract
// (e2e/motion.spec.ts's S180 "reduced motion: JS path only, CSS element never rendered"
// pack) — even when the browser DOES support `animation-timeline: view()`. Kept in its OWN
// file (see reveal-css-path.test.ts's header comment): framer-motion's `useReducedMotion()`
// lazily latches a module-level singleton on its first call in this file's module registry,
// so `window.matchMedia` is stubbed to report "reduced" in `beforeAll`, before any render.

// Issue #24 — the guarantee is now stronger than "framer's hook is consulted". <Reveal> asks
// lib/motion.ts, which checks `prefers-reduced-motion` FIRST, before the tier gate and before
// the ledger, so there is no path through that module that animates under reduce. The stubbed
// `matchMedia` below is what that check reads. `/nepal/` is Tier 2, where an entrance WOULD be
// permitted — so a pass here is the preference winning, not the tier refusing.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { Reveal } from '@/components/reveal';

// Hoisted by vitest above the import above — there is no app router in this harness.
vi.mock('next/navigation', () => ({ usePathname: () => '/nepal/' }));

function stubReducedMotion(matches: boolean) {
  // Same stub shape as lib/__tests__/fly-chip.test.ts (jsdom has no matchMedia).
  window.matchMedia = ((q: string) => ({
    matches,
    media: q,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  })) as unknown as typeof window.matchMedia;
}

function stubCssSupport(supported: boolean) {
  (globalThis as unknown as { CSS: { supports: (q: string) => boolean } }).CSS = {
    supports: (q: string) => (q.includes('animation-timeline') ? supported : true),
  };
}

function render(el: ReactElement) {
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

beforeAll(() => {
  stubReducedMotion(true);
});

afterEach(() => {
  delete (globalThis as { CSS?: unknown }).CSS;
});

describe('Reveal (S214) — prefers-reduced-motion: reduce → CSS path NEVER renders', () => {
  it('renders the framer fallback even though animation-timeline: view() IS supported', () => {
    stubCssSupport(true);
    const { container } = render(
      createElement(Reveal, { className: 'my-class', children: createElement('p', null, 'hello') }),
    );
    expect(container.querySelector('.reveal-view-css')).toBeNull();
    expect(container.querySelector('[data-scroll-driven="css"]')).toBeNull();
    const el = container.querySelector('[data-scroll-driven="js"]');
    expect(el).not.toBeNull();
    expect(el?.className).toContain('my-class');
    expect(el?.textContent).toBe('hello');
  });

  it('renders the framer fallback when animation-timeline: view() is also unsupported', () => {
    stubCssSupport(false);
    const { container } = render(createElement(Reveal, null, createElement('p', null, 'x')));
    expect(container.querySelector('.reveal-view-css')).toBeNull();
    expect(container.querySelector('[data-scroll-driven="js"]')).not.toBeNull();
  });
});
