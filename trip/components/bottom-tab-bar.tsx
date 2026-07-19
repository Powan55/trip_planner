'use client';

import { useCallback, useEffect, type MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PRIMARY_NAV_ITEMS, isRouteActive } from '@/lib/nav-items';
import { useViewTransition } from '@/hooks/use-view-transition';
import { isTravelRoute } from '@/lib/travel-route';

/**
 * Mobile bottom tab bar.
 *
 * The phone's primary navigation: a fixed, thumb-reach tab bar shown only `<md` (desktop
 * keeps the top navbar). Five routes, each an app-like icon + label, ≥44×44 target, with a
 * live `aria-current="page"` active state and the same warm/cool accent tint the navbar uses.
 *
 * DESIGN CONTRACT / SEAMS
 * - Route array + active-match helper are imported from `lib/nav-items.ts` ( — the
 * navbar and this bar previously each carried a byte-identical local copy; closed
 * by unifying on the single shared module). Both navs consume the same source module, so
 * they can never drift out of sync.
 * -: this bar maps `PRIMARY_NAV_ITEMS` (the 6 daily-use routes), NOT the full
 * `NAV_ITEMS` (9) — adding the 3 companion routes (Journal/Safety/Recap) here would drop
 * each tab below the ≥44px touch-target floor at a 360px viewport. Companions are reachable
 * via the mobile hamburger panel + command palette instead.
 * - Active state mirrors the navbar EXACTLY: trailing-slash-agnostic `isRouteActive` (Home
 * exact; others `===` or `startsWith(target + '/')`), driven by `usePathname()` (which
 * excludes basePath — the whole bar is basePath-agnostic).
 * - Active tint via INLINE style `hsl(var(--accent-scroll))` (: dynamic color must be an
 * inline style, never a dynamic Tailwind class) — same idiom + same live accent var the
 * navbar's underline uses, so both navs re-tint together via the route-accent engine.
 * - Z-LADDER: the bar is `z-50` (navbar/tab-bar/dialog tier) so it sits above page
 * content and the presence bar (z-40) but below the token gate (z-70).
 * - SAFE AREA: `paddingBottom: env(safe-area-inset-bottom)` keeps the labels clear of
 * the home-indicator on notched phones.
 * - HEIGHT CONTRACT: on mount we publish the bar's height as `--tab-bar-h` on
 * `document.documentElement` so the FAB and page content can offset above it. A fixed 64px
 * (`h-16` content) is stable; consumers read `var(--tab-bar-h, 64px)` so the fallback
 * already covers first paint (before this effect runs).
 * - A11y: a labeled `<nav>`, real `<Link>`s, visible focus ring, and reduced-motion-safe
 * color-only transitions.
 */

/** The published height contract: consumers use `var(--tab-bar-h, 64px)`. */
const TAB_BAR_HEIGHT_PX = 64;

export default function BottomTabBar() {
  const pathname = usePathname();

  // route changes run through the View Transitions helper (progressive
  // enhancement; plain router.push everywhere VT is unsupported or reduced motion is
  // on). `<Link>` stays for prefetch + real-href semantics; only a plain primary click
  // is intercepted. Modified clicks (new tab/window) fall through untouched.
  const navigate = useViewTransition();
  const vtClick = useCallback(
    (href: string) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
        return;
      }
      e.preventDefault();
      navigate(href);
    },
    [navigate],
  );

  // Publish the bar height so the FAB / page content can offset above it (SSR-guarded).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--tab-bar-h', `${TAB_BAR_HEIGHT_PX}px`);
    // Leave the var in place on unmount: consumers already fall back to 64px, and in the
    // real app the bar is app-wide chrome that never unmounts. No cleanup needed.
  }, []);

  // chrome-free Travel Mode — the mobile tab bar renders null under `/travel`.
  // After all hooks (unconditional order); the height-publish effect still runs harmlessly.
  if (isTravelRoute(pathname)) return null;

  return (
    <nav
      data-testid="tab-bar"
      aria-label="Primary mobile"
      className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-white/10 bg-surface/90 backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex items-stretch" style={{ height: `${TAB_BAR_HEIGHT_PX}px` }}>
        {PRIMARY_NAV_ITEMS.map((item) => {
          const isActive = isRouteActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.label} className="flex-1 min-w-0">
              <Link
                href={item.href}
                onClick={vtClick(item.href)}
                data-testid={`tab-bar-${item.label.toLowerCase()}`}
                aria-current={isActive ? 'page' : undefined}
                data-active={isActive ? 'true' : undefined}
                className="relative flex h-full min-h-[44px] w-full flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-400 focus-visible:outline-none"
                // the active color is dynamic (route-accent var) → inline style, never a
                // dynamic Tailwind class. Inactive tabs use a static muted white.
                style={isActive ? { color: 'hsl(var(--accent-scroll))' } : undefined}
              >
                {/* Active top hairline in the same accent (decorative). */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 top-0 h-0.5 w-8 -translate-x-1/2 rounded-full"
                    style={{ backgroundColor: 'hsl(var(--accent-scroll))' }}
                  />
                )}
                <Icon
                  className={`h-5 w-5 shrink-0 ${isActive ? '' : 'text-white/60'}`}
                  aria-hidden="true"
                />
                <span className={`truncate ${isActive ? '' : 'text-white/60'}`}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
