/**
 * Cross-route hash scrolling for `ssr:false` client islands.
 *
 * After a client-side route navigation (e.g. the command palette pushing
 * `/nepal/#photography`, or the legacy-hash redirect replacing to it), the hash
 * target does NOT exist in the DOM yet — every section is a `dynamic({ ssr:false })`
 * island whose chunk loads after the page mounts, so the browser's / Next's own
 * hash-scroll attempt finds nothing and lands at the top. This helper closes that
 * gap: it rAF-polls (bounded) until the element exists, then defers the scroll by
 * a double rAF — the navbar pattern — so the freshly-mounted subtree gets two frames
 * to lay out before we measure.
 *
 * Reduced motion: `scrollIntoView` is a JS API the CSS `scroll-behavior`
 * rule does not govern, so we explicitly pass `behavior:'auto'` (instant jump)
 * under `prefers-reduced-motion: reduce`.
 */

// ~5s at 60fps — generous for a route chunk + section islands on a slow line,
// but bounded so an id that never appears can't leave a perpetual rAF loop.
const MAX_POLL_FRAMES = 300;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Scroll `#<id>` into view as soon as it exists in the DOM. Returns a cancel
 * function. Safe to call fire-and-forget across a route transition (the poll is
 * bounded and self-terminates); pass the canceler to an effect cleanup only when
 * the scroll should NOT outlive the calling component.
 */
export function scrollToSectionWhenReady(id: string): () => void {
  if (typeof document === 'undefined') return () => {};

  let raf = 0;
  let frames = 0;
  let cancelled = false;

  const poll = () => {
    if (cancelled) return;
    const el = document.getElementById(id);
    if (el) {
      // Double-rAF after the target mounts: two frames for layout to settle.
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          if (cancelled) return;
          el.scrollIntoView({
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
            block: 'start',
          });
        });
      });
      return;
    }
    if (++frames >= MAX_POLL_FRAMES) return;
    raf = requestAnimationFrame(poll);
  };

  poll();

  return () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
  };
}
