'use client';

/**
 * LazyVisible — the below-the-fold "lazy-island" wrapper.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────
 * Home (`app/page.tsx`) loads its sections via `next/dynamic(() => import('@/components/…'),
 * {ssr:false})`. A `dynamic(ssr:false)` component that is INSTANTIATED in the initial
 * render tree still has its chunk preloaded (it counts toward the route's First Load JS).
 * The lever: keep the deferred sections' elements OUT of the initial render tree. On first
 * paint LazyVisible renders only a cheap, sized placeholder (no section element). It
 * instantiates the real section (`<Component/>`) only once a trigger fires — so the
 * section's element is absent from the initial tree, its chunk is not preloaded, and it
 * drops out of Home's First Load JS, streaming in on demand.
 *
 * IMPORTANT — the section is passed as a COMPONENT REFERENCE (`component` prop), never as
 * JSX `children`. JSX children are evaluated as React elements in the PARENT's render even
 * when not displayed, which would put the section back in the initial tree (and re-preload
 * its chunk). Passing the reference and instantiating `<Component/>` ourselves only after
 * the trigger is what actually keeps it out. The `dynamic()` wrapper is defined at MODULE
 * scope by the caller (SSG-safe — never constructed during render).
 *
 * ── The trigger: visibility, with a post-hydration idle fallback ─────────────────
 * 1. VISIBILITY (primary, a minimal inline native `IntersectionObserver` hook — see
 * `useInView` below; ZERO deps,). A generous `rootMargin`
 * (default 600px) starts loading the chunk BEFORE the section reaches the viewport,
 * so there is no visible pop-in on a normal scroll. Latches once (triggerOnce).
 * 2. IDLE FALLBACK (`requestIdleCallback`, `setTimeout` fallback). Shortly AFTER
 * hydration — when the main thread is idle — we mount the section even if the user
 * never scrolls. This does NOT re-add the chunk to First Load JS (it is absent from
 * the initial preload manifest, which is what the bundle number measures); it merely
 * fetches a beat after hydration instead of only on scroll. It guarantees the section
 * is present for (a) users on very tall viewports who see it without scrolling and
 * (b) E2E specs that assert a below-fold section is visible WITHOUT an explicit scroll
 * — keeping the frozen net green with NO frozen-spec edits.
 *
 * The two triggers are OR-ed: whichever fires first mounts the section.
 *
 * ── CLS / no visible jump ────────────────────────────────────────────────────────
 * The placeholder reserves a real box (`minHeight`, per-section) so swapping the real
 * section in doesn't shift layout below it. It reuses the shared `SectionSkeleton`
 * shimmer, which is `aria-hidden` and reduced-motion-neutralised in globals.css — so under
 * `prefers-reduced-motion` it is a static muted block, never a sweep.
 */

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import SectionSkeleton from '@/components/section-skeleton';

/**
 * Minimal native-`IntersectionObserver` replacement for `react-intersection-observer`'s
 * `useInView`. Single consumer, so
 * it lives inline here rather than in its own module. Preserves the four behaviours the
 * component relied on: the `rootMargin` pre-viewport lead, a `triggerOnce` latch (`inView`
 * goes true once and never back), `skip`-driven detach (once mounted the observer stops),
 * and the `{ ref, inView }` shape (a callback `ref` for the placeholder + a boolean).
 * SSR-safe: no observer is constructed until the ref runs on a real DOM node, and it
 * guards `typeof IntersectionObserver`.
 */
function useInView({ rootMargin, skip }: { rootMargin: string; skip: boolean }) {
  const [inView, setInView] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const ref = useCallback(
    (node: Element | null) => {
      // Detach any prior observer (node swapped / unmounted / now skipped).
      observerRef.current?.disconnect();
      observerRef.current = null;

      if (!node || skip || typeof IntersectionObserver === 'undefined') return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setInView(true); // triggerOnce: latch true...
            observer.disconnect(); // ..and stop observing.
          }
        },
        { rootMargin },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [skip, rootMargin],
  );

  return { ref, inView };
}

interface LazyVisibleProps {
  /**
   * The section to mount, as a COMPONENT REFERENCE (e.g. a module-scope
   * `dynamic(() => import('@/components/trip-dashboard'), {ssr:false})`). Passed as a
   * reference — NOT as JSX — so the element is only created once the trigger fires and
   * the section stays out of the initial render tree (and out of First Load JS).
   * Rendered prop-less here; any props on the underlying component must be optional.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
  /**
   * Reserved height for the placeholder so the swap-in causes no CLS. Any CSS length
   * (e.g. '640px', 'clamp(28rem, 70vh, 44rem)'). Set it to roughly the real section's
   * height. Defaults to the shared skeleton's generous default.
   */
  minHeight?: string;
  /**
   * How far before the viewport to start loading (IntersectionObserver `rootMargin`).
   * A generous lead avoids visible pop-in on scroll. Default 600px.
   */
  rootMargin?: string;
  /** Optional testid on the pending-placeholder wrapper. */
  testId?: string;
}

export default function LazyVisible({
  component: Component,
  minHeight,
  rootMargin = '600px 0px',
  testId,
}: LazyVisibleProps) {
  const [mounted, setMounted] = useState(false);

  // Primary trigger: near-viewport visibility. The hook latches `inView` true once (so the
  // section never toggles back out) and detaches the observer once `skip` (mounted) is set.
  const { ref, inView } = useInView({
    rootMargin,
    skip: mounted,
  });

  // OR-1: the observer reports we're at/near the viewport.
  useEffect(() => {
    if (inView) setMounted(true);
  }, [inView]);

  // OR-2: post-hydration idle fallback — mount even without a scroll, once the main
  // thread is idle, so tall-viewport users and no-scroll E2E assertions still get the
  // real section. Does NOT re-add the chunk to First Load JS (it is absent from the
  // initial preload manifest); it merely fetches a beat after hydration.
  const idleRef = useRef(false);
  useEffect(() => {
    if (mounted || idleRef.current) return;
    idleRef.current = true;

    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const w = window as IdleWindow;

    let idleHandle: number | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    if (typeof w.requestIdleCallback === 'function') {
      idleHandle = w.requestIdleCallback(() => setMounted(true), { timeout: 2000 });
    } else {
      // Safari lacks requestIdleCallback — a short timeout is the standard fallback.
      timeoutHandle = setTimeout(() => setMounted(true), 200);
    }

    return () => {
      if (idleHandle !== undefined && typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    };
  }, [mounted]);

  if (mounted) {
    // Instantiate the section ONLY now — this is the first time its element exists, so
    // its chunk was never part of the initial tree / preload manifest. The dynamic
    // component's own `loading:` slot (a sized skeleton) covers the fetch gap.
    return <Component />;
  }

  return (
    <div ref={ref} data-testid={testId} data-lazy-visible="pending">
      <SectionSkeleton height={minHeight} />
    </div>
  );
}
