'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * #871: after a client-side route change, move focus to `#main` so keyboard users don't stay on
 * the previous nav item. Skipped on first load (the browser owns initial focus). `preventScroll`
 * avoids a jump; `#main` is `outline-none`, so no ring shows. Renders nothing.
 */
export function RouteFocus() {
  const pathname = usePathname();
  const prev = useRef(pathname);

  useEffect(() => {
    if (prev.current === pathname) return;
    prev.current = pathname;
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);

  return null;
}

export default RouteFocus;
