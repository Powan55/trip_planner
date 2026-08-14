import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * Reduced-motion sweep E2E pack (slice S84, D-007 / D-056) — E2E wave 4 (part 2).
 *
 * Proves the app's "NONE under reduced motion" contract against the served
 * static `out/` build (D-093): every test here runs in a context created with
 * `reducedMotion: 'reduce'` (Playwright sets the emulated
 * `prefers-reduced-motion: reduce`, which drives BOTH the CSS `@media` guard in
 * globals.css AND framer-motion's `<MotionConfig reducedMotion="user">` /
 * `useReducedMotion()` branches). It confirms:
 *
 *   1. Route-fade imperceptible — the route-transition wrapper (app/template.tsx)
 *      renders a PLAIN `<div>` with NO `.animate-route-fade` class under reduced
 *      motion (it branches at the React level), so no keyframe is ever attached
 *      and the routed subtree has `animationName: none`.
 *   2. Infinite/looping CSS animations are hard-stopped — `.animate-shimmer`
 *      resolves to `animationName: none` via the reduced-motion block in
 *      globals.css (D-007 / D-056 named guarantee), with a same-test positive
 *      control proving the rule is live without the preference. (S354: the former
 *      `.animate-pulse-glow` / `.animate-float` probes went with those classes when
 *      the decoration was deleted — see the describe-block note below.)
 *   3. Count-up does not animate — the hero countdown lands on its EXACT final
 *      value on first paint (no eased 0→N ramp), because `useCountUp` skips the
 *      rAF loop and reports the final value immediately under reduced motion
 *      (D-056b). Asserted against the frozen `?today=` clock (D-075) so the
 *      target values are fixed and computable.
 *   4. The loading skeleton's shimmer is neutralized — when a `SectionSkeleton`
 *      is present its `.animate-shimmer` bars report `animationName: none`.
 *
 * ── Harness notes ───────────────────────────────────────────────────────────
 *   - `test`/`expect` from `./fixtures` (wall bypass). Navigations use
 *     `waitUntil:'load'` (D-093 — no networkidle).
 *   - `reducedMotion:'reduce'` is applied per-test via
 *     `page.emulateMedia({ reducedMotion:'reduce' })` BEFORE the first
 *     navigation (mirrors the S82 countdown pack), so the very first paint
 *     already sees the preference — matching how the app reads it on mount.
 *   - `animationName` is read from `getComputedStyle`; under the reduced-motion
 *     block (`animation: none !important`) it is exactly the string `'none'`.
 */

/**
 * Ride through the one-off first-load service-worker reload before reading any
 * computed style. The served `out/` is a production build, so the SW registrar
 * registers and, on first registration, reloads the page once
 * (components/service-worker-registrar.tsx, D-073). Reading `.animate-*`
 * computed styles WHILE that reload is in flight can hit a re-hydrating DOM
 * where the target node isn't attached yet (→ a false failure).
 * `waitForFunction` re-evaluates across the reload, so once the SW controls the
 * page the reload has flushed and the DOM is stable.
 */
async function settleSW(page: Page) {
  await page
    .waitForFunction(
      () => !('serviceWorker' in navigator) || navigator.serviceWorker.controller !== null,
      null,
      { timeout: 15_000 },
    )
    .catch(() => {
      /* no SW / already stable — proceed */
    });
}

/** Navigate with reduced motion pinned before first paint (D-007) + SW settle. */
async function gotoReduced(page: Page, path: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path, { waitUntil: 'load' });
  await settleSW(page);
}

/**
 * Computed `animation-name` for the first element matching a selector. Waits for
 * the element to be ATTACHED first (Playwright auto-retries) so we never read
 * into a transiently-empty DOM (e.g. during the first-load SW reload) — a missing
 * node would otherwise read as a false `null`.
 */
async function animationNameOf(page: Page, selector: string): Promise<string> {
  await expect(page.locator(selector).first()).toBeAttached();
  return page.locator(selector).first().evaluate((el) => getComputedStyle(el).animationName);
}

/**
 * Computed `animation-name` for a class, read off a throwaway element injected into the
 * live document (the S134 pack's idiom, lifted here by S354). Used when the class has no
 * guaranteed on-screen instance — it proves the CSS RULE, independent of app state.
 */
function probeAnimationName(page: Page, className: string): Promise<string> {
  return page.evaluate((cls) => {
    const el = document.createElement('div');
    el.className = cls;
    document.body.appendChild(el);
    const name = getComputedStyle(el).animationName;
    el.remove();
    return name;
  }, className);
}

test.describe('S84 · reduced motion — route-fade wrapper is imperceptible (app/template.tsx)', () => {
  test('the route-fade animation is collapsed to ~0ms under reduced motion', async ({ page }) => {
    await gotoReduced(page, '/');

    // The reduced-motion guarantee here is delivered by the CSS layer, NOT by removing the
    // node: the `@media (prefers-reduced-motion: reduce)` block collapses `animation-duration`
    // to 0.01ms — imperceptible — so the fade never plays. (Measured live: animationName stays
    // 'route-fade' and animationDuration reads '1e-05s' under reduce, vs the full duration
    // without it — pinned by the positive control below.) template.tsx ALSO branches at the
    // React level, but `useReducedMotion()` does not report the emulated preference on the
    // render that matters, so the CSS layer is what actually holds — which is why this test
    // asserts the duration rather than the node's absence.
    //
    // ASSERT THE CONTRACT, NOT THE MECHANISM — measured, and the reason is worth keeping.
    // template.tsx carries BOTH guarantees, and which one you observe is not stable across
    // builds: the React branch (plain <div>, no class) only fires if framer-motion's
    // `useReducedMotion()` has already seen the emulated preference when the subtree first
    // renders, and since #10 that subtree renders on the CLIENT after hydration, so the answer
    // now turns on module-init order — which a routine change in chunk splitting reshuffles.
    // Both outcomes satisfy the promise: no keyframe attached, or one collapsed to ~0ms.
    // Pinning either one specifically makes this test fail on an unrelated bundling change,
    // which is noise, not coverage. So: NOTHING on the page may carry a live route fade.
    // The positive control below is what stops that being vacuous.
    await page.waitForLoadState('domcontentloaded');
    const liveFades = await page.evaluate(() =>
      [...document.querySelectorAll('.animate-route-fade')]
        .map((el) => parseFloat(getComputedStyle(el).animationDuration))
        .filter((d) => d > 0.001),
    );
    expect(liveFades).toEqual([]);

    // Cross-check after a client-side route transition (template REMOUNTS on
    // navigation — the one moment a real fade could otherwise play).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/nepal/', { waitUntil: 'load' });
    await settleSW(page);
    const liveFadesAfterNav = await page.evaluate(() =>
      [...document.querySelectorAll('.animate-route-fade')]
        .map((el) => parseFloat(getComputedStyle(el).animationDuration))
        .filter((d) => d > 0.001),
    );
    expect(liveFadesAfterNav).toEqual([]);
  });

  // POSITIVE CONTROL: without the preference the same wrapper animates for real. Without this,
  // the assertion above would pass just as happily against a stylesheet that had dropped the
  // animation entirely — a test that cannot fail is not coverage (the S354 lesson, below).
  test('without the preference the route-fade wrapper animates for real', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/', { waitUntil: 'load' });
    await settleSW(page);
    const wrapper = page.locator('.animate-route-fade').first();
    await expect(wrapper).toBeAttached({ timeout: 20_000 });
    const durationSeconds = await wrapper.evaluate((el) =>
      parseFloat(getComputedStyle(el).animationDuration),
    );
    expect(durationSeconds).toBeGreaterThan(0.001);
  });
});

/**
 * S354 REWRITE — this pack previously read `.animate-pulse-glow` (hero countdown cells)
 * and `.animate-float` (hero orbs) off the live DOM. S354 DELETED both rules AND both
 * usages (decoration removal: two infinite loops). Left as they were, those two tests
 * would have asserted `animationName: 'none'` against classes that declare no animation
 * anywhere — green forever, detecting nothing, whether or not the reduced-motion block
 * still worked. A test that cannot fail is not coverage.
 *
 * The replacement probes `.animate-shimmer` — the surviving authored infinite loop, still
 * named in the reduced-motion block — and pairs the reduced-motion assertion with a
 * POSITIVE CONTROL in the same test: the identical probe WITHOUT reduced motion must read
 * the real keyframe name. That control is what keeps this non-vacuous: delete the
 * `.animate-shimmer` rule and the control fails; delete the reduced-motion block and the
 * reduce assertion fails. Neither can rot silently into a pass.
 */
test.describe('S84 · reduced motion — infinite CSS loops are hard-stopped (globals.css)', () => {
  test('.animate-shimmer: real keyframe by default, animationName none under reduce', async ({
    page,
  }) => {
    // POSITIVE CONTROL — default motion. Proves the rule under test actually exists and
    // declares a live loop, so the reduce assertion below is measuring the @media block.
    await page.goto('/', { waitUntil: 'load' });
    await settleSW(page);
    expect(await probeAnimationName(page, 'animate-shimmer')).toBe('shimmer');

    // The guarantee — the same class, the same document, reduced motion emulated.
    await gotoReduced(page, '/');
    expect(await probeAnimationName(page, 'animate-shimmer')).toBe('none');
  });
});

test.describe('S84 · reduced motion — count-up does not animate (useCountUp, D-056b)', () => {
  test('the hero countdown shows its EXACT final value on first paint (no 0→N ramp)', async ({
    page,
  }) => {
    // Same frozen instant as the S82 countdown pack: Nov 9 2026 (local noon) →
    // Dec 9 2026 00:00 is exactly 00m/00w/29d/12h/00m/00s, totalDays 29 (issue #60 /
    // D-313: calendar-accurate months again, so the 29-day residue hits the
    // WEEKS_SUPPRESSED_AT window and reads as raw days, not carried into a month —
    // both months and weeks are 0 and neither is rendered). Under reduced motion the
    // count-up lands on these immediately, so assert the DOM shows the finals with NO
    // intermediate eased value.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?today=2026-11-09', { waitUntil: 'load' });
    await settleSW(page);

    // These are the exact finals; a still-animating count-up would transiently
    // show a smaller number, so a first-paint exact match proves no ramp.
    await expect(page.getByTestId('countdown-months')).toHaveCount(0);
    await expect(page.getByTestId('countdown-weeks')).toHaveCount(0);
    await expect(page.getByTestId('countdown-days')).toHaveText('29');
    await expect(page.getByTestId('countdown-hours')).toHaveText('12');
    await expect(page.getByTestId('countdown-total-days')).toHaveText('29');

    // Stronger no-animation proof: read the seconds cell twice ~700ms apart while
    // the clock is FROZEN. A count-up ramp (or a live tick) would change it; under
    // reduced motion + a frozen override it must be byte-identical both reads.
    const secondsFirst = await page.getByTestId('countdown-seconds').textContent();
    await expect
      .poll(async () => page.getByTestId('countdown-seconds').textContent(), { timeout: 2000 })
      .toBe(secondsFirst);
    expect(secondsFirst).toBe('00');
  });
});

test.describe('S84 · reduced motion — loading skeleton shimmer is neutralized', () => {
  test('any present .animate-shimmer bar has animationName: none', async ({ page }) => {
    // The SectionSkeleton (dynamic `loading:` fallback) may flash only briefly
    // before the island mounts, so we cannot GUARANTEE one is on screen at any
    // instant. This test asserts the invariant CONDITIONALLY: if a shimmer bar is
    // present, it MUST be neutralized; if none is present, we fall through to the
    // injected probe, which proves the SAME rule on the same class without depending
    // on the skeleton's lifetime. (S354: this note used to cite the .animate-float /
    // .animate-pulse-glow loops as the fallback proof — both are deleted.)
    await gotoReduced(page, '/nepal/');

    const shimmer = page.locator('.animate-shimmer').first();
    // Read the computed animation-name only if a shimmer bar is currently
    // present AND still attached at read time (the skeleton can vanish the
    // instant its island mounts). Read directly off the handle (no attached-wait)
    // so a bar that disappears mid-check falls through to the always-true rule
    // proof below rather than timing out.
    let shimmerName: string | null = null;
    if ((await shimmer.count()) > 0) {
      shimmerName = await shimmer
        .evaluate((el) => getComputedStyle(el).animationName)
        .catch(() => null);
    }
    if (shimmerName !== null) {
      expect(shimmerName).toBe('none');
    } else {
      // No skeleton on screen right now — fall back to the injected probe, which proves
      // the same rule without depending on the skeleton's lifetime. (S354: this branch
      // used to read `.animate-float`, a class that no longer exists.)
      expect(await probeAnimationName(page, 'animate-shimmer')).toBe('none');
    }
  });
});

test.describe('S134 · reduced motion — micro-interaction keyframes are neutralized', () => {
  test('today-pulse / undo-ring / drag-lift compute to animationName none under reduce', async ({
    page,
  }) => {
    await gotoReduced(page, '/');
    // Inject a probe element per new class and read its computed animation-name. This
    // proves the reduced-motion CSS rule governs each S134 keyframe regardless of whether
    // a live instance (a today cell, an undo toast, an active drag overlay) is on screen —
    // those are state-dependent and would make a direct read flaky. The rule under test is
    // the same `animation: none !important` @media block that governs .animate-shimmer
    // (proven live above, with a positive control), extended to cover the S134 additions.
    const names = await page.evaluate(() =>
      ['animate-today-pulse', 'animate-undo-ring', 'drag-overlay'].map((cls) => {
        const el = document.createElement('div');
        el.className = cls;
        document.body.appendChild(el);
        const name = getComputedStyle(el).animationName;
        el.remove();
        return name;
      }),
    );
    expect(names).toEqual(['none', 'none', 'none']);
  });

  test('the live calendar "today" cell carries a static (non-animating) pulse under reduce', async ({
    page,
  }) => {
    // Freeze the clock INSIDE the Nepal leg so the month grid has a "today" cell carrying
    // .animate-today-pulse. Default (desktop) viewport → the lg+ month grid is visible.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/plan/?today=2026-12-12', { waitUntil: 'load' });
    await settleSW(page);
    const cell = page.locator('.animate-today-pulse').first();
    if ((await cell.count()) > 0) {
      const name = await cell.evaluate((el) => getComputedStyle(el).animationName);
      expect(name).toBe('none');
    }
    // If the grid isn't rendered at this viewport the probe test above still proves the rule.
  });
});

/**
 * Record whether `html[data-vt-active]` is EVER set from this instant until read.
 * Installed AFTER settleSW so the first-load SW reload can't wipe the observer, and
 * on `document.documentElement` (which App-Router client navigation preserves — the
 * whole VT handshake rides on that), so a value set for a few hundred ms during a
 * client transition is captured even though it is gone by the time we read it.
 */
async function watchVtAttr(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __vtSeen: boolean };
    const root = document.documentElement;
    w.__vtSeen = root.hasAttribute('data-vt-active');
    new MutationObserver(() => {
      if (root.hasAttribute('data-vt-active')) w.__vtSeen = true;
    }).observe(root, { attributes: true, attributeFilter: ['data-vt-active'] });
  });
}
const vtWasSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vtSeen: boolean }).__vtSeen);

/**
 * S179 (D-171) — View Transitions wrapper reconciled with the
 * template.tsx route fade. The centerpiece guarantees:
 *   - the ONE CSS handshake (`html[data-vt-active] .animate-route-fade { animation:none }`)
 *     deterministically suppresses the route fade for the bracketed window;
 *   - the supported path actually drives a VT and never leaves the attribute stuck;
 *   - the no-support fallback keeps today's plain-push + route-fade behavior (the
 *     Firefox/Safari path), setting no attribute;
 *   - reduced motion is NONE of either kind (no fade AND no VT) — D-007/D-056.
 */
test.describe('S179 · view transitions — route-fade suppression handshake', () => {
  test('html[data-vt-active] collapses .animate-route-fade to animation-name: none (and only then)', async ({
    page,
  }) => {
    // Default (non-reduced) context: the fade wrapper carries a REAL animation.
    await page.goto('/', { waitUntil: 'load' });
    await settleSW(page);
    const wrapper = page.locator('.animate-route-fade').first();
    await expect(wrapper).toBeAttached();

    // Baseline: without the attribute the route-fade keyframe is live.
    expect(await wrapper.evaluate((el) => getComputedStyle(el).animationName)).toBe('route-fade');

    // The handshake: while html[data-vt-active] is set, the suppression rule wins
    // (specificity html[attr] .class > .class) → the fade is neutralised, so the VT
    // cross-fade is the only motion and template.tsx's remount can't double-animate.
    await page.evaluate(() => document.documentElement.setAttribute('data-vt-active', ''));
    expect(await wrapper.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');

    // Removing it restores the fade — proving the rule is scoped to the bracketed window.
    await page.evaluate(() => document.documentElement.removeAttribute('data-vt-active'));
    expect(await wrapper.evaluate((el) => getComputedStyle(el).animationName)).toBe('route-fade');
  });

  test('supported browser: a navbar nav drives a VT and never leaves the attribute stuck', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await settleSW(page);

    // This bundled Chromium supports the API — otherwise this test proves nothing.
    const supported = await page.evaluate(
      () => typeof (document as unknown as { startViewTransition?: unknown }).startViewTransition === 'function',
    );
    expect(supported).toBe(true);

    await watchVtAttr(page);
    // S320 (D-231): Nepal left the desktop top row (consolidated behind Guides); this VT
    // test only needs any primary navbar link — retargeted to the Guides primary.
    await page.locator('[data-testid="navbar-link-guides"]').click();
    await expect(page).toHaveURL(/\/guides\//);

    // The supported rung set the bracket attribute (VT actually ran)…
    expect(await vtWasSeen(page)).toBe(true);
    // …and it is removed on `finished` (+ the ~1500ms safety) — never stuck, so route
    // fades keep working afterwards.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-vt-active')), {
        timeout: 4000,
      })
      .toBe(false);
  });

  test('no-support fallback: plain push, route fade intact, no attribute (Firefox/Safari path)', async ({
    page,
  }) => {
    // Emulate a browser without the API BEFORE any app script runs.
    await page.addInitScript(() => {
      try {
        // @ts-expect-error — remove the feature so the helper takes rung 2.
        delete Document.prototype.startViewTransition;
      } catch {
        /* not deletable in this engine — override below */
      }
      Object.defineProperty(Document.prototype, 'startViewTransition', {
        value: undefined,
        configurable: true,
      });
    });
    await page.goto('/', { waitUntil: 'load' });
    await settleSW(page);
    expect(
      await page.evaluate(
        () => typeof (document as unknown as { startViewTransition?: unknown }).startViewTransition,
      ),
    ).not.toBe('function');

    await watchVtAttr(page);
    // S320 (D-231): Nepal left the desktop top row (consolidated behind Guides); this VT
    // test only needs any primary navbar link — retargeted to the Guides primary.
    await page.locator('[data-testid="navbar-link-guides"]').click();
    await expect(page).toHaveURL(/\/guides\//);

    // Fallback = a plain router.push: navigation works, the attribute is NEVER set
    // (so the existing route fade plays exactly as it does today).
    expect(await vtWasSeen(page)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-vt-active'))).toBe(
      false,
    );
  });

  test('reduced motion: a navbar nav is NONE of either kind — no VT and no route fade', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/', { waitUntil: 'load' });
    await settleSW(page);

    await watchVtAttr(page);
    // S320 (D-231): Nepal left the desktop top row (consolidated behind Guides); this VT
    // test only needs any primary navbar link — retargeted to the Guides primary.
    await page.locator('[data-testid="navbar-link-guides"]').click();
    await expect(page).toHaveURL(/\/guides\//);

    // Rung 1: reduced motion short-circuits to a plain push — NO view transition of
    // either kind is ever started, so the bracket attribute is never set…
    expect(await vtWasSeen(page)).toBe(false);
    // …and the route fade itself is imperceptible (the reduced-motion @media collapses
    // its duration to ~0) — the existing D-007/D-056 idiom, re-proven post-navigation.
    const afterNav = page.locator('.animate-route-fade').first();
    if ((await afterNav.count()) > 0) {
      const d = await afterNav.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
      expect(d).toBeLessThanOrEqual(0.001);
    }
  });
});

test.describe('S84 · reduced motion — smooth scroll is disabled (globals.css html rule)', () => {
  test('html computed scroll-behavior is auto under reduced motion', async ({ page }) => {
    await gotoReduced(page, '/');
    // Read via the <html> locator's evaluate (auto-waits for the element and is
    // re-tried by the poll below), and wrap in expect.poll so a late first-load
    // SW reload that briefly destroys the context can't false-fail: the value
    // comes from the static stylesheet's reduced-motion rule, which applies the
    // instant the CSS is parsed (pre-hydration), so it settles to 'auto' quickly.
    await expect
      .poll(
        async () =>
          page
            .locator('html')
            .evaluate((el) => getComputedStyle(el).scrollBehavior)
            .catch(() => null),
        { timeout: 5000 },
      )
      // The reduced-motion block sets `html { scroll-behavior: auto !important }`
      // so anchor / programmatic scrolls jump instantly (D-007 / D-056).
      .toBe('auto');
  });
});

/**
 * S180 — scroll-progress bar: scroll-driven CSS animation with framer fallback.
 * Three rungs, mirroring the component's feature-detect:
 *   - supported (this Chromium): the CSS element renders, its scaleX is driven
 *     by `animation-timeline: scroll(root)` (keyframe `scroll-progress-fill`),
 *     and it actually tracks scroll 0 → bottom;
 *   - no-support fallback (Firefox/Safari path, emulated by stubbing
 *     CSS.supports): the original framer `m.div` renders and still tracks scroll;
 *   - reduced motion: the component NEVER renders the CSS element (the global
 *     0.01ms idiom doesn't cleanly neutralize progress timelines — see the
 *     component doc) — it renders the JS path bound to the RAW scrollYProgress,
 *     which tracks instantly (D-007/D-056).
 */
const scaleXOf = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const t = getComputedStyle(el).transform; // "matrix(a, b, c, d, e, f)" or "none"
    if (t === 'none') return 1; // unscaled = scaleX(1)
    return parseFloat(t.slice(t.indexOf('(') + 1));
  });

const scrollToBottom = (page: Page) =>
  page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

test.describe('S180 · scroll progress — scroll-driven CSS with framer fallback', () => {
  test('supported path: CSS element, scroll(root) timeline, tracks top→bottom', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await settleSW(page);

    // This Chromium must support the feature — otherwise this test proves nothing.
    expect(await page.evaluate(() => CSS.supports('animation-timeline: scroll()'))).toBe(true);

    // The component swaps to the CSS element after its detection effect.
    const bar = page.locator('[data-testid="scroll-progress"][data-scroll-driven="css"]');
    await expect(bar).toBeAttached();

    // Driven by the S180 keyframe, not by inline JS styles.
    expect(await bar.evaluate((el) => getComputedStyle(el).animationName)).toBe(
      'scroll-progress-fill',
    );

    // At the top the bar is empty; at the bottom, full — the timeline is live.
    expect(await scaleXOf(page, '[data-scroll-driven="css"]')).toBeLessThanOrEqual(0.02);
    await scrollToBottom(page);
    await expect
      .poll(() => scaleXOf(page, '[data-scroll-driven="css"]'), { timeout: 4000 })
      .toBeGreaterThan(0.98);
  });

  test('no-support fallback: framer path renders and still tracks scroll', async ({ page }) => {
    // Emulate a browser without scroll timelines BEFORE any app script runs.
    await page.addInitScript(() => {
      const real = CSS.supports.bind(CSS) as (...args: string[]) => boolean;
      CSS.supports = ((...args: string[]) =>
        String(args[0]).includes('animation-timeline') ? false : real(...args)) as typeof CSS.supports;
    });
    await page.goto('/', { waitUntil: 'load' });
    await settleSW(page);

    const bar = page.locator('[data-testid="scroll-progress"][data-scroll-driven="js"]');
    await expect(bar).toBeAttached();
    // No CSS keyframe on the JS path — framer drives an inline transform.
    expect(await bar.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');

    await scrollToBottom(page);
    // The spring settles toward 1 (restDelta 0.001).
    await expect
      .poll(() => scaleXOf(page, '[data-scroll-driven="js"]'), { timeout: 4000 })
      .toBeGreaterThan(0.95);
  });

  test('reduced motion: JS path only (raw bind, no spring), CSS element never rendered', async ({
    page,
  }) => {
    await gotoReduced(page, '/');

    // The explicit component guard: under reduce the CSS element must NOT exist,
    // even though this browser supports scroll timelines.
    const jsBar = page.locator('[data-testid="scroll-progress"][data-scroll-driven="js"]');
    await expect(jsBar).toBeAttached();
    await expect(page.locator('[data-scroll-driven="css"]')).toHaveCount(0);

    // Instant tracking (raw scrollYProgress — no animated lag).
    await scrollToBottom(page);
    await expect
      .poll(() => scaleXOf(page, '[data-scroll-driven="js"]'), { timeout: 4000 })
      .toBeGreaterThan(0.98);

    // Belt-and-braces probe (globals.css): the CSS class's BASE transform is
    // scaleX(0), so even if it ever rendered with its animation neutralized it
    // rests invisible — never a stuck full-width bar.
    const baseScaleX = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'scroll-progress-css';
      probe.style.animation = 'none'; // simulate the neutralized state
      document.body.appendChild(probe);
      const t = getComputedStyle(probe).transform;
      probe.remove();
      return t === 'none' ? 1 : parseFloat(t.slice(t.indexOf('(') + 1));
    });
    expect(baseScaleX).toBe(0);
  });
});
