import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * S211 — route-by-route reduced-motion audit (the PERMANENT motion regression net).
 *
 * The pre-existing `e2e/motion.spec.ts` proves the reduced-motion contract SURFACE by
 * SURFACE (route-fade wrapper, the named infinite CSS loops, count-up, the S134 micro-
 * interactions, the S179 VT handshake, the S180 scroll-progress guard) by reading
 * COMPUTED STYLES of specific selectors. This pack adds the complementary, route-COMPLETE
 * guarantee: under emulated `prefers-reduced-motion: reduce`, EVERY route must have ZERO
 * genuinely-running, non-trivial animations after settle — measured directly off the live
 * animation timeline via `document.getAnimations()`, not per-selector computed styles.
 *
 * WHY getAnimations() (the robust check, not vibes):
 *   - It observes the ACTUAL running animation set at runtime — CSS animations, CSS
 *     transitions in flight, AND Web-Animations-API animations that framer-motion drives.
 *     A per-selector computed-style read can only prove the surfaces you already thought to
 *     name; this catches an unguarded framer spring or a stray scroll-timeline animation on
 *     ANY route without enumerating its selector.
 *   - The global `@media (prefers-reduced-motion: reduce)` block (globals.css, D-007/D-056)
 *     collapses every CSS `animation-duration`/`transition-duration` to `0.01ms` and forces
 *     `animation-iteration-count: 1`, so a compliant CSS animation reaches `finished`
 *     essentially instantly. A genuinely-running animation with a real (or infinite)
 *     duration is therefore, by construction, a reduced-motion DEFECT — exactly what this
 *     net asserts is absent.
 *
 * The "non-trivial running" filter (applied in-page so the timeline is read on the real
 * document): an animation counts as a violation iff its `playState === 'running'` AND its
 * computed active duration exceeds a small threshold (50ms) — 0.01ms CSS collapses fall
 * below it and drop out; a real spring / a mis-guarded infinite loop (activeDuration
 * Infinity) stays in and fails the route.
 *
 * ONE-SHOT tolerance (deliberate, documented): the assertion POLLS (up to 6s) until the
 * running set is empty. The codebase's established reduced-motion idiom permits SHORT
 * ONE-SHOT OPACITY-ONLY fades (framer `MotionConfig reducedMotion="user"` semantics —
 * transforms disabled, opacity may fade; the D-100 full-opacity reveal branches, the hero
 * scroll-cue's delayed fade) — those FINISH and pass the poll. What can never pass: an
 * infinite loop that escaped the global neutralizer, a scroll/view-timeline animation
 * (never finishes at rest — the D-179 violation class the S211 hero-glow fix closed), or
 * any animation longer than the poll window. That is exactly the defect set this net
 * exists to catch.
 *
 * Harness mirrors `a11y.spec.ts` / `motion.spec.ts`: wall-bypass signed-in fixture,
 * reduced motion pinned BEFORE first paint, nav on `waitUntil:'load'` (never networkidle,
 * D-093), settle past the D-073 first-load SW reload, wait for the route's <h1>/root, then
 * poll the running set to empty.
 */

const THRESHOLD_MS = 50;

/** Every user-facing route: all 18 static content routes under app/, minus /travel/ (below). */
const ROUTES = [
  '/',
  '/plan/',
  '/nepal/',
  '/japan/',
  '/map/',
  '/journal/',
  '/flights/',
  '/safety/',
  '/recap/',
  '/settings/',
  '/packing/',
  '/share/',
  '/checklist/',
  // Issue #5. The passport is the one route that ships a NEW keyframe (`stamp-in`), and it is a
  // one-shot that rests at the stamped state — so under reduce the universal collapse must leave
  // the running set empty here exactly as it does everywhere else. Its sibling flourish,
  // <CelebrationBurst>, renders nothing at all under reduce (e2e/motion.spec.ts owns that half).
  '/passport/',
  // Issue #351 — live nav routes that were never in this net. /guides/ is static content;
  // the other three are client-gated and need READY below.
  '/guides/',
  '/more/',
  '/trips/',
  '/profile/',
  // /travel is handled separately below (needs an in-trip clock + seed to render its
  // animated hero/agenda branch — the very surfaces D-185's spring-free guard governs).
] as const;

/**
 * Routes whose real surface sits behind a client gate: an `ssr:false` island (/trips/,
 * /profile/, /settings/) or a mount gate (/more/, /checklist/). Their server-rendered <h1>
 * comes from a page-level header and is up long before the island is, and an empty shell has
 * nothing running — so without this wait the poll below passes on its first read and the
 * route is a free green. Keyed by path; absent = <h1> is enough.
 */
const READY: Record<string, string> = {
  '/more/': 'more-link-settings',
  '/trips/': 'trips-hub',
  '/profile/': 'visited-country-form',
  '/settings/': 'settings-panel',
  // `docs-progress`, NOT `docs-checklist`: that testid sits on the `!hydrated` early return as
  // well as the real section, so waiting on it passes on the shell and audits nothing.
  '/checklist/': 'docs-progress',
};

type RunningAnim = { name: string; duration: number; playState: string };

/** Ride through the one-off first-load service-worker reload before reading the timeline. */
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

/**
 * Read the set of genuinely-running, non-trivial animations on the live document. Runs
 * IN-PAGE (document.getAnimations() has no cross-context serialisation) and returns a
 * plain-object list so the assertion + failure message live in the test.
 */
async function runningAnimations(page: Page, thresholdMs: number): Promise<RunningAnim[]> {
  return page.evaluate((threshold) => {
    return document
      .getAnimations()
      .map((a) => {
        const timing = a.effect?.getComputedTiming();
        // activeDuration is ms (Infinity for infinite loops). Typed CSSNumberish since the
        // scroll-timeline spec (percent-based CSSUnitValue for progress timelines) — coerce:
        // a percentage-duration animation IS a scroll/view-timeline animation, which never
        // finishes at rest, so it maps to Infinity (a violation) rather than being skipped.
        const raw = timing?.activeDuration;
        const duration =
          typeof raw === 'number' ? raw : raw == null ? 0 : Infinity;
        const name =
          (a as unknown as { animationName?: string }).animationName ??
          (a as unknown as { transitionProperty?: string }).transitionProperty ??
          a.constructor.name;
        return { name, duration, playState: a.playState };
      })
      .filter((a) => a.playState === 'running' && a.duration > threshold);
  }, thresholdMs);
}

/**
 * Poll the running set to empty. One-shot compliant fades finish and drop out within the
 * window; an infinite loop / scroll-timeline animation / stuck spring never empties the
 * set and fails with the offender list in the message.
 */
async function expectNoPersistentMotion(page: Page, label: string) {
  await expect
    .poll(
      async () => {
        const running = await runningAnimations(page, THRESHOLD_MS);
        return running
          .map((a) => `${a.name}(${a.duration === Infinity ? '∞' : Math.round(a.duration)}ms)`)
          .join(', ');
      },
      {
        timeout: 6000,
        message: `${label}: non-trivial animations persistently RUNNING under reduced motion`,
      },
    )
    .toBe('');
}

/** Navigate a route under reduced motion, settle, and assert zero persistent animations. */
async function assertNoMotion(page: Page, path: string, label = path) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path, { waitUntil: 'load' });
  await settleSW(page);
  await expect(page.locator('h1, [data-testid$="-root"]').first()).toBeVisible({ timeout: 15_000 });
  const ready = READY[path];
  if (ready) await expect(page.getByTestId(ready)).toBeVisible({ timeout: 15_000 });
  await expectNoPersistentMotion(page, label);
}

for (const route of ROUTES) {
  test(`reduced-motion: no running animations on ${route}`, async ({ page }) => {
    await assertNoMotion(page, route);
  });
}

// A representative scroll-driven route: scroll to the bottom (arming the scroll-progress /
// scroll-accent surfaces + any reveal-on-scroll) then re-assert — the scroll-timeline path
// must NEVER be rendered under reduced motion (D-179), so nothing new starts running.
test('reduced-motion: no running animations on / after scrolling (scroll-driven surfaces)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'load' });
  await settleSW(page);
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expectNoPersistentMotion(page, '/ (scrolled to bottom)');
});

// /travel in-trip: the animated hero flip + agenda are the surfaces D-185's React-level
// spring-free branch governs (NOT the global neutralizer). Seed a Nepal day so the hero
// renders its "now" phase and the agenda has rows, drive the in-trip clock, and prove the
// spring-free branch leaves nothing running.
test('reduced-motion: no running animations on /travel in-trip (hero flip + agenda, D-185)', async ({
  page,
}) => {
  await page.addInitScript((day) => {
    window.localStorage.setItem('nepal_japan_itinerary', JSON.stringify([day]));
  }, {
    date: '2026-12-10',
    city: 'Kathmandu',
    country: 'nepal',
    items: [
      { id: 'm-now', title: 'Boudhanath walk', category: 'photography', startMinutes: 660, durationMinutes: 120 },
      { id: 'm-next', title: 'Thamel lunch', category: 'food', startMinutes: 900 },
      { id: 'm-untimed', title: 'Souvenir hunt', category: 'sightseeing' },
    ],
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/travel/?today=2026-12-10', { waitUntil: 'load' });
  await settleSW(page);
  await expect(page.getByTestId('travel-mode-root')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('travel-hero-flip')).toHaveAttribute('data-flip-animated', 'false');
  await expectNoPersistentMotion(page, '/travel in-trip');
});
