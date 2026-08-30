// @vitest-environment jsdom
//
// `<Reveal>` must render the SAME thing on the server and on the client's first render.
//
// It did not. `entranceFor()` reads `matchMedia` and the sessionStorage entrance ledger; both
// are inert during the static export and live in the browser, so a prerendered route that
// reaches a `<Reveal>` shipped `data-entrance="animate"` in its HTML and computed `"present"` on
// the client's first render. `/passport/` is the one such route today — `app/passport/page.tsx`
// is a Server Component and renders `<Reveal>` straight into the export — and it mismatched on
// EVERY reload (the ledger is sessionStorage, which survives one) and on FIRST load for every
// reduced-motion visitor.
//
// Two proofs, deliberately different in kind:
//   1. the attribute diff — render under prerender conditions, then under the client's, and
//      compare the markup. This is the one that says WHAT differs.
//   2. the real thing — `hydrateRoot` over the prerendered HTML with `onRecoverableError`
//      wired, which is how React itself reports the mismatch. This is the one that says it
//      actually happens.
//
// framer-motion is NOT mocked here: its `initial` is what puts `opacity`/`transform` into the
// server markup, and stripping it would delete half the mismatch this file exists to catch.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { LazyMotion, MotionConfig, domAnimation } from 'framer-motion';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const pathname = vi.hoisted(() => ({ current: '/passport' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

import { Reveal } from '@/components/reveal';
import { FADE_FLOOR, resetEntranceMemoForTests } from '@/lib/motion';
import { STORAGE_KEYS } from '@/core/storage/gateway';

const realMatchMedia = window.matchMedia;

// jsdom has no IntersectionObserver, and framer's viewport feature throws without one. A
// never-firing stub is also exactly the case that matters here: a reveal that has NOT been
// scrolled into view, so `whileInView` never runs and nothing but the entrance decision can take
// the element off its mounted opacity.
(globalThis as any).IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
};

/** The export has no `matchMedia` and no ledger — `lib/motion.ts` reads both as "not reduced". */
function asPrerender(): void {
  delete (window as any).matchMedia;
  window.sessionStorage.clear();
  resetEntranceMemoForTests();
}

function asClient({ reduced, greeted }: { reduced: boolean; greeted: string | null }): void {
  window.matchMedia = ((q: string) => ({
    matches: reduced,
    media: q,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as any;
  window.sessionStorage.clear();
  if (greeted !== null) window.sessionStorage.setItem(STORAGE_KEYS.motionEntranceSeen, greeted);
  resetEntranceMemoForTests();
}

/**
 * The app's real motion tree (`components/theme-provider.tsx`): `MotionConfig reducedMotion="user"`
 * over `LazyMotion features={domAnimation}`. `m.*` is the LAZY component — without the feature
 * bundle it renders `initial` as a static style and animates nothing, so a harness that omits this
 * would quietly prove the opposite of what it claims about the resting opacity. Neither wrapper
 * emits DOM, so the markup comparisons below are unaffected.
 */
const tree = () =>
  createElement(
    MotionConfig,
    { reducedMotion: 'user' },
    createElement(
      LazyMotion,
      { features: domAnimation },
      createElement(Reveal, null, createElement('p', null, 'stamped')),
    ),
  );

function entranceAttr(html: string): string {
  return html.match(/data-entrance="([^"]+)"/)?.[1] ?? '(absent)';
}

/**
 * The client's FIRST render, isolated. It is the same component with the same inputs, so
 * rendering it to a string is exactly the tree React compares against the server's markup —
 * and it is the only way to observe that render without the effect having already corrected it.
 */
function firstRenderMarkup(client: { reduced: boolean; greeted: string | null }): string {
  asClient(client);
  return renderToString(tree());
}

describe('<Reveal> — the prerender and the client\'s first render must agree', () => {
  beforeEach(() => {
    pathname.current = '/passport';
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
    window.sessionStorage.clear();
    resetEntranceMemoForTests();
  });

  it('a RELOAD of /passport/ renders what the export contains (the ledger survives sessionStorage)', () => {
    asPrerender();
    const prerendered = renderToString(tree());

    // Second visit in the same session — exactly what a reload is.
    const first = firstRenderMarkup({ reduced: false, greeted: '/passport' });

    expect(entranceAttr(first), 'data-entrance').toBe(entranceAttr(prerendered));
    expect(first).toBe(prerendered);
  });

  it('a REDUCED-MOTION first load of /passport/ renders what the export contains', () => {
    asPrerender();
    const prerendered = renderToString(tree());

    const first = firstRenderMarkup({ reduced: true, greeted: null });

    expect(entranceAttr(first), 'data-entrance').toBe(entranceAttr(prerendered));
    expect(first).toBe(prerendered);
  });

  it('hydrating the export as a returning visitor reports no recoverable error', () => {
    asPrerender();
    const prerendered = renderToString(tree());

    asClient({ reduced: true, greeted: '/passport' });
    const container = document.createElement('div');
    container.innerHTML = prerendered;
    document.body.appendChild(container);

    const errors: string[] = [];
    act(() => {
      hydrateRoot(container, tree(), {
        onRecoverableError: (e) => errors.push(String(e)),
      });
    });

    expect(errors, 'React recoverable errors during hydration').toEqual([]);
    container.remove();
  });

  it('still lands the live decision after mount, at FULL opacity — never resting on the fade floor', async () => {
    asPrerender();
    const prerendered = renderToString(tree());
    expect(entranceAttr(prerendered)).toBe('animate'); // /passport is Tier 1
    expect(prerendered).toContain(`opacity:${FADE_FLOOR}`); // the export's floored start

    asClient({ reduced: true, greeted: '/passport' });
    const container = document.createElement('div');
    container.innerHTML = prerendered;
    document.body.appendChild(container);

    act(() => {
      hydrateRoot(container, tree(), { onRecoverableError: () => {} });
    });
    // let the deferred decision land and framer settle the corrected target
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const el = container.querySelector<HTMLElement>('[data-entrance]');
    expect(el?.getAttribute('data-entrance'), 'corrected by the effect').toBe('present');
    // THE POINT OF THE `animate` CORRECTOR. framer reads `initial` once, at mount, so an element
    // that mounted on the prerender's 'animate' keeps the floored opacity unless something takes
    // it off — and this reveal has never intersected, so `whileInView` will not. Resting below
    // full opacity is D-246's measured regression, for exactly the visitors the fork protects.
    expect(Number(el?.style.opacity ?? 1), 'resting opacity').toBe(1);
    container.remove();
  });

  it('a Tier-3 surface agrees too — it is present on both sides, with no ledger spend', () => {
    pathname.current = '/plan';
    asPrerender();
    const prerendered = renderToString(tree());
    expect(entranceAttr(prerendered)).toBe('present');

    expect(firstRenderMarkup({ reduced: false, greeted: null })).toBe(prerendered);
  });
});
