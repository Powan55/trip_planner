// @vitest-environment jsdom
//
// S214 — component-level unit suite for the dual-path <Reveal> (`components/reveal.tsx`),
// which extends S180's scroll-driven-CSS idiom (components/scroll-progress.tsx) from the
// page-progress bar to the section-entrance reveal. Renders the REAL exported component
// (same createRoot+act harness `lib/__tests__/story-photos.test.ts` uses — no new dep, no
// JSX in this file since the standalone vitest.config.ts only globs `*.test.ts`).
//
// Split into TWO files (this one + reveal-reduced-motion.test.ts): framer-motion's
// `useReducedMotion()` lazily latches a MODULE-LEVEL singleton (`motion-dom`'s
// `prefersReducedMotion`) on its FIRST call in a given module registry, and Vitest gives
// each test FILE a fresh registry (default isolation) — so one file can only exercise ONE
// reduced-motion value consistently across all its tests. THIS file stubs nothing for
// reduced-motion: jsdom has no `window.matchMedia` by default, and the hook's own init
// falls back to `false` ("not reduced") when `matchMedia` is absent — see
// `node_modules/motion-dom/dist/es/render/utils/reduced-motion/index.mjs`. The dedicated
// reduced-motion file stubs `matchMedia` to force `true` before its first render.
//
// Covers the DoD: both paths render the children + className unchanged (external API/visual
// output parity — D-100's opacity-pinned-at-1 contract only ever touches `transform` on the
// CSS path, so it structurally can't regress that), the `data-scroll-driven` marker flips
// correctly with the `CSS.supports('animation-timeline: view()')` feature-detect (the same
// idiom scroll-progress.tsx uses, proven live in e2e/motion.spec.ts's S180 pack), and the
// framer fallback is what renders whenever the CSS primitive isn't supported.

import { describe, it, expect, afterEach } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { Reveal } from '@/components/reveal';

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

/** Stub (or remove) the global `CSS.supports` feature-detect the component reads in its effect. */
function stubCssSupport(supported: boolean) {
  (globalThis as unknown as { CSS: { supports: (q: string) => boolean } }).CSS = {
    supports: (q: string) => (q.includes('animation-timeline') ? supported : true),
  };
}

function removeCss() {
  // jsdom's real default (confirmed: `typeof new JSDOM().window.CSS === 'undefined'`) —
  // exercises the `typeof CSS !== 'undefined'` guard itself, not just a false `.supports()`.
  delete (globalThis as { CSS?: unknown }).CSS;
}

afterEach(() => {
  removeCss();
});

describe('Reveal (S214) — CSS global entirely absent (jsdom default) → framer fallback', () => {
  it('renders the m.div framer path (data-scroll-driven="js") with children + className intact', () => {
    removeCss();
    const { container } = render(
      createElement(Reveal, { className: 'my-class', children: createElement('p', null, 'hello') }),
    );
    const el = container.querySelector('[data-scroll-driven]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-scroll-driven')).toBe('js');
    expect(el?.className).toContain('my-class');
    expect(el?.textContent).toBe('hello');
    expect(container.querySelector('.reveal-view-css')).toBeNull();
  });
});

describe('Reveal (S214) — animation-timeline: view() supported → scroll-driven CSS path', () => {
  it('renders the plain div CSS path (data-scroll-driven="css", .reveal-view-css) with children + className intact', () => {
    stubCssSupport(true);
    const { container } = render(
      createElement(Reveal, { className: 'my-class', children: createElement('p', null, 'hello') }),
    );
    const el = container.querySelector('[data-scroll-driven]');
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('DIV');
    expect(el?.getAttribute('data-scroll-driven')).toBe('css');
    expect(el?.classList.contains('reveal-view-css')).toBe(true);
    expect(el?.classList.contains('my-class')).toBe(true);
    expect(el?.textContent).toBe('hello');
  });

  it('with no className, the class is exactly "reveal-view-css" (no stray whitespace)', () => {
    stubCssSupport(true);
    const { container } = render(createElement(Reveal, null, createElement('p', null, 'x')));
    const el = container.querySelector('[data-scroll-driven="css"]');
    expect(el?.getAttribute('class')).toBe('reveal-view-css');
  });
});

describe('Reveal (S214) — animation-timeline: view() NOT supported → framer fallback', () => {
  it('falls back to the framer path even though a (non-matching) CSS.supports exists', () => {
    stubCssSupport(false);
    const { container } = render(createElement(Reveal, null, createElement('p', null, 'x')));
    expect(container.querySelector('[data-scroll-driven="js"]')).not.toBeNull();
    expect(container.querySelector('.reveal-view-css')).toBeNull();
  });
});
