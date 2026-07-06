'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, isRouteActive } from '@/lib/nav-items';

/**
 * Mobile bottom tab bar.
 *
 * The phone's primary navigation: a fixed, thumb-reach tab bar shown only `<md` (desktop
 * keeps the top navbar). Five routes, each an app-like icon + label, ≥44×44 target, with a
 * live `aria-current="page"` active state and the same warm/cool accent tint the navbar uses.
 *
 * DESIGN CONTRACT / SEAMS
 * - Route array + active-match helper are imported from `lib/nav-items.ts` (the
 *   navbar and this bar previously each carried a byte-identical local copy; that was closed
 *   by unifying on the single shared module). Both navs consume the same NAV_ITEMS, so they
 *   can never drift out of sync.
 * - Active state mirrors the navbar EXACTLY: trailing-slash-agnostic `isRouteActive` (Home
 *   exact; others `===` or `startsWith(target + '/')`), driven by `usePathname()` (which
 *   excludes basePath — the whole bar is basePath-agnostic).
 * - Active tint via INLINE style `hsl(var(--accent-scroll))` (dynamic color must be an
 *   inline style, never a dynamic Tailwind class) — same idiom + same live accent var the
 *   navbar's underline uses, so both navs re-tint together via the route-accent engine.
 * - Z-LADDER: the bar is `z-50` (navbar/tab-bar/dialog tier) so it sits above page
 *   content and the presence bar (z-40) but below the token gate (z-70).
 * - SAFE AREA: `paddingBottom: env(safe-area-inset-bottom)` keeps the labels clear of
 *   the home-indicator on notched phones (`viewport-fit=cover` is set in the layout).
 * - HEIGHT CONTRACT: on mount we publish the bar's height as `--tab-bar-h` on
 *   `document.documentElement` so the FAB and page content can offset above it. A fixed 64px
 *   (`h-16` content) is stable; consumers read `var(--tab-bar-h, 64px)` so the fallback
 *   already covers first paint (before this effect runs).
 * - A11y: a labeled `<nav>`, real `<Link>`s, visible focus ring, and reduced-motion-safe
 *   color-only transitions (no transform on the tabs).
 */

/** The published height contract: consumers use `var(--tab-bar-h, 64px)`. */
const TAB_BAR_HEIGHT_PX = 64;

export default function BottomTabBar() {
  const pathname = usePathname();

  // Publish the bar height so the FAB / page content can offset above it (SSR-guarded).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--tab-bar-h', `${TAB_BAR_HEIGHT_PX}px`);
    // Leave the var in place on unmount: consumers already fall back to 64px, and in the
    // real app the bar is app-wide chrome that never unmounts. No cleanup needed.
  }, []);

  return (
    <nav
      data-testid="tab-bar"
      aria-label="Primary mobile"
      className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-white/10 bg-navy-900/90 backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex items-stretch" style={{ height: `${TAB_BAR_HEIGHT_PX}px` }}>
        {NAV_ITEMS.map((item) => {
          const isActive = isRouteActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.label} className="flex-1 min-w-0">
              <Link
                href={item.href}
                data-testid={`tab-bar-${item.label.toLowerCase()}`}
                aria-current={isActive ? 'page' : undefined}
                data-active={isActive ? 'true' : undefined}
                className="relative flex h-full min-h-[44px] w-full flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-400 focus-visible:outline-none"
                // The active color is dynamic (route-accent var) → inline style, never a
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
