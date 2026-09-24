'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Minimal native-`IntersectionObserver` hook shared by `LazyVisible` (below-the-fold section
 * mounting) and per-item lazy work (e.g. deferring a photo's object-URL decode until its
 * thumbnail is near the viewport). `triggerOnce`: `inView` latches true and never back.
 * `skip`-driven detach: once the caller is done with it (e.g. already mounted), the observer
 * disconnects. SSR/old-browser-safe: no observer is constructed until the ref runs on a real
 * DOM node, and it guards `typeof IntersectionObserver`.
 */
export function useInView({ rootMargin, skip }: { rootMargin: string; skip: boolean }) {
  const [inView, setInView] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const ref = useCallback(
    (node: Element | null) => {
      // Detach any prior observer (node swapped / unmounted / now skipped).
      observerRef.current?.disconnect();
      observerRef.current = null;

      if (!node || skip) return;

      if (typeof IntersectionObserver === 'undefined') {
        // No observer support (older browser, or a test/SSR environment) — don't gate.
        setInView(true);
        return;
      }

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
