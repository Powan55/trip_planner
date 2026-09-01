// @vitest-environment jsdom
//
// `<Reveal>` decides its entrance during render, and what that FIRST render contains is the
// contract this file pins.
//
// No `<Reveal>` is prerendered: app/layout.tsx puts `{children}` inside `<ItineraryProvider>`,
// which renders `{mounted && traveler ? children : null}`, so nothing routed reaches the static
// export (measured: zero `data-entrance` in `out/**/*.html`) and there is no server markup for a
// client render to disagree with. `/passport/` is a Server Component and is still gated by that
// provider like every other route.
//
// What there is instead is a first paint. `entranceFor()` reads `prefers-reduced-motion` and the
// sessionStorage entrance ledger, so a reduced-motion visitor and a visitor returning to a
// surface already greeted this browser session must be `'present'`, at full opacity,
// IMMEDIATELY. Deferring that decision to a post-paint effect answers `'animate'` first, which
// paints every Tier-1/2 masthead at the fade floor and y:20 and then snaps it — the defect #370
// reported. It is not cosmetic either: framer reads `initial` once, at mount, so an element that
// mounted on `'animate'` and never intersects RESTS below full opacity, which is D-246's
// measured regression, for exactly the visitors the fork exists to protect.
//
// Three proofs, deliberately different in kind:
//   1. the first render, isolated — rendered to a string and read back, which is the only way to
//      observe it before an effect could have corrected it.
//   2. the real thing — mounted, watched for a post-paint change to `data-entrance`, and read at
//      rest. This is the one that says the snap does not happen.
//   3. `hydrateRoot` with `onRecoverableError` wired, for the day the provider gate changes and
//      a reveal really is in the exported HTML.
//
// framer-motion is NOT mocked here: its `initial` is what puts `opacity`/`transform` into the
// markup, and stripping it would delete the thing every case below measures.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createRoot, hydrateRoot } from 'react-dom/client';
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
 * The client's FIRST render, isolated. Rendering to a string runs render and nothing else — no
 * effect, no commit — so it is the only way to observe the paint a visitor actually gets rather
 * than whatever a post-paint correction would have left behind.
 */
function firstRenderMarkup(client: { reduced: boolean; greeted: string | null }): string {
  asClient(client);
  return renderToString(tree());
}

/** That same first render, parsed, so `initial` can be read as computed style and not as text. */
function firstPaint(client: { reduced: boolean; greeted: string | null }): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = firstRenderMarkup(client);
  const el = host.querySelector<HTMLElement>('[data-entrance]');
  if (el === null) throw new Error('the first render contains no [data-entrance] element');
  return el;
}

describe('<Reveal> — the first render is the live decision, at full opacity', () => {
  beforeEach(() => {
    pathname.current = '/passport';
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
    window.sessionStorage.clear();
    resetEntranceMemoForTests();
  });

  it('a RELOAD of /passport/ paints present, with no floored first frame', () => {
    // A surface already greeted — the ledger is sessionStorage, so it survives a reload.
    const el = firstPaint({ reduced: false, greeted: '/passport' });

    expect(el.dataset.entrance, 'data-entrance on the first render').toBe('present');
    expect(Number(el.style.opacity || 1), 'first-frame opacity').toBe(1);
    expect(el.style.transform || '', 'first-frame offset').toBe('');
  });

  it('a REDUCED-MOTION first load of /passport/ paints present, with no floored first frame', () => {
    const el = firstPaint({ reduced: true, greeted: null });

    expect(el.dataset.entrance, 'data-entrance on the first render').toBe('present');
    expect(Number(el.style.opacity || 1), 'first-frame opacity').toBe(1);
    expect(el.style.transform || '', 'first-frame offset').toBe('');
  });

  it('hydrating server markup as a first-time visitor reports no recoverable error', () => {
    asPrerender();
    const prerendered = renderToString(tree());

    // The visitor the export's tier-only answer agrees with: motion allowed, ledger empty. The
    // reduced-motion and returning visitors deliberately differ from it, and they are the two
    // cases above — nothing hydrates them today, because the provider gate means no reveal is in
    // the exported HTML at all. This case is what would go red first if that ever changed.
    asClient({ reduced: false, greeted: null });
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

  it('a mounted reduced-motion reveal rests at FULL opacity, uncorrected', async () => {
    asClient({ reduced: true, greeted: '/passport' });
    const container = document.createElement('div');
    document.body.appendChild(container);

    // A `data-entrance` that CHANGES after paint is the snap #370 reported — the live decision
    // arriving late. Watching the attribute rather than the style is what makes that
    // unambiguous: framer rewrites style on mount either way, but the decision only moves if
    // something deferred it.
    const corrections: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        corrections.push(`${r.oldValue} -> ${(r.target as HTMLElement).dataset.entrance}`);
      }
    });
    observer.observe(container, {
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['data-entrance'],
    });

    const root = createRoot(container);
    act(() => {
      root.render(tree());
    });
    // long enough for an effect-deferred decision to land and for framer to settle a target
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    observer.disconnect();

    const el = container.querySelector<HTMLElement>('[data-entrance]');
    expect(el?.getAttribute('data-entrance'), 'entrance at rest').toBe('present');
    expect(corrections, 'post-paint corrections to data-entrance').toEqual([]);
    // framer reads `initial` ONCE, at mount, so an element that mounted on 'animate' keeps the
    // floored opacity unless something takes it off — and this reveal has never intersected, so
    // `whileInView` will not. Resting below full opacity is D-246's measured regression, for
    // exactly the visitors the fork protects.
    expect(FADE_FLOOR, 'the floor a resting reveal must never sit on').toBeLessThan(1);
    expect(Number(el?.style.opacity ?? 1), 'resting opacity').toBe(1);

    act(() => {
      root.unmount();
    });
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
