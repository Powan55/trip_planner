'use client';

import { useCallback, useEffect, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { primaryItemsForActiveTrip, isRouteActive, type NavItem } from '@/lib/nav-items';
import { useViewTransition } from '@/hooks/use-view-transition';
import { isTravelRoute } from '@/lib/travel-route';

/**
 * Mobile bottom tab bar.
 *
 * The phone's primary navigation: a fixed, thumb-reach tab bar shown only `<md` (desktop
 * keeps the top navbar).: FIVE tabs — the 4 shared primaries (Today · Plan ·
 * Map · Guides) plus a synthetic `More → /more/` tab — each an app-like icon + label,
 * ≥44×44 target, live `aria-current="page"`, and the same warm/cool accent tint the navbar uses.
 *
 * DESIGN CONTRACT / SEAMS
 * - Route array + active-match helper are imported from `lib/nav-items.ts` ( — the
 * navbar and this bar previously each carried a byte-identical local copy; closed
 * by unifying on the single shared module). Both navs consume the same source module, so
 * they can never drift out of sync.
 * -: this bar maps `primaryItemsForActiveTrip()` (the shared primaries), NOT the
 * full `NAV_ITEMS` — the long tail would drop each tab below the ≥44px touch-target floor.
 * Companions re-home to the `/more/` route (the appended 5th tab); desktop reaches them via
 * the navbar's "More" dropdown + the command palette.
 * - Active state mirrors the navbar EXACTLY: trailing-slash-agnostic `isRouteActive` (Home
 * exact; others `===` or `startsWith(target + '/')`), driven by `usePathname()` (which
 * excludes basePath — the whole bar is basePath-agnostic).
 * - THIS BAR *IS* THE `.nav` RECIPE. There is exactly one fixed bottom bar in the app: the
 * recipe's `position:fixed; bottom:0` and this component's are the same bar, not two, so the
 * `.nav` class is applied here rather than shipped as a second element that would stack on
 * top of this one. MATERIAL carries the active state — a lighter surface, raised 7px — which
 * is what leaves the screen's one `--accent` FILL free for the thing that is actually live.
 * The accent survives only as a RULE (the top hairline), which spends nothing.
 * - Z-LADDER: the bar is `z-50` (navbar/tab-bar/dialog tier) so it sits above page
 * content and the presence bar (z-40) but below the token gate (z-70). `.nav` declares
 * `z-index:60`; the `z-50` utility outranks it (utilities layer > `@layer components`),
 * which is deliberate — the ladder is the app's, not the recipe's.
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

/**
 * the synthetic 5th tab. NOT a `NAV_ITEMS` entry — it's a mobile-only
 * affordance, appended
 * AFTER the memoized primaries so once-computed memo + null-under-/travel
 * both stay intact. `/more/` is a plain route.
 */
const MORE_TAB: NavItem = { label: 'More', href: '/more/', icon: Menu };

export default function BottomTabBar() {
  const pathname = usePathname();

  // BottomTabBar is `dynamic(ssr:false)` (see
  // app/chrome-islands.tsx) — it never renders server-side, so there is no hydration
  // mismatch to gate against here. The active-trip pointer only changes via a full reload
  //, so it's stable for the component's lifetime — computed once.
  const items = useMemo(() => [...primaryItemsForActiveTrip(), MORE_TAB], []);

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
      // `block` overrides `.nav`'s own `display:grid`: the grid belongs on the <ul>, so the
      // five tabs are grid items and the list keeps its semantics. `md:hidden` still wins
      // over both — it is a utility and `.nav` is layered.
      className="nav block md:hidden z-50"
    >
      <ul
        className="grid grid-cols-5 items-stretch"
        style={{ height: `${TAB_BAR_HEIGHT_PX}px` }}
      >
        {items.map((item) => {
          const isActive = isRouteActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.label} className="flex min-w-0">
              <Link
                href={item.href}
                onClick={vtClick(item.href)}
                data-testid={`tab-bar-${item.label.toLowerCase()}`}
                aria-current={isActive ? 'page' : undefined}
                data-active={isActive ? 'true' : undefined}
                // `.nav a` carries the whole recipe: the trapezoid clip-path, the
                // --surface-1 stock, the 7px raise on the active tab, min-height var(--tap)
                // and the tab-raise transition. Only the flex-fill is left to say here.
                className="relative min-w-0 flex-1"
              >
                {/* The active top rule. A RULE, not a fill — it does not spend the
                    screen's one --accent fill. Decorative: aria-current carries the fact. */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 right-0 top-0 h-[2px]"
                    style={{ backgroundColor: 'hsl(var(--accent-scroll))' }}
                  />
                )}
                {/* The icon sits in the recipe's `.n` slot, so it inherits that slot's
                    ink tier: --text-lo inactive, --text-hi active. FILLED means committed
                    — "you are here" is the material and the tier, never a dimming of the
                    other four. */}
                <span className="n flex items-center justify-center">
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                </span>
                <span className="t block truncate px-1 text-center">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
